# BizInsight — rebuild foundation

This branch is an isolated redevelopment workspace. The existing `main` branch is unchanged.

## Stack
- Frontend: HTML, CSS, vanilla JavaScript, Chart.js
- Backend: Node.js + Express (existing backend retained for the next integration pass)
- Database/auth: Supabase PostgreSQL + Supabase Auth

## Run
1. Keep the existing backend running on port 3000.
2. Serve the repository root from the backend static middleware, or use any local static server with an API proxy to `http://localhost:3000`.
3. Open `index.html`.

## API contract expected by this frontend
- POST `/api/auth/login`
- GET `/api/auth/me`
- GET `/api/analytics/dashboard`
- GET `/api/analytics/sales`
- GET/POST `/api/products`
- GET `/api/orders`
- GET `/api/customers`
- GET `/api/users`
- GET `/api/users/me`, PUT `/api/users/me`
- GET `/api/stock-movements` (to be implemented with the stock ledger)

Some sections intentionally report a clear integration message until their backend endpoints and database migrations are implemented. No database migration is applied by this branch.

## Safety
- Never commit `.env`, Supabase secret keys, service-role keys, or access tokens.
- Do not apply schema changes to the live Supabase project without a reviewed backup and explicit approval.
- Order status transitions must be transactional and idempotent; the UI must never directly adjust stock.
