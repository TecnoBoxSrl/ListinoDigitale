/* ================================================
   Listino Digitale – Tecnobox (login + preventivi)
   - Auth: email/password (no magic link)
   - Ricerca live, vista listino/card, modale immagini
   - Checkbox per selezione articoli
   - Pannello preventivo fisso a destra
   - Export XLSX (fallback CSV)
================================================ */

/* === CONFIG === */
const SUPABASE_URL = 'https://wajzudbaezbyterpjdxg.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indhanp1ZGJhZXpieXRlcnBqZHhnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcxODA4MTUsImV4cCI6MjA3Mjc1NjgxNX0.MxaAqdUrppG2lObO_L5-SgDu8D7eze7mBf6S9rR_Q2w';
const STORAGE_BUCKET = 'prodotti'; // cambia se usi un bucket diverso

/* === Supabase (UMD) === */
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* === Helpers === */
const $ = (id) => document.getElementById(id);
const normalize = (s)=> (s||'').toString().normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().trim();
const fmtEUR = (n)=> (n==null||isNaN(n)) ? '—' : n.toLocaleString('it-IT',{style:'currency',currency:'EUR'});

/* === Stato === */
const state = {
  role: 'guest',
  items: [],
  view: 'listino',       // 'listino' | 'card'
  search: '',
  sort: 'alpha',         // 'alpha' | 'priceAsc' | 'priceDesc' | 'newest'
  onlyAvailable: false,
  onlyNew: false,
  priceMax: null,
  selected: new Map(),   // codice -> {codice, descrizione, prezzo, conai, qty, sconto}
};

/* === BOOT === */
document.addEventListener('DOMContentLoaded', async () => {
  bindUI();
  injectQuotePanel();

  const { data:{ session } } = await supabase.auth.getSession();
  if (session?.user) await afterLogin(session.user.id);
  else showAuthGate(true);

  supabase.auth.onAuthStateChange(async (_e, sess) => {
    if (sess?.user) await afterLogin(sess.user.id);
    else await afterLogout();
  });

  const y = $('year'); if (y) y.textContent = new Date().getFullYear();
});

/* === UI base === */
function showAuthGate(show){
  const gate=$('authGate'), app=$('appShell');
  if (!gate||!app) return;
  gate.classList.toggle('hidden', !show);
  app.classList.toggle('hidden', show);
}

function bindUI(){
  // Login
  $('btnDoLogin')?.addEventListener('click', doLogin);
  [$('loginEmail'),$('loginPassword')].forEach(el=> el?.addEventListener('keydown', e=>{
    if(e.key==='Enter'){ e.preventDefault(); doLogin(); }
  }));
  $('btnSendReset')?.addEventListener('click', sendReset);

  // Logout
  $('btnLogout')?.addEventListener('click', doLogout);
  $('btnLogoutM')?.addEventListener('click', doLogout);

  // Vista
  $('viewListino')?.addEventListener('click', ()=>{ state.view='listino'; renderView(); });
  $('viewCard')?.addEventListener('click',   ()=>{ state.view='card';    renderView(); });

  // Ricerca live
  const onSearch = (e)=>{ state.search = normalize(e.target.value); renderView(); };
  $('searchInput')?.addEventListener('input', onSearch);
  $('searchInputM')?.addEventListener('input', onSearch);

  // Filtri
  $('sortSelect')?.addEventListener('change', (e)=>{ state.sort=e.target.value; renderView(); });
  $('filterDisponibile')?.addEventListener('change', (e)=>{ state.onlyAvailable=e.target.checked; renderView(); });
  $('filterNovita')?.addEventListener('change', (e)=>{ state.onlyNew=e.target.checked; renderView(); });
  $('filterPriceMax')?.addEventListener('input', (e)=>{
    const s = String(e.target.value||'').trim().replace(/\./g,'').replace(',','.');
    const v = parseFloat(s); state.priceMax = isNaN(v)?null:v; renderView();
  });

  // Modale immagine
  $('imgBackdrop')?.addEventListener('click', ()=>toggleModal('imgModal', false));
  $('imgClose')?.addEventListener('click', ()=>toggleModal('imgModal', false));
  document.addEventListener('keydown', (ev)=>{
    const m=$('imgModal'); if (ev.key==='Escape' && m && !m.classList.contains('hidden')) toggleModal('imgModal', false);
  });

  // Mobile menu
  $('btnMobileMenu')?.addEventListener('click', ()=>{ const m=$('mobileMenu'); if(m) m.hidden=!m.hidden; });
}

