(function(){
"use strict";
const token=()=>sessionStorage.getItem("bizinsight_token");
const pageMap={
 "dashboard.html":["dashboard.view"],
 "inventory.html":["inventory.view"],
 "orders.html":["orders.view"],
 "customers.html":["customers.view"],
 "analytics.html":["analytics.view","inventory.view"],
 "reports.html":["reports.view"],
 "staff.html":["staff.view","staff.manage"],
 "access-control.html":["staff.view","staff.manage"],
 "communication.html":["communication.access"],
 "profile.html":[]
};
const hrefPermission={
 "dashboard.html":["dashboard.view"],"inventory.html":["inventory.view"],
 "orders.html":["orders.view"],"customers.html":["customers.view"],
 "analytics.html":["analytics.view","inventory.view"],"reports.html":["reports.view"],
 "staff.html":["staff.view","staff.manage"],"access-control.html":["staff.view","staff.manage"],
 "communication.html":["communication.access"]
};
function hasAny(list,granted){return list.some(code=>granted.has(code));}
function applyActionVisibility(granted,admin){
 const can=code=>admin||granted.has(code);
 const hide=(node,condition)=>{if(node&&node.hidden!==condition)node.hidden=condition;};
 hide(document.getElementById("productForm"),!can("inventory.create")&&!can("inventory.update"));
 hide(document.getElementById("submitBtn"),!can("inventory.create")&&!can("inventory.update"));
 hide(document.getElementById("createOrderButton"),!can("orders.create"));
 hide(document.getElementById("inviteForm"),!can("staff.manage"));
 hide(document.getElementById("inviteButton"),!can("staff.manage"));
 hide(document.getElementById("departmentForm"),!can("staff.departments.manage"));
 hide(document.getElementById("createDepartmentButton"),!can("staff.departments.manage"));
 hide(document.getElementById("preferencesForm"),!can("staff.departments.manage"));
 document.querySelectorAll("button").forEach(button=>{
  const label=(button.textContent||"").trim().toLowerCase();
  if(label.includes("download report"))hide(button,!can("reports.export"));
  if(label.includes("record stock movement"))hide(button,!can("inventory.stock_movement"));
  if(label==="add product")hide(button,!can("inventory.create"));
  if(label==="edit")hide(button,!can("inventory.update")&&!can("orders.update"));
  if(label.includes("archive")||label.includes("delete"))hide(button,!can("inventory.archive"));
 });
}
async function init(){
 if(!token())return;
 try{
  const response=await fetch("/api/permissions/me",{headers:{Authorization:"Bearer "+token()}});
  const data=await response.json();
  if(!response.ok)throw new Error(data.message||"Unable to load access rights");
  const granted=new Set(data.permissions||[]);
  const admin=data.role==="admin";
  document.querySelectorAll(".sidebar a[href]").forEach(link=>{
   const href=(link.getAttribute("href")||"").split("/").pop().split("?")[0];
   const required=hrefPermission[href];
   if(required&&!admin&&!hasAny(required,granted))link.hidden=true;
  });
  const sidebar=document.querySelector(".sidebar");
  if(sidebar&&!sidebar.querySelector('[data-biz-communication]')&&(admin||granted.has("communication.access"))){
   const link=document.createElement("a");
   link.href="communication.html";link.textContent="Communication";link.dataset.bizCommunication="true";
   sidebar.insertBefore(link,sidebar.querySelector('a[href="profile.html"]')||null);
  }
  if(sidebar&&!sidebar.querySelector('[data-biz-access]')&&(admin||granted.has("staff.view")||granted.has("staff.manage"))){
   const link=document.createElement("a");
   link.href="access-control.html";link.textContent="Access Control";link.dataset.bizAccess="true";
   const staffLink=sidebar.querySelector('a[href="staff.html"]');
   if(staffLink)staffLink.after(link);else sidebar.appendChild(link);
  }
  const current=location.pathname.split("/").pop();
  const required=pageMap[current];
  if(required&&required.length&&!admin&&!hasAny(required,granted)){
   const first=["dashboard.html","inventory.html","orders.html","customers.html","analytics.html","reports.html","staff.html","communication.html","profile.html"]
    .find(file=>file==="profile.html"||hasAny(hrefPermission[file]||[],granted));
   location.replace(first||"profile.html");
   return;
  }
  if(admin||granted.has("communication.access")){
   const refreshUnread=async()=>{
    try{
     const nr=await fetch("/api/communication/notifications",{headers:{Authorization:"Bearer "+token()}});
     if(!nr.ok)return;
     const notes=await nr.json();const count=notes.filter(n=>!n.read_at).length;
     const link=document.querySelector('.sidebar a[href="communication.html"]');
     if(link)link.textContent=count?"Communication ("+count+")":"Communication";
    }catch(_){}
   };
   refreshUnread();setInterval(refreshUnread,30000);
  }
  window.bizInsightAccess={role:data.role,permissions:granted,delegations:data.delegations||[]};
  applyActionVisibility(granted,admin);
  if(!window.__bizInsightPermissionObserver){window.__bizInsightPermissionObserver=new MutationObserver(()=>applyActionVisibility(granted,admin));window.__bizInsightPermissionObserver.observe(document.body,{childList:true,subtree:true});}
  document.dispatchEvent(new CustomEvent("bizinsight:access-ready",{detail:window.bizInsightAccess}));
 }catch(error){console.error("BizInsight access check:",error);document.body.innerHTML='<main style="padding:32px;font-family:Arial"><h2>Access could not be verified</h2><p>Please sign in again or contact your administrator.</p><a href="index.html">Return to login</a></main>';}
}
document.addEventListener("DOMContentLoaded",init);
})();