/* ================================
   Listino Digitale – script.js (v21)
   + Preventivo: selezione articoli, qty, sconto, CONAI, export Excel
   + Login magic link (hash e ?code)
   + Vista listino/card, ricerca, immagini (signed URL)
================================ */

/* ==== CONFIG ==== */
const SUPABASE_URL = 'https://wajzudbaezbyterpjdxg.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indhanp1ZGJhZXpieXRlcnBqZHhnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcxODA4MTUsImV4cCI6MjA3Mjc1NjgxNX0.MxaAqdUrppG2lObO_L5-SgDu8D7eze7mBf6S9rR_Q2w';
const SITE_URL = 'https://tecnoboxsrl.github.io/ListinoDigitale/';
const STORAGE_BUCKET = 'prodotti'; // o 'media'

/* ==== Supabase ==== */
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ==== Helpers ==== */
const $ = (id) => document.getElementById(id);
const on = (el, ev, fn) => { if (el) el.addEventListener(ev, fn, { passive:true }); };
const debounce = (fn, ms=120) => { let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); }; };
const normalizeQuery = (s)=> (s||'').toString().normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().trim();
const toggleModal = (id, show=true)=>{ const el=$(id); if(!el) return; el.classList.toggle('hidden', !show); document.body.classList.toggle('modal-open', show); };
const parseItNumber = (v)=>{ if(v==null) return null; if(typeof v==='number') return v; const n=parseFloat(String(v).trim().replace(/\./g,'').replace(',','.')); return isNaN(n)?null:n; };
const fmtEUR = (n)=> (n==null||isNaN(n)) ? '—' : n.toLocaleString('it-IT',{style:'currency',currency:'EUR'});

/* ==== Stato ==== */
const state = {
  items: [],
  categories: [],
  selectedCategory: 'Tutte',
  search: '',
  sort: 'alpha',
  onlyAvailable: false,
  onlyNew: false,
  priceMax: null,
  role: 'guest',
  view: 'listino',

  // Preventivo
  quote: new Map(), // key: codice, val: {codice, descrizione, prezzo, qty, sconto, conai}
  quoteConaiDefault: 0,
};

/* ==== Boot ==== */
document.addEventListener('DOMContentLoaded', async () => {
  if ($('year')) $('year').textContent = new Date().getFullYear();
  setupUI();

  await handleAuthRedirect();
  await restoreSession();
  await renderAuthState();
  if (state.role !== 'guest') await fetchProducts();
  renderView();
  renderQuoteBox();
});

/* ==== Auth redirect ==== */
async function handleAuthRedirect(){
  try {
    const url = new URL(window.location.href);

    // errori nell’hash
    if (location.hash && location.hash.includes('error=')) {
      const h = new URLSearchParams(location.hash.slice(1));
      const desc = h.get('error_description') || h.get('error') || 'Errore di accesso';
      const msg = $('loginMsg') || $('resultInfo');
      if (msg) msg.textContent = `Accesso non riuscito: ${desc}`;
      history.replaceState({}, document.title, url.origin + url.pathname);
      return;
    }

    // flusso PKCE (?code=...)
    const code = url.searchParams.get('code');
    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) console.error('[Auth] exchangeCodeForSession', error);
      history.replaceState({}, document.title, url.origin + url.pathname);
      return;
    }

    // hash con token (/#access_token=...&refresh_token=...)
    if (location.hash && location.hash.includes('access_token=')) {
      const h = new URLSearchParams(location.hash.slice(1));
      const access_token  = h.get('access_token');
      const refresh_token = h.get('refresh_token');
      if (access_token && refresh_token) {
        const { error } = await supabase.auth.setSession({ access_token, refresh_token });
        if (error) console.error('[Auth] setSession', error);
      }
      history.replaceState({}, document.title, url.origin + url.pathname);
    }
  } catch (e) {
    console.error('[Auth] handleAuthRedirect exception', e);
  }
}

