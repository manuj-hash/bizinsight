# BizInsight

**Business Analytics & Decision Support System** for small businesses and SMEs.

BizInsight connects day-to-day business operations with analytics so owners and managers can understand performance and make better decisions. It is not an inventory-only application.

## Core modules
- Dashboard and business overview
- Inventory and stock movement history
- Sales and order management
- Customer management
- Business analytics
- Reports and exports
- Admin/staff access
- Profile and settings

Future roadmap: payment lifecycle, invoices, returns/refunds, supplier purchases, demand forecasting, restock recommendations and decision-support insights.

## Technology
- Frontend: HTML, CSS, vanilla JavaScript, Chart.js
- Backend: Node.js and Express
- Database/Auth: Supabase PostgreSQL and Supabase Auth

The project intentionally retains its original stack. MongoDB/Mongoose and React are not part of the current architecture.

## Run locally (Windows PowerShell)
1. Copy `backend/.env.example` to `backend/.env` and fill in the Supabase values.
2. Run `cd backend`.
3. Run `npm.cmd install`.
4. Run `npm.cmd start`.
5. Open `http://localhost:3000`.

See [backend setup and security notes](backend/README-UPDATE.txt).

## Baseline and change tracking
- Original code is preserved on branch `baseline/original-2026-11-11`.
- Phase 1 changes are isolated on `improvements/phase-1`.
- Product purpose, architecture decisions and safety rules: [docs/PROJECT_BASELINE.md](docs/PROJECT_BASELINE.md).
- Implementation history and verification: [docs/CHANGELOG.md](docs/CHANGELOG.md).

## Important
The Phase 1 database migration is a review proposal and has not been applied to the live Supabase project. Do not run it against production until reviewed, backed up and explicitly approved.
