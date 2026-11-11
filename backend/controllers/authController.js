const { authClient, createUserClient, getAdminClient } = require("../config/supabase");

// Public registration is intentionally disabled. Administrators invite staff.
const register = async (req, res) => {
    return res.status(403).json({
        message: "Public registration is disabled. Ask a BizInsight administrator for an invitation."
    });
};

const login = async (req, res) => {
    try {
        const email = String(req.body.email || "").trim().toLowerCase();
        const password = req.body.password;

        if (!email || typeof password !== "string" || !password) {
            return res.status(400).json({
                message: "Email and password are required"
            });
        }

        const { data, error } = await authClient.auth.signInWithPassword({
            email,
            password
        });

        if (error || !data.user || !data.session) {
            return res.status(401).json({
                message: "Invalid email or password"
            });
        }

        const userClient = createUserClient(data.session.access_token);
        const { data: profile, error: profileError } = await userClient
            .from("profiles")
            .select("id, full_name, phone, role")
            .eq("id", data.user.id)
            .maybeSingle();

        if (profileError) throw profileError;

        if (!profile || !["admin", "staff"].includes(profile.role)) {
            return res.status(403).json({
                message: "Your account is not enabled for BizInsight staff access"
            });
        }

        return res.status(200).json({
            message: "Login successful",
            user: {
                id: data.user.id,
                email: data.user.email
            },
            profile,
            token: data.session.access_token,
            refreshToken: data.session.refresh_token,
            expiresAt: data.session.expires_at
        });
    } catch (error) {
        console.error("Login error:", error.message);
        return res.status(500).json({
            message: "Login failed. Please try again."
        });
    }
};

const getMe = async (req, res) => {
    try {
        const { data: profile, error } = await req.supabase
            .from("profiles")
            .select("id, full_name, phone, role, created_at, updated_at")
            .eq("id", req.user.id)
            .maybeSingle();

        if (error) throw error;
        if (!profile) {
            return res.status(404).json({ message: "Profile not found" });
        }

        return res.status(200).json({
            user: {
                id: req.user.id,
                email: req.user.email
            },
            profile
        });
    } catch (error) {
        console.error("Get current user error:", error.message);
        return res.status(500).json({
            message: "Unable to fetch user profile"
        });
    }
};

const inviteStaff = async (req, res) => {
    try {
        const email = String(req.body.email || "").trim().toLowerCase();
        const fullName = String(req.body.full_name || "").trim();
        const phone = req.body.phone ? String(req.body.phone).trim() : "";

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!email || !emailRegex.test(email)) {
            return res.status(400).json({ message: "A valid email address is required" });
        }
        if (!fullName) {
            return res.status(400).json({ message: "Full name is required" });
        }

        // Auth Admin APIs require a secret key and must remain server-side.
        const { data, error } = await getAdminClient().auth.admin.inviteUserByEmail(
            email,
            { data: { full_name: fullName, phone } }
        );

        if (error) throw error;

        return res.status(201).json({
            message: "Staff invitation sent",
            user: {
                id: data.user.id,
                email: data.user.email
            }
        });
    } catch (error) {
        console.error("Invite staff error:", error.message);
        return res.status(400).json({
            message: error.message || "Unable to invite staff"
        });
    }
};

module.exports = {
    register,
    login,
    getMe,
    inviteStaff
};
