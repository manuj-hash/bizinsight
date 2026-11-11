const { authClient, createUserClient } = require("../config/supabase");

// Validate the bearer token, load the trusted database role, and attach a
// request-scoped Supabase client so every query is evaluated under that user.
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

        const { data: authData, error: authError } =
            await authClient.auth.getUser(token);

        if (authError || !authData.user) {
            return res.status(401).json({ message: "Invalid or expired token" });
        }

        const userClient = createUserClient(token);
        const { data: profile, error: profileError } = await userClient
            .from("profiles")
            .select("id, full_name, phone, role")
            .eq("id", authData.user.id)
            .maybeSingle();

        if (profileError) throw profileError;

        if (!profile || !["admin", "staff"].includes(profile.role)) {
            return res.status(403).json({
                message: "An active BizInsight staff account is required"
            });
        }

        req.user = authData.user;
        req.profile = profile;
        req.supabase = userClient;
        req.accessToken = token;

        return next();
    } catch (error) {
        console.error("Authentication error:", error.message);
        return res.status(401).json({ message: "Authentication failed" });
    }
};

const allowRoles = (...roles) => (req, res, next) => {
    if (!req.profile || !roles.includes(req.profile.role)) {
        return res.status(403).json({
            message: "You do not have permission to perform this action"
        });
    }
    return next();
};

module.exports = protect;
module.exports.allowRoles = allowRoles;
