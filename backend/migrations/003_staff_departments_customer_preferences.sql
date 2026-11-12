BEGIN;

-- BizInsight Phase 1.1
-- Apply only after migration 002. This migration is committed for review and
-- is NOT applied to the connected Supabase project by this commit.

-- 1) Organization structure and role model
CREATE TABLE IF NOT EXISTS public.departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 80),
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS departments_name_lower_uidx
  ON public.departments (lower(name));

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES public.departments(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS designation text,
  ADD COLUMN IF NOT EXISTS manager_scope text,
  ADD COLUMN IF NOT EXISTS reports_to uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('admin', 'manager', 'staff'));
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_manager_scope_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_manager_scope_check
  CHECK (
    (role = 'manager' AND manager_scope IN ('company', 'department'))
    OR (role <> 'manager' AND manager_scope IS NULL)
  );
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_manager_assignment_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_manager_assignment_check
  CHECK (
    (role = 'manager' AND manager_scope = 'company'
      AND department_id IS NULL AND reports_to IS NULL)
    OR (role = 'manager' AND manager_scope = 'department'
      AND department_id IS NOT NULL AND reports_to IS NOT NULL AND reports_to <> id)
    OR role <> 'manager'
  );

CREATE UNIQUE INDEX IF NOT EXISTS profiles_one_company_manager_uidx
  ON public.profiles ((role))
  WHERE role = 'manager' AND manager_scope = 'company';
CREATE UNIQUE INDEX IF NOT EXISTS profiles_one_department_manager_uidx
  ON public.profiles (department_id)
  WHERE role = 'manager' AND manager_scope = 'department';
CREATE INDEX IF NOT EXISTS profiles_department_role_idx
  ON public.profiles(department_id, role);

-- 2) Preferences and compensation history
CREATE TABLE IF NOT EXISTS public.company_preferences (
  id boolean PRIMARY KEY DEFAULT true CHECK (id = true),
  management_mode text NOT NULL DEFAULT 'single_manager'
    CHECK (management_mode IN ('single_manager', 'manager_hierarchy')),
  frequent_customer_min_orders integer NOT NULL DEFAULT 5
    CHECK (frequent_customer_min_orders >= 2),
  high_value_customer_amount numeric(14,2) NOT NULL DEFAULT 50000
    CHECK (high_value_customer_amount > 0),
  currency_code text NOT NULL DEFAULT 'INR' CHECK (currency_code ~ '^[A-Z]{3}$'),
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.company_preferences(id) VALUES (true) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.employee_compensation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  base_salary numeric(14,2) NOT NULL CHECK (base_salary >= 0),
  currency_code text NOT NULL DEFAULT 'INR' CHECK (currency_code ~ '^[A-Z]{3}$'),
  pay_frequency text NOT NULL DEFAULT 'monthly'
    CHECK (pay_frequency IN ('hourly', 'weekly', 'monthly', 'yearly')),
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  effective_to date,
  notes text,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE UNIQUE INDEX IF NOT EXISTS employee_compensation_one_current_uidx
  ON public.employee_compensation(profile_id) WHERE effective_to IS NULL;
CREATE INDEX IF NOT EXISTS employee_compensation_profile_date_idx
  ON public.employee_compensation(profile_id, effective_from DESC);

-- 3) Customer qualification. Only an HMAC fingerprint is kept for buyers
-- who have not yet qualified. Their name/email/phone/address are not stored.
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS is_valuable boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS qualification_reason text,
  ADD COLUMN IF NOT EXISTS order_count integer NOT NULL DEFAULT 0
    CHECK (order_count >= 0),
  ADD COLUMN IF NOT EXISTS lifetime_value numeric(14,2) NOT NULL DEFAULT 0
    CHECK (lifetime_value >= 0);

CREATE TABLE IF NOT EXISTS private.customer_identity_keys (
  fingerprint text PRIMARY KEY CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  customer_id uuid REFERENCES public.customers(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS private.order_customer_identity (
  order_id uuid PRIMARY KEY REFERENCES public.orders(id) ON DELETE RESTRICT,
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT USAGE ON SCHEMA private TO service_role;
GRANT ALL ON TABLE private.customer_identity_keys, private.order_customer_identity TO service_role;

-- 4) Trusted authorization helpers. Definer functions remain in private schema.
CREATE OR REPLACE FUNCTION private.is_bizinsight_admin_or_staff()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = (SELECT auth.uid())
      AND p.role IN ('admin', 'manager', 'staff')
  );
$$;

CREATE OR REPLACE FUNCTION private.is_bizinsight_admin_or_manager()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = (SELECT auth.uid()) AND p.role IN ('admin', 'manager')
  );
