/* ================================
   Listino Digitale – script.js (v40)
   - Login EMAIL + PASSWORD (niente magic link)
   - Cambio password
   - Preventivo nella sidebar destra (Excel export)
=================================== */

/* ==== CONFIG ==== */
const SUPABASE_URL = 'https://wajzudbaezbyterpjdxg.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indhanp1ZGJhZXpieXRlcnBqZHhnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcxODA4MTUsImV4cCI6MjA3Mjc1NjgxNX0.MxaAqdUrppG2lObO_L5-SgDu8D7eze7mBf6S9rR_Q2w';
const STORAGE_BUCKET = 'prodotti'; // bucket immagini (può restare privato)

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ==== Helpers ==== */
const $ = (id)=>document.getElementById(id);
function on(el, ev, fn){ if (el) el.addEventListener(ev, fn, {passive:true}); }
function toggle(el, show){ el.classList.toggle('hidden', !show); }
function toggleModal(id, show=true){
  const el=$(id); if(!el) return;
  el.classList.toggle('hidden', !show);
  document.body.classList.toggle('modal-open', show);
}
function normalizeQuery(s){ return (s||'').toString().normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().trim(); }
const formatEUR = (n)=> (n==null||isNaN(n)) ? '€ 0,00' : n.toLocaleString('it-IT',{style:'currency',currency:'EUR'});

/* ==== Stato ==== */
const state = {
  role: 'guest',        // 'guest' | 'agent' | 'admin'
  items: [],            // prodotti caricati
  categories: [],
  selectedCategory: 'Tutte',
  search: '',
  sort: 'alpha',        // alpha | priceAsc | priceDesc | newest
  onlyAvailable: false,
  onlyNew: false,
  priceMax: null,

  // preventivo
  quote: [] // [{codice, descrizione, prezzo, conai, qty, sconto}]
};

/* ==== BOOT ==== */
document.addEventListener('DOMContentLoaded', async ()=>{
  if ($('year')) $('year').textContent = new Date().getFullYear();
  setupUI();
  loadQuoteFromStorage();

  await restoreSession();
  await renderAuthState();

  if (state.role!=='guest') {
    await fetchProducts();
  }
  renderView();
});

/* =================
   UI & EVENTI
================= */
function setupUI(){
  // Login/Logout
  on($('btnLogin'),  'click', ()=>toggleModal('loginModal', true));
  on($('btnLoginM'), 'click', ()=>toggleModal('loginModal', true));
  on($('btnLogout'), 'click', signOut);
  on($('btnLogoutM'),'click', signOut);
  on($('loginClose'),'click', ()=>toggleModal('loginModal', false));
  on($('loginBackdrop'),'click', ()=>toggleModal('loginModal', false));
  on($('loginSend'), 'click', loginWithPassword);

  // Cambio password
  on($('btnOpenChangePwd'),'click', ()=>{
    toggleModal('loginModal', false);
    toggleModal('pwdModal', true);
  });
  on($('pwdClose'),'click', ()=>toggleModal('pwdModal', false));
  on($('pwdBackdrop'),'click', ()=>toggleModal('pwdModal', false));
  on($('btnChangePwd'), 'click', changePassword);

  // Vista
  on($('viewListino'),'click', ()=>{ state.view='listino'; renderView(); });
  on($('viewCard'),   'click', ()=>{ state.view='card';    renderView(); });

  // Ricerca live
  const handleSearch = (e)=>{ state.search = normalizeQuery(e.target.value); renderView(); };
  on($('searchInput'), 'input', handleSearch);
  on($('searchInputM'),'input', handleSearch);
  on($('sortSelect'),'change',(e)=>{ state.sort=e.target.value; renderView(); });
  on($('sortSelectM'),'change',(e)=>{ state.sort=e.target.value; renderView(); });

  on($('filterDisponibile'),'change',(e)=>{ state.onlyAvailable=e.target.checked; renderView(); });
  on($('filterNovita'),     'change',(e)=>{ state.onlyNew=e.target.checked; renderView(); });
  on($('filterPriceMax'),   'input', (e)=>{ state.priceMax=parseFloat(e.target.value)||null; renderView(); });

  // Preventivo
  on($('btnClearQuote'), 'click', ()=>{ state.quote=[]; saveQuoteToStorage(); renderQuote(); });
  on($('btnExportXLSX'), 'click', exportXLSX);

  // Modale immagini
  on($('imgBackdrop'),'click', ()=>toggleModal('imgModal', false));
  on($('imgClose'),'click', ()=>toggleModal('imgModal', false));

  // Admin (placeholder)
  on($('btnPublish'),'click', ()=>{
    if (state.role!=='admin') return alert('Solo admin');
    alert('Hook pubblicazione pronto.');
  });
}

