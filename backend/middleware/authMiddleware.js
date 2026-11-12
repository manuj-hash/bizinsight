const { createUserClient } = require("../config/supabase");

// Validate the access token and load the role from the protected profiles table.
// Role decisions must never use user-editable user_metadata.
const protect = async (req, res, next) => {
    try {
        const header = req.headers.authorization || "";
        if (!header.startsWith("Bearer ")) {
            return res.status(401).json({ message: "Authorization token missing" });
        }

        const token = header.slice(7).trim();
        if (!token) {
            return res.status(401).json({ message: "Authorization token missing" });
        }

        const userClient = createUserClient(token);
        const { data: authData, error: authError } = await userClient.auth.getUser(token);

        if (authError || !authData.user) {
            return res.status(401).json({ message: "Invalid or expired token" });
        }

        const { data: profile, error: profileError } = await userClient
            .from("profiles")
            .select("id, full_name, phone, role")
            .eq("id", authData.user.id)
            .maybeSingle();

        if (profileError) throw profileError;
        if (!profile || !["admin", "staff"].includes(profile.role)) {
            return res.status(403).json({ message: "An active BizInsight staff account is required" });
        }

        req.user = authData.user;
        req.profile = profile;
        req.supabase = userClient;
        return next();
    } catch (error) {
        console.error("Authentication error:", error.message);
        return res.status(401).json({ message: "Authentication failed" });
    }
};

const allowRoles = (...roles) => (req, res, next) => {
    if (!req.profile || !roles.includes(req.profile.role)) {
        return res.status(403).json({ message: "You do not have permission to perform this action" });
    }
    return next();
};

module.exports = protect;
module.exports.allowRoles = allowRoles;
