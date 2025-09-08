/* ================================
   Listino Digitale – script.js (v32)
   - Auth email+password (niente magic link)
   - Render immediato post login/logout (no refresh)
   - Ricerca live, filtri, sort
   - Vista listino (tabellare) + card
   - Checkbox selezione articoli
   - Pannello preventivo a destra con export XLSX
=================================== */

/* ==== CONFIG ==== */
const SUPABASE_URL = 'https://wajzudbaezbyterpjdxg.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indhanp1ZGJhZXpieXRlcnBqZHhnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcxODA4MTUsImV4cCI6MjA3Mjc1NjgxNX0.MxaAqdUrppG2lObO_L5-SgDu8D7eze7mBf6S9rR_Q2w';
const STORAGE_BUCKET = 'prodotti'; // se usi storage privato per immagini

/* UMD client */
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ==== Helpers & stato ==== */
const $ = (id) => document.getElementById(id);
const on = (el, ev, fn) => { if (el) el.addEventListener(ev, fn, { passive: true }); };
const debounce = (fn, ms=120)=>{ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); }; };
const normalizeQuery = (s)=>(s||'').toString().normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().trim();
const parseItNumber = (v)=>{ if(v==null) return null; if(typeof v==='number') return v; const n=parseFloat(String(v).trim().replace(/\./g,'').replace(',','.')); return isNaN(n)?null:n; };
const formatPriceEUR = (n)=> (n==null||isNaN(n)) ? '—' : n.toLocaleString('it-IT',{style:'currency',currency:'EUR'});

const state = {
  items: [],
  categories: [],
  selectedCategory: 'Tutte',
  search: '',
  sort: 'alpha',         // 'alpha' | 'priceAsc' | 'priceDesc' | 'newest'
  onlyAvailable: false,
  onlyNew: false,
  priceMax: null,
  role: 'guest',         // 'guest' | 'agent' | 'admin'
  view: 'listino',       // 'listino' | 'card'
  preventivo: new Map(), // key: codice, value: {codice, descrizione, prezzo, conai, qty, sconto}
};

/* ==== BOOT ==== */
document.addEventListener('DOMContentLoaded', async ()=>{
  // piccolo header
  if ($('year')) $('year').textContent = new Date().getFullYear();

  setupUI();

  // mostra subito login modal se guest (schermata “bianca” con modale aperta)
  await restoreSession();
  await renderAuthState();

  if (state.role !== 'guest') {
    await fetchProducts();
  }
  renderView();
});

/* ==== UI & eventi ==== */
function setupUI(){
  // LOGIN/LOGOUT
  on($('btnLogin'),  'click', ()=>toggleLogin(true));
  on($('btnLoginM'), 'click', ()=>toggleLogin(true));
  on($('btnLogout'),  'click', signOut);
  on($('btnLogoutM'), 'click', signOut);

  on($('loginClose'), 'click', ()=>toggleLogin(false));
  on($('loginBackdrop'), 'click', ()=>toggleLogin(false));

  // invio form login con enter e con bottone
  const emailEl = $('loginEmail');
  const passEl  = $('loginPass');
  on($('loginSend'), 'click', signInWithPassword);
  if (emailEl) on(emailEl, 'keydown', (e)=>{ if(e.key==='Enter') signInWithPassword(); });
  if (passEl)  on(passEl,  'keydown', (e)=>{ if(e.key==='Enter') signInWithPassword(); });

  // MENU mobile
  on($('btnMobileMenu'), 'click', ()=>{ const m=$('mobileMenu'); if(m) m.hidden=!m.hidden; });

  // switch vista
  on($('viewListino'), 'click', ()=>{ setView('listino'); });
  on($('viewCard'),    'click', ()=>{ setView('card');    });

  // ricerca live
  const handleSearch = debounce((e)=>{ state.search = normalizeQuery(e.target.value); renderView(); }, 120);
  on($('searchInput'),  'input', handleSearch);
  on($('searchInputM'), 'input', handleSearch);
  on($('searchInput'),  'keyup',  handleSearch);
  on($('searchInputM'), 'keyup',  handleSearch);

  // filtri
  on($('sortSelect'),         'change', (e)=>{ state.sort=e.target.value; renderView(); });
  on($('filterDisponibile'),  'change', (e)=>{ state.onlyAvailable=e.target.checked; renderView(); });
  on($('filterNovita'),       'change', (e)=>{ state.onlyNew=e.target.checked; renderView(); });
  on($('filterPriceMax'),     'input',  (e)=>{ state.priceMax=parseItNumber(e.target.value); renderView(); });

  // pannello preventivo: esporta
  on($('btnExportXlsx'), 'click', exportPreventivoXLSX);

  // ESC chiude modali
  document.addEventListener('keydown', (ev)=>{
    if (ev.key==='Escape'){
      if ($('loginModal') && !$('loginModal').classList.contains('hidden')) toggleLogin(false);
      if ($('imgModal')   && !$('imgModal').classList.contains('hidden'))  toggleModal('imgModal', false);
    }
  });

  // immagine modal
  on($('imgBackdrop'), 'click', ()=>toggleModal('imgModal', false));
  on($('imgClose'),    'click', ()=>toggleModal('imgModal', false));

  // metto setView su window per compat con inline handler
  window.setView = setView;
}

