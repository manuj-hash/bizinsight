BEGIN;

-- A Manager may view compensation only for Staff within the Manager's scope.
-- Admin retains visibility across all employee roles.
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
          AND employee.role = 'staff'
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

COMMIT;
