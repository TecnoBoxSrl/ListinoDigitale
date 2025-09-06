
// === INSERISCI QUI I TUOI VALORI REALI ===
const SUPABASE_URL = 'https://wajzudbaezbyterpjdxg.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indhanp1ZGJhZXpieXRlcnBqZHhnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcxODA4MTUsImV4cCI6MjA3Mjc1NjgxNX0.MxaAqdUrppG2lObO_L5-SgDu8D7eze7mBf6S9rR_Q2w';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Helper: safe getElementById
const $ = (id) => document.getElementById(id);

// Stato globale
const state = {
  items: [],
  categories: [],
  selectedCategory: 'Tutte',
  search: '',
  sort: 'alpha',
  onlyAvailable: false,
  onlyNew: false,
  priceMax: null,
  role: 'guest'
};

// Utility numeri IT
const parseItNumber = (v) => {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  const s = String(v).trim().replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
};
const formatPriceEUR = (n) =>
  n == null || isNaN(n) ? '—' : n.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' });

console.log('[Listino] script.js caricato');

document.addEventListener('DOMContentLoaded', async () => {
  try {
    console.log('[Listino] DOM pronto');
    if ($('year')) $('year').textContent = new Date().getFullYear();
    setupUI();
    await restoreSession();
    await renderAuthState();
    if (state.role !== 'guest') {
      await fetchProducts();
      applyFilters();
    }
  } catch (e) {
    console.error('[Listino] Errore init:', e);
  }
});

function on(el, ev, fn) {
  if (el) el.addEventListener(ev, fn);
}

// ===== UI =====
function setupUI() {
  on($('btnLogin'), 'click', () => toggleModal('loginModal', true));
  on($('btnLogout'), 'click', signOut);
  on($('btnMobileMenu'), 'click', () => {
    const m = $('mobileMenu');
    if (m) m.hidden = !m.hidden;
  });
  on($('btnLoginM'), 'click', () => toggleModal('loginModal', true));
  on($('btnLogoutM'), 'click', signOut);
  on($('loginClose'), 'click', () => toggleModal('loginModal', false));
  on($('loginSend'), 'click', sendMagicLink);

  // Filtri
  on($('searchInput'), 'input', (e) => { state.search = e.target.value; applyFilters(); });
  on($('sortSelect'), 'change', (e) => { state.sort = e.target.value; applyFilters(); });
  on($('filterDisponibile'), 'change', (e) => { state.onlyAvailable = e.target.checked; applyFilters(); });
  on($('filterNovita'), 'change', (e) => { state.onlyNew = e.target.checked; applyFilters(); });
  on($('filterPriceMax'), 'input', (e) => { state.priceMax = parseItNumber(e.target.value); applyFilters(); });

  // Admin
  on($('btnPublish'), 'click', () => {
    if (state.role !== 'admin') return alert('Solo admin');
    alert('Hook pubblicazione pronto: collega Edge Function publish_price_list.');
  });

  console.log('[Listino] UI pronta');
}

function toggleModal(id, show = true) {
  const el = $(id);
  if (!el) return;
  if (show) {
    el.classList.remove('hidden');
    document.body.classList.add('modal-open');
  } else {
    el.classList.add('hidden');
    document.body.classList.remove('modal-open');
  }
}

// ===== AUTH =====
async function restoreSession() {
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user) {
    const { data: prof } = await supabase.from('profiles').select('role').eq('id', session.user.id).single();
    state.role = (prof?.role === 'admin') ? 'admin' : 'agent';
  } else {
    state.role = 'guest';
  }
  supabase.auth.onAuthStateChange(async (_e, sess) => {
    if (sess?.user) {
      const { data: prof } = await supabase.from('profiles').select('role').eq('id', sess.user.id).single();
      state.role = (prof?.role === 'admin') ? 'admin' : 'agent';
      await renderAuthState();
      await fetchProducts();
      applyFilters();
    }
  });
}

async function renderAuthState() {
  const logged = state.role !== 'guest';
  if ($('btnLogin')) $('btnLogin').classList.toggle('hidden', logged);
  if ($('btnLogout')) $('btnLogout').classList.toggle('hidden', !logged);
  if ($('adminBox')) $('adminBox').hidden = (state.role !== 'admin');
  if ($('resultInfo')) $('resultInfo').textContent = logged ? 'Caricamento listino…' : 'Accedi per visualizzare il listino.';
  if (logged) toggleModal('loginModal', false);
}

async function sendMagicLink() {
  try {
    const email = $('loginEmail')?.value?.trim();
    if (!email) return;
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.href }
    });
    if ($('loginMsg')) $('loginMsg').textContent = error ? ('Errore: ' + error.message) : 'Email inviata. Controlla la casella e apri il link di accesso.';
  } catch (e) {
    console.error('[Listino] sendMagicLink error', e);
  }
}

async function signOut() {
  await supabase.auth.signOut();
  state.role = 'guest';
  state.items = [];
  applyFilters();
  await renderAuthState();
}

