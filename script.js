/* ================================
   Listino Digitale – script.js
   Login gate a pieno schermo (email+password)
   Supabase UMD (window.supabase)
=================================== */

/* ==== CONFIG ==== */
const SUPABASE_URL = 'https://wajzudbaezbyterpjdxg.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indhanp1ZGJhZXpieXRlcnBqZHhnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcxODA4MTUsImV4cCI6MjA3Mjc1NjgxNX0.MxaAqdUrppG2lObO_L5-SgDu8D7eze7mBf6S9rR_Q2w';
const SITE_URL = 'https://tecnoboxsrl.github.io/ListinoDigitale/'; // per reset password
const STORAGE_BUCKET = 'prodotti'; // o 'media'

/* ==== Supabase ==== */
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ==== Helpers & stato ==== */
const $ = (id) => document.getElementById(id);
function on(el, ev, fn){ if (el) el.addEventListener(ev, fn, { passive:true }); }
function debounce(fn, ms=120){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); }; }
function normalizeQuery(s){ return (s||'').toString().normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().trim(); }
const parseItNumber = (v)=>{ if(v==null) return null; if(typeof v==='number') return v; const n=parseFloat(String(v).trim().replace(/\./g,'').replace(',','.')); return isNaN(n)?null:n; };
const formatPriceEUR = (n)=> (n==null||isNaN(n)) ? '—' : n.toLocaleString('it-IT',{style:'currency',currency:'EUR'});

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
  view: 'listino'
};

/* ==== BOOT ==== */
document.addEventListener('DOMContentLoaded', async () => {
  if ($('year')) $('year').textContent = new Date().getFullYear();

  // UI base
  setupLoginGateUI();
  setupAppUI();

  // Restauriamo sessione (se l’utente aveva già fatto login)
  await restoreSession();
  await renderAuthState();

  // Se autenticato -> carica app
  if (state.role !== 'guest') {
    await loadAppDataAndShow();
  } else {
    showGate();
  }
});

/* ==== LOGIN GATE (email+password) ==== */
function setupLoginGateUI(){
  on($('btnDoLogin'), 'click', loginWithPassword);
  on($('btnSendReset'), 'click', sendResetPassword);
}

async function loginWithPassword(){
  const email = $('loginEmail')?.value?.trim();
  const pwd   = $('loginPassword')?.value?.trim();
  const msg   = $('loginMsg');
  if (!email || !pwd) { if (msg) msg.textContent = 'Inserisci email e password.'; return; }

  const { error } = await supabase.auth.signInWithPassword({ email, password: pwd });
  if (error) {
    if (msg) msg.textContent = 'Login non riuscito: ' + error.message;
    return;
  }
  // ok -> mostra app
  await restoreSession();
  await renderAuthState();
  await loadAppDataAndShow();
}

async function sendResetPassword(){
  const email = $('loginEmail')?.value?.trim();
  const msg = $('loginMsg');
  if (!email) { if (msg) msg.textContent = 'Inserisci la tua email.'; return; }
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: SITE_URL + 'index.html' });
  if (msg) msg.textContent = error ? ('Errore: ' + error.message) : 'Email inviata per reimpostare la password.';
}

function showGate(){
  $('authGate')?.classList.remove('hidden');
  $('appShell')?.classList.add('hidden');
}
function showApp(){
  $('authGate')?.classList.add('hidden');
  $('appShell')?.classList.remove('hidden');
}

/* ==== APP UI ==== */
function setupAppUI(){
  on($('btnLogout'), 'click', signOut);
  on($('btnLogoutM'), 'click', signOut);
  on($('btnMobileMenu'), 'click', ()=>{ const m=$('mobileMenu'); if(m) m.hidden=!m.hidden; });

  // switch vista
  on($('viewListino'), 'click', ()=>{ state.view='listino'; renderView(); });
  on($('viewCard'), 'click', ()=>{ state.view='card'; renderView(); });

  // ricerca live (desktop+mobile)
  const handleSearch = debounce((e)=> {
    state.search = normalizeQuery(e.target.value);
    renderView();
  }, 120);
  on($('searchInput'),'input',handleSearch);
  on($('searchInputM'),'input',handleSearch);

  // filtri
  on($('sortSelect'), 'change', (e)=>{ state.sort=e.target.value; renderView(); });
  on($('sortSelectM'),'change', (e)=>{ state.sort=e.target.value; renderView(); });
  on($('filterDisponibile'),'change',(e)=>{ state.onlyAvailable=e.target.checked; renderView(); });
  on($('filterNovita'),'change',(e)=>{ state.onlyNew=e.target.checked; renderView(); });
  on($('filterPriceMax'),'input',(e)=>{ state.priceMax=parseItNumber(e.target.value); renderView(); });

  // Modal immagine
  on($('imgClose'), 'click', ()=>toggleImgModal(false));
  on($('imgBackdrop'), 'click', ()=>toggleImgModal(false));
  document.addEventListener('keydown', (ev)=>{ if(ev.key==='Escape') toggleImgModal(false); });
}

