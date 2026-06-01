// Admin import listino da Excel/CSV.
(function(){
  const SUPABASE_URL = 'https://wajzudbaezbyterpjdxg.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indhanp1ZGJhZXpieXRlcnBqZHhnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcxODA4MTUsImV4cCI6MjA3Mjc1NjgxNX0.MxaAqdUrppG2lObO_L5-SgDu8D7eze7mBf6S9rR_Q2w';

  const FIELD_ALIASES = {
    Codice: ['codice', 'codice articolo', 'cod. articolo', 'cod articolo', 'cod_articolo', 'articolo', 'sku', 'code'],
    Descrizione: ['descrizione', 'descrizione articolo', 'desc', 'description'],
    Categoria: ['categoria', 'cat', 'famiglia', 'gruppo merceologico', 'gruppo', 'descrizione 1', 'descrizione_1', 'descrizione gruppo', 'descrizione gruppo merceologico'],
    Sottocategoria: ['sottocategoria', 'sotto categoria', 'subcategoria', 'linea'],
    Prezzo: ['prezzo', 'prezzo articolo', 'prezzo listino', 'prezzo vendita', 'listino', 'price'],
    Unita: ['unita', 'unità', '1 unita di misura', '1^ unita di misura', '1^ unità di misura', 'unita misura', 'unità di misura', 'unita di misura', 'um', 'u.m.'],
    Disponibile: ['disponibile', 'attivo', 'abilitato', 'visibile'],
    Novita: ['novita', 'new', 'nuovo'],
    Pack: ['pack', 'imballo', 'conf', 'confezione'],
    Pallet: ['pallet', 'bancale'],
    Tag: ['tag', 'tags', 'etichette'],
    Dimensione: ['dimensione', 'dimensioni', 'misure', 'formato'],
    Conai: ['conai', 'conai articolo', 'conai/collo', 'conai collo'],
    ConaiPerCollo: ['conai per collo', 'conai_per_collo', 'conai/collo'],
  };

  const state = { rows: [], duplicateCodes: [], client: null };
  const $ = (id) => document.getElementById(id);
  const normalize = (value) => String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();
  const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  function ensureClient(){
    if (state.client) return state.client;
    if (!window.supabase?.createClient) return null;
    state.client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    return state.client;
  }

  function setMessage(message, tone = 'info'){
    const el = $('adminImportMsg');
    if (!el) return;
    el.textContent = message || '';
    el.className = 'text-xs ' + (
      tone === 'error' ? 'text-red-600' :
      tone === 'success' ? 'text-emerald-700' :
      'text-slate-600'
    );
  }

  function setPublishBusy(isBusy){
    const btn = $('btnPublishPriceList');
    if (!btn) return;
    btn.disabled = isBusy || state.rows.length === 0;
    btn.textContent = isBusy ? 'Pubblicazione...' : 'Pubblica listino completo';
  }

  function formatImportDate(value){
    try {
      return new Intl.DateTimeFormat('it-IT', {
        dateStyle: 'short',
        timeStyle: 'short',
      }).format(new Date(value));
    } catch (_) {
      return value || '-';
    }
  }

  function ensureLastImportBox(){
    let box = $('adminLastImport');
    if (box) return box;
    const msg = $('adminImportMsg');
    if (!msg?.parentElement) return null;
    box = document.createElement('div');
    box.id = 'adminLastImport';
    box.className = 'hidden rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700';
    msg.parentElement.insertBefore(box, msg);
    return box;
  }

  function renderLastImport(record){
    const box = ensureLastImportBox();
    if (!box) return;
    if (!record) {
      box.classList.add('hidden');
      box.innerHTML = '';
      return;
    }
    box.classList.remove('hidden');
    box.innerHTML = `
      <div class="font-semibold text-slate-900">Ultimo import eseguito</div>
      <div class="mt-1 grid gap-1 sm:grid-cols-2">
        <div><span class="text-slate-500">Data:</span> ${escapeHtml(formatImportDate(record.at))}</div>
        <div><span class="text-slate-500">Versione:</span> ${escapeHtml(record.version || '-')}</div>
        <div><span class="text-slate-500">Righe inviate:</span> ${escapeHtml(record.rows ?? '-')}</div>
        <div><span class="text-slate-500">Esito:</span> nuovi ${escapeHtml(record.created ?? 0)}, aggiornati ${escapeHtml(record.updated ?? 0)}, invariati ${escapeHtml(record.unchanged ?? 0)}</div>
      </div>
      ${record.ignoredDuplicates ? `<div class="mt-1 text-amber-700">Duplicati ignorati: ${escapeHtml(record.ignoredDuplicates)}</div>` : ''}
    `;
  }

  function saveLastImport(record){
    try {
      localStorage.setItem('tecnobox:lastPriceListImport', JSON.stringify(record));
    } catch (_) {}
    renderLastImport(record);
  }

  function loadLastImport(){
    try {
      const raw = localStorage.getItem('tecnobox:lastPriceListImport');
      renderLastImport(raw ? JSON.parse(raw) : null);
    } catch (_) {
      renderLastImport(null);
    }
  }

  function setPanelVisible(visible){
    $('adminImportPanel')?.classList.toggle('hidden', !visible);
    $('adminImportRoleBadge')?.classList.toggle('hidden', !visible);
  }

  async function refreshRole(){
    const client = ensureClient();
    if (!client) return;
    const { data: { session } } = await client.auth.getSession();
    if (!session?.user) {
      setPanelVisible(false);
      return;
    }
    const { data: profile } = await client
      .from('profiles')
      .select('role')
      .eq('id', session.user.id)
      .maybeSingle();
    setPanelVisible(profile?.role === 'admin');
  }

  function setSelectedFileName(name){
    const el = $('adminSelectedFileName');
    if (!el) return;
    el.textContent = name ? `File selezionato: ${name}` : '';
    el.classList.toggle('hidden', !name);
  }

  function clearImport(options = {}){
    state.rows = [];
    state.duplicateCodes = [];
    const fileInput = $('adminImportFile');
    if (fileInput && !options.keepFile) fileInput.value = '';
    if (!options.keepFile) setSelectedFileName('');
    if (options.clearVersion) {
      const version = $('adminVersionLabel');
      if (version) version.value = '';
    }
    const count = $('adminImportCount');
    if (count) count.textContent = '0';
    setPublishBusy(false);
    const preview = $('adminImportPreview');
    if (preview) {
      preview.innerHTML = '';
      preview.classList.add('hidden');
    }
    if (!options.keepMessage) setMessage('');
  }

  function aliasSet(targetField){
    return [targetField, ...(FIELD_ALIASES[targetField] || [])].map(normalize);
  }

  function findValue(row, targetField){
    const aliases = aliasSet(targetField);
    for (const [key, value] of Object.entries(row || {})) {
      if (aliases.includes(normalize(key))) return value;
    }
    return '';
  }

  function normalizeRow(row){
    const normalized = {};
    Object.keys(FIELD_ALIASES).forEach((field) => {
      normalized[field] = findValue(row, field);
    });
    normalized.Codice = String(normalized.Codice || '').trim();
    normalized.Descrizione = String(normalized.Descrizione || '').trim();
    return normalized;
  }

  function dedupeRows(rows){
    const seen = new Set();
    const duplicates = new Set();
    const uniqueRows = [];
    rows.forEach((row) => {
      const code = String(row.Codice || '').trim();
      if (!code) return;
      if (seen.has(code)) {
        duplicates.add(code);
        return;
      }
      seen.add(code);
      uniqueRows.push(row);
    });
    return { rows: uniqueRows, duplicateCodes: Array.from(duplicates).sort() };
  }

  function headerScore(row){
    const cells = (row || []).map(normalize).filter(Boolean);
    if (!cells.length) return 0;
    const has = (field) => cells.some(cell => aliasSet(field).includes(cell));
    let score = 0;
    if (has('Codice')) score += 5;
    if (has('Descrizione')) score += 5;
    if (has('Prezzo')) score += 2;
    if (has('Unita')) score += 1;
    if (has('Conai')) score += 1;
    if (has('Categoria')) score += 1;
    return score;
  }

  function makeHeaders(headerRow){
    const seen = new Map();
    return (headerRow || []).map((cell, index) => {
      const base = String(cell || '').trim() || `Colonna ${index + 1}`;
      const key = normalize(base);
      const count = seen.get(key) || 0;
      seen.set(key, count + 1);
      return count ? `${base} ${count}` : base;
    });
  }

  function looksLikeDataRow(row){
    const code = String(row?.[0] ?? '').trim();
    const desc = String(row?.[1] ?? '').trim();
    const nCode = normalize(code);
    const nDesc = normalize(desc);
    if (!code || !desc) return false;
    if (nCode.includes('codice') || nDesc === 'descrizione') return false;
    if (nCode.includes('codice articolo del prodotto')) return false;
    return true;
  }

  function positionalAdhocRows(matrix){
    return (matrix || [])
      .filter(looksLikeDataRow)
      .map((row) => ({
        Codice: row[0] ?? '',
        Descrizione: row[1] ?? '',
        Unita: row[2] ?? '',
        Prezzo: row[3] ?? '',
        Conai: row[4] ?? '',
        Categoria: row[5] ?? '',
      }));
  }

  function rowsFromSheet(sheet){
    const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false, blankrows: false });
    const candidates = matrix.slice(0, 30).map((row, index) => ({ index, score: headerScore(row) }));
    const best = candidates.sort((a, b) => b.score - a.score)[0];

    if (!best || best.score < 10) {
      return positionalAdhocRows(matrix);
    }

    const headers = makeHeaders(matrix[best.index]);
    const namedRows = matrix.slice(best.index + 1)
      .filter(row => (row || []).some(cell => String(cell || '').trim()))
      .map((row) => headers.reduce((record, header, index) => {
        record[header] = row[index] ?? '';
        return record;
      }, {}));

    const validNamedRows = namedRows.map(normalizeRow).filter(row => row.Codice && row.Descrizione);
    return validNamedRows.length ? namedRows : positionalAdhocRows(matrix.slice(best.index + 1));
  }

  async function readRows(file){
    const extension = file.name.split('.').pop()?.toLowerCase();
    if (extension === 'csv') {
      const text = await file.text();
      const workbook = XLSX.read(text, { type: 'string' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      return rowsFromSheet(sheet);
    }

    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    return rowsFromSheet(sheet);
  }

  function renderPreview(rows){
    const preview = $('adminImportPreview');
    if (!preview) return;
    if (!rows.length) {
      preview.innerHTML = '';
      preview.classList.add('hidden');
      return;
    }
    const columns = ['Codice', 'Descrizione', 'Categoria', 'Prezzo', 'Unita', 'Conai'];
    preview.innerHTML = `
      ${state.duplicateCodes.length ? `<div class="border-b bg-amber-50 px-3 py-2 text-xs text-amber-800">Codici duplicati ignorati: ${escapeHtml(state.duplicateCodes.slice(0, 12).join(', '))}${state.duplicateCodes.length > 12 ? '...' : ''}</div>` : ''}
      <table class="w-full text-xs">
        <thead class="bg-slate-100 text-slate-700">
          <tr>${columns.map(col => `<th class="border-b px-2 py-2 text-left font-semibold">${escapeHtml(col)}</th>`).join('')}</tr>
        </thead>
        <tbody>
          ${rows.slice(0, 8).map(row => `
            <tr>${columns.map(col => `<td class="border-b px-2 py-2 align-top">${escapeHtml(row[col] ?? '')}</td>`).join('')}</tr>
          `).join('')}
        </tbody>
      </table>
    `;
    preview.classList.remove('hidden');
  }

  async function handleFileChange(event){
    try {
      const file = event.target.files?.[0];
      clearImport({ keepFile: true });
      if (!file) return;
      setSelectedFileName(file.name);
      if (!window.XLSX) {
        setMessage('Libreria Excel non caricata. Ricarica la pagina e riprova.', 'error');
        return;
      }

      setMessage('Lettura file in corso...');
      const rawRows = await readRows(file);
      const validRows = rawRows.map(normalizeRow).filter(row => row.Codice && row.Descrizione);
      const deduped = dedupeRows(validRows);
      state.rows = deduped.rows;
      state.duplicateCodes = deduped.duplicateCodes;
      $('adminImportCount').textContent = String(state.rows.length);
      setPublishBusy(false);
      renderPreview(state.rows);

      if (!state.rows.length) {
        setMessage('Nessuna riga valida trovata. Verifica che il file abbia almeno Codice articolo e Descrizione.', 'error');
        return;
      }

      const duplicateNote = state.duplicateCodes.length
        ? ` Duplicati ignorati: ${state.duplicateCodes.slice(0, 6).join(', ')}${state.duplicateCodes.length > 6 ? '...' : ''}.`
        : '';
      setMessage(`${state.rows.length} righe pronte da pubblicare.${duplicateNote}`, state.duplicateCodes.length ? 'info' : 'success');
    } catch (error) {
      console.error('[AdminImport] file error', error);
      clearImport();
      setMessage('Errore nella lettura del file. Controlla formato e intestazioni.', 'error');
    }
  }

  async function invokePublish(session, versionLabel, notifyAgents){
    const headers = {
      apikey: SUPABASE_ANON_KEY,
      authorization: `Bearer ${session.access_token}`,
      'content-type': 'application/json',
      'x-skip-notify': notifyAgents ? 'false' : 'true',
    };
    if (versionLabel) headers['x-version-label'] = versionLabel;

    const response = await fetch(`${SUPABASE_URL}/functions/v1/publish_price_list`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ rows: state.rows }),
    });

    const rawText = await response.text();
    let data = null;
    try {
      data = rawText ? JSON.parse(rawText) : null;
    } catch (_) {
      data = null;
    }

    if (!response.ok || !data?.ok) {
      throw new Error(data?.error || rawText || `Errore pubblicazione ${response.status}`);
    }

    return data;
  }

  async function refreshProductsAfterImport(){
    try {
      if (typeof window.fetchProducts === 'function') await window.fetchProducts();
      if (typeof window.renderView === 'function') window.renderView();
      document.dispatchEvent(new Event('appReady'));
    } catch (error) {
      console.warn('[AdminImport] refresh products warn', error);
    }
  }

  async function publishRows(){
    try {
      if (!state.rows.length) {
        setMessage('Carica prima un file listino valido.', 'error');
        return;
      }

      const client = ensureClient();
      if (!client) {
        setMessage('Supabase non pronto. Ricarica la pagina e riprova.', 'error');
        return;
      }

      const { data: { session }, error: sessionError } = await client.auth.getSession();
      if (sessionError) throw sessionError;
      if (!session?.access_token) {
        setMessage('Sessione scaduta. Esci e rientra prima di pubblicare.', 'error');
        return;
      }

      const versionLabel = String($('adminVersionLabel')?.value || '').trim();
      const notifyAgents = !!$('adminNotifyAgents')?.checked;
      setPublishBusy(true);
      setMessage('Pubblicazione listino completo in corso: aggiorno i codici del file e ritiro quelli non presenti.');
      const data = await invokePublish(session, versionLabel, notifyAgents);

      saveLastImport({
        at: new Date().toISOString(),
        version: data.version,
        rows: state.rows.length,
        created: data.created,
        updated: data.updated,
        unchanged: data.unchanged,
        removed: data.removed,
        ignoredDuplicates: state.duplicateCodes.join(', '),
      });
      await refreshProductsAfterImport();
      setMessage(`Listino pubblicato: ${data.version}. Nuovi ${data.created}, aggiornati ${data.updated}, invariati ${data.unchanged}, ritirati ${data.removed}.`, 'success');
      clearImport({ keepMessage: true, clearVersion: true });
    } catch (error) {
      console.error('[AdminImport] publish error', error);
      setMessage(error?.message || 'Errore durante la pubblicazione del listino.', 'error');
    } finally {
      setPublishBusy(false);
    }
  }

  function init(){
    $('adminImportFile')?.addEventListener('change', handleFileChange);
    $('btnPublishPriceList')?.addEventListener('click', () => { void publishRows(); });
    const today = new Date().toISOString().slice(0, 10);
    if ($('adminVersionLabel') && !$('adminVersionLabel').value) $('adminVersionLabel').value = today;
    setPanelVisible(false);
    loadLastImport();

    const client = ensureClient();
    client?.auth?.onAuthStateChange?.(() => { void refreshRole(); });
    setTimeout(() => { void refreshRole(); }, 800);
    document.addEventListener('appReady', () => { void refreshRole(); });
    document.addEventListener('appHidden', () => setPanelVisible(false));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
