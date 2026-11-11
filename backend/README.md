# BizInsight — redevelopment foundation

This branch is isolated from `main`. It contains a new responsive application shell, frontend modules, an Express API foundation, and an additive database migration.

## Local setup
1. Install Node.js 20 or newer.
2. In a terminal: `cd backend`
3. Copy `.env.example` to `.env` and fill in the Supabase project URL and publishable (or legacy anon) key. Never use a service-role/secret key here.
4. Run `npm install`, then `npm run dev`.
5. Open `http://localhost:3000`.

## Database
Review `migrations/002_inventory_ledger_order_lifecycle.sql` before applying it. It is additive and is not automatically applied. Take a database backup first. It adds reserved stock, a stock movement ledger, order lifecycle RPCs and controlled stock adjustments.

Order lifecycle:
- Pending: no reservation.
- Confirmed: reserve available stock.
- Processing: keep reservation.
- Completed: deduct physical stock and release reservation.
- Cancelled: release reservation exactly once.

## Important
- Frontend assets are in `public/`.
- `index.html` at repository root is a simple GitHub entry point; the running app is served from `public/index.html`.
- No Supabase migration has been applied to the live database by this branch.
- Existing live data is not deleted or rewritten.
- The backend uses the caller's Supabase JWT for database operations and does not need a service-role key.
- Keep secrets in the ignored local `.env` file; do not commit it.