/* ==== UI ==== */
function setupUI(){
  // login/logout
  on($('btnLogin'),  'click', ()=> toggleModal('loginModal', true));
  on($('btnLoginM'), 'click', ()=> toggleModal('loginModal', true));
  on($('btnLogout'),  'click', signOut);
  on($('btnLogoutM'), 'click', signOut);
  on($('loginClose'), 'click', ()=> toggleModal('loginModal', false));
  on($('loginBackdrop'), 'click', ()=> toggleModal('loginModal', false));
  on($('imgClose'), 'click', ()=> toggleModal('imgModal', false));
  on($('imgBackdrop'), 'click', ()=> toggleModal('imgModal', false));
  on($('btnMobileMenu'), 'click', ()=>{ const m=$('mobileMenu'); if(m) m.hidden=!m.hidden; });

  // ricerca live
  const handleSearch = debounce((e)=>{ state.search = normalizeQuery(e.target.value); renderView(); }, 120);
  on($('searchInput'), 'input', handleSearch);
  on($('searchInputM'), 'input', handleSearch);

  // filtri/ordinamento
  on($('sortSelect'), 'change', (e)=>{ state.sort=e.target.value; renderView(); });
  on($('filterDisponibile'), 'change', (e)=>{ state.onlyAvailable=e.target.checked; renderView(); });
  on($('filterNovita'), 'change', (e)=>{ state.onlyNew=e.target.checked; renderView(); });
  on($('filterPriceMax'), 'input', (e)=>{ state.priceMax=parseItNumber(e.target.value); renderView(); });

  // invio magic link
  on($('loginSend'), 'click', sendMagicLink);

  // vista
  on($('viewListino'), 'click', ()=>{ state.view='listino'; renderView(); });
  on($('viewCard'),   'click', ()=>{ state.view='card';    renderView(); });

  // Preventivo
  on($('quoteExport'), 'click', exportQuoteToExcel);
  on($('quoteClear'), 'click', ()=>{ state.quote.clear(); renderQuoteBox(); syncChecksFromQuote(); });
  on($('quoteConaiDefault'), 'input', (e)=>{ state.quoteConaiDefault = parseItNumber(e.target.value) || 0; renderQuoteBox(); });
}

/* ==== Auth ==== */
async function restoreSession(){
  const { data:{ session } } = await supabase.auth.getSession();
  if (session?.user) {
    const { data: prof } = await supabase.from('profiles').select('role').eq('id', session.user.id).maybeSingle();
    state.role = (prof?.role === 'admin') ? 'admin' : 'agent';
  } else {
    state.role = 'guest';
  }

  supabase.auth.onAuthStateChange(async (_e, sess)=>{
    if (sess?.user) {
      const { data: prof } = await supabase.from('profiles').select('role').eq('id', sess.user.id).maybeSingle();
      state.role = (prof?.role === 'admin') ? 'admin' : 'agent';
      await renderAuthState();
      await fetchProducts();
      renderView();
    } else {
      state.role='guest';
      await renderAuthState();
      renderView();
    }
  });
}

async function renderAuthState(){
  const logged = state.role !== 'guest';
  $('btnLogin')   && $('btnLogin').classList.toggle('hidden', logged);
  $('btnLogout')  && $('btnLogout').classList.toggle('hidden', !logged);
  $('btnLoginM')  && $('btnLoginM').classList.toggle('hidden', logged);
  $('btnLogoutM') && $('btnLogoutM').classList.toggle('hidden', !logged);
  $('adminBox')   && ( $('adminBox').hidden = (state.role!=='admin') );
  $('resultInfo') && ( $('resultInfo').textContent = logged ? 'Caricamento listino…' : 'Accedi per visualizzare il listino.' );
  if (logged) toggleModal('loginModal', false);
}

async function sendMagicLink(){
  const emailEl = $('loginEmail');
  const msgEl   = $('loginMsg');
  if (!emailEl) return;
  const email = emailEl.value.trim();
  if (!email){ if (msgEl) msgEl.textContent='Inserisci la tua email.'; return; }
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: SITE_URL }
  });
  if (msgEl) msgEl.textContent = error ? ('Errore: '+error.message) : 'Email inviata. Controlla la casella e apri il link.';
}

