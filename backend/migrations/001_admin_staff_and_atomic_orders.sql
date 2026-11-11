-- BizInsight Admin + Staff roles and transaction-safe order creation.
-- Apply this SQL to the bizinsight-india Supabase project before using the updated API.

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check CHECK (role IN ('admin', 'staff'));

-- Existing admin remains unchanged. Legacy normal users become staff.
UPDATE public.profiles SET role = 'staff' WHERE role = 'user';

-- New public registrations default to staff; never trust a role from user metadata.
CREATE OR REPLACE FUNCTION public.handle_new_bizinsight_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, phone, role)
  VALUES (NEW.id, NULLIF(NEW.raw_user_meta_data ->> 'full_name', ''),
          NULLIF(NEW.raw_user_meta_data ->> 'phone', ''), 'staff')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- Replace the admin-only policies with admin/staff operational access.
CREATE OR REPLACE FUNCTION private.is_bizinsight_admin_or_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = (SELECT auth.uid())
      AND p.role IN ('admin', 'staff')
  );
$$;
REVOKE ALL ON FUNCTION private.is_bizinsight_admin_or_staff() FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_bizinsight_admin_or_staff() TO authenticated;

DROP POLICY IF EXISTS "Admins manage products" ON public.products;
CREATE POLICY "Staff and admins read products" ON public.products
  FOR SELECT TO authenticated USING ((SELECT private.is_bizinsight_admin_or_staff()));
CREATE POLICY "Admins and staff manage products" ON public.products
  FOR ALL TO authenticated
  USING ((SELECT private.is_bizinsight_admin_or_staff()))
  WITH CHECK ((SELECT private.is_bizinsight_admin_or_staff()));

DROP POLICY IF EXISTS "Admins manage customers" ON public.customers;
CREATE POLICY "Admins and staff manage customers" ON public.customers
  FOR ALL TO authenticated
  USING ((SELECT private.is_bizinsight_admin_or_staff()))
  WITH CHECK ((SELECT private.is_bizinsight_admin_or_staff()));

DROP POLICY IF EXISTS "Admins manage orders" ON public.orders;
CREATE POLICY "Admins and staff manage orders" ON public.orders
  FOR ALL TO authenticated
  USING ((SELECT private.is_bizinsight_admin_or_staff()))
  WITH CHECK ((SELECT private.is_bizinsight_admin_or_staff()));

DROP POLICY IF EXISTS "Admins manage order items" ON public.order_items;
CREATE POLICY "Admins and staff manage order items" ON public.order_items
  FOR ALL TO authenticated
  USING ((SELECT private.is_bizinsight_admin_or_staff()))
  WITH CHECK ((SELECT private.is_bizinsight_admin_or_staff()));

-- Creates order + items and decrements stock in one database transaction.
-- Execute permission is limited to service_role; the backend calls this RPC using
-- the server-side Supabase secret key after checking the user's staff/admin role.
CREATE OR REPLACE FUNCTION public.create_bizinsight_order(
  p_order_number text,
  p_customer_id uuid,
  p_items jsonb,
  p_tax_amount numeric DEFAULT 0,
  p_discount_amount numeric DEFAULT 0,
  p_status text DEFAULT 'pending'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_order_id uuid;
  v_subtotal numeric := 0;
  v_tax numeric := COALESCE(p_tax_amount, 0);
  v_discount numeric := COALESCE(p_discount_amount, 0);
  v_item jsonb;
  v_product public.products%ROWTYPE;
  v_quantity integer;
BEGIN
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'At least one order item is required';
  END IF;
  IF v_tax < 0 OR v_discount < 0 THEN RAISE EXCEPTION 'Tax and discount cannot be negative'; END IF;
  IF p_status NOT IN ('pending', 'processing', 'completed', 'cancelled') THEN RAISE EXCEPTION 'Invalid order status'; END IF;

  -- Validate and lock products in stable ID order to reduce concurrent deadlocks.
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) ORDER BY (value->>'product_id')
  LOOP
    v_quantity := (v_item->>'quantity')::integer;
    IF v_quantity <= 0 THEN RAISE EXCEPTION 'Quantity must be a positive integer'; END IF;
    SELECT * INTO v_product FROM public.products
      WHERE id = (v_item->>'product_id')::uuid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Product not found'; END IF;
    IF NOT v_product.is_active THEN RAISE EXCEPTION 'Product is inactive'; END IF;
    IF v_product.stock_quantity < v_quantity THEN RAISE EXCEPTION 'Insufficient stock for product %', v_product.name; END IF;
    v_subtotal := v_subtotal + (v_product.price * v_quantity);
  END LOOP;

  IF v_discount > v_subtotal + v_tax THEN RAISE EXCEPTION 'Discount cannot exceed subtotal plus tax'; END IF;

  INSERT INTO public.orders(order_number, customer_id, status, subtotal, tax_amount, discount_amount, total_amount)
  VALUES (p_order_number, p_customer_id, p_status, v_subtotal, v_tax, v_discount, v_subtotal + v_tax - v_discount)
  RETURNING id INTO v_order_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_quantity := (v_item->>'quantity')::integer;
    SELECT * INTO v_product FROM public.products WHERE id = (v_item->>'product_id')::uuid FOR UPDATE;
    UPDATE public.products SET stock_quantity = stock_quantity - v_quantity WHERE id = v_product.id;
    INSERT INTO public.order_items(order_id, product_id, quantity, unit_price)
    VALUES (v_order_id, v_product.id, v_quantity, v_product.price);
  END LOOP;

  RETURN v_order_id;
END;
$$;
REVOKE ALL ON FUNCTION public.create_bizinsight_order(text, uuid, jsonb, numeric, numeric, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_bizinsight_order(text, uuid, jsonb, numeric, numeric, text) TO service_role;
