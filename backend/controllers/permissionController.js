const { getAdminClient } = require("../config/supabase");

async function createAccessNotification(db, { userId, actorId, eventType, permissionCode, details = {} }) {
    const templates = {
        permission_granted: {
            title: "Access permission granted",
            message: `Your access to "${permissionCode}" has been granted. Sign in again if the change is not visible.`
        },
        permission_revoked: {
            title: "Access permission revoked",
            message: `Your access to "${permissionCode}" has been revoked. If you believe this is incorrect, contact your administrator.`
        },
        delegation_granted: {
            title: "Manager authority delegated",
            message: `You have been granted authority for "${permissionCode}". Review your Access Control page for the scope and actions.`
        },
        delegation_updated: {
            title: "Manager authority updated",
            message: `Your delegated authority for "${permissionCode}" has been updated. Review your Access Control page for the current scope and actions.`
        },
        delegation_revoked: {
            title: "Manager authority revoked",
            message: `Your delegated authority for "${permissionCode}" has been revoked.`
        }
    };
    const template = templates[eventType];
    if (!template) throw new Error("Unsupported access notification event");
    const { data: permission } = await db.from("permission_catalog")
        .select("label").eq("code", permissionCode).maybeSingle();
    const permissionLabel = permission?.label || permissionCode;
    const message = template.message.replaceAll(permissionCode, permissionLabel);
    const { error } = await db.from("access_notifications").insert({
        user_id: userId,
        actor_id: actorId,
        event_type: eventType,
        permission_code: permissionCode,
        title: template.title,
        message,
        details
    });
    if (error) throw error;
}


const catalog = async (req, res) => {
    try {
        const db = getAdminClient();
        const [{ data: definitions, error: catalogError }, { data: assigned, error: assignedError }, { data: delegated, error: delegatedError }] = await Promise.all([
            db.from("permission_catalog").select("code,module_key,label,description,sort_order").eq("is_active", true).order("sort_order"),
            db.from("user_permissions").select("permission_code,is_active,granted_by,granted_at").eq("user_id", req.user.id).eq("is_active", true),
            req.profile.role === "manager"
                ? db.from("manager_delegations").select("permission_code,department_id,can_grant,can_revoke").eq("manager_id", req.user.id).eq("is_active", true)
                : Promise.resolve({ data: [], error: null })
        ]);
        if (catalogError) throw catalogError;
        if (assignedError) throw assignedError;
        if (delegatedError) throw delegatedError;
        const effective = req.profile.role === "admin" ? (definitions || []).map(x => x.code) : (assigned || []).map(x => x.permission_code);
        return res.json({
            role: req.profile.role,
            department_id: req.profile.department_id,
            permissions: effective,
            catalog: definitions || [],
            delegations: delegated || []
        });
    } catch (error) {
        if (["42P01","PGRST205","PGRST204"].includes(error.code)) {
            return res.json({
                role: req.profile.role,
                department_id: req.profile.department_id,
                permissions: [],
                catalog: [],
                delegations: [],
                schema_ready: false,
                message: "Permission database migration is not installed yet."
            });
        }
        console.error("Permission catalog:", error.message);
        return res.status(500).json({ message: "Unable to load permissions" });
    }
};

const getDelegations = async (req, res) => {
    try {
        const db = getAdminClient();
        let query = db.from("manager_delegations").select("*").order("granted_at", { ascending: false });
        if (req.profile.role !== "admin") query = query.eq("manager_id", req.user.id);
        const { data, error } = await query;
        if (error) throw error;
        return res.json(data || []);
    } catch (error) {
        console.error("Delegations:", error.message);
        return res.status(500).json({ message: "Unable to load manager delegations" });
    }
};

