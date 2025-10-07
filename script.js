// ===============================
// Listino Digitale – Tecnobox (vLG-8+PDF/Print)
// - Auth: email/password (login gate)
// - Ricerca live, vista listino/card
// - Preventivi a destra (export XLSX/PDF/Print)
// - Log estesi per debugging
// =============================== 

/* === CONFIG (METTI I TUOI VALORI) === */
const SUPABASE_URL = 'https://wajzudbaezbyterpjdxg.supabase.co';           // <-- tuo URL -->
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indhanp1ZGJhZXpieXRlcnBqZHhnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcxODA4MTUsImV4cCI6MjA3Mjc1NjgxNX0.MxaAqdUrppG2lObO_L5-SgDu8D7eze7mBf6S9rR_Q2w'; // <-- tua anon key
const STORAGE_BUCKET = 'prodotti'; // se usi 'media', cambia qui

/* === Supabase (UMD globale) === */
let supabase = null;
let supabaseInitWarned = false;
let supabaseRetryTimer = null;
let supabaseRetryCount = 0;
const MAX_SUPABASE_RETRIES = 10;
let authListenerBound = false;

function ensureSupabaseClient(){
  if (supabase) return supabase;

  if (!window.supabase?.createClient){
    if (!supabaseInitWarned){
      console.error('[Boot] Supabase client non disponibile (UMD non caricato).');
      supabaseInitWarned = true;
    }
    return null;
  }

  try {
    supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    console.log('[Boot] Supabase client OK');
  } catch (error) {
    console.error('[Boot] Errore init Supabase:', error);
    supabase = null;
  }

  return supabase;
}

function scheduleSupabaseRetry(){
  if (supabaseRetryTimer) return;

  const msg = $('loginMsg');
  if (msg && !msg.textContent) {
    msg.textContent = 'Connessione al servizio in corso…';
  }

  supabaseRetryTimer = setTimeout(async ()=>{
    supabaseRetryTimer = null;

    if (ensureSupabaseClient()){
      supabaseRetryCount = 0;
      if (msg && msg.textContent?.startsWith('Connessione')) msg.textContent = '';
      await startAuthFlow();
      return;
    }

    supabaseRetryCount += 1;
    console.warn(`[Boot] Supabase non disponibile (tentativo ${supabaseRetryCount}/${MAX_SUPABASE_RETRIES}).`);

    if (supabaseRetryCount < MAX_SUPABASE_RETRIES){
      scheduleSupabaseRetry();
    } else if (msg) {
      msg.textContent = 'Servizio di autenticazione non raggiungibile. Controlla la connessione e ricarica la pagina.';
    }
  }, 1200);
}

let uiBound = false;
let yearInitialised = false;
let quoteMetaBound = false;

async function startAuthFlow(){
  try {
    const client = ensureSupabaseClient();
    if (!client) {
      scheduleSupabaseRetry();
      return;
    }

    const { data:{ session }, error } = await client.auth.getSession();
    if (error) console.warn('[Auth] getSession warn:', error);

    if (session?.user) {
      console.log('[Auth] sessione presente', session.user.id);
      await afterLogin(session.user.id);
    } else {
      console.log('[Auth] nessuna sessione. Mostro login gate');
      showAuthGate(true);
    }

    if (!authListenerBound) {
      client.auth.onAuthStateChange(async (event, sess)=>{
        console.log('[Auth] onAuthStateChange:', event, !!sess?.user);
        if (sess?.user) await afterLogin(sess.user.id);
        else await afterLogout();
      });
      authListenerBound = true;
    }

  } catch (error) {
    console.error('[Boot] startAuthFlow error:', error);
    showAuthGate(true);
    const m = $('loginMsg');
    if (m) m.textContent = 'Errore di inizializzazione. Vedi console.';
  }
}

/* === Helpers === */
const $ = (id) => document.getElementById(id);
const log = (...a) => console.log('[Listino]', ...a);
const err = (...a) => console.error('[Listino]', ...a);
const normalize = (s) => (s||'').toString().normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().trim();
const fmtEUR = (n) => (n==null||isNaN(n)) ? '—' : n.toLocaleString('it-IT',{style:'currency',currency:'EUR'});



// Scrolla fino alla barra "Cerca prodotti…" tenendo conto dell'header sticky
function scrollToProductsHeader(){
  const target = document.getElementById('productsHeader') || document.getElementById('searchInput');
  if (!target) return;

  const header = document.querySelector('header');
  const headerH = header ? header.getBoundingClientRect().height : 0;

  const y = target.getBoundingClientRect().top + window.pageYOffset - (headerH + 8);
  window.scrollTo({ top: y, behavior: 'smooth' });
}



function resizeQuotePanel() {
  const panel = document.getElementById('quotePanel'); 
  const table = document.getElementById('quoteTable');
  if (!panel || !table) return;

  // su tablet e mobile: pannello a tutta larghezza
  if (window.innerWidth <= 1024) {
    panel.style.width = '100%';
    return;
  }

  // quanto spazio occupa la colonna delle categorie a sinistra (se presente)
  const leftAside = document.querySelector('aside.lg\\:col-span-3'); 
  const leftW = leftAside ? leftAside.getBoundingClientRect().width : 0;

  // quanto spazio serve per vedere tutta la tabella
  const needed = (table.scrollWidth || 0) + 32; // un po’ di padding

  // quanto possiamo al massimo (margine 24px lato finestra)
  const max = Math.max(320, window.innerWidth - 24);

  // usa il min tra needed e max, così se la tabella è enorme compare lo scroll esterno
  const width = Math.min(needed, max);

  panel.style.width = width + 'px';
}

window.addEventListener('resize', resizeQuotePanel);

resizeQuotePanel();




/* === Stato === */
const state = {
  role: 'guest',
  items: [],
  view: 'listino',   // 'listino' | 'card'
  search: '',
  sort: 'alpha',     // 'alpha' | 'priceAsc' | 'priceDesc' | 'newest'
  onlyAvailable: false,
  onlyNew: false,
  priceMax: null,
  selected: new Map(),  // codice -> {codice, descrizione, prezzo, conai, qty, sconto}
  quoteMeta: {
    name: '',                                       // Nominativo
    date: new Date().toISOString().slice(0, 10),    // yyyy-mm-dd
  },
selectedCategory: 'Tutte',   // 👈 QUI la nuova proprietà
};

/* ============ BOOT ROBUSTO ============ */
async function boot(){
  try {
    bindUI(); // aggancia sempre i listener

    if (!yearInitialised && $('year')) {
      $('year').textContent = new Date().getFullYear();
      yearInitialised = true;
    }

    if (!quoteMetaBound) {
      const nameEl = document.getElementById('quoteName');
      const dateEl = document.getElementById('quoteDate');
      if (nameEl) {
        nameEl.value = state.quoteMeta.name;
        nameEl.addEventListener('input', () => { state.quoteMeta.name = nameEl.value.trim(); });
      }
      if (dateEl) {
        dateEl.value = state.quoteMeta.date;
        dateEl.addEventListener('change', () => { state.quoteMeta.date = dateEl.value || new Date().toISOString().slice(0,10); });
      }
      quoteMetaBound = true;
    }

    if (!ensureSupabaseClient()) {
      showAuthGate(true);
      scheduleSupabaseRetry();
      return;
    }

    await startAuthFlow();

  } catch (e) {
    console.error('[Boot] eccezione:', e);
    showAuthGate(true);
    const m = $('loginMsg');
    if (m) m.textContent = 'Errore di inizializzazione. Vedi console.';
  }
}

// Avvia subito se il DOM è già pronto (defer) oppure su DOMContentLoaded
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  boot();
} else {
  document.addEventListener('DOMContentLoaded', boot);
}

/* ============ UI BASE ============ */
function showAuthGate(show){
  const gate = $('authGate');
  const app  = $('appShell');
  if (!gate || !app) return;
  gate.classList.toggle('hidden', !show);
  app.classList.toggle('hidden', show);
}