// ===== DATA =====
async function fetchProducts() {
  try {
    const { data, error } = await supabase
      .from('products')
      .select('id,codice,descrizione,categoria,sottocategoria,prezzo,unita,disponibile,novita,pack,pallet,tags,updated_at, product_media(id,kind,path,sort)')
      .order('descrizione', { ascending: true });
    if (error) throw error;

    const items = [];
    for (const p of (data || [])) {
      const media = p.product_media || [];
      const images = [];
      for (const m of media.filter(x => x.kind === 'image').sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))) {
        const { data: blobData } = await supabase.storage.from('media').download(m.path);
        if (blobData) images.push(URL.createObjectURL(blobData));
      }
      let videoUrl = null;
      const video = media.find(x => x.kind === 'video')?.path || null;
      if (video) {
        const { data: vBlob } = await supabase.storage.from('media').download(video);
        if (vBlob) videoUrl = URL.createObjectURL(vBlob);
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
        img: images[0] || '',
        img2: images[1] || '',
        img3: images[2] || '',
        video: videoUrl,
        updated_at: p.updated_at
      });
    }
    state.items = items;
    buildCategories();
    applyFilters();
    if ($('resultInfo')) $('resultInfo').textContent = `${items.length} articoli`;
  } catch (e) {
    console.error('[Listino] fetchProducts error', e);
    if ($('resultInfo')) $('resultInfo').textContent = 'Errore caricamento listino';
  }
}

function buildCategories() {
  const set = new Set(state.items.map(p => p.categoria || 'Senza categoria'));
  state.categories = ['Tutte', ...Array.from(set).sort((a, b) => a.localeCompare(b, 'it'))];
  const box = $('categoryList');
  if (!box) return;
  box.innerHTML = '';
  state.categories.forEach(cat => {
    const b = document.createElement('button');
    b.className = 'tag hover:bg-slate-100';
    b.textContent = cat;
    b.addEventListener('click', () => { state.selectedCategory = cat; applyFilters(); });
    box.appendChild(b);
  });
}

function applyFilters() {
  const grid = $('productGrid');
  if (!grid) return;
  grid.innerHTML = '';
  let arr = [...state.items];
  if (state.selectedCategory !== 'Tutte') arr = arr.filter(p => p.categoria === state.selectedCategory);
  if (state.search) {
    const q = state.search.toLowerCase();
    arr = arr.filter(p => (p.codice + ' ' + p.descrizione + ' ' + (p.tags || []).join(' ')).toLowerCase().includes(q));
  }
  if (state.onlyAvailable) arr = arr.filter(p => p.disponibile);
  if (state.onlyNew) arr = arr.filter(p => p.novita);
  if (state.priceMax != null) arr = arr.filter(p => p.prezzo != null && p.prezzo <= state.priceMax);
  switch (state.sort) {
    case 'priceAsc': arr.sort((a, b) => (a.prezzo ?? Infinity) - (b.prezzo ?? Infinity)); break;
    case 'priceDesc': arr.sort((a, b) => (b.prezzo ?? -Infinity) - (a.prezzo ?? -Infinity)); break;
    case 'newest': arr.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || '')); break;
    default: arr.sort((a, b) => a.descrizione.localeCompare(b.descrizione, 'it')); break;
  }
  if (!arr.length) {
    grid.innerHTML = '<div class="col-span-full text-center text-slate-500 py-10">Nessun articolo trovato.</div>';
    return;
  }
  for (const p of arr) {
    const card = document.createElement('article');
    card.className = 'card rounded-2xl bg-white border shadow-sm overflow-hidden';
    card.innerHTML = `
      <div class="aspect-square bg-slate-100 grid place-content-center">
        ${p.img ? `<img src="${p.img}" alt="${p.descrizione}" class="w-full h-full object-contain">` : `<div class="text-slate-400">Nessuna immagine</div>`}
      </div>
      <div class="p-3 space-y-2">
        <div class="flex items-start justify-between gap-2">
          <h3 class="font-medium leading-snug line-clamp-2">${p.descrizione}</h3>
          ${p.novita ? '<span class="tag bg-emerald-50 text-emerald-700 border-emerald-200">Novità</span>' : ''}
        </div>
        <p class="text-xs text-slate-500">${p.codice}</p>
        <div class="flex items-center justify-between">
          <div class="text-lg font-semibold">${formatPriceEUR(p.prezzo)}</div>
          <button class="rounded-xl border px-3 py-1.5 text-sm hover:bg-slate-50">Vedi</button>
        </div>
        <div class="flex gap-1 flex-wrap">${(p.tags || []).map(t => `<span class="tag">${t}</span>`).join('')}</div>
      </div>`;
    card.querySelector('button').addEventListener('click', () => alert(p.descrizione + "\\nPrezzo: " + formatPriceEUR(p.prezzo)));
    grid.appendChild(card);
  }
}
