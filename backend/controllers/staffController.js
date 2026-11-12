const crypto = require("crypto");
const { getAdminClient } = require("../config/supabase");

const adminClient = () => getAdminClient();
const managerCanAccessDepartment = (profile, departmentId) =>
    profile.role === "admin" ||
    (profile.role === "manager" && (
        profile.manager_scope === "company" ||
        profile.department_id === departmentId
    ));

const getStaff = async (req, res) => {
    try {
        const db = adminClient();
        let query = db.from("profiles")
            .select("id,full_name,phone,role,department_id,designation,manager_scope,reports_to,created_at,updated_at")
            .order("created_at", { ascending: false });

        if (req.profile.role === "manager") {
            query = query.neq("role", "admin");
            if (req.profile.manager_scope === "department") {
                query = query.eq("department_id", req.profile.department_id);
            }
        }

        const [{ data: staff, error }, { data: departments, error: departmentError }] = await Promise.all([
            query,
            db.from("departments").select("id,name,is_active").order("name")
        ]);
        if (error) throw error;
        if (departmentError) throw departmentError;

        const staffRows = staff || [];
        const ids = staffRows.map(person => person.id);
        let compensation = [];
        if (ids.length) {
            const result = await db.from("employee_compensation")
                .select("id,profile_id,base_salary,currency_code,pay_frequency,effective_from,effective_to")
                .in("profile_id", ids)
                .is("effective_to", null);
            if (result.error) throw result.error;
            compensation = result.data || [];
        }

        const departmentMap = new Map((departments || []).map(department => [department.id, department.name]));
        const salaryMap = new Map(compensation.map(item => [item.profile_id, item]));
        return res.json(staffRows.map(person => ({
            ...person,
            department_name: departmentMap.get(person.department_id) || null,
            compensation: salaryMap.get(person.id) || null
        })));
    } catch (error) {
        console.error("Staff list error:", error.message);
        return res.status(500).json({ message: "Unable to load staff records" });
    }
};

const inviteEmployee = async (req, res) => {
    try {
        const full_name = String(req.body.full_name || "").trim();
        const email = String(req.body.email || "").trim().toLowerCase();
        const phone = String(req.body.phone || "").trim();
        const role = req.body.role === "manager" ? "manager" : "staff";
        const departmentId = req.body.department_id || null;
        const designation = String(req.body.designation || "").trim();
        const scope = req.body.manager_scope || null;
        const reportsTo = req.body.reports_to || null;

        if (!full_name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({ message: "A valid name and email are required" });
        }
        if (req.profile.role === "manager" && role !== "staff") {
            return res.status(403).json({ message: "Only Admin can appoint Managers" });
        }
        if (req.profile.role === "manager" && req.profile.manager_scope === "department" &&
            departmentId !== req.profile.department_id) {
            return res.status(403).json({ message: "You can add staff only to your department" });
        }
        if (role === "staff" && !departmentId) {
            return res.status(400).json({ message: "Select a department for this employee" });
        }

        const db = adminClient();
        const { data, error } = await db.auth.admin.inviteUserByEmail(email, {
            data: { full_name, phone }
        });
        if (error) throw error;

        // The auth.users trigger creates the base profile synchronously.
        const { data: assigned, error: assignError } = await db.rpc("admin_set_bizinsight_employee", {
            p_actor_id: req.user.id,
            p_employee_id: data.user.id,
            p_role: role,
            p_department_id: departmentId,
            p_designation: designation || null,
            p_manager_scope: role === "manager" ? scope : null,
            p_reports_to: role === "manager" ? reportsTo : (req.profile.role === "manager" ? req.user.id : null)
        });
        if (assignError) throw assignError;

        return res.status(201).json({
            message: role === "manager" ? "Manager invitation sent." : "Staff invitation sent.",
            employee: { id: data.user.id, full_name, role: assigned.role, department_id: assigned.department_id }
        });
    } catch (error) {
        console.error("Staff invitation error:", error.message);
        return res.status(400).json({ message: error.message || "Unable to invite employee" });
    }
};

const updateEmployee = async (req, res) => {
    try {
        const db = adminClient();
        const { data: target, error: targetError } = await db.from("profiles")
            .select("id,role,department_id,manager_scope")
            .eq("id", req.params.id).maybeSingle();
        if (targetError) throw targetError;
        if (!target) return res.status(404).json({ message: "Employee not found" });
        if (target.role === "admin") return res.status(403).json({ message: "Admin accounts cannot be managed here" });

        const departmentId = req.body.department_id === undefined ? target.department_id : req.body.department_id;
        if (!managerCanAccessDepartment(req.profile, target.department_id) ||
            !managerCanAccessDepartment(req.profile, departmentId)) {
            return res.status(403).json({ message: "You cannot manage employees outside your department" });
        }

        const role = req.body.role || target.role;
        if (req.profile.role === "manager" && role !== "staff") {
            return res.status(403).json({ message: "Only Admin can appoint or change Managers" });
        }

        const { data, error } = await db.rpc("admin_set_bizinsight_employee", {
            p_actor_id: req.user.id,
            p_employee_id: req.params.id,
            p_role: role,
            p_department_id: departmentId,
            p_designation: req.body.designation === undefined ? null : String(req.body.designation).trim(),
            p_manager_scope: role === "manager" ? (req.body.manager_scope || target.manager_scope) : null,
            p_reports_to: role === "manager" ? (req.body.reports_to || null) : (req.profile.role === "manager" ? req.user.id : null)
        });
        if (error) throw error;
        return res.json({ message: "Staff record updated.", employee: data });
    } catch (error) {
        console.error("Staff update error:", error.message);
        return res.status(400).json({ message: error.message || "Unable to update employee" });
    }
};