async function signOut(){
  await supabase.auth.signOut();
  state.role='guest';
  state.items=[];
  renderView();
  await renderAuthState();
}

/* ==== Data ==== */
async function fetchProducts(){
  try{
    const { data, error } = await supabase
      .from('products')
      .select('id,codice,descrizione,categoria,sottocategoria,prezzo,unita,disponibile,novita,pack,pallet,tags,updated_at, product_media(id,kind,path,sort)')
      .order('descrizione',{ascending:true});
    if (error) throw error;

    const out=[];
    for (const p of (data||[])){
      // --- IMMAGINI ---
      let img='';
      const imgs=(p.product_media||[]).filter(m=>m.kind==='image').sort((a,b)=>(a.sort??0)-(b.sort??0));
      if (imgs[0]) {
        const path = imgs[0].path;
        if (/^https?:\/\//i.test(path)) {
          // URL assoluto esterno
          img = path;
        } else {
          // Supabase Storage signed URL
          const { data:signed } = await supabase.storage.from(STORAGE_BUCKET).createSignedUrl(path, 600);
          img = signed?.signedUrl || '';
        }
      }

      out.push({
        codice:p.codice, descrizione:p.descrizione, categoria:p.categoria, sottocategoria:p.sottocategoria,
        prezzo:p.prezzo, unita:p.unita, disponibile:p.disponibile, novita:p.novita, pack:p.pack, pallet:p.pallet,
        tags:p.tags||[], updated_at:p.updated_at, img
      });
    }
    state.items=out;
    buildCategories();
    if ($('resultInfo')) $('resultInfo').textContent = `${out.length} articoli`;
  }catch(e){
    console.error('[Listino] fetchProducts', e);
    if ($('resultInfo')) $('resultInfo').textContent='Errore caricamento listino';
  }
}

function buildCategories(){
  const set=new Set(state.items.map(p=>p.categoria||'Altro'));
  state.categories=['Tutte', ...Array.from(set).sort((a,b)=>a.localeCompare(b,'it'))];
  const box=$('categoryList'); if(!box) return;
  box.innerHTML='';
  state.categories.forEach(cat=>{
    const b=document.createElement('button');
    b.className='tag hover:bg-slate-100';
    b.textContent=cat;
    b.addEventListener('click',()=>{ state.selectedCategory=cat; renderView(); });
    box.appendChild(b);
  });
}

/* ==== Render ==== */
function renderView(){
  const grid=$('productGrid'), listino=$('listinoContainer');
  if (!grid || !listino) return;
  if (state.view==='listino'){ grid.classList.add('hidden'); listino.classList.remove('hidden'); renderListino(); }
  else { listino.classList.add('hidden'); grid.classList.remove('hidden'); renderCards(); }
  // dopo ogni render, sincronizza check in base al preventivo
  syncChecksFromQuote();
}

/* Filtri/ordinamento comuni */
function filterAndSort(arr){
  let out=[...arr];
  if (state.selectedCategory!=='Tutte') out=out.filter(p=>(p.categoria||'Altro')===state.selectedCategory);
  if (state.search){
    const q=state.search;
    out=out.filter(p=>{
      const hay=normalizeQuery((p.codice||'')+' '+(p.descrizione||'')+' '+(p.tags||[]).join(' '));
      return hay.includes(q);
    });
  }
  if (state.onlyAvailable) out=out.filter(p=>p.disponibile);
  if (state.onlyNew) out=out.filter(p=>p.novita);
  if (state.priceMax!=null) out=out.filter(p=>p.prezzo!=null && p.prezzo<=state.priceMax);
  switch(state.sort){
    case 'priceAsc':  out.sort((a,b)=>(a.prezzo??Infinity)-(b.prezzo??Infinity)); break;
    case 'priceDesc': out.sort((a,b)=>(b.prezzo??-Infinity)-(a.prezzo??-Infinity)); break;
    case 'newest':    out.sort((a,b)=>(b.updated_at||'').localeCompare(a.updated_at||'')); break;
    default:          out.sort((a,b)=>(a.descrizione||'').localeCompare(b.descrizione||'','it')); break;
  }
  return out;
}

