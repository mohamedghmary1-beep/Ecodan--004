import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const sources = new Set(["submittals", "upload_requests"]);
type FileReference = { url?: string; bucketPath?: string };

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function toDownloadUrl(url: string) {
  const match = url.match(/drive\.google\.com\/(?:file\/d\/|open\?id=)([a-zA-Z0-9_-]+)/)
    || url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  return match ? `https://drive.google.com/uc?export=download&id=${match[1]}` : url;
}

async function getFile(admin: ReturnType<typeof createClient>, source: string, requestId: number): Promise<FileReference | null> {
  if (source === "submittals") {
    const { data } = await admin.from("submittals").select("link").eq("id", requestId).maybeSingle();
    return data?.link ? reference(data.link) : null;
  }
  const { data } = await admin.from("upload_requests").select("file_link").eq("id", requestId).maybeSingle();
  return data?.file_link ? reference(data.file_link) : null;
}

function reference(value: string): FileReference {
  return /^https?:\/\//i.test(value) ? { url: value } : { bucketPath: value.replace(/^\/+/, "") };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const token = new URL(request.url).searchParams.get("token");

  if (request.method === "GET" && token) {
    // Atomically consume the token.  This prevents replaying a copied URL.
    const { data: access, error } = await admin
      .from("temporary_access_tokens")
      .update({ used_at: new Date().toISOString() })
      .eq("token", token)
      .is("used_at", null)
      .gt("expires_at", new Date().toISOString())
      .in("source_table", [...sources])
      .select("request_id, source_table")
      .maybeSingle();
    if (error || !access) {
      return json({ error: "انتهت صلاحية الرابط أو استُخدم بالفعل. أنشئ رابط تنزيل جديدًا." }, 410);
    }
    const file = await getFile(admin, access.source_table, access.request_id);
    if (!file) return json({ error: "الملف لم يعد متاحًا." }, 404);
    if (file.bucketPath) {
      const { data, error: signError } = await admin.storage
        .from("task-attachments")
        .createSignedUrl(file.bucketPath, 20 * 60);
      if (signError || !data?.signedUrl) return json({ error: "تعذر تجهيز رابط الملف." }, 500);
      return Response.redirect(data.signedUrl, 302);
    }
    return Response.redirect(toDownloadUrl(file.url!), 302);
  }

  if (request.method !== "POST") return json({ error: "Not found" }, 404);
  const bearer = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!bearer) return json({ error: "Authentication required" }, 401);
  const { data: authData, error: authError } = await admin.auth.getUser(bearer);
  if (authError || !authData.user) return json({ error: "Authentication required" }, 401);

  const payload = await request.json().catch(() => ({}));
  const requestId = Number(payload.request_id);
  const source = String(payload.source_table || "");
  if (!sources.has(source) || !Number.isSafeInteger(requestId) || requestId < 1) {
    return json({ error: "Invalid download request" }, 400);
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("permissions, page_summary, is_blocked")
    .eq("id", authData.user.id)
    .maybeSingle();
  const role = profile?.permissions?.trim().toLowerCase();
  const canViewSummary = role === "administrator" || role === "admin" || profile?.page_summary === "yes";
  if (!profile || profile.is_blocked || !canViewSummary) {
    return json({ error: "You are not allowed to download this file" }, 403);
  }
  if (!await getFile(admin, source, requestId)) return json({ error: "No file is available for this request" }, 404);

  const tokenValue = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 20 * 60 * 1000).toISOString();
  const { error: tokenError } = await admin.from("temporary_access_tokens").insert({
    token: tokenValue, request_id: requestId, source_table: source, expires_at: expiresAt,
  });
  if (tokenError) return json({ error: "Could not create download link" }, 500);
  return json({ url: `${supabaseUrl}/functions/v1/temporary-download?token=${tokenValue}`, expires_at: expiresAt });
});