const getDepartments = async (req, res) => {
    try {
        const { data, error } = await adminClient().from("departments")
            .select("id,name,description,is_active,created_at")
            .order("name");
        if (error) throw error;
        return res.json((data || []).filter(dept => dept.is_active || req.profile.role === "admin"));
    } catch (error) {
        return res.status(500).json({ message: "Unable to load departments" });
    }
};

const createDepartment = async (req, res) => {
    try {
        const name = String(req.body.name || "").trim();
        if (name.length < 2 || name.length > 80) {
            return res.status(400).json({ message: "Department name must be 2–80 characters" });
        }
        const { data, error } = await adminClient().from("departments")
            .insert({ name, description: String(req.body.description || "").trim() || null, created_by: req.user.id })
            .select("id,name,description,is_active,created_at").single();
        if (error) throw error;
        return res.status(201).json({ message: "Department created.", department: data });
    } catch (error) {
        return res.status(400).json({ message: error.message || "Unable to create department" });
    }
};

const updateDepartment = async (req, res) => {
    try {
        const db = adminClient();
        const { data: current, error: currentError } = await db.from("departments")
            .select("id").eq("id", req.params.id).maybeSingle();
        if (currentError) throw currentError;
        if (!current) return res.status(404).json({ message: "Department not found" });
        if (!managerCanAccessDepartment(req.profile, req.params.id)) {
            return res.status(403).json({ message: "You cannot modify this department" });
        }
        const updates = {};
        if (req.body.name !== undefined) updates.name = String(req.body.name).trim();
        if (req.body.description !== undefined) updates.description = String(req.body.description).trim() || null;
        if (req.body.is_active !== undefined) {
            if (req.profile.role !== "admin") return res.status(403).json({ message: "Only Admin can deactivate departments" });
            if (req.body.is_active === false) {
                const { count, error } = await db.from("profiles").select("id", { count: "exact", head: true })
                    .eq("department_id", req.params.id);
                if (error) throw error;
                if (count) return res.status(409).json({ message: "Reassign employees before deactivating this department" });
            }
            updates.is_active = Boolean(req.body.is_active);
        }
        const { data, error } = await db.from("departments").update(updates)
            .eq("id", req.params.id).select("id,name,description,is_active").single();
        if (error) throw error;
        return res.json({ message: "Department updated.", department: data });
    } catch (error) {
        return res.status(400).json({ message: error.message || "Unable to update department" });
    }
};

const getPreferences = async (req, res) => {
    try {
        const { data, error } = await adminClient().from("company_preferences").select("*").eq("id", true).single();
        if (error) throw error;
        return res.json(data);
    } catch (error) {
        return res.status(500).json({ message: "Unable to load preferences" });
    }
};

const updatePreferences = async (req, res) => {
    try {
        const { data, error } = await adminClient().rpc("update_bizinsight_preferences", {
            p_actor_id: req.user.id,
            p_management_mode: req.profile.role === "admin" ? (req.body.management_mode || null) : null,
            p_frequent_customer_min_orders: req.body.frequent_customer_min_orders ?? null,
            p_high_value_customer_amount: req.body.high_value_customer_amount ?? null
        });
        if (error) throw error;
        return res.json({ message: "Preferences updated.", preferences: data });
    } catch (error) {
        return res.status(400).json({ message: error.message || "Unable to update preferences" });
    }
};

const updateCompensation = async (req, res) => {
    try {
        const salary = Number(req.body.base_salary);
        if (!Number.isFinite(salary) || salary < 0) {
            return res.status(400).json({ message: "Enter a valid non-negative salary" });
        }
        const { data, error } = await adminClient().rpc("set_bizinsight_employee_compensation", {
            p_actor_id: req.user.id,
            p_employee_id: req.params.id,
            p_base_salary: salary,
            p_currency_code: String(req.body.currency_code || "INR").toUpperCase(),
            p_pay_frequency: req.body.pay_frequency || "monthly",
            p_effective_from: req.body.effective_from || new Date().toISOString().slice(0, 10),
            p_notes: req.body.notes || null
        });
        if (error) throw error;
        return res.json({ message: "Compensation updated.", compensation: data });
    } catch (error) {
        return res.status(400).json({ message: error.message || "Unable to update compensation" });
    }
};

module.exports = {
    getStaff, inviteEmployee, updateEmployee,
    getDepartments, createDepartment, updateDepartment,
    getPreferences, updatePreferences, updateCompensation
};
