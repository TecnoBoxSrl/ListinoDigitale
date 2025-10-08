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
let logoutInFlight = false;
let pdfLogoCache;
const DEFAULT_QUOTE_PAYMENT = 'Secondo accordi o da definire';

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
        if (sess?.user) {
          await afterLogin(sess.user.id);
        } else if (!logoutInFlight) {
          await afterLogout();
        } else {
          console.log('[Auth] Logout già in corso, skip afterLogout duplicato');
        }
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

function sanitizeClientInitials(name){
  const normalized = String(name || '')
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (!normalized) return 'XX';
  if (normalized.length === 1) return normalized + 'X';
  return normalized.slice(0, 2);
}

function extractInitials(value, length){
  const normalized = String(value || '')
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (!normalized) return 'X'.repeat(length);
  if (normalized.length < length) return normalized.padEnd(length, 'X');
  return normalized.slice(0, length);
}

function getQuoteDateParts(){
  const raw = state.quoteMeta?.date || '';
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    return { year: match[1], month: match[2], day: match[3] };
  }
  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return { year, month, day };
}

function getAgentInitials(){
  const name = state.agent?.name || '';
  const parts = name
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .toUpperCase()
    .split(/\s+/)
    .filter(Boolean);

  const fallback = extractInitials(state.agent?.code || 'AG', 4);
  if (!parts.length) return fallback;

  const firstPart = extractInitials(parts[0], 2);
  let lastPart = parts.length > 1 ? extractInitials(parts[parts.length - 1], 2) : '';

  if (!lastPart) {
    lastPart = extractInitials(state.agent?.code || '', 2);
  }

  const initials = (firstPart + lastPart).padEnd(4, 'X').slice(0, 4);
  return initials || fallback;
}

function getQuoteCode(){
  const { year, month, day } = getQuoteDateParts();
  const clientCode = sanitizeClientInitials(state.quoteMeta?.name);
  const agentInitials = getAgentInitials();
  return `${year}${month}${day}${clientCode}${agentInitials}`;
}

function getQuoteMetaEntries(){
  const { year, month, day } = getQuoteDateParts();
  const normalizedDate = `${year}-${month}-${day}`;
  const entries = [
    { label: 'Data', value: normalizedDate },
    { label: 'Nominativo', value: (state.quoteMeta?.name || '').trim() || '—' },
    { label: 'Pagamento', value: getQuotePayment() },
  ];

  const seen = new Set();
  const result = [];
  for (const entry of entries) {
    const key = entry.label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(entry);
  }
  return result;
}

function updateQuoteCodeLabel(){
  const el = document.getElementById('quoteCodeLabel');
  if (!el) return;
  const isGuest = state.role === 'guest';
  const code = isGuest ? '' : getQuoteCode();
  el.textContent = code || '—';
  el.title = code ? `Codice preventivo ${code}` : 'Codice preventivo non disponibile';
}

function getQuotePayment(){
  const value = (state.quoteMeta?.payment || '').trim();
  return value || DEFAULT_QUOTE_PAYMENT;
}

const CATEGORY_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const DEFAULT_AVAILABLE_CATEGORY_LETTERS = new Set([...CATEGORY_LETTERS, '#']);
let lastAvailableCategoryLetters = new Set(DEFAULT_AVAILABLE_CATEGORY_LETTERS);

function isDesktopLayout(){
  if (window.matchMedia) {
    return window.matchMedia('(min-width: 1024px)').matches;
  }
  return window.innerWidth >= 1024;
}

function deriveCategoryLetter(cat){
  const normalized = normalize(cat || '');
  if (!normalized) return '#';
  const first = normalized.charAt(0);
  if (first >= 'a' && first <= 'z') {
    return first.toUpperCase();
  }
  return '#';
}



// Scrolla fino alla barra "Cerca prodotti…" tenendo conto dell'header sticky
function scrollToProductsHeader(){
  const target = document.getElementById('productsHeader') || document.getElementById('searchInput');
  if (!target) return;

  const header = document.querySelector('header');
  const headerH = header ? header.getBoundingClientRect().height : 0;

  const y = target.getBoundingClientRect().top + window.pageYOffset - (headerH + 8);
  window.scrollTo({ top: y, behavior: 'smooth' });
}

