// Pannello admin: storico, modifica articoli e aggiornamento mirato.
(function(){
  const SUPABASE_URL = 'https://wajzudbaezbyterpjdxg.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indhanp1ZGJhZXpieXRlcnBqZHhnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcxODA4MTUsImV4cCI6MjA3Mjc1NjgxNX0.MxaAqdUrppG2lObO_L5-SgDu8D7eze7mBf6S9rR_Q2w';
  const STORAGE_BUCKET = 'prodotti';
  const REQUIRED_SCHEMA = ['codice articolo', 'descrizione', '1 unita di misura', 'prezzo', 'conai', 'descrizione'];
  const IMPORT_SCHEMA_ID = 'adhoc_v1';

  const state = { client: null, rows: [], currentProduct: null, collections: [], currentCollectionId: '', pendingCollectionId: '' };
  const $ = (id) => document.getElementById(id);
  const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
  const normalize = (value) => String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();

  function ensureClient(){
    if (state.client) return state.client;
    if (!window.supabase?.createClient) return null;
    state.client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    return state.client;
  }

  function setMessage(message, tone = 'info'){
    const el = $('adminManageMsg');
    if (!el) return;
    el.textContent = message || '';
    el.className = 'text-xs ' + (
      tone === 'error' ? 'text-red-600' :
      tone === 'success' ? 'text-emerald-700' :
      'text-slate-600'
    );
  }

  function formatDate(value){
    try {
      return new Intl.DateTimeFormat('it-IT', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
    } catch (_) {
      return value || '-';
    }
  }

  function formatDecimal(value){
    if (value === null || value === undefined || value === '') return '';
    const n = Number(value);
    if (!Number.isFinite(n)) return String(value).replace('.', ',');
    return n.toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 4 });
  }

  function parseDecimal(value){
    const raw = String(value ?? '').trim();
    if (!raw) return null;
    const cleaned = raw.replace(/[^0-9,.-]/g, '').replace(/\s/g, '');
    if (!cleaned) return null;
    const lastComma = cleaned.lastIndexOf(',');
    const lastDot = cleaned.lastIndexOf('.');
    let normalized = cleaned;
    if (lastComma >= 0 && lastDot >= 0) {
      normalized = lastComma > lastDot ? cleaned.replace(/\./g, '').replace(',', '.') : cleaned.replace(/,/g, '');
    } else if (lastComma >= 0) {
      normalized = cleaned.replace(',', '.');
    }
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function mediaThumbPath(path){
    return String(path || '').replace('/large.', '/thumb.');
  }

  function mediaLargePath(path){
    return String(path || '').replace('/thumb.', '/large.');
  }

  async function imageBlobFromFile(file, maxSide, quality){
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();
    return await new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/webp', quality);
    });
  }

  function safeMediaName(value){
    return String(value || 'prodotto')
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'prodotto';
  }

  async function signedMediaThumbs(media){
    const client = ensureClient();
    const paths = [...new Set((media || []).map((item) => mediaThumbPath(item.path)).filter(Boolean))];
    const signedByPath = new Map();
    for (let i = 0; i < paths.length; i += 100) {
      const chunk = paths.slice(i, i + 100);
      const { data, error } = await client.storage.from(STORAGE_BUCKET).createSignedUrls(chunk, 600);
      if (error) {
        console.warn('[AdminMedia] signed warn', error.message);
        continue;
      }
      (data || []).forEach((row, index) => {
        if (row?.signedUrl) signedByPath.set(chunk[index], row.signedUrl);
      });
    }
    return signedByPath;
  }

  async function invokeAdmin(body){
    const client = ensureClient();
    if (!client) throw new Error('Supabase non pronto. Ricarica la pagina.');
    const { data: { session }, error: sessionError } = await client.auth.getSession();
    if (sessionError) throw sessionError;
    if (!session?.access_token) throw new Error('Sessione scaduta. Esci e rientra.');

    const response = await fetch(`${SUPABASE_URL}/functions/v1/admin_manage_products`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        authorization: `Bearer ${session.access_token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const rawText = await response.text();
    let data = null;
    try {
      data = rawText ? JSON.parse(rawText) : null;
    } catch (_) {
      data = null;
    }

    if (!response.ok || !data?.ok) {
      throw new Error(data?.error || rawText || `Errore funzione ${response.status}`);
    }

    return data;
  }

  function isAdminPanelVisible(){
    const panel = $('adminImportPanel');
    return !!panel && !panel.classList.contains('hidden');
  }

  function input(id, label, extra = ''){
    return `<label class="text-xs text-slate-600 ${extra}">${label}<input id="${id}" class="mt-1 w-full rounded-lg border px-3 py-2 text-sm"></label>`;
  }

  function ensurePanel(){
    if ($('adminManagePanel')) return $('adminManagePanel');
    const anchor = $('adminImportPanel');
    if (!anchor?.parentElement) return null;

    const panel = document.createElement('div');
    panel.id = 'adminManagePanel';
    panel.className = 'admin-panel hidden rounded-xl p-4 mb-4';
    panel.innerHTML = `
      <div class="flex flex-col gap-4">
        <div class="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 class="text-sm font-semibold text-slate-900">Gestione admin</h3>
            <p class="text-xs text-slate-600">Storico e modifica articoli.</p>
          </div>
          <div class="flex flex-wrap gap-2">
            <button id="btnAdminRefreshHistory" class="w-fit rounded-lg border bg-white px-3 py-2 text-xs font-medium text-slate-700">Aggiorna storico</button>
            <button id="btnAdminClearAllHistory" class="w-fit rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-medium text-red-700">Cancella tutto lo storico</button>
          </div>
        </div>

        <div class="rounded-lg border bg-white p-3">
          <h4 class="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">Storico</h4>
          <div id="adminHistoryList" class="space-y-2 text-xs text-slate-700">Caricamento storico...</div>
        </div>

        <div class="rounded-lg border bg-white p-3">
          <div class="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h4 class="text-xs font-semibold uppercase tracking-wide text-slate-600">Raccolte personalizzate</h4>
              <p class="text-xs text-slate-500">Gestisci i gruppi speciali visibili agli agenti nella barra categorie.</p>
            </div>
            <button id="btnAdminNewCollection" type="button" class="w-fit rounded-lg border bg-white px-3 py-2 text-xs font-medium text-slate-700">Nuova raccolta</button>
          </div>
          <div class="grid gap-3 lg:grid-cols-[minmax(220px,0.8fr)_minmax(0,1.2fr)]">
            <div id="adminCollectionsList" class="space-y-2 text-xs text-slate-700">Caricamento raccolte...</div>
            <form id="adminCollectionForm" class="grid gap-2 rounded-lg border bg-slate-50 p-3">
              <input id="adminCollectionId" type="hidden">
              <label class="text-xs text-slate-600">Nome raccolta
                <input id="adminCollectionName" class="mt-1 w-full rounded-lg border px-3 py-2 text-sm" placeholder="Es. Prodotti in stock">
              </label>
              <label class="text-xs text-slate-600">Descrizione
                <input id="adminCollectionDescription" class="mt-1 w-full rounded-lg border px-3 py-2 text-sm" placeholder="Testo interno per ricordare lo scopo">
              </label>
              <div class="grid gap-2 sm:grid-cols-[120px_1fr]">
                <label class="text-xs text-slate-600">Ordine
                  <input id="adminCollectionSort" type="number" class="mt-1 w-full rounded-lg border px-3 py-2 text-sm" value="0">
                </label>
                <div class="mt-6 grid gap-2">
                  <label class="inline-flex items-center gap-2 text-xs text-slate-700">
                    <input id="adminCollectionActive" type="checkbox" class="h-4 w-4 accent-emerald-600" checked> Visibile agli agenti
                  </label>
                  <label class="inline-flex items-center gap-2 text-xs text-slate-700">
                    <input id="adminCollectionHighlighted" type="checkbox" class="h-4 w-4 accent-emerald-600"> Evidenziata in alto
                  </label>
                </div>
              </div>
              <div class="flex flex-wrap gap-2">
                <button id="btnAdminSaveCollection" type="submit" class="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white">Salva raccolta</button>
                <button id="btnAdminDeleteCollection" type="button" class="hidden rounded-lg border border-red-200 bg-white px-4 py-2 text-sm text-red-700">Cancella raccolta</button>
              </div>
              <div id="adminCollectionItemsBox" class="hidden rounded-lg border bg-white p-3">
                <h5 class="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">Articoli nella raccolta</h5>
                <div class="grid gap-2 sm:grid-cols-[minmax(120px,0.5fr)_minmax(0,1fr)_auto]">
                  <input id="adminCollectionProductCode" class="rounded-lg border px-3 py-2 text-sm" placeholder="Codice articolo">
                  <input id="adminCollectionItemNote" class="rounded-lg border px-3 py-2 text-sm" placeholder="Nota opzionale">
                  <button id="btnAdminAddCollectionItem" type="button" class="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white">Aggiungi</button>
                </div>
                <button id="btnAdminCreateCollectionProduct" type="button" class="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800">Crea nuovo articolo per questa raccolta</button>
                <div id="adminCollectionItemsList" class="mt-3 space-y-2 text-xs text-slate-700"></div>
              </div>
            </form>
          </div>
        </div>

        <div class="rounded-lg border bg-white p-3">
          <h4 class="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">Cerca e modifica articolo</h4>
          <div class="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
            <input id="adminSearchProduct" type="search" class="rounded-lg border px-3 py-2 text-sm" placeholder="Cerca codice o descrizione">
            <button id="btnAdminSearchProduct" class="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white">Cerca</button>
          </div>
          <div id="adminSearchResults" class="mt-2 space-y-1 text-xs"></div>

          <form id="adminProductForm" class="mt-3 hidden grid gap-2 md:grid-cols-2">
            <input id="adminOriginalCode" type="hidden">
            <div id="adminProductCollectionHint" class="hidden md:col-span-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800"></div>
            ${input('adminProductCode', 'Codice')}
            ${input('adminProductDescription', 'Descrizione')}
            ${input('adminProductUnit', 'Unita')}
            ${input('adminProductPrice', 'Prezzo')}
            ${input('adminProductConai', 'CONAI')}
            ${input('adminProductPrintPrice', 'Prezzo stampato')}
            ${input('adminProductPrintMinQty', 'Q.t? minima stampa')}
            ${input('adminProductCategory', 'Categoria')}
            ${input('adminProductDimension', 'Dimensione', 'md:col-span-2')}
            <label class="inline-flex items-center gap-2 text-xs text-slate-700">
              <input id="adminProductAvailable" type="checkbox" class="h-4 w-4 accent-sky-600"> Disponibile
            </label>
            <label class="inline-flex items-center gap-2 text-xs text-slate-700">
              <input id="adminProductNew" type="checkbox" class="h-4 w-4 accent-sky-600"> Novita
            </label>
            <div class="md:col-span-2 flex flex-wrap gap-2">
              <button id="btnAdminSaveProduct" type="submit" class="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-300">Salva articolo</button>
              <button id="btnAdminClearProduct" type="button" class="rounded-lg border bg-white px-4 py-2 text-sm text-slate-700">Pulisci</button>
            </div>
            <div class="md:col-span-2 rounded-lg border bg-slate-50 p-3">
              <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h5 class="text-xs font-semibold uppercase tracking-wide text-slate-600">Immagini articolo</h5>
                  <p id="adminMediaHint" class="text-[11px] text-slate-500">Salva o seleziona un articolo, poi carica una o piu immagini.</p>
                </div>
                <label class="w-fit rounded-lg border bg-white px-3 py-2 text-xs font-medium text-slate-700">
                  Carica immagini
                  <input id="adminProductImages" type="file" accept="image/*" multiple class="hidden">
                </label>
              </div>
              <div id="adminProductMediaList" class="mt-3 flex flex-wrap gap-2 text-xs text-slate-600"></div>
            </div>
          </form>
        </div>
        <p id="adminManageMsg" class="text-xs text-slate-600"></p>
      </div>
    `;
    anchor.insertAdjacentElement('afterend', panel);
    bindPanel();
    return panel;
  }

  function syncVisibility(){
    const panel = ensurePanel();
    if (!panel) return;
    const visible = isAdminPanelVisible();
    panel.classList.toggle('hidden', !visible);
    if (visible && !panel.dataset.loaded) {
      panel.dataset.loaded = 'true';
      loadHistory();
      loadCollections();
    }
  }

  async function deleteHistory(targetType, id){
    try {
      if (!window.confirm('Cancellare questa riga di storico? I dati articoli non vengono ripristinati, viene eliminata solo la traccia storica.')) return;
      setMessage('Cancellazione storico...');
      await invokeAdmin({ action: 'delete_history', target_type: targetType, id });
      setMessage('Storico cancellato.', 'success');
      await loadHistory();
    } catch (error) {
      setMessage(error?.message || 'Errore cancellazione storico.', 'error');
    }
  }

  async function deleteAllHistory(){
    try {
      if (!window.confirm('Cancellare tutto lo storico? Gli articoli e i prezzi attuali restano invariati.')) return;
      if (!window.confirm('Confermi davvero la cancellazione di tutto lo storico?')) return;
      setMessage('Cancellazione di tutto lo storico...');
      await invokeAdmin({ action: 'delete_history', target_type: 'all' });
      setMessage('Storico cancellato. Il listino corrente e stato mantenuto.', 'success');
      await loadHistory();
    } catch (error) {
      setMessage(error?.message || 'Errore cancellazione storico.', 'error');
    }
  }

  function deleteButton(targetType, id){
    return `<button type="button" data-history-type="${targetType}" data-history-id="${escapeHtml(id)}" class="rounded-md border px-2 py-1 text-[11px] text-red-700 hover:bg-red-50">Cancella storico</button>`;
  }

  function renderHistory(data){
    const el = $('adminHistoryList');
    if (!el) return;
    const fullImports = data?.full_imports || [];
    const changes = data?.changes || [];
    if (!fullImports.length && !changes.length) {
      el.textContent = 'Nessuno storico disponibile.';
      return;
    }

    const blocks = [];
    fullImports.slice(0, 8).forEach((item) => {
      blocks.push(`
        <div class="rounded-md border border-slate-100 p-2">
          <div class="flex items-start justify-between gap-2">
            <div>
              <div class="font-semibold text-slate-900">Import listino ${escapeHtml(item.version_label || '')}</div>
              <div>${escapeHtml(formatDate(item.published_at))} - nuovi ${item.created || 0}, aggiornati ${item.updated || 0}, invariati non conteggiati, ritirati ${item.removed || 0}</div>
            </div>
            ${deleteButton('price_list', item.id)}
          </div>
          <div class="mt-1 text-slate-500">${escapeHtml((item.codes || []).slice(0, 12).join(', '))}${(item.codes || []).length > 12 ? '...' : ''}</div>
        </div>
      `);
    });
    changes.slice(0, 8).forEach((item) => {
      const codes = (item.admin_change_items || []).map((row) => row.new_codice);
      blocks.push(`
        <div class="rounded-md border border-slate-100 p-2">
          <div class="flex items-start justify-between gap-2">
            <div>
              <div class="font-semibold text-slate-900">${item.action_type === 'partial_import' ? 'Aggiornamento codici del file' : 'Modifica manuale'}</div>
              <div>${escapeHtml(formatDate(item.created_at))} - ${item.item_count || 0} codici modificati, ${item.unchanged_count || 0} invariati</div>
            </div>
            ${deleteButton('admin_batch', item.id)}
          </div>
          <div class="mt-1 text-slate-500">${escapeHtml(codes.slice(0, 12).join(', '))}${codes.length > 12 ? '...' : ''}</div>
        </div>
      `);
    });
    el.innerHTML = blocks.join('');
    Array.from(el.querySelectorAll('[data-history-id]')).forEach((button) => {
      button.addEventListener('click', () => {
        void deleteHistory(button.dataset.historyType, button.dataset.historyId);
      });
    });
  }

  async function loadHistory(){
    try {
      const el = $('adminHistoryList');
      if (el) el.textContent = 'Caricamento storico...';
      renderHistory(await invokeAdmin({ action: 'history' }));
    } catch (error) {
      const el = $('adminHistoryList');
      if (el) el.textContent = error?.message || 'Errore caricamento storico.';
    }
  }

  function currentCollection(){
    return state.collections.find((collection) => collection.id === state.currentCollectionId) || null;
  }

  function clearCollectionForm(){
    state.currentCollectionId = '';
    ['adminCollectionId','adminCollectionName','adminCollectionDescription','adminCollectionProductCode','adminCollectionItemNote'].forEach((id) => {
      const el = $(id);
      if (el) el.value = '';
    });
    const sort = $('adminCollectionSort');
    if (sort) sort.value = '0';
    const active = $('adminCollectionActive');
    if (active) active.checked = true;
    const highlighted = $('adminCollectionHighlighted');
    if (highlighted) highlighted.checked = false;
    $('btnAdminDeleteCollection')?.classList.add('hidden');
    $('adminCollectionItemsBox')?.classList.add('hidden');
    const list = $('adminCollectionItemsList');
    if (list) list.textContent = 'Salva la raccolta, poi aggiungi gli articoli.';
    renderCollections();
  }

  function fillCollectionForm(collection){
    state.currentCollectionId = collection?.id || '';
    if ($('adminCollectionId')) $('adminCollectionId').value = collection?.id || '';
    if ($('adminCollectionName')) $('adminCollectionName').value = collection?.name || '';
    if ($('adminCollectionDescription')) $('adminCollectionDescription').value = collection?.description || '';
    if ($('adminCollectionSort')) $('adminCollectionSort').value = String(collection?.sort ?? 0);
    if ($('adminCollectionActive')) $('adminCollectionActive').checked = collection?.active !== false;
    if ($('adminCollectionHighlighted')) $('adminCollectionHighlighted').checked = !!collection?.highlighted;
    $('btnAdminDeleteCollection')?.classList.toggle('hidden', !collection?.id);
    $('adminCollectionItemsBox')?.classList.toggle('hidden', !collection?.id);
    renderCollections();
    renderCollectionItems(collection);
  }

  function renderCollectionItems(collection = currentCollection()){
    const el = $('adminCollectionItemsList');
    if (!el) return;
    const items = (collection?.custom_collection_items || [])
      .slice()
      .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));

    if (!collection?.id) {
      el.textContent = 'Salva la raccolta, poi aggiungi gli articoli.';
      return;
    }
    if (!items.length) {
      el.textContent = 'Nessun articolo inserito in questa raccolta.';
      return;
    }

    el.innerHTML = items.map((item) => {
      const product = item.products || {};
      return `
        <div class="flex flex-col gap-2 rounded-md border border-slate-100 p-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div class="font-semibold text-slate-900">${escapeHtml(product.codice || '')} - ${escapeHtml(product.descrizione || '')}</div>
            <div class="text-slate-500">${escapeHtml(product.categoria || '')}${item.note ? ` - ${escapeHtml(item.note)}` : ''}</div>
          </div>
          <button type="button" data-collection-item-id="${escapeHtml(item.id)}" class="w-fit rounded-md border px-2 py-1 text-[11px] text-red-700 hover:bg-red-50">Rimuovi</button>
        </div>
      `;
    }).join('');

    Array.from(el.querySelectorAll('[data-collection-item-id]')).forEach((button) => {
      button.addEventListener('click', () => {
        void removeCollectionItem(button.dataset.collectionItemId);
      });
    });
  }

  function renderCollections(data){
    if (data?.collections) state.collections = data.collections;
    const el = $('adminCollectionsList');
    if (!el) return;
    if (!state.collections.length) {
      el.textContent = 'Nessuna raccolta creata.';
      renderCollectionItems();
      return;
    }

    el.innerHTML = state.collections.map((collection) => {
      const count = (collection.custom_collection_items || []).length;
      const selected = state.currentCollectionId === collection.id;
      return `
        <button type="button" data-collection-id="${escapeHtml(collection.id)}" class="block w-full rounded-lg border px-3 py-2 text-left ${selected ? 'border-emerald-300 bg-emerald-50' : 'bg-white hover:bg-slate-50'}">
          <div class="flex items-center justify-between gap-2">
            <span class="font-semibold text-slate-900">${escapeHtml(collection.name)}</span>
            <span class="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">${count}</span>
          </div>
          <div class="mt-1 text-slate-500">${collection.active ? 'Visibile' : 'Nascosta'}${collection.highlighted ? ' - evidenziata' : ''} - ordine ${escapeHtml(collection.sort ?? 0)}</div>
        </button>
      `;
    }).join('');

    Array.from(el.querySelectorAll('[data-collection-id]')).forEach((button) => {
      button.addEventListener('click', () => {
        const collection = state.collections.find((item) => item.id === button.dataset.collectionId);
        fillCollectionForm(collection);
      });
    });

    const selected = currentCollection();
    if (state.currentCollectionId && !selected) clearCollectionForm();
    else renderCollectionItems(selected);
  }

  async function loadCollections(){
    try {
      const el = $('adminCollectionsList');
      if (el) el.textContent = 'Caricamento raccolte...';
      renderCollections(await invokeAdmin({ action: 'collections' }));
    } catch (error) {
      const el = $('adminCollectionsList');
      if (el) el.textContent = error?.message || 'Errore caricamento raccolte.';
    }
  }

  async function saveCollection(event){
    event?.preventDefault();
    try {
      const collection = {
        id: $('adminCollectionId')?.value || '',
        name: $('adminCollectionName')?.value || '',
        description: $('adminCollectionDescription')?.value || '',
        sort: $('adminCollectionSort')?.value || '0',
        active: !!$('adminCollectionActive')?.checked,
        highlighted: !!$('adminCollectionHighlighted')?.checked,
      };
      const data = await invokeAdmin({ action: 'save_collection', collection });
      renderCollections(data);
      const saved = (data.collections || []).find((item) => item.name === collection.name) || (data.collections || [])[0];
      if (saved) fillCollectionForm(saved);
      setMessage('Raccolta salvata.', 'success');
      await refreshProductsAfterAdminChange();
    } catch (error) {
      setMessage(error?.message || 'Errore salvataggio raccolta.', 'error');
    }
  }

  async function deleteCollection(){
    try {
      const id = $('adminCollectionId')?.value || '';
      if (!id) return;
      if (!window.confirm('Cancellare questa raccolta? Gli articoli non vengono eliminati dal listino.')) return;
      renderCollections(await invokeAdmin({ action: 'delete_collection', id }));
      clearCollectionForm();
      setMessage('Raccolta cancellata.', 'success');
      await refreshProductsAfterAdminChange();
    } catch (error) {
      setMessage(error?.message || 'Errore cancellazione raccolta.', 'error');
    }
  }

  async function addCollectionItem(){
    try {
      const collectionId = $('adminCollectionId')?.value || '';
      const codice = $('adminCollectionProductCode')?.value || '';
      const note = $('adminCollectionItemNote')?.value || '';
      const data = await invokeAdmin({ action: 'add_collection_item', collection_id: collectionId, codice, note });
      renderCollections(data);
      const selected = (data.collections || []).find((item) => item.id === collectionId);
      if (selected) fillCollectionForm(selected);
      if ($('adminCollectionProductCode')) $('adminCollectionProductCode').value = '';
      if ($('adminCollectionItemNote')) $('adminCollectionItemNote').value = '';
      setMessage('Articolo aggiunto alla raccolta.', 'success');
      await refreshProductsAfterAdminChange();
    } catch (error) {
      setMessage(error?.message || 'Errore aggiunta articolo alla raccolta.', 'error');
    }
  }

  function createCollectionProduct(){
    const collection = currentCollection();
    if (!collection?.id) {
      setMessage('Prima seleziona o salva una raccolta.', 'error');
      return;
    }
    state.pendingCollectionId = collection.id;
    fillForm({
      codice: '',
      descrizione: '',
      categoria: '',
      unita: 'pz',
      disponibile: true,
      novita: collection.slug === 'nuovi-prodotti',
    });
    const productSection = $('adminProductForm');
    productSection?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    $('adminProductCode')?.focus();
    setMessage(`Compila il nuovo articolo: al salvataggio sara inserito in "${collection.name}".`);
  }

  async function removeCollectionItem(itemId){
    try {
      const collectionId = state.currentCollectionId;
      const data = await invokeAdmin({ action: 'remove_collection_item', item_id: itemId });
      renderCollections(data);
      const selected = (data.collections || []).find((item) => item.id === collectionId);
      if (selected) fillCollectionForm(selected);
      setMessage('Articolo rimosso dalla raccolta.', 'success');
      await refreshProductsAfterAdminChange();
    } catch (error) {
      setMessage(error?.message || 'Errore rimozione articolo.', 'error');
    }
  }

  async function refreshProductsAfterAdminChange(){
    try {
      if (typeof window.fetchProducts === 'function') await window.fetchProducts();
      if (typeof window.renderView === 'function') window.renderView();
      document.dispatchEvent(new Event('appReady'));
    } catch (error) {
      console.warn('[AdminManage] refresh products warn', error);
    }
  }

  async function renderProductMedia(product = state.currentProduct){
    const list = $('adminProductMediaList');
    const hint = $('adminMediaHint');
    if (!list) return;
    const media = (product?.product_media || [])
      .filter((item) => item.kind === 'image' && item.path)
      .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));

    if (hint) {
      hint.textContent = product?.id
        ? 'Carica una o piu immagini: il sistema crea miniatura e immagine grande.'
        : 'Salva o seleziona un articolo, poi carica una o piu immagini.';
    }
    if (!product?.id) {
      list.innerHTML = '<span>Articolo non ancora salvato.</span>';
      return;
    }
    if (!media.length) {
      list.innerHTML = '<span>Nessuna immagine caricata.</span>';
      return;
    }

    const signed = await signedMediaThumbs(media);
    list.innerHTML = media.map((item, index) => {
      const thumb = signed.get(mediaThumbPath(item.path)) || '';
      return `
        <div class="relative h-20 w-20 overflow-hidden rounded-lg border bg-white">
          ${thumb ? `<img src="${thumb}" alt="" class="h-full w-full object-cover">` : `<div class="grid h-full place-content-center text-[11px]">${index + 1}</div>`}
          <button type="button" data-media-id="${escapeHtml(item.id)}" data-media-path="${escapeHtml(item.path)}" class="absolute right-1 top-1 rounded bg-white/90 px-1 text-[10px] text-red-700">X</button>
        </div>
      `;
    }).join('');

    Array.from(list.querySelectorAll('[data-media-id]')).forEach((button) => {
      button.addEventListener('click', () => {
        void deleteProductImage(button.getAttribute('data-media-id'), button.getAttribute('data-media-path'));
      });
    });
  }

  function fillForm(product){
    state.currentProduct = product || null;
    $('adminProductForm')?.classList.remove('hidden');
    $('adminOriginalCode').value = product.codice || '';
    $('adminProductCode').value = product.codice || '';
    $('adminProductDescription').value = product.descrizione || '';
    $('adminProductUnit').value = product.unita || '';
    $('adminProductPrice').value = formatDecimal(product.prezzo);
    $('adminProductConai').value = formatDecimal(product.conai ?? product.conai_per_collo);
    $('adminProductPrintPrice').value = formatDecimal(product.prezzo_stampa);
    $('adminProductPrintMinQty').value = product.quantita_minima_stampa ?? '';
    $('adminProductCategory').value = product.categoria || '';
    $('adminProductDimension').value = product.dimensione || '';
    $('adminProductAvailable').checked = product.disponibile !== false;
    $('adminProductNew').checked = !!product.novita;
    updateProductCollectionHint();
    void renderProductMedia(product);
  }

  function updateProductCollectionHint(){
    const hint = $('adminProductCollectionHint');
    if (!hint) return;
    const collection = state.collections.find((item) => item.id === state.pendingCollectionId);
    if (!collection) {
      hint.classList.add('hidden');
      hint.textContent = '';
      return;
    }
    hint.classList.remove('hidden');
    hint.textContent = `Questo articolo verra inserito nella raccolta "${collection.name}" dopo il salvataggio.`;
  }

  function readForm(){
    const product = {
      codice: $('adminProductCode')?.value || '',
      descrizione: $('adminProductDescription')?.value || '',
      unita: $('adminProductUnit')?.value || '',
      prezzo: $('adminProductPrice')?.value || '',
      conai: $('adminProductConai')?.value || '',
      prezzo_stampa: $('adminProductPrintPrice')?.value || '',
      quantita_minima_stampa: $('adminProductPrintMinQty')?.value || '',
      categoria: $('adminProductCategory')?.value || '',
      dimensione: $('adminProductDimension')?.value || '',
      disponibile: !!$('adminProductAvailable')?.checked,
      novita: !!$('adminProductNew')?.checked,
    };
    const originalCode = $('adminOriginalCode')?.value || '';
    if (!originalCode) {
      product.source = state.pendingCollectionId ? 'manuale_raccolta' : 'manuale';
    }
    return product;
  }

  async function uploadProductImages(event){
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!files.length) return;
    const client = ensureClient();
    const product = state.currentProduct;
    if (!client || !product?.id) {
      setMessage('Prima salva o seleziona un articolo, poi carica le immagini.', 'error');
      return;
    }

    try {
      setMessage('Caricamento immagini in corso...');
      const currentMedia = (product.product_media || []).filter((item) => item.kind === 'image');
      let nextSort = currentMedia.reduce((max, item) => Math.max(max, Number(item.sort) || 0), 0) + 1;
      const inserted = [];
      const baseName = safeMediaName(product.codice || product.id);

      for (const file of files) {
        if (!file.type?.startsWith('image/')) continue;
        const stamp = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
        const folder = `products/${baseName}/${stamp}`;
        const largePath = `${folder}/large.webp`;
        const thumbPath = `${folder}/thumb.webp`;
        const [largeBlob, thumbBlob] = await Promise.all([
          imageBlobFromFile(file, 1200, 0.8),
          imageBlobFromFile(file, 320, 0.72),
        ]);

        const largeUpload = await client.storage.from(STORAGE_BUCKET).upload(largePath, largeBlob, {
          contentType: 'image/webp',
          upsert: true,
        });
        if (largeUpload.error) throw largeUpload.error;

        const thumbUpload = await client.storage.from(STORAGE_BUCKET).upload(thumbPath, thumbBlob, {
          contentType: 'image/webp',
          upsert: true,
        });
        if (thumbUpload.error) throw thumbUpload.error;

        const { data, error } = await client
          .from('product_media')
          .insert({ product_id: product.id, kind: 'image', path: largePath, sort: nextSort++ })
          .select('id,kind,path,sort')
          .single();
        if (error) throw error;
        inserted.push(data);
      }

      state.currentProduct.product_media = [...currentMedia, ...inserted];
      await renderProductMedia();
      await refreshProductsAfterAdminChange();
      setMessage(inserted.length ? `Immagini caricate: ${inserted.length}.` : 'Nessuna immagine valida caricata.', inserted.length ? 'success' : 'error');
    } catch (error) {
      setMessage(error?.message || 'Errore caricamento immagini.', 'error');
    }
  }

  async function deleteProductImage(id, path){
    const client = ensureClient();
    if (!client || !id) return;
    try {
      if (!window.confirm('Cancellare questa immagine articolo?')) return;
      setMessage('Cancellazione immagine...');
      const largePath = mediaLargePath(path);
      const thumbPath = mediaThumbPath(path);
      const { error: storageError } = await client.storage.from(STORAGE_BUCKET).remove([largePath, thumbPath]);
      if (storageError) console.warn('[AdminMedia] storage remove warn', storageError.message);
      const { error } = await client.from('product_media').delete().eq('id', id);
      if (error) throw error;
      if (state.currentProduct?.product_media) {
        state.currentProduct.product_media = state.currentProduct.product_media.filter((item) => item.id !== id);
      }
      await renderProductMedia();
      await refreshProductsAfterAdminChange();
      setMessage('Immagine cancellata.', 'success');
    } catch (error) {
      setMessage(error?.message || 'Errore cancellazione immagine.', 'error');
    }
  }

  async function searchProduct(){
    try {
      const query = $('adminSearchProduct')?.value || '';
      setMessage('Ricerca articolo...');
      const data = await invokeAdmin({ action: 'search', query });
      const products = data.products || [];
      const results = $('adminSearchResults');
      if (!results) return;
      if (!products.length) {
        results.innerHTML = '<div class="text-slate-500">Nessun articolo trovato. Puoi compilarlo come nuovo.</div>';
        fillForm({ codice: query, disponibile: true });
        setMessage('');
        return;
      }
      results.innerHTML = products.map((product, index) => `
        <button type="button" data-index="${index}" class="block w-full rounded-md border bg-white px-2 py-2 text-left hover:bg-slate-50">
          <span class="font-semibold">${escapeHtml(product.codice)}</span> - ${escapeHtml(product.descrizione || '')}
        </button>
      `).join('');
      Array.from(results.querySelectorAll('button')).forEach((btn) => {
        btn.addEventListener('click', () => fillForm(products[Number(btn.dataset.index)]));
      });
      fillForm(products[0]);
      setMessage('');
    } catch (error) {
      setMessage(error?.message || 'Errore ricerca articolo.', 'error');
    }
  }

  async function saveProduct(event){
    event.preventDefault();
    const btn = $('btnAdminSaveProduct');
    try {
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Salvataggio...';
      }
      setMessage('Salvataggio articolo...');
      const data = await invokeAdmin({
        action: 'save_product',
        original_codice: $('adminOriginalCode')?.value || '',
        product: readForm(),
      });
      if (data.product) fillForm(data.product);
      if (data.product?.codice) $('adminOriginalCode').value = data.product.codice;
      let linkedCollectionName = '';
      if (state.pendingCollectionId && data.product?.codice) {
        const collectionId = state.pendingCollectionId;
        const collection = state.collections.find((item) => item.id === collectionId);
        const collectionData = await invokeAdmin({
          action: 'add_collection_item',
          collection_id: collectionId,
          codice: data.product.codice,
        });
        renderCollections(collectionData);
        const selected = (collectionData.collections || []).find((item) => item.id === collectionId);
        if (selected) fillCollectionForm(selected);
        linkedCollectionName = collection?.name || selected?.name || '';
        state.pendingCollectionId = '';
        updateProductCollectionHint();
      }
      const baseMessage = data.action === 'unchanged' ? 'Nessuna modifica da salvare.' : 'Articolo salvato e tracciato.';
      setMessage(linkedCollectionName ? `${baseMessage} Inserito nella raccolta "${linkedCollectionName}".` : baseMessage, 'success');
      await loadHistory();
      await refreshProductsAfterAdminChange();
    } catch (error) {
      setMessage(error?.message || 'Errore salvataggio articolo.', 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Salva articolo';
      }
    }
  }

  function readExcelRows(sheet){
    const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false, blankrows: false });
    const headerIndex = matrix.findIndex((row) => {
      const cells = (row || []).slice(0, REQUIRED_SCHEMA.length).map(normalize);
      return REQUIRED_SCHEMA.every((expected, index) => cells[index] === expected);
    });
    if (headerIndex < 0) {
      throw new Error('Struttura file non valida. Il listino deve avere queste colonne, in questo ordine: Codice articolo, Descrizione, 1^ Unita di misura, Prezzo, Conai, Descrizione.');
    }
    const rows = matrix.slice(headerIndex + 1)
      .filter((row) => String(row?.[0] || '').trim() && String(row?.[1] || '').trim())
      .map((row) => ({
        Codice: row[0] ?? '',
        Descrizione: row[1] ?? '',
        Unita: row[2] ?? '',
        Prezzo: row[3] ?? '',
        Conai: row[4] ?? '',
        Categoria: row[5] ?? '',
        import_schema: IMPORT_SCHEMA_ID,
      }));
    const invalid = rows.find((row) => !String(row.Unita || '').trim() || !String(row.Categoria || '').trim() || parseDecimal(row.Prezzo) === null || parseDecimal(row.Conai) === null);
    if (invalid) throw new Error('Struttura file valida, ma alcune righe non hanno Unita, Prezzo, Conai o Categoria.');
    return rows;
  }

  async function readPartialFile(file){
    if (!file || !window.XLSX) return [];
    const extension = file.name.split('.').pop()?.toLowerCase();
    const workbook = extension === 'csv'
      ? XLSX.read(await file.text(), { type: 'string' })
      : XLSX.read(await file.arrayBuffer(), { type: 'array' });
    return readExcelRows(workbook.Sheets[workbook.SheetNames[0]]);
  }

  async function handleFileChange(event){
    try {
      state.rows = await readPartialFile(event.target.files?.[0]);
      setMessage(state.rows.length ? `${state.rows.length} righe pronte per aggiornamento codici.` : '');
    } catch (error) {
      state.rows = [];
      setMessage(error?.message || 'Struttura file non valida.', 'error');
    } finally {
      const btn = $('btnAdminPartialImport');
      if (btn) btn.disabled = state.rows.length === 0;
    }
  }

  async function partialImport(){
    const btn = $('btnAdminPartialImport');
    try {
      if (!state.rows.length) {
        setMessage('Carica prima un file con gli articoli da aggiornare.', 'error');
        return;
      }
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Aggiornamento...';
      }
      setMessage('Aggiornamento mirato in corso... aggiorno solo i codici del file.');
      const data = await invokeAdmin({
        action: 'partial_import',
        label: $('adminVersionLabel')?.value || 'Aggiornamento codici del file',
        rows: state.rows,
        import_schema: IMPORT_SCHEMA_ID,
      });
      setMessage(`Aggiornamento completato: ${data.changed} modificati, ${data.unchanged} invariati.`, 'success');
      await loadHistory();
      await refreshProductsAfterAdminChange();
      clearImportFileState();
    } catch (error) {
      setMessage(error?.message || 'Errore aggiornamento codici del file.', 'error');
    } finally {
      if (btn) {
        btn.textContent = 'Aggiorna solo codici';
        btn.disabled = state.rows.length === 0;
      }
    }
  }

  function clearForm(){
    state.currentProduct = null;
    state.pendingCollectionId = '';
    $('adminProductForm')?.classList.add('hidden');
    ['adminOriginalCode','adminProductCode','adminProductDescription','adminProductUnit','adminProductPrice','adminProductConai','adminProductPrintPrice','adminProductPrintMinQty','adminProductCategory','adminProductDimension'].forEach((id) => {
      const el = $(id);
      if (el) el.value = '';
    });
    const mediaList = $('adminProductMediaList');
    if (mediaList) mediaList.innerHTML = '';
    updateProductCollectionHint();
  }

  function clearImportFileState(){
    state.rows = [];
    const fileInput = $('adminImportFile');
    if (fileInput) fileInput.value = '';
    const fileName = $('adminSelectedFileName');
    if (fileName) {
      fileName.textContent = '';
      fileName.classList.add('hidden');
    }
    const version = $('adminVersionLabel');
    if (version) version.value = '';
    const count = $('adminImportCount');
    if (count) count.textContent = '0';
    const preview = $('adminImportPreview');
    if (preview) {
      preview.innerHTML = '';
      preview.classList.add('hidden');
    }
    const btn = $('btnAdminPartialImport');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Aggiorna solo codici';
    }
  }

  function bindPanel(){
    $('btnAdminRefreshHistory')?.addEventListener('click', () => { void loadHistory(); });
    $('btnAdminClearAllHistory')?.addEventListener('click', () => { void deleteAllHistory(); });
    $('btnAdminNewCollection')?.addEventListener('click', clearCollectionForm);
    $('adminCollectionForm')?.addEventListener('submit', saveCollection);
    $('btnAdminDeleteCollection')?.addEventListener('click', () => { void deleteCollection(); });
    $('btnAdminAddCollectionItem')?.addEventListener('click', () => { void addCollectionItem(); });
    $('btnAdminCreateCollectionProduct')?.addEventListener('click', createCollectionProduct);
    $('adminCollectionProductCode')?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        void addCollectionItem();
      }
    });
    $('btnAdminSearchProduct')?.addEventListener('click', () => { void searchProduct(); });
    $('adminSearchProduct')?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        void searchProduct();
      }
    });
    $('adminProductForm')?.addEventListener('submit', saveProduct);
    $('btnAdminClearProduct')?.addEventListener('click', clearForm);
    $('adminProductImages')?.addEventListener('change', (event) => { void uploadProductImages(event); });
    $('btnAdminPartialImport')?.addEventListener('click', () => { void partialImport(); });
    $('adminImportFile')?.addEventListener('change', (event) => { void handleFileChange(event); });
  }

  function init(){
    ensurePanel();
    syncVisibility();
    setInterval(syncVisibility, 1000);
    document.addEventListener('appReady', syncVisibility);
    document.addEventListener('appHidden', syncVisibility);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
