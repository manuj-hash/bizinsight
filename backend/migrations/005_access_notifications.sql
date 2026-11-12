BEGIN;

-- Access-related notifications are separate from team messages and work issues.
-- The table is server-only; the Express API uses the service-role client after authentication.
CREATE TABLE IF NOT EXISTS public.access_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (event_type IN (
    'permission_granted','permission_revoked',
    'delegation_granted','delegation_updated','delegation_revoked'
  )),
  permission_code text NOT NULL REFERENCES public.permission_catalog(code) ON DELETE RESTRICT,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 2 AND 120),
  message text NOT NULL CHECK (length(btrim(message)) BETWEEN 2 AND 500),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);

CREATE INDEX IF NOT EXISTS access_notifications_user_unread_idx
  ON public.access_notifications(user_id,created_at DESC)
  WHERE read_at IS NULL;

ALTER TABLE public.access_notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.access_notifications FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.access_notifications TO service_role;

COMMIT;
