// publish_price_list.ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Papa from "https://esm.sh/papaparse@5.4.1";

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type, x-client-info, x-supabase-api-version, x-version-label, x-skip-notify",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-max-age": "86400",
};

const PRODUCT_COLUMNS = "codice,descrizione,dimensione,categoria,sottocategoria,conai,conai_per_collo,prezzo,unita,disponibile,novita,pack,pallet,tags,updated_at";

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
    return { ok: false as const, status: 403, error: "Solo gli admin possono pubblicare il listino" };
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
    normalized = lastComma > lastDot
      ? raw.replace(/\./g, "").replace(",", ".")
      : raw.replace(/,/g, "");
  } else if (lastComma >= 0) {
    normalized = raw.replace(/\./g, "").replace(",", ".");
  } else if (lastDot >= 0) {
    const [, decimals = ""] = raw.split(".");
    normalized = decimals.length > 0 && decimals.length <= 4 ? raw : raw.replace(/\./g, "");
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseBoolean(value: unknown, defaultValue = false) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return defaultValue;
  return ["si", "yes", "true", "1", "x"].includes(raw);
}

function normalizeRow(row: Record<string, unknown>) {
  const now = new Date().toISOString();
  const conai = parseItalianNumber(row.Conai ?? row.conai);
  const conaiPerCollo = parseItalianNumber(row.ConaiPerCollo ?? row.conai_per_collo ?? row["CONAI/collo"]);
  return {
    codice: String(row.Codice ?? row.codice ?? "").trim(),
    descrizione: String(row.Descrizione ?? row.descrizione ?? "").trim(),
    dimensione: String(row.Dimensione ?? row.dimensione ?? "").trim(),
    categoria: String(row.Categoria ?? row.categoria ?? "").trim(),
    sottocategoria: String(row.Sottocategoria ?? row.sottocategoria ?? "").trim(),
    prezzo: parseItalianNumber(row.Prezzo ?? row.prezzo),
    conai,
    conai_per_collo: conaiPerCollo ?? conai ?? 0,
    unita: String(row.Unita ?? row.unita ?? "pz").trim() || "pz",
    disponibile: parseBoolean(row.Disponibile ?? row.disponibile, true),
    novita: parseBoolean(row.Novita ?? row.novita, false),
    pack: String(row.Pack ?? row.pack ?? "").trim(),
    pallet: String(row.Pallet ?? row.pallet ?? "").trim(),
    tags: String(row.Tag ?? row.Tags ?? row.tags ?? "")
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean),
    updated_at: now,
  };
}

function productPatch(row: Record<string, unknown>) {
  const { delta: _delta, ...patch } = row;
  return patch;
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
    unita: product.unita ?? null,
    disponibile: product.disponibile ?? null,
    novita: product.novita ?? null,
    pack: product.pack ?? null,
    pallet: product.pallet ?? null,
    tags: product.tags ?? [],
    updated_at: product.updated_at ?? null,
  };
}

function buildVersionLabel(req: Request) {
  const fromHeader = req.headers.get("x-version-label")?.trim();
  if (fromHeader) return fromHeader;
  return new Date().toISOString().slice(0, 10);
}

async function resolveVersionLabel(client: ReturnType<typeof createClient>, requestedVersion: string) {
  const base = requestedVersion || new Date().toISOString().slice(0, 10);
  const { data, error } = await client
    .from("price_lists")
    .select("version_label")
    .or(`version_label.eq.${base},version_label.like.${base}-%`);
  if (error) throw error;

  const existing = new Set((data || []).map((row: any) => row.version_label));
  if (!existing.has(base)) return base;

  let counter = 2;
  while (existing.has(`${base}-${counter}`)) counter += 1;
  return `${base}-${counter}`;
}

