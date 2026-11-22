require("dotenv").config();
const express = require("express");
const path = require("path");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const Database = require("better-sqlite3");

const app = express();
const db = new Database(process.env.DB_PATH || "status.db");
const PORT = Number(process.env.PORT || 3000);
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "change-this-password";
const WEBHOOK = process.env.DISCORD_WEBHOOK_URL || "";

db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS services (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL UNIQUE,
 description TEXT DEFAULT '',
 status TEXT NOT NULL DEFAULT 'operational',
 sort_order INTEGER NOT NULL DEFAULT 0,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS incidents (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 service_id INTEGER,
 title TEXT NOT NULL,
 message TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'investigating',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 resolved_at TEXT,
 FOREIGN KEY(service_id) REFERENCES services(id)
);
`);
const count = db.prepare("SELECT COUNT(*) AS n FROM services").get().n;
if (!count) {
 const insert = db.prepare("INSERT INTO services(name,description,sort_order) VALUES(?,?,?)");
 ["Free Panel","Paid Panel","VPS Control Panel","Website","Billing Panel"].forEach((n,i)=>insert.run(n,"NexyonCloud "+n, i));
}
app.set("view engine","ejs");
app.set("views",path.join(__dirname,"views"));
app.use(helmet({contentSecurityPolicy:false}));
app.use(express.urlencoded({extended:false}));
app.use(express.json({limit:"50kb"}));
app.use(express.static(path.join(__dirname,"public")));
app.use(rateLimit({windowMs:15*60*1000,limit:300,standardHeaders:true,legacyHeaders:false}));

function adminOnly(req,res,next){
 const h=req.headers.authorization||"";
 if(!h.startsWith("Basic ")) { res.set("WWW-Authenticate",'Basic realm="NexyonCloud Admin"'); return res.status(401).send("Admin login required"); }
 let decoded="";
 try { decoded=Buffer.from(h.slice(6),"base64").toString(); } catch {}
 const split=decoded.indexOf(":");
 if(split<0 || decoded.slice(0,split)!==ADMIN_USER || decoded.slice(split+1)!==ADMIN_PASSWORD) {
  res.set("WWW-Authenticate",'Basic realm="NexyonCloud Admin"'); return res.status(401).send("Invalid admin credentials");
 }
 next();
}
function notify(text){
 if(!WEBHOOK) return;
 fetch(WEBHOOK,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({content:text})}).catch(()=>{});
}
app.get("/",(req,res)=>res.render("index"));
app.get("/api/status",(req,res)=>{
 const services=db.prepare("SELECT id,name,description,status,updated_at FROM services ORDER BY sort_order,id").all();
 const incidents=db.prepare("SELECT i.id,i.title,i.message,i.status,i.created_at,i.resolved_at,s.name AS service_name FROM incidents i LEFT JOIN services s ON s.id=i.service_id ORDER BY i.id DESC LIMIT 12").all();
 res.json({services,incidents,updatedAt:new Date().toISOString()});
});
app.get("/admin",adminOnly,(req,res)=>res.render("admin",{services:db.prepare("SELECT * FROM services ORDER BY sort_order,id").all(),incidents:db.prepare("SELECT * FROM incidents ORDER BY id DESC LIMIT 20").all()}));
app.post("/admin/service",adminOnly,(req,res)=>{
 const {name,description,status}=req.body;
 if(!name || !["operational","degraded","outage","maintenance"].includes(status)) return res.status(400).send("Invalid service data");
 try {
  db.prepare("INSERT INTO services(name,description,status) VALUES(?,?,?)").run(name.trim(),description||"",status);
  notify("🟢 NexyonCloud: service added — "+name+" ("+status+")");
 } catch(e) { return res.status(400).send("Service name already exists"); }
 res.redirect("/admin");
});
app.post("/admin/service/:id",adminOnly,(req,res)=>{
 const {name,description,status}=req.body;
 if(!["operational","degraded","outage","maintenance"].includes(status)) return res.status(400).send("Invalid status");
 const old=db.prepare("SELECT name,status FROM services WHERE id=?").get(req.params.id);
 db.prepare("UPDATE services SET name=?,description=?,status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(name,description||"",status,req.params.id);
 if(old && old.status!==status) notify("🔔 NexyonCloud status update: "+name+" is now "+status.toUpperCase());
 res.redirect("/admin");
});
app.post("/admin/service/:id/delete",adminOnly,(req,res)=>{
 db.prepare("DELETE FROM services WHERE id=?").run(req.params.id); res.redirect("/admin");
});
app.post("/admin/incident",adminOnly,(req,res)=>{
 const {service_id,title,message,status}=req.body;
 db.prepare("INSERT INTO incidents(service_id,title,message,status) VALUES(?,?,?,?)").run(service_id||null,title,message,status||"investigating");
 notify("⚠️ NexyonCloud incident: "+title+" — "+message);
 res.redirect("/admin");
});
app.post("/admin/incident/:id/resolve",adminOnly,(req,res)=>{
 db.prepare("UPDATE incidents SET status='resolved',resolved_at=CURRENT_TIMESTAMP WHERE id=?").run(req.params.id);
 notify("✅ NexyonCloud incident resolved.");
 res.redirect("/admin");
});
app.get("/health",(req,res)=>res.json({ok:true,service:"NexyonCloud Status Page"}));
app.listen(PORT,()=>console.log("NexyonCloud Status Page running on port "+PORT));