// notify_agents.ts (scheletro)
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const RESEND_API_KEY=Deno.env.get('RESEND_API_KEY'); const WHATSAPP_TOKEN=Deno.env.get('WHATSAPP_TOKEN'); const WABA_PHONE_ID=Deno.env.get('WABA_PHONE_ID');
Deno.serve(async (req)=>{ try{
  const body=await req.json(); const { price_list_id, version_label } = body;
  const SUPABASE_URL=Deno.env.get('SUPABASE_URL')!, SERVICE_KEY=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!; const client=createClient(SUPABASE_URL,SERVICE_KEY);
  const { data: changes } = await client.from('change_log').select('change_type').eq('price_list_id',price_list_id);
  const total=changes?.length||0, created=changes?.filter(c=>c.change_type==='created').length||0, updated=changes?.filter(c=>c.change_type==='updated').length||0, removed=changes?.filter(c=>c.change_type==='removed').length||0;
  const { data: agents } = await client.from('profiles').select('id,role,phone'); // per email usa webhook esterno o join con auth
  const summary=`Aggiornamento listino ${version_label}: ${total} modifiche (+${created} nuovi, ${updated} aggiornati, ${removed} ritirati).`;
  if(RESEND_API_KEY){ /* invio email (implementa come nel provider scelto) */ }
  if(WHATSAPP_TOKEN && WABA_PHONE_ID){ for(const a of agents||[]){ if(!a.phone) continue; await fetch(`https://graph.facebook.com/v19.0/${WABA_PHONE_ID}/messages`,{ method:'POST', headers:{'Authorization':`Bearer ${WHATSAPP_TOKEN}`,'Content-Type':'application/json'}, body:JSON.stringify({ messaging_product:'whatsapp', to:a.phone, type:'template', template:{ name:'listino_update', language:{code:'it'}, components:[{type:'body',parameters:[{type:'text',text:version_label},{type:'text',text:String(total)}]}] } }) }); } }
  return new Response(JSON.stringify({ok:true, sent_to:(agents||[]).length, summary}),{headers:{'content-type':'application/json'}});
}catch(e){ return new Response(JSON.stringify({ok:false,error:String(e)}),{status:500,headers:{'content-type':'application/json'}}); }});