/* VISTA LISTINO (tabellare) con checkbox */
function renderListino(){
  const c=$('listinoContainer'); if(!c) return; c.innerHTML='';
  const arr=filterAndSort(state.items);
  const by=new Map(); for(const p of arr){ const k=p.categoria||'Altro'; if(!by.has(k)) by.set(k,[]); by.get(k).push(p); }
  const cats=[...by.keys()].sort((a,b)=>a.localeCompare(b,'it'));
  if(!cats.length){ c.innerHTML='<div class="text-center text-slate-500 py-10">Nessun articolo trovato.</div>'; return; }

  for(const cat of cats){
    const items=by.get(cat).sort((a,b)=>(a.codice||'').localeCompare(b.codice||'','it'));
    const h=document.createElement('h2'); h.className='text-lg font-semibold mt-2 mb-1'; h.textContent=cat; c.appendChild(h);
    const t=document.createElement('table'); t.className='w-full text-sm border-collapse';
    t.innerHTML=`
      <thead class="bg-slate-100"><tr>
        <th class="border px-2 py-1 text-center">Sel</th>
        <th class="border px-2 py-1 text-left">Codice</th>
        <th class="border px-2 py-1 text-left">Descrizione</th>
        <th class="border px-2 py-1 text-left">Confezione</th>
        <th class="border px-2 py-1 text-right">Prezzo</th>
        <th class="border px-2 py-1 text-center">Img</th>
      </tr></thead><tbody></tbody>`;
    const tb=t.querySelector('tbody');

    for(const p of items){
      const tr=document.createElement('tr');
      tr.innerHTML=`
        <td class="border px-2 py-1 text-center">
          <input type="checkbox" data-code="${p.codice}">
        </td>
        <td class="border px-2 py-1 whitespace-nowrap font-mono">${p.codice||''}</td>
        <td class="border px-2 py-1">${p.descrizione||''} ${p.novita?'<span class="ml-2 text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-[2px]">Novità</span>':''}</td>
        <td class="border px-2 py-1">${p.pack||''}</td>
        <td class="border px-2 py-1 text-right">${fmtEUR(p.prezzo)}</td>
        <td class="border px-2 py-1 text-center">${p.img?`<button class="text-sky-600 underline" data-src="${p.img}" data-title="${encodeURIComponent(p.descrizione||'')}">📷</button>`:'—'}</td>`;
      tb.appendChild(tr);
    }
    c.appendChild(t);

    // bind selezioni
    t.querySelectorAll('input[type="checkbox"][data-code]').forEach(chk=>{
      chk.addEventListener('change', (e)=>{
        const code=e.target.getAttribute('data-code');
        const prod=state.items.find(x=>x.codice===code);
        if (!prod) return;
        if (e.target.checked){
          addToQuote(prod);
        } else {
          removeFromQuote(code);
        }
      });
    });

    // bind anteprima immagine
    t.querySelectorAll('button[data-src]').forEach(btn=>{
      btn.addEventListener('click', (e)=>{
        const src=e.currentTarget.getAttribute('data-src');
        const title=decodeURIComponent(e.currentTarget.getAttribute('data-title')||'');
        const img=$('imgPreview'), ttl=$('imgTitle');
        if(img){ img.src=src; img.alt=title; }
        if(ttl){ ttl.textContent=title; }
        toggleModal('imgModal', true);
      });
    });
  }
}

