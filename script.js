
// ===============================================
// CONFIGURAZIONE
// 1) Inserisci URL e ANON KEY del TUO progetto Supabase
// 2) Imposta il nome del bucket storage con le immagini (es. 'prodotti' o 'media')
// 3) Imposta l'URL del sito per il redirect del magic link
// ===============================================
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://TUO-PROJECT-ID.supabase.co';          // <-- METTI IL TUO
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indhanp1ZGJhZXpieXRlcnBqZHhnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcxODA4MTUsImV4cCI6MjA3Mjc1NjgxNX0.MxaAqdUrppG2lObO_L5-SgDu8D7eze7mBf6S9rR_Q2w';                         // <-- METTI LA TUA
const SITE_URL = 'https://tecnoboxsrl.github.io/ListinoDigitale/';   // tuo dominio Pages
const STORAGE_BUCKET = 'prodotti'; // se usi 'media', cambia qui

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);


// ===============================================
// UTILITY & STATO
// ===============================================
const $ = (id) => document.getElementById(id);

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
  view: 'listino', // 'listino' | 'card'
};

const parseItNumber = (v) => {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  const s = String(v).trim().replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
};
const formatPriceEUR = (n) => (n == null || isNaN(n))
  ? '—'
  : n.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' });

function on(el, ev, fn){ if (el) el.addEventListener(ev, fn); }
function toggleModal(id, show=true){
  const el = $(id);
  if (!el) return;
  if (show){ el.classList.remove('hidden'); document.body.classList.add('modal-open'); }
  else { el.classList.add('hidden'); document.body.classList.remove('modal-open'); }
}

// ===============================================
// BOOT
// ===============================================
document.addEventListener('DOMContentLoaded', async () => {
  $('year') && ($('year').textContent = new Date().getFullYear());
  setupUI();
  await restoreSession();
  await renderAuthState();
  if (state.role !== 'guest') {
    await fetchProducts();
    renderView();
  } else {
    renderView();
  }
});

// ===============================================
// UI & EVENTI
// ===============================================
function setupUI(){
  // login/logout & mobile
  on($('btnLogin'), ()=>toggleModal('loginModal', true));
  on($('btnLoginM'), ()=>toggleModal('loginModal', true));
  on($('btnLogout'), signOut);
  on($('btnLogoutM'), signOut);
  on($('loginClose'), ()=>toggleModal('loginModal', false));
  on($('loginSend'), sendMagicLink);
  on($('btnMobileMenu'), ()=>{ const m=$('mobileMenu'); if(m) m.hidden=!m.hidden; });

  // vista
  on($('viewListino'), ()=>{ state.view='listino'; renderView(); });
  on($('viewCard'), ()=>{ state.view='card'; renderView(); });

  // filtri/ricerca
  on($('searchInput'), (e)=>{ state.search=e.target.value; renderView(); });
  on($('sortSelect'), (e)=>{ state.sort=e.target.value; renderView(); });
  on($('filterDisponibile'), (e)=>{ state.onlyAvailable=e.target.checked; renderView(); });
  on($('filterNovita'), (e)=>{ state.onlyNew=e.target.checked; renderView(); });
  on($('filterPriceMax'), (e)=>{ state.priceMax=parseItNumber(e.target.value); renderView(); });

  // modal immagine
  on($('imgClose'), ()=>toggleModal('imgModal', false));

  // admin (placeholder)
  on($('btnPublish'), ()=>{
    if (state.role!=='admin') return alert('Solo admin');
    alert('Hook pubblicazione pronto (edge function).');
  });
}

// ===============================================
// AUTH
// ===============================================
async function restoreSession(){
  const { data:{ session } } = await supabase.auth.getSession();
  if (session?.user) {
    const { data: prof } = await supabase.from('profiles').select('role').eq('id', session.user.id).single();
    state.role = (prof?.role === 'admin') ? 'admin' : 'agent';
  } else {
    state.role = 'guest';
  }
  supabase.auth.onAuthStateChange(async (_e, sess)=>{
    if (sess?.user){
      const { data: prof } = await supabase.from('profiles').select('role').eq('id', sess.user.id).single();
      state.role = (prof?.role === 'admin') ? 'admin' : 'agent';
      await renderAuthState();
      await fetchProducts();
      renderView();
    }
  });
}

async function renderAuthState(){
  const logged = state.role !== 'guest';
  $('btnLogin') && $('btnLogin').classList.toggle('hidden', logged);
  $('btnLogout') && $('btnLogout').classList.toggle('hidden', !logged);
  $('adminBox') && ( $('adminBox').hidden = (state.role!=='admin') );
  $('resultInfo') && ( $('resultInfo').textContent = logged ? 'Caricamento listino…' : 'Accedi per visualizzare il listino.' );
  if (logged) toggleModal('loginModal', false);
}

async function sendMagicLink(){
  const email = $('loginEmail')?.value?.trim();
  if (!email) return;
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: SITE_URL }
  });
  $('loginMsg') && ( $('loginMsg').textContent = error ? ('Errore: '+error.message) : 'Email inviata. Controlla la casella e apri il link.' );
}

async function signOut(){
  await supabase.auth.signOut();
  state.role='guest'; state.items=[]; renderView(); await renderAuthState();
}

