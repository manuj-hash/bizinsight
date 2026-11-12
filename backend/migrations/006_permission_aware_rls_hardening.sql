-- Permission-aware Data API hardening for BizInsight.
-- Backend privileged operations remain behind Express authorization checks.
-- Browser clients retain only the minimum direct access needed for profile,
-- product and analytics reads.

BEGIN;

CREATE OR REPLACE FUNCTION private.has_bizinsight_permission(p_permission_code text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles actor
    WHERE actor.id = (SELECT auth.uid())
      AND actor.role = 'admin'
  )
  OR EXISTS (
    SELECT 1
    FROM public.user_permissions assigned
    JOIN public.permission_catalog catalog
      ON catalog.code = assigned.permission_code
    WHERE assigned.user_id = (SELECT auth.uid())
      AND assigned.permission_code = p_permission_code
      AND assigned.is_active = true
      AND catalog.is_active = true
  );
$function$;

REVOKE ALL ON FUNCTION private.has_bizinsight_permission(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.has_bizinsight_permission(text) TO authenticated, service_role;

-- Compensation is sensitive: managers must have both the explicit permission
-- and an allowed management scope. Admin retains full access.
CREATE OR REPLACE FUNCTION private.can_view_employee_compensation(p_employee_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
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
            OR (
              actor.manager_scope = 'department'
              AND employee.department_id = actor.department_id
            )
          )
          AND private.has_bizinsight_permission('staff.compensation.view')
        )
      )
  );
$function$;

REVOKE ALL ON FUNCTION private.can_view_employee_compensation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.can_view_employee_compensation(uuid) TO authenticated, service_role;

-- Never allow anonymous access to company records.
REVOKE ALL ON TABLE
  public.profiles,
  public.products,
  public.customers,
  public.orders,
  public.order_items,
  public.inventory_movements,
  public.departments,
  public.company_preferences,
  public.employee_compensation
FROM anon;

-- Profile self-service may update only ordinary contact fields. In particular,
-- role, department, manager_scope and reports_to are not client-editable.
REVOKE UPDATE ON public.profiles FROM authenticated;
REVOKE INSERT, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.profiles FROM authenticated;
GRANT SELECT ON public.profiles TO authenticated;
GRANT UPDATE (full_name, phone) ON public.profiles TO authenticated;

-- Product CRUD remains available through the authenticated Data API, but each
-- operation now requires its matching module permission.
DROP POLICY IF EXISTS "Admins and staff manage products" ON public.products;
CREATE POLICY "Permissioned users read products"
  ON public.products FOR SELECT TO authenticated
  USING (
    private.has_bizinsight_permission('inventory.view')
    OR private.has_bizinsight_permission('orders.view')
    OR private.has_bizinsight_permission('orders.create')
    OR private.has_bizinsight_permission('reports.view')
  );
CREATE POLICY "Permissioned users create products"
  ON public.products FOR INSERT TO authenticated
  WITH CHECK (private.has_bizinsight_permission('inventory.create'));
CREATE POLICY "Permissioned users update products"
  ON public.products FOR UPDATE TO authenticated
  USING (private.has_bizinsight_permission('inventory.update'))
  WITH CHECK (private.has_bizinsight_permission('inventory.update'));

GRANT SELECT, INSERT, UPDATE ON public.products TO authenticated;
REVOKE DELETE ON public.products FROM authenticated;

-- Orders and line items are read-only through the Data API. All order writes
-- must go through the atomic, server-side order lifecycle RPCs.
DROP POLICY IF EXISTS "Admins and staff manage orders" ON public.orders;
CREATE POLICY "Permissioned users read orders"
  ON public.orders FOR SELECT TO authenticated
  USING (
    private.has_bizinsight_permission('orders.view')
    OR private.has_bizinsight_permission('reports.view')
  );
DROP POLICY IF EXISTS "Admins and staff manage order items" ON public.order_items;
CREATE POLICY "Permissioned users read order items"
  ON public.order_items FOR SELECT TO authenticated
  USING (
    private.has_bizinsight_permission('orders.view')
    OR private.has_bizinsight_permission('reports.view')
  );

GRANT SELECT ON public.orders, public.order_items TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.orders, public.order_items FROM authenticated;

-- Customer registry is read-only through the Data API; customer recognition
-- and qualification are handled by the atomic order workflow.
DROP POLICY IF EXISTS "Admins and managers read valuable customers" ON public.customers;
CREATE POLICY "Permissioned users read valuable customers"
  ON public.customers FOR SELECT TO authenticated
  USING (
    is_valuable = true
    AND (
      private.has_bizinsight_permission('customers.view')
      OR private.has_bizinsight_permission('orders.view')
      OR private.has_bizinsight_permission('reports.view')
    )
  );
GRANT SELECT ON public.customers TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.customers FROM authenticated;

-- Inventory history is visible only to users with inventory-view access.
DROP POLICY IF EXISTS "Staff and admins read inventory movements" ON public.inventory_movements;
CREATE POLICY "Permissioned users read inventory movements"
  ON public.inventory_movements FOR SELECT TO authenticated
  USING (private.has_bizinsight_permission('inventory.view'));
GRANT SELECT ON public.inventory_movements TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.inventory_movements FROM authenticated;

-- Sensitive management data is served only through Express controllers,
-- which apply actor, scope and permission checks before using service_role.
REVOKE ALL ON TABLE
  public.departments,
  public.company_preferences,
  public.employee_compensation
FROM anon, authenticated;

COMMIT;
