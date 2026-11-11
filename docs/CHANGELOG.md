# BizInsight change log

## 2026-11-11 — Phase 1 implementation started
Baseline preserved at `baseline/original-2026-11-11`. Work isolated at `improvements/phase-1`.

### Implemented on the phase branch
- `backend/config/supabase.js`: split public auth client, request-scoped authenticated client factory, and server-only admin client factory.
- `backend/middleware/authMiddleware.js`: validates the bearer token, loads trusted profile role, and attaches `req.supabase` carrying the caller's JWT.
- `backend/controllers/authController.js`: login/profile lookups use a request-authenticated client; staff invitation uses the server-only Auth Admin client.

### Prepared, not yet applied
- `backend/migrations/002_inventory_ledger_order_lifecycle.sql`: inventory ledger, guarded stock updates, stock movement RPC, atomic cancellation/restock, and last-admin-safe role update.
- This SQL file is a proposal for review. It has NOT been executed against Supabase.

### Verification
- Read current GitHub source from `main` and preserved an untouched baseline branch.
- Read current Supabase table definitions, migration history, RLS policies, and security/performance advisor output.
- Confirmed RLS is enabled on the five existing core tables.
- Confirmed current security advisor warning: leaked-password protection disabled.
- Runtime/API tests have not yet been run against the user's local environment.

### Remaining work
- Convert all controllers to `req.supabase` and route privileged operations through the server-only admin client.
- Finish order lifecycle, inventory movement and archive behavior.
- Correct frontend API URLs and stock field mapping.
- Add focused tests and a runbook.
- Review and obtain explicit approval before applying migration 002 to the live database.