/* =================
   AUTH (email+password)
================= */
async function restoreSession(){
  const { data:{session} } = await supabase.auth.getSession();

  if (session?.user) {
    // ruolo da tabella profiles (se esiste), fallback agent
    const { data: prof } = await supabase.from('profiles').select('role').eq('id', session.user.id).maybeSingle();
    state.role = (prof?.role==='admin') ? 'admin' : 'agent';
  } else {
    state.role = 'guest';
  }

  supabase.auth.onAuthStateChange(async (_ev, sess)=>{
    if (sess?.user){
      const { data: prof } = await supabase.from('profiles').select('role').eq('id', sess.user.id).maybeSingle();
      state.role = (prof?.role==='admin') ? 'admin' : 'agent';
      await renderAuthState();
      await fetchProducts();
      renderView();
    } else {
      state.role = 'guest';
      renderAuthState();
      renderView();
    }
  });
}

async function renderAuthState(){
  const logged = state.role!=='guest';
  ['btnLogin','btnLoginM'].forEach(id=>$(id)&&$(id).classList.toggle('hidden', logged));
  ['btnLogout','btnLogoutM'].forEach(id=>$(id)&&$(id).classList.toggle('hidden', !logged));
  if ($('adminBox')) $('adminBox').hidden = (state.role!=='admin');
  if ($('resultInfo')) $('resultInfo').textContent = logged ? 'Caricamento listino…' : 'Accedi per visualizzare il listino.';
  if (logged) toggleModal('loginModal', false);
}

async function loginWithPassword(){
  const email = $('loginEmail').value.trim();
  const password = $('loginPassword').value;
  const msg = $('loginMsg');

  if (!email || !password){ msg.textContent = 'Inserisci email e password.'; return; }

  msg.textContent = 'Accesso in corso…';
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error){
    msg.textContent = 'Errore: ' + (error.message || 'Accesso non riuscito');
    return;
  }

  // ok
  msg.textContent = 'Accesso effettuato.';
  toggleModal('loginModal', false);
  await restoreSession();
  await fetchProducts();
  renderView();
}

async function changePassword(){
  const newPwd = $('newPwd').value;
  const msg = $('pwdMsg');
  if (!newPwd || newPwd.length<6){ msg.textContent='Minimo 6 caratteri.'; return; }
  const { error } = await supabase.auth.updateUser({ password: newPwd });
  msg.textContent = error ? ('Errore: ' + error.message) : 'Password aggiornata.';
  if (!error) setTimeout(()=>toggleModal('pwdModal', false), 800);
}

async function signOut(){
  await supabase.auth.signOut();
  state.role='guest';
  state.items=[];
  renderView();
  renderAuthState();
}

