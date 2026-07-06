// ───────────────────────────────────────────────────────────────────────────
// ⚠️  MIRROR dari Supabase Edge Function "my20fit-ai" (project cpvzwqptzcxnwzfzgrmt, verify_jwt=false).
// Snapshot untuk git. Repo ini TIDAK auto-deploy edge functions — kalau ada
// perubahan, WAJIB deploy ulang manual ke Supabase (supabase functions deploy my20fit-ai,
// atau Supabase MCP deploy_edge_function). Jangan edit lalu lupa deploy.
// ───────────────────────────────────────────────────────────────────────────

const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const json=(o,s=200)=>new Response(JSON.stringify(o),{status:s,headers:{...cors,'Content-Type':'application/json'}});
function pj(t){try{return JSON.parse(t)}catch(e){}const a=t.indexOf('{'),z=t.lastIndexOf('}');if(a>=0&&z>a){try{return JSON.parse(t.slice(a,z+1))}catch(e){}}return null}
const FALLBACK_OR_KEY=Deno.env.get('OPENROUTER_API_KEY')??'REDACTED_SECRET';// ⚠️ secret di-redact dari mirror git — di fungsi live nilainya hardcoded; sebaiknya set via Supabase secret / Deno.env
const FOOD_SYS='You are an expert nutrition assistant for the 20fit fitness app. The user sends a photo of food or drinks. Identify each item WITH its estimated portion, and estimate calories and macros for realistic Indonesian portions. Be genuinely helpful and elaborate, not just numbers. Respond ONLY with a valid JSON object (no markdown, no code fences) with these keys: items (array of objects each with: name, portion (short string like "150g" or "1 mangkuk"), kcal, protein_g, carbs_g, fat_g, fiber_g), total_kcal (number), protein_g (TOTAL grams number), carbs_g (total grams), fat_g (total grams), fiber_g (total grams), description (2-3 sentences elaborating what the food is, how it looks prepared, and its main ingredients), satiety_score (integer 1-10 = how filling/mengenyangkan), satiety_note (one short sentence), health_score (integer 1-10 = how healthy overall), recommendation (2-4 sentences of practical advice: which nutrients this meal is high or low in, and specifically what to ADD or ADJUST for a more complete/balanced intake, e.g. add more vegetables / lean protein / fiber, or reduce fried/sugary parts), needs_more (array of 1-3 short strings naming nutrients the person should add more of, e.g. "protein","serat","sayur"), insights (array of 2 to 4 short helpful bullet strings), note (one short note). If the photo is not food, return items as an empty array and explain in note.';
const FOODTEXT_SYS='You are an expert nutrition assistant for the 20fit fitness app. The user types a food/drink name and an amount in grams. Estimate calories and macros for THAT amount, and be elaborate & helpful. Respond ONLY with a valid JSON object (no markdown, no code fences) with these keys: items (array with ONE object: name, portion (the amount, e.g. "100g"), kcal, protein_g, carbs_g, fat_g, fiber_g), total_kcal (number), protein_g (total grams), carbs_g (total grams), fat_g (total grams), fiber_g (total grams), description (2-3 sentences about the food and its main nutrients), satiety_score (integer 1-10), satiety_note (one short sentence), health_score (integer 1-10), recommendation (2-4 sentences: what nutrients it is high/low in and what to add or adjust for a more balanced intake), needs_more (array of 1-3 short nutrient strings), insights (array of 2 to 3 short bullet strings), note (short note). If it is not a real food, return items as empty array and explain in note.';
const MCU_SYS='You are a medical document explainer for the 20fit health app. The user uploads a medical check-up document or lab result. OCR and explain the data in plain language for a layperson. RESPOND AS FAST AND CONCISE AS POSSIBLE: summary max 2 sentences, and EACH explanation/why_it_matters/what_to_do must be ONE short sentence; plans are short bullet phrases. STRICT RULES: (1) ALWAYS include a clear reminder that this interpretation is NOT a substitute for consulting a doctor. (2) Do NOT make any diagnosis or name any disease; only explain factually what each value means, how it compares to its normal reference range, and in general terms why an out-of-range value matters for health. (3) If any part of the document is unreadable or unclear, list which parts in the unreadable field. (4) Maintain patient data confidentiality and never invent data that is not present. (5) For every parameter outside its normal range, set status to "attention" and add an entry to abnormal_findings. Respond ONLY with a valid JSON object (no markdown, no code fences) with these keys: document_type (string), patient_name (string or null), date (string or null), summary (2 sentences max, no diagnosis), parameters (array, each object: label, value, normal_range, status one of "normal"|"attention"|"unknown", direction one of "high"|"low"|"normal"|"unknown", explanation one short sentence without diagnosis), abnormal_findings (array, each object: label, value, severity one of "ringan"|"sedang"|"tinggi", why_it_matters one short factual sentence on why being out of range can be risky WITHOUT diagnosing, what_to_do one short action tip), eating_plan (array of 3-5 short bullet phrases), exercise_plan (array of 3-4 short bullet phrases; advise consulting the 20fit trainer/doctor before intense exercise if findings are concerning), lifestyle_plan (array of 2-3 short bullet phrases), unreadable (array of strings), disclaimer (one sentence reminding this is not a substitute for a doctor and to consult the 20fit doctor).';
Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
  try{
    const key=Deno.env.get('OPENROUTER_API_KEY')||FALLBACK_OR_KEY;
    const b=await req.json();
    const langMsg={role:'system',content:(b.lang==='en')?'Write every text field in the JSON output in ENGLISH.':'Tulis semua teks pada output JSON dalam BAHASA INDONESIA.'};
    let messages,maxTok,plugins=null;
    if(b.action==='food'){
      if(b.image){ maxTok=1700; messages=[{role:'system',content:FOOD_SYS},langMsg,{role:'user',content:[{type:'text',text:'Analyse the food/drinks in this photo. Give calories, macros, an elaborate description, satiety & health scores, and a helpful recommendation on what to add for a balanced intake.'},{type:'image_url',image_url:{url:b.image}}]}]; }
      else if(b.text){ maxTok=1000; messages=[{role:'system',content:FOODTEXT_SYS},langMsg,{role:'user',content:'Estimate calories, macros, description, satiety, health & a recommendation for: '+String(b.text).slice(0,200)}]; }
      else return json({error:'image atau text wajib diisi'},400);
    }else if(b.action==='mcu'){
      if(!b.file)return json({error:'file wajib diisi'},400);
      maxTok=2200;
      const isPdf=String(b.mime||'').includes('pdf')||String(b.file).startsWith('data:application/pdf');
      if(isPdf){
        plugins=[{id:'file-parser',pdf:{engine:'native'}}];
        messages=[{role:'system',content:MCU_SYS},langMsg,{role:'user',content:[{type:'text',text:'OCR and explain this medical check-up per the rules. Answer fast and concise.'},{type:'file',file:{filename:'mcu.pdf',file_data:b.file}}]}];
      }else{
        messages=[{role:'system',content:MCU_SYS},langMsg,{role:'user',content:[{type:'text',text:'OCR and explain this medical check-up per the rules. Answer fast and concise.'},{type:'image_url',image_url:{url:b.file}}]}];
      }
    }else if(b.action==='translate'){
      maxTok=2600;
      const target=(b.lang==='en')?'English':'Bahasa Indonesia';
      messages=[{role:'system',content:'You are a translator. Translate ALL human-readable string VALUES in the given JSON into '+target+'. Keep the JSON structure and keys identical. DO NOT translate or change these code values: status (normal/attention/unknown), direction (high/low/normal/unknown), severity (ringan/sedang/tinggi), and any numeric value or measurement. Respond ONLY with the translated JSON object, no markdown.'},{role:'user',content:JSON.stringify(b.data||{}).slice(0,9000)}];
    }else return json({error:'action tidak dikenal'},400);
    const payload={model:'google/gemini-2.5-flash-lite',messages,max_tokens:maxTok,temperature:0.3,reasoning:{enabled:false}};
    if(plugins)payload.plugins=plugins;
    const r=await fetch('https://openrouter.ai/api/v1/chat/completions',{method:'POST',headers:{'Authorization':'Bearer '+key,'Content-Type':'application/json','HTTP-Referer':'https://profile.20fit.id','X-Title':'20fit Health Profile'},body:JSON.stringify(payload)});
    if(!r.ok){const t=await r.text();return json({error:'AI error '+r.status,detail:t.slice(0,400)},500);}
    const data=await r.json();
    const content=(data.choices&&data.choices[0]&&data.choices[0].message&&data.choices[0].message.content)||'';
    const parsed=pj(content);
    if(!parsed)return json({error:'Gagal membaca hasil AI.',raw:String(content).slice(0,500)},502);
    return json({ok:true,result:parsed});
  }catch(e){return json({error:String((e&&e.message)||e)},500);}
});
