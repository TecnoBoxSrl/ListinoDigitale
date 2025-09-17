// ===============================
// Listino Digitale – Tecnobox (robusto a schema variabile)
// ===============================

/* === CONFIG === */
const SUPABASE_URL = 'https://wajzudbaezbyterpjdxg.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indhanp1ZGJhZXpieXRlcnBqZHhnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcxODA4MTUsImV4cCI6MjA3Mjc1NjgxNX0.MxaAqdUrppG2lObO_L5-SgDu8D7eze7mBf6S9rR_Q2w';
const STORAGE_BUCKET = 'prodotti';

/* === Supabase client (auto-caricamento SDK se manca) === */
let supabase;
(async function ensureSupabase(){
  if (!window.supabase) {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.6/dist/umd/supabase.js";
      s.crossOrigin = "anonymous";
      s.onload = resolve; s.onerror = () => reject(new Error('SDK Supabase non caricato'));
      document.head.appendChild(s);
    });
  }
  supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  console.log('[Boot] Supabase client OK');
})();

/* === Helpers === */
const $ = (id) => document.getElementById(id);
const normalize = (s) => (s||'').toString().normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().trim();
const fmtEUR = (n) => (n==null||isNaN(n)) ? '—' : n.toLocaleString('it-IT',{style:'currency',currency:'EUR'});

/* === Overlay errori === */
function showFatalError(message){
  let box = $('fatalErrorBox');
  if(!box){
    box = document.createElement('div');
    box.id = 'fatalErrorBox';
    box.style.cssText = `
      position:fixed; z-index:99999; right:12px; bottom:12px;
      max-width:90vw; padding:12px;
      background:#fff; color:#b91c1c; border:1px solid #ef4444;
      border-radius:12px; box-shadow:0 6px 24px rgba(0,0,0,.12);
      font: 14px/1.35 system-ui, sans-serif;
      white-space:pre-wrap; word-break:break-word;
    `;
    document.body.appendChild(box);
  }
  box.textContent = 'Errore: ' + message;
}
window.addEventListener('error', (e)=> showFatalError(e.message || String(e)));
window.addEventListener('unhandledrejection', (e)=> showFatalError(e.reason?.message || String(e.reason)));

/* === Responsive quote panel === */
function resizeQuotePanel() {
  const panel = $('quotePanel');
  const table = $('quoteTable');
  if (!panel || !table) return;

  if (window.innerWidth < 1024) {
    panel.style.width = '100%';
    return;
  }
  const needed = (table.scrollWidth || 0) + 32;
  const max = Math.max(320, window.innerWidth - 24);
  panel.style.width = Math.min(needed, max) + 'px';
}
window.addEventListener('resize', resizeQuotePanel);

/* === Stato === */
const state = {
  role: 'guest',
  items: [],
  view: 'listino',
  search: '',
  sort: 'alpha',            // alpha | priceAsc | priceDesc | newest
  onlyAvailable: false,
  onlyNew: false,
  priceMax: null,
  selected: new Map(),
  quoteMeta: {
    name: '',
    date: new Date().toISOString().slice(0, 10),
  },
  selectedCategory: 'Tutte',
};

/* ============ BOOT ============ */
async function boot(){
  try {
    bindUI();

    const { data:{ session } } = await supabase.auth.getSession();
    if (session?.user) {
      await afterLogin(session.user.id);
    } else {
      showAuthGate(true);
    }

    supabase.auth.onAuthStateChange(async (_event, sess)=>{
      if (sess?.user) await afterLogin(sess.user.id);
      else await afterLogout();
    });

    resizeQuotePanel();
  } catch (e) {
    console.error('[Boot] eccezione:', e);
    showAuthGate(true);
  }
}
document.addEventListener('DOMContentLoaded', boot);

/* ============ UI BASE ============ */
function showAuthGate(show){
  $('authGate')?.classList.toggle('hidden', !show);
  $('appShell')?.classList.toggle('hidden', show);
}

function bindUI(){
  $('btnDoLogin')?.addEventListener('click', doLogin);
  $('btnLogout')?.addEventListener('click', doLogout);
  $('btnLogoutM')?.addEventListener('click', doLogout);

  $('searchInput')?.addEventListener('input', (e)=>{ state.search = normalize(e.target.value); renderView(); });
  $('sortSelect')?.addEventListener('change', (e)=>{ state.sort=e.target.value; renderView(); });
}