function scrollToCategoryResults(){
  const container = document.getElementById('listinoContainer');
  if (!container) return;

  const target = container.querySelector('h2, table') || container;

  requestAnimationFrame(() => {
    const header = document.querySelector('header');
    const headerH = header ? header.getBoundingClientRect().height : 0;
    const top = target.getBoundingClientRect().top + window.pageYOffset - (headerH + 12);
    window.scrollTo({ top: Math.max(top, 0), behavior: 'smooth' });
  });
}

function clearSupabaseAuthStorage(){
  try {
    const match = SUPABASE_URL?.match(/^https:\/\/([^.]+)\.supabase\.co/i);
    const projectRef = match?.[1] || null;
    const stores = [];
    if (typeof localStorage !== 'undefined') stores.push(localStorage);
    if (typeof sessionStorage !== 'undefined') stores.push(sessionStorage);

    const prefixes = ['supabase.auth.token'];
    if (projectRef) {
      const base = `sb-${projectRef}-auth-token`;
      prefixes.push(base, `${base}#`);
    }

    for (const store of stores) {
      for (let i = store.length - 1; i >= 0; i -= 1) {
        const key = store.key(i);
        if (!key) continue;
        if (prefixes.some(prefix => key.startsWith(prefix))) {
          store.removeItem(key);
        }
      }
    }
  } catch (storageErr) {
    console.warn('[Auth] clearSupabaseAuthStorage warn:', storageErr);
  }
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
    payment: DEFAULT_QUOTE_PAYMENT,
  },
  selectedCategory: 'Tutte',   // 👈 QUI la nuova proprietà
  categorySearch: '',
  categoryLetter: '',
  agent: {
    name: '',
    code: '',
  },
};

let categoryLayoutBound = false;
let categoryFiltersBound = false;
let categoryLetterButtons = [];

function relocateCategoryPanel(){
  const panel = document.getElementById('catsSticky');
  const desktopAnchor = document.getElementById('categoryPanelDesktopAnchor');
  const mobileAnchor = document.getElementById('categoryPanelMobileAnchor');
  if (!panel || !desktopAnchor || !mobileAnchor) return;

  const isDesktop = isDesktopLayout();
  const target = isDesktop ? desktopAnchor : mobileAnchor;
  if (target && panel.parentElement !== target) {
    target.appendChild(panel);
  }
}

function applyCategoryOrientation(){
  const list = document.getElementById('categoryList');
  if (!list) return;

  const orientation = isDesktopLayout() ? 'vertical' : 'horizontal';

  list.classList.remove('orientation-horizontal', 'orientation-vertical');
  list.classList.add(`orientation-${orientation}`);
}

function initCategoryLayout(){
  if (categoryLayoutBound) return;
  categoryLayoutBound = true;

  const handleLayoutChange = () => {
    relocateCategoryPanel();
    applyCategoryOrientation();
    buildCategories();
  };

  handleLayoutChange();
  window.addEventListener('resize', handleLayoutChange);
  window.addEventListener('orientationchange', handleLayoutChange);
}

function getCategoryLetterButtonBaseClass(){
  return 'category-letter-button';
}

function updateCategoryLetterButtons(availableLetters){
  if (availableLetters) {
    lastAvailableCategoryLetters = new Set(availableLetters);
  }

  if (!categoryLetterButtons.length) return;

  const available = availableLetters
    ? new Set(availableLetters)
    : new Set(lastAvailableCategoryLetters);

  categoryLetterButtons.forEach(btn => {
    const value = btn.dataset?.value || '';
    const isActive = value === state.categoryLetter;
    const isAvailable = value === '' || available.has(value);

    btn.disabled = value !== '' && !isAvailable;
    btn.className = getCategoryLetterButtonBaseClass();
    btn.classList.toggle('is-active', isActive && isAvailable);
    btn.classList.toggle('is-disabled', value !== '' && !isAvailable);
    btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });
}