function toggleLogin(show){
  const m=$('loginModal');
  if (!m) return;
  if (show) m.classList.remove('hidden'); else m.classList.add('hidden');
  document.body.classList.toggle('modal-open', show);
}
function toggleModal(id, show=true){
  const el=$(id); if(!el) return;
  el.classList.toggle('hidden', !show);
  document.body.classList.toggle('modal-open', show);
}
function setView(v){
  state.view=v;
  renderView();
}

/* ==== AUTH ==== */
async function restoreSession(){
  const { data:{ session } } = await supabase.auth.getSession();
  if (session?.user){
    const { data: prof } = await supabase.from('profiles').select('role').eq('id', session.user.id).maybeSingle();
    state.role = (prof?.role === 'admin') ? 'admin' : 'agent';
  } else {
    state.role='guest';
  }

  // ascolta cambiamenti (login/logout)
  supabase.auth.onAuthStateChange(async (ev, sess)=>{
    if (sess?.user){
      const { data: prof } = await supabase.from('profiles').select('role').eq('id', sess.user.id).maybeSingle();
      state.role = (prof?.role === 'admin') ? 'admin' : 'agent';
      await renderAuthState();
      await fetchProducts();       // <— carica subito prodotti
      renderView();                // <— e mostra
    } else {
      state.role='guest';
      state.items=[];
      state.preventivo.clear();
      await renderAuthState();
      renderView();
    }
  });
}

async function renderAuthState(){
  const logged = state.role !== 'guest';

  // header
  $('btnLogin')   && $('btnLogin').classList.toggle('hidden', logged);
  $('btnLogout')  && $('btnLogout').classList.toggle('hidden', !logged);
  $('btnLoginM')  && $('btnLoginM').classList.toggle('hidden', logged);
  $('btnLogoutM') && $('btnLogoutM').classList.toggle('hidden', !logged);

  // admin box
  $('adminBox') && ( $('adminBox').hidden = (state.role!=='admin') );

  // info
  $('resultInfo') && ( $('resultInfo').textContent = logged ? 'Caricamento listino…' : 'Accedi per visualizzare il listino.' );

  // login modal: se guest… mostro; se logged… chiudo
  toggleLogin(!logged);
}

async function signInWithPassword(){
  const email = $('loginEmail')?.value?.trim() || '';
  const pass  = $('loginPass')?.value || '';
  const msg   = $('loginMsg');
  if (!email || !pass){ if(msg) msg.textContent='Inserisci email e password.'; return; }

  if (msg) msg.textContent='Accesso in corso…';
  const { data, error } = await supabase.auth.signInWithPassword({ email, password: pass });

  if (error){
    if (msg) msg.textContent = 'Errore: ' + (error.message || 'accesso non riuscito');
    return;
  }

  // ok: chiudo modale, aggiorno UI/subito
  if (msg) msg.textContent = 'Accesso effettuato.';
  toggleLogin(false);
  await restoreSession();
  await renderAuthState();
  await fetchProducts();
  renderView();
}

async function signOut(){
  await supabase.auth.signOut();
  state.role='guest';
  state.items=[];
  state.preventivo.clear();
  renderPreventivoPanel();
  renderView();
  await renderAuthState();
}

