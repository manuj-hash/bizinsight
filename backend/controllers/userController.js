const { getAdminClient } = require("../config/supabase");

const getUsers = async (req, res) => {
    try {
        // This endpoint is admin-only at the route layer.
        const { data, error } = await getAdminClient().from("profiles")
            .select("id, full_name, phone, role, created_at, updated_at")
            .order("created_at", { ascending: false });
        if (error) throw error;
        return res.json(data || []);
    } catch (error) {
        console.error("Get users error:", error.message);
        return res.status(500).json({ message: "Unable to fetch users" });
    }
};

const getUser = async (req, res) => {
    try {
        const { data, error } = await req.supabase.from("profiles")
            .select("id, full_name, phone, role, created_at, updated_at")
            .eq("id", req.user.id).maybeSingle();
        if (error) throw error;
        if (!data) return res.status(404).json({ message: "Profile not found" });
        return res.json(data);
    } catch (error) {
        return res.status(500).json({ message: "Unable to fetch profile" });
    }
};

const updateMyProfile = async (req, res) => {
    try {
        const updates = {};
        if (req.body.full_name !== undefined) {
            if (typeof req.body.full_name !== "string" || !req.body.full_name.trim()) {
                return res.status(400).json({ message: "full_name must be a non-empty string" });
            }
            updates.full_name = req.body.full_name.trim();
        }
        if (req.body.phone !== undefined) updates.phone = String(req.body.phone).trim();
        if (!Object.keys(updates).length) {
            return res.status(400).json({ message: "No valid profile fields provided" });
        }

        const { data, error } = await req.supabase.from("profiles").update(updates)
            .eq("id", req.user.id)
            .select("id, full_name, phone, role, created_at, updated_at").single();
        if (error) throw error;
        return res.json({ message: "Profile updated successfully", profile: data });
    } catch (error) {
        console.error("Update profile error:", error.message);
        return res.status(400).json({ message: "Unable to update profile" });
    }
};

const updateUserRole = async (req, res) => {
    try {
        const { role } = req.body;
        if (!["admin", "staff"].includes(role)) {
            return res.status(400).json({ message: "Role must be admin or staff" });
        }
        if (req.params.id === req.user.id) {
            return res.status(400).json({ message: "You cannot change your own role" });
        }

        const adminClient = getAdminClient();
        const { data: target, error: targetError } = await adminClient.from("profiles")
            .select("id, role").eq("id", req.params.id).maybeSingle();
        if (targetError) throw targetError;
        if (!target) return res.status(404).json({ message: "User profile not found" });

        if (target.role === "admin" && role === "staff") {
            const { count, error: countError } = await adminClient.from("profiles")
                .select("id", { count: "exact", head: true }).eq("role", "admin");
            if (countError) throw countError;
            if ((count || 0) <= 1) {
                return res.status(409).json({ message: "The last administrator cannot be demoted" });
            }
        }

        const { data, error } = await adminClient.from("profiles").update({ role })
            .eq("id", req.params.id)
            .select("id, full_name, phone, role").maybeSingle();
        if (error) throw error;
        if (!data) return res.status(404).json({ message: "User profile not found" });
        return res.json({ message: "User role updated successfully", user: data });
    } catch (error) {
        console.error("Update user role error:", error.message);
        return res.status(400).json({ message: "Unable to update user role" });
    }
};

const inviteStaff = require("./authController").inviteStaff;
module.exports = { getUsers, getUser, updateMyProfile, updateUserRole, inviteStaff };
