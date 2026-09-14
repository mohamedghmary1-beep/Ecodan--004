import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const sources = ["submittals", "upload_requests"];
const json = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const token = new URL(request.url).searchParams.get("token");

  if (request.method === "GET" && token) {
    const { data: access } = await admin.from("temporary_access_tokens").select("request_id, source_table, expires_at").eq("token", token).maybeSingle();
    if (!access || new Date(access.expires_at) <= new Date()) return json({ error: "The download link has expired. Generate a new link." }, 410);
    const file = await getFile(admin, access.source_table, access.request_id);
    if (!file) return json({ error: "The file is no longer available." }, 404);
    if (file.bucketPath) {
      const { data } = await admin.storage.from("task-attachments").createSignedUrl(file.bucketPath, 20 * 60);
      if (!data?.signedUrl) return json({ error: "Could not prepare the file." }, 500);
      return Response.redirect(data.signedUrl, 302);
    }
    return Response.redirect(toDownloadUrl(file.url!), 302);
  }

  if (request.method !== "POST") return json({ error: "Not found" }, 404);
  const bearer = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!bearer) return json({ error: "Authentication required" }, 401);
  const { data: authData } = await admin.auth.getUser(bearer);
  if (!authData.user) return json({ error: "Authentication required" }, 401);
  const body = await request.json().catch(() => ({}));
  const requestId = Number(body.request_id);
  const source = String(body.source_table);
  if (!Number.isSafeInteger(requestId) || requestId < 1 || !sources.includes(source)) return json({ error: "Invalid request" }, 400);
  if (!(await getFile(admin, source, requestId))) return json({ error: "No file is available for this request" }, 404);
  const { data: profile } = await admin.from("profiles").select("id").eq("id", authData.user.id).maybeSingle();
  if (!profile) return json({ error: "Access denied" }, 403);
  const expiresAt = new Date(Date.now() + 20 * 60 * 1000).toISOString();
  const tokenValue = crypto.randomUUID();
  const { error } = await admin.from("temporary_access_tokens").insert({ token: tokenValue, request_id: requestId, source_table: source, expires_at: expiresAt });
  if (error) return json({ error: "Could not create download link" }, 500);
  return json({ url: `${supabaseUrl}/functions/v1/temporary-download?token=${tokenValue}`, expires_at: expiresAt });
});

async function getFile(admin: ReturnType<typeof createClient>, source: string, id: number) {
  if (source === "submittals") {
    const { data } = await admin.from("submittals").select("link").eq("id", id).maybeSingle();
    return ref(data?.link);
  }
  if (source === "upload_requests") {
    const { data } = await admin.from("upload_requests").select("file_link").eq("id", id).maybeSingle();
    return ref(data?.file_link);
  }
  return null;
}

function ref(value: string | null | undefined) {
  if (!value) return null;
  return /^https?:\/\//i.test(value) ? { url: value } : { bucketPath: value };
}

// Drive's normal share URL opens its viewer. Convert recognised Drive file
// URLs to its download endpoint so the browser receives an attachment.
function toDownloadUrl(url: string) {
  const fileMatch = url.match(/drive\.google\.com\/file\/d\/([^/?#]+)/);
  const openMatch = url.match(/[?&]id=([^&#]+)/);
  const id = fileMatch?.[1] || openMatch?.[1];
  return id ? `https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}` : url;
}
