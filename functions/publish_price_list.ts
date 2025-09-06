// publish_price_list.ts (scheletro)
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Papa from "https://esm.sh/papaparse@5.4.1";
Deno.serve(async (req)=>{ try{
  const SUPABASE_URL=Deno.env.get('SUPABASE_URL')!, SERVICE_KEY=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const client=createClient(SUPABASE_URL,SERVICE_KEY);
  const ct=req.headers.get('content-type')||''; let rows:any[]=[];
  if(ct.includes('text/csv')){ const csv=await req.text(); const parsed=Papa.parse(csv,{header:true}); rows=(parsed.data as any[]).filter(r=>r.Codice||r.Descrizione); }
  else { rows=await req.json(); }
  const map=(r:any)=>({ codice:String(r.Codice||'').trim(), descrizione:String(r.Descrizione||'').trim(), categoria:String(r.Categoria||'').trim(), sottocategoria:String(r.Sottocategoria||'').trim(), prezzo:r.Prezzo?Number(String(r.Prezzo).replace('.','').replace(',','.')):null, unita:String(r.Unita||'pz').trim(), disponibile:String(r.Disponibile||'').toLowerCase()==='si', novita:String(r.Novita||'').toLowerCase()==='si', pack:String(r.Pack||'').trim(), pallet:String(r.Pallet||'').trim(), tags:String(r.Tag||'').split(',').map((s:string)=>s.trim()).filter(Boolean), updated_at:new Date().toISOString() });
  const incoming=rows.map(map).filter(x=>x.codice);
  const { data: current } = await client.from('products').select('codice,prezzo,descrizione,disponibile,novita,tags');
  const curBy=new Map((current||[]).map((p:any)=>[p.codice,p])); const created:any[]=[], updated:any[]=[], seen=new Set<string>();
  for(const r of incoming){ seen.add(r.codice); const cur=curBy.get(r.codice); if(!cur){ created.push(r);} else { const delta:any={}; if(cur.prezzo!==r.prezzo) delta.prezzo={from:cur.prezzo,to:r.prezzo}; if(cur.descrizione!==r.descrizione) delta.descrizione={from:cur.descrizione,to:r.descrizione}; if(cur.disponibile!==r.disponibile) delta.disponibile={from:cur.disponibile,to:r.disponibile}; if(cur.novita!==r.novita) delta.novita={from:cur.novita,to:r.novita}; if(JSON.stringify(cur.tags||[])!==JSON.stringify(r.tags||[])) delta.tags={from:cur.tags,to:r.tags}; if(Object.keys(delta).length) updated.push({...r, delta}); } }
  const removed=(current||[]).filter((p:any)=>!seen.has(p.codice));
  const version=new Date().toISOString().slice(0,10);
  const { data: pl } = await client.from('price_lists').insert({ version_label:version }).select('id').single();
  const price_list_id=pl.id;
  if(created.length) await client.from('products').insert(created);
  for(const u of updated){ await client.from('products').update(u).eq('codice',u.codice); }
  const changes:any[]=[]; created.forEach(c=>changes.push({price_list_id,codice:c.codice,change_type:'created',delta:null}));
  updated.forEach(u=>changes.push({price_list_id,codice:u.codice,change_type:'updated',delta:u.delta}));
  removed.forEach(r=>changes.push({price_list_id,codice:r.codice,change_type:'removed',delta:null}));
  if(changes.length) await client.from('change_log').insert(changes);
  const { data: snap } = await client.from('products').select('*'); if(snap?.length){ const items=snap.map((s:any)=>({price_list_id,...s})); items.forEach((i:any)=>{ delete i.id; }); await client.from('price_list_items').insert(items); }
  await client.functions.invoke('notify_agents',{ body:{ price_list_id, version_label: version } });
  return new Response(JSON.stringify({ok:true, version, created:created.length, updated:updated.length, removed:removed.length}),{headers:{'content-type':'application/json'}});
}catch(e){ return new Response(JSON.stringify({ok:false,error:String(e)}),{status:500,headers:{'content-type':'application/json'}}); }});
