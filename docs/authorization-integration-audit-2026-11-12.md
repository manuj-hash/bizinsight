# BizInsight Authorization and Integration Audit

**Date:** 2026-11-12  
**Repository:** `manuj-hash/bizinsight`  
**Audited implementation:** `feature/permissions-communication`  
**Remediation branch:** `fix/permission-boundary-and-integration`

## Scope and method

Reviewed the implementation branch's migration files, authentication middleware, permission and staff controllers, communication controller, route middleware, and permission/communication frontend pages. Queried the connected Supabase project's migration history, live table inventory, RLS policies, grants, functions, profile roles, and Supabase advisors.

This is a static/source and live-schema audit. No migrations, SQL writes, application deployments, or production data changes were performed.

## Live database facts

- Project is active and healthy.
- Recorded migrations: `create_bizinsight_core_tables`, `allow_authenticated_product_access`, `secure_bizinsight_profiles_and_admin_access`, `move_admin_rls_helper_to_private_schema`, `optimize_profile_rls_auth_checks`, and `admin_staff_roles_atomic_order_creation`.
- Current public business tables: `profiles`, `products`, `customers`, `orders`, and `order_items`.
- Two profile rows currently have the `admin` role.
- `inventory_movements`, `departments`, `permission_catalog`, and communication tables do not exist in the live database.
- Live `create_bizinsight_order` still has the older six-argument signature. The stock-movement and order-status RPCs are absent.
- No Supabase development branches currently exist.

## Findings

### Critical: module permissions are not consistently enforced at the database boundary

The Express routes check `user_permissions`, but existing RLS policies on business tables are role-oriented. The implementation's later organization migration expands the shared employee helper to include Admin, Manager, and Staff; it does not replace every existing business-table policy with permission-aware checks.

A signed-in user who can obtain a valid access token and the public Supabase API endpoint may call the Data API directly, bypassing Express route permission checks. The remediation must align RLS/table grants with the permission catalog, or make the relevant data server-only and route every operation through explicitly authorized server code.

### High: compensation RLS ignores the separate compensation-view permission

Migration 003 grants authenticated users SELECT on `employee_compensation` and its RLS helper permits managers to read compensation within their management scope. That policy does not check `staff.compensation.view`. The Express staff controller does check that permission, but direct Data API access can bypass the controller.

### High: inventory archive permission conflicts with the database trigger

Migration 004's permission catalog includes `inventory.archive`, and the product route accepts that permission. Migration 002's `guard_bizinsight_archive` trigger, however, allows archive/reactivation only for Admin. A non-Admin user granted `inventory.archive` will pass the API permission check but fail at the database trigger. Decide whether archive is Admin-only or permission-delegable, then align catalog, UI, route, trigger, and tests.

### High: live database and implementation branch are not yet compatible

The branch's order controller sends the expanded customer-recognition arguments introduced by migration 003. The live RPC still has the old six-argument signature. The branch also calls stock movement and order-status RPCs that do not exist in the live database. Inventory history and order lifecycle operations therefore cannot be considered ready on the current live schema.

### Medium: message/issue creation and notification insertion are not atomic

Communication controllers insert the message or issue, then separately fetch recipients and insert notifications. If the notification step fails, the primary record remains committed while the API returns an error. A retry can create duplicate messages/issues. Move these multi-step writes into transactional database RPCs or add idempotency and clear partial-success handling.

### Medium: Staff Management UI permission mismatch

The frontend exposes the Staff page when a user has either `staff.view` or `staff.manage`, but the page access map and GET `/api/staff` route require `staff.view`. A Manager granted only `staff.manage` can see a link but cannot load the page/data. Define whether manage implies list access or require both permissions consistently.

### Medium: rollout documentation is stale

The rollout document refers to an expected migration filename `002_order_lifecycle_and_stock_movements.sql`, while the implementation branch contains `002_inventory_ledger_order_lifecycle.sql`. The actual applied baseline migration is separately recorded as `admin_staff_roles_atomic_order_creation`. Update the rollout instructions to use exact filenames and verified prerequisites.

### Low: Auth security recommendation

Supabase Security Advisor reports leaked-password protection disabled. Enable it after reviewing the Auth configuration and testing sign-in flows.

### Informational: unused indexes

The Performance Advisor reports four unused indexes on the early-stage database: `products_category_idx`, `customers_email_idx`, `orders_customer_id_idx`, and `orders_status_idx`. Do not drop them based only on current low usage; reassess after representative workload testing.

## Safe rollout order

1. Reconcile the recorded baseline migrations with the exact SQL files in GitHub.
2. Validate migration 002 against the current schema and data.
3. Validate migration 003's role hierarchy, employee assignment, customer qualification, privacy, and compensation behavior.
4. Validate migration 004's permission delegation and communication behavior.
5. Add a permission-aware RLS/table-grant hardening migration and resolve the archive-policy conflict.
6. Make communication writes transactional/idempotent and fix frontend permission mismatches.
7. Test with separate Admin, company-wide Manager, department Manager, and Staff accounts.
8. Apply reviewed migrations to a development database first; only then plan production rollout.

## Required test matrix

- Admin can manage all modules and appoint Managers.
- Company-wide Manager can manage permitted departments but cannot alter Admin accounts or appoint other Managers.
- Department Manager can manage only employees and records within the assigned department.
- Staff can access only explicitly granted modules and actions.
- Direct Supabase Data API requests cannot bypass module permissions.
- Compensation cannot be read without `staff.compensation.view`.
- Archive behavior is identical across catalog, UI, API, and database enforcement.
- Inventory stock changes always create a ledger entry and cannot create negative stock.
- Order creation and cancellation update stock exactly once and preserve order history.
- Communication message/issue creation and notifications succeed or fail as one logical operation.
- Complaints remain private and are visible only to the submitter and authorized reviewer.
- Frontend navigation visibility matches backend authorization.
