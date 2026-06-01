// Pannello admin: storico, modifica articoli e aggiornamento mirato.
(function(){
  const SUPABASE_URL = 'https://wajzudbaezbyterpjdxg.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indhanp1ZGJhZXpieXRlcnBqZHhnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcxODA4MTUsImV4cCI6MjA3Mjc1NjgxNX0.MxaAqdUrppG2lObO_L5-SgDu8D7eze7mBf6S9rR_Q2w';

  const state = { client: null, rows: [] };
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
          <h4 class="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">Cerca e modifica articolo</h4>
          <div class="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
            <input id="adminSearchProduct" type="search" class="rounded-lg border px-3 py-2 text-sm" placeholder="Cerca codice o descrizione">
            <button id="btnAdminSearchProduct" class="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white">Cerca</button>
          </div>
          <div id="adminSearchResults" class="mt-2 space-y-1 text-xs"></div>

          <form id="adminProductForm" class="mt-3 hidden grid gap-2 md:grid-cols-2">
            <input id="adminOriginalCode" type="hidden">
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

  async function refreshProductsAfterAdminChange(){
    try {
      if (typeof window.fetchProducts === 'function') await window.fetchProducts();
      if (typeof window.renderView === 'function') window.renderView();
      document.dispatchEvent(new Event('appReady'));
    } catch (error) {
      console.warn('[AdminManage] refresh products warn', error);
    }
  }

  function fillForm(product){
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
  }

  function readForm(){
    return {
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
      setMessage(data.action === 'unchanged' ? 'Nessuna modifica da salvare.' : 'Articolo salvato e tracciato.', 'success');
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

  function headerScore(row){
    const cells = (row || []).map(normalize).filter(Boolean);
    let score = 0;
    if (cells.includes('codice articolo') || cells.includes('codice')) score += 5;
    if (cells.includes('descrizione')) score += 5;
    if (cells.includes('prezzo')) score += 2;
    return score;
  }

  function readExcelRows(sheet){
    const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false, blankrows: false });
    const best = matrix.slice(0, 30)
      .map((row, index) => ({ index, score: headerScore(row) }))
      .sort((a, b) => b.score - a.score)[0];
    const start = best?.score >= 10 ? best.index + 1 : 0;
    return matrix.slice(start)
      .filter((row) => String(row?.[0] || '').trim() && String(row?.[1] || '').trim())
      .filter((row) => !normalize(row[0]).includes('codice'))
      .map((row) => ({
        Codice: row[0] ?? '',
        Descrizione: row[1] ?? '',
        Unita: row[2] ?? '',
        Prezzo: row[3] ?? '',
        Conai: row[4] ?? '',
        Categoria: row[5] ?? '',
      }));
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
    state.rows = await readPartialFile(event.target.files?.[0]);
    const btn = $('btnAdminPartialImport');
    if (btn) btn.disabled = state.rows.length === 0;
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
    $('adminProductForm')?.classList.add('hidden');
    ['adminOriginalCode','adminProductCode','adminProductDescription','adminProductUnit','adminProductPrice','adminProductConai','adminProductPrintPrice','adminProductPrintMinQty','adminProductCategory','adminProductDimension'].forEach((id) => {
      const el = $(id);
      if (el) el.value = '';
    });
  }

  function clearImportFileState(){
    state.rows = [];
    const fileInput = $('adminImportFile');
    if (fileInput) fileInput.value = '';
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
    $('btnAdminSearchProduct')?.addEventListener('click', () => { void searchProduct(); });
    $('adminSearchProduct')?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        void searchProduct();
      }
    });
    $('adminProductForm')?.addEventListener('submit', saveProduct);
    $('btnAdminClearProduct')?.addEventListener('click', clearForm);
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