$$;

CREATE OR REPLACE FUNCTION private.can_view_bizinsight_profile(p_target_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles actor
    JOIN public.profiles target ON target.id = p_target_id
    WHERE actor.id = (SELECT auth.uid())
      AND (
        actor.id = target.id
        OR actor.role = 'admin'
        OR (
          actor.role = 'manager'
          AND target.role <> 'admin'
          AND (
            actor.manager_scope = 'company'
            OR (actor.manager_scope = 'department'
                AND target.department_id = actor.department_id)
          )
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION private.can_view_employee_compensation(p_employee_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles actor
    JOIN public.profiles employee ON employee.id = p_employee_id
    WHERE actor.id = (SELECT auth.uid())
      AND (
        actor.role = 'admin'
        OR (
          actor.role = 'manager'
          AND employee.role <> 'admin'
          AND (
            actor.manager_scope = 'company'
            OR (actor.manager_scope = 'department'
                AND employee.department_id = actor.department_id)
          )
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION private.can_manage_bizinsight_department(p_department_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles actor
    WHERE actor.id = (SELECT auth.uid())
      AND (
        actor.role = 'admin'
        OR (actor.role = 'manager' AND (
          actor.manager_scope = 'company'
          OR actor.department_id = p_department_id
        ))
      )
  );
$$;

REVOKE ALL ON FUNCTION private.is_bizinsight_admin_or_staff() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.is_bizinsight_admin_or_manager() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.can_view_bizinsight_profile(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.can_view_employee_compensation(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.can_manage_bizinsight_department(uuid) FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_bizinsight_admin_or_staff() TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_bizinsight_admin_or_manager() TO authenticated;
GRANT EXECUTE ON FUNCTION private.can_view_bizinsight_profile(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.can_view_employee_compensation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.can_manage_bizinsight_department(uuid) TO authenticated;

-- 5) RLS and table grants
DROP POLICY IF EXISTS "Users read own profile and admins read all" ON public.profiles;
DROP POLICY IF EXISTS "Users read permitted BizInsight profiles" ON public.profiles;
CREATE POLICY "Users read permitted BizInsight profiles"
  ON public.profiles FOR SELECT TO authenticated
  USING ((SELECT private.can_view_bizinsight_profile(id)));

DROP POLICY IF EXISTS "Admins and staff manage customers" ON public.customers;
DROP POLICY IF EXISTS "Admins and managers read valuable customers" ON public.customers;
CREATE POLICY "Admins and managers read valuable customers"
  ON public.customers FOR SELECT TO authenticated
  USING (is_valuable = true AND (SELECT private.is_bizinsight_admin_or_manager()));
REVOKE INSERT, UPDATE, DELETE ON public.customers FROM authenticated;
GRANT SELECT ON public.customers TO authenticated;

ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.departments FROM anon, authenticated;
GRANT SELECT ON public.departments TO authenticated;
DROP POLICY IF EXISTS "Admins and managers read departments" ON public.departments;
CREATE POLICY "Admins and managers read departments"
  ON public.departments FOR SELECT TO authenticated
  USING ((SELECT private.is_bizinsight_admin_or_manager()));
DROP POLICY IF EXISTS "Admins and managers create departments" ON public.departments;
CREATE POLICY "Admins and managers create departments"
  ON public.departments FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.is_bizinsight_admin_or_manager()));
DROP POLICY IF EXISTS "Admins and managers update departments" ON public.departments;
CREATE POLICY "Admins and managers update departments"
  ON public.departments FOR UPDATE TO authenticated
  USING ((SELECT private.can_manage_bizinsight_department(id)))
  WITH CHECK ((SELECT private.can_manage_bizinsight_department(id)));

ALTER TABLE public.company_preferences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.company_preferences FROM anon, authenticated;
GRANT SELECT ON public.company_preferences TO authenticated;
DROP POLICY IF EXISTS "Admins and managers read company preferences" ON public.company_preferences;
CREATE POLICY "Admins and managers read company preferences"
  ON public.company_preferences FOR SELECT TO authenticated
  USING ((SELECT private.is_bizinsight_admin_or_manager()));

ALTER TABLE public.employee_compensation ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.employee_compensation FROM anon, authenticated;
GRANT SELECT ON public.employee_compensation TO authenticated;
DROP POLICY IF EXISTS "Managers see compensation in their scope" ON public.employee_compensation;
CREATE POLICY "Managers see compensation in their scope"
  ON public.employee_compensation FOR SELECT TO authenticated
  USING ((SELECT private.can_view_employee_compensation(profile_id)));

-- 6) Service-only RPCs for manager assignment, preferences and salary changes.
CREATE OR REPLACE FUNCTION public.admin_set_bizinsight_employee(
  p_actor_id uuid,
  p_employee_id uuid,
  p_role text,
  p_department_id uuid DEFAULT NULL,
  p_designation text DEFAULT NULL,
  p_manager_scope text DEFAULT NULL,
  p_reports_to uuid DEFAULT NULL
)
RETURNS public.profiles LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_actor public.profiles%ROWTYPE;
  v_employee public.profiles%ROWTYPE;
  v_company_manager_id uuid;
  v_mode text;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE id = p_actor_id;
  IF NOT FOUND OR v_actor.role NOT IN ('admin', 'manager') THEN
    RAISE EXCEPTION 'Only Admin or an authorized Manager may manage staff';
  END IF;
  IF p_role NOT IN ('manager', 'staff') THEN RAISE EXCEPTION 'Invalid employee role'; END IF;

  SELECT * INTO v_employee FROM public.profiles WHERE id = p_employee_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Employee profile not found'; END IF;
  IF v_employee.role = 'admin' THEN RAISE EXCEPTION 'Admin accounts cannot be managed here'; END IF;
  IF v_actor.role = 'manager' AND v_employee.role <> 'staff' THEN
    RAISE EXCEPTION 'Managers can manage Staff accounts only; Manager accounts are protected';
  END IF;

  IF v_actor.role = 'manager' THEN
    IF p_role <> 'staff' THEN RAISE EXCEPTION 'Only Admin can appoint Managers'; END IF;
    IF v_actor.manager_scope = 'department'
       AND p_department_id IS DISTINCT FROM v_actor.department_id THEN
      RAISE EXCEPTION 'Department Managers can manage staff only in their department';
    END IF;
  END IF;

  IF p_department_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.departments WHERE id = p_department_id AND is_active = true
  ) THEN RAISE EXCEPTION 'An active department is required'; END IF;

  IF p_role = 'manager' THEN
    IF v_actor.role <> 'admin' THEN RAISE EXCEPTION 'Only Admin can appoint Managers'; END IF;
    IF p_manager_scope NOT IN ('company', 'department') THEN RAISE EXCEPTION 'Invalid Manager scope'; END IF;
    SELECT management_mode INTO v_mode FROM public.company_preferences WHERE id = true;

    IF p_manager_scope = 'company' THEN
      IF p_department_id IS NOT NULL OR p_reports_to IS NOT NULL THEN
        RAISE EXCEPTION 'Company-wide Manager cannot have a department or reporting Manager';
      END IF;
    ELSE
      IF v_mode <> 'manager_hierarchy' THEN RAISE EXCEPTION 'Enable Manager hierarchy first'; END IF;
      SELECT id INTO v_company_manager_id FROM public.profiles
        WHERE role = 'manager' AND manager_scope = 'company' LIMIT 1;
      IF v_company_manager_id IS NULL OR v_company_manager_id = p_employee_id
         OR p_department_id IS NULL OR p_reports_to IS DISTINCT FROM v_company_manager_id THEN
        RAISE EXCEPTION 'Department Managers must report to the company-wide Manager and have a department';
      END IF;
    END IF;
  ELSE
    p_manager_scope := NULL;
    IF p_department_id IS NULL THEN RAISE EXCEPTION 'Assign General Staff to a department'; END IF;
    IF v_actor.role = 'manager' AND v_actor.manager_scope = 'department' THEN
      p_reports_to := v_actor.id;
    END IF;
  END IF;

  IF v_employee.role = 'manager' AND v_employee.manager_scope = 'company'
     AND p_role <> 'manager'
     AND EXISTS (SELECT 1 FROM public.profiles WHERE role = 'manager' AND manager_scope = 'department') THEN
    RAISE EXCEPTION 'Reassign Department Managers before removing the company-wide Manager';
  END IF;

  UPDATE public.profiles
  SET role = p_role, department_id = p_department_id,
      designation = NULLIF(btrim(COALESCE(p_designation, '')), ''),
      manager_scope = p_manager_scope, reports_to = p_reports_to, updated_at = now()
  WHERE id = p_employee_id RETURNING * INTO v_employee;
  RETURN v_employee;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_set_bizinsight_employee(uuid, uuid, text, uuid, text, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_bizinsight_employee(uuid, uuid, text, uuid, text, text, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.update_bizinsight_preferences(
  p_actor_id uuid,
  p_management_mode text DEFAULT NULL,
  p_frequent_customer_min_orders integer DEFAULT NULL,
  p_high_value_customer_amount numeric DEFAULT NULL
)
RETURNS public.company_preferences LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_actor public.profiles%ROWTYPE;
  v_result public.company_preferences%ROWTYPE;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE id = p_actor_id;
  IF NOT FOUND OR v_actor.role NOT IN ('admin', 'manager') THEN
    RAISE EXCEPTION 'Only Admin and Managers may update preferences';
  END IF;
  IF p_management_mode IS NOT NULL THEN
    IF v_actor.role <> 'admin' THEN RAISE EXCEPTION 'Only Admin can change management structure'; END IF;
    IF p_management_mode NOT IN ('single_manager', 'manager_hierarchy') THEN RAISE EXCEPTION 'Invalid management mode'; END IF;
    IF p_management_mode = 'single_manager' AND EXISTS (
      SELECT 1 FROM public.profiles WHERE role = 'manager' AND manager_scope = 'department'
    ) THEN RAISE EXCEPTION 'Reassign or remove Department Managers before switching to single-manager mode'; END IF;
  END IF;
  IF p_frequent_customer_min_orders IS NOT NULL AND p_frequent_customer_min_orders < 2 THEN
    RAISE EXCEPTION 'Frequent customer threshold must be at least 2';
  END IF;
  IF p_high_value_customer_amount IS NOT NULL AND p_high_value_customer_amount <= 0 THEN
    RAISE EXCEPTION 'High-value threshold must be greater than zero';
  END IF;

  UPDATE public.company_preferences
  SET management_mode = COALESCE(p_management_mode, management_mode),
      frequent_customer_min_orders = COALESCE(p_frequent_customer_min_orders, frequent_customer_min_orders),
      high_value_customer_amount = COALESCE(p_high_value_customer_amount, high_value_customer_amount),
      updated_by = p_actor_id, updated_at = now()
  WHERE id = true RETURNING * INTO v_result;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.update_bizinsight_preferences(uuid, text, integer, numeric)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_bizinsight_preferences(uuid, text, integer, numeric)
  TO service_role;

CREATE OR REPLACE FUNCTION public.set_bizinsight_employee_compensation(
  p_actor_id uuid,
  p_employee_id uuid,
  p_base_salary numeric,
  p_currency_code text DEFAULT 'INR',
  p_pay_frequency text DEFAULT 'monthly',
  p_effective_from date DEFAULT CURRENT_DATE,
  p_notes text DEFAULT NULL
)
RETURNS public.employee_compensation LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_actor public.profiles%ROWTYPE;
  v_employee public.profiles%ROWTYPE;
  v_current public.employee_compensation%ROWTYPE;
  v_result public.employee_compensation%ROWTYPE;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE id = p_actor_id;
  SELECT * INTO v_employee FROM public.profiles WHERE id = p_employee_id FOR UPDATE;
  IF v_actor.id IS NULL OR v_actor.role NOT IN ('admin', 'manager') THEN
    RAISE EXCEPTION 'Only Admin or Managers may manage compensation';
  END IF;
  IF v_employee.id IS NULL OR v_employee.role = 'admin' THEN
    RAISE EXCEPTION 'Administrator compensation cannot be managed through Staff Management';
  END IF;
  IF v_actor.role = 'manager' AND v_employee.role <> 'staff' THEN
    RAISE EXCEPTION 'Managers can manage Staff compensation only; Manager accounts are protected';
  END IF;
  IF v_actor.role = 'manager' AND v_actor.manager_scope = 'department'
     AND v_actor.department_id IS DISTINCT FROM v_employee.department_id THEN
    RAISE EXCEPTION 'Department Managers can manage compensation only for their department';
  END IF;
  IF p_base_salary IS NULL OR p_base_salary < 0 THEN RAISE EXCEPTION 'Invalid salary'; END IF;
  IF p_currency_code !~ '^[A-Z]{3}$' THEN RAISE EXCEPTION 'Invalid currency code'; END IF;
  IF p_pay_frequency NOT IN ('hourly', 'weekly', 'monthly', 'yearly') THEN RAISE EXCEPTION 'Invalid pay frequency'; END IF;

  SELECT * INTO v_current FROM public.employee_compensation
    WHERE profile_id = p_employee_id AND effective_to IS NULL FOR UPDATE;
  IF FOUND THEN
    IF p_effective_from <= v_current.effective_from THEN
      RAISE EXCEPTION 'New salary effective date must follow the current salary date';
    END IF;
    UPDATE public.employee_compensation
      SET effective_to = p_effective_from - 1 WHERE id = v_current.id;
  END IF;

  INSERT INTO public.employee_compensation(
    profile_id, base_salary, currency_code, pay_frequency, effective_from, notes, created_by
  ) VALUES (
    p_employee_id, p_base_salary, p_currency_code, p_pay_frequency,
    p_effective_from, NULLIF(btrim(COALESCE(p_notes, '')), ''), p_actor_id
  ) RETURNING * INTO v_result;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.set_bizinsight_employee_compensation(uuid, uuid, numeric, text, text, date, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_bizinsight_employee_compensation(uuid, uuid, numeric, text, text, date, text)
  TO service_role;

-- 7) Replace order creation RPC: retain customer PII only when qualification is met.
DROP FUNCTION IF EXISTS public.create_bizinsight_order(text, uuid, jsonb, numeric, numeric, text, uuid);
CREATE OR REPLACE FUNCTION public.create_bizinsight_order(
  p_order_number text,
  p_customer_id uuid,
  p_items jsonb,
  p_tax_amount numeric DEFAULT 0,
  p_discount_amount numeric DEFAULT 0,
  p_status text DEFAULT 'pending',
  p_created_by uuid DEFAULT NULL,
  p_customer_fingerprint text DEFAULT NULL,
  p_customer_name text DEFAULT NULL,
  p_customer_email text DEFAULT NULL,
  p_customer_phone text DEFAULT NULL,
  p_customer_address text DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_order_id uuid;
  v_subtotal numeric := 0;
  v_tax numeric := COALESCE(p_tax_amount, 0);
  v_discount numeric := COALESCE(p_discount_amount, 0);
  v_item jsonb;
  v_product public.products%ROWTYPE;
  v_quantity integer;
  v_customer_id uuid := p_customer_id;
  v_completed_count integer := 0;
  v_lifetime_value numeric := 0;
  v_min_orders integer;
  v_high_value numeric;
  v_reason text;
BEGIN
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'At least one order item is required';
  END IF;
  IF v_tax < 0 OR v_discount < 0 THEN RAISE EXCEPTION 'Tax and discount cannot be negative'; END IF;
  IF p_status NOT IN ('pending', 'processing', 'completed') THEN RAISE EXCEPTION 'Invalid initial order status'; END IF;
  IF p_customer_fingerprint IS NOT NULL AND p_customer_fingerprint !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid customer identity token';
  END IF;
  IF NULLIF(btrim(COALESCE(p_customer_name, '')), '') IS NOT NULL
     AND NULLIF(btrim(COALESCE(p_customer_email, '')), '') IS NULL
     AND NULLIF(btrim(COALESCE(p_customer_phone, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Customer phone or email is required';
  END IF;

  IF p_customer_fingerprint IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext(p_customer_fingerprint));
    IF v_customer_id IS NULL THEN
      SELECT customer_id INTO v_customer_id
      FROM private.customer_identity_keys
      WHERE fingerprint = p_customer_fingerprint FOR UPDATE;
    END IF;
  END IF;

  IF v_customer_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.customers
    WHERE id = v_customer_id AND is_active = true AND is_valuable = true
  ) THEN RAISE EXCEPTION 'Customer not found or not eligible for the valuable customer registry'; END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) ORDER BY (value->>'product_id')
  LOOP
    v_quantity := (v_item->>'quantity')::integer;
    IF v_quantity <= 0 THEN RAISE EXCEPTION 'Quantity must be positive'; END IF;
    SELECT * INTO v_product FROM public.products WHERE id = (v_item->>'product_id')::uuid FOR UPDATE;
    IF NOT FOUND OR NOT v_product.is_active THEN RAISE EXCEPTION 'Product not found or inactive'; END IF;
    IF v_product.stock_quantity < v_quantity THEN RAISE EXCEPTION 'Insufficient stock for %', v_product.name; END IF;
    v_subtotal := v_subtotal + (v_product.price * v_quantity);
  END LOOP;
  IF v_discount > v_subtotal + v_tax THEN RAISE EXCEPTION 'Discount exceeds order total'; END IF;

  INSERT INTO public.orders(
    order_number, customer_id, status, subtotal, tax_amount, discount_amount, total_amount
  ) VALUES (
    p_order_number, v_customer_id, p_status, v_subtotal, v_tax, v_discount, v_subtotal + v_tax - v_discount
  ) RETURNING id INTO v_order_id;

  IF p_customer_fingerprint IS NOT NULL THEN
    INSERT INTO private.order_customer_identity(order_id, fingerprint)
      VALUES (v_order_id, p_customer_fingerprint);
    INSERT INTO private.customer_identity_keys(fingerprint, customer_id)
      VALUES (p_customer_fingerprint, v_customer_id)
      ON CONFLICT (fingerprint) DO UPDATE
        SET customer_id = COALESCE(private.customer_identity_keys.customer_id, EXCLUDED.customer_id);
  END IF;

  PERFORM set_config('bizinsight.allow_stock_change', 'true', true);
  PERFORM set_config('bizinsight.movement_type', 'sale', true);
  PERFORM set_config('bizinsight.movement_reason', 'Stock reserved for order', true);
  PERFORM set_config('bizinsight.reference_type', 'order', true);
  PERFORM set_config('bizinsight.reference_id', v_order_id::text, true);
  PERFORM set_config('bizinsight.created_by', COALESCE(p_created_by::text, ''), true);

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_quantity := (v_item->>'quantity')::integer;
    SELECT * INTO v_product FROM public.products WHERE id = (v_item->>'product_id')::uuid FOR UPDATE;
    UPDATE public.products SET stock_quantity = stock_quantity - v_quantity, updated_at = now()
      WHERE id = v_product.id;
    INSERT INTO public.order_items(order_id, product_id, quantity, unit_price)
      VALUES (v_order_id, v_product.id, v_quantity, v_product.price);
  END LOOP;

  IF p_customer_fingerprint IS NOT NULL THEN
    SELECT count(*)::integer, COALESCE(sum(o.total_amount), 0)
      INTO v_completed_count, v_lifetime_value
    FROM public.orders o
    JOIN private.order_customer_identity oi ON oi.order_id = o.id
    WHERE oi.fingerprint = p_customer_fingerprint AND o.status <> 'cancelled';

    SELECT frequent_customer_min_orders, high_value_customer_amount
      INTO v_min_orders, v_high_value
    FROM public.company_preferences WHERE id = true;

    IF v_customer_id IS NULL
       AND (v_completed_count >= v_min_orders OR v_lifetime_value >= v_high_value)
       AND NULLIF(btrim(COALESCE(p_customer_name, '')), '') IS NOT NULL
       AND (NULLIF(btrim(COALESCE(p_customer_email, '')), '') IS NOT NULL
            OR NULLIF(btrim(COALESCE(p_customer_phone, '')), '') IS NOT NULL) THEN
      v_reason := CASE WHEN v_completed_count >= v_min_orders THEN 'frequent' ELSE 'high_value' END;
      INSERT INTO public.customers(
        name, email, phone, address, is_active, is_valuable,
        qualification_reason, order_count, lifetime_value
      ) VALUES (
        btrim(p_customer_name),
        NULLIF(lower(btrim(COALESCE(p_customer_email, ''))), ''),
        NULLIF(btrim(COALESCE(p_customer_phone, '')), ''),
        NULLIF(btrim(COALESCE(p_customer_address, '')), ''),
        true, true, v_reason, v_completed_count, v_lifetime_value
      ) RETURNING id INTO v_customer_id;

      UPDATE private.customer_identity_keys SET customer_id = v_customer_id
        WHERE fingerprint = p_customer_fingerprint;
      UPDATE public.orders o SET customer_id = v_customer_id
        FROM private.order_customer_identity oi
        WHERE oi.order_id = o.id AND oi.fingerprint = p_customer_fingerprint
          AND o.customer_id IS NULL;
    ELSIF v_customer_id IS NOT NULL THEN
      UPDATE public.customers
      SET order_count = v_completed_count,
          lifetime_value = v_lifetime_value,
          qualification_reason = CASE
            WHEN v_completed_count >= v_min_orders THEN 'frequent' ELSE 'high_value' END
      WHERE id = v_customer_id;
    END IF;
  END IF;

  RETURN v_order_id;
END;
$$;
REVOKE ALL ON FUNCTION public.create_bizinsight_order(text, uuid, jsonb, numeric, numeric, text, uuid, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_bizinsight_order(text, uuid, jsonb, numeric, numeric, text, uuid, text, text, text, text, text)
  TO service_role;

COMMIT;
