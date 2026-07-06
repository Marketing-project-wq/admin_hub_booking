// ───────────────────────────────────────────────────────────────────────────
// ⚠️  MIRROR dari Supabase Edge Function "my20fit-fasting-notify" (project cpvzwqptzcxnwzfzgrmt, verify_jwt=false).
// Snapshot untuk git. Repo ini TIDAK auto-deploy edge functions — kalau ada
// perubahan, WAJIB deploy ulang manual ke Supabase (supabase functions deploy my20fit-fasting-notify,
// atau Supabase MCP deploy_edge_function). Jangan edit lalu lupa deploy.
// ───────────────────────────────────────────────────────────────────────────

import { createClient } from "jsr:@supabase/supabase-js@2";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json=(o:any,s=200)=>new Response(JSON.stringify(o),{status:s,headers:{...cors,"Content-Type":"application/json"}});
const LOGO="https://media.20fit.id/wp-content/uploads/2026/05/Copy-of-new-logo-20fit-putih-3.png";
const APP="https://profile.20fit.id/calories.html#fasting";
const fmt=(m:number)=>{m=((m%1440)+1440)%1440;return String(Math.floor(m/60)).padStart(2,"0")+":"+String(m%60).padStart(2,"0");};

function buildHtml(kind:string,info:{style?:string,window?:string}){
  const open=kind==="open";
  const accent   = open?"#2A7A4F":"#C87000";
  const accentBg = open?"#e7f2ec":"#fbeede";
  const emoji    = open?"🍽️":"⏰";
  const badge    = open?"EAT NOW":"WRAP UP";
  const head     = open?"Your eating window is open":"Your eating window is closing";
  const msg      = open
    ? "It's time to break your fast. Enjoy a balanced, mindful meal and hit your calorie &amp; protein targets for today."
    : "Your eating window is about to close. Finish your last meal and get ready to start fasting until your next window.";
  const windowBox = info.window
    ? "<tr><td style='padding:18px 28px 2px'><table role='presentation' width='100%' cellpadding='0' cellspacing='0' style='background:#f6f4f0;border-radius:12px'><tr><td style='padding:15px 18px;text-align:center'>"+
        "<div style='font-size:11px;color:#9a907f;text-transform:uppercase;letter-spacing:1.5px;font-weight:bold'>Eating window</div>"+
        "<div style='font-size:22px;font-weight:bold;color:#0A0908;font-family:Courier New,monospace;margin-top:3px'>"+info.window+"</div>"+
        (info.style?"<div style='font-size:12px;color:#9a907f;margin-top:3px'>"+info.style+" style</div>":"")+
      "</td></tr></table></td></tr>"
    : "";
  return "<!DOCTYPE html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'></head>"+
    "<body style='margin:0;padding:0;background:#f4f2ee'>"+
    "<table role='presentation' width='100%' cellpadding='0' cellspacing='0' style='background:#f4f2ee;padding:24px 12px'><tr><td align='center'>"+
    "<table role='presentation' width='480' cellpadding='0' cellspacing='0' style='max-width:480px;width:100%;background:#ffffff;border-radius:18px;overflow:hidden;font-family:Arial,Helvetica,sans-serif'>"+
      "<tr><td style='background:#0A0908;padding:22px;text-align:center'><img src='"+LOGO+"' alt='20fit' height='26' style='height:26px'></td></tr>"+
      "<tr><td style='height:5px;line-height:5px;font-size:0;background:"+accent+"'>&nbsp;</td></tr>"+
      "<tr><td style='padding:30px 28px 4px;text-align:center'>"+
        "<div style='font-size:46px;line-height:1'>"+emoji+"</div>"+
        "<div style='display:inline-block;margin:14px 0 8px;padding:6px 16px;border-radius:999px;background:"+accentBg+";color:"+accent+";font-size:12px;font-weight:bold;letter-spacing:1.5px'>"+badge+"</div>"+
        "<h1 style='margin:6px 0 0;font-size:23px;color:#0A0908;line-height:1.25'>"+head+"</h1>"+
      "</td></tr>"+
      "<tr><td style='padding:8px 30px 2px;text-align:center'><p style='margin:0;font-size:15px;line-height:1.65;color:#555'>"+msg+"</p></td></tr>"+
      windowBox+
      "<tr><td style='padding:24px 28px 6px;text-align:center'><a href='"+APP+"' style='display:inline-block;background:#C41101;color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:12px;font-weight:bold;font-size:15px'>Open my tracker</a></td></tr>"+
      "<tr><td style='padding:22px 30px 28px;text-align:center'><p style='margin:0;font-size:12px;color:#b3a89a;line-height:1.55'>You're receiving this because Intermittent Fasting reminders are ON in your 20fit Health Profile. You can turn them off anytime in the app.</p></td></tr>"+
    "</table>"+
    "<div style='font-size:11px;color:#c2b9ab;margin-top:14px;font-family:Arial,sans-serif'>© 20FIT Sport Clinic · Indonesia</div>"+
    "</td></tr></table></body></html>";
}

