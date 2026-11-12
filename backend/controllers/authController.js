const { createAnonClient, createUserClient } = require("../config/supabase");

const register = async (req, res) => res.status(403).json({
    message: "Public registration is disabled. Ask a BizInsight administrator for an invitation."
});

const login = async (req, res) => {
    try {
        const email = String(req.body.email || "").trim().toLowerCase();
        const password = req.body.password;
        if (!email || typeof password !== "string" || !password) {
            return res.status(400).json({ message: "Email and password are required" });
        }

        const anonClient = createAnonClient();
        const { data, error } = await anonClient.auth.signInWithPassword({ email, password });
        if (error || !data.session || !data.user) {
            return res.status(401).json({ message: "Invalid email or password" });
        }

        const userClient = createUserClient(data.session.access_token);
        let { data: profile, error: profileError } = await userClient
            .from("profiles")
            .select("id,full_name,phone,role,department_id,designation,manager_scope,reports_to")
            .eq("id", data.user.id)
            .maybeSingle();

        // Backward compatibility while the review-only Phase 1.1 migration is pending.
        if (profileError && ["42703", "PGRST204", "PGRST205"].includes(profileError.code)) {
            const legacy = await userClient.from("profiles")
                .select("id,full_name,phone,role")
                .eq("id", data.user.id).maybeSingle();
            profile = legacy.data ? {
                ...legacy.data, department_id: null, designation: null,
                manager_scope: null, reports_to: null
            } : null;
            profileError = legacy.error;
        }
        if (profileError) throw profileError;
        if (!profile || !["admin", "manager", "staff"].includes(profile.role)) {
            await anonClient.auth.signOut();
            return res.status(403).json({ message: "Your account is not enabled for BizInsight access" });
        }

        return res.status(200).json({
            message: "Login successful",
            user: { id: data.user.id, email: data.user.email },
            profile,
            token: data.session.access_token,
            refreshToken: data.session.refresh_token,
            expiresAt: data.session.expires_at
        });
    } catch (error) {
        console.error("Login error:", error.message);
        return res.status(500).json({ message: "Unable to complete login" });
    }
};

const getMe = async (req, res) => {
    try {
        const { data: profile, error } = await req.supabase
            .from("profiles")
            .select("id,full_name,phone,role,department_id,designation,manager_scope,reports_to,created_at,updated_at")
            .eq("id", req.user.id)
            .maybeSingle();
        if (error) throw error;
        if (!profile) return res.status(404).json({ message: "Profile not found" });
        return res.json({ user: { id: req.user.id, email: req.user.email }, profile });
    } catch (error) {
        console.error("Get profile error:", error.message);
        return res.status(500).json({ message: "Unable to fetch user profile" });
    }
};

module.exports = { register, login, getMe };
