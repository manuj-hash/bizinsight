BEGIN;

-- BizInsight Phase 2: explicit permissions, manager delegation and communication.
-- This migration is committed for review only. It is NOT applied to Supabase by this change.
-- Apply only after the existing organization/department migrations have been reviewed and applied.

CREATE TABLE IF NOT EXISTS public.permission_catalog (
  code text PRIMARY KEY,
  module_key text NOT NULL,
  label text NOT NULL,
  description text,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true
);

INSERT INTO public.permission_catalog(code,module_key,label,description,sort_order) VALUES
('dashboard.view','dashboard','View Dashboard','Open the business dashboard',10),
('inventory.view','inventory','View Inventory','View products and stock',20),
('inventory.create','inventory','Add Products','Create products',21),
('inventory.update','inventory','Edit Products','Edit product details',22),
('inventory.stock_movement','inventory','Record Stock Movements','Record stock changes with reasons',23),
('inventory.archive','inventory','Archive Products','Archive products without deleting history',24),
('orders.view','orders','View Sales & Orders','View orders',30),
('orders.create','orders','Create Orders','Create sales orders',31),
('orders.update','orders','Update Orders','Change order status',32),
('customers.view','customers','View Customers','View customer records',40),
('customers.create','customers','Add Customers','Create customer records',41),
('customers.update','customers','Edit Customers','Edit customer records',42),
('customers.archive','customers','Archive Customers','Archive customer records',43),
('analytics.view','analytics','View Analytics','Open business analytics',50),
('reports.view','reports','View Reports','View reports',60),
('reports.export','reports','Export Reports','Export reports',61),
('staff.view','staff','View User Management','View staff records',70),
('staff.manage','staff','Manage Staff','Invite and update staff records within scope',71),
('staff.compensation.view','staff','View Compensation','View salary information within scope',72),
('staff.compensation.manage','staff','Manage Compensation','Update salary information within scope',73),
('staff.departments.manage','staff','Manage Departments','Manage authorized departments',74),
('permissions.grant_staff','permissions','Grant Staff Permissions','Grant Admin-delegated permissions to Staff',80),
('permissions.revoke_staff','permissions','Deactivate Staff Permissions','Deactivate Staff permissions within delegated scope',81),
('communication.access','communication','Open Communication','Open the communication workspace',90),
('communication.team','communication','Team Communication','Read and send department messages',91),
('communication.general.publish','communication','Publish General Announcements','Publish company or cross-department announcements',92),
('communication.issues.access','communication','View and Report Work Issues','View and report operational issues',93),
('communication.issues.manage','communication','Manage Work Issues','Assign and update work issues',94),
('communication.complaints.submit','communication','Submit Complaints','Submit confidential complaints',95),
('communication.complaints.review','communication','Review Complaints','Review complaints routed to the user',96),
('communication.responsibility.manage','communication','Manage Announcement Responsibility','Assign primary and backup communicators',97)
ON CONFLICT (code) DO UPDATE SET
  module_key=EXCLUDED.module_key,label=EXCLUDED.label,
  description=EXCLUDED.description,sort_order=EXCLUDED.sort_order,is_active=true;