const setDelegation = async (req, res) => {
    try {
        if (req.profile.role !== "admin") return res.status(403).json({ message: "Only Admin can change Manager delegation authority" });
        const { manager_id, permission_code, department_id = null, can_grant = false, can_revoke = false, is_active = true } = req.body;
        if (!manager_id || !permission_code || (!can_grant && !can_revoke && is_active)) {
            return res.status(400).json({ message: "Manager, permission and at least one delegation action are required" });
        }
        const db = getAdminClient();
        const [{ data: manager, error: managerError }, { data: permission, error: permissionError }] = await Promise.all([
            db.from("profiles").select("id,role,department_id,manager_scope").eq("id", manager_id).maybeSingle(),
            db.from("permission_catalog").select("code").eq("code", permission_code).eq("is_active", true).maybeSingle()
        ]);
        if (managerError) throw managerError;
        if (permissionError) throw permissionError;
        if (!manager || manager.role !== "manager") return res.status(400).json({ message: "Delegation target must be an active Manager account" });
        if (!permission) return res.status(400).json({ message: "Unknown permission" });
        if (manager.manager_scope === "department" && department_id !== manager.department_id) {
            return res.status(400).json({ message: "Department Manager delegation must remain within their department" });
        }
        if (manager.manager_scope === "company" && department_id !== null) {
            return res.status(400).json({ message: "Company Manager delegation must use company-wide scope" });
        }
        const existing = await db.from("manager_delegations").select("id").eq("manager_id", manager_id)
            .eq("permission_code", permission_code).eq("is_active", true)
            .is("department_id", department_id).maybeSingle();
        if (existing.error) throw existing.error;
        const previous = existing.data;
        let saved;
        if (existing.data) {
            const result = await db.from("manager_delegations").update({
                can_grant: Boolean(can_grant), can_revoke: Boolean(can_revoke),
                is_active: Boolean(is_active), revoked_at: is_active ? null : new Date().toISOString()
            }).eq("id", existing.data.id).select().single();
            if (result.error) throw result.error;
            saved = result.data;
        } else {
            const result = await db.from("manager_delegations").insert({
                manager_id, permission_code, department_id, can_grant: Boolean(can_grant),
                can_revoke: Boolean(can_revoke), granted_by: req.user.id,
                is_active: Boolean(is_active), revoked_at: is_active ? null : new Date().toISOString()
            }).select().single();
            if (result.error) throw result.error;
            saved = result.data;
        }
        const { error: auditError } = await db.from("permission_audit_logs").insert({
            actor_id: req.user.id, target_user_id: manager_id, permission_code,
            action: is_active ? "delegate" : "undelegate",
            details: { department_id, can_grant: Boolean(can_grant), can_revoke: Boolean(can_revoke) }
        });
        if (auditError) throw auditError;
        const eventType = !is_active ? "delegation_revoked" : previous ? "delegation_updated" : "delegation_granted";
        try {
            await createAccessNotification(db, {
                userId: manager_id, actorId: req.user.id, eventType, permissionCode: permission_code,
                details: { department_id, can_grant: Boolean(can_grant), can_revoke: Boolean(can_revoke) }
            });
        } catch (notificationError) {
            console.error("Access notification delivery failed:", notificationError.message);
        }
        return res.json({ message: "Manager delegation updated", delegation: saved });
    } catch (error) {
        console.error("Set delegation:", error.message);
        return res.status(400).json({ message: error.message || "Unable to update delegation" });
    }
};

async function canManagerChange(db, actor, target, code, action) {
    if (actor.role === "admin") return true;
    if (actor.role !== "manager" || target.role !== "staff") return false;
    if (actor.manager_scope === "department" && actor.department_id !== target.department_id) return false;
    const { data, error } = await db.from("manager_delegations").select("id")
        .eq("manager_id", actor.id).eq("permission_code", code)
        .eq("is_active", true).eq(action === "grant" ? "can_grant" : "can_revoke", true)
        .or(actor.manager_scope === "company" ? "department_id.is.null" : `department_id.eq.${actor.department_id}`)
        .limit(1);
    if (error) throw error;
    return Boolean(data && data.length);
}