function toggleModal(id, show=true){
  const el=$(id); if(!el) return;
  el.classList.toggle('hidden', !show);
  document.body.classList.toggle('modal-open', show);
}

/* === AUTH === */
async function doLogin(){
  const email = $('loginEmail')?.value?.trim();
  const password = $('loginPassword')?.value || '';
  const msg = $('loginMsg');
  if (!email || !password){ if(msg) msg.textContent='Inserisci email e password.'; return; }
  msg && (msg.textContent='Accesso in corso…');
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error){ msg && (msg.textContent='Accesso non riuscito: '+error.message); return; }
  await afterLogin(data.user.id);
}

async function sendReset(){
  const email = $('loginEmail')?.value?.trim();
  const msg = $('loginMsg');
  if (!email){ msg && (msg.textContent='Inserisci email per il reset.'); return; }
  const site = window.location.origin + window.location.pathname;
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: site });
  msg && (msg.textContent = error ? ('Reset non riuscito: '+error.message) : 'Email di reset inviata.');
}

async function doLogout(){
  await supabase.auth.signOut();
  await afterLogout();
}

async function afterLogin(userId){
  // ruolo opzionale (se non hai la tabella profiles non fa nulla)
  const { data: prof } = await supabase.from('profiles').select('role').eq('id', userId).maybeSingle();
  state.role = (prof?.role==='admin') ? 'admin' : 'agent';

  showAuthGate(false);
  await fetchProducts();
  renderView();
}

async function afterLogout(){
  showAuthGate(true);
  state.role='guest';
  state.items=[];
  state.selected.clear();
  renderQuotePanel();
  const g=$('productGrid'), l=$('listinoContainer'); if(g) g.innerHTML=''; if(l) l.innerHTML='';
}

/* === DATA === */
async function fetchProducts(){
  try{
    // IMPORTANTISSIMO: seleziona SOLO colonne esistenti
    const { data, error } = await supabase
      .from('products')
      .select(`
        id,
        codice,
        descrizione,
        categoria,
        sottocategoria,
        prezzo,
        unita,
        disponibile,
        novita,
        pack,
        pallet,
        tags,
        updated_at
      `)
      .order('descrizione', { ascending: true });

    if (error) throw error;

    const items = (data || []).map(p => ({
      codice: p.codice,
      descrizione: p.descrizione,
      categoria: p.categoria,
      sottocategoria: p.sottocategoria,
      prezzo: p.prezzo,
      unita: p.unita,
      disponibile: p.disponibile,
      novita: p.novita,
      pack: p.pack,
      pallet: p.pallet,
      tags: p.tags || [],
      updated_at: p.updated_at,
      conaiPerCollo: 0,    // default (non presente a DB)
      img: ''              // se in futuro aggiungi product_media, qui popoli la signed URL
    }));

    state.items = items;
    buildCategories();
    const info=$('resultInfo'); if(info) info.textContent = `${items.length} articoli`;
  } catch(e){
    console.error('[Listino] fetchProducts error', e);
    const info=$('resultInfo'); if(info) info.textContent='Errore caricamento listino';
  }
}

