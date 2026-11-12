# BizInsight Integration Hardening — 2026-11-12

**Branch:** `fix/permission-boundary-and-integration`  
**Status:** Database migrations 006–009 are applied and verified; branch syntax/dependency workflow passed for the latest code commit.

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

## Database rollout and verification completed

- Migrations 006, 007, 008, and 009 are recorded in Supabase migration history.
- RLS is enabled on the core business tables.
- Direct Data API access to sensitive department, compensation, and company preference tables is revoked from anon/authenticated; Express uses the server-side client.
- Direct authenticated writes to products, orders, order items, customers, and inventory ledger are revoked. Product, order, customer and stock mutations stay in controlled backend workflows.
- Profile self-update is limited to full_name and phone; role, department and manager scope cannot be changed through the browser Data API.
- The three new server RPCs (product archive, communication message, work issue) are executable by service_role only.
- The database query found zero remaining unindexed foreign keys.
- Inventory ledger matches current stock for both products; the one order's subtotal matches its line-item total.
- RLS simulation: the Staff profile sees only its own profile and zero products/orders/customers without assigned permissions; Admin sees 2 products, 1 order and all 3 profiles.
- Existing row counts remain: profiles 3, products 2, inventory movements 1, orders 1, order items 1, customers 0, departments 0, messages 0, issues 0, communication notifications 0.
- GitHub Actions syntax check, npm ci and production dependency audit passed for commit `6f932ea`.

## Remaining verification

1. Enable leaked-password protection in Supabase Auth settings and test login/password change flows.
2. Run real sign-in/API tests for Admin and Staff. No Manager profile currently exists, so company-Manager and department-Manager workflows need a dedicated test account before they can be verified end-to-end.
3. Run browser-level smoke tests for dashboard, inventory, orders, customers, analytics, reports, staff management, permissions, communication, complaints and notifications.
4. Review 11 Supabase INFO findings for RLS-enabled server-only tables with no policies. These tables intentionally have no anon/authenticated grants and are accessed by the trusted service-role backend only.
5. Reassess unused-index INFO findings after the application has real query traffic; do not remove indexes based only on a low-traffic advisor snapshot.


## Important rollout boundary

No production migration 006, 007, or 008 has been applied in this pass. No public deployment, account changes, or existing business-record deletions were performed. The existing Supabase data remains in place.
