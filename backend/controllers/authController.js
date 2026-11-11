
const supabase = require("../config/supabase");

// REGISTER
// Public registration is disabled.
// Staff accounts must be invited by an administrator.
const register = async (req, res) => {
    return res.status(403).json({
        message: "Public registration is disabled. Ask a BizInsight administrator for an invitation."
    });
};


// LOGIN
const login = async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                message: "Email and password are required"
            });
        }

        const { data, error } =
            await supabase.auth.signInWithPassword({
                email: email.trim(),
                password
            });

        if (error) {
            return res.status(401).json({
                message: error.message
            });
        }

        // Fetch user profile
        const {
            data: profile,
            error: profileError
        } = await supabase
            .from("profiles")
            .select("id, full_name, phone, role")
            .eq("id", data.user.id)
            .maybeSingle();

        if (profileError) {
            throw profileError;
        }

        // Allow only Admin and Staff
        if (!profile || !["admin", "staff"].includes(profile.role)) {
            return res.status(403).json({
                message: "Your account is not enabled for BizInsight staff access"
            });
        }

        return res.status(200).json({
            message: "Login successful",
            user: data.user,
            profile: profile,
            token: data.session.access_token,
            refreshToken: data.session.refresh_token
        });

    } catch (error) {
        console.error("Login Error:", error);

        return res.status(500).json({
            message: error.message || "Login failed"
        });
    }
};


// GET CURRENT USER
const getMe = async (req, res) => {
    try {
        const {
            data: profile,
            error
        } = await supabase
            .from("profiles")
            .select("*")
            .eq("id", req.user.id)
            .maybeSingle();

        if (error) {
            return res.status(400).json({
                message: error.message
            });
        }

        return res.status(200).json({
            user: req.user,
            profile: profile
        });

    } catch (error) {
        console.error("GetMe Error:", error);

        return res.status(500).json({
            message: error.message || "Unable to fetch user profile"
        });
    }
};


// INVITE STAFF
const inviteStaff = async (req, res) => {
    try {
        const email = String(req.body.email || "")
            .trim()
            .toLowerCase();

        const full_name = String(req.body.full_name || "")
            .trim();

        const phone = req.body.phone
            ? String(req.body.phone).trim()
            : "";

        // Validate email
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

        if (!email || !emailRegex.test(email)) {
            return res.status(400).json({
                message: "A valid email address is required"
            });
        }

        if (!full_name) {
            return res.status(400).json({
                message: "Full name is required"
            });
        }

        // Send Supabase invitation
        const {
            data,
            error
        } = await supabase.auth.admin.inviteUserByEmail(
            email,
            {
                data: {
                    full_name: full_name,
                    phone: phone
                }
            }
        );

        if (error) {
            throw error;
        }

        return res.status(201).json({
            message: "Staff invitation sent. The user will receive an email to activate their account.",
            user: {
                id: data.user.id,
                email: data.user.email
            }
        });

    } catch (error) {
        console.error("Invite Staff Error:", error);

        return res.status(400).json({
            message: error.message || "Unable to invite staff"
        });
    }
};


// EXPORT CONTROLLERS
module.exports = {
    register,
    login,
    getMe,
    inviteStaff
};