/* === CATEGORIE === */
function buildCategories(){
  const box=$('categoryList'); if(!box) return;
  const set = new Set(state.items.map(p=>p.categoria || 'Altro'));
  const cats = ['Tutte', ...Array.from(set).sort((a,b)=>a.localeCompare(b,'it'))];
  box.innerHTML='';
  cats.forEach(cat=>{
    const b=document.createElement('button');
    b.className='tag hover:bg-slate-100';
    b.textContent=cat;
    b.addEventListener('click', ()=>{ state.selectedCategory=cat; renderView(); });
    box.appendChild(b);
  });
  state.selectedCategory = 'Tutte';
}

/* === FILTRI === */
function applyFilters(arr){
  let out=[...arr];
  if (state.selectedCategory && state.selectedCategory!=='Tutte')
    out = out.filter(p => (p.categoria||'Altro') === state.selectedCategory);
  if (state.search){
    const q=state.search;
    out = out.filter(p => normalize((p.codice||'')+' '+(p.descrizione||'')+' '+(p.tags||[]).join(' ')).includes(q));
  }
  if (state.onlyAvailable) out = out.filter(p=>p.disponibile);
  if (state.onlyNew) out = out.filter(p=>p.novita);
  if (state.priceMax!=null) out = out.filter(p=> p.prezzo!=null && p.prezzo<=state.priceMax);
  switch(state.sort){
    case 'priceAsc':  out.sort((a,b)=>(a.prezzo??Infinity)-(b.prezzo??Infinity)); break;
    case 'priceDesc': out.sort((a,b)=>(b.prezzo??-Infinity)-(a.prezzo??-Infinity)); break;
    case 'newest':    out.sort((a,b)=>(b.updated_at||'').localeCompare(a.updated_at||'')); break;
    default:          out.sort((a,b)=>(a.descrizione||'').localeCompare(b.descrizione||'','it')); break;
  }
  return out;
}

/* === RENDER SWITCH === */
function renderView(){
  const grid=$('productGrid'), listino=$('listinoContainer');
  if (!grid || !listino) return;
  if (state.view==='listino'){
    grid.classList.add('hidden');  listino.classList.remove('hidden');
    renderListino();
  } else {
    listino.classList.add('hidden'); grid.classList.remove('hidden');
    renderCards();
  }
}

/* === LISTINO con checkbox === */
function renderListino(){
  const container=$('listinoContainer'); if(!container) return;
  container.innerHTML='';

  // group by categoria
  const byCat=new Map();
  for (const p of applyFilters(state.items)){
    const c=p.categoria || 'Altro';
    if (!byCat.has(c)) byCat.set(c, []);
    byCat.get(c).push(p);
  }
  const cats=[...byCat.keys()].sort((a,b)=>a.localeCompare(b,'it'));
  if (!cats.length){ container.innerHTML='<div class="text-slate-500 py-10 text-center">Nessun articolo.</div>'; return; }

  for (const cat of cats){
    const items = byCat.get(cat).sort((a,b)=>(a.codice||'').localeCompare(b.codice||'','it'));
    const h=document.createElement('h2'); h.className='text-lg font-semibold mt-2 mb-1'; h.textContent=cat; container.appendChild(h);

    const table=document.createElement('table'); table.className='w-full text-sm border-collapse';
    table.innerHTML=`
      <thead class="bg-slate-100">
        <tr>
          <th class="border px-2 py-1 text-center w-8">Sel</th>
          <th class="border px-2 py-1 text-left">Codice</th>
          <th class="border px-2 py-1 text-left">Descrizione</th>
          <th class="border px-2 py-1 text-left">Conf.</th>
          <th class="border px-2 py-1 text-right">Prezzo</th>
          <th class="border px-2 py-1 text-center">Img</th>
        </tr>
      </thead>
      <tbody></tbody>`;
    const tb=table.querySelector('tbody');

    for (const p of items){
      const tr=document.createElement('tr');
      const checked = state.selected.has(p.codice) ? 'checked' : '';
      tr.innerHTML=`
        <td class="border px-2 py-1 text-center"><input type="checkbox" class="selItem" data-code="${p.codice}" ${checked}></td>
        <td class="border px-2 py-1 whitespace-nowrap font-mono">${p.codice||''}</td>
        <td class="border px-2 py-1">${p.descrizione||''} ${p.novita?'<span class="ml-2 text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-[2px]">Novità</span>':''}</td>
        <td class="border px-2 py-1">${p.pack||''}</td>
        <td class="border px-2 py-1 text-right">${fmtEUR(p.prezzo)}</td>
        <td class="border px-2 py-1 text-center">${p.img?`<button class="text-sky-600 underline btnImg" data-src="${p.img}" data-title="${encodeURIComponent(p.descrizione||'')}">📷</button>`:'—'}</td>`;
      tb.appendChild(tr);
    }
    container.appendChild(table);
  }

  container.querySelectorAll('.selItem').forEach(chk=>{
    chk.addEventListener('change', (e)=>{
      const code=e.currentTarget.getAttribute('data-code');
      const prod=state.items.find(x=>x.codice===code);
      if (!prod) return;
      if (e.currentTarget.checked) addToQuote(prod);
      else removeFromQuote(code);
    });
  });
  container.querySelectorAll('.btnImg').forEach(btn=>{
    btn.addEventListener('click', (e)=>{
      const src=e.currentTarget.getAttribute('data-src');
      const title=decodeURIComponent(e.currentTarget.getAttribute('data-title')||'');
      const img=$('imgPreview'), ttl=$('imgTitle');
      if (img){ img.src=src; img.alt=title; }
      if (ttl){ ttl.textContent=title; }
      toggleModal('imgModal', true);
    });
  });
}