async function sendEmail(to:string,kind:string,info:{style?:string,window?:string}={}){
  const key=Deno.env.get("MAILTRAP_API_KEY"); if(!key){console.log("[DEV] fasting email "+kind+" -> "+to);return{sent:false};}
  const url=Deno.env.get("MAILTRAP_API_URL")||"https://send.api.mailtrap.io/api/send";
  const from=Deno.env.get("MAIL_FROM_EMAIL")||"no-reply@20fit.id";
  const open=kind==="open";
  const subject=open?"🍽️ Your eating window is open":"⏰ Your eating window is closing";
  const html=buildHtml(kind,info);
  const r=await fetch(url,{method:"POST",headers:{"Authorization":"Bearer "+key,"Content-Type":"application/json"},body:JSON.stringify({from:{email:from,name:"20fit"},to:[{email:to}],subject,html,category:"FASTING"})});
  if(!r.ok)return{sent:false,error:"Mailtrap "+r.status+": "+(await r.text()).slice(0,200)};
  return{sent:true};
}

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  try{
    const sb=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    let b:any={}; try{b=await req.json();}catch(e){}
    if(b.action==="test"){ if(!b.email)return json({error:"email wajib"},400); const r=await sendEmail(b.email,b.kind==="close"?"close":"open",{style:"16:8",window:"12:00 – 20:00"}); return json({ok:true,test:r}); }
    const WINDOW=14;
    const now=new Date(); const utcMin=now.getUTCHours()*60+now.getUTCMinutes(); const wibMin=(utcMin+420)%1440;
    const wibDate=new Date(now.getTime()+420*60000).toISOString().slice(0,10);
    const q=await sb.from("my20fit_fasting").select("*").eq("notify_email",true);
    const rows=q.data||[]; let sent=0; const log:string[]=[];
    for(const row of rows){
      if(!row.email||!row.start_time)continue;
      const p=String(row.start_time).split(":"); const openMin=(+p[0])*60+(+p[1]); const eat=(row.eat_hours||8); if(eat>=24)continue; const closeMin=(openMin+eat*60)%1440;
      const info={style:row.style||undefined,window:fmt(openMin)+" – "+fmt(closeMin)};
      const dOpen=((wibMin-openMin)%1440+1440)%1440; const dClose=((wibMin-closeMin)%1440+1440)%1440;
      if(dOpen<WINDOW && row.last_open_date!==wibDate){ const r=await sendEmail(row.email,"open",info); if(r.sent){sent++;} await sb.from("my20fit_fasting").update({last_open_date:wibDate}).eq("auth_user_id",row.auth_user_id); log.push(row.email+":open"); }
      else if(dClose<WINDOW && row.last_close_date!==wibDate){ const r=await sendEmail(row.email,"close",info); if(r.sent){sent++;} await sb.from("my20fit_fasting").update({last_close_date:wibDate}).eq("auth_user_id",row.auth_user_id); log.push(row.email+":close"); }
    }
    return json({ok:true,checked:rows.length,sent,wibMin,wibDate,log});
  }catch(e){return json({error:String((e&&(e as any).message)||e)},500);}
});
