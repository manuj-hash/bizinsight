(function(){
"use strict";
const token=()=>sessionStorage.getItem("bizinsight_token");
const NOTICE_KEY="bizinsight_access_notice";
const pageMap={
 "dashboard.html":["dashboard.view"],
 "inventory.html":["inventory.view"],
 "orders.html":["orders.view"],
 "customers.html":["customers.view"],
 "analytics.html":["analytics.view","inventory.view"],
 "reports.html":["reports.view"],
 "staff.html":["staff.view"],
 "access-control.html":["staff.view"],
 "communication.html":["communication.access"],
 "profile.html":[]
};
const hrefPermission={
 "dashboard.html":["dashboard.view"],"inventory.html":["inventory.view"],
 "orders.html":["orders.view"],"customers.html":["customers.view"],
 "analytics.html":["analytics.view","inventory.view"],"reports.html":["reports.view"],
 "staff.html":["staff.view","staff.manage"],"access-control.html":["staff.view"],
 "communication.html":["communication.access"]
};
function showAccessNotice(message){
 let notice=document.getElementById("bizinsight-access-notice");
 if(!notice){
  notice=document.createElement("div");
  notice.id="bizinsight-access-notice";
  notice.setAttribute("role","alert");
  notice.setAttribute("aria-live","assertive");
  notice.style.cssText="position:fixed;top:16px;right:16px;z-index:99999;max-width:min(440px,calc(100vw - 32px));padding:14px 18px;border:1px solid #f2b8b5;border-left:5px solid #b42318;border-radius:10px;background:#fff;color:#7a271a;box-shadow:0 8px 28px rgba(16,24,40,.16);font:500 14px/1.5 Arial,sans-serif";
  document.body.appendChild(notice);
 }
 notice.textContent=message;
}
function takeAccessNotice(){
 const message=sessionStorage.getItem(NOTICE_KEY);
 if(!message)return;
 sessionStorage.removeItem(NOTICE_KEY);
 showAccessNotice(message);
}
function denyAccess(message,granted){
 sessionStorage.setItem(NOTICE_KEY,message);
 const current=location.pathname.split("/").pop();
 const fallback=["dashboard.html","inventory.html","orders.html","customers.html","analytics.html","reports.html","communication.html","profile.html"]
  .find(file=>file==="profile.html"||hasAny(hrefPermission[file]||[],granted||new Set()));
 location.replace(fallback||"profile.html");
}
function hasAny(list,granted){return list.some(code=>granted.has(code));}

function setupAccessNotifications(){
 const existing=document.getElementById("bizinsight-access-notifications");
 if(existing)return;
 const wrap=document.createElement("div");wrap.id="bizinsight-access-notifications";
 wrap.style.cssText="position:fixed;top:16px;right:16px;z-index:9990;font:14px Arial,sans-serif;color:#1f2937";
 const button=document.createElement("button");button.type="button";button.textContent="Access alerts";
 button.setAttribute("aria-expanded","false");button.style.cssText="padding:10px 14px;border:1px solid #cbd5e1;border-radius:9px;background:#fff;color:#1d4ed8;font-weight:600;box-shadow:0 3px 12px #0f172a18;cursor:pointer";
 const count=document.createElement("span");count.style.cssText="margin-left:8px;padding:2px 7px;border-radius:12px;background:#fee2e2;color:#991b1b";count.hidden=true;button.appendChild(count);
 const panel=document.createElement("section");panel.hidden=true;panel.setAttribute("aria-label","Access notifications");panel.style.cssText="position:absolute;right:0;top:48px;width:min(380px,calc(100vw - 32px));max-height:65vh;overflow:auto;padding:14px;background:#fff;border:1px solid #e2e8f0;border-radius:12px;box-shadow:0 12px 36px #0f172a24";
 const heading=document.createElement("h2");heading.textContent="Access notifications";heading.style.cssText="font-size:16px;margin:0 0 10px";
 const list=document.createElement("div");panel.append(heading,list);wrap.append(button,panel);document.body.appendChild(wrap);
 button.addEventListener("click",()=>{panel.hidden=!panel.hidden;button.setAttribute("aria-expanded",String(!panel.hidden));if(!panel.hidden)refresh();});
 async function refresh(){
  try{
   const response=await fetch("/api/permissions/notifications",{headers:{Authorization:"Bearer "+token()}});
   if(!response.ok)return;
   const items=await response.json();const unread=items.filter(item=>!item.read_at).length;
   count.textContent=String(unread);count.hidden=unread===0;
   list.replaceChildren();
   if(!items.length){const empty=document.createElement("p");empty.textContent="You have no access notifications.";list.appendChild(empty);return;}
   items.forEach(item=>{
    const card=document.createElement("article");card.style.cssText="padding:10px 0;border-top:1px solid #e5e7eb";
    const title=document.createElement("strong");title.textContent=item.title;
    const message=document.createElement("p");message.textContent=item.message;message.style.cssText="margin:5px 0;color:#475569;line-height:1.45";
    const meta=document.createElement("small");meta.textContent=new Date(item.created_at).toLocaleString("en-IN");meta.style.color="#64748b";
    card.append(title,message,meta);
    if(!item.read_at){
     const mark=document.createElement("button");mark.type="button";mark.textContent="Mark as read";mark.style.cssText="display:block;margin-top:7px;padding:5px 9px;border:1px solid #cbd5e1;border-radius:6px;background:#f8fafc;cursor:pointer";
     mark.addEventListener("click",async()=>{
      try{const result=await fetch("/api/permissions/notifications/"+encodeURIComponent(item.id)+"/read",{method:"PATCH",headers:{Authorization:"Bearer "+token()}});
       if(!result.ok)throw new Error("Unable to update notification.");
       await refresh();
      }catch(error){showAccessNotice(error.message);}
     });
     card.appendChild(mark);
    }
    list.appendChild(card);
   });
  }catch(error){console.error("Access notifications:",error);}
 }
 refresh();setInterval(refresh,30000);
}

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
  if(label.includes("stock movement")||label.includes("adjust stock"))hide(button,!can("inventory.stock_movement"));
  if(label==="add product")hide(button,!can("inventory.create"));
  if(label.includes("create order"))hide(button,!can("orders.create"));
  if(label.includes("update status")||label.includes("cancel order"))hide(button,!can("orders.update"));
  if(label==="edit")hide(button,!can("inventory.update")&&!can("orders.update"));
  if(label.includes("archive")||label.includes("delete"))hide(button,!can("inventory.archive"));
 });
}
async function init(){
 takeAccessNotice();
 if(!token())return;
 try{
  const response=await fetch("/api/permissions/me",{headers:{Authorization:"Bearer "+token()}});
  const data=await response.json();
  if(!response.ok)throw new Error(data.message||"Unable to verify your access. Please sign in again or contact your administrator.");
  const granted=new Set(data.permissions||[]);
  const admin=data.role==="admin";
  document.querySelectorAll(".sidebar a[href]").forEach(link=>{
   if(link.getAttribute("href")==="staff.html")link.textContent="User Management";
   const href=(link.getAttribute("href")||"").split("/").pop().split("?")[0];
   const required=hrefPermission[href];
   if((href==="staff.html"||href==="access-control.html")&&data.role==="staff")link.hidden=true;
   else if(required&&!admin&&!hasAny(required,granted))link.hidden=true;
  });
  const sidebar=document.querySelector(".sidebar");
  if(sidebar&&!sidebar.querySelector('a[href="communication.html"]')&&(admin||granted.has("communication.access"))){
   const link=document.createElement("a");
   link.href="communication.html";link.textContent="Communication";link.dataset.bizCommunication="true";
   sidebar.insertBefore(link,sidebar.querySelector('a[href="profile.html"]')||null);
  }
  if(sidebar&&!sidebar.querySelector('a[href="access-control.html"]')&&(admin||granted.has("staff.view"))){
   const link=document.createElement("a");
   link.href="access-control.html";link.textContent="Access Control";link.dataset.bizAccess="true";
   const staffLink=sidebar.querySelector('a[href="staff.html"]');
   if(staffLink)staffLink.after(link);else sidebar.appendChild(link);
  }
  const current=location.pathname.split("/").pop();
  const required=pageMap[current];
  if((current==="staff.html"||current==="access-control.html")&&data.role==="staff"){
   denyAccess("Access denied. This page is restricted to authorized Admin and Manager accounts. Contact your administrator if you need access.",granted);
   return;
  }
  if(required&&required.length&&!admin&&!hasAny(required,granted)){
   denyAccess("Access denied. You do not have permission to open this page. Contact your administrator if you need access.",granted);
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
  setupAccessNotifications();
  applyActionVisibility(granted,admin);
  if(!window.__bizInsightPermissionObserver){window.__bizInsightPermissionObserver=new MutationObserver(()=>applyActionVisibility(granted,admin));window.__bizInsightPermissionObserver.observe(document.body,{childList:true,subtree:true});}
  document.dispatchEvent(new CustomEvent("bizinsight:access-ready",{detail:window.bizInsightAccess}));
 }catch(error){
  console.error("BizInsight access check:",error);
  showAccessNotice("Your access could not be verified. Please sign in again or contact your administrator.");
  const main=document.createElement("main");
  main.style.cssText="padding:32px;font-family:Arial";
  const heading=document.createElement("h2");heading.textContent="Access could not be verified";
  const message=document.createElement("p");message.textContent="Please sign in again or contact your administrator.";
  const link=document.createElement("a");link.href="index.html";link.textContent="Return to login";
  main.append(heading,message,link);document.body.replaceChildren(main);
 }
}
document.addEventListener("DOMContentLoaded",init);
})();