const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = process.env.SUPABASE_URL;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
const adminKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !publishableKey) {
    throw new Error("SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are required");
}

const authOptions = {
    auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false
    }
};

// Use this client only for public sign-in operations.
const createAnonClient = () => createClient(supabaseUrl, publishableKey, authOptions);

// Every authenticated request gets its own client, scoped to that user's JWT.
// This makes Postgres RLS policies apply to the actual signed-in user.
const createUserClient = (accessToken) => {
    if (!accessToken) throw new Error("An access token is required");
    return createClient(supabaseUrl, publishableKey, {
        ...authOptions,
        global: {
            headers: { Authorization: `Bearer ${accessToken}` }
        }
    });
};

// Privileged operations must only run on the server after authorization.
// Never expose this client or its key to browser code.
const getAdminClient = () => {
    if (!adminKey) {
        throw new Error("SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) is required for this administrator operation");
    }
    return createClient(supabaseUrl, adminKey, authOptions);
};

module.exports = { createAnonClient, createUserClient, getAdminClient };
