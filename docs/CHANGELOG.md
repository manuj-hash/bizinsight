# BizInsight change log

## 2026-11-11 — Phase 1 implementation

Baseline preserved at `baseline/original-2026-11-11`. Working changes isolated at `improvements/phase-1`. The original `main` branch remains untouched by this phase.

### Product scope implemented or scaffolded
- Retained the existing HTML/CSS/vanilla-JavaScript + Node/Express + Supabase stack.
- Added dedicated Sales & Orders, Customers and administrator User Management pages.
- Rebuilt Inventory around the database's real `stock_quantity` field and added recent stock-movement history.
- Added editable profile details and a verified current-password change flow.
- Added Sales & Orders navigation to the existing application modules.

### Backend files changed
- `backend/config/supabase.js`: split public auth client, per-request authenticated client factory, and server-only admin client.
- `backend/middleware/authMiddleware.js`: validate bearer token, load trusted role, attach `req.supabase` with caller JWT for RLS.
- `backend/controllers/authController.js`: authenticated profile lookup and server-only Auth Admin invitations.
- `backend/controllers/productController.js`: reject direct stock edits, use audited movement RPC for opening stock, archive products rather than hard-delete.
- `backend/controllers/orderController.js`: use service-role RPC for order creation/status changes; cancellation restores stock; physical order deletion disabled.
- `backend/controllers/customerController.js`: archive customers rather than hard-delete; active customer list.
- `backend/controllers/analyticsController.js`: paginate table reads, calculate month boundaries in the configured business timezone, and distinguish inventory cost valuation from potential retail value.
- `backend/controllers/userController.js`: use service-role role-change RPC, add last-admin-safe role update and verified password update.
- Added `backend/controllers/inventoryMovementController.js` and `backend/routes/inventoryMovementRoutes.js`.
- `backend/server.js`: mount inventory movement API, restrict cross-origin requests to configured origins, and parse PORT as a numeric TCP port.
- `backend/routes/userRoutes.js`: add password update route.
- Added `backend/.env.example` (including BUSINESS_TIME_ZONE) and replaced temporary backend update notes with setup/security documentation.

### Frontend files changed
- Login now stores access tokens in tab-scoped session storage and clears legacy persistent tokens.
- Dashboard, Analytics, Reports and Profile use same-origin `/api` paths instead of hardcoded localhost URLs.
- Inventory UI now uses `stock_quantity`, stock movement reasons, archive behavior and stock history.
- Added `front-end/orders.html`, `front-end/customers.html` and `front-end/users.html`.
- Updated module navigation and shared responsive styles.
- Profile page now supports profile editing and password change.

### Database proposal (not applied)
- Added `backend/migrations/002_inventory_ledger_order_lifecycle.sql`.
- Includes stock movement ledger, guarded stock updates, atomic order cancellation/restock, customer archive flag, last-admin-safe role changes, prevention of profile self-promotion, and restrictions on hard deletion/direct order mutation.
- **This migration has NOT been applied to the live Supabase project.** New inventory movement, archive, order lifecycle and role-change endpoints depend on this migration. User approval and backup are required before applying it.

### Project documentation and tooling
- Added `docs/PROJECT_BASELINE.md` and this changelog.
- Removed unused MongoDB/Mongoose root dependencies; root scripts delegate to the Supabase backend.
- Added `scripts/check-syntax.js` and GitHub Actions syntax-check workflow.

### Verification performed
- Inspected source files from the original GitHub main branch.
- Inspected live Supabase table definitions, applied migration history, RLS policies, and security/performance advisor results (read-only).
- Parsed all current backend JavaScript files and inline scripts in login, dashboard, inventory, analytics, reports, profile, orders and customers using a JavaScript parser. All parsed successfully.
- GitHub Actions workflow passes syntax checks for backend JavaScript and all inline frontend scripts. It also audits production dependencies on each push/PR.
- The full dependency audit currently reports two moderate, fix-available development-tool findings (nodemon and its transitive minimatch dependency); no high or critical findings. Production-only audit is configured as a CI gate.
- Full end-to-end runtime tests, browser interaction tests, SQL migration validation, and business-data tests remain pending.

### Remaining risks / next phase
- Review and apply migration 002 only after explicit approval.
- Configure `SUPABASE_SECRET_KEY` locally in `backend/.env`; never commit it.
- Run the backend locally and verify login, products, stock movements, order creation, cancellation/restock, customer archive, role changes and password changes against the intended Supabase project.
- Enable Supabase leaked-password protection in Auth settings.
- Build payment lifecycle, invoice/receipt generation, returns/refunds, supplier/purchase workflow, advanced reports, and predictive decision support after core transactions pass testing.

