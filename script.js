// ===============================
// Listino Digitale – Tecnobox (vLG-8+PDF/Print) — FIXED
// - Bugfix: rimosse tag HTML che rompevano il JS
// - Responsive: quote panel 100% su mobile
// - Overlay errori: se c’è un errore, lo vedi a schermo
// ===============================

/* === CONFIG (METTI I TUOI VALORI) === */
const SUPABASE_URL = 'https://wajzudbaezbyterpjdxg.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indhanp1ZGJhZXpieXRlcnBqZHhnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcxODA4MTUsImV4cCI6MjA3Mjc1NjgxNX0.MxaAqdUrppG2lObO_L5-SgDu8D7eze7mBf6S9rR_Q2w';
const STORAGE_BUCKET = 'prodotti';

/* === Supabase client === */
let supabase;
try {
  supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  console.log('[Boot] Supabase client OK');
} catch (e) {
  console.error('[Boot] Errore init Supabase:', e);
}

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
    panel.style.width = '100%';  // mobile full width
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
  sort: 'alpha',
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

/* ============ DATA ============ */
async function fetchProducts(){
  try{
    const { data, error } = await supabase
      .from('products')
      .select('codice, descrizione, dimensione, categoria, prezzo, conai, unita, disponibile, novita, updated_at');
    if (error) throw error;

    state.items = data || [];
    buildCategories();
  } catch(e){
    showFatalError('fetchProducts: ' + e.message);
  }
}

/* ============ CATEGORIE ============ */
function buildCategories(){
  const box = $('categoryList');
  if (!box) return;
  const set = new Set((state.items || []).map(p => (p.categoria || 'Altro')));
  const cats = Array.from(set).sort((a,b)=> a.localeCompare(b,'it'));

  box.innerHTML = '';
  const allBtn = document.createElement('button');
  allBtn.textContent = 'TUTTE';
  allBtn.onclick = ()=>{ state.selectedCategory='Tutte'; renderView(); buildCategories(); };
  box.appendChild(allBtn);

  cats.forEach(cat=>{
    const btn=document.createElement('button');
    btn.textContent=cat;
    btn.onclick=()=>{ state.selectedCategory=cat; renderView(); buildCategories(); };
    box.appendChild(btn);
  });
}

/* ============ RENDER ============ */
function renderView(){
  const arr = applyFilters(state.items);
  const grid=$('productGrid');
  grid.innerHTML='';
  arr.forEach(p=>{
    const div=document.createElement('div');
    div.className='border p-2';
    div.innerHTML = `<b>${p.codice}</b> - ${p.descrizione} - ${fmtEUR(p.prezzo)} (Conai ${fmtEUR(p.conai)})`;
    grid.appendChild(div);
  });
  renderQuotePanel();
}

function applyFilters(arr){
  let out=[...arr];
  if (state.selectedCategory!=='Tutte'){
    out = out.filter(p=> (p.categoria||'Altro')===state.selectedCategory);
  }
  if (state.search){
    const q=state.search;
    out = out.filter(p => normalize(p.codice+p.descrizione).includes(q));
  }
  return out;
}

/* ============ PREVENTIVO ============ */
function addToQuote(p){
  state.selected.set(p.codice, {...p, qty:1, sconto:0});
  renderQuotePanel();
}
function renderQuotePanel(){
  const body=$('quoteBody');
  if (!body) return;
  body.innerHTML='';
  for (const it of state.selected.values()){
    const tr=document.createElement('tr');
    tr.innerHTML=`<td>${it.codice}</td><td>${it.descrizione}</td><td>${fmtEUR(it.prezzo)}</td>`;
    body.appendChild(tr);
  }
}
