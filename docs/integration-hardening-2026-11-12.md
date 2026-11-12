# BizInsight Integration Hardening — 2026-11-12

**Branch:** `fix/permission-boundary-and-integration`  
**Status:** Application changes committed; database migrations 006–008 are prepared but not yet applied.

## Application changes committed

- Employee list and Auth email mapping now paginate instead of silently stopping at the first 1,000 Auth users.
- Staff management page accepts either `staff.view` or `staff.manage`, matching the route behavior.
- Employee table now renders employee name, email, phone, role, department, designation, salary, and actions in the matching columns.
- Salary values and salary-edit actions are hidden unless the current user has the corresponding compensation permission; backend checks remain authoritative.
- Product archive is Admin-only, matching the existing database archive trigger.
- Product creation and updates use the trusted server-side database client after Express permission middleware authorizes the request.
- Product archive uses a dedicated RPC that verifies the actor is an Admin and preserves the database trigger's actor check.
- Stock movement and order create/status responses use server-side reads after their write RPCs, avoiding false failure responses when a user has write permission but not a separate read permission.
- Communication message and issue creation now call transactional RPCs so the record and recipient notifications commit together.
- Work issue creation validates that all selected departments are active.
- CI syntax workflow now includes the integration branch in its push filter.

## Database migrations prepared

### 006 — permission-aware RLS hardening

- Adds a reusable permission-check helper.
- Makes manager compensation reads require both the explicit compensation-view permission and allowed department/company scope.
- Restricts direct profile updates to `full_name` and `phone`.
- Replaces broad product/order/customer/inventory movement policies with permission-aware read/write policies.
- Makes order and customer tables read-only through the browser Data API; writes remain in trusted server workflows.
- Restricts product Data API inserts/updates to descriptive fields; stock and archive state cannot be changed directly.
- Adds a server-only Admin product archival RPC.
- Removes direct Data API access to department, company preference, and compensation tables.

### 007 — foreign-key supporting indexes

- Adds missing left-prefix indexes for foreign-key columns in public/private schemas.
- Preserves existing indexes and data.

### 008 — atomic communication notifications

- Adds server-only RPCs for message/issue creation and recipient notification insertion in one database transaction.

## Remaining verification

1. Apply migrations 006–008 to the connected Supabase project after explicit approval.
2. Verify grants, RLS policies, compensation scope, product stock/archival guards, and communication RPC grants.
3. Run Supabase Security and Performance Advisors again.
4. Confirm missing foreign-key index findings are cleared or explain any remaining items.
5. Enable leaked-password protection in Supabase Auth settings and test login/password change flows.
6. Run Admin, company Manager, department Manager, and Staff end-to-end tests with separate accounts.
7. Run CI syntax/dependency checks and browser-level smoke tests.
8. Test dashboard, inventory, orders, customers, analytics, reports, staff management, permissions, communication, complaints, and notifications against real records.

## Important rollout boundary

No production migration 006, 007, or 008 has been applied in this pass. No public deployment, account changes, or existing business-record deletions were performed. The existing Supabase data remains in place.