/* VISTA CARD con checkbox */
function renderCards(){
  const g=$('productGrid'); if(!g) return; g.innerHTML='';
  const arr=filterAndSort(state.items);
  if(!arr.length){ g.innerHTML='<div class="col-span-full text-center text-slate-500 py-10">Nessun articolo trovato.</div>'; return; }
  for(const p of arr){
    const card=document.createElement('article'); card.className='card rounded-2xl bg-white border shadow-sm overflow-hidden';
    card.innerHTML=`
      <div class="relative aspect-square bg-slate-100 grid place-content-center">
        <label class="absolute top-2 left-2 bg-white/90 border rounded-md px-2 py-1 text-xs flex items-center gap-1">
          <input type="checkbox" data-code="${p.codice}">
          <span>Sel</span>
        </label>
        ${p.img?`<img src="${p.img}" alt="${p.descrizione||''}" class="w-full h-full object-contain" loading="lazy" decoding="async">`:`<div class="text-slate-400">Nessuna immagine</div>`}
      </div>
      <div class="p-3 space-y-2">
        <div class="flex items-start justify-between gap-2">
          <h3 class="font-medium leading-snug line-clamp-2">${p.descrizione||''}</h3>
          ${p.novita?'<span class="tag bg-emerald-50 text-emerald-700 border-emerald-200">Novità</span>':''}
        </div>
        <p class="text-xs text-slate-500">${p.codice||''}</p>
        <div class="flex items-center justify-between">
          <div class="text-lg font-semibold">${fmtEUR(p.prezzo)}</div>
          <button class="rounded-xl border px-3 py-1.5 text-sm hover:bg-slate-50">Vedi</button>
        </div>
      </div>`;
    // immagine modal
    card.querySelector('button').addEventListener('click', ()=>{
      if(!p.img) return;
      const img=$('imgPreview'), ttl=$('imgTitle');
      if(img){ img.src=p.img; img.alt=p.descrizione||''; }
      if(ttl){ ttl.textContent=p.descrizione||''; }
      toggleModal('imgModal', true);
    });
    // selezione
    const chk = card.querySelector('input[type="checkbox"][data-code]');
    chk.addEventListener('change', (e)=>{
      if (e.target.checked) addToQuote(p); else removeFromQuote(p.codice);
    });

    g.appendChild(card);
  }
}

/* ==== Preventivo: logica ==== */
function addToQuote(prod){
  if (!prod || !prod.codice) return;
  if (!state.quote.has(prod.codice)){
    state.quote.set(prod.codice, {
      codice: prod.codice,
      descrizione: prod.descrizione || '',
      prezzo: typeof prod.prezzo === 'number' ? prod.prezzo : parseItNumber(prod.prezzo) || 0,
      qty: 1,
      sconto: 0,         // percentuale
      conai: null,       // se null → usa default
    });
  }
  renderQuoteBox();
  syncChecksFromQuote();
}
function removeFromQuote(codice){
  state.quote.delete(codice);
  renderQuoteBox();
  syncChecksFromQuote();
}
function syncChecksFromQuote(){
  // riflette lo stato dei checkbox in base a state.quote
  document.querySelectorAll('input[type="checkbox"][data-code]').forEach(chk=>{
    const code=chk.getAttribute('data-code');
    chk.checked = state.quote.has(code);
  });
}

/* Calcoli */
function prezzoScontato(p){ // p: {prezzo, sconto}
  const s = Math.min(Math.max(p.sconto||0, 0), 100);
  const net = (p.prezzo||0) * (1 - s/100);
  return Math.max(net, 0);
}
function totaleRiga(p, defaultConai){
  const conai = (p.conai==null ? (defaultConai||0) : (parseItNumber(p.conai)||0));
  const unit = prezzoScontato(p) + conai;
  return (unit) * (p.qty||0);
}

