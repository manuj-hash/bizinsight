require("dotenv").config();
const path = require("node:path");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in backend/.env");
  process.exit(1);
}
const baseClient = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});
const appOrigin = (process.env.APP_ORIGIN || "http://localhost:3000").split(",").map(x => x.trim());
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" }, contentSecurityPolicy: false }));
app.use(cors({ origin: appOrigin, credentials: false }));
app.use(express.json({ limit: "1mb" }));

const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const fail = (res, status, message) => res.status(status).json({ message });
const dbError = (res, error) => {
  const message = error?.message || "Database operation failed";
  const status = /not authorised|permission|row-level security/i.test(message) ? 403 :
    /not found/i.test(message) ? 404 : /insufficient|invalid|cannot|must|required|duplicate/i.test(message) ? 400 : 500;
  return fail(res, status, message);
};
const userClient = token => createClient(SUPABASE_URL, SUPABASE_KEY, {
  global: { headers: { Authorization: "Bearer " + token } },
  auth: { autoRefreshToken: false, persistSession: false }
});
const auth = wrap(async (req, res, next) => {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return fail(res, 401, "Authentication required");
  const sb = userClient(token);
  const { data: authData, error: authError } = await sb.auth.getUser(token);
  if (authError || !authData.user) return fail(res, 401, "Session is invalid or expired");
  const { data: profile, error } = await sb.from("profiles")
    .select("id,full_name,phone,role,created_at").eq("id", authData.user.id).maybeSingle();
  if (error) return dbError(res, error);
  if (!profile || !["admin", "staff"].includes(profile.role)) return fail(res, 403, "BizInsight account is not authorised");
  req.sb = sb;
  req.user = authData.user;
  req.profile = profile;
  next();
});
const adminOnly = (req, res, next) => req.profile?.role === "admin"
  ? next() : fail(res, 403, "Administrator access required");
const rows = (data, key) => Array.isArray(data) ? data : (data?.[key] || []);
const numeric = value => Number(value || 0);
const isoMonth = date => date.toISOString().slice(0, 7);
async function allRows(queryBuilder) {
  const all = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await queryBuilder().range(from, from + 999);
    if (error) throw error;
    all.push(...(data || []));
    if (!data || data.length < 1000) return all;
  }
}

app.get("/api/status", (_req, res) => res.json({ project: "BizInsight", status: "Running" }));
app.post("/api/auth/login", wrap(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return fail(res, 400, "Email and password are required");
  const { data, error } = await baseClient.auth.signInWithPassword({ email, password });
  if (error) return fail(res, 401, error.message);
  const sb = userClient(data.session.access_token);
  const { data: profile, error: profileError } = await sb.from("profiles")
    .select("id,full_name,phone,role").eq("id", data.user.id).maybeSingle();
  if (profileError) return dbError(res, profileError);
  if (!profile || !["admin", "staff"].includes(profile.role)) return fail(res, 403, "This account has no BizInsight workspace role");
  res.json({ access_token: data.session.access_token, refresh_token: data.session.refresh_token, user: data.user, profile });
}));
app.use("/api", auth);
app.get("/api/auth/me", (req, res) => res.json({ user: req.user, profile: req.profile }));

// Products: stock_quantity is never edited through product CRUD; use stock-movements.
app.get("/api/products", wrap(async (req, res) => {
  const { data, error } = await req.sb.from("products").select("*").is("archived_at", null).order("created_at", { ascending: false });
  if (error) return dbError(res, error); res.json(data || []);
}));
app.post("/api/products", wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.name || !Number.isFinite(Number(b.price)) || Number(b.price) < 0) return fail(res, 400, "Product name and a valid non-negative price are required");
  const opening = Math.max(0, Math.trunc(numeric(b.stock_quantity ?? b.stock)));
  const payload = { sku: b.sku || null, name: String(b.name).trim(), description: b.description || null,
    category: b.category || null, price: Number(b.price), cost_price: b.cost_price == null ? null : Number(b.cost_price),
    stock_quantity: 0, reorder_level: Math.max(0, Math.trunc(numeric(b.reorder_level))), is_active: true };
  const { data, error } = await req.sb.from("products").insert(payload).select("*").single();
  if (error) return dbError(res, error);
  if (opening > 0) {
    const { error: movementError } = await req.sb.rpc("adjust_bizinsight_stock", {
      p_product_id: data.id, p_quantity_delta: opening, p_movement_type: "stock_in", p_notes: "Opening stock at product creation"
    });
    if (movementError) {
      await req.sb.from("products").delete().eq("id", data.id);
      return dbError(res, movementError);
    }
  }
  const { data: fresh } = await req.sb.from("products").select("*").eq("id", data.id).single();
  res.status(201).json(fresh || data);
}));
app.put("/api/products/:id", wrap(async (req, res) => {
  const b = req.body || {};
  if ("stock_quantity" in b || "stock" in b) return fail(res, 400, "Use the stock movement workflow to change inventory quantity");
  const allowed = ["sku","name","description","category","price","cost_price","reorder_level","is_active"];
  const update = Object.fromEntries(Object.entries(b).filter(([k]) => allowed.includes(k)));
  if (!Object.keys(update).length) return fail(res, 400, "No editable product fields supplied");
  const { data, error } = await req.sb.from("products").update(update).eq("id", req.params.id).select("*").single();
  if (error) return dbError(res, error); res.json(data);
}));
app.delete("/api/products/:id", adminOnly, wrap(async (req, res) => {
  const { data, error } = await req.sb.from("products").update({ is_active: false, archived_at: new Date().toISOString() })
    .eq("id", req.params.id).select("id").single();
  if (error) return dbError(res, error); res.json({ archived: true, id: data.id });
}));

