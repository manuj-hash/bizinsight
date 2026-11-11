const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = process.env.SUPABASE_URL;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !publishableKey) {
    throw new Error("SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are required");
}

const authClient = createClient(supabaseUrl, publishableKey, {
    auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false
    }
});

// Every authenticated request gets its own client carrying that user's JWT.
// This is essential: validating a token with auth.getUser() does not, by itself,
// attach that token to later PostgREST/RPC requests.
function createUserClient(accessToken) {
    if (!accessToken || typeof accessToken !== "string") {
        throw new Error("A valid Supabase access token is required");
    }

    return createClient(supabaseUrl, publishableKey, {
        auth: {
            autoRefreshToken: false,
            persistSession: false,
            detectSessionInUrl: false
        },
        global: {
            headers: {
                Authorization: `Bearer ${accessToken}`
            }
        }
    });
}

// Privileged operations (Auth Admin and service_role-only RPCs) must use a
// server-only secret. Never import this client into frontend code.
let adminClient;

function getAdminClient() {
    const secretKey =
        process.env.SUPABASE_SECRET_KEY ||
        process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!secretKey) {
        throw new Error(
            "SUPABASE_SECRET_KEY is required for this administrator operation"
        );
    }

    if (!adminClient) {
        adminClient = createClient(supabaseUrl, secretKey, {
            auth: {
                autoRefreshToken: false,
                persistSession: false,
                detectSessionInUrl: false
            }
        });
    }

    return adminClient;
}

module.exports = {
    authClient,
    createUserClient,
    getAdminClient
};
