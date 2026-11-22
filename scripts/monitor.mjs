import fs from "node:fs/promises";
import dns from "node:dns/promises";
import net from "node:net";
const cfg=JSON.parse(await fs.readFile("config/services.json","utf8"));
const file="data/status.json";
let previous={services:[],incidents:[]};try{previous=JSON.parse(await fs.readFile(file,"utf8"));}catch{}
const now=new Date(),history=previous.history||{},oldMap=new Map((previous.services||[]).map(s=>[s.id,s]));
const incidents=[...(previous.incidents||[])];const services=[];
function private4(ip){const a=ip.split(".").map(Number);return a[0]===10||a[0]===127||a[0]===0||a[0]===169&&a[1]===254||a[0]===172&&a[1]>=16&&a[1]<=31||a[0]===192&&a[1]===168||a[0]>=224;}
async function safeUrl(raw){const u=new URL(raw);if(!["http:","https:"].includes(u.protocol)||u.username||u.password)throw Error("Invalid URL");const h=u.hostname;if(h==="localhost"||h.endsWith(".local")||h.endsWith(".localhost"))throw Error("Local hostname blocked");if(net.isIP(h)){if(h.includes(":")||private4(h))throw Error("Private address blocked");}else{const ips=await dns.lookup(h,{all:true});for(const x of ips)if(x.family===4?private4(x.address):x.address==="::1"||/^(fc|fd|fe80)/i.test(x.address))throw Error("Private address blocked");}return u;}
async function discord(text){const url=process.env.DISCORD_WEBHOOK_URL;if(!url)return;try{await fetch(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({content:text})});}catch(e){console.error("Discord notification failed",e.message);}}
for(const s of cfg.services){const old=oldMap.get(s.id)||{},enabled=s.enabled!==false&&!!s.url;let status=s.status||"unknown",ms=null;if(enabled){try{const u=await safeUrl(s.url),c=new AbortController(),t=setTimeout(()=>c.abort(),10000),start=Date.now();let r;try{r=await fetch(u,{signal:c.signal,redirect:"manual",headers:{"user-agent":"NexyonCloud-Status-Monitor/1.0"}});}finally{clearTimeout(t);}ms=Date.now()-start;status=r.status>=200&&r.status<400?"operational":"outage";}catch(e){status="outage";console.error(s.name,e.message);}}
const samples=history[s.id]||[];if(enabled){samples.push({at:now.toISOString(),ok:status==="operational"?1:0,ms});while(samples.length&&Date.now()-Date.parse(samples[0].at)>30*86400000)samples.shift();history[s.id]=samples;}
const calc=hours=>{const a=samples.filter(x=>Date.now()-Date.parse(x.at)<=hours*3600000);return a.length?100*a.reduce((n,x)=>n+x.ok,0)/a.length:null;};
const item={id:s.id,name:s.name,description:s.description||"",status:enabled?status:(s.status||"unknown"),monitored:enabled,responseMs:ms,uptime24h:calc(24),uptime7d:calc(168),uptime30d:calc(720)};
services.push(item);
if(enabled&&old.status&&old.status!==item.status){const down=item.status==="outage";incidents.unshift({title:s.name+(down?" is down":" recovered"),message:down?"Automated HTTP health check failed.":"Automated HTTP health check succeeded in "+ms+" ms.",serviceName:s.name,status:down?"investigating":"resolved",time:now.toISOString()});await discord((down?"🔴 ":"🟢 ")+s.name+(down?" is DOWN.":" has recovered.")+" NexyonCloud status page.");}
}
const result={updatedAt:now.toISOString(),checkIntervalMinutes:5,services,incidents:incidents.slice(0,100),history};await fs.writeFile(file,JSON.stringify(result,null,2)+"\n");
