const supabase = require("../config/supabase");

// Validate the Supabase access token AND load the trusted role from profiles.
// Never authorize using user_metadata: users can edit their own user metadata.
const protect = async (req, res, next) => {
    try {
        const header = req.headers.authorization || "";
        if (!header.startsWith("Bearer ")) {
            return res.status(401).json({ message: "Authorization token missing" });
        }
        const token = header.slice(7).trim();
        if (!token) return res.status(401).json({ message: "Authorization token missing" });

        const { data: authData, error: authError } = await supabase.auth.getUser(token);
        if (authError || !authData.user) {
            return res.status(401).json({ message: "Invalid or expired token" });
        }

        const { data: profile, error: profileError } = await supabase
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
        next();
    } catch (error) {
        console.error("Authentication error:", error.message);
        return res.status(401).json({ message: "Authentication failed" });
    }
};

const allowRoles = (...roles) => (req, res, next) => {
    if (!req.profile || !roles.includes(req.profile.role)) {
        return res.status(403).json({ message: "You do not have permission to perform this action" });
    }
    next();
};

module.exports = protect;
module.exports.allowRoles = allowRoles;
