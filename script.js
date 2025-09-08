/* ================================
   Listino Digitale – login/password
   Fix “Accedi non fa nulla”
   - UMD: <script src=".../supabase.js"></script> presente in index
   - Questo file va caricato DOPO il tag UMD (già fatto) e con defer
================================ */

/* === CONFIG: METTI I TUOI VALORI === */
const SUPABASE_URL = 'https://wajzudbaezbyterpjdxg.supabase.co'; // <-- tuo URL
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indhanp1ZGJhZXpieXRlcnBqZHhnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcxODA4MTUsImV4cCI6MjA3Mjc1NjgxNX0.MxaAqdUrppG2lObO_L5-SgDu8D7eze7mBf6S9rR_Q2w'; // <-- tua anon key
const STORAGE_BUCKET = 'prodotti'; // o 'media' se usi quell’altro

/* === Client Supabase (UMD) === */
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* === Helpers === */
const $ = (id) => document.getElementById(id);
const log = (...a) => console.log('[Listino]', ...a);
const err = (...a) => console.error('[Listino]', ...a);

function showAuthGate(show) {
  const gate = $('authGate');
  const app = $('appShell');
  if (!gate || !app) return;
  if (show) {
    gate.classList.remove('hidden');
    app.classList.add('hidden');
  } else {
    gate.classList.add('hidden');
    app.classList.remove('hidden');
  }
}

function setMsg(id, text) {
  const el = $(id);
  if (el) el.textContent = text || '';
}

/* === Stato minimale === */
const state = {
  role: 'guest',
  items: []
};

/* === Boot === */
document.addEventListener('DOMContentLoaded', async () => {
  try {
    log('DOM pronto, inizio setup…');
    bindUI();

    // ripristina sessione, se esiste
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      log('Sessione trovata:', session.user.id);
      await afterLogin(session.user.id);
    } else {
      log('Nessuna sessione, mostro login gate');
      showAuthGate(true);
    }

    // reagisci subito a login/logout
    supabase.auth.onAuthStateChange(async (event, sess) => {
      log('onAuthStateChange:', event);
      if (sess?.user) {
        await afterLogin(sess.user.id);
      } else {
        await afterLogout();
      }
    });
  } catch (e) {
    err('Errore init:', e);
    setMsg('loginMsg', 'Errore inizializzazione. Vedi console.');
  }
});

/* === UI === */
function bindUI() {
  const btnLogin = $('btnDoLogin');
  const btnReset = $('btnSendReset');
  const btnLogout = $('btnLogout');
  const btnLogoutM = $('btnLogoutM');

  if (btnLogin) {
    btnLogin.addEventListener('click', doLogin);
  }
  // invio con ENTER nei campi
  const emailEl = $('loginEmail');
  const passEl = $('loginPassword');
  [emailEl, passEl].forEach((el) => {
    if (!el) return;
    el.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        doLogin();
      }
    });
  });

  if (btnReset) {
    btnReset.addEventListener('click', sendReset);
  }
  if (btnLogout) {
    btnLogout.addEventListener('click', doLogout);
  }
  if (btnLogoutM) {
    btnLogoutM.addEventListener('click', doLogout);
  }

  // vista listino/card (opzionale)
  $('viewListino')?.addEventListener('click', () => {
    $('listinoContainer')?.classList.remove('hidden');
    $('productGrid')?.classList.add('hidden');
  });
  $('viewCard')?.addEventListener('click', () => {
    $('listinoContainer')?.classList.add('hidden');
    $('productGrid')?.classList.remove('hidden');
  });

  $('year') && ( $('year').textContent = new Date().getFullYear() );
}

/* === Azioni Auth === */
async function doLogin() {
  try {
    setMsg('loginMsg', 'Accesso in corso…');
    const email = $('loginEmail')?.value?.trim();
    const password = $('loginPassword')?.value || '';
    if (!email || !password) {
      setMsg('loginMsg', 'Inserisci email e password.');
      return;
    }
    log('Tentativo login con email/password…');
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      err('Login error:', error);
      setMsg('loginMsg', 'Accesso non riuscito: ' + error.message);
      return;
    }
    log('Login OK:', data.user?.id);
    // onAuthStateChange farà il resto, ma per immediatezza:
    await afterLogin(data.user.id);
  } catch (e) {
    err('doLogin exception:', e);
    setMsg('loginMsg', 'Errore accesso. Vedi console.');
  }
}

