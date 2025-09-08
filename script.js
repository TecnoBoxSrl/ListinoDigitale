/* ================================
   Listino Digitale – script.js (v20)
   - Fix: un solo DOMContentLoaded
   - Fix: un solo flusso di redirect (hash #access_token e ?code)
   - Niente onclick inline: tutti gli handler sono qui
================================ */

/* ==== CONFIG ==== */
const SUPABASE_URL = 'https://wajzudbaezbyterpjdxg.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indhanp1ZGJhZXpieXRlcnBqZHhnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcxODA4MTUsImV4cCI6MjA3Mjc1NjgxNX0.MxaAqdUrppG2lObO_L5-SgDu8D7eze7mBf6S9rR_Q2w';
const SITE_URL = 'https://tecnoboxsrl.github.io/ListinoDigitale/';
const STORAGE_BUCKET = 'prodotti';

/* ==== Supabase ==== */
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ==== Helpers ==== */
const $ = (id) => document.getElementById(id);
const on = (el, ev, fn) => { if (el) el.addEventListener(ev, fn, { passive:true }); };
const debounce = (fn, ms=120) => { let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); }; };
const normalizeQuery = (s)=> (s||'').toString().normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().trim();
const toggleModal = (id, show=true)=>{ const el=$(id); if(!el) return; el.classList.toggle('hidden', !show); document.body.classList.toggle('modal-open', show); };
const parseItNumber = (v)=>{ if(v==null) return null; if(typeof v==='number') return v; const n=parseFloat(String(v).trim().replace(/\./g,'').replace(',','.')); return isNaN(n)?null:n; };
const formatPriceEUR = (n)=> (n==null||isNaN(n)) ? '—' : n.toLocaleString('it-IT',{style:'currency',currency:'EUR'});

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
};

/* ==== Boot unico ==== */
document.addEventListener('DOMContentLoaded', async () => {
  if ($('year')) $('year').textContent = new Date().getFullYear();
  setupUI();

  // gestisci ritorno dal magic link (hash o ?code)
  await handleAuthRedirect();

  await restoreSession();
  await renderAuthState();
  if (state.role !== 'guest') await fetchProducts();
  renderView();
});

/* ==== Redirect handler (unico) ==== */
async function handleAuthRedirect(){
  try {
    const url = new URL(window.location.href);

    // errori nell’hash (es. otp_expired)
    if (location.hash && location.hash.includes('error=')) {
      const h = new URLSearchParams(location.hash.slice(1));
      const desc = h.get('error_description') || h.get('error') || 'Errore di accesso';
      console.warn('[Auth] redirect error:', desc);
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
        else console.log('[Auth] sessione impostata da hash');
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

  // invio magic link (QUI: un solo handler → una sola mail)
  on($('loginSend'), 'click', sendMagicLink);

  // vista
  on($('viewListino'), 'click', ()=>{ state.view='listino'; renderView(); });
  on($('viewCard'),   'click', ()=>{ state.view='card';    renderView(); });

  // espongo setView per eventuali onclick rimasti
  window.setView = (v)=>{ state.view=v; renderView(); };
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
      let img='';
      const imgs=(p.product_media||[]).filter(m=>m.kind==='image').sort((a,b)=>(a.sort??0)-(b.sort??0));
      if (imgs[0]) {
        const { data:signed } = await supabase.storage.from(STORAGE_BUCKET).createSignedUrl(imgs[0].path, 600);
        img = signed?.signedUrl || '';
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
}

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
        <td class="border px-2 py-1 whitespace-nowrap font-mono">${p.codice||''}</td>
        <td class="border px-2 py-1">${p.descrizione||''} ${p.novita?'<span class="ml-2 text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-[2px]">Novità</span>':''}</td>
        <td class="border px-2 py-1">${p.pack||''}</td>
        <td class="border px-2 py-1 text-right">${formatPriceEUR(p.prezzo)}</td>
        <td class="border px-2 py-1 text-center">${p.img?`<button class="text-sky-600 underline" data-src="${p.img}" data-title="${encodeURIComponent(p.descrizione||'')}">📷</button>`:'—'}</td>`;
      tb.appendChild(tr);
    }
    c.appendChild(t);
  }
  c.querySelectorAll('button[data-src]').forEach(b=>{
    b.addEventListener('click', (e)=>{
      const src=e.currentTarget.getAttribute('data-src');
      const title=decodeURIComponent(e.currentTarget.getAttribute('data-title')||'');
      const img=$('imgPreview'), ttl=$('imgTitle');
      if(img){ img.src=src; img.alt=title; }
      if(ttl){ ttl.textContent=title; }
      toggleModal('imgModal', true);
    });
  });
}

function renderCards(){
  const g=$('productGrid'); if(!g) return; g.innerHTML='';
  const arr=filterAndSort(state.items);
  if(!arr.length){ g.innerHTML='<div class="col-span-full text-center text-slate-500 py-10">Nessun articolo trovato.</div>'; return; }
  for(const p of arr){
    const card=document.createElement('article'); card.className='card rounded-2xl bg-white border shadow-sm overflow-hidden';
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
      toggleModal('imgModal', true);
    });
    g.appendChild(card);
  }
}
