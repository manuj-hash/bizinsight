# BizInsight project baseline and working rules

## Product purpose
BizInsight is a Business Analytics & Decision Support System for small businesses and SMEs. It is not an inventory-only CRUD application. It should connect product/inventory operations, customers, sales/orders, business analytics, reporting, and decision support.

## Confirmed product modules
- Dashboard
- Inventory management
- Sales and orders
- Customer management
- Business analytics
- Reports and exports
- Stock movement/history
- Admin/staff user management
- Profile and settings

Future capabilities (not yet implemented): returns/refunds, payment lifecycle, demand forecasting, restock recommendations, and market insights.

## Technology decisions
- Frontend: existing HTML, CSS, vanilla JavaScript, Chart.js
- Backend: Node.js + Express
- Database and authentication: Supabase PostgreSQL + Supabase Auth
- Do not introduce MongoDB, Mongoose, or React without explicit agreement.

## Protected original baseline
The exact pre-improvement source is preserved on GitHub branch:
- `baseline/original-2026-11-11`
- Main baseline commit at start of work: `0b8a8248c69bcee85eda958fa48501b76168ae69`
- The working changes are isolated on `improvements/phase-1`. The original `main` branch remains unchanged until the draft PR is reviewed and explicitly merged.

Do not rewrite the baseline branch. All changes must be reviewable against it.

## Data and deployment safety
- Preserve historical orders and customer/product references.
- Prefer archive/deactivation over physical deletion.
- Stock changes must be represented by a ledger movement and applied atomically.
- Order cancellation must restore stock exactly once.
- Never commit `.env`, tokens, passwords, or Supabase secret/service-role keys.
- Never apply SQL migrations to the live Supabase project or alter live business data without the user's explicit approval.
- Do not deploy publicly without approval.

## Existing source layout at baseline
- `front-end/`: login, dashboard, inventory, analytics, reports, profile, signup and CSS
- `backend/`: Express server, Supabase configuration, auth middleware, controllers, routes and SQL migration
- Root `package.json` and lockfile are present; root package currently has dependencies inconsistent with the Supabase backend and must be rationalized.

## Audit findings at baseline
1. The shared publishable-key Supabase client validated bearer tokens but did not forward the user's bearer token to subsequent database requests. RLS-protected queries therefore did not execute in the user's authenticated context.
2. Auth Admin invitation was attempted with the publishable-key client, although it requires a server-side secret key.
3. Order creation calls a service_role-only SQL RPC with the ordinary publishable-key client.
4. Product updates accepted direct stock_quantity changes, bypassing any movement ledger.
5. Order cancellation/deletion did not restore stock or safely preserve history.
6. Product/customer physical deletion can conflict with historical order references.
7. Analytics reads entire tables without pagination and can hit the Supabase API row limit.
8. Several frontend pages hardcode http://localhost:3000/api rather than using same-origin /api.
9. Inventory frontend reads product.stock although the database field is stock_quantity.
10. Root package.json includes mongoose although the real backend uses Supabase.

## Change tracking
Every implementation phase must update `docs/CHANGELOG.md` with:
- baseline file(s)
- changed file(s)
- reason for change
- migration dependency
- verification performed
- remaining risks / follow-up
