# BizInsight backend

BizInsight is a Business Analytics & Decision Support System. The backend uses Node.js, Express, Supabase Auth and Supabase PostgreSQL.

## Local setup (Windows PowerShell)

1. Open a terminal in the repository root.
2. Copy `backend/.env.example` to `backend/.env`.
3. Fill in the Supabase project URL, publishable key, and server-only secret key.
4. Install backend dependencies:

```powershell
cd backend
npm.cmd install
```

5. Start the API:

```powershell
npm.cmd start
```

6. Open `http://localhost:3000`. The API health endpoint is `http://localhost:3000/api/status`.

## Environment variables

- `SUPABASE_URL`: Supabase project URL.
- `SUPABASE_PUBLISHABLE_KEY`: publishable key used for login and user-scoped requests.
- `SUPABASE_SECRET_KEY`: server-only secret key used for Auth Admin and privileged transactional RPCs. Never expose it to the browser.
- `PORT`: optional HTTP port (default 3000).
- `CORS_ORIGINS`: optional comma-separated list of separately hosted frontend origins.

## Security model

- Every protected request validates its bearer token and gets a request-scoped Supabase client carrying that user's Authorization header. Database RLS therefore evaluates the actual signed-in user.
- Trusted roles are loaded from `public.profiles`, not user-editable metadata.
- Auth Admin and service-role-only RPC calls use a server-only client.
- Public registration is disabled. Admins invite staff.
- Orders are business records and should not be physically deleted.
- Stock must be changed through the inventory movement API, not by editing `stock_quantity` directly.

## Database migrations

`001_admin_staff_and_atomic_orders.sql` is the existing foundation migration.

`002_inventory_ledger_order_lifecycle.sql` is a proposed Phase 1 migration that creates the stock ledger, protects stock updates, adds atomic order cancellation/restocking, customer archival support, and last-admin-safe role changes.

**Migration 002 has been committed for review only. It has NOT been applied to Supabase.** Back up the project, review the SQL, and obtain explicit approval before applying it to the live project. The new inventory movement, customer archive, order lifecycle and role-update APIs depend on it.

## API groups

- `/api/auth`: login, current profile, disabled public registration
- `/api/products`: product management
- `/api/inventory/movements`: audited stock history and adjustments
- `/api/customers`: customer management
- `/api/orders`: order creation and lifecycle
- `/api/analytics`: dashboard, sales and inventory analytics
- `/api/users`: profile and admin/staff management

## Verification

Run `node scripts/check-syntax.js` from the repository root to parse backend JavaScript and inline frontend scripts without executing them.