function bindUI(){
  if (uiBound) return;
  uiBound = true;

  // Login
  $('btnDoLogin')?.addEventListener('click', doLogin);
  const email = $('loginEmail'), pass = $('loginPassword');
  [email, pass].forEach(el => el?.addEventListener('keydown', e => {
    if(e.key==='Enter'){ e.preventDefault(); doLogin(); }
  }));
  $('btnSendReset')?.addEventListener('click', sendReset);

  // Logout
  $('btnLogout')?.addEventListener('click', doLogout);

  // Vista
  $('viewListino')?.addEventListener('click', ()=>{ state.view='listino'; renderView(); });
 

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
  // L'handling globale del tasto ESC si occupa di chiudere il modale
  document.addEventListener('keydown', (ev)=>{ if(ev.key==='Escape' && !imgModal?.classList.contains('hidden')) toggleModal('imgModal', false); });

  // Preventivi (azioni pannello)
  $('btnExportXlsx')?.addEventListener('click', exportXlsx);
  $('btnExportPdf')?.addEventListener('click', exportPdf);
  $('btnPrintQuote')?.addEventListener('click', printQuote);
  $('btnClearQuote')?.addEventListener('click', ()=>{
    state.selected.clear();
// svuota anche il nominativo (lasciamo invariata la data)
  state.quoteMeta.name = '';
  const nameEl = document.getElementById('quoteName');
  if (nameEl) nameEl.value = '';
    renderQuotePanel();
    document.querySelectorAll('.selItem').forEach(i=>{ i.checked=false; });
// 🔴 deseleziona anche i checkbox di categoria
  document.querySelectorAll('.selAllCat').forEach(cb=>{
    cb.checked = false;
    cb.indeterminate = false;
  });
// messaggio (opzionale)
  const msg = document.getElementById('quoteMsg');
  if (msg) msg.textContent = 'Preventivo svuotato.';
  });
}

function toggleModal(id, show=true){
  const el = $(id);
  if (!el) return;
  el.classList.toggle('hidden', !show);
  document.body.classList.toggle('modal-open', show);
}

/* ============ AUTH ============ */
async function doLogin(){
  const email = $('loginEmail')?.value?.trim();
  const password = $('loginPassword')?.value || '';
  const msg = $('loginMsg');
  if (!email || !password){ if(msg) msg.textContent = 'Inserisci email e password.'; return; }
  if(msg) msg.textContent = 'Accesso in corso…';
  const client = ensureSupabaseClient();
  if (!client){
    if (msg) msg.textContent = 'Servizio di autenticazione non disponibile. Riprovo…';
    scheduleSupabaseRetry();
    return;
  }
  try {
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) {
      console.warn('[Auth] signIn error:', error);
      msg && (msg.textContent = 'Accesso non riuscito: ' + error.message);
      return;
    }
    console.log('[Auth] signIn OK', data?.user?.id);
    await afterLogin(data.user.id);
  } catch (e) {
    console.error('[Auth] eccezione login:', e);
    msg && (msg.textContent = 'Errore accesso. Vedi console.');
  }
}

async function sendReset(){
  const email = $('loginEmail')?.value?.trim();
  const msg = $('loginMsg');
  if (!email){ msg && (msg.textContent='Inserisci email per il reset.'); return; }
  const site = window.location.origin + window.location.pathname;
  const client = ensureSupabaseClient();
  if (!client){
    if (msg) msg.textContent = 'Servizio non disponibile. Riprova più tardi.';
    scheduleSupabaseRetry();
    return;
  }
  const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: site });
  msg && (msg.textContent = error ? ('Reset non riuscito: '+error.message) : 'Email di reset inviata.');
}