/* ============ AUTH ============ */
async function doLogin(){
  const email = $('loginEmail')?.value?.trim();
  const password = $('loginPassword')?.value || '';
  const msg = $('loginMsg');
  if (!email || !password){ msg.textContent = 'Inserisci email e password.'; return; }
  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) { msg.textContent = 'Errore login: ' + error.message; return; }
    await afterLogin(data.user.id);
  } catch (e) {
    msg.textContent = 'Errore login.';
  }
}

async function doLogout(){
  await supabase.auth.signOut();
  await afterLogout();
}

async function afterLogin(userId){
  showAuthGate(false);
  await fetchProducts();
  renderView();
  resizeQuotePanel();
}
async function afterLogout(){
  showAuthGate(true);
  state.items = [];
  state.selected.clear();
  renderQuotePanel();
}

/* ============ DATA (robusta a nomi colonna diversi) ============ */
async function fetchProducts(){
  const info = $('resultInfo');
  try{
    // Prendiamo tutto e poi mappiamo ai campi che ci servono con fallback.
    const { data, error } = await supabase.from('products').select('*').order('descrizione', { ascending: true });
    if (error) throw error;

    const rows = Array.isArray(data) ? data : [];

    state.items = rows.map(r => ({
      codice:       r.codice || r.code || r.Codice || '',
      descrizione:  r.descrizione || r.description || r.Descrizione || '',
      dimensione:   r.dimensione || r.size || r.Dimensione || '',         // <-- niente errore se manca
      categoria:    r.categoria || r.category || r.Categoria || 'Altro',
      sottocategoria: r.sottocategoria || r.subcategory || '',
      prezzo:       numberOrNull(r.prezzo ?? r.price),
      conai:        numberOrNull(r.conai ?? r.CONAI),
      unita:        r.unita || r.unit || r['unità'] || '',
      disponibile:  boolish(r.disponibile ?? r.available),
      novita:       boolish(r.novita ?? r.new),
      updated_at:   r.updated_at || r.updatedAt || '',
      img:          r.img || r.image || r.image_url || '',                // opzionale
      tags:         Array.isArray(r.tags) ? r.tags : [],
    }));

    buildCategories();
    info && (info.textContent = `${state.items.length} articoli`);
  } catch(e){
    info && (info.textContent = 'Errore caricamento listino');
    showFatalError('fetchProducts: ' + (e.message || String(e)));
  }
}

function numberOrNull(v){
  const n = Number(v);
  return isNaN(n) ? null : n;
}
function boolish(v){
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return v === 'true' || v === '1' || v === 'si' || v === 'sì';
  if (typeof v === 'number') return v === 1;
  return false;
}

/* ============ CATEGORIE ============ */
function buildCategories(){
  const box = $('categoryList');
  if (!box) return;
  const set = new Set((state.items || []).map(p => (p.categoria || 'Altro')));
  const cats = Array.from(set).sort((a,b)=> a.localeCompare(b,'it'));

  box.innerHTML = '';

  // Bottone "TUTTE"
  const allBtn = document.createElement('button');
  allBtn.textContent = 'TUTTE';
  allBtn.className = chipClass(state.selectedCategory === 'Tutte');
  allBtn.onclick = ()=>{ state.selectedCategory='Tutte'; renderView(); buildCategories(); };
  box.appendChild(allBtn);

  // Altre categorie
  cats.forEach(cat=>{
    const btn=document.createElement('button');
    btn.textContent=cat;
    btn.className = chipClass(state.selectedCategory === cat);
    btn.onclick=()=>{ state.selectedCategory=cat; renderView(); buildCategories(); };
    box.appendChild(btn);
  });
}
function chipClass(active){
  return [
    'inline-flex items-center justify-center',
    'rounded-xl border px-3 py-1.5 text-sm',
    active ? 'bg-slate-200 border-slate-300 text-slate-900' : 'bg-white hover:bg-slate-50'
  ].join(' ');
}

