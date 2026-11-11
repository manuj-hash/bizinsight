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
- `backend/controllers/analyticsController.js`: paginate table reads and exclude archived records from key totals.
- `backend/controllers/userController.js`: use service-role role-change RPC, add last-admin-safe role update and verified password update.
- Added `backend/controllers/inventoryMovementController.js` and `backend/routes/inventoryMovementRoutes.js`.
- `backend/server.js`: mount inventory movement API and restrict cross-origin requests to configured origins.
- `backend/routes/userRoutes.js`: add password update route.
- Added `backend/.env.example` and replaced temporary backend update notes with setup/security documentation.

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
- GitHub Actions workflow is configured to repeat syntax parsing on pushes and pull requests.
- Full end-to-end runtime tests, browser interaction tests, SQL migration validation, and business-data tests remain pending.

### Remaining risks / next phase
- Review and apply migration 002 only after explicit approval.
- Configure `SUPABASE_SECRET_KEY` locally in `backend/.env`; never commit it.
- Run the backend locally and verify login, products, stock movements, order creation, cancellation/restock, customer archive, role changes and password changes against the intended Supabase project.
- Enable Supabase leaked-password protection in Auth settings.
- Build payment lifecycle, invoice/receipt generation, returns/refunds, supplier/purchase workflow, advanced reports, and predictive decision support after core transactions pass testing.