function initCategoryFilters(){
  if (categoryFiltersBound) return;

  const searchInput = document.getElementById('categorySearchInput');
  const letterBar = document.getElementById('categoryLetterBar');

  if (searchInput) {
    searchInput.value = state.categorySearch;
    searchInput.addEventListener('input', (e) => {
      state.categorySearch = e.target.value;
      buildCategories();
    });
  }

  if (letterBar) {
    letterBar.innerHTML = '';
    categoryLetterButtons = [];

    const options = [
      { label: 'Tutte', value: '' },
      ...CATEGORY_LETTERS.map(letter => ({ label: letter, value: letter })),
      { label: '#', value: '#' },
    ];

    options.forEach(opt => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = opt.label;
      btn.className = getCategoryLetterButtonBaseClass();
      btn.dataset.value = opt.value;
      btn.setAttribute('aria-pressed', opt.value === state.categoryLetter ? 'true' : 'false');
      btn.addEventListener('click', () => {
        state.categoryLetter = opt.value;
        updateCategoryLetterButtons();
        buildCategories();
        if (isDesktopLayout()) {
          scrollToProductsHeader();
        }
      });
      letterBar.appendChild(btn);
      categoryLetterButtons.push(btn);
    });

    updateCategoryLetterButtons();
  }

  categoryFiltersBound = true;
}

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
      const paymentEl = document.getElementById('quotePayment');
      if (nameEl) {
        nameEl.value = state.quoteMeta.name;
        nameEl.addEventListener('input', () => {
          state.quoteMeta.name = nameEl.value.trim();
          updateQuoteCodeLabel();
        });
      }
      if (dateEl) {
        dateEl.value = state.quoteMeta.date;
        dateEl.addEventListener('change', () => {
          state.quoteMeta.date = dateEl.value || new Date().toISOString().slice(0,10);
          updateQuoteCodeLabel();
        });
      }
      if (paymentEl) {
        paymentEl.value = getQuotePayment();
        paymentEl.addEventListener('focus', () => {
          if (paymentEl.value.trim() === DEFAULT_QUOTE_PAYMENT) {
            paymentEl.value = '';
          }
        });
        paymentEl.addEventListener('input', () => {
          state.quoteMeta.payment = paymentEl.value.trim();
        });
        paymentEl.addEventListener('blur', () => {
          const raw = paymentEl.value.trim();
          if (!raw) {
            paymentEl.value = DEFAULT_QUOTE_PAYMENT;
            state.quoteMeta.payment = DEFAULT_QUOTE_PAYMENT;
          } else {
            state.quoteMeta.payment = raw;
          }
        });
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
  $('btnLogout')?.addEventListener('click', () => { doLogout({ reason: 'manual' }); });

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

  // Preventivi (azioni pannello)
  $('btnExportXlsx')?.addEventListener('click', exportXlsx);
  $('btnExportPdf')?.addEventListener('click', () => { void exportPdf(); });
  $('btnPrintQuote')?.addEventListener('click', printQuote);
  $('btnClearQuote')?.addEventListener('click', ()=>{
    state.selected.clear();
    // svuota anche il nominativo (lasciamo invariata la data)
    state.quoteMeta.name = '';
    state.quoteMeta.payment = DEFAULT_QUOTE_PAYMENT;
    const nameEl = document.getElementById('quoteName');
    if (nameEl) nameEl.value = '';
    const paymentEl = document.getElementById('quotePayment');
    if (paymentEl) paymentEl.value = DEFAULT_QUOTE_PAYMENT;
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

  initCategoryFilters();
  initCategoryLayout();
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

    let userId = data?.user?.id || data?.session?.user?.id || null;
    if (!userId) {
      console.warn('[Auth] Nessun userId nella risposta, provo a leggere la sessione corrente');
      const { data: sessionData, error: sessionError } = await client.auth.getSession();
      if (sessionError) {
        console.error('[Auth] getSession dopo login fallito:', sessionError);
        throw new Error('Sessione non disponibile dopo il login. Riprova.');
      }
      userId = sessionData?.session?.user?.id || null;
    }

    if (!userId) {
      console.error('[Auth] Login riuscito ma userId ancora assente.');
      throw new Error('Login riuscito ma impossibile recuperare l’utente.');
    }

    console.log('[Auth] signIn OK', userId);
    if (msg) msg.textContent = 'Accesso riuscito, caricamento in corso…';
    await afterLogin(userId);
  } catch (e) {
    console.error('[Auth] eccezione login:', e);
    if (msg) {
      msg.textContent = e?.message ? String(e.message) : 'Errore accesso. Vedi console.';
    }
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

async function doLogout(options = {}){
  const { reason = 'manual', hard = false, reload = false } = options;
  if (logoutInFlight) {
    console.log('[Auth] Logout ignorato: già in corso');
    return;
  }
  logoutInFlight = true;
  try {
    log(`[Auth] Logout richiesto (${reason})`);
    try {
      const client = ensureSupabaseClient();
      if (client?.auth) {
        await client.auth.signOut({ scope: 'global' });
      }
    } catch (error) {
      console.warn('[Auth] signOut fallito:', error);
    }

    if (hard) {
      clearSupabaseAuthStorage();
    }

    await afterLogout();

    if (reload) {
      setTimeout(() => {
        try {
          const { pathname, search } = window.location;
          window.location.replace(`${pathname}${search}`);
        } catch (reloadErr) {
          console.warn('[Auth] reload fallback', reloadErr);
          window.location.reload();
        }
      }, 120);
    }
  } finally {
    logoutInFlight = false;
  }
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
    const metadata = user?.user_metadata || {};
    let agentCode = metadata.agent_code
                   || metadata.sigla_agente
                   || metadata.sigla
                   || metadata.code
                   || metadata.agentCode
                   || '';
    if (!agentCode && prof?.agent_code) agentCode = prof.agent_code;
    const sanitizedAgentCode = String(agentCode || '')
      .normalize('NFD').replace(/\p{Diacritic}/gu, '')
      .replace(/[^a-z0-9]/gi, '')
      .toUpperCase()
      .slice(0, 6);
    let fallbackAgentCode = sanitizedAgentCode;
    if (!fallbackAgentCode && displayName) {
      const initials = displayName
        .split(/\s+/)
        .filter(Boolean)
        .map(part => part[0])
        .join('')
        .toUpperCase();
      fallbackAgentCode = initials.slice(0, 4);
    }
    state.agent.name = displayName || '';
    state.agent.code = fallbackAgentCode || 'AG';
    updateQuoteCodeLabel();

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
  state.selectedCategory = 'Tutte';
  state.categorySearch = '';
  state.categoryLetter = '';
  state.agent.name = '';
  state.agent.code = '';
  state.quoteMeta.name = '';
  state.quoteMeta.payment = DEFAULT_QUOTE_PAYMENT;
  state.quoteMeta.date = new Date().toISOString().slice(0, 10);
  const quoteNameEl = document.getElementById('quoteName');
  if (quoteNameEl) quoteNameEl.value = '';
  const quoteDateEl = document.getElementById('quoteDate');
  if (quoteDateEl) quoteDateEl.value = state.quoteMeta.date;
  const quotePaymentEl = document.getElementById('quotePayment');
  if (quotePaymentEl) quotePaymentEl.value = DEFAULT_QUOTE_PAYMENT;
  updateQuoteCodeLabel();
  renderQuotePanel();
  $('productGrid') && ( $('productGrid').innerHTML='' );
  $('listinoContainer') && ( $('listinoContainer').innerHTML='' );

  const catSearchInput = document.getElementById('categorySearchInput');
  if (catSearchInput) catSearchInput.value = '';
  updateCategoryLetterButtons();
  buildCategories();

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
      .from('products')
      .select(fullSelect)
      .order('descrizione', { ascending: true });

    if (error) {
      const msg = String(error.message || '').toLowerCase();
      const missingExtra = msg.includes('dimensione') || msg.includes('conai');
      if (missingExtra) {
        console.warn('[Data] prodotti senza colonne dimensione/conai, retry fallback');
        ({ data, error } = await client
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
  const allCats = Array.from(set).sort((a,b)=> a.localeCompare(b,'it'));
  const isDesktop = isDesktopLayout();
  const normalizedSearch = normalize(state.categorySearch || '');
  const hasSearch = !!normalizedSearch;

  const handleCategorySelection = (category) => {
    state.selectedCategory = category;
    renderView();        // aggiorna listino
    buildCategories();   // aggiorna evidenziazione
    if (isDesktopLayout()) {
      scrollToProductsHeader();
    } else {
      scrollToCategoryResults();
    }
  };

  let filteredForAvailability = [...allCats];

  if (!isDesktop && hasSearch) {
    filteredForAvailability = filteredForAvailability.filter(cat => normalize(cat).includes(normalizedSearch));
  }

  const availableLetters = filteredForAvailability.length
    ? new Set(filteredForAvailability.map(deriveCategoryLetter))
    : new Set();

  if (!isDesktop && state.categoryLetter && !availableLetters.has(state.categoryLetter)) {
    state.categoryLetter = '';
  }

  updateCategoryLetterButtons(availableLetters);

  let cats = [...filteredForAvailability];

  if (!isDesktop && state.categoryLetter) {
    cats = cats.filter(cat => deriveCategoryLetter(cat) === state.categoryLetter);
  }

  // container
  box.innerHTML = '';

  // --- Bottone "TUTTE" in prima riga, a tutta larghezza ---
  const allBtn = document.createElement('button');
  allBtn.type = 'button';
  allBtn.textContent = 'TUTTE';
  allBtn.className = [
    'inline-flex items-center justify-center w-full text-left',
    'rounded-xl border px-3 py-2 text-sm',
    'transition',
    (state.selectedCategory === 'Tutte')
      ? 'bg-slate-200 border-slate-300 text-slate-900'
      : 'bg-white hover:bg-slate-50'
  ].join(' ');
  allBtn.addEventListener('click', () => {
    handleCategorySelection('Tutte');
  });
  box.appendChild(allBtn);

  // separatore per andare a capo
  const br = document.createElement('div');
  br.className = 'category-break w-full h-0 my-2';
  box.appendChild(br);

  if (!cats.length) {
    const empty = document.createElement('div');
    empty.className = 'text-xs text-slate-500 italic';
    empty.textContent = 'Nessuna categoria trovata.';
    box.appendChild(empty);
    applyCategoryOrientation();
    return;
  }

  // --- Altre categorie: chip su righe successive, no duplicati ---
  cats.forEach(cat => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = cat;
    btn.className = [
      'inline-flex items-center justify-center w-full text-left',
      'rounded-xl border px-3 py-1.5 text-sm',
      'transition',
      (state.selectedCategory === cat)
        ? 'bg-slate-200 border-slate-300 text-slate-900'
        : 'bg-white hover:bg-slate-50'
    ].join(' ');
    btn.addEventListener('click', () => {
      handleCategorySelection(cat);
    });
    box.appendChild(btn);
  });

  applyCategoryOrientation();
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
  updateQuoteCodeLabel();
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
  state.quoteMeta.payment = getQuotePayment();
  const paymentEl = document.getElementById('quotePayment');
  if (paymentEl) paymentEl.value = state.quoteMeta.payment;
  if (msg) msg.textContent = '';
  return true;
}

function exportXlsx(){
  if (!validateQuoteMeta()) return;

  const rows = [];

  // header meta
  rows.push(['Preventivo']);
  const metaEntries = getQuoteMetaEntries();
  metaEntries.forEach(entry => {
    rows.push([entry.label, entry.value]);
  });
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
  const quoteCode = getQuoteCode();
  const safeCode = quoteCode.replace(/[^A-Z0-9]/gi, '').toUpperCase();
  const filename = `preventivo_${safeCode || safeName}_${state.quoteMeta.date}.xlsx`;

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
    const quoteCode = getQuoteCode();
    const safeCode = quoteCode.replace(/[^A-Z0-9]/gi, '').toUpperCase();
    a.download = `preventivo_${safeCode || safeName}_${state.quoteMeta.date}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
}

async function loadPdfLogo(){
  if (pdfLogoCache !== undefined) return pdfLogoCache;
  try {
    const response = await fetch('./logo.svg');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const svgText = await response.text();
    const viewBoxMatch = svgText.match(/viewBox\s*=\s*"([^"]+)"/i);
    let boxWidth = 0;
    let boxHeight = 0;
    if (viewBoxMatch){
      const parts = viewBoxMatch[1].trim().split(/[\s,]+/).map(Number).filter(n=>!Number.isNaN(n));
      if (parts.length === 4){
        boxWidth = parts[2];
        boxHeight = parts[3];
      }
    }
    if (!boxWidth || !boxHeight){
      boxWidth = 160;
      boxHeight = 40;
    }
    const svgBytes = new TextEncoder().encode(svgText);
    let binary = '';
    svgBytes.forEach(b => { binary += String.fromCharCode(b); });
    const dataUrl = 'data:image/svg+xml;base64,' + window.btoa(binary);
    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = dataUrl;
    });
    const scale = 4;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round((boxWidth || image.width || 1) * scale));
    canvas.height = Math.max(1, Math.round((boxHeight || image.height || 1) * scale));
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const pngDataUrl = canvas.toDataURL('image/png');
    pdfLogoCache = { dataUrl: pngDataUrl, width: boxWidth, height: boxHeight };
  } catch (error) {
    console.error('[PDF] Impossibile caricare il logo:', error);
    pdfLogoCache = null;
  }
  return pdfLogoCache;
}

async function exportPdf(){
  if (!validateQuoteMeta()) return;
  if (!window.jspdf) { alert('Libreria PDF non caricata.'); return; }
  const { jsPDF } = window.jspdf;

  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 40;
  const marginY = 36;
  const tableWidth = pageWidth - (marginX * 2);
  let y = marginY;

  const logo = await loadPdfLogo();
  if (logo?.dataUrl){
    const maxLogoWidth = Math.min(140, tableWidth);
    const ratio = logo.width && logo.height ? (logo.width / logo.height) : 0;
    const drawHeight = ratio ? (maxLogoWidth / ratio) : 28;
    doc.addImage(logo.dataUrl, 'PNG', marginX, y, maxLogoWidth, drawHeight);
    y += drawHeight + 32;
  }

  const quoteCode = getQuoteCode();
  const metaEntries = getQuoteMetaEntries();

  doc.setFont('helvetica','bold');
  doc.setFontSize(16);
  const headingText = quoteCode ? `Preventivo ${quoteCode}` : 'Preventivo';
  doc.text(headingText, marginX, y);
  y += 14;

  doc.setFont('helvetica','normal');
  doc.setFontSize(11);
  metaEntries.forEach((entry, index) => {
    const value = String(entry.value || '—');
    doc.text(`${entry.label}: ${value}`, marginX, y);
    y += (index === metaEntries.length - 1) ? 20 : 12;
  });
  if (!metaEntries.length) {
    y += 20;
  }

  const head = [['Codice','Descrizione','Prezzo','CONAI/collo','Q.tà','Sconto %','Prezzo scont.','Totale riga']];
  const body = [];
  const rawDescriptions = [];
  let total = 0;
  for (const it of state.selected.values()){
    const { prezzoScont, totale } = lineCalc(it);
    total += totale;
    rawDescriptions.push(it.descrizione || '');
    body.push([
      it.codice,
      it.descrizione || '',
      fmtEUR(it.prezzo),
      fmtEUR(it.conai||0),
      String(it.qty),
      String(it.sconto),
      fmtEUR(prezzoScont),
      fmtEUR(totale),
    ]);
  }

  const baseStyles = {
    fontSize: 8.5,
    textColor: 30,
    lineColor: [226,232,240],
    cellPadding: { top: 4, right: 5, bottom: 4, left: 5 },
    valign: 'middle',
    overflow: 'visible',
  };

  const paddingX = (() => {
    const padding = baseStyles.cellPadding;
    if (typeof padding === 'number') return padding * 2;
    return (padding.left ?? 0) + (padding.right ?? 0);
  })();

  const defaultMinWidths = [70, 160, 70, 75, 45, 60, 75, 80];
  const measuredWidths = new Array(head[0].length).fill(0);
  const rowsForMeasure = [head[0], ...body];
  rowsForMeasure.forEach((row, rowIndex) => {
    const isHeader = rowIndex === 0;
    doc.setFont('helvetica', isHeader ? 'bold' : 'normal');
    doc.setFontSize(isHeader ? 9.5 : baseStyles.fontSize);
    row.forEach((cellText, columnIndex) => {
      const raw = Array.isArray(cellText) ? cellText.join(' ') : String(cellText ?? '');
      const width = doc.getTextWidth(raw) + paddingX;
      measuredWidths[columnIndex] = Math.max(measuredWidths[columnIndex], width);
    });
  });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(baseStyles.fontSize);

  const minWidths = measuredWidths.map((width, index) => Math.max(width || 0, defaultMinWidths[index]));
  const descIndex = 1;
  const otherColumnsTotal = minWidths.reduce((sum, width, index) => index === descIndex ? sum : sum + width, 0);
  const availableForDescription = Math.max(defaultMinWidths[descIndex], tableWidth - otherColumnsTotal);
  minWidths[descIndex] = Math.max(minWidths[descIndex], availableForDescription);

  const columnStyles = {
    0: { halign: 'left', cellWidth: 'auto', minCellWidth: minWidths[0], overflow: 'visible' },
    1: { halign: 'left', cellWidth: 'auto', minCellWidth: minWidths[1], maxCellWidth: Math.max(minWidths[1], availableForDescription), overflow: 'linebreak' },
    2: { halign: 'right', cellWidth: 'auto', minCellWidth: minWidths[2], overflow: 'visible' },
    3: { halign: 'right', cellWidth: 'auto', minCellWidth: minWidths[3], overflow: 'visible' },
    4: { halign: 'center', cellWidth: 'auto', minCellWidth: minWidths[4], overflow: 'visible' },
    5: { halign: 'center', cellWidth: 'auto', minCellWidth: minWidths[5], overflow: 'visible' },
    6: { halign: 'right', cellWidth: 'auto', minCellWidth: minWidths[6], overflow: 'visible' },
    7: { halign: 'right', cellWidth: 'auto', minCellWidth: minWidths[7], overflow: 'visible' },
  };

  if (doc.autoTable){
    doc.autoTable({
      head,
      body,
      startY: y,
      margin: { left: marginX, right: marginX },
      styles: baseStyles,
      headStyles: { ...baseStyles, fontStyle: 'bold', fontSize: 9.5, fillColor: [241,245,249] },
      columnStyles,
      tableWidth: 'auto',
      theme: 'grid',
      didParseCell: (data) => {
        const { cell, section } = data;
        if (!cell || (section !== 'head' && section !== 'body')) return;
        const styles = cell.styles || {};
        const rawText = Array.isArray(cell.text) ? cell.text.join(' ') : String(cell.text ?? '');
        if (!rawText) return;
        let paddingX = 0;
        const padding = styles.cellPadding;
        if (typeof padding === 'number'){
          paddingX = padding * 2;
        } else if (padding){
          paddingX = (padding.left ?? 0) + (padding.right ?? 0);
        }
        const available = cell.width - paddingX;
        if (available <= 0) return;
        const originalSize = doc.getFontSize();
        let fontSize = styles.fontSize || baseStyles.fontSize;
        if (data.column.index === 1){
          styles.overflow = 'linebreak';
          if (section === 'body'){
            const fullDescription = rawDescriptions[data.row.index] ?? rawText;
            let lines = [];
            if (available > 0){
              doc.setFontSize(fontSize);
              lines = doc.splitTextToSize(fullDescription, available);
              while (lines.length > 2 && fontSize > 4){
                fontSize -= 0.25;
                doc.setFontSize(fontSize);
                lines = doc.splitTextToSize(fullDescription, available);
              }
              if (lines.length > 2){
                const trimmed = lines.slice(0, 2);
                const last = trimmed[trimmed.length - 1] || '';
                trimmed[trimmed.length - 1] = last.endsWith('…') ? last : `${last.replace(/\s+$/,'')}…`;
                lines = trimmed;
              }
            }
            if (fontSize < 4) fontSize = 4;
            if (lines.length){
              cell.text = lines;
            }
            cell.styles.fontSize = fontSize;
          }
          doc.setFontSize(originalSize);
          return;
        }
        let measured = Infinity;
        while (fontSize > 6){
          doc.setFontSize(fontSize);
          measured = doc.getTextWidth(rawText);
          if (measured <= available) break;
          fontSize -= 0.5;
        }
        if (fontSize < 6) fontSize = 6;
        doc.setFontSize(fontSize);
        const finalWidth = doc.getTextWidth(rawText);
        if (finalWidth > available && finalWidth > 0){
          const ratioFit = available / finalWidth;
          const adjusted = Math.max(6, Math.floor(fontSize * ratioFit));
          if (adjusted < fontSize){
            fontSize = adjusted;
            doc.setFontSize(fontSize);
          }
        }
        doc.setFontSize(originalSize);
        cell.styles.fontSize = fontSize;
      },
    });
    const endY = doc.lastAutoTable.finalY || y;
    doc.setFont('helvetica','bold');
    doc.setFontSize(11);
    const vat = Math.round(total * 22) / 100;
    const gross = Math.round((total + vat) * 100) / 100;
    let totalsY = endY + 20;
    const requiredBlockHeight = (16 * 3) + 32; // tre righe totali + respiro + footer
    if ((pageHeight - marginY - totalsY) < requiredBlockHeight) {
      doc.addPage();
      let headerY = marginY;
      if (logo?.dataUrl){
        const maxLogoWidth = Math.min(140, tableWidth);
        const ratio = logo.width && logo.height ? (logo.width / logo.height) : 0;
        const drawHeight = ratio ? (maxLogoWidth / ratio) : 28;
        doc.addImage(logo.dataUrl, 'PNG', marginX, headerY, maxLogoWidth, drawHeight);
        headerY += drawHeight + 32;
      }
      doc.setFont('helvetica','bold');
      doc.setFontSize(16);
      doc.text(headingText, marginX, headerY);
      headerY += 14;
      doc.setFont('helvetica','normal');
      doc.setFontSize(11);
      metaEntries.forEach((entry) => {
        const value = String(entry.value || '—');
        doc.text(`${entry.label}: ${value}`, marginX, headerY);
        headerY += 12;
      });
      totalsY = headerY + 8;
    }
    doc.text(`Totale imponibile: ${fmtEUR(total)}`, marginX + tableWidth, totalsY, { align: 'right' });
    totalsY += 16;
    doc.text(`Totale IVA 22%: ${fmtEUR(vat)}`, marginX + tableWidth, totalsY, { align: 'right' });
    totalsY += 16;
    doc.text(`Totale importo: ${fmtEUR(gross)}`, marginX + tableWidth, totalsY, { align: 'right' });

    const footerLines = [
      'Per informazioni tecniche o commerciali:',
      `Agente di riferimento: ${state.agent.name || state.agent.code || '—'}`,
    ];
    doc.setFont('helvetica','normal');
    doc.setFontSize(10);
    const footerBaseY = Math.max(totalsY + 28, doc.internal.pageSize.getHeight() - marginY - ((footerLines.length - 1) * 12));
    footerLines.forEach((line, idx) => {
      doc.text(line, marginX + tableWidth, footerBaseY + (idx * 12), { align: 'right' });
    });
  } else {
    doc.text('Errore: jsPDF-Autotable non presente.', marginX, y + 20);
  }

  const safeName = (state.quoteMeta.name || 'cliente').replace(/[^\w\- ]+/g,'_').trim().replace(/\s+/g,'_');
  const safeCode = quoteCode.replace(/[^A-Z0-9]/gi, '').toUpperCase();
  doc.save(`preventivo_${safeCode || safeName}_${state.quoteMeta.date}.pdf`);
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
  const quoteCode = getQuoteCode();
  const metaEntries = getQuoteMetaEntries();
  const metaHtml = metaEntries.length
    ? metaEntries
        .map(entry => `${escapeHtml(entry.label)}: <strong>${escapeHtml(String(entry.value || '—'))}</strong>`)
        .join('<br>')
    : '<span>—</span>';

  win.document.write(`
<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Preventivo ${safeName}</title>
  <style>
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color:#0f172a; margin:24px; }
    h1 { font-size:20px; margin:0 0 8px 0; }
    h1 span.code { display:inline-block; margin-left:8px; padding:2px 6px; background:#e2e8f0; border-radius:6px; font-size:12px; letter-spacing:0.08em; text-transform:uppercase; }
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
  <h1>Preventivo${quoteCode ? `<span class="code">${escapeHtml(quoteCode)}</span>` : ''}</h1>
  <div class="meta">${metaHtml}</div>
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
  const appShell = $('appShell');
  const authGate = $('authGate');
  const appVisible = !!(appShell && !appShell.classList.contains('hidden'));
  const gateHidden = !authGate || authGate.classList.contains('hidden');

  if (!appVisible || !gateHidden) return;

  e.preventDefault();

  const imgModal = $('imgModal');
  if (imgModal && !imgModal.classList.contains('hidden')) {
    toggleModal('imgModal', false);
  }

  if (quoteDrawer?.isOpen?.()) {
    quoteDrawer.close();
  }

  try {
    await doLogout({ reason: 'escape', hard: true, reload: true });
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

  return {
    updateCount,
    syncVisibility,
    close: closeDrawer,
    isOpen: () => isOpen
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