/* === CARD view === */
function renderCards(){
  const grid=$('productGrid'); if(!grid) return;
  grid.innerHTML='';

  const arr=applyFilters(state.items);
  if (!arr.length){ grid.innerHTML='<div class="col-span-full text-center text-slate-500 py-10">Nessun articolo.</div>'; return; }

  for (const p of arr){
    const checked = state.selected.has(p.codice) ? 'checked' : '';
    const card=document.createElement('article'); card.className='relative card rounded-2xl bg-white border shadow-sm overflow-hidden';
    card.innerHTML=`
      <label class="absolute top-2 left-2 bg-white/80 backdrop-blur rounded-md px-2 py-1 flex items-center gap-1 text-xs">
        <input type="checkbox" class="selItem" data-code="${p.codice}" ${checked}> Seleziona
      </label>
      <div class="aspect-square bg-slate-100 grid place-content-center">
        ${p.img?`<img src="${p.img}" alt="${p.descrizione||''}" class="w-full h-full object-contain" loading="lazy" decoding="async">`
               :`<div class="text-slate-400">Nessuna immagine</div>`}
      </div>
      <div class="p-3 space-y-2">
        <div class="flex items-start justify-between gap-2">
          <h3 class="font-medium leading-snug line-clamp-2">${p.descrizione||''}</h3>
          ${p.novita?'<span class="tag bg-emerald-50 text-emerald-700 border-emerald-200">Novità</span>':''}
        </div>
        <p class="text-xs text-slate-500">${p.codice||''}</p>
        <div class="flex items-center justify-between">
          <div class="text-lg font-semibold">${fmtEUR(p.prezzo)}</div>
          ${p.img?`<button class="rounded-xl border px-3 py-1.5 text-sm hover:bg-slate-50 btnImg" data-src="${p.img}" data-title="${encodeURIComponent(p.descrizione||'')}">Vedi</button>`:''}
        </div>
      </div>`;
    grid.appendChild(card);
  }

  grid.querySelectorAll('.selItem').forEach(chk=>{
    chk.addEventListener('change', (e)=>{
      const code=e.currentTarget.getAttribute('data-code');
      const prod=state.items.find(x=>x.codice===code);
      if (!prod) return;
      if (e.currentTarget.checked) addToQuote(prod);
      else removeFromQuote(code);
    });
  });
  grid.querySelectorAll('.btnImg').forEach(btn=>{
    btn.addEventListener('click', (e)=>{
      const src=e.currentTarget.getAttribute('data-src');
      const title=decodeURIComponent(e.currentTarget.getAttribute('data-title')||'');
      const img=$('imgPreview'), ttl=$('imgTitle');
      if (img){ img.src=src; img.alt=title; }
      if (ttl){ ttl.textContent=title; }
      toggleModal('imgModal', true);
    });
  });
}

