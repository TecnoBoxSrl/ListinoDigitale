/* ===================================================
   Listino Digitale – Tecnobox (login + preventivi PRO)
   - Auth email/password (Supabase UMD)
   - Categorie compatte (ordine alfabetico)
   - Vista listino / card + ricerca live
   - Selezione articoli + Pannello Preventivo a destra
   - Nominativo + Data (editabile, default oggi)
   - Esporta: Excel (XLSX), PDF (jsPDF + AutoTable), Stampa
   - Stampa/PDF con stile coerente alla tabella UI
=================================================== */

/* === CONFIG: METTI I TUOI VALORI === */
const SUPABASE_URL = 'https://wajzudbaezbyterpjdxg.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indhanp1ZGJhZXpieXRlcnBqZHhnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcxODA4MTUsImV4cCI6MjA3Mjc1NjgxNX0.MxaAqdUrppG2lObO_L5-SgDu8D7eze7mBf6S9rR_Q2w';
const STORAGE_BUCKET = 'prodotti'; // cambia in 'media' se usi quel bucket

/* === Supabase (UMD) === */
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* === Helpers === */
const $ = (id) => document.getElementById(id);
const normalize = (s) => (s||'').toString().normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().trim();
const fmtEUR = (n) => (n==null||isNaN(n)) ? '—' : n.toLocaleString('it-IT',{style:'currency',currency:'EUR'});
const todayISO = () => new Date().toISOString().slice(0,10); // yyyy-mm-dd

/* === Stato === */
const state = {
  role: 'guest',
  items: [],
  view: 'listino',       // 'listino' | 'card'
  search: '',
  sort: 'alpha',
  onlyAvailable: false,
  onlyNew: false,
  priceMax: null,
  selected: new Map(),   // codice -> {codice, descrizione, prezzo, conai, qty, sconto}
  quoteName: '',         // nominativo preventivo
  quoteDate: todayISO(), // data preventivo
};

/* === BOOT === */
document.addEventListener('DOMContentLoaded', async () => {
  bindUI();
  injectQuotePanel(); // pannello preventivo a destra (desktop)

  // ripristina sessione
  const { data:{ session } } = await supabase.auth.getSession();
  if (session?.user) {
    await afterLogin(session.user.id);
  } else {
    showAuthGate(true);
  }

  supabase.auth.onAuthStateChange(async (_e, sess) => {
    if (sess?.user) await afterLogin(sess.user.id);
    else await afterLogout();
  });

  $('year') && ( $('year').textContent = new Date().getFullYear() );
});

/* === UI base === */
function showAuthGate(show){
  const gate = $('authGate');
  const app  = $('appShell');
  if (!gate || !app) return;
  gate.classList.toggle('hidden', !show);
  app.classList.toggle('hidden', show);
}

function bindUI(){
  // Login
  $('btnDoLogin')?.addEventListener('click', doLogin);
  const email = $('loginEmail'), pass = $('loginPassword');
  [email, pass].forEach(el => el?.addEventListener('keydown', e => { if(e.key==='Enter'){ e.preventDefault(); doLogin(); }}));
  $('btnSendReset')?.addEventListener('click', sendReset);

  // Logout
  $('btnLogout')?.addEventListener('click', doLogout);
  $('btnLogoutM')?.addEventListener('click', doLogout);

  // Vista
  $('viewListino')?.addEventListener('click', ()=>{ state.view='listino'; renderView(); });
  $('viewCard')?.addEventListener('click', ()=>{ state.view='card';    renderView(); });

  // Ricerca live
  const handleSearch = (e)=>{ state.search = normalize(e.target.value); renderView(); };
  $('searchInput')?.addEventListener('input', handleSearch);
  $('searchInputM')?.addEventListener('input', handleSearch);

  // Filtri
  $('sortSelect')?.addEventListener('change', (e)=>{ state.sort=e.target.value; renderView(); });
  $('filterDisponibile')?.addEventListener('change', (e)=>{ state.onlyAvailable=e.target.checked; renderView(); });
  $('filterNovita')?.addEventListener('change', (e)=>{ state.onlyNew=e.target.checked; renderView(); });
  $('filterPriceMax')?.addEventListener('input', (e)=>{
    const s = String(e.target.value||'').trim().replace(/\./g,'').replace(',','.');
    const v = parseFloat(s); state.priceMax = isNaN(v)?null:v; renderView();
  });

  // Modale immagine (overlay + X + ESC)
  const imgModal=$('imgModal'), imgBackdrop=$('imgBackdrop'), imgClose=$('imgClose');
  imgBackdrop?.addEventListener('click', ()=>toggleModal('imgModal', false));
  imgClose?.addEventListener('click', ()=>toggleModal('imgModal', false));
  document.addEventListener('keydown', (ev)=>{ if(ev.key==='Escape' && !imgModal?.classList.contains('hidden')) toggleModal('imgModal', false); });

  // Mobile menu
  $('btnMobileMenu')?.addEventListener('click', ()=>{ const m = $('mobileMenu'); if(m) m.hidden = !m.hidden; });
}