function toggleImgModal(show){
  const m = $('imgModal'); if (!m) return;
  m.classList.toggle('hidden', !show);
  document.body.classList.toggle('modal-open', show);
}

/* ==== AUTH STATE ==== */
async function restoreSession(){
  const { data:{ session } } = await supabase.auth.getSession();
  if (session?.user) {
    // ruolo da profiles (se c’è), default agent
    const { data: prof } = await supabase.from('profiles').select('role').eq('id', session.user.id).maybeSingle();
    state.role = (prof?.role === 'admin') ? 'admin' : 'agent';
  } else {
    state.role = 'guest';
  }
  // event listener
  supabase.auth.onAuthStateChange(async (_e, sess)=>{
    if (sess?.user){
      const { data: prof } = await supabase.from('profiles').select('role').eq('id', sess.user.id).maybeSingle();
      state.role = (prof?.role === 'admin') ? 'admin' : 'agent';
      await renderAuthState();
      await loadAppDataAndShow();
    } else {
      state.role = 'guest';
      await renderAuthState();
      showGate();
    }
  });
}

async function renderAuthState(){
  const logged = state.role !== 'guest';
  if ($('adminBox')) $('adminBox').hidden = (state.role!=='admin');
  if ($('resultInfo')) $('resultInfo').textContent = logged ? 'Caricamento listino…' : 'Accedi per visualizzare il listino.';
}

async function signOut(){
  await supabase.auth.signOut();
  state.role='guest';
  state.items=[];
  showGate();
}

/* ==== DATA & RENDER ==== */
async function loadAppDataAndShow(){
  await fetchProducts();
  buildCategories();
  renderView();
  showApp();
}

async function fetchProducts(){
  try{
    const { data, error } = await supabase
      .from('products')
      .select('id,codice,descrizione,categoria,sottocategoria,prezzo,unita,disponibile,novita,pack,pallet,tags,updated_at, product_media(id,kind,path,sort)')
      .order('descrizione', { ascending: true });
    if (error) throw error;

    const items=[];
    for (const p of (data||[])){
      let imgUrl='';
      const mediaImgs = (p.product_media||[]).filter(m=>m.kind==='image').sort((a,b)=>(a.sort??0)-(b.sort??0));
      if (mediaImgs[0]) {
        const { data: signed } = await supabase.storage.from(STORAGE_BUCKET).createSignedUrl(mediaImgs[0].path, 600);
        imgUrl = signed?.signedUrl || '';
      }
      items.push({
        codice: p.codice, descrizione: p.descrizione, categoria: p.categoria, sottocategoria: p.sottocategoria,
        prezzo: p.prezzo, unita: p.unita, disponibile: p.disponibile, novita: p.novita, pack: p.pack, pallet: p.pallet,
        tags: p.tags || [], updated_at: p.updated_at, img: imgUrl
      });
    }
    state.items = items;
    if ($('resultInfo')) $('resultInfo').textContent = `${items.length} articoli`;
  } catch(e){
    console.error('[Listino] fetchProducts error', e);
    if ($('resultInfo')) $('resultInfo').textContent = 'Errore caricamento listino';
  }
}

function buildCategories(){
  const set = new Set(state.items.map(p=>p.categoria||'Altro'));
  state.categories = ['Tutte', ...Array.from(set).sort((a,b)=>a.localeCompare(b,'it'))];
  const box = $('categoryList'); if(!box) return;
  box.innerHTML='';
  state.categories.forEach(cat=>{
    const b=document.createElement('button');
    b.className='tag hover:bg-slate-100';
    b.textContent=cat;
    b.addEventListener('click',()=>{ state.selectedCategory=cat; renderView(); });
    box.appendChild(b);
  });
}

function renderView(){
  const grid=$('productGrid'), listino=$('listinoContainer');
  if (!grid || !listino) return;

  // quale vista?
  if (state.view==='listino'){
    grid.classList.add('hidden');
    listino.classList.remove('hidden');
    renderListinoByCategory();
  } else {
    listino.classList.add('hidden');
    grid.classList.remove('hidden');
    renderCards();
  }
}

function filterAndSort(arr){
  let out=[...arr];
  if (state.selectedCategory!=='Tutte')
    out=out.filter(p=>(p.categoria||'Altro')===state.selectedCategory);

  if (state.search){
    const q=state.search;
    out=out.filter(p=>{
      const hay = normalizeQuery((p.codice||'')+' '+(p.descrizione||'')+' '+(p.tags||[]).join(' '));
      return hay.includes(q);
    });
  }
  if (state.onlyAvailable) out=out.filter(p=>p.disponibile);
  if (state.onlyNew) out=out.filter(p=>p.novita);
  if (state.priceMax!=null) out=out.filter(p=>p.prezzo!=null && p.prezzo<=state.priceMax);

  switch(state.sort){
    case 'priceAsc': out.sort((a,b)=>(a.prezzo??Infinity)-(b.prezzo??Infinity)); break;
    case 'priceDesc': out.sort((a,b)=>(b.prezzo??-Infinity)-(a.prezzo??-Infinity)); break;
    case 'newest': out.sort((a,b)=>(b.updated_at||'').localeCompare(a.updated_at||'')); break;
    default: out.sort((a,b)=>(a.descrizione||'').localeCompare(b.descrizione||'','it')); break;
  }
  return out;
}