async function doLogout(){
  try {
    const client = ensureSupabaseClient();
    if (client?.auth) {
      await client.auth.signOut();
    if (supabase?.auth) {
      await supabase.auth.signOut();
    }
  } catch (error) {
    console.warn('[Auth] signOut fallito:', error);
  }
  await afterLogout();
}

async function afterLogin(userId){
  try{
    const client = ensureSupabaseClient();
    if (!client) throw new Error('Supabase non inizializzato');

    // Provo a leggere ruolo + display_name dal profilo
    let role = 'agent';
    let displayName = '';

    const { data: prof, error: perr } = await client
      .from('profiles')
      .select('role, display_name')
      .eq('id', userId)
      .maybeSingle();

    if (perr) console.warn('[Profiles] warn:', perr.message);
    if (prof?.role === 'admin') role = 'admin';
    if (prof?.display_name) displayName = prof.display_name;

    // Fallback: prendo anche l'utente auth per full_name/email
    const { data: userRes } = await client.auth.getUser();
    const user = userRes?.user;
    if (!displayName) {
      displayName = user?.user_metadata?.full_name
                 || user?.user_metadata?.name
                 || user?.email
                 || '';
    }

    state.role = role;

    // Mostra app
    showAuthGate(false);

    // Mostra il nome nell'header (desktop e, se vuoi, mobile)
    const nameEl = document.getElementById('userName');
    if (nameEl) {
      nameEl.textContent = displayName ? `👤 ${displayName}` : '';
      nameEl.classList.remove('hidden');
    }
    // Dati + UI
    await fetchProducts();
    renderView();

    // sblocca FAB
    document.dispatchEvent(new Event('appReady'));

  } catch(e){
    console.error('[afterLogin] err:', e);
    const info = $('resultInfo');
    if (info) info.textContent = 'Errore caricamento listino';
  }
}


  resizeQuotePanel();

async function afterLogout(){
  showAuthGate(true);
  state.role='guest';
  state.items=[];
  state.selected.clear();
  renderQuotePanel();
  $('productGrid') && ( $('productGrid').innerHTML='' );
  $('listinoContainer') && ( $('listinoContainer').innerHTML='' );

// nascondi nome utente
  const nameEl = document.getElementById('userName');
  if (nameEl) { nameEl.textContent = ''; nameEl.classList.add('hidden'); }
    // 🔔 segnala che l'app è tornata in login → nascondi FAB
  document.dispatchEvent(new Event('appHidden'));

}

/* ============ DATA ============ */
async function fetchProducts(){
  console.log('[Data] fetchProducts…');
  const info = $('resultInfo');
  try{
    const client = ensureSupabaseClient();
    if (!client) throw new Error('Supabase non inizializzato');

    const fullSelect = `
        id,
        codice,
        descrizione,
        dimensione,
        categoria,
        sottocategoria,
        prezzo,
        conai,
        unita,
        disponibile,
        novita,
        pack,
        pallet,
        tags,
        updated_at,
        product_media(id,kind,path,sort)
      `;

    let { data, error } = await client
    let { data, error } = await supabase
      .from('products')
      .select(fullSelect)
      .order('descrizione', { ascending: true });

    if (error) {
      const msg = String(error.message || '').toLowerCase();
      const missingExtra = msg.includes('dimensione') || msg.includes('conai');
      if (missingExtra) {
        console.warn('[Data] prodotti senza colonne dimensione/conai, retry fallback');
        ({ data, error } = await client
        ({ data, error } = await supabase
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
            updated_at,
            product_media(id,kind,path,sort)
          `)
          .order('descrizione', { ascending: true }));
      }
      if (error) throw error;
    }

    const items = [];
    for (const p of (data || [])) {
      // immagine principale (se presente)
      const mediaImgs = (p.product_media || [])
        .filter(m => m.kind === 'image')
        .sort((a,b) => (a.sort ?? 0) - (b.sort ?? 0));

      let imgUrl = '';
      if (mediaImgs[0]) {
        const { data: signed, error: sErr } = await client
          .storage.from(STORAGE_BUCKET)
          .createSignedUrl(mediaImgs[0].path, 600);
        if (sErr) console.warn('[Storage] signedURL warn:', sErr.message);
        imgUrl = signed?.signedUrl || '';
      }

      items.push({
        codice: p.codice,
        descrizione: p.descrizione,
        dimensione: p.dimensione ?? '',
        dimensione: p.dimensione,
        categoria: p.categoria,
        sottocategoria: p.sottocategoria,
        prezzo: p.prezzo,
        conai: p.conai ?? null,
        unita: p.unita,
        disponibile: p.disponibile,
        novita: p.novita,
        pack: p.pack,
        pallet: p.pallet,
        tags: p.tags || [],
        updated_at: p.updated_at,
        img: imgUrl,
      });
    }

    state.items = items;
    buildCategories();
    info && (info.textContent = `${items.length} articoli`);
    console.log('[Data] prodotti:', items.length);
  } catch(e){
    console.error('[Data] fetchProducts error', e);
    info && (info.textContent = 'Errore caricamento listino');
  }
}

/* ============ CATEGORIE ============ */
function buildCategories(){
  const box = document.getElementById('categoryList');
  if (!box) return;

  // dedup + sort alfabetico (IT) + fallback "Altro"
  const set = new Set((state.items || []).map(p => (p.categoria || 'Altro').trim()));
  const cats = Array.from(set).sort((a,b)=> a.localeCompare(b,'it'));

  // container
  box.innerHTML = '';

  // --- Bottone "TUTTE" in prima riga, a tutta larghezza ---
  const allBtn = document.createElement('button');
  allBtn.type = 'button';
  allBtn.textContent = 'TUTTE';
  allBtn.className = [
    'block w-full text-left',
    'rounded-xl border px-3 py-2 text-sm',
    'transition',
    (state.selectedCategory === 'Tutte')
      ? 'bg-slate-200 border-slate-300 text-slate-900'
      : 'bg-white hover:bg-slate-50'
  ].join(' ');
  allBtn.addEventListener('click', ()=>{
    state.selectedCategory = 'Tutte';
    renderView();        // aggiorna listino
    buildCategories();   // aggiorna evidenziazione
scrollToProductsHeader();   // 👈 porta in vista anche il campo "Cerca prodotti"
  });
  box.appendChild(allBtn);

  // separatore per andare a capo
  const br = document.createElement('div');
  br.className = 'w-full h-0 my-2';
  box.appendChild(br);

  // --- Altre categorie: chip su righe successive, no duplicati ---
  cats.forEach(cat=>{
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = cat;
    btn.className = [
      'inline-flex items-left justify-center',
      'rounded-xl border px-3 py-1.5 text-sm',
      'transition',
      (state.selectedCategory === cat)
        ? 'bg-slate-200 border-slate-300 text-slate-900'
        : 'bg-white hover:bg-slate-50'
    ].join(' ');
    btn.addEventListener('click', ()=>{
      state.selectedCategory = cat;
      renderView();
      buildCategories();
scrollToProductsHeader();   // 👈 porta in vista anche il campo "Cerca prodotti"
    });
    box.appendChild(btn);
  });

  // stile del contenitore (se non l’hai già messo in HTML)
  box.classList.add('flex','flex-wrap','gap-2','items-start');
}

/* ============ RENDER SWITCH ============ */
function renderView(){
  const listino = $('listinoContainer');
  if (!listino) return;

  // Se in futuro rimetti la vista card, questo continua a funzionare:
  const grid = $('productGrid'); // può essere null
  if (grid) grid.classList.add('hidden');   // nascondi sempre la card view
  listino.classList.remove('hidden');       // mostra il listino tabellare

  renderListino();
  renderQuotePanel(); // sincronizza il pannello preventivo
}


/* ============ FILTRI ============ */
function applyFilters(arr){
  let out=[...arr];

if (state.selectedCategory && state.selectedCategory !== 'Tutte') {
  out = out.filter(p => (p.categoria || 'Altro') === state.selectedCategory);
}

/*
  if (state._catKey) {
    out = out.filter(p => {
      const raw = (p.categoria ?? 'Altro').toString();
      const key = raw.normalize('NFD').replace(/\p{Diacritic}/gu,'').trim().toLowerCase();
      return key === state._catKey;
    });
  }
*/
  if (state.search){
    const q=state.search;
    out = out.filter(p => normalize((p.codice||'')+' '+(p.descrizione||'')+' '+(p.tags||[]).join(' ')).includes(q));
  }
  if (state.onlyAvailable) out = out.filter(p=>p.disponibile);
  if (state.onlyNew) out = out.filter(p=>p.novita);
  if (state.priceMax!=null) out = out.filter(p=> p.prezzo!=null && p.prezzo<=state.priceMax);

  switch(state.sort){
    case 'priceAsc': out.sort((a,b)=>(a.prezzo??Infinity)-(b.prezzo??Infinity)); break;
    case 'priceDesc': out.sort((a,b)=>(b.prezzo??-Infinity)-(a.prezzo??-Infinity)); break;
    case 'newest': out.sort((a,b)=>(b.updated_at||'').localeCompare(a.updated_at||'')); break;
    default: out.sort((a,b)=>(a.descrizione||'').localeCompare(b.descrizione||'','it')); break;
  }
  return out;
}

/* ============ LISTINO (tabellare) ============ */
function renderListino(){
  const container = $('listinoContainer'); if(!container) return;
  container.innerHTML='';

  // raggruppa per categoria dopo i filtri
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

    // Titolo categoria
    const h = document.createElement('h2');
    h.className='text-lg font-semibold mt-2 mb-1';
    h.textContent=cat;
    container.appendChild(h);

    // Tabella
    const table = document.createElement('table');
    table.className='w-full text-sm border-collapse';
    table.innerHTML = `
      <thead class="bg-slate-100">
        <tr>
          <th class="border px-2 py-1 text-center w-8">
            <div>Sel</div>
            <div class="mt-1">
              <input type="checkbox" class="selAllCat" data-cat="${encodeURIComponent(cat)}" title="Seleziona tutti">
            </div>
          </th>
          <th class="border px-2 py-1 text-left col-code">Codice</th>
          <th class="border px-2 py-1 text-left col-desc">Descrizione</th>
          <th class="border px-2 py-1 text-left col-dim">Dimensione</th>
          <th class="border px-2 py-1 text-left col-unit">Unità di vendita</th>
          <th class="border px-2 py-1 text-right col-price">Prezzo</th>
          <th class="border px-2 py-1 text-right col-conai">Conai</th>
          <th class="border px-2 py-1 text-center col-img">Img</th>
        </tr>
      </thead>
      <tbody></tbody>`;
    const tb = table.querySelector('tbody');

    // righe
    for (const p of items){
      const tr = document.createElement('tr');
      const checked = state.selected.has(p.codice) ? 'checked' : '';
      tr.innerHTML = `
        <td class="border px-2 py-1 text-center">
          <input type="checkbox" class="selItem" data-code="${p.codice}" ${checked}>
        </td>
        <td class="border px-2 py-1 whitespace-nowrap font-mono col-code">${p.codice||''}</td>
        <td class="border px-2 py-1 col-desc">
          ${p.descrizione||''} ${p.novita?'<span class="ml-2 text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-[2px]">Novità</span>':''}
        </td>
        <td class="border px-2 py-1 col-dim">${p.dimensione||''}</td>
        <td class="border px-2 py-1 col-unit">${p.unita||''}</td>
        <td class="border px-2 py-1 text-right col-price">${fmtEUR(p.prezzo)}</td>
        <td class="border px-2 py-1 text-right col-conai">${fmtEUR(p.conai)}</td>
        <td class="border px-2 py-1 text-center col-img">
          ${p.img?`<button class="text-sky-600 underline btnImg" data-src="${p.img}" data-title="${encodeURIComponent(p.descrizione||'')}">📷</button>`:'—'}
        </td>`;
      tb.appendChild(tr);
    }

    container.appendChild(table);

    // ======== LISTENER: header "Sel" (select all/deselect all per categoria) ========
    const headCb = table.querySelector('.selAllCat');
    if (headCb){
      // stato iniziale header: checked / indeterminate / unchecked
      const selCount = items.reduce((n,p)=> n + (state.selected.has(p.codice)?1:0), 0);
      if (selCount === 0){
        headCb.checked = false;
        headCb.indeterminate = false;
      } else if (selCount === items.length){
        headCb.checked = true;
        headCb.indeterminate = false;
      } else {
        headCb.checked = false;
        headCb.indeterminate = true;
      }

      headCb.addEventListener('change', (e)=>{
        const checkAll = e.currentTarget.checked;
        // per evitare mille re-render, accumula e poi un unico refresh pannello
        let changed = false;
        for (const p of items){
          const isSel = state.selected.has(p.codice);
          if (checkAll && !isSel){
            addToQuote(p); // questa re-renderizza il pannello, ma va bene anche così
            changed = true;
            // spunta la riga corrispondente
            const rowCb = table.querySelector(`.selItem[data-code="${CSS.escape(p.codice)}"]`);
            if (rowCb) rowCb.checked = true;
          } else if (!checkAll && isSel){
            removeFromQuote(p.codice);
            changed = true;
            const rowCb = table.querySelector(`.selItem[data-code="${CSS.escape(p.codice)}"]`);
            if (rowCb) rowCb.checked = false;
          }
        }
        // stato header coerente
        headCb.indeterminate = false;
        headCb.checked = checkAll;
        // (il pannello e il contatore FAB sono già aggiornati dalle add/remove)
      });
    }

    // ======== LISTENER: righe .selItem (selezione singola + refresh header immediato) ========
    table.querySelectorAll('.selItem').forEach(chk=>{
      chk.addEventListener('change', (e)=>{
        const code = e.currentTarget.getAttribute('data-code');
        const prod = state.items.find(x=>x.codice===code);
        if (!prod) return;
        if (e.currentTarget.checked) addToQuote(prod);
        else removeFromQuote(code);

        // refresh immediato stato header per questa categoria
        if (headCb){
          const selNow = items.reduce((n,p)=> n + (state.selected.has(p.codice)?1:0), 0);
          if (selNow === 0){
            headCb.checked = false;
            headCb.indeterminate = false;
          } else if (selNow === items.length){
            headCb.checked = true;
            headCb.indeterminate = false;
          } else {
            headCb.checked = false;
            headCb.indeterminate = true;
          }
        }
      });
    });

    // ======== LISTENER: immagini ========
    table.querySelectorAll('.btnImg').forEach(btn=>{
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
}

/* ============ CARD view ============ */
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

/* ============ PREVENTIVI (lato destro) ============ */
function addToQuote(p){
  const item = state.selected.get(p.codice) || {
    codice: p.codice,
    descrizione: p.descrizione,
    prezzo: Number(p.prezzo) || 0,
    conai: Number(p.conai) || 0,
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
      <td class="border px-2 py-1 font-mono">${it.codice}</td>
      <td class="border px-2 py-1"><div class="quote-desc">${it.descrizione}</div></td>
      <td class="border px-2 py-1 text-right">${fmtEUR(it.prezzo)}</td>
      <td class="border px-2 py-1 text-right">${fmtEUR(it.conai || 0)}</td>
      <td class="border px-2 py-1 text-right">
        <input type="number"
               class="w-16 border rounded px-1 py-0.5 text-right inputQty"
               data-code="${it.codice}" value="${Number(it.qty) || 1}" step="1" min="1">
      </td>
      <td class="border px-2 py-1 text-right">
        <input type="number"
               class="w-16 border rounded px-1 py-0.5 text-right inputSconto"
               data-code="${it.codice}" value="${Number(it.sconto) || 0}" step="1" min="0" max="100">
      </td>
     <td class="border px-2 py-1 text-right cellPrezzoScont">${fmtEUR(prezzoScont)}</td>
<td class="border px-2 py-1 text-right cellTotaleRiga">${fmtEUR(totale)}</td>
      <td class="border px-2 py-1 text-center">
        <button class="text-rose-600 underline btnRemove" data-code="${it.codice}">Rimuovi</button>
      </td>
    `;
    body.appendChild(tr);
  }

  tot.textContent = fmtEUR(total);
  if (cnt) cnt.textContent = state.selected.size;

  // --- Helpers LIVE per aggiornare una riga e il totale senza re-render ---
  function updateRowCalcLive(rowEl, it){
    const res = lineCalc(it);
    const c1 = rowEl.querySelector('.cellPrezzoScont');
    const c2 = rowEl.querySelector('.cellTotaleRiga');
    if (c1) c1.textContent = fmtEUR(res.prezzoScont);
    if (c2) c2.textContent = fmtEUR(res.totale);
  }
  function updateQuoteTotalLive(){
    let t = 0;
    for (const v of state.selected.values()){
      t += lineCalc(v).totale;
    }
    const totEl = document.getElementById('quoteTotal');
    if (totEl) totEl.textContent = fmtEUR(t);
  }

  // Input numerici (quantità/sconto) gestiti con helper comune
  const bindNumberField = (selector, { normalize, apply, keydownExtra }) => {
    body.querySelectorAll(selector).forEach(inp => {
      const syncValue = (raw) => {
        const row  = inp.closest('tr');
        const code = inp.getAttribute('data-code');
        const it   = state.selected.get(code);
        if (!it) return;

        const value = normalize(raw, it);
        apply(it, value);
        state.selected.set(code, it);

        updateRowCalcLive(row, it);
        updateQuoteTotalLive();
      };

      inp.addEventListener('input', (e) => {
        syncValue(e.target.value);
      });

      inp.addEventListener('focus', (e) => {
        e.target.select();
        e.target.dataset._firstDigitHandled = 'false';
      });

      inp.addEventListener('blur', () => { renderQuotePanel(); });

      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          renderQuotePanel();
          return;
        }
        if (e.key === 'Escape') {
          e.target.blur();
          return;
        }

        const isDigit = /^[0-9]$/.test(e.key);
        if (isDigit && e.target.dataset._firstDigitHandled !== 'true') {
          const allSelected = e.target.selectionStart === 0 && e.target.selectionEnd === e.target.value.length;
          if (!allSelected) {
            e.preventDefault();
            e.target.value = e.key;
            e.target.dispatchEvent(new Event('input', { bubbles: true }));
          }
          e.target.dataset._firstDigitHandled = 'true';
        }

        if (keydownExtra) {
          keydownExtra(e);
        }
      });
    });
  };

  bindNumberField('.inputQty', {
    normalize: (raw) => {
      const parsed = parseInt(String(raw || '').trim(), 10);
      return Math.max(1, Number.isNaN(parsed) ? 1 : parsed);
    },
    apply: (item, value) => {
      item.qty = value;
    }
  });

  bindNumberField('.inputSconto', {
    normalize: (raw) => {
      const parsed = parseInt(String(raw || '').trim(), 10);
      if (Number.isNaN(parsed)) return 0;
      return Math.max(0, Math.min(100, parsed));
    },
    apply: (item, value) => {
      item.sconto = value;
    },
    keydownExtra: (e) => {
      if (e.key === 'Backspace' && e.target.dataset._firstDigitHandled !== 'true') {
        e.preventDefault();
        e.target.value = '';
        e.target.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
  });

  // RIMUOVI: elimina riga e deseleziona l'articolo nella lista prodotti
  body.querySelectorAll('.btnRemove').forEach(btn=>{
    btn.addEventListener('click', (e)=>{
      const code = e.currentTarget.getAttribute('data-code');
      state.selected.delete(code);
      document.querySelectorAll(`.selItem[data-code="${CSS.escape(code)}"]`).forEach(i=>{ i.checked = false; });
      renderQuotePanel();
    });
  });

  resizeQuotePanel();
  quoteDrawer.updateCount();
}


/* ============ VALIDAZIONE E EXPORT ============ */
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

function exportXlsx(){
  if (!validateQuoteMeta()) return;

  const rows = [];

  // header meta
  rows.push(['Preventivo']);
  rows.push(['Nominativo', state.quoteMeta.name]);
  rows.push(['Data', state.quoteMeta.date]);
  rows.push([]); // riga vuota

  // tabella
  rows.push(['Codice','Descrizione','Prezzo','CONAI/collo','Q.tà','Sconto %','Prezzo scont.','Totale riga']);

  let total=0;
  for (const it of state.selected.values()){
    const { prezzoScont, totale } = lineCalc(it);
    total += totale;
    rows.push([
      it.codice, it.descrizione,
      Number(it.prezzo||0), Number(it.conai||0),
      Number(it.qty||0), Number(it.sconto||0),
      Number(prezzoScont||0), Number(totale||0),
    ]);
  }
  rows.push([]);
  rows.push(['','','','','','','Totale imponibile', Number(total||0)]);

  const safeName = (state.quoteMeta.name || 'cliente').replace(/[^\w\- ]+/g,'_').trim().replace(/\s+/g,'_');
  const filename = `preventivo_${safeName}_${state.quoteMeta.date}.xlsx`;

  if (window.XLSX){
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Preventivo');
    const wbout = XLSX.write(wb, { bookType:'xlsx', type:'array' });
    const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  } else {
    // fallback CSV
    const csv = rows.map(r=>r.map(v=>{
      const s = (v==null)?'':String(v);
      if (/[",;\n]/.test(s)) return `"${s.replace(/"/g,'""')}"`;
      return s;
    }).join(';')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `preventivo_${safeName}_${state.quoteMeta.date}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
}

function exportPdf(){
  if (!validateQuoteMeta()) return;
  if (!window.jspdf) { alert('Libreria PDF non caricata.'); return; }
  const { jsPDF } = window.jspdf;

  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const marginX = 40, marginY = 40;
  let y = marginY;

  // Titolo
  doc.setFont('helvetica','bold'); doc.setFontSize(16);
  doc.text('Preventivo', marginX, y); y += 20;

  // Meta
  doc.setFont('helvetica','normal'); doc.setFontSize(11);
  doc.text(`Nominativo: ${state.quoteMeta.name}`, marginX, y); y += 16;
  doc.text(`Data: ${state.quoteMeta.date}`, marginX, y); y += 12;

  // Tabella
  const head = [['Codice','Descrizione','Prezzo','CONAI/collo','Q.tà','Sconto %','Prezzo scont.','Totale riga']];
  const body = [];
  let total=0;
  for (const it of state.selected.values()){
    const { prezzoScont, totale } = lineCalc(it);
    total += totale;
    body.push([
      it.codice,
      it.descrizione,
      fmtEUR(it.prezzo),
      fmtEUR(it.conai||0),
      String(it.qty),
      String(it.sconto),
      fmtEUR(prezzoScont),
      fmtEUR(totale),
    ]);
  }
  // usa autoTable (già inclusa in index)
  if (doc.autoTable) {
    doc.autoTable({
      head,
      body,
      startY: y + 10,
      styles: { fontSize: 9, halign: 'right' },
      headStyles: { fillColor: [241,245,249], textColor: 20, halign: 'right' },
      columnStyles: {
        0: { halign: 'left' },
        1: { halign: 'left', cellWidth: 180 },
      },
      margin: { left: marginX, right: marginX },
      theme: 'grid',
    });
    const endY = doc.lastAutoTable.finalY || (y+10);
    doc.setFont('helvetica','bold'); doc.setFontSize(12);
    doc.text(`Totale imponibile: ${fmtEUR(total)}`, 555, endY + 24, { align: 'right' });
  } else {
    // Fallback senza autotable (basic)
    doc.text('Errore: jsPDF-Autotable non presente.', marginX, y+20);
  }

  const safeName = (state.quoteMeta.name || 'cliente').replace(/[^\w\- ]+/g,'_').trim().replace(/\s+/g,'_');
  doc.save(`preventivo_${safeName}_${state.quoteMeta.date}.pdf`);
}

function printQuote(){
  if (!validateQuoteMeta()) return;

  // HTML semplice con stile simile
  let rowsHtml = '';
  let total=0;
  for (const it of state.selected.values()){
    const { prezzoScont, totale } = lineCalc(it);
    total += totale;
    rowsHtml += `
      <tr>
        <td>${it.codice}</td>
        <td>${it.descrizione}</td>
        <td class="tr">${fmtEUR(it.prezzo)}</td>
        <td class="tr">${fmtEUR(it.conai||0)}</td>
        <td class="tr">${it.qty}</td>
        <td class="tr">${it.sconto}</td>
        <td class="tr">${fmtEUR(prezzoScont)}</td>
        <td class="tr">${fmtEUR(totale)}</td>
      </tr>`;
  }

  const win = window.open('', '_blank');
  const safeName = (state.quoteMeta.name || 'cliente').replace(/[^\w\- ]+/g,'_').trim().replace(/\s+/g,'_');

  win.document.write(`
<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Preventivo ${safeName}</title>
  <style>
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color:#0f172a; margin:24px; }
    h1 { font-size:20px; margin:0 0 8px 0; }
    .meta { font-size:12px; color:#334155; margin-bottom:16px; }
    table { width:100%; border-collapse:collapse; font-size:12px; }
    thead th { background:#f1f5f9; text-align:left; border:1px solid #e2e8f0; padding:6px 8px; }
    td { border:1px solid #e2e8f0; padding:6px 8px; }
    .tr { text-align:right; }
    tfoot td { font-weight:600; }
    .actions { display:none; }
  </style>
</head>
<body>
  <h1>Preventivo</h1>
  <div class="meta">Nominativo: <strong>${escapeHtml(state.quoteMeta.name)}</strong><br>Data: <strong>${state.quoteMeta.date}</strong></div>
  <table>
    <thead>
      <tr>
        <th>Codice</th>
        <th>Descrizione</th>
        <th class="tr">Prezzo</th>
        <th class="tr">CONAI/collo</th>
        <th class="tr">Q.tà</th>
        <th class="tr">Sconto %</th>
        <th class="tr">Prezzo scont.</th>
        <th class="tr">Totale riga</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml}
    </tbody>
    <tfoot>
      <tr>
        <td colspan="7" class="tr">Totale imponibile</td>
        <td class="tr">${fmtEUR(total)}</td>
      </tr>
    </tfoot>
  </table>
  <script>
    window.onload = function(){ window.print(); }
  </script>
</body>
</html>`);
  win.document.close();
}

function escapeHtml(s){
  return String(s||'')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#039;');
}


/* ============ DRAWER PREVENTIVO (MOBILE/TABLET) ============ */
const quoteDrawer = createQuoteDrawer();

async function handleGlobalEscape(e){
  if (e.key !== 'Escape') return;

  const imgModal = $('imgModal');
  if (imgModal && !imgModal.classList.contains('hidden')) {
    e.preventDefault();
    toggleModal('imgModal', false);
    return;

async function handleGlobalEscape(e){
  if (e.key !== 'Escape') return;

  const imgModal = $('imgModal');
  if (imgModal && !imgModal.classList.contains('hidden')) {
    e.preventDefault();
    toggleModal('imgModal', false);
    return;
  }

  if (quoteDrawer?.isOpen?.()) {
    e.preventDefault();
    quoteDrawer.close();
    return;
  }

  const appShell = $('appShell');
  const authGate = $('authGate');
  const appVisible = !!(appShell && !appShell.classList.contains('hidden'));
  const gateHidden = !authGate || authGate.classList.contains('hidden');

  if (!appVisible || !gateHidden) return;

  e.preventDefault();
  log('[Auth] ESC premuto → logout forzato');
  try {
    await doLogout();
  } catch (error) {
    err('[Auth] Logout forzato fallito', error);
    try {
      await afterLogout();
    } catch (fallbackErr) {
      err('[Auth] afterLogout fallback fallito', fallbackErr);
    }
  }
}

  if (quoteDrawer?.isOpen?.()) {
    e.preventDefault();
    quoteDrawer.close();
    return;
  }

  const appShell = $('appShell');
  const authGate = $('authGate');
  const appVisible = !!(appShell && !appShell.classList.contains('hidden'));
  const gateHidden = !authGate || authGate.classList.contains('hidden');

  if (!appVisible || !gateHidden) return;

  e.preventDefault();
  log('[Auth] ESC premuto → logout forzato');
  try {
    await doLogout();
  } catch (error) {
    err('[Auth] Logout forzato fallito', error);
    try {
      await afterLogout();
    } catch (fallbackErr) {
      err('[Auth] afterLogout fallback fallito', fallbackErr);
    }
  }
}

document.addEventListener('keydown', handleGlobalEscape);

function createQuoteDrawer(){
  let initialized = false;
  let host;
  let placeholder;
  let fab;
  let drawer;
  let drawerContent;
  let backdrop;
  let closeBtn;
  let isOpen = false;

  function ensureInit(){
    if (initialized) return true;

    const panel = $('quotePanel');
    if (!panel) return false;

    host = panel.parentElement;
    if (!host) return false;

    placeholder = document.createElement('div');
    placeholder.id = 'quotePanelHost';
    host.insertBefore(placeholder, panel.nextSibling);

    fab = document.getElementById('btnDrawerQuote');
    if (!fab){
      fab = document.createElement('button');
      fab.id = 'btnDrawerQuote';
      fab.type = 'button';
      fab.textContent = 'Preventivo (0)';
      fab.className = [
        'rounded-full bg-blue-600 text-white px-4 py-2 text-sm font-medium',
        'shadow-lg transition hover:bg-blue-500',
        'focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500'
      ].join(' ');
      const float = document.getElementById('floatingActions');
      (float || document.body).appendChild(fab);
    }

    drawer = document.getElementById('drawerQuote');
    if (!drawer){
      drawer = document.createElement('div');
      drawer.id = 'drawerQuote';
      Object.assign(drawer.style, {
        position: 'fixed',
        top: '0',
        right: '0',
        height: '100dvh',
        width: '100vw',
        maxWidth: '100vw',
        background: '#fff',
        boxShadow: '0 18px 40px rgba(15,23,42,.25)',
        transform: 'translateX(100%)',
        transition: 'transform .2s ease',
        zIndex: '9998',
        display: 'flex',
        flexDirection: 'column'
      });

      const header = document.createElement('div');
      header.className = 'flex items-center justify-between px-4 py-3 border-b border-slate-200';

      const title = document.createElement('h3');
      title.textContent = 'Preventivo';
      title.className = 'text-base font-semibold';

      closeBtn = document.createElement('button');
      closeBtn.id = 'btnCloseDrawer';
      closeBtn.type = 'button';
      closeBtn.className = 'rounded-lg border border-slate-200 px-3 py-1 text-sm hover:bg-slate-50';
      closeBtn.setAttribute('aria-label', 'Chiudi');
      closeBtn.textContent = '✕';

      header.append(title, closeBtn);

      drawerContent = document.createElement('div');
      drawerContent.id = 'drawerContent';
      Object.assign(drawerContent.style, {
        flex: '1',
        overflow: 'auto',
        padding: '12px 16px'
      });

      drawer.append(header, drawerContent);
      document.body.appendChild(drawer);
    } else {
      drawerContent = drawer.querySelector('#drawerContent') || drawer;
      closeBtn = drawer.querySelector('#btnCloseDrawer');
    }

    backdrop = document.getElementById('drawerBackdrop');
    if (!backdrop){
      backdrop = document.createElement('div');
      backdrop.id = 'drawerBackdrop';
      Object.assign(backdrop.style, {
        position: 'fixed',
        inset: '0',
        background: 'rgba(15,23,42,.35)',
        zIndex: '9997',
        display: 'none'
      });
      document.body.appendChild(backdrop);
    }

    fab.addEventListener('click', toggleDrawer);
    closeBtn?.addEventListener('click', closeDrawer);
    backdrop.addEventListener('click', closeDrawer);
    window.addEventListener('resize', handleResize);
    document.addEventListener('appReady', handleAppReady);
    document.addEventListener('appHidden', handleAppHidden);

    initialized = true;
    updateCount();
    syncVisibility();

    return true;
  }

  function handleResize(){
    syncVisibility();
    if (isOpen) updateDrawerWidth();
  }

  function handleAppReady(){
    ensureInit();
    syncVisibility();
  }

  function handleAppHidden(){
    closeDrawer();
    if (fab) fab.style.display = 'none';
  }

  function isAppActive(){
    const app = $('appShell');
    return !!(app && !app.classList.contains('hidden'));
  }

  function syncVisibility(){
    if (!fab) return;
    fab.style.display = isAppActive() ? 'inline-flex' : 'none';
  }

  function updateDrawerWidth(){
    if (!drawer) return;
    const viewport = Math.max(window.innerWidth || 0, 320);
    if (viewport <= 768){
      drawer.style.width = '100vw';
      return;
    }
    const table = document.getElementById('quoteTable');
    const tableWidth = (table?.scrollWidth || 0) + 48;
    const maxWidth = Math.max(360, viewport - 48);
    const width = Math.min(Math.max(420, tableWidth), maxWidth);
    drawer.style.width = `${width}px`;
  }

  function movePanelToDrawer(){
    const panel = $('quotePanel');
    if (panel && drawerContent && !drawerContent.contains(panel)){
      drawerContent.appendChild(panel);
      panel.style.width = '100%';
    }
  }

  function movePanelBack(){
    const panel = $('quotePanel');
    if (panel && host && placeholder && host.contains(placeholder)){
      host.insertBefore(panel, placeholder);
      panel.style.width = '';
    }
  }

  function openDrawer(){
    if (!ensureInit()) return;
    movePanelToDrawer();
    updateDrawerWidth();
    drawer.style.transform = 'translateX(0%)';
    backdrop.style.display = 'block';
    document.body.classList.add('modal-open');
    isOpen = true;
  }

  function closeDrawer(){
    if (!initialized) return;
    movePanelBack();
    drawer.style.transform = 'translateX(100%)';
    backdrop.style.display = 'none';
    document.body.classList.remove('modal-open');
    isOpen = false;
    resizeQuotePanel();
  }

  function toggleDrawer(){
    if (isOpen) closeDrawer();
    else openDrawer();
  }

  function updateCount(){
    if (!fab) return;
    const count = state.selected.size;
    fab.textContent = `Preventivo (${count})`;
    fab.setAttribute('aria-label', `Apri preventivo (${count}) articoli`);
  }

  ensureInit();


      const title = document.createElement('h3');
      title.textContent = 'Preventivo';
      title.className = 'text-base font-semibold';

      closeBtn = document.createElement('button');
      closeBtn.id = 'btnCloseDrawer';
      closeBtn.type = 'button';
      closeBtn.className = 'rounded-lg border border-slate-200 px-3 py-1 text-sm hover:bg-slate-50';
      closeBtn.setAttribute('aria-label', 'Chiudi');
      closeBtn.textContent = '✕';

      header.append(title, closeBtn);

      drawerContent = document.createElement('div');
      drawerContent.id = 'drawerContent';
      Object.assign(drawerContent.style, {
        flex: '1',
        overflow: 'auto',
        padding: '12px 16px'
      });

      drawer.append(header, drawerContent);
      document.body.appendChild(drawer);
    } else {
      drawerContent = drawer.querySelector('#drawerContent') || drawer;
      closeBtn = drawer.querySelector('#btnCloseDrawer');
    }

    backdrop = document.getElementById('drawerBackdrop');
    if (!backdrop){
      backdrop = document.createElement('div');
      backdrop.id = 'drawerBackdrop';
      Object.assign(backdrop.style, {
        position: 'fixed',
        inset: '0',
        background: 'rgba(15,23,42,.35)',
        zIndex: '9997',
        display: 'none'
      });
      document.body.appendChild(backdrop);
    }

    fab.addEventListener('click', toggleDrawer);
    closeBtn?.addEventListener('click', closeDrawer);
    backdrop.addEventListener('click', closeDrawer);
    window.addEventListener('resize', handleResize);
    document.addEventListener('appReady', handleAppReady);
    document.addEventListener('appHidden', handleAppHidden);

    initialized = true;
    updateCount();
    syncVisibility();

    return true;
  }

  function handleResize(){
    syncVisibility();
    if (isOpen) updateDrawerWidth();
  }

  function handleAppReady(){
    ensureInit();
    syncVisibility();
  }

  function handleAppHidden(){
    closeDrawer();
    if (fab) fab.style.display = 'none';
  }

  function isAppActive(){
    const app = $('appShell');
    return !!(app && !app.classList.contains('hidden'));
  }

  function syncVisibility(){
    if (!fab) return;
    fab.style.display = isAppActive() ? 'inline-flex' : 'none';
  }

  function updateDrawerWidth(){
    if (!drawer) return;
    const viewport = Math.max(window.innerWidth || 0, 320);
    if (viewport <= 768){
      drawer.style.width = '100vw';
      return;
    }
    const table = document.getElementById('quoteTable');
    const tableWidth = (table?.scrollWidth || 0) + 48;
    const maxWidth = Math.max(360, viewport - 48);
    const width = Math.min(Math.max(420, tableWidth), maxWidth);
    drawer.style.width = `${width}px`;
  }

  function movePanelToDrawer(){
    const panel = $('quotePanel');
    if (panel && drawerContent && !drawerContent.contains(panel)){
      drawerContent.appendChild(panel);
      panel.style.width = '100%';
    }
  }

  function movePanelBack(){
    const panel = $('quotePanel');
    if (panel && host && placeholder && host.contains(placeholder)){
      host.insertBefore(panel, placeholder);
      panel.style.width = '';
    }
  }

  function openDrawer(){
    if (!ensureInit()) return;
    movePanelToDrawer();
    updateDrawerWidth();
    drawer.style.transform = 'translateX(0%)';
    backdrop.style.display = 'block';
    document.body.classList.add('modal-open');
    isOpen = true;
  }

  function closeDrawer(){
    if (!initialized) return;
    movePanelBack();
    drawer.style.transform = 'translateX(100%)';
    backdrop.style.display = 'none';
    document.body.classList.remove('modal-open');
    isOpen = false;
    resizeQuotePanel();
  }

  function toggleDrawer(){
    if (isOpen) closeDrawer();
    else openDrawer();
  }

  function updateCount(){
    if (!fab) return;
    const count = state.selected.size;
    fab.textContent = `Preventivo (${count})`;
    fab.setAttribute('aria-label', `Apri preventivo (${count}) articoli`);
  }

  ensureInit();

  return {
    updateCount,
    syncVisibility,
    close: closeDrawer,
    isOpen: () => isOpen
document.addEventListener('keydown', handleGlobalEscape);

function createQuoteDrawer(){
  let initialized = false;
  let host;
  let placeholder;
  let fab;
  let drawer;
  let drawerContent;
  let backdrop;
  let closeBtn;
  let isOpen = false;

  function ensureInit(){
    if (initialized) return true;

    const panel = $('quotePanel');
    if (!panel) return false;

    host = panel.parentElement;
    if (!host) return false;

    placeholder = document.createElement('div');
    placeholder.id = 'quotePanelHost';
    host.insertBefore(placeholder, panel.nextSibling);

    fab = document.getElementById('btnDrawerQuote');
    if (!fab){
      fab = document.createElement('button');
      fab.id = 'btnDrawerQuote';
      fab.type = 'button';
      fab.textContent = 'Preventivo (0)';
      fab.className = [
        'rounded-full bg-blue-600 text-white px-4 py-2 text-sm font-medium',
        'shadow-lg transition hover:bg-blue-500',
        'focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500'
      ].join(' ');
      const float = document.getElementById('floatingActions');
      (float || document.body).appendChild(fab);
    }

    drawer = document.getElementById('drawerQuote');
    if (!drawer){
      drawer = document.createElement('div');
      drawer.id = 'drawerQuote';
      Object.assign(drawer.style, {
        position: 'fixed',
        top: '0',
        right: '0',
        height: '100dvh',
        width: '100vw',
        maxWidth: '100vw',
        background: '#fff',
        boxShadow: '0 18px 40px rgba(15,23,42,.25)',
        transform: 'translateX(100%)',
        transition: 'transform .2s ease',
        zIndex: '9998',
        display: 'flex',
        flexDirection: 'column'
      });

      const header = document.createElement('div');
      header.className = 'flex items-center justify-between px-4 py-3 border-b border-slate-200';

      const title = document.createElement('h3');
      title.textContent = 'Preventivo';
      title.className = 'text-base font-semibold';

      closeBtn = document.createElement('button');
      closeBtn.id = 'btnCloseDrawer';
      closeBtn.type = 'button';
      closeBtn.className = 'rounded-lg border border-slate-200 px-3 py-1 text-sm hover:bg-slate-50';
      closeBtn.setAttribute('aria-label', 'Chiudi');
      closeBtn.textContent = '✕';

      header.append(title, closeBtn);

      drawerContent = document.createElement('div');
      drawerContent.id = 'drawerContent';
      Object.assign(drawerContent.style, {
        flex: '1',
        overflow: 'auto',
        padding: '12px 16px'
      });

      drawer.append(header, drawerContent);
      document.body.appendChild(drawer);
    } else {
      drawerContent = drawer.querySelector('#drawerContent') || drawer;
      closeBtn = drawer.querySelector('#btnCloseDrawer');
    }

    backdrop = document.getElementById('drawerBackdrop');
    if (!backdrop){
      backdrop = document.createElement('div');
      backdrop.id = 'drawerBackdrop';
      Object.assign(backdrop.style, {
        position: 'fixed',
        inset: '0',
        background: 'rgba(15,23,42,.35)',
        zIndex: '9997',
        display: 'none'
      });
      document.body.appendChild(backdrop);
    }

    fab.addEventListener('click', toggleDrawer);
    closeBtn?.addEventListener('click', closeDrawer);
    backdrop.addEventListener('click', closeDrawer);
    window.addEventListener('resize', handleResize);
    document.addEventListener('appReady', handleAppReady);
    document.addEventListener('appHidden', handleAppHidden);

    initialized = true;
    updateCount();
    syncVisibility();

    return true;
  }

  function handleResize(){
    syncVisibility();
    if (isOpen) updateDrawerWidth();
  }

  function handleAppReady(){
    ensureInit();
    syncVisibility();
  }

  function handleAppHidden(){
    closeDrawer();
    if (fab) fab.style.display = 'none';
  }

  function isAppActive(){
    const app = $('appShell');
    return !!(app && !app.classList.contains('hidden'));
  }

  function syncVisibility(){
    if (!fab) return;
    fab.style.display = isAppActive() ? 'inline-flex' : 'none';
  }

  function updateDrawerWidth(){
    if (!drawer) return;
    const viewport = Math.max(window.innerWidth || 0, 320);
    if (viewport <= 768){
      drawer.style.width = '100vw';
      return;
    }
    const table = document.getElementById('quoteTable');
    const tableWidth = (table?.scrollWidth || 0) + 48;
    const maxWidth = Math.max(360, viewport - 48);
    const width = Math.min(Math.max(420, tableWidth), maxWidth);
    drawer.style.width = `${width}px`;
  }

  function movePanelToDrawer(){
    const panel = $('quotePanel');
    if (panel && drawerContent && !drawerContent.contains(panel)){
      drawerContent.appendChild(panel);
      panel.style.width = '100%';
    }
  }

  function movePanelBack(){
    const panel = $('quotePanel');
    if (panel && host && placeholder && host.contains(placeholder)){
      host.insertBefore(panel, placeholder);
      panel.style.width = '';
    }
  }

  function openDrawer(){
    if (!ensureInit()) return;
    movePanelToDrawer();
    updateDrawerWidth();
    drawer.style.transform = 'translateX(0%)';
    backdrop.style.display = 'block';
    document.body.classList.add('modal-open');
    isOpen = true;
  }

  function closeDrawer(){
    if (!initialized) return;
    movePanelBack();
    drawer.style.transform = 'translateX(100%)';
    backdrop.style.display = 'none';
    document.body.classList.remove('modal-open');
    isOpen = false;
    resizeQuotePanel();
  }

  function toggleDrawer(){
    if (isOpen) closeDrawer();
    else openDrawer();
  }

  function updateCount(){
    if (!fab) return;
    const count = state.selected.size;
    fab.textContent = `Preventivo (${count})`;
    fab.setAttribute('aria-label', `Apri preventivo (${count}) articoli`);
  }

  ensureInit();

  return {
    updateCount,
    syncVisibility,
    close: closeDrawer,
    isOpen: () => isOpen
function createQuoteDrawer(){
  let initialized = false;
  let host;
  let placeholder;
  let fab;
  let drawer;
  let drawerContent;
  let backdrop;
  let closeBtn;
  let isOpen = false;

  function ensureInit(){
    if (initialized) return true;

    const panel = $('quotePanel');
    if (!panel) return false;

    host = panel.parentElement;
    if (!host) return false;

    placeholder = document.createElement('div');
    placeholder.id = 'quotePanelHost';
    host.insertBefore(placeholder, panel.nextSibling);

    fab = document.getElementById('btnDrawerQuote');
    if (!fab){
      fab = document.createElement('button');
      fab.id = 'btnDrawerQuote';
      fab.type = 'button';
      fab.textContent = 'Preventivo (0)';
      fab.className = [
        'rounded-full bg-blue-600 text-white px-4 py-2 text-sm font-medium',
        'shadow-lg transition hover:bg-blue-500',
        'focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500'
      ].join(' ');
      const float = document.getElementById('floatingActions');
      (float || document.body).appendChild(fab);
    }

    drawer = document.getElementById('drawerQuote');
    if (!drawer){
      drawer = document.createElement('div');
      drawer.id = 'drawerQuote';
      Object.assign(drawer.style, {
        position: 'fixed',
        top: '0',
        right: '0',
        height: '100dvh',
        width: '100vw',
        maxWidth: '100vw',
        background: '#fff',
        boxShadow: '0 18px 40px rgba(15,23,42,.25)',
        transform: 'translateX(100%)',
        transition: 'transform .2s ease',
        zIndex: '9998',
        display: 'flex',
        flexDirection: 'column'
      });

      const header = document.createElement('div');
      header.className = 'flex items-center justify-between px-4 py-3 border-b border-slate-200';

      const title = document.createElement('h3');
      title.textContent = 'Preventivo';
      title.className = 'text-base font-semibold';

      closeBtn = document.createElement('button');
      closeBtn.id = 'btnCloseDrawer';
      closeBtn.type = 'button';
      closeBtn.className = 'rounded-lg border border-slate-200 px-3 py-1 text-sm hover:bg-slate-50';
      closeBtn.setAttribute('aria-label', 'Chiudi');
      closeBtn.textContent = '✕';

      header.append(title, closeBtn);

      drawerContent = document.createElement('div');
      drawerContent.id = 'drawerContent';
      Object.assign(drawerContent.style, {
        flex: '1',
        overflow: 'auto',
        padding: '12px 16px'
      });

      drawer.append(header, drawerContent);
      document.body.appendChild(drawer);
    } else {
      drawerContent = drawer.querySelector('#drawerContent') || drawer;
      closeBtn = drawer.querySelector('#btnCloseDrawer');
    }

    backdrop = document.getElementById('drawerBackdrop');
    if (!backdrop){
      backdrop = document.createElement('div');
      backdrop.id = 'drawerBackdrop';
      Object.assign(backdrop.style, {
        position: 'fixed',
        inset: '0',
        background: 'rgba(15,23,42,.35)',
        zIndex: '9997',
        display: 'none'
      });
      document.body.appendChild(backdrop);
    }

    fab.addEventListener('click', toggleDrawer);
    closeBtn?.addEventListener('click', closeDrawer);
    backdrop.addEventListener('click', closeDrawer);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', handleResize);
    document.addEventListener('appReady', handleAppReady);
    document.addEventListener('appHidden', handleAppHidden);

    initialized = true;
    updateCount();
    syncVisibility();

    return true;
  }

  function onKeyDown(e){
    if (e.key === 'Escape') closeDrawer();
  }

  function handleResize(){
    syncVisibility();
    if (isOpen) updateDrawerWidth();
  }

  function handleAppReady(){
    ensureInit();
    syncVisibility();
  }

  function handleAppHidden(){
    closeDrawer();
    if (fab) fab.style.display = 'none';
  }

  function isAppActive(){
    const app = $('appShell');
    return !!(app && !app.classList.contains('hidden'));
  }

  function syncVisibility(){
    if (!fab) return;
    fab.style.display = isAppActive() ? 'inline-flex' : 'none';
  }

  function updateDrawerWidth(){
    if (!drawer) return;
    const viewport = Math.max(window.innerWidth || 0, 320);
    if (viewport <= 768){
      drawer.style.width = '100vw';
      return;
    }
    const table = document.getElementById('quoteTable');
    const tableWidth = (table?.scrollWidth || 0) + 48;
    const maxWidth = Math.max(360, viewport - 48);
    const width = Math.min(Math.max(420, tableWidth), maxWidth);
    drawer.style.width = `${width}px`;
  }

  function movePanelToDrawer(){
    const panel = $('quotePanel');
    if (panel && drawerContent && !drawerContent.contains(panel)){
      drawerContent.appendChild(panel);
      panel.style.width = '100%';
    }
  }

  function movePanelBack(){
    const panel = $('quotePanel');
    if (panel && host && placeholder && host.contains(placeholder)){
      host.insertBefore(panel, placeholder);
      panel.style.width = '';
    }
  }

  function openDrawer(){
    if (!ensureInit()) return;
    movePanelToDrawer();
    updateDrawerWidth();
    drawer.style.transform = 'translateX(0%)';
    backdrop.style.display = 'block';
    document.body.classList.add('modal-open');
    isOpen = true;
  }

  function closeDrawer(){
    if (!initialized) return;
    movePanelBack();
    drawer.style.transform = 'translateX(100%)';
    backdrop.style.display = 'none';
    document.body.classList.remove('modal-open');
    isOpen = false;
    resizeQuotePanel();
  }

  function toggleDrawer(){
    if (isOpen) closeDrawer();
    else openDrawer();
  }

  function updateCount(){
    if (!fab) return;
    const count = state.selected.size;
    fab.textContent = `Preventivo (${count})`;
    fab.setAttribute('aria-label', `Apri preventivo (${count}) articoli`);
  }

  ensureInit();

  return {
    updateCount,
    syncVisibility,
    close: closeDrawer
  };
}
// === Back to Top button ===
(function(){
  const btn = document.getElementById('btnBackToTop');
  if (!btn) return;

  // Mostra/nasconde in base allo scroll (soglia personalizzabile)
  const THRESHOLD = 300; // px
  window.addEventListener('scroll', ()=>{
    if (window.scrollY > THRESHOLD) btn.classList.remove('hidden');
    else btn.classList.add('hidden');
  });

  // Click → scroll su
  btn.addEventListener('click', ()=>{
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // Stato iniziale corretto (se entri con pagina già scrollata)
  if (window.scrollY > THRESHOLD) btn.classList.remove('hidden');
})();