/* =================
   DATA
================= */
async function fetchProducts(){
  try{
    const { data, error } = await supabase
      .from('products')
      .select('id,codice,descrizione,categoria,sottocategoria,prezzo,unita,disponibile,novita,pack,pallet,tags,conai,updated_at, product_media(id,kind,path,sort)')
      .order('descrizione', { ascending:true });

    if (error) throw error;

    // mappa
    const items=[];
    for (const p of (data||[])){
      // immagine firmata (se presente)
      let imgUrl='';
      const imgs=(p.product_media||[]).filter(m=>m.kind==='image').sort((a,b)=>(a.sort??0)-(b.sort??0));
      if (imgs[0]){
        const { data: signed } = await supabase.storage.from(STORAGE_BUCKET).createSignedUrl(imgs[0].path, 600);
        imgUrl = signed?.signedUrl || '';
      }
      items.push({
        codice: p.codice, descrizione:p.descrizione, categoria:p.categoria, sottocategoria:p.sottocategoria,
        prezzo: p.prezzo, unita:p.unita, disponibile:p.disponibile, novita:p.novita, pack:p.pack, pallet:p.pallet,
        conai: p.conai ?? 0, tags: p.tags || [], updated_at:p.updated_at, img: imgUrl
      });
    }

    state.items = items;
    buildCategories();
    if ($('resultInfo')) $('resultInfo').textContent = `${items.length} articoli`;
  } catch(e){
    console.error('[fetchProducts]', e);
    if ($('resultInfo')) $('resultInfo').textContent = 'Errore caricamento listino';
  }
}

function buildCategories(){
  const set = new Set(state.items.map(p=>p.categoria||'Altro'));
  state.categories = ['Tutte', ...Array.from(set).sort((a,b)=>a.localeCompare(b,'it'))];
  const box=$('categoryList'); if(!box) return;
  box.innerHTML='';
  state.categories.forEach(cat=>{
    const b=document.createElement('button');
    b.className='tag hover:bg-slate-100';
    b.textContent=cat;
    b.addEventListener('click', ()=>{ state.selectedCategory=cat; renderView(); });
    box.appendChild(b);
  });
}

/* =================
   RENDER LISTINO / CARDS
================= */
function renderView(){
  const grid=$('productGrid'), listino=$('listinoContainer');
  if (!grid || !listino) return;
  if (state.view==='card'){
    listino.classList.add('hidden');
    grid.classList.remove('hidden');
    renderCards();
  } else {
    grid.classList.add('hidden');
    listino.classList.remove('hidden');
    renderListinoByCategory();
  }
  renderQuote(); // keep right sidebar updated height etc.
}

function filterAndSort(arr){
  let out=[...arr];

  if (state.selectedCategory!=='Tutte')
    out=out.filter(p=>(p.categoria||'Altro')===state.selectedCategory);

  if (state.search){
    const q = state.search;
    out=out.filter(p=>{
      const hay = normalizeQuery((p.codice||'')+' '+(p.descrizione||'')+' '+(p.tags||[]).join(' '));
      return hay.includes(q);
    });
  }

  if (state.onlyAvailable) out=out.filter(p=>p.disponibile);
  if (state.onlyNew)       out=out.filter(p=>p.novita);
  if (state.priceMax!=null) out=out.filter(p=>p.prezzo!=null && p.prezzo<=state.priceMax);

  switch(state.sort){
    case 'priceAsc':  out.sort((a,b)=>(a.prezzo??Infinity)-(b.prezzo??Infinity)); break;
    case 'priceDesc': out.sort((a,b)=>(b.prezzo??-Infinity)-(a.prezzo??-Infinity)); break;
    case 'newest':    out.sort((a,b)=>(b.updated_at||'').localeCompare(a.updated_at||'')); break;
    default:          out.sort((a,b)=>(a.descrizione||'').localeCompare(b.descrizione||'','it')); break;
  }
  return out;
}

