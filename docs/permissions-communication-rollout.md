# BizInsight permissions and communication rollout

## Scope

This change adds the authorization and communication foundation to the existing HTML/CSS/JavaScript + Express + Supabase application.

Attendance is intentionally out of scope for this phase. The primary/backup communicator can be switched manually by an authorized Manager or Admin until attendance is designed and verified later.

## Authorization model

1. Admin accounts are the authority root and bypass module permission checks.
2. Admin assigns effective module/action permissions to each Manager in `user_permissions`.
3. Admin separately creates `manager_delegations` records describing which exact permissions a Manager may grant and/or deactivate for Staff.
4. A Manager may grant or revoke only a permission with a matching active delegation, and only for Staff in their permitted department/company scope.
5. Managers cannot change another Manager's permissions, cannot change Admin permissions, and cannot create or alter delegation records.
6. Staff receive only explicit active `user_permissions` entries.
7. Revocation is soft-state: `is_active=false`; audit history remains in `permission_audit_logs`.
8. Backend route middleware checks module/action access. Frontend navigation and action controls are hidden from users without the corresponding permissions.

## Permission catalog

The seed catalog in migration 004 covers:
- Dashboard
- Inventory: view, create, update, stock movements, archive
- Sales & Orders: view, create, update
- Customers: view, create, update, archive
- Analytics
- Reports: view and export
- User Management: view, manage staff, compensation view/manage, department management
- Permission delegation: grant/revoke Staff access
- Communication: team messages, general announcements, work issues, complaints and primary/backup responsibility

Some operations are deliberately reserved for Admin/Manager accounts (e.g. staff administration and confidential complaint review). The API also checks the target user's role and department; hiding a control is not treated as security.

## Communication model

- Team messages are limited to the sender's department (except Admin and company-scope Managers).
- General announcements are separate, one-to-many operational notices. An authorized active primary/backup communicator can publish to selected departments.
- Team messages, general announcements and work issues create per-user notifications. The frontend refreshes unread notification counts periodically.
- Work issues have priority and lifecycle states; authorized Managers can assign an issue to a member of its department and update its status.
- Formal complaints are private and routed by role/department. The database RPC enforces a maximum of three complaints per submitter per calendar month (Asia/Kolkata).
- Complaint submitters can read their own records and private responses. Admin and explicitly authorized department Managers can review only the complaints routed to them.

## Database rollout prerequisites

Migration `004_permissions_communication.sql` depends on the existing `profiles` and `departments` organization structure from migration 003. Migration 003 itself documents that it must follow migration 002.

Rollout order:
1. Review and apply migration 002.
2. Review and apply migration 003.
3. Review and apply migration 004.
4. Run Supabase security advisors and verify the new tables have RLS enabled and no direct privileges for `anon` or `authenticated`.
5. Pull/deploy the application branch and test with separate Admin, Manager and Staff accounts.

**No Supabase migration has been applied by this change.** The migration is committed as a reviewable file only.

## Required test scenarios

- Admin sees all modules and can assign Manager permissions.
- Admin delegates Inventory view/create/update/stock movement separately from permission grant/revoke authority.
- Manager can grant only delegated actions to Staff in scope.
- Manager cannot change Admin or another Manager, or grant outside their delegation.
- Staff with Inventory view sees Inventory and inventory analytics, but not Dashboard, Orders, Customers, Reports or User Management unless separately granted.
- Direct API calls to ungranted modules/actions return 403.
- General announcement sent by the active communicator creates notifications for targeted departments.
- Backup communicator cannot publish until manually activated; switching back to primary is explicit.
- Complaint submission is limited to three per calendar month; submitter and authorized reviewer can read the appropriate private responses.
- Attendance and automatic absence detection remain unimplemented in this phase.