function toggleModal(id, show=true){
  const el = $(id);
  if (!el) return;
  el.classList.toggle('hidden', !show);
  document.body.classList.toggle('modal-open', show);
}

/* === AUTH === */
async function doLogin() {
  const email = document.getElementById('loginEmail')?.value?.trim();
  const password = document.getElementById('loginPassword')?.value || '';
  const msg = document.getElementById('loginMsg');
  if (!email || !password) { if (msg) msg.textContent = 'Inserisci email e password.'; return; }
  if (msg) msg.textContent = 'Accesso in corso…';

  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;

    // verifica che la sessione ci sia davvero
    const { data: s } = await supabase.auth.getSession();
    if (!s?.session?.user) throw new Error('Sessione non inizializzata.');

    showAuthGate(false);                 // mostra subito l’app
    await afterLogin(s.session.user.id); // ruolo + fetch prodotti
    if (msg) msg.textContent = '';
  } catch (e) {
    console.error('[Auth] login error:', e);
    if (msg) msg.textContent = 'Accesso non riuscito: ' + (e?.message || 'Errore sconosciuto');
  }
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
  try {
    // ruolo opzionale (se non c’è profiles, gestisci fallback)
    let role = 'agent';
    const { data: prof, error: profErr } =
      await supabase.from('profiles').select('role').eq('id', userId).maybeSingle();
    if (!profErr && prof?.role === 'admin') role = 'admin';
    state.role = role;

    // Mostra app e carica dati
    showAuthGate(false);
    await fetchProducts();
    renderView();

    // aggiorna contatori/testo
    const info = $('resultInfo');
    if (info && state.items) info.textContent = `${state.items.length} articoli`;
  } catch (e) {
    console.error('[afterLogin] error:', e);
    const info = $('resultInfo');
    if (info) info.textContent = 'Errore caricamento listino';
  }
}
async function afterLogout(){
  showAuthGate(true);
  state.role = 'guest';
  state.items = [];
  state.selected.clear();
  renderQuotePanel?.();
  const grid = $('productGrid'), listino = $('listinoContainer');
  if (grid) grid.innerHTML = '';
  if (listino) listino.innerHTML = '';
}