/* ===== Preventivo (pannello destro) ===== */
function injectQuotePanel(){
  if ($('quotePanel')) return;
  const panel=document.createElement('aside');
  panel.id='quotePanel';
  panel.className='fixed top-0 right-0 h-screen w-[420px] max-w-[90vw] bg-white border-l shadow-xl hidden lg:block z-40';
  panel.innerHTML=`
    <div class="h-full flex flex-col">
      <div class="px-4 py-3 border-b flex items-center justify-between">
        <h3 class="font-semibold">Preventivo</h3>
        <div class="flex gap-2">
          <button id="btnExportQuote" class="rounded-lg bg-sky-600 text-white px-3 py-1.5 text-sm">Scarica</button>
          <button id="btnClearQuote" class="rounded-lg border px-3 py-1.5 text-sm">Svuota</button>
        </div>
      </div>
      <div class="overflow-auto flex-1">
        <table class="w-full text-xs border-collapse">
          <thead class="bg-slate-100 sticky top-0">
            <tr>
              <th class="border px-2 py-1">Codice</th>
              <th class="border px-2 py-1">Descrizione</th>
              <th class="border px-2 py-1 text-right">Prezzo</th>
              <th class="border px-2 py-1 text-right">CONAI/collo</th>
              <th class="border px-2 py-1 text-center">Q.tà</th>
              <th class="border px-2 py-1 text-center">Sconto %</th>
              <th class="border px-2 py-1 text-right">Prezzo scont.</th>
              <th class="border px-2 py-1 text-right">Totale riga</th>
              <th class="border px-2 py-1 text-center">Azioni</th>
            </tr>
          </thead>
          <tbody id="quoteBody"></tbody>
        </table>
      </div>
      <div class="border-t p-3 text-sm">
        <div class="flex items-center justify-between">
          <span>Totale imponibile</span>
          <strong id="quoteTotal">—</strong>
        </div>
      </div>
    </div>`;
  document.body.appendChild(panel);

  $('btnExportQuote')?.addEventListener('click', exportQuote);
  $('btnClearQuote')?.addEventListener('click', ()=>{
    state.selected.clear();
    renderQuotePanel();
    document.querySelectorAll('.selItem').forEach(i=>{ i.checked=false; });
  });

  panel.classList.remove('hidden'); // mostra su desktop
}

function addToQuote(p){
  const item = state.selected.get(p.codice) || {
    codice:p.codice, descrizione:p.descrizione, prezzo:p.prezzo||0, conai: 0, qty:1, sconto:0
  };
  if (state.selected.has(p.codice)) item.qty += 1;
  state.selected.set(p.codice, item);
  renderQuotePanel();
}

function removeFromQuote(code){
  state.selected.delete(code);
  renderQuotePanel();
}

function lineCalc(it){
  const sconto = Math.min(100, Math.max(0, Number(it.sconto||0)));
  const prezzoScont = (Number(it.prezzo||0)) * (1 - sconto/100);
  const totale = prezzoScont * Number(it.qty||0) + (Number(it.conai||0) * Number(it.qty||0));
  return { prezzoScont, totale };
}