async function readRows(req: Request) {
  const contentType = req.headers.get("content-type") || "";

  if (contentType.includes("text/csv")) {
    const csv = await req.text();
    const parsed = Papa.parse(csv, { header: true, skipEmptyLines: true });
    if (parsed.errors?.length) {
      throw new Error(`CSV non valido: ${parsed.errors[0].message}`);
    }
    return (parsed.data as Record<string, unknown>[]).filter((row) => row.Codice || row.Descrizione);
  }

  const body = await req.json();
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.rows)) return body.rows;
  throw new Error("Body non valido: inviare un array di righe o { rows: [...] }");
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

    const rows = await readRows(req);
    const incoming = rows.map(normalizeRow).filter((row) => row.codice && row.descrizione);
    if (!incoming.length) {
      return jsonResponse({ ok: false, error: "Nessuna riga valida da pubblicare" }, 400);
    }

    const duplicateCodes = incoming
      .map((row) => row.codice)
      .filter((code, index, codes) => codes.indexOf(code) !== index);
    if (duplicateCodes.length) {
      return jsonResponse({ ok: false, error: `Codici duplicati nel file: ${[...new Set(duplicateCodes)].join(", ")}` }, 400);
    }

    const requestedVersion = buildVersionLabel(req);
    const version = await resolveVersionLabel(client, requestedVersion);

    const incomingCodes = incoming.map((row) => row.codice);
    const { data: current, error: currentError } = await client
      .from("products")
      .select(PRODUCT_COLUMNS)
      .in("codice", incomingCodes);
    if (currentError) throw currentError;

    const currentByCode = new Map((current || []).map((product: any) => [product.codice, product]));
    const created: any[] = [];
    const updated: any[] = [];
    let unchanged = 0;

    for (const row of incoming) {
      const existing = currentByCode.get(row.codice);
      if (!existing) {
        created.push(row);
        continue;
      }

      const delta: Record<string, unknown> = {};
      if (Number(existing.prezzo) !== row.prezzo) delta.prezzo = { from: existing.prezzo, to: row.prezzo };
      if (existing.descrizione !== row.descrizione) delta.descrizione = { from: existing.descrizione, to: row.descrizione };
      if ((existing.dimensione || "") !== row.dimensione) delta.dimensione = { from: existing.dimensione, to: row.dimensione };
      if ((existing.categoria || "") !== row.categoria) delta.categoria = { from: existing.categoria, to: row.categoria };
      if ((existing.sottocategoria || "") !== row.sottocategoria) delta.sottocategoria = { from: existing.sottocategoria, to: row.sottocategoria };
      if (Number(existing.conai || 0) !== Number(row.conai || 0)) delta.conai = { from: existing.conai, to: row.conai };
      if (Number(existing.conai_per_collo || 0) !== Number(row.conai_per_collo || 0)) {
        delta.conai_per_collo = { from: existing.conai_per_collo, to: row.conai_per_collo };
      }
      if ((existing.unita || "") !== row.unita) delta.unita = { from: existing.unita, to: row.unita };
      if (existing.disponibile !== row.disponibile) delta.disponibile = { from: existing.disponibile, to: row.disponibile };
      if (existing.novita !== row.novita) delta.novita = { from: existing.novita, to: row.novita };
      if ((existing.pack || "") !== row.pack) delta.pack = { from: existing.pack, to: row.pack };
      if ((existing.pallet || "") !== row.pallet) delta.pallet = { from: existing.pallet, to: row.pallet };
      if (JSON.stringify(existing.tags || []) !== JSON.stringify(row.tags || [])) {
        delta.tags = { from: existing.tags, to: row.tags };
      }

      if (Object.keys(delta).length) updated.push({ ...row, delta });
      else unchanged += 1;
    }

    const { data: priceList, error: priceListError } = await client
      .from("price_lists")
      .insert({ version_label: version, published_by: admin.userId })
      .select("id")
      .single();
    if (priceListError) throw priceListError;

    const priceListId = priceList.id;

    if (created.length) {
      const { error } = await client.from("products").insert(created);
      if (error) throw error;
    }

    for (const row of updated) {
      const { error } = await client.from("products").update(productPatch(row)).eq("codice", row.codice);
      if (error) throw error;
    }

    const changes = [
      ...created.map((row) => ({ price_list_id: priceListId, codice: row.codice, change_type: "created", delta: null })),
      ...updated.map((row) => ({ price_list_id: priceListId, codice: row.codice, change_type: "updated", delta: row.delta })),
    ];

    if (changes.length) {
      const { error } = await client.from("change_log").insert(changes);
      if (error) throw error;
    }

    const { data: snapshot, error: snapshotError } = await client.from("products").select(PRODUCT_COLUMNS);
    if (snapshotError) throw snapshotError;

    if (snapshot?.length) {
      const items = snapshot.map((product: any) => snapshotItem(priceListId, product));
      const { error } = await client.from("price_list_items").insert(items);
      if (error) throw error;
    }

    let notification: unknown = { ok: true, skipped: true };
    if (req.headers.get("x-skip-notify") !== "true") {
      const internalSecret = Deno.env.get("INTERNAL_FUNCTION_SECRET");
      const authorization = req.headers.get("authorization") || undefined;
      const { data, error } = await client.functions.invoke("notify_agents", {
        body: { price_list_id: priceListId, version_label: version },
        headers: internalSecret ? { "x-internal-secret": internalSecret } : authorization ? { authorization } : undefined,
      });
      notification = error ? { ok: false, error: error.message } : data;
    }

    return jsonResponse({
      ok: true,
      version,
      requested_version: requestedVersion,
      price_list_id: priceListId,
      created: created.length,
      updated: updated.length,
      unchanged,
      removed: 0,
      notification,
    });
  } catch (error) {
    const message = describeError(error);
    console.error("[publish_price_list]", message, error);
    return jsonResponse({ ok: false, error: message }, 500);
  }
});
