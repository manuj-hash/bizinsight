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
  window.bizInsightAccess={role:data.role,permissions:granted,delegations:data.delegations||[]};
  document.dispatchEvent(new CustomEvent("bizinsight:access-ready",{detail:window.bizInsightAccess}));
 }catch(error){console.error("BizInsight access check:",error);document.body.innerHTML='<main style="padding:32px;font-family:Arial"><h2>Access could not be verified</h2><p>Please sign in again or contact your administrator.</p><a href="index.html">Return to login</a></main>';}
}
document.addEventListener("DOMContentLoaded",init);
})();