// Controlled inventory movements.
app.get("/api/stock-movements", wrap(async (req, res) => {
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
  const { data, error } = await req.sb.from("stock_movements")
    .select("id,product_id,order_id,movement_type,quantity_delta,reserved_delta,reference,notes,created_at,products(name,sku)")
    .order("created_at", { ascending: false }).limit(limit);
  if (error) return dbError(res, error); res.json(data || []);
}));
app.post("/api/stock-movements", wrap(async (req, res) => {
  const { product_id, quantity_delta, movement_type, notes } = req.body || {};
  if (!product_id || !Number.isInteger(Number(quantity_delta)) || Number(quantity_delta) === 0)
    return fail(res, 400, "Product and a non-zero whole-number quantity change are required");
  const { data, error } = await req.sb.rpc("adjust_bizinsight_stock", {
    p_product_id: product_id, p_quantity_delta: Number(quantity_delta),
    p_movement_type: movement_type, p_notes: notes || null
  });
  if (error) return dbError(res, error);
  res.status(201).json({ stock_quantity: data });
}));

app.get("/api/customers", wrap(async (req, res) => {
  const { data, error } = await req.sb.from("customers").select("*").is("archived_at", null).order("created_at", { ascending: false });
  if (error) return dbError(res, error); res.json(data || []);
}));
app.post("/api/customers", wrap(async (req, res) => {
  const b=req.body||{}; if(!String(b.name||"").trim()) return fail(res,400,"Customer name is required");
  const {data,error}=await req.sb.from("customers").insert({name:String(b.name).trim(),email:b.email||null,phone:b.phone||null,address:b.address||null}).select("*").single();
  if(error)return dbError(res,error);res.status(201).json(data);
}));
app.put("/api/customers/:id", wrap(async (req,res)=>{
  const b=req.body||{}, update=Object.fromEntries(Object.entries(b).filter(([k])=>["name","email","phone","address","is_active"].includes(k)));
  const {data,error}=await req.sb.from("customers").update(update).eq("id",req.params.id).select("*").single();
  if(error)return dbError(res,error);res.json(data);
}));
app.delete("/api/customers/:id", adminOnly, wrap(async(req,res)=>{
  const {data,error}=await req.sb.from("customers").update({is_active:false,archived_at:new Date().toISOString()}).eq("id",req.params.id).select("id").single();
  if(error)return dbError(res,error);res.json({archived:true,id:data.id});
}));

app.get("/api/orders", wrap(async(req,res)=>{
  const {data,error}=await req.sb.from("orders")
    .select("*,customers(name,email),order_items(id,product_id,quantity,unit_price,line_total,products(name,sku))")
    .order("ordered_at",{ascending:false}).limit(500);
  if(error)return dbError(res,error);res.json(data||[]);
}));
app.post("/api/orders", wrap(async(req,res)=>{
  const b=req.body||{};
  if(!Array.isArray(b.items)||!b.items.length)return fail(res,400,"At least one order item is required");
  const orderNumber=b.order_number||("BI-"+new Date().toISOString().slice(0,10).replaceAll("-","")+"-"+crypto.randomUUID().slice(0,8).toUpperCase());
  const {data,error}=await req.sb.rpc("create_bizinsight_order_v2",{
    p_order_number:orderNumber,p_customer_id:b.customer_id||null,p_items:b.items,
    p_tax_amount:numeric(b.tax_amount),p_discount_amount:numeric(b.discount_amount)
  });
  if(error)return dbError(res,error);
  const {data:order}=await req.sb.from("orders").select("*,order_items(*)").eq("id",data).single();
  res.status(201).json(order||{id:data,order_number:orderNumber,status:"pending"});
}));
app.put("/api/orders/:id/status", wrap(async(req,res)=>{
  const {status}=req.body||{}; if(!status)return fail(res,400,"New order status is required");
  const {data,error}=await req.sb.rpc("transition_bizinsight_order",{p_order_id:req.params.id,p_new_status:status});
  if(error)return dbError(res,error);res.json({id:req.params.id,status:data});
}));

