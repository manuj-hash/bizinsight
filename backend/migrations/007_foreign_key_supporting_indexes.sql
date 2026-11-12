BEGIN;

-- Supporting indexes for every foreign key reported by the Supabase advisor.
-- Each index is created only when the name is not already present.
CREATE INDEX IF NOT EXISTS idx_access_notifications_1_fk ON public.access_notifications (actor_id);
CREATE INDEX IF NOT EXISTS idx_access_notifications_2_fk ON public.access_notifications (permission_code);
CREATE INDEX IF NOT EXISTS idx_access_notifications_3_fk ON public.access_notifications (user_id);
CREATE INDEX IF NOT EXISTS idx_communication_complaint_responses_4_fk ON public.communication_complaint_responses (responder_id);
CREATE INDEX IF NOT EXISTS idx_communication_complaints_5_fk ON public.communication_complaints (department_id);
CREATE INDEX IF NOT EXISTS idx_communication_complaints_6_fk ON public.communication_complaints (target_user_id);
CREATE INDEX IF NOT EXISTS idx_communication_issues_7_fk ON public.communication_issues (created_by);
CREATE INDEX IF NOT EXISTS idx_communication_messages_8_fk ON public.communication_messages (sender_id);
CREATE INDEX IF NOT EXISTS idx_communication_notifications_9_fk ON public.communication_notifications (issue_id);
CREATE INDEX IF NOT EXISTS idx_communication_notifications_10_fk ON public.communication_notifications (message_id);
CREATE INDEX IF NOT EXISTS idx_communication_notifications_11_fk ON public.communication_notifications (user_id);
CREATE INDEX IF NOT EXISTS idx_communication_responsibilities_12_fk ON public.communication_responsibilities (active_publisher_user_id);
CREATE INDEX IF NOT EXISTS idx_communication_responsibilities_13_fk ON public.communication_responsibilities (backup_user_id);
CREATE INDEX IF NOT EXISTS idx_communication_responsibilities_14_fk ON public.communication_responsibilities (primary_user_id);
CREATE INDEX IF NOT EXISTS idx_communication_responsibilities_15_fk ON public.communication_responsibilities (updated_by);
CREATE INDEX IF NOT EXISTS idx_company_preferences_16_fk ON public.company_preferences (updated_by);
CREATE INDEX IF NOT EXISTS idx_departments_17_fk ON public.departments (created_by);
CREATE INDEX IF NOT EXISTS idx_employee_compensation_18_fk ON public.employee_compensation (created_by);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_19_fk ON public.inventory_movements (created_by);
CREATE INDEX IF NOT EXISTS idx_manager_delegations_20_fk ON public.manager_delegations (department_id);
CREATE INDEX IF NOT EXISTS idx_manager_delegations_21_fk ON public.manager_delegations (granted_by);
CREATE INDEX IF NOT EXISTS idx_manager_delegations_22_fk ON public.manager_delegations (permission_code);
CREATE INDEX IF NOT EXISTS idx_permission_audit_logs_23_fk ON public.permission_audit_logs (actor_id);
CREATE INDEX IF NOT EXISTS idx_permission_audit_logs_24_fk ON public.permission_audit_logs (permission_code);
CREATE INDEX IF NOT EXISTS idx_customer_identity_keys_25_fk ON private.customer_identity_keys (customer_id);
CREATE INDEX IF NOT EXISTS idx_profiles_26_fk ON public.profiles (reports_to);
CREATE INDEX IF NOT EXISTS idx_user_permissions_27_fk ON public.user_permissions (granted_by);
CREATE INDEX IF NOT EXISTS idx_user_permissions_28_fk ON public.user_permissions (permission_code);
CREATE INDEX IF NOT EXISTS idx_user_permissions_29_fk ON public.user_permissions (revoked_by);

COMMIT;
