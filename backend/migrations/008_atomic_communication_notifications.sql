-- Make communication record creation and recipient notifications atomic.
-- These functions are callable only by the trusted Express service-role backend.

CREATE OR REPLACE FUNCTION public.publish_bizinsight_message(
  p_actor_id uuid,
  p_message_type text,
  p_department_id uuid,
  p_target_department_ids uuid[],
  p_title text,
  p_body text,
  p_priority text DEFAULT 'normal'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  saved_id uuid;
  target_ids uuid[];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id=p_actor_id AND role IN ('admin','manager','staff')) THEN
    RAISE EXCEPTION 'An active BizInsight employee account is required';
  END IF;
  IF p_message_type NOT IN ('team','general') THEN
    RAISE EXCEPTION 'Invalid communication message type';
  END IF;
  IF p_message_type='team' AND p_department_id IS NULL THEN
    RAISE EXCEPTION 'Team messages require a department';
  END IF;
  IF p_message_type='general' AND (p_target_department_ids IS NULL OR cardinality(p_target_department_ids)=0) THEN
    RAISE EXCEPTION 'General announcements require at least one target department';
  END IF;

  target_ids := CASE
    WHEN p_message_type='team' THEN ARRAY[p_department_id]
    ELSE ARRAY(SELECT DISTINCT unnest(p_target_department_ids))
  END;

  INSERT INTO public.communication_messages(
    message_type, department_id, target_department_ids, sender_id, title, body, priority
  )
  VALUES (
    p_message_type,
    CASE WHEN p_message_type='team' THEN p_department_id ELSE NULL END,
    CASE WHEN p_message_type='general' THEN target_ids ELSE '{}'::uuid[] END,
    p_actor_id, btrim(p_title), btrim(p_body), coalesce(p_priority,'normal')
  )
  RETURNING id INTO saved_id;

  INSERT INTO public.communication_notifications(user_id,message_id,notification_type,title)
  SELECT p.id, saved_id,
         CASE WHEN p_message_type='team' THEN 'team_message' ELSE 'general_announcement' END,
         btrim(p_title)
  FROM public.profiles p
  WHERE p.department_id = ANY(target_ids)
    AND p.id <> p_actor_id;

  RETURN saved_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.publish_bizinsight_message(uuid,text,uuid,uuid[],text,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_bizinsight_message(uuid,text,uuid,uuid[],text,text,text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.create_bizinsight_issue(
  p_actor_id uuid,
  p_department_id uuid,
  p_affected_department_ids uuid[],
  p_title text,
  p_description text,
  p_priority text DEFAULT 'normal'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  saved_id uuid;
  target_ids uuid[];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id=p_actor_id AND role IN ('admin','manager','staff')) THEN
    RAISE EXCEPTION 'An active BizInsight employee account is required';
  END IF;
  IF p_department_id IS NULL THEN
    RAISE EXCEPTION 'A work issue requires a department';
  END IF;

  target_ids := ARRAY(
    SELECT DISTINCT x
    FROM unnest(ARRAY[p_department_id] || coalesce(p_affected_department_ids,'{}'::uuid[])) AS x
  );

  INSERT INTO public.communication_issues(
    department_id, affected_department_ids, created_by, title, description, priority
  )
  VALUES (
    p_department_id,
    coalesce(p_affected_department_ids,'{}'::uuid[]),
    p_actor_id, btrim(p_title), btrim(p_description), coalesce(p_priority,'normal')
  )
  RETURNING id INTO saved_id;

  INSERT INTO public.communication_notifications(user_id,issue_id,notification_type,title)
  SELECT p.id, saved_id, 'work_issue', btrim(p_title)
  FROM public.profiles p
  WHERE p.department_id = ANY(target_ids)
    AND p.id <> p_actor_id;

  RETURN saved_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_bizinsight_issue(uuid,uuid,uuid[],text,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_bizinsight_issue(uuid,uuid,uuid[],text,text,text)
  TO service_role;
