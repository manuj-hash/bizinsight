const { getAdminClient } = require("../config/supabase");

const scopedStaff = async (db, actor, userId) => {
    const { data: target, error } = await db.from("profiles").select("id,role,department_id,full_name")
        .eq("id", userId).maybeSingle();
    if (error) throw error;
    if (!target) return null;
    if (actor.role === "admin") return target;
    if (actor.role === "manager" && target.role === "staff" &&
        (actor.manager_scope === "company" || actor.department_id === target.department_id)) return target;
    return false;
};

const getStaffPermissions = async (req,res) => {
    try {
        const db=getAdminClient();
        const target=await scopedStaff(db,req.profile,req.params.id);
        if(target===null)return res.status(404).json({message:"Employee not found"});
        if(!target)return res.status(403).json({message:"You cannot view permissions for this account"});
        const [{data:catalog,error:catalogError},{data:assigned,error:assignedError}] = await Promise.all([
            db.from("permission_catalog").select("code,module_key,label,sort_order").eq("is_active",true).order("sort_order"),
            db.from("user_permissions").select("permission_code,is_active,granted_by,granted_at,revoked_at")
                .eq("user_id",req.params.id).order("granted_at",{ascending:false})
        ]);
        if(catalogError)throw catalogError;
        if(assignedError)throw assignedError;
        let delegations=[];
        if(req.profile.role==="manager"){
            const result=await db.from("manager_delegations").select("permission_code,can_grant,can_revoke,department_id")
                .eq("manager_id",req.user.id).eq("is_active",true);
            if(result.error)throw result.error;
            delegations=result.data||[];
        }
        return res.json({employee:{id:target.id,full_name:target.full_name,role:target.role},catalog:catalog||[],assigned:assigned||[],delegations});
    }catch(error){
        console.error("Staff permissions:",error.message);
        return res.status(500).json({message:"Unable to load staff permissions"});
    }
};

module.exports={...require("./permissionController"),getStaffPermissions};
