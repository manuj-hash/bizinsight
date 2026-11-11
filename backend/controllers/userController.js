const supabase = require("../config/supabase");

const getUsers = async (req, res) => {
    try {
        const { data, error } = await supabase.from("profiles")
            .select("id, full_name, phone, role, created_at, updated_at")
            .order("created_at", { ascending: false });
        if (error) throw error;
        res.json(data || []);
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const getUser = async (req, res) => {
    try {
        const { data, error } = await supabase.from("profiles")
            .select("id, full_name, phone, role, created_at, updated_at")
            .eq("id", req.user.id).maybeSingle();
        if (error) throw error;
        if (!data) return res.status(404).json({ message: "Profile not found" });
        res.json(data);
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const updateMyProfile = async (req, res) => {
    try {
        const updates = {};
        if (req.body.full_name !== undefined) {
            if (typeof req.body.full_name !== "string" || !req.body.full_name.trim())
                return res.status(400).json({ message: "full_name must be a non-empty string" });
            updates.full_name = req.body.full_name.trim();
        }
        if (req.body.phone !== undefined) updates.phone = String(req.body.phone).trim();
        if (!Object.keys(updates).length) return res.status(400).json({ message: "No valid profile fields provided" });

        const { data, error } = await supabase.from("profiles").update(updates)
            .eq("id", req.user.id)
            .select("id, full_name, phone, role, created_at, updated_at").single();
        if (error) throw error;
        res.json({ message: "Profile updated successfully", profile: data });
    } catch (error) { res.status(400).json({ message: error.message }); }
};

const updateUserRole = async (req, res) => {
    try {
        const { role } = req.body;
        if (!["admin", "staff"].includes(role))
            return res.status(400).json({ message: "Role must be admin or staff" });
        if (req.params.id === req.user.id && role !== "admin")
            return res.status(400).json({ message: "You cannot remove your own admin role" });

        const { data, error } = await supabase.from("profiles").update({ role })
            .eq("id", req.params.id)
            .select("id, full_name, phone, role").maybeSingle();
        if (error) throw error;
        if (!data) return res.status(404).json({ message: "User profile not found" });
        res.json({ message: "User role updated successfully", user: data });
    } catch (error) { res.status(400).json({ message: error.message }); }
};

const inviteStaff = require("./authController").inviteStaff;
module.exports = { getUsers, getUser, updateMyProfile, updateUserRole, inviteStaff };