async function sendReset() {
  try {
    const email = $('loginEmail')?.value?.trim();
    if (!email) {
      setMsg('loginMsg', 'Inserisci la tua email per il reset.');
      return;
    }
    const site = window.location.origin + window.location.pathname; // torna qui
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: site
    });
    if (error) {
      err('reset error:', error);
      setMsg('loginMsg', 'Reset non riuscito: ' + error.message);
    } else {
      setMsg('loginMsg', 'Email di reset inviata.');
    }
  } catch (e) {
    err('sendReset exception:', e);
    setMsg('loginMsg', 'Errore reset. Vedi console.');
  }
}

async function doLogout() {
  try {
    await supabase.auth.signOut();
    await afterLogout();
  } catch (e) {
    err('Logout error:', e);
  }
}

/* === Dopo login / logout === */
async function afterLogin(userId) {
  try {
    // leggi ruolo (se esiste la tabella profiles con rls)
    let role = 'agent';
    const { data: prof, error: pErr } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', userId)
      .maybeSingle();
    if (!pErr && prof?.role) role = (prof.role === 'admin' ? 'admin' : 'agent');
    state.role = role;

    // mostra app, nascondi gate
    showAuthGate(false);

    // carica prodotti
    await fetchProducts();
  } catch (e) {
    err('afterLogin exception:', e);
    setMsg('loginMsg', 'Errore post-login. Vedi console.');
  }
}

async function afterLogout() {
  state.role = 'guest';
  state.items = [];
  showAuthGate(true);
  const grid = $('productGrid');
  const listino = $('listinoContainer');
  if (grid) grid.innerHTML = '';
  if (listino) listino.innerHTML = '';
}

/* === Dati === */
function formatEUR(n) {
  return (n == null || isNaN(n)) ? '—' : n.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' });
}

async function fetchProducts() {
  try {
    $('resultInfo') && ( $('resultInfo').textContent = 'Caricamento listino…' );
    const { data, error } = await supabase
      .from('products')
      .select('id,codice,descrizione,categoria,prezzo')
      .order('descrizione', { ascending: true });

    if (error) throw error;

    state.items = data || [];
    $('resultInfo') && ( $('resultInfo').textContent = `${state.items.length} articoli` );

    renderListinoSimple();
  } catch (e) {
    err('fetchProducts error:', e);
    $('resultInfo') && ( $('resultInfo').textContent = 'Errore caricamento listino' );
  }
}

/* === Render minimale (tabellare) === */
function renderListinoSimple() {
  const container = $('listinoContainer');
  if (!container) return;
  container.innerHTML = '';

  if (!state.items.length) {
    container.innerHTML = '<div class="text-slate-500">Nessun articolo.</div>';
    return;
  }

  // Group by categoria
  const byCat = new Map();
  for (const p of state.items) {
    const c = p.categoria || 'Altro';
    if (!byCat.has(c)) byCat.set(c, []);
    byCat.get(c).push(p);
  }

  const cats = [...byCat.keys()].sort((a,b)=>a.localeCompare(b,'it'));
  for (const cat of cats) {
    const h = document.createElement('h2');
    h.className = 'text-lg font-semibold mt-2 mb-1';
    h.textContent = cat;
    container.appendChild(h);

    const table = document.createElement('table');
    table.className = 'w-full text-sm border-collapse';
    table.innerHTML = `
      <thead class="bg-slate-100">
        <tr>
          <th class="border px-2 py-1 text-left">Codice</th>
          <th class="border px-2 py-1 text-left">Descrizione</th>
          <th class="border px-2 py-1 text-right">Prezzo</th>
        </tr>
      </thead>
      <tbody></tbody>`;
    const tb = table.querySelector('tbody');

    for (const p of (byCat.get(cat) || []).sort((a,b)=> (a.codice||'').localeCompare(b.codice||'','it'))) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="border px-2 py-1 whitespace-nowrap font-mono">${p.codice||''}</td>
        <td class="border px-2 py-1">${p.descrizione||''}</td>
        <td class="border px-2 py-1 text-right">${formatEUR(p.prezzo)}</td>`;
      tb.appendChild(tr);
    }
    container.appendChild(table);
  }
}
