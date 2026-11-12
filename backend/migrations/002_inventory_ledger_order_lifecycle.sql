BEGIN;

-- BizInsight Phase 1: stock ledger, safe order lifecycle, customer archive, and role protection.
-- IMPORTANT: Review and apply only after confirming the target Supabase project and taking a backup.
-- This migration is intentionally committed to GitHub but is NOT applied to the live database by this change.

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

ALTER TABLE public.profiles
  ALTER COLUMN role SET DEFAULT 'staff';

-- Users may edit only their own profile's non-privileged fields. Role changes
-- must go through the service-role RPC below; this prevents self-promotion.
REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT UPDATE (full_name, phone) ON public.profiles TO authenticated;

-- Orders and order items are read-only to authenticated API clients. Creation,
-- status transitions and stock changes are performed by the protected RPCs.
REVOKE INSERT, UPDATE, DELETE ON public.orders FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.order_items FROM authenticated;
GRANT SELECT ON public.orders, public.order_items TO authenticated;

CREATE TABLE IF NOT EXISTS public.inventory_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  movement_type text NOT NULL CHECK (
    movement_type IN ('opening', 'purchase', 'sale', 'sale_reversal', 'adjustment')
  ),
  quantity_delta integer NOT NULL CHECK (quantity_delta <> 0),
  quantity_before integer NOT NULL CHECK (quantity_before >= 0),
  quantity_after integer NOT NULL CHECK (quantity_after >= 0),
  reason text,
  reference_type text,
  reference_id uuid,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inventory_movements_product_created_idx
  ON public.inventory_movements(product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS inventory_movements_created_idx
  ON public.inventory_movements(created_at DESC);

ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff and admins read inventory movements"
  ON public.inventory_movements;
CREATE POLICY "Staff and admins read inventory movements"
  ON public.inventory_movements
  FOR SELECT TO authenticated
  USING ((SELECT private.is_bizinsight_admin_or_staff()));

REVOKE ALL ON public.inventory_movements FROM anon, authenticated;
GRANT SELECT ON public.inventory_movements TO authenticated;

-- Preserve historical references: API and direct Data API clients cannot hard-delete
-- products, customers, orders or order items.
REVOKE DELETE ON public.products, public.customers FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON public.products, public.customers TO authenticated;

CREATE OR REPLACE FUNCTION private.guard_bizinsight_archive()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.is_active IS DISTINCT FROM OLD.is_active
     AND NOT EXISTS (
       SELECT 1 FROM public.profiles
       WHERE id = (SELECT auth.uid()) AND role = 'admin'
     ) THEN
    RAISE EXCEPTION 'Only an administrator may archive or reactivate records';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.guard_bizinsight_archive() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS guard_bizinsight_product_archive ON public.products;
CREATE TRIGGER guard_bizinsight_product_archive
  BEFORE UPDATE OF is_active ON public.products
  FOR EACH ROW EXECUTE FUNCTION private.guard_bizinsight_archive();

DROP TRIGGER IF EXISTS guard_bizinsight_customer_archive ON public.customers;
CREATE TRIGGER guard_bizinsight_customer_archive
  BEFORE UPDATE OF is_active ON public.customers
  FOR EACH ROW EXECUTE FUNCTION private.guard_bizinsight_archive();

-- Preserve a baseline movement for stock that already exists before the ledger.
INSERT INTO public.inventory_movements (
  product_id, movement_type, quantity_delta, quantity_before,
  quantity_after, reason
)
SELECT p.id, 'opening', p.stock_quantity, 0, p.stock_quantity,
       'Opening balance recorded when stock ledger was introduced'
FROM public.products p
WHERE p.stock_quantity > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.inventory_movements m
    WHERE m.product_id = p.id
  );

-- Only trusted database functions may change stock_quantity. Product edits must
-- use the stock movement RPC so every stock change is recorded.
CREATE OR REPLACE FUNCTION private.guard_bizinsight_stock_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.stock_quantity <> 0
       AND current_setting('bizinsight.allow_stock_change', true) IS DISTINCT FROM 'true' THEN
      RAISE EXCEPTION 'Initial stock must be recorded through the inventory movement workflow';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.stock_quantity IS DISTINCT FROM OLD.stock_quantity
     AND current_setting('bizinsight.allow_stock_change', true) IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'Stock cannot be edited directly; create an inventory movement';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.guard_bizinsight_stock_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS guard_bizinsight_stock_change ON public.products;
CREATE TRIGGER guard_bizinsight_stock_change
  BEFORE INSERT OR UPDATE OF stock_quantity ON public.products
  FOR EACH ROW EXECUTE FUNCTION private.guard_bizinsight_stock_change();

