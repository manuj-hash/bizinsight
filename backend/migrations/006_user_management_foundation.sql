BEGIN;

-- BizInsight User Management foundation.
-- Forward-only repair for the connected database baseline.
-- Deliberately excludes customer qualification/order RPC changes and permissions/communication tables.
-- Apply after reviewing the live schema and before the permissions/communication migration.

-- 1. Organization structure.
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

-- Existing Admin/Staff rows remain valid. Existing Staff without a department
-- must be assigned by an Admin before being treated as active department staff.
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
    OR (role <> 'manager' AND manager_scope IS NULL)
  );

CREATE UNIQUE INDEX IF NOT EXISTS profiles_one_company_manager_uidx
  ON public.profiles ((role))
  WHERE role = 'manager' AND manager_scope = 'company';
CREATE UNIQUE INDEX IF NOT EXISTS profiles_one_department_manager_uidx
  ON public.profiles (department_id)
  WHERE role = 'manager' AND manager_scope = 'department';
CREATE INDEX IF NOT EXISTS profiles_department_role_idx
  ON public.profiles(department_id, role);

-- 2. Company preferences and compensation history.
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

-- 3. Authorization helpers. SECURITY DEFINER helpers expose only boolean decisions.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.is_bizinsight_admin_or_manager()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = (SELECT auth.uid()) AND p.role IN ('admin', 'manager')
  );
$$;

