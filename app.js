require("dotenv").config();
const express=require("express");
const path=require("path");
const helmet=require("helmet");
const rateLimit=require("express-rate-limit");
const Database=require("better-sqlite3");
const dns=require("dns").promises;
const net=require("net");

const app=express();
const db=new Database(process.env.DB_PATH||"status.db");
const PORT=Number(process.env.PORT||3000);
const ADMIN_USER=process.env.ADMIN_USER||"admin";
const ADMIN_PASSWORD=process.env.ADMIN_PASSWORD||"";
const WEBHOOK=process.env.DISCORD_WEBHOOK_URL||"";
const CHECK_EVERY=Math.max(30,Number(process.env.CHECK_INTERVAL_SECONDS||60));
const TIMEOUT=Math.max(3000,Number(process.env.CHECK_TIMEOUT_MS||10000));
if(!ADMIN_PASSWORD||ADMIN_PASSWORD==="change-this-password") console.warn("WARNING: Set a strong ADMIN_PASSWORD in .env before public deployment.");

db.pragma("journal_mode=WAL");
db.pragma("foreign_keys=ON");
db.exec(`
CREATE TABLE IF NOT EXISTS services(
 id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL UNIQUE,description TEXT DEFAULT '',
 url TEXT DEFAULT '',status TEXT NOT NULL DEFAULT 'unknown',response_ms INTEGER,
 sort_order INTEGER NOT NULL DEFAULT 0,enabled INTEGER NOT NULL DEFAULT 1,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,last_checked TEXT
);
CREATE TABLE IF NOT EXISTS checks(
 id INTEGER PRIMARY KEY AUTOINCREMENT,service_id INTEGER NOT NULL,ok INTEGER NOT NULL,
 response_ms INTEGER,checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(service_id) REFERENCES services(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS checks_service_time ON checks(service_id,checked_at);
CREATE TABLE IF NOT EXISTS incidents(
 id INTEGER PRIMARY KEY AUTOINCREMENT,service_id INTEGER,title TEXT NOT NULL,
 message TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'investigating',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,resolved_at TEXT,
 FOREIGN KEY(service_id) REFERENCES services(id) ON DELETE SET NULL
);
`);
const cols=db.prepare("PRAGMA table_info(services)").all().map(x=>x.name);
if(!cols.includes("url"))db.exec("ALTER TABLE services ADD COLUMN url TEXT DEFAULT ''");
if(!cols.includes("response_ms"))db.exec("ALTER TABLE services ADD COLUMN response_ms INTEGER");
if(!cols.includes("enabled"))db.exec("ALTER TABLE services ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1");
if(!cols.includes("last_checked"))db.exec("ALTER TABLE services ADD COLUMN last_checked TEXT");
if(!db.prepare("SELECT COUNT(*) n FROM services").get().n){
 const ins=db.prepare("INSERT INTO services(name,description,sort_order) VALUES(?,?,?)");
 ["Free Panel","Paid Panel","VPS Control Panel","Website","Billing Panel"].forEach((n,i)=>ins.run(n,"Add a public HTTPS health URL in Admin to enable automatic monitoring.",i));
}
app.set("view engine","ejs");app.set("views",path.join(__dirname,"views"));
app.use(helmet({contentSecurityPolicy:false}));
app.use(express.urlencoded({extended:false,limit:"30kb"}));app.use(express.json({limit:"30kb"}));
app.use(express.static(path.join(__dirname,"public")));
app.use(rateLimit({windowMs:15*60*1000,limit:300,standardHeaders:true,legacyHeaders:false}));
function adminOnly(req,res,next){
 const h=req.headers.authorization||"";
 if(!h.startsWith("Basic ")){res.set("WWW-Authenticate",'Basic realm="NexyonCloud Admin"');return res.status(401).send("Admin login required");}
 let decoded="";try{decoded=Buffer.from(h.slice(6),"base64").toString("utf8")}catch{}
 const p=decoded.indexOf(":");
 if(p<0||decoded.slice(0,p)!==ADMIN_USER||decoded.slice(p+1)!==ADMIN_PASSWORD){res.set("WWW-Authenticate",'Basic realm="NexyonCloud Admin"');return res.status(401).send("Invalid admin credentials");}
 next();
}
function notify(content){
 if(!WEBHOOK)return;
 fetch(WEBHOOK,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({content:String(content).slice(0,1900)})}).catch(e=>console.error("Discord webhook:",e.message));
}
function isPrivateIPv4(ip){const a=ip.split(".").map(Number);return a.length===4&&(a[0]===10||a[0]===127||a[0]===0||(a[0]===169&&a[1]===254)||(a[0]===172&&a[1]>=16&&a[1]<=31)||(a[0]===192&&a[1]===168)||a[0]>=224);}
async function validateMonitorUrl(raw){
 if(!raw)return "";
 let u;try{u=new URL(raw)}catch{throw Error("Enter a valid URL including https://");}
 if(!["http:","https:"].includes(u.protocol))throw Error("Only HTTP/HTTPS URLs are supported");
 if(u.username||u.password)throw Error("URLs must not contain credentials");
 const host=u.hostname.toLowerCase();
 if(host==="localhost"||host.endsWith(".localhost")||host.endsWith(".local"))throw Error("Local/private hostnames cannot be monitored");
 if(net.isIP(host)){if(host.includes(":")||isPrivateIPv4(host))throw Error("Private IP addresses cannot be monitored");}
 else{
  const records=await dns.lookup(host,{all:true}).catch(()=>[]);
  if(!records.length)throw Error("The URL hostname could not be resolved");
  if(records.some(r=>r.family===4&&isPrivateIPv4(r.address))||records.some(r=>r.family===6&&(r.address==="::1"||r.address.startsWith("fc")||r.address.startsWith("fd")||r.address.startsWith("fe80"))))throw Error("Private network destinations cannot be monitored");
 }
 return u.toString();
}
async function checkService(s){
 const started=Date.now();let ok=0,code=0;
 try{
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),TIMEOUT);
  try{const r=await fetch(s.url,{method:"GET",redirect:"manual",signal:controller.signal,headers:{"User-Agent":"NexyonCloud-Monitor/1.0"}});code=r.status;ok=(code>=200&&code<400)?1:0;}finally{clearTimeout(timer);}
 }catch(e){console.warn("Monitor failed for",s.name,e.message)}
 const ms=Date.now()-started,old=s.status;
 db.prepare("INSERT INTO checks(service_id,ok,response_ms) VALUES(?,?,?)").run(s.id,ok,ms);
 const status=ok?"operational":"outage";
 db.prepare("UPDATE services SET status=?,response_ms=?,updated_at=CURRENT_TIMESTAMP,last_checked=CURRENT_TIMESTAMP WHERE id=?").run(status,ms,s.id);
 if(old!=="unknown"&&old!==status){
  if(status==="outage"){
   db.prepare("INSERT INTO incidents(service_id,title,message,status) VALUES(?,?,?,'investigating')").run(s.id,s.name+" is down","Automated monitor failed"+(code?" (HTTP "+code+")":"")+".");
   notify("🔴 "+s.name+" is DOWN. NexyonCloud monitoring detected a failed health check.");
  }else{
   db.prepare("UPDATE incidents SET status='resolved',resolved_at=CURRENT_TIMESTAMP WHERE service_id=? AND status!='resolved'").run(s.id);
   db.prepare("INSERT INTO incidents(service_id,title,message,status,resolved_at) VALUES(?,?,?,'resolved',CURRENT_TIMESTAMP)").run(s.id,s.name+" recovered","Automated health check succeeded in "+ms+" ms.");
   notify("🟢 "+s.name+" has recovered. Response time: "+ms+" ms.");
  }
 }
}
let monitoring=false;
async function runChecks(){
 if(monitoring)return;monitoring=true;
 try{const list=db.prepare("SELECT * FROM services WHERE enabled=1 AND url!=''").all();for(const s of list)await checkService(s);}
 finally{monitoring=false;}
}
function uptimeFor(id,hours){
 const row=db.prepare("SELECT COUNT(*) total,SUM(ok) good FROM checks WHERE service_id=? AND checked_at>=datetime('now',?)").get(id,"-"+hours+" hours");
 return row.total?100*row.good/row.total:null;
}
app.get("/",(req,res)=>res.render("index"));
app.get("/api/status",(req,res)=>{
 const services=db.prepare("SELECT id,name,description,status,response_ms,updated_at,last_checked,url,enabled FROM services ORDER BY sort_order,id").all().map(s=>({
 ...s,monitored:!!s.url&&!!s.enabled,uptime24h:uptimeFor(s.id,24),uptime7d:uptimeFor(s.id,168),uptime30d:uptimeFor(s.id,720)
 }));
 const incidents=db.prepare("SELECT i.id,i.title,i.message,i.status,i.created_at,i.resolved_at,s.name service_name FROM incidents i LEFT JOIN services s ON s.id=i.service_id ORDER BY i.id DESC LIMIT 20").all();
 res.json({services,incidents,updatedAt:new Date().toISOString(),checkInterval:CHECK_EVERY});
});
app.get("/admin",adminOnly,(req,res)=>res.render("admin",{services:db.prepare("SELECT * FROM services ORDER BY sort_order,id").all(),incidents:db.prepare("SELECT i.*,s.name service_name FROM incidents i LEFT JOIN services s ON s.id=i.service_id ORDER BY i.id DESC LIMIT 30").all(),interval:CHECK_EVERY}));
app.post("/admin/service",adminOnly,async(req,res)=>{
 const {name,description,status,url}=req.body;
 if(!name||!["operational","degraded","outage","maintenance","unknown"].includes(status))return res.status(400).send("Invalid service data");
 try{const safeUrl=await validateMonitorUrl((url||"").trim());db.prepare("INSERT INTO services(name,description,url,status) VALUES(?,?,?,?)").run(name.trim(),description||"",safeUrl,safeUrl?"unknown":status);notify("➕ NexyonCloud service added: "+name.trim());}
 catch(e){return res.status(400).send("Could not add service: "+e.message)}
 res.redirect("/admin");
});
app.post("/admin/service/:id",adminOnly,async(req,res)=>{
 const {name,description,status,url,enabled}=req.body;
 if(!name||!["operational","degraded","outage","maintenance","unknown"].includes(status))return res.status(400).send("Invalid service data");
 try{
  const safeUrl=await validateMonitorUrl((url||"").trim());
  const prev=db.prepare("SELECT * FROM services WHERE id=?").get(req.params.id);if(!prev)return res.status(404).send("Service not found");
  db.prepare("UPDATE services SET name=?,description=?,url=?,enabled=?,status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(name.trim(),description||"",safeUrl,enabled==="on"?1:0,safeUrl&&enabled==="on"?"unknown":status,req.params.id);
  if(prev.status!==status)notify("🔔 "+name+" status manually changed to "+status.toUpperCase());
 }catch(e){return res.status(400).send("Could not save service: "+e.message)}
 res.redirect("/admin");
});
app.post("/admin/service/:id/delete",adminOnly,(req,res)=>{db.prepare("DELETE FROM services WHERE id=?").run(req.params.id);res.redirect("/admin")});
app.post("/admin/check-now",adminOnly,async(req,res)=>{await runChecks();res.redirect("/admin")});
app.post("/admin/incident",adminOnly,(req,res)=>{
 const {service_id,title,message,status}=req.body;if(!title||!message)return res.status(400).send("Title and message are required");
 db.prepare("INSERT INTO incidents(service_id,title,message,status) VALUES(?,?,?,?)").run(service_id||null,title,message,status||"investigating");
 notify("⚠️ NexyonCloud incident: "+title+" — "+message);res.redirect("/admin");
});
app.post("/admin/incident/:id/resolve",adminOnly,(req,res)=>{db.prepare("UPDATE incidents SET status='resolved',resolved_at=CURRENT_TIMESTAMP WHERE id=?").run(req.params.id);notify("✅ NexyonCloud incident resolved.");res.redirect("/admin")});
app.get("/health",(req,res)=>res.json({ok:true,service:"NexyonCloud Status Page"}));
app.listen(PORT,()=>{console.log("NexyonCloud Status Page listening on port "+PORT);runChecks();setInterval(runChecks,CHECK_EVERY*1000);});
process.on("SIGINT",()=>{db.close();process.exit(0)});process.on("SIGTERM",()=>{db.close();process.exit(0)});