CREATE OR REPLACE FUNCTION private.capture_bizinsight_stock_movement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_before integer;
  v_after integer;
  v_delta integer;
  v_type text;
  v_created_by uuid;
  v_reference_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_before := 0;
    v_after := NEW.stock_quantity;
  ELSE
    v_before := OLD.stock_quantity;
    v_after := NEW.stock_quantity;
  END IF;

  v_delta := v_after - v_before;
  IF v_delta = 0 THEN
    RETURN NEW;
  END IF;

  v_type := COALESCE(
    NULLIF(current_setting('bizinsight.movement_type', true), ''),
    CASE WHEN TG_OP = 'INSERT' THEN 'opening' ELSE 'adjustment' END
  );

  v_created_by := NULLIF(current_setting('bizinsight.created_by', true), '')::uuid;
  v_reference_id := NULLIF(current_setting('bizinsight.reference_id', true), '')::uuid;

  INSERT INTO public.inventory_movements (
    product_id, movement_type, quantity_delta, quantity_before,
    quantity_after, reason, reference_type, reference_id, created_by
  )
  VALUES (
    NEW.id,
    v_type,
    v_delta,
    v_before,
    v_after,
    NULLIF(current_setting('bizinsight.movement_reason', true), ''),
    NULLIF(current_setting('bizinsight.reference_type', true), ''),
    v_reference_id,
    v_created_by
  );

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.capture_bizinsight_stock_movement() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS capture_bizinsight_stock_movement ON public.products;
CREATE TRIGGER capture_bizinsight_stock_movement
  AFTER INSERT OR UPDATE OF stock_quantity ON public.products
  FOR EACH ROW EXECUTE FUNCTION private.capture_bizinsight_stock_movement();