function renderListinoByCategory(){
  const container=$('listinoContainer'); container.innerHTML='';
  const arr=filterAndSort(state.items);

  const byCat=new Map();
  for(const p of arr){ const c=p.categoria||'Altro'; if(!byCat.has(c)) byCat.set(c,[]); byCat.get(c).push(p); }
  const cats=[...byCat.keys()].sort((a,b)=>a.localeCompare(b,'it'));

  if (!cats.length){
    container.innerHTML='<div class="text-center text-slate-500 py-10">Nessun articolo trovato.</div>';
    return;
  }

  for(const cat of cats){
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
          <th class="border px-2 py-1 text-center">Sel</th>
          <th class="border px-2 py-1 text-left">Codice</th>
          <th class="border px-2 py-1 text-left">Descrizione</th>
          <th class="border px-2 py-1 text-left">Confezione</th>
          <th class="border px-2 py-1 text-right">Prezzo</th>
          <th class="border px-2 py-1 text-right">CONAI/collo</th>
          <th class="border px-2 py-1 text-center">Img</th>
        </tr>
      </thead>
      <tbody></tbody>`;
    const tb=table.querySelector('tbody');

    for(const p of items){
      const tr=document.createElement('tr');
      tr.innerHTML=`
        <td class="border px-2 py-1 text-center">
          <input type="checkbox" data-cod="${p.codice}">
        </td>
        <td class="border px-2 py-1 whitespace-nowrap font-mono">${p.codice||''}</td>
        <td class="border px-2 py-1">${p.descrizione||''} ${p.novita?'<span class="ml-2 text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-[2px]">Novità</span>':''}</td>
        <td class="border px-2 py-1">${p.pack||''}</td>
        <td class="border px-2 py-1 text-right">${formatEUR(p.prezzo)}</td>
        <td class="border px-2 py-1 text-right">${formatEUR(p.conai||0)}</td>
        <td class="border px-2 py-1 text-center">${p.img?`<button class="text-sky-600 underline" data-src="${p.img}" data-title="${encodeURIComponent(p.descrizione||'')}">📷</button>`:'—'}</td>
      `;
      // checkbox: gestione quote add/remove
      tr.querySelector('input[type="checkbox"]').addEventListener('change', (e)=>{
        if (e.target.checked) addToQuote(p);
        else removeFromQuote(p.codice);
      });
      // pulsante immagine
      const btn = tr.querySelector('button[data-src]');
      if (btn) btn.addEventListener('click', ()=>{
        const src=btn.getAttribute('data-src'); const title=decodeURIComponent(btn.getAttribute('data-title')||'');
        $('imgPreview').src=src; $('imgPreview').alt=title; $('imgTitle').textContent=title;
        toggleModal('imgModal', true);
      });

      // spunta se già nel preventivo
      if (state.quote.find(q=>q.codice===p.codice)) tr.querySelector('input').checked = true;

      tb.appendChild(tr);
    }
    container.appendChild(table);
  }
}

function renderCards(){
  const grid=$('productGrid'); grid.innerHTML='';
  const arr=filterAndSort(state.items);
  if (!arr.length){
    grid.innerHTML='<div class="col-span-full text-center text-slate-500 py-10">Nessun articolo trovato.</div>';
    return;
  }
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
          <div class="text-lg font-semibold">${formatEUR(p.prezzo)}</div>
          <button class="rounded-xl border px-3 py-1.5 text-sm hover:bg-slate-50">Aggiungi</button>
        </div>
      </div>`;
    card.querySelector('button').addEventListener('click', ()=>addToQuote(p));
    grid.appendChild(card);
  }
}

/* =================
   PREVENTIVO (sidebar destra)
================= */
function addToQuote(p){
  if (state.quote.find(q=>q.codice===p.codice)) return;
  state.quote.push({
    codice:p.codice,
    descrizione:p.descrizione,
    prezzo: Number(p.prezzo)||0,
    conai:  Number(p.conai)||0,
    qty: 1,
    sconto: 0
  });
  saveQuoteToStorage();
  renderQuote();
}

function removeFromQuote(codice){
  state.quote = state.quote.filter(q=>q.codice!==codice);
  saveQuoteToStorage();
  renderQuote();
  // deseleziona anche nel listino se presente
  document.querySelectorAll(`input[type="checkbox"][data-cod="${codice}"]`).forEach(chk=>chk.checked=false);
}

function lineNetPrice(prezzo, sconto){
  const s = Math.min(100, Math.max(0, Number(sconto)||0));
  return prezzo * (1 - s/100);
}
function lineTotal(q){
  const netto = lineNetPrice(q.prezzo, q.sconto);
  return netto * (Number(q.qty)||0) + (Number(q.conai)||0);
}

