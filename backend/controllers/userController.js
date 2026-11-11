const { createAuthClient, getAdminClient } = require("../config/supabase");

const getUsers = async (req, res) => {
    try {
        const { data, error } = await req.supabase
            .from("profiles")
            .select("id, full_name, phone, role, created_at, updated_at")
            .order("created_at", { ascending: false });
        if (error) throw error;
        return res.status(200).json(data || []);
    } catch (error) {
        return res.status(500).json({ message: "Unable to load users" });
    }
};

const getUser = async (req, res) => {
    try {
        const { data, error } = await req.supabase
            .from("profiles")
            .select("id, full_name, phone, role, created_at, updated_at")
            .eq("id", req.user.id)
            .maybeSingle();
        if (error) throw error;
        if (!data) return res.status(404).json({ message: "Profile not found" });
        return res.status(200).json(data);
    } catch (error) {
        return res.status(500).json({ message: "Unable to load profile" });
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
        if (req.body.phone !== undefined) {
            updates.phone = String(req.body.phone).trim();
        }
        if (!Object.keys(updates).length) {
            return res.status(400).json({ message: "No valid profile fields provided" });
        }

        const { data, error } = await req.supabase
            .from("profiles")
            .update(updates)
            .eq("id", req.user.id)
            .select("id, full_name, phone, role, created_at, updated_at")
            .single();
        if (error) throw error;

        return res.status(200).json({
            message: "Profile updated successfully",
            profile: data
        });
    } catch (error) {
        return res.status(400).json({ message: error.message || "Unable to update profile" });
    }
};

const updateUserRole = async (req, res) => {
    try {
        const { role } = req.body;
        if (!["admin", "staff"].includes(role)) {
            return res.status(400).json({ message: "Role must be admin or staff" });
        }
        if (req.params.id === req.user.id && role !== "admin") {
            return res.status(400).json({ message: "You cannot remove your own admin role" });
        }

        // The database function serializes role changes and protects the last admin.
        const { data, error } = await getAdminClient().rpc(
            "admin_update_bizinsight_user_role",
            { p_user_id: req.params.id, p_role: role }
        );
        if (error) throw error;

        return res.status(200).json({
            message: "User role updated successfully",
            user: data
        });
    } catch (error) {
        return res.status(400).json({
            message: error.message || "Unable to update user role. Apply the approved BizInsight migration first."
        });
    }
};


const updateMyPassword = async (req, res) => {
    try {
        const currentPassword = req.body.current_password;
        const newPassword = req.body.new_password;

        if (typeof currentPassword !== "string" || !currentPassword ||
            typeof newPassword !== "string" || newPassword.length < 8) {
            return res.status(400).json({
                message: "Current password and a new password of at least 8 characters are required"
            });
        }

        // Verify the caller knows their current password before using the
        // server-only Auth Admin API to update their own account.
        const { data: verified, error: verifyError } =
            await createAuthClient().auth.signInWithPassword({
                email: req.user.email,
                password: currentPassword
            });

        if (verifyError || !verified.user || verified.user.id !== req.user.id) {
            return res.status(400).json({ message: "Current password is incorrect" });
        }

        const { error: updateError } = await getAdminClient().auth.admin.updateUserById(
            req.user.id,
            { password: newPassword }
        );
        if (updateError) throw updateError;

        return res.status(200).json({ message: "Password updated successfully. Please sign in again." });
    } catch (error) {
        console.error("Update password:", error.message);
        return res.status(400).json({ message: error.message || "Unable to update password" });
    }
};

const inviteStaff = require("./authController").inviteStaff;
module.exports = { getUsers, getUser, updateMyProfile, updateMyPassword, updateUserRole, inviteStaff };