CREATE OR REPLACE FUNCTION public.record_bizinsight_stock_movement(
  p_product_id uuid,
  p_quantity_delta integer,
  p_reason text,
  p_created_by uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_product public.products%ROWTYPE;
  v_movement_id uuid;
BEGIN
  IF p_quantity_delta IS NULL OR p_quantity_delta = 0 THEN
    RAISE EXCEPTION 'Stock movement quantity must be a non-zero integer';
  END IF;
  IF NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'A reason is required for every stock movement';
  END IF;

  SELECT * INTO v_product
  FROM public.products
  WHERE id = p_product_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Product not found'; END IF;
  IF NOT v_product.is_active THEN RAISE EXCEPTION 'Inactive products cannot receive stock movements'; END IF;
  IF v_product.stock_quantity + p_quantity_delta < 0 THEN
    RAISE EXCEPTION 'Stock movement would make inventory negative';
  END IF;

  PERFORM set_config('bizinsight.allow_stock_change', 'true', true);
  PERFORM set_config('bizinsight.movement_type',
    CASE
      WHEN p_quantity_delta > 0 AND lower(btrim(p_reason)) LIKE 'opening stock%' THEN 'opening'
      WHEN p_quantity_delta > 0 THEN 'purchase'
      ELSE 'adjustment'
    END, true);
  PERFORM set_config('bizinsight.movement_reason', btrim(p_reason), true);
  PERFORM set_config('bizinsight.reference_type', '', true);
  PERFORM set_config('bizinsight.reference_id', '', true);
  PERFORM set_config('bizinsight.created_by', COALESCE(p_created_by::text, ''), true);

  UPDATE public.products
  SET stock_quantity = stock_quantity + p_quantity_delta,
      updated_at = now()
  WHERE id = p_product_id;

  SELECT m.id INTO v_movement_id
  FROM public.inventory_movements m
  WHERE m.product_id = p_product_id
  ORDER BY m.created_at DESC, m.id DESC
  LIMIT 1;

  RETURN v_movement_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_bizinsight_stock_movement(uuid, integer, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_bizinsight_stock_movement(uuid, integer, text, uuid)
  TO service_role;

-- Replace the original order RPC so sale movements are linked to their order.
DROP FUNCTION IF EXISTS public.create_bizinsight_order(text, uuid, jsonb, numeric, numeric, text);

CREATE OR REPLACE FUNCTION public.create_bizinsight_order(
  p_order_number text,
  p_customer_id uuid,
  p_items jsonb,
  p_tax_amount numeric DEFAULT 0,
  p_discount_amount numeric DEFAULT 0,
  p_status text DEFAULT 'pending',
  p_created_by uuid DEFAULT NULL
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
  IF v_tax < 0 OR v_discount < 0 THEN
    RAISE EXCEPTION 'Tax and discount cannot be negative';
  END IF;
  IF p_status NOT IN ('pending', 'processing', 'completed') THEN
    RAISE EXCEPTION 'New orders must be pending, processing, or completed';
  END IF;

  FOR v_item IN
    SELECT value FROM jsonb_array_elements(p_items)
    ORDER BY (value->>'product_id')
  LOOP
    v_quantity := (v_item->>'quantity')::integer;
    IF v_quantity <= 0 THEN RAISE EXCEPTION 'Quantity must be a positive integer'; END IF;

    SELECT * INTO v_product
    FROM public.products
    WHERE id = (v_item->>'product_id')::uuid
    FOR UPDATE;

    IF NOT FOUND THEN RAISE EXCEPTION 'Product not found'; END IF;
    IF NOT v_product.is_active THEN RAISE EXCEPTION 'Product is inactive'; END IF;
    IF v_product.stock_quantity < v_quantity THEN
      RAISE EXCEPTION 'Insufficient stock for product %', v_product.name;
    END IF;

    v_subtotal := v_subtotal + (v_product.price * v_quantity);
  END LOOP;

  IF p_customer_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.customers
    WHERE id = p_customer_id AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Customer not found or inactive';
  END IF;

  IF v_discount > v_subtotal + v_tax THEN
    RAISE EXCEPTION 'Discount cannot exceed subtotal plus tax';
  END IF;

  INSERT INTO public.orders (
    order_number, customer_id, status, subtotal, tax_amount,
    discount_amount, total_amount
  )
  VALUES (
    p_order_number, p_customer_id, p_status, v_subtotal, v_tax,
    v_discount, v_subtotal + v_tax - v_discount
  )
  RETURNING id INTO v_order_id;

  PERFORM set_config('bizinsight.allow_stock_change', 'true', true);
  PERFORM set_config('bizinsight.movement_type', 'sale', true);
  PERFORM set_config('bizinsight.movement_reason', 'Stock reserved for order', true);
  PERFORM set_config('bizinsight.reference_type', 'order', true);
  PERFORM set_config('bizinsight.reference_id', v_order_id::text, true);
  PERFORM set_config('bizinsight.created_by', COALESCE(p_created_by::text, ''), true);

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_quantity := (v_item->>'quantity')::integer;
    SELECT * INTO v_product
    FROM public.products
    WHERE id = (v_item->>'product_id')::uuid
    FOR UPDATE;

    UPDATE public.products
    SET stock_quantity = stock_quantity - v_quantity,
        updated_at = now()
    WHERE id = v_product.id;

    INSERT INTO public.order_items(order_id, product_id, quantity, unit_price)
    VALUES (v_order_id, v_product.id, v_quantity, v_product.price);
  END LOOP;

  RETURN v_order_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_bizinsight_order(text, uuid, jsonb, numeric, numeric, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_bizinsight_order(text, uuid, jsonb, numeric, numeric, text, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.set_bizinsight_order_status(
  p_order_id uuid,
  p_status text,
  p_reason text DEFAULT NULL,
  p_changed_by uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_item record;
BEGIN
  IF p_status NOT IN ('pending', 'processing', 'completed', 'cancelled') THEN
    RAISE EXCEPTION 'Invalid order status';
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF v_order.status = p_status THEN RETURN v_order.id; END IF;
  IF v_order.status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'Completed or cancelled orders cannot be reopened';
  END IF;
  IF v_order.status = 'pending' AND p_status NOT IN ('processing', 'completed', 'cancelled') THEN
    RAISE EXCEPTION 'Invalid transition from pending';
  END IF;
  IF v_order.status = 'processing' AND p_status NOT IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'Invalid transition from processing';
  END IF;

  IF p_status = 'cancelled' THEN
    PERFORM set_config('bizinsight.allow_stock_change', 'true', true);
    PERFORM set_config('bizinsight.movement_type', 'sale_reversal', true);
    PERFORM set_config('bizinsight.movement_reason',
      COALESCE(NULLIF(btrim(p_reason), ''), 'Stock restored after order cancellation'), true);
    PERFORM set_config('bizinsight.reference_type', 'order', true);
    PERFORM set_config('bizinsight.reference_id', v_order.id::text, true);
    PERFORM set_config('bizinsight.created_by', COALESCE(p_changed_by::text, ''), true);

    FOR v_item IN
      SELECT product_id, quantity
      FROM public.order_items
      WHERE order_id = v_order.id
      ORDER BY product_id
    LOOP
      UPDATE public.products
      SET stock_quantity = stock_quantity + v_item.quantity,
          updated_at = now()
      WHERE id = v_item.product_id;
    END LOOP;
  END IF;

  UPDATE public.orders
  SET status = p_status, updated_at = now()
  WHERE id = v_order.id;

  RETURN v_order.id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_bizinsight_order_status(uuid, text, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_bizinsight_order_status(uuid, text, text, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.admin_update_bizinsight_user_role(
  p_user_id uuid,
  p_role text
)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_admin_count integer;
BEGIN
  -- Serialize all role changes so two concurrent demotions cannot remove
  -- the last two administrators at the same time.
  PERFORM pg_advisory_xact_lock(hashtext('bizinsight-admin-role-change'));

  IF p_role NOT IN ('admin', 'staff') THEN
    RAISE EXCEPTION 'Role must be admin or staff';
  END IF;

  SELECT * INTO v_profile
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'User profile not found'; END IF;

  IF v_profile.role = 'admin' AND p_role = 'staff' THEN
    SELECT count(*) INTO v_admin_count
    FROM public.profiles
    WHERE role = 'admin';

    IF v_admin_count <= 1 THEN
      RAISE EXCEPTION 'The last administrator cannot be demoted';
    END IF;
  END IF;

  UPDATE public.profiles
  SET role = p_role, updated_at = now()
  WHERE id = p_user_id
  RETURNING * INTO v_profile;

  RETURN v_profile;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_bizinsight_user_role(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_bizinsight_user_role(uuid, text)
  TO service_role;


COMMIT;