/* === DATA === */
async function fetchProducts(){
  try{
    const { data, error } = await supabase
      .from('products')
      .select(`
        id, codice, descrizione, categoria, sottocategoria,
        prezzo, unita, disponibile, novita, pack, pallet, tags, updated_at,
        product_media(id,kind,path,sort)
      `)
      .order('descrizione', { ascending: true });

    if (error) throw error;

    const items = [];
    for (const p of (data || [])) {
      // immagine principale (se presente)
      const mediaImgs = (p.product_media || [])
        .filter(m => m.kind === 'image')
        .sort((a,b) => (a.sort ?? 0) - (b.sort ?? 0));

      let imgUrl = '';
      if (mediaImgs[0]) {
        const { data: signed } = await supabase.storage
          .from(STORAGE_BUCKET)
          .createSignedUrl(mediaImgs[0].path, 600);
        imgUrl = signed?.signedUrl || '';
      }

      items.push({
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
        conaiPerCollo: 0,  // se in futuro aggiungi campo in DB, sostituisci
        img: imgUrl,
      });
    }

    state.items = items;
    buildCategories();
    const info = $('resultInfo');
    if (info) info.textContent = `${items.length} articoli`;
    renderView();
  } catch(e){
    console.error('[Listino] fetchProducts error', e);
    const info = $('resultInfo');
    if (info) info.textContent = 'Errore caricamento listino';
  }
}

/* === CATEGORIE (sinistra, compatte & alfabetiche) === */
function buildCategories(){
  const set = new Set(state.items.map(p => (p.categoria || 'Altro').trim()));
  const cats = Array.from(set).sort((a,b)=>a.localeCompare(b,'it'));
  const box = $('categoryList'); if (!box) return;
  box.innerHTML = '';

  // chip “Tutte”
  const all = document.createElement('button');
  all.className = 'tag hover:bg-slate-100';
  all.textContent = 'Tutte';
  all.addEventListener('click', ()=>{ state.selectedCategory='Tutte'; renderView(); });
  box.appendChild(all);

  // chips per categoria
  for (const c of cats){
    const b = document.createElement('button');
    b.className='tag hover:bg-slate-100';
    b.textContent=c;
    b.title=c;
    b.addEventListener('click', ()=>{ state.selectedCategory=c; renderView(); });
    box.appendChild(b);
  }
  // default
  if (!state.selectedCategory) state.selectedCategory='Tutte';
}

/* === Filtri comuni === */
function applyFilters(arr){
  let out=[...arr];
  // categoria
  if (state.selectedCategory && state.selectedCategory!=='Tutte'){
    out = out.filter(p => (p.categoria || 'Altro') === state.selectedCategory);
  }
  // ricerca
  if (state.search){
    const q=state.search;
    out = out.filter(p => normalize((p.codice||'')+' '+(p.descrizione||'')+' '+(p.tags||[]).join(' ')).includes(q));
  }
  // filtri
  if (state.onlyAvailable) out = out.filter(p=>p.disponibile);
  if (state.onlyNew) out = out.filter(p=>p.novita);
  if (state.priceMax!=null) out = out.filter(p=> p.prezzo!=null && p.prezzo<=state.priceMax);
  // sort
  switch(state.sort){
    case 'priceAsc': out.sort((a,b)=>(a.prezzo??Infinity)-(b.prezzo??Infinity)); break;
    case 'priceDesc': out.sort((a,b)=>(b.prezzo??-Infinity)-(a.prezzo??-Infinity)); break;
    case 'newest': out.sort((a,b)=>(b.updated_at||'').localeCompare(a.updated_at||'')); break;
    default: out.sort((a,b)=>(a.descrizione||'').localeCompare(b.descrizione||'','it')); break;
  }
  return out;
}

/* === RENDER SWITCH === */
function renderView(){
  const grid=$('productGrid'), listino=$('listinoContainer');
  if (!grid || !listino) return;

  if (state.view==='listino'){
    grid.classList.add('hidden');
    listino.classList.remove('hidden');
    renderListino();
  } else {
    listino.classList.add('hidden');
    grid.classList.remove('hidden');
    renderCards();
  }
}

