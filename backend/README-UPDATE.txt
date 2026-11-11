BizInsight backend update

1. Back up your existing backend folder.
2. Copy the contents of this updated backend folder over your local backend folder.
3. Apply migrations/001_admin_staff_and_atomic_orders.sql in Supabase SQL Editor for project bizinsight-india (xyhqqrttbgbwskwdydjw).
4. From the backend folder run: npm install
5. Keep your existing .env file locally. Never upload it or expose SUPABASE_SECRET_KEY to the frontend.
6. Run: node server.js

New role behavior:
- Public signups receive role=staff. The request body cannot choose a role.
- Existing admin account remains admin.
- Public registration is disabled. Admin invites staff using POST /api/users/invite with { email, full_name, phone? }.
- Admin-only: GET /api/users, POST /api/users/invite, PATCH /api/users/:id/role, DELETE /api/products/:id, DELETE /api/customers/:id, DELETE /api/orders/:id.
- Admin + staff: products, customers, orders, analytics, own profile.

New customer endpoints:
GET /api/customers
GET /api/customers/:id
POST /api/customers
PUT /api/customers/:id
DELETE /api/customers/:id (admin only)

Order creation now calls the SQL RPC create_bizinsight_order. It creates the order/items and decrements stock atomically.

Known follow-up before production:
- Order cancellation/deletion must restore stock exactly once. The current atomic creation RPC decrements stock, but the existing cancel/delete handlers do not yet reverse it. Avoid cancelling/deleting orders until that workflow is implemented and tested.
- Configure and test Supabase Auth email invitations/SMTP and the correct redirect URL.
- Restrict CORS to the actual frontend origin before deployment.