/* ==== Vista: LISTINO ==== */
function renderListinoByCategory(){
  const container=$('listinoContainer'); if(!container) return;
  container.innerHTML='';
  const arr=filterAndSort(state.items);

  const byCat=new Map();
  for(const p of arr){ const c=p.categoria||'Altro'; if(!byCat.has(c)) byCat.set(c,[]); byCat.get(c).push(p); }
  const cats=[...byCat.keys()].sort((a,b)=>a.localeCompare(b,'it'));
  if(!cats.length){ container.innerHTML='<div class="text-center text-slate-500 py-10">Nessun articolo trovato.</div>'; return; }

  for(const cat of cats){
    const items=byCat.get(cat).sort((a,b)=>(a.codice||'').localeCompare(b.codice||'','it'));
    const h=document.createElement('h2'); h.className='text-lg font-semibold mt-2 mb-1'; h.textContent=cat; container.appendChild(h);
    const table=document.createElement('table'); table.className='w-full text-sm border-collapse';
    table.innerHTML=`
      <thead class="bg-slate-100">
        <tr>
          <th class="border px-2 py-1 text-left">Codice</th>
          <th class="border px-2 py-1 text-left">Descrizione</th>
          <th class="border px-2 py-1 text-left">Confezione</th>
          <th class="border px-2 py-1 text-right">Prezzo</th>
          <th class="border px-2 py-1 text-center">Img</th>
        </tr>
      </thead>
      <tbody></tbody>`;
    const tb=table.querySelector('tbody');

    for(const p of items){
      const tr=document.createElement('tr');
      tr.innerHTML=`
        <td class="border px-2 py-1 whitespace-nowrap font-mono">${p.codice||''}</td>
        <td class="border px-2 py-1">${p.descrizione||''} ${p.novita?'<span class="ml-2 text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-[2px]">Novità</span>':''}</td>
        <td class="border px-2 py-1">${p.pack||''}</td>
        <td class="border px-2 py-1 text-right">${formatPriceEUR(p.prezzo)}</td>
        <td class="border px-2 py-1 text-center">${p.img?`<button class="text-sky-600 underline" data-src="${p.img}" data-title="${encodeURIComponent(p.descrizione||'')}">📷</button>`:'—'}</td>`;
      tb.appendChild(tr);
    }
    container.appendChild(table);
  }

  // bind anteprima immagine
  container.querySelectorAll('button[data-src]').forEach(btn=>{
    btn.addEventListener('click', (e)=>{
      const src=e.currentTarget.getAttribute('data-src');
      const title=decodeURIComponent(e.currentTarget.getAttribute('data-title')||'');
      const img=$('imgPreview'), ttl=$('imgTitle');
      if(img){ img.src=src; img.alt=title; }
      if(ttl){ ttl.textContent=title; }
      toggleImgModal(true);
    });
  });
}

/* ==== Vista: CARD ==== */
function renderCards(){
  const grid=$('productGrid'); if(!grid) return; grid.innerHTML='';
  const arr=filterAndSort(state.items);
  if(!arr.length){ grid.innerHTML='<div class="col-span-full text-center text-slate-500 py-10">Nessun articolo trovato.</div>'; return; }

  for(const p of arr){
    const card=document.createElement('article');
    card.className='card rounded-2xl bg-white border shadow-sm overflow-hidden';
    card.innerHTML=`
      <div class="aspect-square bg-slate-100 grid place-content-center">
        ${p.img?`<img src="${p.img}" alt="${p.descrizione||''}" class="w-full h-full object-contain" loading="lazy" decoding="async">`:`<div class="text-slate-400">Nessuna immagine</div>`}
      </div>
      <div class="p-3 space-y-2">
        <div class="flex items-start justify-between gap-2">
          <h3 class="font-medium leading-snug line-clamp-2">${p.descrizione||''}</h3>
          ${p.novita?'<span class="tag bg-emerald-50 text-emerald-700 border-emerald-200">Novità</span>':''}
        </div>
        <p class="text-xs text-slate-500">${p.codice||''}</p>
        <div class="flex items-center justify-between">
          <div class="text-lg font-semibold">${formatPriceEUR(p.prezzo)}</div>
          <button class="rounded-xl border px-3 py-1.5 text-sm hover:bg-slate-50">Vedi</button>
        </div>
        <div class="flex gap-1 flex-wrap">${(p.tags||[]).map(t=>`<span class="tag">${t}</span>`).join('')}</div>
      </div>`;
    card.querySelector('button').addEventListener('click', ()=>{
      if(!p.img) return;
      const img=$('imgPreview'), ttl=$('imgTitle');
      if(img){ img.src=p.img; img.alt=p.descrizione||''; }
      if(ttl){ ttl.textContent=p.descrizione||''; }
      toggleImgModal(true);
    });
    grid.appendChild(card);
  }
}