// ===============================================
// DATA
// ===============================================
async function fetchProducts(){
  const { data, error } = await supabase
    .from('products')
    .select('id,codice,descrizione,categoria,sottocategoria,prezzo,unita,disponibile,novita,pack,pallet,tags,updated_at, product_media(id,kind,path,sort)')
    .order('descrizione', { ascending:true });

  if (error) { console.error(error); $('resultInfo')&&( $('resultInfo').textContent='Errore caricamento listino'); return; }

  const items=[];
  for(const p of (data||[])){
    const media = (p.product_media||[]).filter(m=>m.kind==='image').sort((a,b)=>(a.sort??0)-(b.sort??0));
    let imgUrl='';
    if (media[0]){
      // usa URL firmato (niente download blob → più veloce)
      const { data: signed } = await supabase.storage.from(STORAGE_BUCKET).createSignedUrl(media[0].path, 60*10);
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
      img: imgUrl,
    });
  }

  state.items = items;
  buildCategories();
  $('resultInfo') && ( $('resultInfo').textContent = `${items.length} articoli` );
}

// categorie chip
function buildCategories(){
  const set = new Set(state.items.map(p=>p.categoria||'Altro'));
  state.categories = ['Tutte', ...Array.from(set).sort((a,b)=>a.localeCompare(b,'it'))];
  const box = $('categoryList'); if(!box) return;
  box.innerHTML='';
  state.categories.forEach(cat=>{
    const b=document.createElement('button');
    b.className='tag hover:bg-slate-100';
    b.textContent = cat;
    b.addEventListener('click', ()=>{ state.selectedCategory=cat; renderView(); });
    box.appendChild(b);
  });
}

// ===============================================
// RENDER: SWITCH
// ===============================================
function renderView(){
  const grid = $('productGrid');
  const listino = $('listinoContainer');
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

// ===============================================
// VISTA LISTINO (tabellare per tipologia)
// ===============================================
function renderListinoByCategory(){
  const container = $('listinoContainer'); if(!container) return;
  container.innerHTML='';

  // filtri client (se vuoi portarli lato DB si può fare)
  let arr=[...state.items];
  if(state.selectedCategory!=='Tutte') arr=arr.filter(p=>p.categoria===state.selectedCategory);
  if(state.search){ const q=state.search.toLowerCase(); arr=arr.filter(p=>(p.codice+' '+p.descrizione+' '+(p.tags||[]).join(' ')).toLowerCase().includes(q)); }
  if(state.onlyAvailable) arr=arr.filter(p=>p.disponibile);
  if(state.onlyNew) arr=arr.filter(p=>p.novita);
  if(state.priceMax!=null) arr=arr.filter(p=>p.prezzo!=null && p.prezzo<=state.priceMax);

  // raggruppo per categoria
  const byCat=new Map();
  for(const p of arr){
    const c=p.categoria||'Altro';
    if(!byCat.has(c)) byCat.set(c, []);
    byCat.get(c).push(p);
  }

  const cats=[...byCat.keys()].sort((a,b)=>a.localeCompare(b,'it'));
  for(const cat of cats){
    const items = byCat.get(cat).sort((a,b)=>(a.codice||'').localeCompare(b.codice||'','it'));
    const h=document.createElement('h2');
    h.className='text-lg font-semibold';
    h.textContent=cat;
    container.appendChild(h);

    const table=document.createElement('table');
    table.className='w-full text-sm border-collapse';
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
      toggleModal('imgModal', true);
    });
  });
}

// ===============================================
// VISTA CARD (com’era prima, compatta)
// ===============================================
function renderCards(){
  const grid=$('productGrid'); if(!grid) return;
  grid.innerHTML='';

  let arr=[...state.items];
  if(state.selectedCategory!=='Tutte') arr=arr.filter(p=>p.categoria===state.selectedCategory);
  if(state.search){ const q=state.search.toLowerCase(); arr=arr.filter(p=>(p.codice+' '+p.descrizione+' '+(p.tags||[]).join(' ')).toLowerCase().includes(q)); }
  if(state.onlyAvailable) arr=arr.filter(p=>p.disponibile);
  if(state.onlyNew) arr=arr.filter(p=>p.novita);
  if(state.priceMax!=null) arr=arr.filter(p=>p.prezzo!=null && p.prezzo<=state.priceMax);

  switch(state.sort){
    case 'priceAsc': arr.sort((a,b)=>(a.prezzo??Infinity)-(b.prezzo??Infinity)); break;
    case 'priceDesc': arr.sort((a,b)=>(b.prezzo??-Infinity)-(a.prezzo??-Infinity)); break;
    case 'newest': arr.sort((a,b)=>(b.updated_at||'').localeCompare(a.updated_at||'')); break;
    default: arr.sort((a,b)=>a.descrizione.localeCompare(b.descrizione,'it')); break;
  }

  if(!arr.length){ grid.innerHTML='<div class="col-span-full text-center text-slate-500 py-10">Nessun articolo trovato.</div>'; return; }

  for(const p of arr){
    const card=document.createElement('article');
    card.className='card rounded-2xl bg-white border shadow-sm overflow-hidden';
    card.innerHTML=`
      <div class="aspect-square bg-slate-100 grid place-content-center">
        ${p.img ? `<img src="${p.img}" alt="${p.descrizione}" class="w-full h-full object-contain" loading="lazy" decoding="async">` : `<div class="text-slate-400">Nessuna immagine</div>`}
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
        <div class="flex gap-1 flex-wrap">${(p.tags||[]).map(t=>`<span class="tag">${t}</span>`).join('')}</div>
      </div>`;
    card.querySelector('button').addEventListener('click', ()=>{
      if(!p.img) return;
      const img=$('imgPreview'), ttl=$('imgTitle');
      if(img){ img.src=p.img; img.alt=p.descrizione||''; }
      if(ttl){ ttl.textContent=p.descrizione||''; }
      toggleModal('imgModal', true);
    });
    grid.appendChild(card);
  }
}