/* Render box preventivo */
function renderQuoteBox(){
  const box=$('quoteBox'), body=$('quoteBody'), total=$('quoteTotal');
  if (!box || !body || !total) return;

  $('quoteConaiDefault') && (state.quoteConaiDefault = parseItNumber($('quoteConaiDefault').value) || 0);

  const rows = [...state.quote.values()];
  if (!rows.length){
    box.classList.add('hidden');
    body.innerHTML='';
    total.textContent='—';
    return;
  }

  box.classList.remove('hidden');
  body.innerHTML='';

  let somma=0;
  for (const r of rows){
    const unitNet = prezzoScontato(r);
    const conai = (r.conai==null ? state.quoteConaiDefault : (parseItNumber(r.conai)||0));
    const riga = (unitNet + conai) * (r.qty||0);
    somma += riga;

    const tr=document.createElement('tr');
    tr.innerHTML=`
      <td class="border px-2 py-1 font-mono">${r.codice}</td>
      <td class="border px-2 py-1">${r.descrizione}</td>
      <td class="border px-2 py-1 text-right">${fmtEUR(r.prezzo)}</td>
      <td class="border px-2 py-1 text-right">
        <input type="number" step="0.01" class="w-20 rounded-md border px-2 py-1 text-right" value="${r.sconto||0}">
      </td>
      <td class="border px-2 py-1 text-right">${fmtEUR(unitNet)}</td>
      <td class="border px-2 py-1 text-right">
        <input type="number" step="1" class="w-20 rounded-md border px-2 py-1 text-right" value="${r.qty||1}">
      </td>
      <td class="border px-2 py-1 text-right">
        <input type="number" step="0.01" class="w-24 rounded-md border px-2 py-1 text-right" placeholder="${state.quoteConaiDefault}" value="${r.conai==null?'':r.conai}">
      </td>
      <td class="border px-2 py-1 text-right">${fmtEUR(riga)}</td>
      <td class="border px-2 py-1 text-center">
        <button class="rounded-md border px-2 py-1 text-sm" data-del="${r.codice}">Rimuovi</button>
      </td>
    `;
    // bind campi
    const inputs = tr.querySelectorAll('input');
    // sconto
    inputs[0].addEventListener('input', (e)=>{
      const v = parseItNumber(e.target.value) || 0;
      r.sconto = Math.max(0, Math.min(100, v));
      renderQuoteBox();
    });
    // qty
    inputs[1].addEventListener('input', (e)=>{
      const v = parseItNumber(e.target.value) || 0;
      r.qty = Math.max(0, Math.floor(v));
      renderQuoteBox();
    });
    // conai
    inputs[2].addEventListener('input', (e)=>{
      const val = e.target.value.trim();
      r.conai = (val === '') ? null : (parseItNumber(val)||0);
      renderQuoteBox();
    });
    // remove
    tr.querySelector('button[data-del]').addEventListener('click', ()=>{
      removeFromQuote(r.codice);
    });

    body.appendChild(tr);
  }

  total.textContent = fmtEUR(somma);
}

/* Export Excel */
function exportQuoteToExcel(){
  const rows = [...state.quote.values()];
  if (!rows.length) { alert('Nessun articolo selezionato.'); return; }

  const defConai = state.quoteConaiDefault || 0;

  // costruisci dati tabellari
  const data = [
    ['Codice', 'Descrizione', 'Q.tà', 'Prezzo unit.', 'Sconto %', 'Prezzo scont. unit.', 'CONAI x collo', 'Totale riga']
  ];

  let somma=0;
  for (const r of rows){
    const unitNet = prezzoScontato(r);
    const conai = (r.conai==null ? defConai : (parseItNumber(r.conai)||0));
    const tot = (unitNet + conai) * (r.qty||0);
    somma += tot;
    data.push([
      r.codice,
      r.descrizione,
      r.qty||0,
      +(r.prezzo||0),
      +(r.sconto||0),
      +unitNet,
      +conai,
      +tot
    ]);
  }
  data.push([]);
  data.push(['', '', '', '', '', 'Totale imponibile', '', +somma]);

  // crea workbook xlsx (SheetJS)
  const ws = XLSX.utils.aoa_to_sheet(data);
  // formattazione colonne (opzionale: larghezze)
  ws['!cols'] = [
    { wch: 14 }, // codice
    { wch: 50 }, // descrizione
    { wch: 8 },  // qty
    { wch: 12 }, // prezzo unit
    { wch: 10 }, // sconto
    { wch: 16 }, // prezzo scontato
    { wch: 14 }, // conai
    { wch: 14 }, // totale riga
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Preventivo');

  const fileName = `preventivo_${new Date().toISOString().slice(0,10)}.xlsx`;
  XLSX.writeFile(wb, fileName);
}
