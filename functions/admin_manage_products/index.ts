import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-max-age": "86400",
};

const PRODUCT_FIELDS = [
  "codice",
  "descrizione",
  "dimensione",
  "categoria",
  "sottocategoria",
  "prezzo",
  "prezzo_stampa",
  "quantita_minima_stampa",
  "conai",
  "conai_per_collo",
  "unita",
  "disponibile",
  "novita",
  "pack",
  "pallet",
  "tags",
  "source",
];
const ADMIN_PRODUCT_SELECT =
  "id,codice,descrizione,dimensione,categoria,sottocategoria,prezzo,prezzo_stampa,quantita_minima_stampa,conai,conai_per_collo,unita,disponibile,novita,pack,pallet,tags,source,updated_at,product_media(id,kind,path,sort)";
const ADMIN_COLLECTION_SELECT =
  "id,name,slug,description,sort,active,highlighted,created_at,updated_at,custom_collection_items(id,sort,note,product_id,products(id,codice,descrizione,categoria,prezzo,disponibile,novita))";
const IMPORT_SCHEMA_ID = "adhoc_v1";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

function requireEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

function describeError(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const obj = error as Record<string, unknown>;
    const parts = [obj.message, obj.details, obj.hint, obj.code]
      .map((part) => String(part || "").trim())
      .filter(Boolean);
    if (parts.length) return parts.join(" - ");
    try {
      return JSON.stringify(error);
    } catch (_) {
      return "Errore interno non leggibile";
    }
  }
  return String(error || "Errore interno");
}

function getBearerToken(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || "";
}

async function assertAdmin(client: ReturnType<typeof createClient>, req: Request) {
  const token = getBearerToken(req);
  if (!token) return { ok: false as const, status: 401, error: "Token mancante" };

  const { data: userData, error: userError } = await client.auth.getUser(token);
  if (userError || !userData.user) {
    return { ok: false as const, status: 401, error: "Sessione non valida" };
  }

  const { data: profile, error: profileError } = await client
    .from("profiles")
    .select("role")
    .eq("id", userData.user.id)
    .single();

  if (profileError || profile?.role !== "admin") {
    return { ok: false as const, status: 403, error: "Solo gli admin possono modificare gli articoli" };
  }

  return { ok: true as const, userId: userData.user.id };
}

