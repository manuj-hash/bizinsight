const { getAdminClient } = require("../config/supabase");

const has = (req, code) => req.profile.role === "admin" || req.permissions.has(code);
const canSeeDepartment = (profile, departmentId) => profile.role === "admin" ||
    profile.manager_scope === "company" ||
    (profile.role === "manager" && profile.department_id === departmentId) ||
    (profile.role === "staff" && profile.department_id === departmentId);

const listMessages = async (req,res) => {
    try {
        if(!has(req,"communication.access"))return res.status(403).json({message:"Communication access has not been granted"});
        const db=getAdminClient();
        let query=db.from("communication_messages").select("*,profiles!communication_messages_sender_id_fkey(full_name,role)")
            .order("created_at",{ascending:false}).limit(200);
        if(req.profile.role!=="admin"){
            const filters=[];
            if(req.profile.department_id)filters.push("department_id.eq."+req.profile.department_id);
            // General messages are returned only when explicitly targeted to this user's department.
            if(req.profile.manager_scope==="company"){} else if(filters.length)query=query.or(`department_id.eq.${req.profile.department_id},target_department_ids.cs.{${req.profile.department_id}}`);
            else query=query.eq("message_type","general").eq("id","00000000-0000-0000-0000-000000000000");
        }
        const {data,error}=await query;
        if(error)throw error;
        const visible=(data||[]).filter(m=>m.message_type==="team"
            ? req.profile.role==="admin" || (req.permissions.has("communication.team") && (req.profile.manager_scope==="company" || m.department_id===req.profile.department_id))
            : req.profile.role==="admin" || (req.profile.manager_scope==="company" || (req.profile.department_id && (m.target_department_ids||[]).includes(req.profile.department_id)));
        return res.json(visible);
    }catch(error){console.error("Messages:",error.message);return res.status(500).json({message:"Unable to load communication messages"});}
};

const createMessage = async (req,res) => {
    try{
        const {message_type="team",title,body,priority="normal",target_department_ids=[]}=req.body;
        if(!["team","general"].includes(message_type))return res.status(400).json({message:"Invalid message type"});
        const db=getAdminClient();
        let departmentId=null;
        if(message_type==="team"){
            if(!has(req,"communication.team"))return res.status(403).json({message:"Team communication access is not granted"});
            if(req.profile.role==="staff"||req.profile.manager_scope==="department")departmentId=req.profile.department_id;
            else departmentId=req.body.department_id||req.profile.department_id;
            if(!departmentId||!canSeeDepartment(req.profile,departmentId))return res.status(403).json({message:"You cannot post to this department"});
        }else{
            if(!has(req,"communication.general.publish"))return res.status(403).json({message:"General announcement publishing is not granted"});
            if(req.profile.role!=="admin"){
                const publisherDepartment=req.body.publisher_department_id||req.profile.department_id;
                if(!publisherDepartment||(req.profile.manager_scope!=="company"&&publisherDepartment!==req.profile.department_id))
                    return res.status(403).json({message:"Choose an authorized publishing department"});
                const {data:responsibility,error}=await db.from("communication_responsibilities").select("active_publisher_user_id")
                    .eq("department_id",publisherDepartment).maybeSingle();
                if(error)throw error;
                if(!responsibility||responsibility.active_publisher_user_id!==req.user.id)
                    return res.status(403).json({message:"Only the currently assigned primary or activated backup communicator can publish general announcements"});
            }
            if(!Array.isArray(target_department_ids)||!target_department_ids.length)
                return res.status(400).json({message:"Select at least one receiving department"});
            
        }
        if(typeof title!=="string"||title.trim().length<2||typeof body!=="string"||body.trim().length<2)
            return res.status(400).json({message:"A title and message are required"});
        const {data,error}=await db.from("communication_messages").insert({
            message_type,department_id:departmentId,target_department_ids:message_type==="general"?target_department_ids:[],
            sender_id:req.user.id,title:title.trim(),body:body.trim(),priority
        }).select().single();
        if(error)throw error;
        const recipients=message_type==="team"?[departmentId]:target_department_ids;
        const {data:people,error:peopleError}=await db.from("profiles").select("id").in("department_id",recipients);
        if(peopleError)throw peopleError;
        const notifications=(people||[]).filter(p=>p.id!==req.user.id).map(p=>({
            user_id:p.id,message_id:data.id,
            notification_type:message_type==="team"?"team_message":"general_announcement",
            title:data.title
        }));
        if(notifications.length){const saved=await db.from("communication_notifications").insert(notifications);if(saved.error)throw saved.error;}
        return res.status(201).json({message:"Message published and recipients notified",item:data});
    }catch(error){console.error("Create message:",error.message);return res.status(400).json({message:error.message||"Unable to publish message"});}
};

const listIssues = async(req,res)=>{
    try{
        if(!has(req,"communication.issues.access"))return res.status(403).json({message:"Work issue access has not been granted"});
        const db=getAdminClient();
        let query=db.from("communication_issues").select("*").order("created_at",{ascending:false}).limit(200);
        if(req.profile.role==="staff")query=query.or(`department_id.eq.${req.profile.department_id},assigned_to.eq.${req.user.id}`);
        else if(req.profile.role==="staff"||(req.profile.role==="manager"&&req.profile.manager_scope==="department"))query=query.eq("department_id",req.profile.department_id);
        const {data,error}=await query;if(error)throw error;return res.json(data||[]);
    }catch(error){console.error("Issues:",error.message);return res.status(500).json({message:"Unable to load work issues"});}
};

const createIssue=async(req,res)=>{
    try{
        if(!has(req,"communication.issues.access"))return res.status(403).json({message:"Work issue reporting is not granted"});
        const department_id=req.profile.department_id||req.body.department_id;
        if(!department_id||!canSeeDepartment(req.profile,department_id))return res.status(403).json({message:"Invalid issue department"});
        const {title,description,priority="normal",affected_department_ids=[]}=req.body;
        if(typeof title!=="string"||title.trim().length<2||typeof description!=="string"||description.trim().length<2)
            return res.status(400).json({message:"Issue title and description are required"});
        if(req.profile.role!=="admin"&&affected_department_ids.some(id=>id!==department_id))
            return res.status(403).json({message:"Cross-department issue notification requires Admin authority"});
        const {data,error}=await getAdminClient().from("communication_issues").insert({
            department_id,affected_department_ids,created_by:req.user.id,title:title.trim(),
            description:description.trim(),priority
        }).select().single();
        if(error)throw error;
        const recipientDepartments=[department_id,...affected_department_ids];
        const {data:people,error:peopleError}=await getAdminClient().from("profiles").select("id").in("department_id",recipientDepartments);
        if(peopleError)throw peopleError;
        const notifications=(people||[]).filter(p=>p.id!==req.user.id).map(p=>({
            user_id:p.id,issue_id:data.id,notification_type:"work_issue",title:data.title
        }));
        if(notifications.length){const saved=await getAdminClient().from("communication_notifications").insert(notifications);if(saved.error)throw saved.error;}
        return res.status(201).json({message:"Work issue reported and relevant teams notified",issue:data});
    }catch(error){console.error("Create issue:",error.message);return res.status(400).json({message:error.message||"Unable to report issue"});}
};

const updateIssue=async(req,res)=>{
    try{
        if(!has(req,"communication.issues.manage"))return res.status(403).json({message:"Work issue management is not granted"});
        const db=getAdminClient();
        const {data:issue,error:findError}=await db.from("communication_issues").select("id,department_id").eq("id",req.params.id).maybeSingle();
        if(findError)throw findError;if(!issue)return res.status(404).json({message:"Work issue not found"});
        if(!canSeeDepartment(req.profile,issue.department_id))return res.status(403).json({message:"Issue is outside your department"});
        const updates={updated_at:new Date().toISOString()};
        if(req.body.status!==undefined)updates.status=req.body.status;
        if(req.body.assigned_to!==undefined)updates.assigned_to=req.body.assigned_to||null;
        if(req.body.status==="resolved"||req.body.status==="closed")updates.resolved_at=new Date().toISOString();
        const {data,error}=await db.from("communication_issues").update(updates).eq("id",req.params.id).select().single();
        if(error)throw error;return res.json({message:"Work issue updated",issue:data});
    }catch(error){console.error("Update issue:",error.message);return res.status(400).json({message:error.message||"Unable to update issue"});}
};

const submitComplaint=async(req,res)=>{
    try{
        if(!has(req,"communication.complaints.submit"))return res.status(403).json({message:"Complaint submission is not granted"});
        const {target_user_id,category,subject,description}=req.body;
        if(!target_user_id||!category||!subject||!description)return res.status(400).json({message:"Target, category, subject and description are required"});
        const {data,error}=await getAdminClient().rpc("submit_bizinsight_complaint",{
            p_submitter_id:req.user.id,p_target_user_id:target_user_id,p_category:String(category),
            p_subject:String(subject),p_description:String(description)
        });
        if(error)throw error;
        return res.status(201).json({message:"Confidential complaint submitted",complaint_id:data});
    }catch(error){console.error("Complaint submit:",error.message);return res.status(400).json({message:error.message||"Unable to submit complaint"});}
};

const listComplaints=async(req,res)=>{
    try{
        if(req.profile.role!=="admin"&&!has(req,"communication.complaints.review")&&!has(req,"communication.complaints.submit"))
            return res.status(403).json({message:"Complaint access is not granted"});
        const db=getAdminClient();
        const base=()=>db.from("communication_complaints").select("*").order("created_at",{ascending:false}).limit(200);
        let rows=[];
        if(req.profile.role==="admin"){
            const {data,error}=await base();if(error)throw error;rows=data||[];
        }else if(req.profile.role==="manager"&&req.profile.manager_scope==="department"&&has(req,"communication.complaints.review")){
            const [own,routed]=await Promise.all([
                base().eq("submitted_by",req.user.id),
                base().eq("department_id",req.profile.department_id).eq("recipient_role","manager")
            ]);
            if(own.error)throw own.error;if(routed.error)throw routed.error;
            rows=[...(own.data||[]),...(routed.data||[])].filter((item,index,array)=>array.findIndex(x=>x.id===item.id)===index);
        }else{
            const {data,error}=await base().eq("submitted_by",req.user.id);if(error)throw error;rows=data||[];
        }
        return res.json(rows);
    }catch(error){console.error("Complaints:",error.message);return res.status(500).json({message:"Unable to load complaints"});}
};

const setResponsibility=async(req,res)=>{
    try{
        if(!has(req,"communication.responsibility.manage")||!["admin","manager"].includes(req.profile.role))return res.status(403).json({message:"Only Admin or an authorized Manager can manage announcement responsibility"});
        const {department_id,primary_user_id,backup_user_id,activate_backup=false}=req.body;
        if(!department_id||!primary_user_id||!backup_user_id||primary_user_id===backup_user_id)
            return res.status(400).json({message:"Department, primary and backup members are required"});
        if(req.profile.role==="manager"&&req.profile.manager_scope==="department"&&department_id!==req.profile.department_id)
            return res.status(403).json({message:"You can manage responsibility only for your department"});
        const db=getAdminClient();
        const ids=[primary_user_id,backup_user_id];
        const {data:people,error:peopleError}=await db.from("profiles").select("id,role,department_id").in("id",ids);
        if(peopleError)throw peopleError;
        if((people||[]).length!==2||(people||[]).some(p=>p.role!=="staff"&&p.role!=="manager"))
            return res.status(400).json({message:"Choose two active employees"});
        if(req.profile.role!=="admin"&&(people||[]).some(p=>p.department_id!==department_id))
            return res.status(403).json({message:"Both communicators must belong to your department"});
        const active=activate_backup?backup_user_id:primary_user_id;
        const {data,error}=await db.from("communication_responsibilities").upsert({
            department_id,primary_user_id,backup_user_id,active_publisher_user_id:active,
            updated_by:req.user.id,updated_at:new Date().toISOString()
        }).select().single();
        if(error)throw error;return res.json({message:"Communication responsibility saved",responsibility:data});
    }catch(error){console.error("Responsibility:",error.message);return res.status(400).json({message:error.message||"Unable to save responsibility"});}
};

const listResponsibilities=async(req,res)=>{
    try{
        if(!has(req,"communication.responsibility.manage")&&!has(req,"communication.general.publish"))return res.status(403).json({message:"Responsibility view is not granted"});
        let query=getAdminClient().from("communication_responsibilities").select("*");
        if(req.profile.role==="manager"&&req.profile.manager_scope==="department")query=query.eq("department_id",req.profile.department_id);
        const {data,error}=await query;if(error)throw error;return res.json(data||[]);
    }catch(error){return res.status(500).json({message:"Unable to load communication responsibility"});}
};

const complaintCanReview=async(db,actor,complaint)=>{
    if(actor.role==="admin")return true;
    return actor.role==="manager"&&actor.manager_scope==="department"&&
        actor.department_id===complaint.department_id&&complaint.recipient_role==="manager";
};
const updateComplaint=async(req,res)=>{
    try{
        const db=getAdminClient();
        const {data:complaint,error:findError}=await db.from("communication_complaints")
            .select("id,department_id,recipient_role").eq("id",req.params.id).maybeSingle();
        if(findError)throw findError;if(!complaint)return res.status(404).json({message:"Complaint not found"});
        if(!has(req,"communication.complaints.review")||!(await complaintCanReview(db,req.profile,complaint)))
            return res.status(403).json({message:"You are not authorized to review this confidential complaint"});
        const status=req.body.status;
        if(!["under_review","resolved","closed"].includes(status))return res.status(400).json({message:"Invalid complaint status"});
        const {data,error}=await db.from("communication_complaints").update({status,updated_at:new Date().toISOString()})
            .eq("id",req.params.id).select().single();
        if(error)throw error;return res.json({message:"Complaint status updated",complaint:data});
    }catch(error){console.error("Complaint update:",error.message);return res.status(400).json({message:error.message||"Unable to update complaint"});}
};
const addComplaintResponse=async(req,res)=>{
    try{
        const db=getAdminClient();
        const {data:complaint,error:findError}=await db.from("communication_complaints")
            .select("id,department_id,recipient_role").eq("id",req.params.id).maybeSingle();
        if(findError)throw findError;if(!complaint)return res.status(404).json({message:"Complaint not found"});
        if(!has(req,"communication.complaints.review")||!(await complaintCanReview(db,req.profile,complaint)))
            return res.status(403).json({message:"You are not authorized to respond to this confidential complaint"});
        const body=String(req.body.body||"").trim();
        if(body.length<2||body.length>3000)return res.status(400).json({message:"Response must contain 2–3000 characters"});
        const {data,error}=await db.from("communication_complaint_responses").insert({
            complaint_id:complaint.id,responder_id:req.user.id,body
        }).select().single();
        if(error)throw error;return res.status(201).json({message:"Confidential response added",response:data});
    }catch(error){console.error("Complaint response:",error.message);return res.status(400).json({message:error.message||"Unable to add response"});}
};

const listDepartmentMembers=async(req,res)=>{
    try{
        if(!has(req,"communication.responsibility.manage"))return res.status(403).json({message:"Responsibility management is not granted"});
        const departmentId=req.query.department_id||req.profile.department_id;
        if(!departmentId||(req.profile.role!=="admin"&&req.profile.manager_scope!=="company"&&departmentId!==req.profile.department_id))
            return res.status(403).json({message:"You cannot manage communicators for this department"});
        const {data,error}=await getAdminClient().from("profiles")
            .select("id,full_name,role,department_id").eq("department_id",departmentId)
            .in("role",["manager","staff"]).order("full_name");
        if(error)throw error;return res.json(data||[]);
    }catch(error){return res.status(500).json({message:"Unable to load department members"});}
};

const listComplaintTargets=async(req,res)=>{
    try{
        if(!has(req,"communication.complaints.submit"))return res.status(403).json({message:"Complaint submission is not granted"});
        let query=getAdminClient().from("profiles").select("id,full_name,role,department_id").neq("id",req.user.id).neq("role","admin").order("full_name");
        if(req.profile.role==="staff")query=query.eq("department_id",req.profile.department_id);
        else if(req.profile.role==="manager"&&req.profile.manager_scope==="department")query=query.eq("department_id",req.profile.department_id);
        const {data,error}=await query;if(error)throw error;
        return res.json(data||[]);
    }catch(error){return res.status(500).json({message:"Unable to load complaint targets"});}
};

const listAnnouncementDepartments=async(req,res)=>{
    try{
        if(!has(req,"communication.general.publish")&&!has(req,"communication.responsibility.manage"))
            return res.status(403).json({message:"General announcement or responsibility access is not granted"});
        let query=getAdminClient().from("departments").select("id,name").eq("is_active",true).order("name");
        const {data,error}=await query;
        if(error)throw error;
        return res.json(data||[]);
    }catch(error){return res.status(500).json({message:"Unable to load announcement departments"});}
};

const listNotifications=async(req,res)=>{
    try{
        const {data,error}=await getAdminClient().from("communication_notifications")
            .select("id,notification_type,title,message_id,issue_id,created_at,read_at")
            .eq("user_id",req.user.id).order("created_at",{ascending:false}).limit(100);
        if(error)throw error;return res.json(data||[]);
    }catch(error){console.error("Notifications:",error.message);return res.status(500).json({message:"Unable to load notifications"});}
};
const markNotificationRead=async(req,res)=>{
    try{
        const {data,error}=await getAdminClient().from("communication_notifications")
            .update({read_at:new Date().toISOString()}).eq("id",req.params.id).eq("user_id",req.user.id)
            .select("id,read_at").maybeSingle();
        if(error)throw error;if(!data)return res.status(404).json({message:"Notification not found"});
        return res.json({message:"Notification marked as read",notification:data});
    }catch(error){return res.status(400).json({message:"Unable to update notification"});}
};

module.exports={listMessages,createMessage,listIssues,createIssue,updateIssue,submitComplaint,listComplaints,setResponsibility,listResponsibilities,listNotifications,markNotificationRead,listAnnouncementDepartments,listComplaintTargets,listDepartmentMembers,updateComplaint,addComplaintResponse};