CREATE OR REPLACE FUNCTION private.can_manage_bizinsight_department(p_department_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
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

CREATE OR REPLACE FUNCTION private.can_view_employee_compensation(p_employee_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
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

REVOKE ALL ON FUNCTION private.is_bizinsight_admin_or_manager() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.can_manage_bizinsight_department(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.can_view_employee_compensation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.is_bizinsight_admin_or_manager() TO authenticated;
GRANT EXECUTE ON FUNCTION private.can_manage_bizinsight_department(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.can_view_employee_compensation(uuid) TO authenticated;

-- 4. Restrict profile self-service updates to non-privileged identity fields.
-- This prevents users from changing their own role or manager assignment via the Data API.
REVOKE UPDATE ON TABLE public.profiles FROM anon, authenticated;
GRANT UPDATE (full_name, phone) ON TABLE public.profiles TO authenticated;

-- 5. RLS and grants for the new tables.
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.departments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.departments TO authenticated;
GRANT ALL ON TABLE public.departments TO service_role;
DROP POLICY IF EXISTS "Admins and managers read departments" ON public.departments;
CREATE POLICY "Admins and managers read departments"
  ON public.departments FOR SELECT TO authenticated
  USING ((SELECT private.is_bizinsight_admin_or_manager()));

ALTER TABLE public.company_preferences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.company_preferences FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.company_preferences TO authenticated;
GRANT ALL ON TABLE public.company_preferences TO service_role;
DROP POLICY IF EXISTS "Admins and managers read company preferences" ON public.company_preferences;
CREATE POLICY "Admins and managers read company preferences"
  ON public.company_preferences FOR SELECT TO authenticated
  USING ((SELECT private.is_bizinsight_admin_or_manager()));

ALTER TABLE public.employee_compensation ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.employee_compensation FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.employee_compensation TO authenticated;
GRANT ALL ON TABLE public.employee_compensation TO service_role;
DROP POLICY IF EXISTS "Managers see compensation in their scope" ON public.employee_compensation;
CREATE POLICY "Managers see compensation in their scope"
  ON public.employee_compensation FOR SELECT TO authenticated
  USING ((SELECT private.can_view_employee_compensation(profile_id)));

-- Keep the existing updated_at trigger function used by the live core schema.
DROP TRIGGER IF EXISTS departments_set_updated_at ON public.departments;
CREATE TRIGGER departments_set_updated_at
  BEFORE UPDATE ON public.departments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 6. Atomic employee assignment RPC.
CREATE OR REPLACE FUNCTION public.admin_set_bizinsight_employee(
  p_actor_id uuid,
  p_employee_id uuid,
  p_role text,
  p_department_id uuid DEFAULT NULL,
  p_designation text DEFAULT NULL,
  p_manager_scope text DEFAULT NULL,
  p_reports_to uuid DEFAULT NULL
)
RETURNS public.profiles
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_actor public.profiles%ROWTYPE;
  v_employee public.profiles%ROWTYPE;
  v_company_manager_id uuid;
  v_mode text;
BEGIN
  IF p_actor_id IS NULL OR p_employee_id IS NULL OR p_role IS NULL THEN
    RAISE EXCEPTION 'Actor, employee and role are required';
  END IF;
  IF p_actor_id = p_employee_id THEN
    RAISE EXCEPTION 'You cannot change your own employee role or assignment';
  END IF;

  SELECT * INTO v_actor FROM public.profiles WHERE id = p_actor_id;
  IF NOT FOUND OR v_actor.role NOT IN ('admin', 'manager') THEN
    RAISE EXCEPTION 'Only Admin or an authorized Manager may manage staff';
  END IF;
  IF p_role NOT IN ('manager', 'staff') THEN
    RAISE EXCEPTION 'Invalid employee role';
  END IF;

  SELECT * INTO v_employee FROM public.profiles WHERE id = p_employee_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Employee profile not found'; END IF;
  IF v_employee.role = 'admin' THEN
    RAISE EXCEPTION 'Admin accounts cannot be managed here';
  END IF;

  IF v_actor.role = 'manager' THEN
    IF p_role <> 'staff' THEN
      RAISE EXCEPTION 'Only Admin can appoint Managers';
    END IF;
    IF v_actor.manager_scope = 'department'
       AND p_department_id IS DISTINCT FROM v_actor.department_id THEN
      RAISE EXCEPTION 'Department Managers can manage staff only in their department';
    END IF;
    IF v_actor.manager_scope NOT IN ('company', 'department') THEN
      RAISE EXCEPTION 'Manager account has no valid management scope';
    END IF;
  END IF;

  IF p_department_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.departments WHERE id = p_department_id AND is_active = true
  ) THEN
    RAISE EXCEPTION 'An active department is required';
  END IF;

  IF p_role = 'manager' THEN
    IF v_actor.role <> 'admin' THEN RAISE EXCEPTION 'Only Admin can appoint Managers'; END IF;
    IF p_manager_scope IS NULL OR p_manager_scope NOT IN ('company', 'department') THEN
      RAISE EXCEPTION 'Select a valid Manager scope';
    END IF;
    SELECT management_mode INTO v_mode FROM public.company_preferences WHERE id = true;

    IF p_manager_scope = 'company' THEN
      IF p_department_id IS NOT NULL OR p_reports_to IS NOT NULL THEN
        RAISE EXCEPTION 'Company-wide Manager cannot have a department or reporting Manager';
      END IF;
    ELSE
      IF v_mode <> 'manager_hierarchy' THEN
        RAISE EXCEPTION 'Enable Manager hierarchy first';
      END IF;
      SELECT id INTO v_company_manager_id
        FROM public.profiles
        WHERE role = 'manager' AND manager_scope = 'company'
        LIMIT 1;
      IF v_company_manager_id IS NULL OR v_company_manager_id = p_employee_id
         OR p_department_id IS NULL OR p_reports_to IS DISTINCT FROM v_company_manager_id THEN
        RAISE EXCEPTION 'Department Managers must report to the company-wide Manager and have a department';
      END IF;
    END IF;
  ELSE
    p_manager_scope := NULL;
    IF p_department_id IS NULL THEN
      RAISE EXCEPTION 'Assign every Staff member to a department';
    END IF;
    IF v_actor.role = 'manager' AND v_actor.manager_scope = 'department' THEN
      p_reports_to := v_actor.id;
    END IF;
  END IF;

  IF v_employee.role = 'manager' AND v_employee.manager_scope = 'company'
     AND p_role <> 'manager'
     AND EXISTS (
       SELECT 1 FROM public.profiles
       WHERE role = 'manager' AND manager_scope = 'department'
     ) THEN
    RAISE EXCEPTION 'Reassign Department Managers before removing the company-wide Manager';
  END IF;

  UPDATE public.profiles
  SET role = p_role,
      department_id = p_department_id,
      designation = NULLIF(btrim(COALESCE(p_designation, '')), ''),
      manager_scope = p_manager_scope,
      reports_to = p_reports_to,
      updated_at = now()
  WHERE id = p_employee_id
  RETURNING * INTO v_employee;

  RETURN v_employee;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_set_bizinsight_employee(uuid, uuid, text, uuid, text, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_bizinsight_employee(uuid, uuid, text, uuid, text, text, uuid)
  TO service_role;

-- 7. Atomic company preferences update.
CREATE OR REPLACE FUNCTION public.update_bizinsight_preferences(
  p_actor_id uuid,
  p_management_mode text DEFAULT NULL,
  p_frequent_customer_min_orders integer DEFAULT NULL,
  p_high_value_customer_amount numeric DEFAULT NULL
)
RETURNS public.company_preferences
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
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
    IF v_actor.role <> 'admin' THEN
      RAISE EXCEPTION 'Only Admin can change management structure';
    END IF;
    IF p_management_mode NOT IN ('single_manager', 'manager_hierarchy') THEN
      RAISE EXCEPTION 'Invalid management mode';
    END IF;
    IF p_management_mode = 'single_manager' AND EXISTS (
      SELECT 1 FROM public.profiles WHERE role = 'manager' AND manager_scope = 'department'
    ) THEN
      RAISE EXCEPTION 'Reassign or remove Department Managers before switching to single-manager mode';
    END IF;
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
      updated_by = p_actor_id,
      updated_at = now()
  WHERE id = true
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.update_bizinsight_preferences(uuid, text, integer, numeric)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_bizinsight_preferences(uuid, text, integer, numeric)
  TO service_role;

-- 8. Atomic compensation history update.
CREATE OR REPLACE FUNCTION public.set_bizinsight_employee_compensation(
  p_actor_id uuid,
  p_employee_id uuid,
  p_base_salary numeric,
  p_currency_code text DEFAULT 'INR',
  p_pay_frequency text DEFAULT 'monthly',
  p_effective_from date DEFAULT CURRENT_DATE,
  p_notes text DEFAULT NULL
)
RETURNS public.employee_compensation
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
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
  IF v_actor.role = 'manager' AND (
    v_actor.manager_scope NOT IN ('company', 'department')
    OR (v_actor.manager_scope = 'department'
        AND v_actor.department_id IS DISTINCT FROM v_employee.department_id)
  ) THEN
    RAISE EXCEPTION 'Managers can manage compensation only within their authorized scope';
  END IF;
  IF p_base_salary IS NULL OR p_base_salary < 0 THEN RAISE EXCEPTION 'Invalid salary'; END IF;
  IF p_currency_code IS NULL OR p_currency_code !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION 'Invalid currency code';
  END IF;
  IF p_pay_frequency NOT IN ('hourly', 'weekly', 'monthly', 'yearly') THEN
    RAISE EXCEPTION 'Invalid pay frequency';
  END IF;

  SELECT * INTO v_current FROM public.employee_compensation
    WHERE profile_id = p_employee_id AND effective_to IS NULL FOR UPDATE;
  IF FOUND THEN
    IF p_effective_from <= v_current.effective_from THEN
      RAISE EXCEPTION 'New salary effective date must follow the current salary date';
    END IF;
    UPDATE public.employee_compensation
      SET effective_to = p_effective_from - 1
      WHERE id = v_current.id;
  END IF;

  INSERT INTO public.employee_compensation(
    profile_id, base_salary, currency_code, pay_frequency,
    effective_from, notes, created_by
  ) VALUES (
    p_employee_id, p_base_salary, p_currency_code, p_pay_frequency,
    p_effective_from, NULLIF(btrim(COALESCE(p_notes, '')), ''), p_actor_id
  )
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.set_bizinsight_employee_compensation(uuid, uuid, numeric, text, text, date, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_bizinsight_employee_compensation(uuid, uuid, numeric, text, text, date, text)
  TO service_role;

COMMIT;