CREATE TABLE IF NOT EXISTS public.user_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  permission_code text NOT NULL REFERENCES public.permission_catalog(code) ON DELETE RESTRICT,
  granted_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  is_active boolean NOT NULL DEFAULT true,
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  revoked_at timestamptz,
  CHECK ((is_active AND revoked_at IS NULL) OR (NOT is_active AND revoked_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS user_permissions_one_active_uidx
  ON public.user_permissions(user_id,permission_code) WHERE is_active=true;
CREATE INDEX IF NOT EXISTS user_permissions_user_active_idx
  ON public.user_permissions(user_id,is_active);

CREATE TABLE IF NOT EXISTS public.manager_delegations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  manager_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  permission_code text NOT NULL REFERENCES public.permission_catalog(code) ON DELETE RESTRICT,
  department_id uuid REFERENCES public.departments(id) ON DELETE CASCADE,
  can_grant boolean NOT NULL DEFAULT false,
  can_revoke boolean NOT NULL DEFAULT false,
  granted_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  is_active boolean NOT NULL DEFAULT true,
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CHECK (can_grant OR can_revoke OR NOT is_active),
  CHECK ((is_active AND revoked_at IS NULL) OR (NOT is_active AND revoked_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS manager_delegations_one_active_uidx
  ON public.manager_delegations(manager_id,permission_code,COALESCE(department_id,'00000000-0000-0000-0000-000000000000'::uuid))
  WHERE is_active=true;
CREATE INDEX IF NOT EXISTS manager_delegations_manager_active_idx
  ON public.manager_delegations(manager_id,is_active);

CREATE TABLE IF NOT EXISTS public.permission_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  target_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  permission_code text NOT NULL REFERENCES public.permission_catalog(code) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('grant','revoke','delegate','undelegate')),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS permission_audit_logs_target_date_idx
  ON public.permission_audit_logs(target_user_id,created_at DESC);

CREATE TABLE IF NOT EXISTS public.communication_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_type text NOT NULL CHECK (message_type IN ('team','general')),
  department_id uuid REFERENCES public.departments(id) ON DELETE CASCADE,
  target_department_ids uuid[] NOT NULL DEFAULT '{}',
  sender_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 2 AND 160),
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 2 AND 5000),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((message_type='team' AND department_id IS NOT NULL) OR (message_type='general' AND department_id IS NULL))
);
CREATE INDEX IF NOT EXISTS communication_messages_department_date_idx
  ON public.communication_messages(department_id,created_at DESC);
CREATE INDEX IF NOT EXISTS communication_messages_type_date_idx
  ON public.communication_messages(message_type,created_at DESC);

CREATE TABLE IF NOT EXISTS public.communication_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id uuid NOT NULL REFERENCES public.departments(id) ON DELETE RESTRICT,
  affected_department_ids uuid[] NOT NULL DEFAULT '{}',
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  assigned_to uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 2 AND 160),
  description text NOT NULL CHECK (length(btrim(description)) BETWEEN 2 AND 5000),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','blocked','resolved','closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE INDEX IF NOT EXISTS communication_issues_department_date_idx
  ON public.communication_issues(department_id,created_at DESC);
CREATE INDEX IF NOT EXISTS communication_issues_assignee_idx
  ON public.communication_issues(assigned_to,status);

CREATE TABLE IF NOT EXISTS public.communication_complaints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submitted_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  target_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  recipient_role text NOT NULL CHECK (recipient_role IN ('manager','admin')),
  department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  category text NOT NULL CHECK (length(btrim(category)) BETWEEN 2 AND 80),
  subject text NOT NULL CHECK (length(btrim(subject)) BETWEEN 2 AND 160),
  description text NOT NULL CHECK (length(btrim(description)) BETWEEN 2 AND 5000),
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','under_review','resolved','closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS communication_complaints_submitter_date_idx
  ON public.communication_complaints(submitted_by,created_at DESC);
CREATE INDEX IF NOT EXISTS communication_complaints_route_date_idx
  ON public.communication_complaints(recipient_role,department_id,created_at DESC);

CREATE TABLE IF NOT EXISTS public.communication_complaint_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  complaint_id uuid NOT NULL REFERENCES public.communication_complaints(id) ON DELETE CASCADE,
  responder_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 2 AND 3000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS communication_complaint_responses_complaint_idx
  ON public.communication_complaint_responses(complaint_id,created_at);