const changeStaffPermission = async (req, res) => {
    try {
        const { id } = req.params;
        const permission_code = String(req.body.permission_code || "").trim();
        const action = req.method === "DELETE" || req.body.action === "revoke" ? "revoke" : "grant";
        if (!permission_code) return res.status(400).json({ message: "permission_code is required" });
        const db = getAdminClient();
        const [{ data: target, error: targetError }, { data: definition, error: definitionError }] = await Promise.all([
            db.from("profiles").select("id,role,department_id").eq("id", id).maybeSingle(),
            db.from("permission_catalog").select("code,module_key").eq("code", permission_code).eq("is_active", true).maybeSingle()
        ]);
        if (targetError) throw targetError;
        if (definitionError) throw definitionError;
        if (!target || target.role === "admin" || (req.profile.role === "manager" && target.role !== "staff")) return res.status(403).json({ message: "Managers can only manage Staff permissions. Admin accounts and Manager accounts are protected." });
        if (!definition) return res.status(400).json({ message: "Unknown permission" });
        if (req.profile.role === "manager" &&
            (permission_code.startsWith("staff.") || permission_code.startsWith("permissions.") ||
             ["communication.complaints.review","communication.responsibility.manage"].includes(permission_code))) {
            return res.status(403).json({ message: "This permission is reserved for Admin or Manager-level administration and cannot be granted to Staff" });
        }
        if (!(await canManagerChange(db, req.profile, target, permission_code, action))) {
            return res.status(403).json({ message: "You have not been delegated authority to perform this permission change for this Staff member" });
        }
        let permissionChanged = false;
        if (action === "grant") {
            const { data: current, error: currentError } = await db.from("user_permissions").select("id")
                .eq("user_id", id).eq("permission_code", permission_code).eq("is_active", true).maybeSingle();
            if (currentError) throw currentError;
            if (!current) {
                const { error } = await db.from("user_permissions").insert({
                    user_id: id, permission_code, granted_by: req.user.id, is_active: true
                });
                if (error) throw error;
                permissionChanged = true;
            }
        } else {
            const { data: revokedRows, error } = await db.from("user_permissions").update({
                is_active: false, revoked_by: req.user.id, revoked_at: new Date().toISOString()
            }).eq("user_id", id).eq("permission_code", permission_code).eq("is_active", true).select("id");
            if (error) throw error;
            permissionChanged = Boolean(revokedRows && revokedRows.length);
        }
        if (!permissionChanged) return res.json({ message: action === "grant" ? "Staff permission is already active" : "Staff permission is already inactive" });
        const { error: auditError } = await db.from("permission_audit_logs").insert({
            actor_id: req.user.id, target_user_id: id, permission_code, action,
            details: { department_id: target.department_id }
        });
        if (auditError) throw auditError;
        try {
            await createAccessNotification(db, {
                userId: id, actorId: req.user.id,
                eventType: action === "grant" ? "permission_granted" : "permission_revoked",
                permissionCode: permission_code,
                details: { department_id: target.department_id }
            });
        } catch (notificationError) {
            console.error("Access notification delivery failed:", notificationError.message);
        }
        return res.json({ message: action === "grant" ? "Staff permission granted" : "Staff permission deactivated" });
    } catch (error) {
        console.error("Staff permission change:", error.message);
        return res.status(400).json({ message: error.message || "Unable to change Staff permission" });
    }
};


const listAccessNotifications = async (req, res) => {
    try {
        const { data, error } = await getAdminClient()
            .from("access_notifications")
            .select("id,event_type,permission_code,title,message,details,created_at,read_at")
            .eq("user_id", req.user.id)
            .order("created_at", { ascending: false })
            .limit(50);
        if (error) throw error;
        return res.json(data || []);
    } catch (error) {
        console.error("Access notifications:", error.message);
        return res.status(500).json({ message: "Unable to load access notifications" });
    }
};

const markAccessNotificationRead = async (req, res) => {
    try {
        const { data, error } = await getAdminClient()
            .from("access_notifications")
            .update({ read_at: new Date().toISOString() })
            .eq("id", req.params.notificationId)
            .eq("user_id", req.user.id)
            .is("read_at", null)
            .select("id,read_at")
            .maybeSingle();
        if (error) throw error;
        if (!data) return res.status(404).json({ message: "Access notification not found" });
        return res.json({ message: "Access notification marked as read", notification: data });
    } catch (error) {
        console.error("Mark access notification read:", error.message);
        return res.status(500).json({ message: "Unable to update access notification" });
    }
};

module.exports = { catalog, getDelegations, setDelegation, changeStaffPermission, listAccessNotifications, markAccessNotificationRead };