function renderQuotePanel(){
  const body=$('quoteBody'), tot=$('quoteTotal');
  if (!body || !tot) return;
  body.innerHTML='';
  let total=0;

  for (const it of state.selected.values()){
    const { prezzoScont, totale } = lineCalc(it);
    total += totale;

    const tr=document.createElement('tr');
    tr.innerHTML=`
      <td class="border px-2 py-1 font-mono">${it.codice}</td>
      <td class="border px-2 py-1">${it.descrizione}</td>
      <td class="border px-2 py-1 text-right">${fmtEUR(it.prezzo)}</td>
      <td class="border px-2 py-1 text-right">${fmtEUR(it.conai||0)}</td>
      <td class="border px-2 py-1 text-center"><input type="number" class="w-16 border rounded px-1 py-0.5 text-right inputQty" data-code="${it.codice}" value="${Number(it.qty)||1}" step="1" min="1"></td>
      <td class="border px-2 py-1 text-center"><input type="number" class="w-16 border rounded px-1 py-0.5 text-right inputSconto" data-code="${it.codice}" value="${Number(it.sconto)||0}" step="1" min="0" max="100"></td>
      <td class="border px-2 py-1 text-right">${fmtEUR(prezzoScont)}</td>
      <td class="border px-2 py-1 text-right">${fmtEUR(totale)}</td>
      <td class="border px-2 py-1 text-center"><button class="text-rose-600 underline btnRemove" data-code="${it.codice}">Rimuovi</button></td>`;
    body.appendChild(tr);
  }

  tot.textContent = fmtEUR(total);

  // bind
  body.querySelectorAll('.inputQty').forEach(inp=>{
    inp.addEventListener('input', (e)=>{
      const code=e.currentTarget.getAttribute('data-code');
      const it=state.selected.get(code); if(!it) return;
      const v = Math.max(1, parseInt(e.target.value||'1',10));
      it.qty=v; state.selected.set(code, it); renderQuotePanel();
    });
  });
  body.querySelectorAll('.inputSconto').forEach(inp=>{
    inp.addEventListener('input', (e)=>{
      const code=e.currentTarget.getAttribute('data-code');
      const it=state.selected.get(code); if(!it) return;
      let v=parseInt(e.target.value||'0',10); if(isNaN(v)) v=0;
      v=Math.max(0, Math.min(100, v));
      it.sconto=v; state.selected.set(code, it); renderQuotePanel();
    });
  });
  body.querySelectorAll('.btnRemove').forEach(btn=>{
    btn.addEventListener('click', (e)=>{
      const code=e.currentTarget.getAttribute('data-code');
      state.selected.delete(code);
      document.querySelectorAll(`.selItem[data-code="${CSS.escape(code)}"]`).forEach(i=>{ i.checked=false; });
      renderQuotePanel();
    });
  });
}

/* === EXPORT === */
function exportQuote(){
  const rows = [['Codice','Descrizione','Prezzo','CONAI/collo','Q.tà','Sconto %','Prezzo scont.','Totale riga']];
  let total=0;
  for (const it of state.selected.values()){
    const { prezzoScont, totale } = lineCalc(it);
    total += totale;
    rows.push([
      it.codice, it.descrizione,
      Number(it.prezzo||0), Number(it.conai||0), Number(it.qty||0), Number(it.sconto||0),
      Number(prezzoScont||0), Number(totale||0),
    ]);
  }
  rows.push([]); rows.push(['','','','','','','Totale imponibile', Number(total||0)]);

  const filename = `preventivo_${new Date().toISOString().slice(0,16).replace(/[:T]/g,'-')}.xlsx`;

  if (window.XLSX){
    const ws=XLSX.utils.aoa_to_sheet(rows);
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Preventivo');
    const wbout=XLSX.write(wb,{bookType:'xlsx',type:'array'});
    const blob=new Blob([wbout], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=filename; a.click(); URL.revokeObjectURL(a.href);
  } else {
    const csv = rows.map(r=>r.map(v=>{
      const s=(v==null)?'':String(v);
      return /[",;\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
    }).join(';')).join('\n');
    const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=filename.replace('.xlsx','.csv'); a.click(); URL.revokeObjectURL(a.href);
  }
}