app.get("/api/analytics/dashboard", wrap(async(req,res)=>{
  const [products,orders,customers]=await Promise.all([
    req.sb.from("products").select("id",{count:"exact",head:true}).is("archived_at",null),
    req.sb.from("orders").select("id",{count:"exact",head:true}),
    req.sb.from("customers").select("id",{count:"exact",head:true}).is("archived_at",null)
  ]);
  for(const r of [products,orders,customers])if(r.error)return dbError(res,r.error);
  const all=await allRows(()=>req.sb.from("orders").select("total_amount,ordered_at,status").eq("status","completed").order("ordered_at",{ascending:false}));
  const now=new Date(), currentStart=new Date(now.getFullYear(),now.getMonth(),1), previousStart=new Date(now.getFullYear(),now.getMonth()-1,1);
  const current=all.filter(o=>new Date(o.ordered_at)>=currentStart).reduce((s,o)=>s+numeric(o.total_amount),0);
  const previous=all.filter(o=>new Date(o.ordered_at)>=previousStart&&new Date(o.ordered_at)<currentStart).reduce((s,o)=>s+numeric(o.total_amount),0);
  const totalSales=all.reduce((s,o)=>s+numeric(o.total_amount),0);
  const growthPercent=previous===0?(current>0?null:0):((current-previous)/previous)*100;
  res.json({totalSales,totalProducts:products.count||0,totalOrders:orders.count||0,totalCustomers:customers.count||0,growthPercent});
}));
app.get("/api/analytics/sales", wrap(async(req,res)=>{
  const all=await allRows(()=>req.sb.from("orders").select("total_amount,ordered_at").eq("status","completed").order("ordered_at"));
  const map=new Map();for(const o of all){const key=String(o.ordered_at||"").slice(0,7);if(key)map.set(key,(map.get(key)||0)+numeric(o.total_amount))}
  const labels=[...map.keys()].sort();res.json({labels,values:labels.map(k=>Number(map.get(k).toFixed(2)))});
}));
app.get("/api/analytics/inventory", wrap(async(req,res)=>{
  const {data,error}=await req.sb.from("products").select("stock_quantity,reserved_quantity,price,cost_price,reorder_level").is("archived_at",null);
  if(error)return dbError(res,error);
  const items=data||[];res.json({products:items.length,onHand:items.reduce((s,p)=>s+p.stock_quantity,0),reserved:items.reduce((s,p)=>s+p.reserved_quantity,0),
    available:items.reduce((s,p)=>s+p.stock_quantity-p.reserved_quantity,0),
    costValue:items.reduce((s,p)=>s+numeric(p.cost_price)*p.stock_quantity,0),
    retailValue:items.reduce((s,p)=>s+numeric(p.price)*p.stock_quantity,0),
    lowStock:items.filter(p=>p.stock_quantity-p.reserved_quantity<=p.reorder_level).length});
}));

app.get("/api/users", adminOnly, wrap(async(req,res)=>{
  const {data,error}=await req.sb.from("profiles").select("id,full_name,phone,role,created_at").order("created_at",{ascending:false});
  if(error)return dbError(res,error);res.json(data||[]);
}));
app.get("/api/users/me", wrap(async(req,res)=>res.json(req.profile)));
app.put("/api/users/me", wrap(async(req,res)=>{
  const b=req.body||{},update={};if(typeof b.full_name==="string")update.full_name=b.full_name.trim();if(typeof b.phone==="string")update.phone=b.phone.trim();
  const {data,error}=await req.sb.from("profiles").update(update).eq("id",req.user.id).select("id,full_name,phone,role").single();
  if(error)return dbError(res,error);req.profile=data;res.json(data);
}));
app.patch("/api/users/:id/role", adminOnly, wrap(async(req,res)=>{
  if(req.params.id===req.user.id)return fail(res,400,"You cannot change your own role");
  if(!["admin","staff"].includes(req.body?.role))return fail(res,400,"Role must be admin or staff");
  const {data,error}=await req.sb.from("profiles").update({role:req.body.role}).eq("id",req.params.id).select("id,full_name,role").single();
  if(error)return dbError(res,error);res.json(data);
}));

app.use("/api",(_req,res)=>res.status(404).json({message:"API endpoint not found"}));
app.use((err,_req,res,_next)=>{console.error(err);res.status(500).json({message:"Unexpected server error"});});
app.use(express.static(path.join(__dirname,"..","public"),{dotfiles:"deny",index:"index.html",etag:true}));
app.get("*",(req,res,next)=>req.path.startsWith("/api/")?next():res.sendFile(path.join(__dirname,"..","public","index.html")));
app.listen(PORT,()=>console.log("BizInsight API running on http://localhost:"+PORT));
