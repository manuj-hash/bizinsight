const { createUserClient, getAdminClient } = require("../config/supabase");

const protect = async (req, res, next) => {
    try {
        const header = req.headers.authorization || "";
        if (!header.startsWith("Bearer ")) return res.status(401).json({ message: "Authorization token missing" });
        const token = header.slice(7).trim();
        if (!token) return res.status(401).json({ message: "Authorization token missing" });

        const userClient = createUserClient(token);
        const { data: authData, error: authError } = await userClient.auth.getUser(token);
        if (authError || !authData.user) return res.status(401).json({ message: "Invalid or expired token" });

        let { data: profile, error: profileError } = await userClient.from("profiles")
            .select("id,full_name,phone,role,department_id,designation,manager_scope,reports_to")
            .eq("id", authData.user.id).maybeSingle();
        if (profileError && ["42703","PGRST204","PGRST205"].includes(profileError.code)) {
            const legacy=await userClient.from("profiles").select("id,full_name,phone,role")
                .eq("id",authData.user.id).maybeSingle();
            profile=legacy.data?{...legacy.data,department_id:null,designation:null,manager_scope:null,reports_to:null}:null;
            profileError=legacy.error;
        }
        if(profileError)throw profileError;
        if(!profile||!["admin","manager","staff"].includes(profile.role))
            return res.status(403).json({message:"An active BizInsight employee account is required"});

        req.user=authData.user;
        req.profile=profile;
        req.supabase=userClient;
        req.adminDb=getAdminClient();
        req.permissions=new Set();

        if(profile.role!=="admin"){
            const {data,error}=await req.adminDb.from("user_permissions")
                .select("permission_code").eq("user_id",profile.id).eq("is_active",true);
            if(error&&!["42P01","PGRST204","PGRST205"].includes(error.code))throw error;
            (data||[]).forEach(row=>req.permissions.add(row.permission_code));
        }
        return next();
    }catch(error){
        console.error("Authentication error:",error.message);
        return res.status(401).json({message:"Authentication failed"});
    }
};

const allowRoles=(...roles)=>(req,res,next)=>{
    if(!req.profile||!roles.includes(req.profile.role))
        return res.status(403).json({message:"You do not have permission to perform this action"});
    return next();
};

const requirePermission=(...codes)=>(req,res,next)=>{
    if(!req.profile)return res.status(401).json({message:"Authentication required"});
    if(req.profile.role==="admin")return next();
    if(codes.some(code=>req.permissions&&req.permissions.has(code)))return next();
    return res.status(403).json({message:"This module or action has not been granted to your account"});
};

module.exports=protect;
module.exports.allowRoles=allowRoles;
module.exports.requirePermission=requirePermission;
