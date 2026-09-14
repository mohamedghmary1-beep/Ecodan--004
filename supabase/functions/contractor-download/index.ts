import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, "Content-Type": "application/json" },
});
const toDownloadUrl = (url: string) => {
  const match = url.match(/drive\.google\.com\/(?:file\/d\/|open\?id=)([a-zA-Z0-9_-]+)/)
    || url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  return match ? `https://drive.google.com/uc?export=download&id=${match[1]}` : url;
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const token = new URL(request.url).searchParams.get("token");

  if (request.method === "GET" && token) {
    const { data: access, error } = await admin.from("temporary_access_tokens")
      .update({ used_at: new Date().toISOString() })
      .eq("token", token).eq("source_table", "contractor_requests")
      .is("used_at", null).gt("expires_at", new Date().toISOString())
      .select("request_id").maybeSingle();
    if (error || !access) return json({ error: "انتهت صلاحية الرابط أو استُخدم بالفعل. أنشئ رابط تنزيل جديدًا." }, 410);
    const { data: fileRequest } = await admin.from("contractor_requests")
      .select("drive_file_url, file_link").eq("id", access.request_id).maybeSingle();
    const fileUrl = fileRequest?.drive_file_url || fileRequest?.file_link;
    if (!fileUrl) return json({ error: "الملف لم يعد متاحًا." }, 404);
    if (!/^https?:\/\//i.test(fileUrl)) {
      const { data, error: signError } = await admin.storage.from("task-attachments")
        .createSignedUrl(fileUrl.replace(/^\/+/, ""), 20 * 60);
      if (signError || !data?.signedUrl) return json({ error: "تعذر تجهيز رابط الملف." }, 500);
      return Response.redirect(data.signedUrl, 302);
    }
    return Response.redirect(toDownloadUrl(fileUrl), 302);
  }

  if (request.method !== "POST") return json({ error: "Not found" }, 404);
  const bearer = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!bearer) return json({ error: "Authentication required" }, 401);
  const { data: authData, error: authError } = await admin.auth.getUser(bearer);
  if (authError || !authData.user) return json({ error: "Authentication required" }, 401);
  const payload = await request.json().catch(() => ({}));
  const requestId = Number(payload.request_id);
  if (!Number.isSafeInteger(requestId) || requestId < 1) return json({ error: "Invalid request" }, 400);

  const { data: fileRequest } = await admin.from("contractor_requests")
    .select("id, contractor_id, engineer_id, drive_file_url, file_link")
    .eq("id", requestId).maybeSingle();
  const fileUrl = fileRequest?.drive_file_url || fileRequest?.file_link;
  if (!fileRequest || !fileUrl) return json({ error: "No file is available for this request" }, 404);
  const { data: profile } = await admin.from("profiles").select("permissions, is_blocked")
    .eq("id", authData.user.id).maybeSingle();
  const role = profile?.permissions?.trim().toLowerCase();
  const permitted = !profile?.is_blocked && (role === "administrator" || role === "admin"
    || fileRequest.contractor_id === authData.user.id || fileRequest.engineer_id === authData.user.id);
  if (!permitted) return json({ error: "You are not allowed to download this file" }, 403);

  const tokenValue = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 20 * 60 * 1000).toISOString();
  const { error: tokenError } = await admin.from("temporary_access_tokens").insert({
    token: tokenValue, request_id: requestId, source_table: "contractor_requests", expires_at: expiresAt,
  });
  if (tokenError) return json({ error: "Could not create download link" }, 500);
  return json({ url: `${supabaseUrl}/functions/v1/contractor-download?token=${tokenValue}`, expires_at: expiresAt });
});
