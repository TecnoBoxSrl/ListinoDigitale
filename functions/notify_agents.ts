// notify_agents.ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const WHATSAPP_TOKEN = Deno.env.get("WHATSAPP_TOKEN");
const WABA_PHONE_ID = Deno.env.get("WABA_PHONE_ID");

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type, x-internal-secret",
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

async function isAdminRequest(client: ReturnType<typeof createClient>, req: Request) {
  const token = getBearerToken(req);
  if (!token) return false;

  const { data: userData, error: userError } = await client.auth.getUser(token);
  if (userError || !userData.user) return false;

  const { data: profile, error: profileError } = await client
    .from("profiles")
    .select("role")
    .eq("id", userData.user.id)
    .single();

  return !profileError && profile?.role === "admin";
}

async function assertAllowed(client: ReturnType<typeof createClient>, req: Request) {
  const internalSecret = Deno.env.get("INTERNAL_FUNCTION_SECRET");
  const providedSecret = req.headers.get("x-internal-secret");

  if (internalSecret && providedSecret === internalSecret) return true;
  return await isAdminRequest(client, req);
}

async function sendWhatsapp(phone: string, versionLabel: string, total: number) {
  if (!WHATSAPP_TOKEN || !WABA_PHONE_ID) {
    return { ok: false, skipped: true, reason: "whatsapp_not_configured" };
  }

  const response = await fetch(`https://graph.facebook.com/v19.0/${WABA_PHONE_ID}/messages`, {
    method: "POST",
    headers: {
      "authorization": `Bearer ${WHATSAPP_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: phone,
      type: "template",
      template: {
        name: "listino_update",
        language: { code: "it" },
        components: [{
          type: "body",
          parameters: [
            { type: "text", text: versionLabel },
            { type: "text", text: String(total) },
          ],
        }],
      },
    }),
  });

  if (!response.ok) {
    const details = await response.text();
    return { ok: false, status: response.status, error: details.slice(0, 500) };
  }

  return { ok: true, status: response.status };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ ok: false, error: "Metodo non consentito" }, 405);

  try {
    const supabaseUrl = requireEnv("SUPABASE_URL");
    const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
    const client = createClient(supabaseUrl, serviceKey);

    if (!(await assertAllowed(client, req))) {
      return jsonResponse({ ok: false, error: "Non autorizzato" }, 403);
    }

    const body = await req.json();
    const priceListId = String(body?.price_list_id || "").trim();
    const versionLabel = String(body?.version_label || "").trim();
    if (!priceListId || !versionLabel) {
      return jsonResponse({ ok: false, error: "price_list_id e version_label sono obbligatori" }, 400);
    }

    const { data: changes, error: changesError } = await client
      .from("change_log")
      .select("change_type")
      .eq("price_list_id", priceListId);
    if (changesError) throw changesError;

    const total = changes?.length || 0;
    const created = changes?.filter((change) => change.change_type === "created").length || 0;
    const updated = changes?.filter((change) => change.change_type === "updated").length || 0;
    const removed = changes?.filter((change) => change.change_type === "removed").length || 0;
    const summary = `Aggiornamento listino ${versionLabel}: ${total} modifiche (+${created} nuovi, ${updated} aggiornati, ${removed} ritirati).`;

    const { data: agents, error: agentsError } = await client
      .from("profiles")
      .select("id,role,phone")
      .in("role", ["agent", "admin"]);
    if (agentsError) throw agentsError;

    const results = [];
    for (const agent of agents || []) {
      if (!agent.phone) {
        results.push({ id: agent.id, ok: false, skipped: true, reason: "missing_phone" });
        continue;
      }

      const result = await sendWhatsapp(agent.phone, versionLabel, total);
      results.push({ id: agent.id, ...result });
    }

    return jsonResponse({
      ok: results.every((result) => result.ok || result.skipped),
      sent_to: results.filter((result) => result.ok).length,
      skipped: results.filter((result) => result.skipped).length,
      failed: results.filter((result) => !result.ok && !result.skipped).length,
      summary,
      results,
      email_configured: Boolean(RESEND_API_KEY),
    });
  } catch (error) {
    console.error("[notify_agents]", error);
    return jsonResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
