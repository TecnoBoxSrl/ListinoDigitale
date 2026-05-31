// publish_price_list.ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Papa from "https://esm.sh/papaparse@5.4.1";

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type, x-version-label, x-skip-notify",
  "access-control-allow-methods": "POST, OPTIONS",
};

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
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const normalized = raw.replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
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
  return {
    codice: String(row.Codice ?? row.codice ?? "").trim(),
    descrizione: String(row.Descrizione ?? row.descrizione ?? "").trim(),
    dimensione: String(row.Dimensione ?? row.dimensione ?? "").trim(),
    categoria: String(row.Categoria ?? row.categoria ?? "").trim(),
    sottocategoria: String(row.Sottocategoria ?? row.sottocategoria ?? "").trim(),
    prezzo: parseItalianNumber(row.Prezzo ?? row.prezzo),
    conai: parseItalianNumber(row.Conai ?? row.conai),
    conai_per_collo: parseItalianNumber(row.ConaiPerCollo ?? row.conai_per_collo ?? row["CONAI/collo"]),
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

function buildVersionLabel(req: Request) {
  const fromHeader = req.headers.get("x-version-label")?.trim();
  if (fromHeader) return fromHeader;
  return new Date().toISOString().slice(0, 10);
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

    const version = buildVersionLabel(req);
    const { data: existingVersion, error: existingVersionError } = await client
      .from("price_lists")
      .select("id")
      .eq("version_label", version)
      .maybeSingle();

    if (existingVersionError) throw existingVersionError;
    if (existingVersion) {
      return jsonResponse({
        ok: false,
        error: `La versione ${version} esiste gia. Usa x-version-label per pubblicare una nuova versione.`,
      }, 409);
    }

    const { data: current, error: currentError } = await client
      .from("products")
      .select("codice,prezzo,descrizione,dimensione,conai,conai_per_collo,disponibile,novita,tags");
    if (currentError) throw currentError;

    const currentByCode = new Map((current || []).map((product: any) => [product.codice, product]));
    const created: any[] = [];
    const updated: any[] = [];
    const seen = new Set<string>();

    for (const row of incoming) {
      seen.add(row.codice);
      const existing = currentByCode.get(row.codice);
      if (!existing) {
        created.push(row);
        continue;
      }

      const delta: Record<string, unknown> = {};
      if (Number(existing.prezzo) !== row.prezzo) delta.prezzo = { from: existing.prezzo, to: row.prezzo };
      if (existing.descrizione !== row.descrizione) delta.descrizione = { from: existing.descrizione, to: row.descrizione };
      if ((existing.dimensione || "") !== row.dimensione) delta.dimensione = { from: existing.dimensione, to: row.dimensione };
      if (Number(existing.conai || 0) !== Number(row.conai || 0)) delta.conai = { from: existing.conai, to: row.conai };
      if (Number(existing.conai_per_collo || 0) !== Number(row.conai_per_collo || 0)) {
        delta.conai_per_collo = { from: existing.conai_per_collo, to: row.conai_per_collo };
      }
      if (existing.disponibile !== row.disponibile) delta.disponibile = { from: existing.disponibile, to: row.disponibile };
      if (existing.novita !== row.novita) delta.novita = { from: existing.novita, to: row.novita };
      if (JSON.stringify(existing.tags || []) !== JSON.stringify(row.tags || [])) {
        delta.tags = { from: existing.tags, to: row.tags };
      }

      if (Object.keys(delta).length) updated.push({ ...row, delta });
    }

    const removed = (current || []).filter((product: any) => !seen.has(product.codice));

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

    for (const row of removed) {
      const { error } = await client
        .from("products")
        .update({ disponibile: false, novita: false, updated_at: new Date().toISOString() })
        .eq("codice", row.codice);
      if (error) throw error;
    }

    const changes = [
      ...created.map((row) => ({ price_list_id: priceListId, codice: row.codice, change_type: "created", delta: null })),
      ...updated.map((row) => ({ price_list_id: priceListId, codice: row.codice, change_type: "updated", delta: row.delta })),
      ...removed.map((row: any) => ({ price_list_id: priceListId, codice: row.codice, change_type: "removed", delta: null })),
    ];

    if (changes.length) {
      const { error } = await client.from("change_log").insert(changes);
      if (error) throw error;
    }

    const { data: snapshot, error: snapshotError } = await client.from("products").select("*");
    if (snapshotError) throw snapshotError;

    if (snapshot?.length) {
      const items = snapshot.map((product: any) => {
        const { id: _id, ...rest } = product;
        return { price_list_id: priceListId, ...rest };
      });
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
      price_list_id: priceListId,
      created: created.length,
      updated: updated.length,
      removed: removed.length,
      notification,
    });
  } catch (error) {
    console.error("[publish_price_list]", error);
    return jsonResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
