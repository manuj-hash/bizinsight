# BizInsight User Management migration rollout

## Scope

`006_user_management_foundation.sql` is a forward-only foundation migration for the currently connected core schema. It adds:

- Departments and department assignment fields on employee profiles.
- Admin / Manager / Staff role support.
- One company-wide Manager, or a company-wide Manager with department Managers reporting to them.
- Company management preferences.
- Compensation history with one current record per employee.
- Database-side authorization helpers and restricted profile self-service updates.
- The three RPCs used by the Staff Management controller:
  - `admin_set_bizinsight_employee`
  - `update_bizinsight_preferences`
  - `set_bizinsight_employee_compensation`

It deliberately does **not** change customer qualification, customer identity, order creation, inventory lifecycle, permissions, or communication tables.

## Required rollout order

This migration is designed for the live baseline audited on 2026-11-12, where the core `profiles`, `products`, `customers`, and `orders` tables already exist and the profile role constraint currently allows Admin and Staff.

1. Back up the project database and verify the target project/environment.
2. Review and apply `006_user_management_foundation.sql`.
3. Apply `004_permissions_communication.sql` only after 006, because it references `departments`.
4. Apply `005_access_notifications.sql` only after 004, because it references `permission_catalog`.
5. Do not apply `003_staff_departments_customer_preferences.sql` from the older branch unchanged. It also modifies customer/order behavior and assumes schema that is not present in the audited live database. Customer/order qualification must be split into a separate, independently reviewed migration.

The numbered filenames reflect the repository's staged work, not the remote Supabase migration history. Confirm the actual remote migration ledger and use the project's established migration deployment process; do not blindly replay old migrations.

## Manager model

- **Single-manager mode:** one company-wide Manager oversees all departments.
- **Manager-hierarchy mode:** one company-wide Manager oversees department Managers; each department has at most one department Manager.
- Only Admin can appoint Managers or change the management mode.
- Department Managers can manage Staff only in their own department.
- Company-wide Managers can manage Staff across departments.
- Staff must be assigned to an active department.
- Department Managers must report to the company-wide Manager.
- The company-wide Manager cannot be removed while department Managers remain.

## Verification checklist

Run these checks in a non-production environment first:

1. Admin can create a department and invite Staff into it.
2. Admin can appoint one company-wide Manager.
3. A second company-wide Manager is rejected.
4. Single-manager mode rejects department Manager appointments.
5. After switching to manager-hierarchy mode, Admin can appoint one Manager per department, each reporting to the company-wide Manager.
6. A second Manager for the same department is rejected.
7. Department Manager A cannot invite, move, edit, or manage compensation for Staff in department B.
8. Company-wide Manager can manage Staff in all departments but cannot appoint Managers.
9. Staff cannot access employee-management endpoints.
10. Users cannot change their own role, department, manager scope, or reporting relationship through the Data API.
11. Compensation changes close the prior effective record and create one current record.
12. Switching back to single-manager mode is rejected until department Managers are removed.
13. Existing Admin and Staff accounts still authenticate. Existing Staff with no department must be assigned by Admin before they can use department-scoped features.

## Important deployment boundary

This commit changes repository files only. It does not apply SQL to Supabase, invite users, modify live employee records, or deploy the application. Obtain explicit approval before applying the migration to the live database.