/* === LISTINO tabellare con checkbox === */
function renderListino(){
  const container = $('listinoContainer'); if(!container) return;
  container.innerHTML='';

  // group by categoria
  const byCat = new Map();
  for (const p of applyFilters(state.items)){
    const c = p.categoria || 'Altro';
    if (!byCat.has(c)) byCat.set(c, []);
    byCat.get(c).push(p);
  }
  const cats = [...byCat.keys()].sort((a,b)=>a.localeCompare(b,'it'));
  if (!cats.length){ container.innerHTML='<div class="text-slate-500 py-10 text-center">Nessun articolo.</div>'; return; }

  for (const cat of cats){
    const items = byCat.get(cat).sort((a,b)=>(a.codice||'').localeCompare(b.codice||'','it'));
    const h = document.createElement('h2'); h.className='text-lg font-semibold mt-2 mb-1'; h.textContent=cat;
    container.appendChild(h);

    const table = document.createElement('table');
    table.className='w-full text-sm border-collapse';
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
      const tr = document.createElement('tr');
      const checked = state.selected.has(p.codice) ? 'checked' : '';
      tr.innerHTML = `
        <td class="border px-2 py-1 text-center">
          <input type="checkbox" class="selItem" data-code="${p.codice}" ${checked}>
        </td>
        <td class="border px-2 py-1 whitespace-nowrap font-mono">${p.codice||''}</td>
        <td class="border px-2 py-1">
          ${p.descrizione||''} ${p.novita?'<span class="ml-2 text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-[2px]">Novità</span>':''}
        </td>
        <td class="border px-2 py-1">${p.pack||''}</td>
        <td class="border px-2 py-1 text-right">${fmtEUR(p.prezzo)}</td>
        <td class="border px-2 py-1 text-center">${p.img?`<button class="text-sky-600 underline btnImg" data-src="${p.img}" data-title="${encodeURIComponent(p.descrizione||'')}">📷</button>`:'—'}</td>`;
      tb.appendChild(tr);
    }
    container.appendChild(table);
  }

  // bind checkbox e immagini
  container.querySelectorAll('.selItem').forEach(chk=>{
    chk.addEventListener('change', (e)=>{
      const code = e.currentTarget.getAttribute('data-code');
      const prod = state.items.find(x=>x.codice===code);
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

/* === CARD view con checkbox === */
function renderCards(){
  const grid=$('productGrid'); if(!grid) return;
  grid.innerHTML='';

  const arr = applyFilters(state.items);
  if (!arr.length){ grid.innerHTML='<div class="col-span-full text-center text-slate-500 py-10">Nessun articolo.</div>'; return; }

  for (const p of arr){
    const checked = state.selected.has(p.codice) ? 'checked' : '';
    const card = document.createElement('article');
    card.className='relative card rounded-2xl bg-white border shadow-sm overflow-hidden';
    card.innerHTML=`
      <label class="absolute top-2 left-2 bg-white/80 backdrop-blur rounded-md px-2 py-1 flex items-center gap-1 text-xs">
        <input type="checkbox" class="selItem" data-code="${p.codice}" ${checked}> Seleziona
      </label>
      <div class="aspect-square bg-slate-100 grid place-content-center">
        ${p.img ? `<img src="${p.img}" alt="${p.descrizione||''}" class="w-full h-full object-contain" loading="lazy" decoding="async">`
                 : `<div class="text-slate-400">Nessuna immagine</div>`}
      </div>
      <div class="p-3 space-y-2">
        <div class="flex items-start justify-between gap-2">
          <h3 class="font-medium leading-snug line-clamp-2">${p.descrizione||''}</h3>
          ${p.novita ? '<span class="tag bg-emerald-50 text-emerald-700 border-emerald-200">Novità</span>' : ''}
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
      const code = e.currentTarget.getAttribute('data-code');
      const prod = state.items.find(x=>x.codice===code);
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

/* ==================================================
   PANNELLO PREVENTIVO (fisso a destra)
   - occupa tutta la colonna destra (desktop)
   - nominativo + data
   - esporta: excel / pdf / stampa
================================================== */
/* ============================
   PREVENTIVI – BLOCCO COMPLETO
   (sostituisci il tuo con questo)
============================ */

const fmtEUR = (n) => (n==null||isNaN(n)) ? '—' :
  Number(n).toLocaleString('it-IT',{style:'currency',currency:'EUR'});

/* Stato selezione righe preventivo
   (deve esistere in cima al tuo script):
   state.selected: Map<codice, {codice,descrizione,prezzo,conai,qty,sconto}>
*/
if (!state) window.state = { selected:new Map() };

/* ===== PANNELLO A DESTRA ===== */
function injectQuotePanel(){
  const old = document.getElementById('quotePanel');
  if (old) old.remove();

  const panel = document.createElement('aside');
  panel.id='quotePanel';
  panel.className='lg:col-span-3 glass rounded-2xl p-4 border';

  panel.innerHTML = `
    <div class="flex items-center justify-between mb-2">
      <h2 class="font-semibold">Preventivo</h2>
      <button id="btnClearQuote" class="text-xs underline">Svuota</button>
    </div>

    <!-- Metadati preventivo -->
    <div class="grid grid-cols-2 gap-2 mb-3">
      <div>
        <label class="block text-xs text-slate-500 mb-1">Nominativo</label>
        <input id="quoteName" type="text" class="w-full rounded-xl border px-2 py-1 text-sm" placeholder="Cliente / Azienda">
      </div>
      <div>
        <label class="block text-xs text-slate-500 mb-1">Data</label>
        <input id="quoteDate" type="date" class="w-full rounded-xl border px-2 py-1 text-sm">
      </div>
    </div>

    <div class="text-xs text-slate-500 mb-2">
      <span id="quoteItemsCount">0</span> articoli selezionati
    </div>

    <div class="overflow-x-auto">
      <table id="quoteTable" class="w-full text-sm border-collapse">
        <thead class="bg-slate-100">
          <tr>
            <th class="border px-2 py-1 text-left">Codice</th>
            <th class="border px-2 py-1 text-left">Descrizione</th>
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
        <tfoot>
          <tr>
            <td colspan="7" class="border px-2 py-1 text-right font-medium">Totale imponibile</td>
            <td id="quoteTotal" class="border px-2 py-1 text-right font-semibold">€ 0,00</td>
            <td class="border px-2 py-1"></td>
          </tr>
        </tfoot>
      </table>
    </div>

    <div class="mt-3 grid grid-cols-3 gap-2">
      <button id="btnExportHtml" class="rounded-xl bg-sky-600 text-white py-2 text-sm">Esporta HTML</button>
      <button id="btnExportPdf"  class="rounded-xl bg-sky-600 text-white py-2 text-sm">Esporta PDF</button>
      <button id="btnPrint"      class="rounded-xl border py-2 text-sm">Stampa</button>
    </div>

    <p id="quoteMsg" class="text-[11px] text-slate-500 mt-2"></p>
  `;

  // inseriscilo nella colonna destra (se usi il layout con 3 colonne)
  const rightCol = document.querySelector('aside.lg\\:col-span-3:last-of-type');
  if (rightCol) rightCol.replaceWith(panel);
  else document.body.appendChild(panel); // fallback

  // default data = oggi
  const d = document.getElementById('quoteDate');
  if (d) d.value = new Date().toISOString().slice(0,10);

  // bind pulsanti
  document.getElementById('btnClearQuote')?.addEventListener('click', ()=>{
    state.selected.clear();
    renderQuotePanel();
    document.querySelectorAll('.selItem').forEach(i=>{ i.checked=false; });
  });
  document.getElementById('btnExportHtml')?.addEventListener('click', exportHTML);
  document.getElementById('btnExportPdf') ?.addEventListener('click', exportPDF);
  document.getElementById('btnPrint')     ?.addEventListener('click', printQuote);

  // prima render
  renderQuotePanel();
}

/* ===== CRUD righe preventivo ===== */
function addToQuote(p){
  const item = state.selected.get(p.codice) || {
    codice: p.codice,
    descrizione: p.descrizione,
    prezzo: Number(p.prezzo||0),
    conai: Number(p.conaiPerCollo||0),
    qty: 1,
    sconto: 0,
  };
  if (state.selected.has(p.codice)) item.qty += 1;
  state.selected.set(p.codice, item);
  renderQuotePanel();
}
function removeFromQuote(code){
  state.selected.delete(code);
  renderQuotePanel();
}

/* ===== Calcoli riga / totale ===== */
function lineCalc(it){
  const s = Math.max(0, Math.min(100, Number(it.sconto||0)));
  const prezzoScont = Number(it.prezzo||0) * (1 - s/100);
  const qty = Math.max(1, Number(it.qty||1));
  const conai = Number(it.conai||0);
  const totale = prezzoScont*qty + conai*qty;
  return { prezzoScont, totale };
}

/* ===== Render tabella preventivo ===== */
function renderQuotePanel(){
  const body = document.getElementById('quoteBody');
  const tot  = document.getElementById('quoteTotal');
  const count= document.getElementById('quoteItemsCount');
  if (!body || !tot || !count) return;

  body.innerHTML='';
  let total=0, rows=0;

  for (const it of state.selected.values()){
    rows++;
    const { prezzoScont, totale } = lineCalc(it);
    total += totale;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="border px-2 py-1 font-mono">${it.codice}</td>
      <td class="border px-2 py-1">${it.descrizione||''}</td>
      <td class="border px-2 py-1 text-right">${fmtEUR(it.prezzo)}</td>
      <td class="border px-2 py-1 text-right">${fmtEUR(it.conai||0)}</td>
      <td class="border px-2 py-1 text-center">
        <input type="number" class="w-16 border rounded px-1 py-0.5 text-right inputQty" data-code="${it.codice}" value="${Number(it.qty)||1}" step="1" min="1">
      </td>
      <td class="border px-2 py-1 text-center">
        <input type="number" class="w-16 border rounded px-1 py-0.5 text-right inputSconto" data-code="${it.codice}" value="${Number(it.sconto)||0}" step="1" min="0" max="100">
      </td>
      <td class="border px-2 py-1 text-right">${fmtEUR(prezzoScont)}</td>
      <td class="border px-2 py-1 text-right">${fmtEUR(totale)}</td>
      <td class="border px-2 py-1 text-center">
        <button class="text-rose-600 underline btnRemove" data-code="${it.codice}">Rimuovi</button>
      </td>`;
    body.appendChild(tr);
  }

  count.textContent = rows;
  tot.textContent = fmtEUR(total);

  // bind interazioni
  body.querySelectorAll('.inputQty').forEach(inp=>{
    inp.addEventListener('input', (e)=>{
      const code = e.currentTarget.getAttribute('data-code');
      const it = state.selected.get(code); if(!it) return;
      const v = Math.max(1, parseInt(e.target.value||'1',10));
      it.qty = v; state.selected.set(code, it);
      renderQuotePanel();
    });
  });
  body.querySelectorAll('.inputSconto').forEach(inp=>{
    inp.addEventListener('input', (e)=>{
      const code = e.currentTarget.getAttribute('data-code');
      const it = state.selected.get(code); if(!it) return;
      let v = parseInt(e.target.value||'0',10);
      if (isNaN(v)) v=0; v=Math.max(0,Math.min(100,v));
      it.sconto = v; state.selected.set(code, it);
      renderQuotePanel();
    });
  });
  body.querySelectorAll('.btnRemove').forEach(btn=>{
    btn.addEventListener('click', (e)=>{
      const code = e.currentTarget.getAttribute('data-code');
      state.selected.delete(code);
      document.querySelectorAll(`.selItem[data-code="${CSS.escape(code)}"]`).forEach(i=>{ i.checked=false; });
      renderQuotePanel();
    });
  });
}

/* ====== EXPORT: HTML / PDF / PRINT ====== */
function currentQuoteMeta(){
  const name = (document.getElementById('quoteName')?.value || '').trim();
  const date = (document.getElementById('quoteDate')?.value || new Date().toISOString().slice(0,10));
  return { name, date };
}

function buildRowsForExport(){
  const rows = [];
  let total=0;
  for (const it of state.selected.values()){
    const { prezzoScont, totale } = lineCalc(it);
    total += totale;
    rows.push({
      codice: it.codice,
      descrizione: it.descrizione||'',
      prezzo: it.prezzo||0,
      conai: it.conai||0,
      qty: it.qty||1,
      sconto: it.sconto||0,
      prezzoScont,
      totale
    });
  }
  return { rows, total };
}

/* --- HTML (scarica .html con stessa grafica tabella) --- */
function exportHTML(){
  const { name, date } = currentQuoteMeta();
  const { rows, total } = buildRowsForExport();

  const style = `
    <style>
      body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Inter,Arial,sans-serif;color:#0f172a;margin:24px}
      h1{font-size:20px;margin:0 0 6px}
      .meta{font-size:12px;color:#64748b;margin-bottom:12px}
      table{width:100%;border-collapse:collapse;font-size:13px}
      th,td{border:1px solid #e2e8f0;padding:6px 8px}
      thead th{background:#f1f5f9;text-align:left}
      tfoot td{font-weight:600}
      .right{text-align:right}
      .center{text-align:center}
    </style>`;

  const head = `
    <thead>
      <tr>
        <th>Codice</th>
        <th>Descrizione</th>
        <th class="right">Prezzo</th>
        <th class="right">CONAI/collo</th>
        <th class="center">Q.tà</th>
        <th class="center">Sconto %</th>
        <th class="right">Prezzo scont.</th>
        <th class="right">Totale riga</th>
      </tr>
    </thead>`;

  const body = rows.map(r=>`
    <tr>
      <td>${escapeHtml(r.codice)}</td>
      <td>${escapeHtml(r.descrizione)}</td>
      <td class="right">${fmtEUR(r.prezzo)}</td>
      <td class="right">${fmtEUR(r.conai)}</td>
      <td class="center">${r.qty}</td>
      <td class="center">${r.sconto}</td>
      <td class="right">${fmtEUR(r.prezzoScont)}</td>
      <td class="right">${fmtEUR(r.totale)}</td>
    </tr>`).join('');

  const html = `
    <!doctype html><html><head><meta charset="utf-8"><title>Preventivo</title>${style}</head>
    <body>
      <h1>Preventivo</h1>
      <div class="meta">
        ${name ? `Nominativo: <strong>${escapeHtml(name)}</strong> – `:''}
        Data: <strong>${escapeHtml(date)}</strong>
      </div>
      <table>
        ${head}
        <tbody>${body}</tbody>
        <tfoot>
          <tr>
            <td colspan="7" class="right">Totale imponibile</td>
            <td class="right">${fmtEUR(total)}</td>
          </tr>
        </tfoot>
      </table>
    </body></html>`;

  const blob = new Blob([html], {type:'text/html;charset=utf-8'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `preventivo_${date}.html`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* --- PDF (usa jsPDF + autoTable) --- */
function exportPDF(){
  const { jsPDF } = window.jspdf || {};
  if (!jsPDF || !window.jspdf || !window.jspdf.jsPDF){
    alert('PDF non disponibile (jsPDF non caricato).');
    return;
  }

  const { name, date } = currentQuoteMeta();
  const { rows, total } = buildRowsForExport();

  const doc = new jsPDF({ unit:'pt', format:'a4' });
  const margin = 36;

  doc.setFontSize(14);
  doc.text('Preventivo', margin, 40);
  doc.setFontSize(10);
  let meta = `Data: ${date}`;
  if (name) meta = `Nominativo: ${name}  —  ` + meta;
  doc.text(meta, margin, 58);

  const head = [[
    'Codice','Descrizione','Prezzo','CONAI/collo','Q.tà','Sconto %','Prezzo scont.','Totale riga'
  ]];
  const body = rows.map(r=>[
    r.codice,
    r.descrizione,
    fmtEUR(r.prezzo),
    fmtEUR(r.conai),
    String(r.qty),
    String(r.sconto),
    fmtEUR(r.prezzoScont),
    fmtEUR(r.totale),
  ]);

  doc.autoTable({
    startY: 74,
    head, body,
    styles: { fontSize: 9, cellPadding: 4, lineColor: [226,232,240], lineWidth: 0.8 },
    headStyles: { fillColor: [241,245,249], textColor: 0, halign:'left' },
    columnStyles: {
      2:{halign:'right'}, 3:{halign:'right'},
      4:{halign:'center'}, 5:{halign:'center'},
      6:{halign:'right'}, 7:{halign:'right'}
    },
    margin: { left: margin, right: margin }
  });

  // totale
  const endY = doc.lastAutoTable.finalY || 74;
  doc.setFontSize(10);
  doc.text('Totale imponibile', 400, endY+24, { align:'right' });
  doc.setFont(undefined, 'bold');
  doc.text(fmtEUR(total), 540, endY+24, { align:'right' });
  doc.setFont(undefined, 'normal');

  doc.save(`preventivo_${date}.pdf`);
}

/* --- Stampa (apre finestra con l’HTML e chiama print) --- */
function printQuote(){
  const { name, date } = currentQuoteMeta();
  const { rows, total } = buildRowsForExport();

  const style = `
    <style>
      body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Inter,Arial,sans-serif;color:#0f172a;margin:24px}
      h1{font-size:20px;margin:0 0 6px}
      .meta{font-size:12px;color:#64748b;margin-bottom:12px}
      table{width:100%;border-collapse:collapse;font-size:13px}
      th,td{border:1px solid #e2e8f0;padding:6px 8px}
      thead th{background:#f1f5f9;text-align:left}
      tfoot td{font-weight:600}
      .right{text-align:right}
      .center{text-align:center}
      @media print { @page { size: A4; margin: 12mm } }
    </style>`;

  const head = `
    <thead>
      <tr>
        <th>Codice</th>
        <th>Descrizione</th>
        <th class="right">Prezzo</th>
        <th class="right">CONAI/collo</th>
        <th class="center">Q.tà</th>
        <th class="center">Sconto %</th>
        <th class="right">Prezzo scont.</th>
        <th class="right">Totale riga</th>
      </tr>
    </thead>`;

  const body = state.selected.size
    ? [...state.selected.values()].map(it=>{
        const { prezzoScont, totale } = lineCalc(it);
        return `
          <tr>
            <td>${escapeHtml(it.codice)}</td>
            <td>${escapeHtml(it.descrizione||'')}</td>
            <td class="right">${fmtEUR(it.prezzo)}</td>
            <td class="right">${fmtEUR(it.conai||0)}</td>
            <td class="center">${Number(it.qty||1)}</td>
            <td class="center">${Number(it.sconto||0)}</td>
            <td class="right">${fmtEUR(prezzoScont)}</td>
            <td class="right">${fmtEUR(totale)}</td>
          </tr>`;
      }).join('')
    : `<tr><td colspan="8" class="center" style="color:#64748b">Nessuna riga</td></tr>`;

  const html = `
    <!doctype html><html><head><meta charset="utf-8"><title>Stampa preventivo</title>${style}</head>
    <body>
      <h1>Preventivo</h1>
      <div class="meta">
        ${name ? `Nominativo: <strong>${escapeHtml(name)}</strong> – `:''}
        Data: <strong>${escapeHtml(date)}</strong>
      </div>
      <table>
        ${head}
        <tbody>${body}</tbody>
        <tfoot>
          <tr>
            <td colspan="7" class="right">Totale imponibile</td>
            <td class="right">${fmtEUR(total)}</td>
          </tr>
        </tfoot>
      </table>
      <script>window.onload = () => { window.print(); }</script>
    </body></html>`;

  const w = window.open('', '_blank');
  w.document.open();
  w.document.write(html);
  w.document.close();
}

/* Utility piccola per sanificare HTML */
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
}