CREATE TABLE IF NOT EXISTS public.communication_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  message_id uuid REFERENCES public.communication_messages(id) ON DELETE CASCADE,
  issue_id uuid REFERENCES public.communication_issues(id) ON DELETE CASCADE,
  notification_type text NOT NULL CHECK (notification_type IN ('team_message','general_announcement','work_issue')),
  title text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  CHECK ((message_id IS NOT NULL AND issue_id IS NULL) OR (message_id IS NULL AND issue_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS communication_notifications_user_unread_idx
  ON public.communication_notifications(user_id,created_at DESC) WHERE read_at IS NULL;

CREATE TABLE IF NOT EXISTS public.communication_responsibilities (
  department_id uuid PRIMARY KEY REFERENCES public.departments(id) ON DELETE CASCADE,
  primary_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  backup_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  active_publisher_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  updated_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (primary_user_id <> backup_user_id),
  CHECK (active_publisher_user_id IN (primary_user_id,backup_user_id))
);

-- All new tables are server-only. The Express API uses the server-side secret key
-- after performing explicit actor, role, delegation and department checks.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'permission_catalog','user_permissions','manager_delegations','permission_audit_logs',
    'communication_messages','communication_issues','communication_complaints',
    'communication_complaint_responses','communication_responsibilities','communication_notifications'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated',t);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role',t);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.submit_bizinsight_complaint(
  p_submitter_id uuid,
  p_target_user_id uuid,
  p_category text,
  p_subject text,
  p_description text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_submitter public.profiles%ROWTYPE;
  v_target public.profiles%ROWTYPE;
  v_recipient_role text;
  v_department_id uuid;
  v_month_start timestamptz := date_trunc('month',now());
  v_count integer;
  v_id uuid;
BEGIN
  SELECT * INTO v_submitter FROM public.profiles WHERE id=p_submitter_id;
  SELECT * INTO v_target FROM public.profiles WHERE id=p_target_user_id;
  IF v_submitter.id IS NULL OR v_target.id IS NULL THEN
    RAISE EXCEPTION 'Submitter or target employee not found';
  END IF;
  IF v_submitter.id=p_target_user_id THEN RAISE EXCEPTION 'You cannot submit a complaint against yourself'; END IF;

  IF v_submitter.role='manager' THEN
    IF v_target.role NOT IN ('staff','manager') THEN RAISE EXCEPTION 'Invalid complaint target'; END IF;
    IF v_submitter.manager_scope='department'
       AND v_target.department_id IS DISTINCT FROM v_submitter.department_id THEN
      RAISE EXCEPTION 'Department Managers can complain only about employees in their department';
    END IF;
    v_recipient_role := 'admin';
    v_department_id := NULL;
  ELSIF v_submitter.role='staff' THEN
    IF v_target.role='manager' AND v_target.department_id IS NOT DISTINCT FROM v_submitter.department_id THEN
      v_recipient_role := 'admin';
      v_department_id := NULL;
    ELSIF v_target.role='staff' AND v_target.department_id=v_submitter.department_id THEN
      v_recipient_role := 'manager';
      v_department_id := v_submitter.department_id;
    ELSE
      RAISE EXCEPTION 'Staff complaints can target their own department or escalate a Manager complaint to Admin';
    END IF;
  ELSE
    RAISE EXCEPTION 'Admin does not use the employee complaint route';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_submitter_id::text));
  SELECT count(*)::integer INTO v_count
  FROM public.communication_complaints
  WHERE submitted_by=p_submitter_id AND created_at>=v_month_start;
  IF v_count>=3 THEN
    RAISE EXCEPTION 'Monthly complaint limit reached. You can submit up to 3 formal complaints per calendar month.';
  END IF;

  INSERT INTO public.communication_complaints(
    submitted_by,target_user_id,recipient_role,department_id,category,subject,description
  ) VALUES (
    p_submitter_id,p_target_user_id,v_recipient_role,v_department_id,
    btrim(p_category),btrim(p_subject),btrim(p_description)
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.submit_bizinsight_complaint(uuid,uuid,text,text,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.submit_bizinsight_complaint(uuid,uuid,text,text,text)
  TO service_role;

COMMIT;