/* ==== DATA ==== */
async function fetchProducts(){
  try{
    const { data, error } = await supabase
      .from('products')
      .select('id,codice,descrizione,categoria,sottocategoria,prezzo,unita,disponibile,novita,pack,pallet,tags,updated_at,conai, product_media(id,kind,path,sort)')
      .order('descrizione', { ascending: true });

    if (error) throw error;

    const items=[];
    for (const p of (data||[])){
      let imgUrl='';
      const mediaImgs = (p.product_media||[]).filter(m=>m.kind==='image').sort((a,b)=>(a.sort??0)-(b.sort??0));
      if (mediaImgs[0]) {
        // se storage privato: signed url; se pubblico, usa il path assoluto
        const { data: signed } = await supabase.storage.from(STORAGE_BUCKET).createSignedUrl(mediaImgs[0].path, 900);
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
        conai: typeof p.conai === 'number' ? p.conai : 0, // se non hai il campo, resta 0
        img: imgUrl,
      });
    }

    state.items = items;
    buildCategories();
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

/* ==== RENDER ==== */
function renderView(){
  const grid=$('productGrid'), listino=$('listinoContainer');
  if (!grid || !listino) return;

  if (state.view==='listino'){ grid.classList.add('hidden'); listino.classList.remove('hidden'); renderListino(); }
  else { listino.classList.add('hidden'); grid.classList.remove('hidden'); renderCards(); }

  // il pannello preventivo è sempre a destra
  renderPreventivoPanel();
}

function filteredSortedItems(){
  let out=[...state.items];
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

/* == LISTINO TABELLARE con checkbox == */
function renderListino(){
  const container=$('listinoContainer'); if(!container) return;
  container.innerHTML='';

  const arr = filteredSortedItems();

  // group by categoria
  const byCat=new Map();
  for(const p of arr){ const c=p.categoria||'Altro'; if(!byCat.has(c)) byCat.set(c,[]); byCat.get(c).push(p); }

  const cats=[...byCat.keys()].sort((a,b)=>a.localeCompare(b,'it'));
  if (!cats.length){
    container.innerHTML='<div class="text-center text-slate-500 py-10">Nessun articolo trovato.</div>';
    return;
  }

  for (const cat of cats){
    const items=byCat.get(cat).sort((a,b)=>(a.codice||'').localeCompare(b.codice||'','it'));

    const h=document.createElement('h2');
    h.className='text-lg font-semibold mt-2 mb-1';
    h.textContent=cat;
    container.appendChild(h);

    const table=document.createElement('table');
    table.className='w-full text-sm border-collapse';
    table.innerHTML=`
      <thead class="bg-slate-100">
        <tr>
          <th class="border px-2 py-1 text-center w-10">Sel</th>
          <th class="border px-2 py-1 text-left">Codice</th>
          <th class="border px-2 py-1 text-left">Descrizione</th>
          <th class="border px-2 py-1 text-left">Confezione</th>
          <th class="border px-2 py-1 text-right">Prezzo</th>
          <th class="border px-2 py-1 text-center">Img</th>
        </tr>
      </thead>
      <tbody></tbody>`;
    const tb=table.querySelector('tbody');

    for (const p of items){
      const selected = state.preventivo.has(p.codice);
      const tr=document.createElement('tr');
      tr.innerHTML=`
        <td class="border px-2 py-1 text-center">
          <input type="checkbox" ${selected?'checked':''} data-cod="${p.codice}">
        </td>
        <td class="border px-2 py-1 whitespace-nowrap font-mono">${p.codice||''}</td>
        <td class="border px-2 py-1">${p.descrizione||''} ${p.novita?'<span class="ml-2 text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-[2px]">Novità</span>':''}</td>
        <td class="border px-2 py-1">${p.pack||''}</td>
        <td class="border px-2 py-1 text-right">${formatPriceEUR(p.prezzo)}</td>
        <td class="border px-2 py-1 text-center">${p.img?`<button class="text-sky-600 underline" data-src="${p.img}" data-title="${encodeURIComponent(p.descrizione||'')}">📷</button>`:'—'}</td>
      `;
      tb.appendChild(tr);
    }
    container.appendChild(table);

    // bind: checkbox selezione
    table.querySelectorAll('input[type="checkbox"][data-cod]').forEach(chk=>{
      chk.addEventListener('change', (e)=>{
        const cod = e.currentTarget.getAttribute('data-cod');
        const prod = items.find(x=>x.codice===cod) || state.items.find(x=>x.codice===cod);
        if (!prod) return;
        if (e.currentTarget.checked) addToPreventivo(prod);
        else removeFromPreventivo(cod);
      });
    });

    // bind: immagine
    container.querySelectorAll('button[data-src]').forEach(btn=>{
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

/* == VISTA CARD con checkbox == */
function renderCards(){
  const grid=$('productGrid'); if(!grid) return;
  grid.innerHTML='';
  const arr = filteredSortedItems();
  if (!arr.length){
    grid.innerHTML='<div class="col-span-full text-center text-slate-500 py-10">Nessun articolo trovato.</div>';
    return;
  }
  for (const p of arr){
    const selected = state.preventivo.has(p.codice);
    const card=document.createElement('article');
    card.className='card rounded-2xl bg-white border shadow-sm overflow-hidden';
    card.innerHTML=`
      <div class="aspect-square bg-slate-100 grid place-content-center relative">
        <label class="absolute left-2 top-2 bg-white/90 rounded px-1 py-0.5 shadow text-xs">
          <input type="checkbox" ${selected?'checked':''} data-cod="${p.codice}"> Seleziona
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
          <div class="text-lg font-semibold">${formatPriceEUR(p.prezzo)}</div>
          ${p.img?'<button class="rounded-xl border px-3 py-1.5 text-sm hover:bg-slate-50" data-src="'+p.img+'" data-title="'+encodeURIComponent(p.descrizione||'')+'">Vedi</button>':''}
        </div>
      </div>
    `;
    grid.appendChild(card);

    // selezione
    card.querySelector('input[type="checkbox"][data-cod]')?.addEventListener('change', (e)=>{
      const cod=e.currentTarget.getAttribute('data-cod');
      if (e.currentTarget.checked) addToPreventivo(p); else removeFromPreventivo(cod);
    });

    // immagine
    card.querySelectorAll('button[data-src]').forEach(btn=>{
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

/* ==== PREVENTIVO (pannello destro) ==== */
function addToPreventivo(p){
  if (!p || !p.codice) return;
  if (!state.preventivo.has(p.codice)){
    state.preventivo.set(p.codice, {
      codice: p.codice,
      descrizione: p.descrizione,
      prezzo: Number(p.prezzo)||0,
      conai: Number(p.conai)||0,      // non editabile
      qty: 1,
      sconto: 0,
    });
  }
  renderPreventivoPanel();
}
function removeFromPreventivo(cod){
  if (state.preventivo.has(cod)) state.preventivo.delete(cod);
  renderPreventivoPanel();
}

function renderPreventivoPanel(){
  const box = $('preventivoPanel'); if (!box) return;

  const rows = [...state.preventivo.values()];
  if (!rows.length){
    box.innerHTML = `
      <div class="glass rounded-2xl p-4 border">
        <h2 class="font-semibold mb-3">Preventivo</h2>
        <p class="text-sm text-slate-500">Seleziona articoli dalla lista per aggiungerli al preventivo.</p>
      </div>`;
    return;
  }

  // calcoli helper
  const prezzoScontato = (r)=>{
    const s = Math.max(0, Math.min(100, Number(r.sconto)||0));
    return (Number(r.prezzo)||0) * (1 - s/100);
  };

  const totale = rows.reduce((acc, r)=>{
    const ps = prezzoScontato(r);
    acc.totaleRighe += ps * (Number(r.qty)||0);
    acc.totConai    += (Number(r.conai)||0) * (Number(r.qty)||0);
    return acc;
  }, { totaleRighe:0, totConai:0 });

  const imponibile = totale.totaleRighe + totale.totConai;

  // render
  const tableRows = rows.map(r=>{
    const ps = prezzoScontato(r);
    const trTot = ps * (Number(r.qty)||0);
    return `
      <tr>
        <td class="border px-2 py-1 font-mono">${r.codice}</td>
        <td class="border px-2 py-1">${r.descrizione||''}</td>
        <td class="border px-2 py-1 text-right">${formatPriceEUR(r.prezzo)}</td>
        <td class="border px-2 py-1 text-right">${formatPriceEUR(r.conai)}</td>
        <td class="border px-2 py-1 text-center">
          <input type="number" min="1" step="1" class="w-16 border rounded px-2 py-1 text-right"
                 data-field="qty" data-cod="${r.codice}" value="${r.qty}">
        </td>
        <td class="border px-2 py-1 text-center">
          <input type="number" min="0" max="100" step="1" class="w-16 border rounded px-2 py-1 text-right"
                 data-field="sconto" data-cod="${r.codice}" value="${r.sconto}">
        </td>
        <td class="border px-2 py-1 text-right">${formatPriceEUR(ps)}</td>
        <td class="border px-2 py-1 text-right">${formatPriceEUR(trTot)}</td>
        <td class="border px-2 py-1 text-center">
          <button class="text-red-600 underline" data-remove="${r.codice}">✕</button>
        </td>
      </tr>`;
  }).join('');

  box.innerHTML = `
    <div class="glass rounded-2xl p-4 border">
      <div class="flex items-center justify-between">
        <h2 class="font-semibold">Preventivo</h2>
        <button id="btnExportXlsx" class="rounded-xl bg-emerald-600 text-white px-3 py-1.5 text-sm">Esporta Excel</button>
      </div>

      <div class="mt-3 overflow-auto">
        <table class="w-full text-sm border-collapse min-w-[720px]">
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
          <tbody>${tableRows}</tbody>
        </table>
      </div>

      <div class="mt-3 text-sm space-y-1">
        <div class="flex justify-between"><span>Totale righe:</span><strong>${formatPriceEUR(totale.totaleRighe)}</strong></div>
        <div class="flex justify-between"><span>Totale CONAI:</span><strong>${formatPriceEUR(totale.totConai)}</strong></div>
        <div class="flex justify-between text-base"><span>Totale imponibile:</span><strong>${formatPriceEUR(imponibile)}</strong></div>
      </div>
    </div>
  `;

  // bind updates qty/sconto
  box.querySelectorAll('input[data-field]').forEach(inp=>{
    inp.addEventListener('input', (e)=>{
      const cod = e.currentTarget.getAttribute('data-cod');
      const field = e.currentTarget.getAttribute('data-field'); // qty | sconto
      const r = state.preventivo.get(cod); if (!r) return;
      let val = Number(e.currentTarget.value)||0;
      if (field==='qty') { r.qty = Math.max(1, Math.round(val)); }
      if (field==='sconto') { r.sconto = Math.max(0, Math.min(100, Math.round(val))); }
      renderPreventivoPanel(); // ricalcola
    });
  });

  // bind remove
  box.querySelectorAll('button[data-remove]').forEach(btn=>{
    btn.addEventListener('click', (e)=>{
      const cod = e.currentTarget.getAttribute('data-remove');
      removeFromPreventivo(cod);
      // aggiorna checkbox lista
      document.querySelectorAll(`input[type="checkbox"][data-cod="${cod}"]`).forEach(ch=>{ ch.checked=false; });
    });
  });

  // bind esporta (riattacco perché rimpiazzo innerHTML)
  on($('btnExportXlsx'), 'click', exportPreventivoXLSX);
}

function exportPreventivoXLSX(){
  if (!window.XLSX){ alert('Modulo XLSX non caricato.'); return; }
  const rows = [...state.preventivo.values()];
  if (!rows.length){ alert('Nessun articolo nel preventivo.'); return; }

  const data = rows.map(r=>{
    const s  = Math.max(0, Math.min(100, Number(r.sconto)||0));
    const ps = (Number(r.prezzo)||0) * (1 - s/100);
    const tot = ps * (Number(r.qty)||0);
    return {
      'Codice': r.codice,
      'Descrizione': r.descrizione,
      'Prezzo': Number(r.prezzo)||0,
      'CONAI/collo': Number(r.conai)||0,
      'Q.tà': Number(r.qty)||0,
      'Sconto %': s,
      'Prezzo scont.': ps,
      'Totale riga': tot
    };
  });

  // totali
  const totRighe = data.reduce((a,r)=>a + Number(r['Totale riga'])||0, 0);
  const totConai = rows.reduce((a,r)=>a + (Number(r.conai)||0)*(Number(r.qty)||0), 0);
  const imponibile = totRighe + totConai;

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(data);
  XLSX.utils.sheet_add_aoa(ws, [
    [],
    ['Totale righe', totRighe],
    ['Totale CONAI', totConai],
    ['Totale imponibile', imponibile]
  ], { origin: -1 });

  XLSX.utils.book_append_sheet(wb, ws, 'Preventivo');
  XLSX.writeFile(wb, `preventivo_${new Date().toISOString().slice(0,10)}.xlsx`);
}