## 2026-11-12 — Review continuation and safety corrections

- Reconfirmed the protected original baseline branch: `baseline/original-2026-11-11` (original main snapshot `0b8a8248c69bcee85eda958fa48501b76168ae69`). All current implementation work remains isolated on `improvements/phase-1`; no changes were made to `main` or the live Supabase database.
- Hardened Supabase client separation: public sign-in uses the publishable key, protected requests use a request-scoped client carrying the caller JWT for RLS, and Auth Admin / service-role RPC operations use a server-only secret-key client. Supports the current `SUPABASE_SECRET_KEY` name and the legacy `SUPABASE_SERVICE_ROLE_KEY` fallback.
- Restored the profile password-change endpoint and routed role changes through the serialized database RPC, including last-administrator protection.
- Corrected the archive-trigger function's PL/pgSQL dollar-quote delimiter and wrapped migration 002 in a transaction.
- Verification to date: reviewed all backend controllers/routes, the primary frontend pages, project baseline notes and proposed migration; confirmed no frontend `localhost:3000` hardcoding in the reviewed pages; confirmed baseline and implementation branches exist. Automated syntax/CI, SQL execution, browser flows and live database integration are still pending.
- Do not apply migration 002 or deploy until its SQL has been independently validated, the target Supabase project has been backed up, and the user explicitly approves the database change.


## 2026-11-12 — Phase 1.1: Staff, departments, preferences and valuable customers

### Agreed business rules
- Roles are Admin, Manager and General Staff.
- Admin has company-wide access and is the only role allowed to appoint Managers or change management structure.
- Small-company mode supports one Overall Manager who controls all departments within Admin-granted permissions.
- Manager-hierarchy mode supports one Overall Manager and multiple Department Managers reporting to that Overall Manager; each department has at most one Department Manager.
- Department Managers manage only their assigned department. Overall Managers supervise all departments. Managers cannot see Admin profile contact details or appoint other Managers.
- Customers and Staff Management are restricted to Admin and Managers.
- Salary records are visible to Admin and the Overall Manager across the company; Department Managers only see salary records in their own department; General Staff cannot see salary records.
- Customer profiles are created only after configurable frequent-order or high-value thresholds are reached. Orders for unqualified buyers retain only a server-generated HMAC fingerprint in the private schema; raw buyer details are not written to a customer profile until qualification.

### Files added or modified
- Added \`backend/migrations/003_staff_departments_customer_preferences.sql\` (review-only; requires migration 002 first; not applied to Supabase).
- Added \`backend/controllers/staffController.js\` and \`backend/routes/staffRoutes.js\`.
- Updated \`backend/middleware/authMiddleware.js\` and \`backend/controllers/authController.js\` for the three trusted roles and department scope.
- Updated \`backend/controllers/orderController.js\` to compute a private HMAC buyer fingerprint and pass buyer details to the qualification RPC.
- Updated \`backend/controllers/customerController.js\` and \`backend/routes/customerRoutes.js\` to expose only the valuable customer registry to Admin/Managers and disable manual profile creation.
- Updated \`backend/routes/userRoutes.js\` to keep self-profile endpoints separate from Staff Management.
- Updated \`backend/server.js\` to mount \`/api/staff\`.
- Added \`front-end/staff.html\` for invitations, employee list, departments, compensation and preferences.
- Replaced \`front-end/customers.html\` with a valuable-customer registry; \`front-end/users.html\` redirects to Staff Management.
- Updated \`front-end/orders.html\` to collect buyer details transiently during an order and show the existing customer selector only to Admin/Managers.
- Updated dashboard, inventory, analytics, reports and profile navigation so Customers and Staff Management links are hidden from General Staff.
- Updated backend setup notes and \`.env.example\` with \`CUSTOMER_IDENTITY_SECRET\`.

### Verification and limitations
- Read-only inspection confirmed the connected Supabase schema currently has only Admin/Staff roles and no department or compensation tables; migrations 001 and 002 state/history was inspected.
- No live Supabase migration was applied. Migration 003 depends on migration 002 and requires SQL review plus backup and explicit approval.
- Backend syntax and browser behavior have not yet been re-run against the user's local checkout after these new commits.
- The local developer must set a stable random \`CUSTOMER_IDENTITY_SECRET\` in \`backend/.env\`; do not commit or share it.
- Customer qualification currently counts non-cancelled orders and lifetime value. A cancelled order may require a follow-up metric reconciliation policy; historical order and customer retention behavior should be tested before production.
- Full end-to-end tests for Admin, Overall Manager, Department Manager, General Staff, salary scope, customer qualification, and department transitions remain pending.