function parseItalianNumber(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  let raw = String(value ?? "").trim();
  if (!raw) return null;
  raw = raw.replace(/[^0-9,.-]/g, "").replace(/\s/g, "");
  if (!raw || raw === "-" || raw === "," || raw === ".") return null;

  const lastComma = raw.lastIndexOf(",");
  const lastDot = raw.lastIndexOf(".");
  let normalized = raw;

  if (lastComma >= 0 && lastDot >= 0) {
    if (lastComma > lastDot) {
      normalized = raw.replace(/\./g, "").replace(",", ".");
    } else {
      normalized = raw.replace(/,/g, "");
    }
  } else if (lastComma >= 0) {
    const parts = raw.split(",");
    normalized = parts.length > 2
      ? `${parts.slice(0, -1).join("")}.${parts.at(-1)}`
      : raw.replace(",", ".");
  } else if (lastDot >= 0) {
    const parts = raw.split(".");
    normalized = parts.length > 2 ? parts.join("") : raw;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parsePositiveInteger(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const parsed = Number.parseInt(raw.replace(/[^0-9]/g, ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseBoolean(value: unknown, defaultValue = false) {
  if (typeof value === "boolean") return value;
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return defaultValue;
  if (["si", "yes", "true", "1", "x"].includes(raw)) return true;
  if (["no", "false", "0"].includes(raw)) return false;
  return defaultValue;
}

function slugify(value: unknown) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || `raccolta-${Date.now()}`;
}

function normalizeTags(value: unknown) {
  if (Array.isArray(value)) return value.map((tag) => String(tag).trim()).filter(Boolean);
  return String(value ?? "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function normalizeProduct(row: Record<string, unknown>) {
  const now = new Date().toISOString();
  const conai = parseItalianNumber(row.Conai ?? row.conai);
  const conaiPerCollo = parseItalianNumber(row.ConaiPerCollo ?? row.conai_per_collo ?? row["CONAI/collo"]);
  const product: Record<string, unknown> = {
    codice: String(row.Codice ?? row.codice ?? "").trim(),
    descrizione: String(row.Descrizione ?? row.descrizione ?? "").trim(),
    dimensione: String(row.Dimensione ?? row.dimensione ?? "").trim(),
    categoria: String(row.Categoria ?? row.categoria ?? "").trim(),
    sottocategoria: String(row.Sottocategoria ?? row.sottocategoria ?? "").trim(),
    prezzo: parseItalianNumber(row.Prezzo ?? row.prezzo),
    conai,
    conai_per_collo: conaiPerCollo ?? conai ?? 0,
    unita: String(row.Unita ?? row.unita ?? "").trim() || "pz",
    disponibile: parseBoolean(row.Disponibile ?? row.disponibile, true),
    novita: parseBoolean(row.Novita ?? row.novita, false),
    pack: String(row.Pack ?? row.pack ?? "").trim(),
    pallet: String(row.Pallet ?? row.pallet ?? "").trim(),
    tags: normalizeTags(row.Tag ?? row.Tags ?? row.tags),
    updated_at: now,
  };

  const hasPrintPrice = "PrezzoStampa" in row || "prezzo_stampa" in row || "Prezzo stampato" in row;
  const hasPrintMinQty = "QuantitaMinimaStampa" in row || "quantita_minima_stampa" in row || "Qta minima stampa" in row || "Q.t? minima stampa" in row;
  if (hasPrintPrice) {
    product.prezzo_stampa = parseItalianNumber(row.PrezzoStampa ?? row.prezzo_stampa ?? row["Prezzo stampato"]);
  }
  if (hasPrintMinQty) {
    product.quantita_minima_stampa = parsePositiveInteger(
      row.QuantitaMinimaStampa ?? row.quantita_minima_stampa ?? row["Qta minima stampa"] ?? row["Q.t? minima stampa"],
    );
  }
  const source = String(row.source ?? row.Source ?? "").trim();
  if (["listino", "manuale", "manuale_raccolta"].includes(source)) {
    product.source = source;
  }
  validatePrintRule(product);
  return product;
}

function validatePrintRule(product: Record<string, unknown>) {
  const hasPrintPrice = "prezzo_stampa" in product;
  const hasPrintMinQty = "quantita_minima_stampa" in product;
  if (!hasPrintPrice && !hasPrintMinQty) return;

  const price = product.prezzo_stampa;
  const minQty = product.quantita_minima_stampa;
  const priceEmpty = price === null || price === undefined || price === "";
  const qtyEmpty = minQty === null || minQty === undefined || minQty === "";

  if (priceEmpty && qtyEmpty) return;
  if (priceEmpty || qtyEmpty) {
    throw new Error("Prezzo stampato e quantit? minima stampa devono essere compilati insieme");
  }
  if (Number(price) <= 0 || Number(minQty) <= 0) {
    throw new Error("Prezzo stampato e quantit? minima stampa devono essere maggiori di zero");
  }
}

function normalizeForCompare(value: unknown) {
  if (Array.isArray(value)) return JSON.stringify(value);
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value === null || value === undefined) return "";
  return String(value);
}

function buildDelta(before: Record<string, unknown> | null, after: Record<string, unknown>) {
  const delta: Record<string, { from: unknown; to: unknown }> = {};
  if (!before) return delta;

  for (const field of PRODUCT_FIELDS) {
    if (!(field in after)) continue;
    if (normalizeForCompare(before[field]) !== normalizeForCompare(after[field])) {
      delta[field] = { from: before[field] ?? null, to: after[field] ?? null };
    }
  }

  return delta;
}

function productPatch(row: Record<string, unknown>) {
  return PRODUCT_FIELDS.reduce((patch, field) => {
    if (field in row) patch[field] = row[field];
    return patch;
  }, {} as Record<string, unknown>);
}

function snapshotItem(priceListId: string, product: Record<string, unknown>) {
  return {
    price_list_id: priceListId,
    codice: product.codice ?? null,
    descrizione: product.descrizione ?? null,
    dimensione: product.dimensione ?? null,
    categoria: product.categoria ?? null,
    sottocategoria: product.sottocategoria ?? null,
    conai: product.conai ?? null,
    conai_per_collo: product.conai_per_collo ?? null,
    prezzo: product.prezzo ?? null,
    prezzo_stampa: product.prezzo_stampa ?? null,
    quantita_minima_stampa: product.quantita_minima_stampa ?? null,
    unita: product.unita ?? null,
    disponibile: product.disponibile ?? null,
    novita: product.novita ?? null,
    pack: product.pack ?? null,
    pallet: product.pallet ?? null,
    tags: product.tags ?? [],
    updated_at: product.updated_at ?? null,
  };
}

async function latestPriceListId(client: ReturnType<typeof createClient>) {
  const { data, error } = await client
    .from("price_lists")
    .select("id")
    .order("published_at", { ascending: false, nullsLast: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.id || null;
}

async function syncLatestPriceListItem(
  client: ReturnType<typeof createClient>,
  product: Record<string, unknown>,
  oldCode?: string | null,
) {
  const priceListId = await latestPriceListId(client);
  if (!priceListId || !product.codice) return;

  if (oldCode && oldCode !== product.codice) {
    await client.from("price_list_items").delete().eq("price_list_id", priceListId).eq("codice", oldCode);
  }

  if (product.disponibile === false) {
    await client.from("price_list_items").delete().eq("price_list_id", priceListId).eq("codice", product.codice);
    return;
  }

  const item = snapshotItem(priceListId, product);
  const { data: existing, error: existingError } = await client
    .from("price_list_items")
    .select("id")
    .eq("price_list_id", priceListId)
    .eq("codice", product.codice)
    .maybeSingle();
  if (existingError) throw existingError;

  if (existing?.id) {
    const { error } = await client.from("price_list_items").update(item).eq("id", existing.id);
    if (error) throw error;
    return;
  }

  const { error } = await client.from("price_list_items").insert(item);
  if (error) throw error;
}

async function insertBatch(
  client: ReturnType<typeof createClient>,
  userId: string,
  actionType: "manual_update" | "partial_import",
  label: string,
  items: Array<Record<string, unknown>>,
  unchangedCount = 0,
) {
  const createdCount = items.filter((item) => item.change_type === "created").length;
  const updatedCount = items.filter((item) => item.change_type === "updated").length;

  const { data: batch, error: batchError } = await client
    .from("admin_change_batches")
    .insert({
      action_type: actionType,
      label,
      changed_by: userId,
      item_count: items.length,
      created_count: createdCount,
      updated_count: updatedCount,
      unchanged_count: unchangedCount,
    })
    .select("id")
    .single();
  if (batchError) throw batchError;

  if (items.length) {
    const { error: itemsError } = await client.from("admin_change_items").insert(
      items.map((item) => ({ ...item, batch_id: batch.id })),
    );
    if (itemsError) throw itemsError;
  }

  return batch.id;
}

async function searchProducts(client: ReturnType<typeof createClient>, query: string) {
  const q = query.trim();
  if (!q) return [];

  const { data, error } = await client
    .from("products")
    .select(ADMIN_PRODUCT_SELECT)
    .or(`codice.ilike.%${q}%,descrizione.ilike.%${q}%`)
    .order("codice", { ascending: true })
    .limit(20);
  if (error) throw error;
  return data || [];
}

async function getAdminProductByCode(client: ReturnType<typeof createClient>, codice: string) {
  const { data, error } = await client
    .from("products")
    .select(ADMIN_PRODUCT_SELECT)
    .eq("codice", codice)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function saveProduct(client: ReturnType<typeof createClient>, userId: string, body: Record<string, unknown>) {
  const product = normalizeProduct((body.product || {}) as Record<string, unknown>);
  const originalCode = String(body.original_codice || body.originalCode || product.codice || "").trim();
  if (!product.codice || !product.descrizione || !product.categoria) {
    return jsonResponse({ ok: false, error: "Codice, descrizione e categoria sono obbligatori" }, 400);
  }

  const { data: existing, error: existingError } = await client
    .from("products")
    .select("*")
    .eq("codice", originalCode)
    .maybeSingle();
  if (existingError) throw existingError;

  if (existing && product.codice !== originalCode) {
    const { data: conflict, error: conflictError } = await client
      .from("products")
      .select("codice")
      .eq("codice", product.codice)
      .maybeSingle();
    if (conflictError) throw conflictError;
    if (conflict) return jsonResponse({ ok: false, error: `Il codice ${product.codice} e gia utilizzato` }, 409);
  }

  if (!existing) {
    const { data: conflict, error: conflictError } = await client
      .from("products")
      .select("codice")
      .eq("codice", product.codice)
      .maybeSingle();
    if (conflictError) throw conflictError;
    if (conflict) return jsonResponse({ ok: false, error: `Il codice ${product.codice} e gia utilizzato` }, 409);

    if (!product.source) product.source = "manuale";
    const { error } = await client.from("products").insert(product);
    if (error) throw error;
    await syncLatestPriceListItem(client, product);
    const batchId = await insertBatch(client, userId, "manual_update", "Creazione manuale articolo", [{
      old_codice: null,
      new_codice: product.codice,
      change_type: "created",
      delta: product,
    }]);
    return jsonResponse({ ok: true, action: "created", batch_id: batchId, product: await getAdminProductByCode(client, product.codice) });
  }

  const delta = buildDelta(existing, product);
  if (!Object.keys(delta).length) return jsonResponse({ ok: true, action: "unchanged", product: await getAdminProductByCode(client, product.codice) });

  const { error } = await client.from("products").update(productPatch(product)).eq("codice", originalCode);
  if (error) throw error;
  await syncLatestPriceListItem(client, product, originalCode);

  const batchId = await insertBatch(client, userId, "manual_update", "Modifica manuale articolo", [{
    old_codice: originalCode,
    new_codice: product.codice,
    change_type: "updated",
    delta,
  }]);

  return jsonResponse({ ok: true, action: "updated", batch_id: batchId, product: await getAdminProductByCode(client, product.codice), delta });
}

async function partialImport(client: ReturnType<typeof createClient>, userId: string, body: Record<string, unknown>) {
  if (body.import_schema !== IMPORT_SCHEMA_ID) {
    return jsonResponse({ ok: false, error: "Struttura file non valida: usa il listino Ad Hoc con colonne Codice articolo, Descrizione, 1^ Unita di misura, Prezzo, Conai, Descrizione." }, 400);
  }
  const rawRows = Array.isArray(body.rows) ? body.rows as Record<string, unknown>[] : [];
  const rows = rawRows.map((rawRow) => {
    const row = normalizeProduct(rawRow);
    row.source = "listino";
    return row;
  }).filter((row) => row.codice && row.descrizione);
  if (!rows.length) return jsonResponse({ ok: false, error: "Nessuna riga valida da importare" }, 400);
  const invalid = rows.find((row) => !row.unita || !row.categoria || row.prezzo === null || row.conai === null);
  if (invalid) {
    return jsonResponse({ ok: false, error: "Struttura file non valida: ogni riga deve avere Unita, Prezzo, Conai e Categoria." }, 400);
  }

  const duplicateCodes = rows
    .map((row) => row.codice)
    .filter((code, index, codes) => codes.indexOf(code) !== index);
  if (duplicateCodes.length) {
    return jsonResponse({ ok: false, error: `Codici duplicati nel file: ${[...new Set(duplicateCodes)].join(", ")}` }, 400);
  }

  const codes = rows.map((row) => row.codice);
  const { data: existingRows, error: existingError } = await client.from("products").select("*").in("codice", codes);
  if (existingError) throw existingError;

  const existingByCode = new Map((existingRows || []).map((row: any) => [row.codice, row]));
  const changes: Array<Record<string, unknown>> = [];
  let unchangedCount = 0;

  for (const row of rows) {
    const existing = existingByCode.get(row.codice) as Record<string, unknown> | undefined;
    if (!existing) {
      const { error } = await client.from("products").insert(row);
      if (error) throw error;
      await syncLatestPriceListItem(client, row);
      changes.push({ old_codice: null, new_codice: row.codice, change_type: "created", delta: row });
      continue;
    }

    const delta = buildDelta(existing, row);
    if (!Object.keys(delta).length) {
      unchangedCount += 1;
      continue;
    }

    const { error } = await client.from("products").update(productPatch(row)).eq("codice", row.codice);
    if (error) throw error;
    await syncLatestPriceListItem(client, row);
    changes.push({ old_codice: row.codice, new_codice: row.codice, change_type: "updated", delta });
  }

  const batchId = await insertBatch(
    client,
    userId,
    "partial_import",
    String(body.label || "Import articoli caricati").trim(),
    changes,
    unchangedCount,
  );

  return jsonResponse({
    ok: true,
    batch_id: batchId,
    rows: rows.length,
    changed: changes.length,
    created: changes.filter((item) => item.change_type === "created").length,
    updated: changes.filter((item) => item.change_type === "updated").length,
    unchanged: unchangedCount,
    codes: changes.map((item) => item.new_codice),
  });
}

async function listCollections(client: ReturnType<typeof createClient>) {
  const { data, error } = await client
    .from("custom_collections")
    .select(ADMIN_COLLECTION_SELECT)
    .order("sort", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw error;
  return jsonResponse({ ok: true, collections: data || [] });
}

async function saveCollection(client: ReturnType<typeof createClient>, body: Record<string, unknown>) {
  const raw = (body.collection || {}) as Record<string, unknown>;
  const id = String(raw.id || body.id || "").trim();
  const name = String(raw.name || "").trim();
  if (!name) return jsonResponse({ ok: false, error: "Nome raccolta obbligatorio" }, 400);

  const payload = {
    name,
    slug: slugify(raw.slug || name),
    description: String(raw.description || "").trim(),
    sort: Number.parseInt(String(raw.sort ?? 0), 10) || 0,
    active: parseBoolean(raw.active, true),
    highlighted: parseBoolean(raw.highlighted, false),
    updated_at: new Date().toISOString(),
  };

  if (id) {
    const { error } = await client.from("custom_collections").update(payload).eq("id", id);
    if (error) throw error;
  } else {
    const { error } = await client.from("custom_collections").insert(payload);
    if (error) throw error;
  }

  return await listCollections(client);
}

async function deleteCollection(client: ReturnType<typeof createClient>, body: Record<string, unknown>) {
  const id = String(body.id || "").trim();
  if (!id) return jsonResponse({ ok: false, error: "Raccolta non indicata" }, 400);
  const { error } = await client.from("custom_collections").delete().eq("id", id);
  if (error) throw error;
  return await listCollections(client);
}

async function addCollectionItem(client: ReturnType<typeof createClient>, body: Record<string, unknown>) {
  const collectionId = String(body.collection_id || body.collectionId || "").trim();
  const codice = String(body.codice || body.code || "").trim();
  if (!collectionId || !codice) {
    return jsonResponse({ ok: false, error: "Indica raccolta e codice articolo" }, 400);
  }

  const { data: product, error: productError } = await client
    .from("products")
    .select("id,codice")
    .eq("codice", codice)
    .maybeSingle();
  if (productError) throw productError;
  if (!product?.id) return jsonResponse({ ok: false, error: `Articolo ${codice} non trovato` }, 404);

  const sort = Number.parseInt(String(body.sort ?? 0), 10) || 0;
  const note = String(body.note || "").trim();
  const { error } = await client
    .from("custom_collection_items")
    .upsert({
      collection_id: collectionId,
      product_id: product.id,
      sort,
      note,
    }, { onConflict: "collection_id,product_id" });
  if (error) throw error;
  return await listCollections(client);
}

async function removeCollectionItem(client: ReturnType<typeof createClient>, body: Record<string, unknown>) {
  const itemId = String(body.item_id || body.itemId || "").trim();
  if (!itemId) return jsonResponse({ ok: false, error: "Articolo raccolta non indicato" }, 400);
  const { error } = await client.from("custom_collection_items").delete().eq("id", itemId);
  if (error) throw error;
  return await listCollections(client);
}

async function history(client: ReturnType<typeof createClient>) {
  const { data: lists, error: listsError } = await client
    .from("price_lists")
    .select("id,version_label,published_at,published_by")
    .order("published_at", { ascending: false })
    .limit(20);
  if (listsError) throw listsError;

  const listIds = (lists || []).map((list: any) => list.id);
  const { data: listChanges, error: listChangesError } = listIds.length
    ? await client.from("change_log").select("price_list_id,codice,change_type,delta").in("price_list_id", listIds)
    : { data: [], error: null };
  if (listChangesError) throw listChangesError;

  const byList = new Map<string, any[]>();
  for (const change of listChanges || []) {
    const arr = byList.get(change.price_list_id) || [];
    arr.push(change);
    byList.set(change.price_list_id, arr);
  }

  const fullImports = (lists || []).map((list: any) => {
    const changes = byList.get(list.id) || [];
    return {
      ...list,
      type: "full_import",
      created: changes.filter((change) => change.change_type === "created").length,
      updated: changes.filter((change) => change.change_type === "updated").length,
      removed: changes.filter((change) => change.change_type === "removed").length,
      codes: changes.map((change) => change.codice),
    };
  }).filter((list: any) => list.codes.length > 0);

  const { data: batches, error: batchesError } = await client
    .from("admin_change_batches")
    .select("id,action_type,label,item_count,created_count,updated_count,unchanged_count,created_at")
    .order("created_at", { ascending: false })
    .limit(20);
  if (batchesError) throw batchesError;

  const batchIds = (batches || []).map((batch: any) => batch.id);
  const { data: batchItems, error: batchItemsError } = batchIds.length
    ? await client
        .from("admin_change_items")
        .select("batch_id,old_codice,new_codice,change_type,delta")
        .in("batch_id", batchIds)
        .order("created_at", { ascending: true })
    : { data: [], error: null };
  if (batchItemsError) throw batchItemsError;

  const byBatch = new Map<string, any[]>();
  for (const item of batchItems || []) {
    const arr = byBatch.get(item.batch_id) || [];
    arr.push(item);
    byBatch.set(item.batch_id, arr);
  }

  const changes = (batches || []).map((batch: any) => ({
    ...batch,
    admin_change_items: byBatch.get(batch.id) || [],
  }));

  return jsonResponse({ ok: true, full_imports: fullImports, changes });
}

async function deleteAllHistory(client: ReturnType<typeof createClient>) {
  const { data: latestList, error: latestListError } = await client
    .from("price_lists")
    .select("id")
    .order("published_at", { ascending: false, nullsLast: true })
    .limit(1)
    .maybeSingle();
  if (latestListError) throw latestListError;

  const latestPriceListId = latestList?.id || null;

  const { error: adminItemsError } = await client.from("admin_change_items").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  if (adminItemsError) throw adminItemsError;

  const { error: adminBatchesError } = await client.from("admin_change_batches").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  if (adminBatchesError) throw adminBatchesError;

  const { error: changeLogError } = await client.from("change_log").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  if (changeLogError) throw changeLogError;

  const listsDelete = latestPriceListId
    ? client.from("price_lists").delete().neq("id", latestPriceListId)
    : client.from("price_lists").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  const { error: listsError } = await listsDelete;
  if (listsError) throw listsError;

  return jsonResponse({ ok: true, deleted: "all_history", kept_price_list_id: latestPriceListId });
}

async function deleteHistory(client: ReturnType<typeof createClient>, body: Record<string, unknown>) {
  const targetType = String(body.target_type || "");
  const id = String(body.id || "");

  if (targetType === "all") return await deleteAllHistory(client);
  if (!id) return jsonResponse({ ok: false, error: "Storico da cancellare non indicato" }, 400);

  if (targetType === "admin_batch") {
    await client.from("admin_change_items").delete().eq("batch_id", id);
    const { error } = await client.from("admin_change_batches").delete().eq("id", id);
    if (error) throw error;
    return jsonResponse({ ok: true, deleted: "admin_batch" });
  }

  if (targetType === "price_list") {
    const { data: latestList, error: latestListError } = await client
      .from("price_lists")
      .select("id")
      .order("published_at", { ascending: false, nullsLast: true })
      .limit(1)
      .maybeSingle();
    if (latestListError) throw latestListError;

    await client.from("change_log").delete().eq("price_list_id", id);
    if (latestList?.id === id) {
      return jsonResponse({ ok: true, deleted: "price_list_history", kept_price_list_id: id });
    }

    await client.from("price_list_items").delete().eq("price_list_id", id);
    const { error } = await client.from("price_lists").delete().eq("id", id);
    if (error) throw error;
    return jsonResponse({ ok: true, deleted: "price_list" });
  }

  return jsonResponse({ ok: false, error: "Tipo storico non valido" }, 400);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ ok: false, error: "Metodo non consentito" }, 405);

  try {
    const supabaseUrl = requireEnv("SUPABASE_URL");
    const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
    const client = createClient(supabaseUrl, serviceKey);

    const admin = await assertAdmin(client, req);
    if (!admin.ok) return jsonResponse({ ok: false, error: admin.error }, admin.status);

    const body = await req.json();
    const action = String(body.action || "").trim();

    if (action === "search") return jsonResponse({ ok: true, products: await searchProducts(client, String(body.query || "")) });
    if (action === "save_product") return await saveProduct(client, admin.userId, body);
    if (action === "partial_import") return await partialImport(client, admin.userId, body);
    if (action === "collections") return await listCollections(client);
    if (action === "save_collection") return await saveCollection(client, body);
    if (action === "delete_collection") return await deleteCollection(client, body);
    if (action === "add_collection_item") return await addCollectionItem(client, body);
    if (action === "remove_collection_item") return await removeCollectionItem(client, body);
    if (action === "history") return await history(client);
    if (action === "delete_history") return await deleteHistory(client, body);

    return jsonResponse({ ok: false, error: "Azione non valida" }, 400);
  } catch (error) {
    const message = describeError(error);
    console.error("[admin_manage_products]", message, error);
    return jsonResponse({ ok: false, error: message }, 500);
  }
});