function renderQuote(){
  const tb=$('quoteBody'); tb.innerHTML='';
  let total=0;

  for(const q of state.quote){
    const net = lineNetPrice(q.prezzo, q.sconto);
    const tot = lineTotal(q);
    total += tot;

    const tr=document.createElement('tr');
    tr.innerHTML=`
      <td class="border px-2 py-1 whitespace-nowrap font-mono">${q.codice}</td>
      <td class="border px-2 py-1">${q.descrizione}</td>
      <td class="border px-2 py-1 text-right">${formatEUR(q.prezzo)}</td>
      <td class="border px-2 py-1 text-right">${formatEUR(q.conai)}</td>
      <td class="border px-2 py-1 text-right">
        <input type="number" class="w-16 border rounded number-spin text-right px-1 py-0.5" min="0" step="1" value="${q.qty}">
      </td>
      <td class="border px-2 py-1 text-right">
        <input type="number" class="w-16 border rounded number-spin text-right px-1 py-0.5" min="0" max="100" step="1" value="${q.sconto}">
      </td>
      <td class="border px-2 py-1 text-right">${formatEUR(net)}</td>
      <td class="border px-2 py-1 text-right">${formatEUR(tot)}</td>
      <td class="border px-2 py-1 text-center">
        <button class="text-rose-600 underline">Rimuovi</button>
      </td>
    `;

    // bind qty/sconto/rimuovi
    const [qtyEl, scontoEl] = tr.querySelectorAll('input');
    qtyEl.addEventListener('input', (e)=>{
      q.qty = Math.max(0, parseInt(e.target.value||'0',10));
      saveQuoteToStorage(); renderQuote();
    });
    scontoEl.addEventListener('input', (e)=>{
      q.sconto = Math.max(0, Math.min(100, parseInt(e.target.value||'0',10)));
      saveQuoteToStorage(); renderQuote();
    });
    tr.querySelector('button').addEventListener('click', ()=>removeFromQuote(q.codice));

    tb.appendChild(tr);
  }

  $('quoteRows').textContent = String(state.quote.length);
  $('quoteCount').textContent = `${state.quote.length} righe`;
  $('quoteTotal').textContent = formatEUR(total);
}

function saveQuoteToStorage(){
  try { localStorage.setItem('tb_quote', JSON.stringify(state.quote)); } catch(_) {}
}
function loadQuoteFromStorage(){
  try {
    const raw = localStorage.getItem('tb_quote');
    if (raw) state.quote = JSON.parse(raw)||[];
  } catch(_) { state.quote=[]; }
}

/* ===== Excel export ===== */
function exportXLSX(){
  if (!state.quote.length){ alert('Nessuna riga nel preventivo.'); return; }

  const rows = state.quote.map(q=>{
    const prezzo_scont = lineNetPrice(q.prezzo, q.sconto);
    const totale_riga  = lineTotal(q);
    return {
      'Codice': q.codice,
      'Descrizione': q.descrizione,
      'Prezzo': q.prezzo,
      'CONAI/collo': q.conai,
      'Q.tà': q.qty,
      'Sconto %': q.sconto,
      'Prezzo scont.': prezzo_scont,
      'Totale riga': totale_riga
    };
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows, {header: ['Codice','Descrizione','Prezzo','CONAI/collo','Q.tà','Sconto %','Prezzo scont.','Totale riga']});
  XLSX.utils.book_append_sheet(wb, ws, 'Preventivo');

  // Riepilogo totali
  const total = rows.reduce((s,r)=>s + Number(r['Totale riga']||0), 0);
  XLSX.utils.sheet_add_aoa(ws, [[''], ['Totale imponibile', total]], {origin: XLSX.utils.encode_cell({r: rows.length+2, c: 0})});

  XLSX.writeFile(wb, 'preventivo.xlsx');
}