/* ============ RENDER ============ */
function renderView(){
  const arr = applyFilters(state.items);
  const grid=$('productGrid');
  grid.innerHTML = '';

  if (!arr.length){
    grid.innerHTML = '<div class="col-span-full text-center text-slate-500 py-10">Nessun articolo.</div>';
    renderQuotePanel();
    return;
  }

  arr.forEach(p=>{
    const card=document.createElement('article');
    card.className='border rounded-xl p-3 bg-white shadow-sm flex flex-col gap-2';
    card.innerHTML = `
      <div class="aspect-square bg-slate-100 rounded-lg overflow-hidden grid place-content-center">
        ${p.img ? `<img src="${p.img}" alt="${escapeHtml(p.descrizione)}" class="w-full h-full object-contain" loading="lazy">`
                 : `<span class="text-slate-400 text-sm">Nessuna immagine</span>`}
      </div>
      <div class="text-xs text-slate-500">${escapeHtml(p.codice)}</div>
      <div class="font-medium">${escapeHtml(p.descrizione)}</div>
      <div class="text-sm text-slate-600">${escapeHtml(p.dimensione || '')} <span class="ml-1">${escapeHtml(p.unita || '')}</span></div>
      <div class="text-sm"><span class="font-semibold">${fmtEUR(p.prezzo)}</span> <span class="text-gray-500">(Conai ${fmtEUR(p.conai)})</span></div>
      <div class="mt-auto">
        <button class="addBtn px-3 py-1.5 border rounded-lg w-full">Aggiungi</button>
      </div>
    `;
    card.querySelector('.addBtn')?.addEventListener('click', ()=> addToQuote(p));
    grid.appendChild(card);
  });

  renderQuotePanel();
}

function applyFilters(arr){
  let out=[...arr];

  if (state.selectedCategory && state.selectedCategory !== 'Tutte'){
    out = out.filter(p=> (p.categoria || 'Altro') === state.selectedCategory);
  }
  if (state.search){
    const q=state.search;
    out = out.filter(p => normalize((p.codice||'')+' '+(p.descrizione||'')+' '+(Array.isArray(p.tags)?p.tags.join(' '):'')).includes(q));
  }
  if (state.onlyAvailable) out = out.filter(p=>p.disponibile);
  if (state.onlyNew) out = out.filter(p=>p.novita);
  if (state.priceMax!=null) out = out.filter(p=> (p.prezzo!=null) && p.prezzo<=state.priceMax);

  switch(state.sort){
    case 'priceAsc':  out.sort((a,b)=>(a.prezzo??Infinity)-(b.prezzo??Infinity)); break;
    case 'priceDesc': out.sort((a,b)=>(b.prezzo??-Infinity)-(a.prezzo??-Infinity)); break;
    case 'newest':    out.sort((a,b)=>(b.updated_at||'').localeCompare(a.updated_at||'')); break;
    default:          out.sort((a,b)=>(a.descrizione||'').localeCompare(b.descrizione||'','it')); break;
  }
  return out;
}

/* ============ PREVENTIVO ============ */
function addToQuote(p){
  const item = state.selected.get(p.codice) || {
    codice: p.codice,
    descrizione: p.descrizione,
    prezzo: p.prezzo || 0,
    conai: p.conai || 0,
    qty: 1,
    sconto: 0
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
  const sconto = Math.min(100, Math.max(0, Number(it.sconto || 0)));
  const prezzoScont = Number(it.prezzo || 0) * (1 - sconto / 100);
  const totale = prezzoScont * Number(it.qty || 0) + (Number(it.conai || 0) * Number(it.qty || 0));
  return { prezzoScont, totale };
}
function renderQuotePanel(){
  const body = $('quoteBody'), tot = $('quoteTotal'), cnt = $('quoteItemsCount');
  if (!body || !tot) return;
  body.innerHTML = '';

  let total = 0;

  for (const it of state.selected.values()){
    const { prezzoScont, totale } = lineCalc(it);
    total += totale;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="border px-2 py-1 font-mono">${escapeHtml(it.codice)}</td>
      <td class="border px-2 py-1"><div class="quote-desc">${escapeHtml(it.descrizione)}</div></td>
      <td class="border px-2 py-1 text-right">${fmtEUR(it.prezzo)}</td>
    `;
    body.appendChild(tr);
  }

  tot.textContent = fmtEUR(total);
  if (cnt) cnt.textContent = state.selected.size;
}

/* ============ Export / stampa (opzionali) ============ */
function validateQuoteMeta() {
  const msg = document.getElementById('quoteMsg');
  const nameEl = document.getElementById('quoteName');
  const dateEl = document.getElementById('quoteDate');

  if (!state.quoteMeta.name) {
    if (msg) msg.textContent = 'Inserisci il nominativo prima di procedere.';
    nameEl?.focus();
    return false;
  }
  if (!state.quoteMeta.date) {
    if (msg) msg.textContent = 'Inserisci la data del preventivo.';
    dateEl?.focus();
    return false;
  }
  if (state.selected.size === 0) {
    if (msg) msg.textContent = 'Seleziona almeno un articolo.';
    return false;
  }
  if (msg) msg.textContent = '';
  return true;
}

function escapeHtml(s){
  return String(s||'')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#039;');
}
