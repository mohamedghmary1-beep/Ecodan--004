import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
};

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(request.url);
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  // A token URL contains no Drive URL. Its only job is to redirect while valid.
  const token = url.searchParams.get("token");
  if (request.method === "GET" && token) {
    const { data: access, error } = await admin
      .from("temporary_access_tokens")
      .select("request_id, expires_at")
      .eq("token", token)
      .maybeSingle();
    if (error || !access || new Date(access.expires_at) <= new Date()) {
      return json({ error: "انتهت صلاحية الرابط. أنشئ رابط تحميل جديدًا." }, 410);
    }
    const { data: fileRequest } = await admin
      .from("contractor_requests")
      .select("drive_file_url")
      .eq("id", access.request_id)
      .maybeSingle();
    if (!fileRequest?.drive_file_url) return json({ error: "الملف لم يعد متاحًا." }, 404);
    return Response.redirect(fileRequest.drive_file_url, 302);
  }

  if (request.method !== "POST") return json({ error: "Not found" }, 404);
  const bearer = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!bearer) return json({ error: "Authentication required" }, 401);
  const { data: authData, error: authError } = await admin.auth.getUser(bearer);
  const viewer = authData.user;
  if (authError || !viewer) return json({ error: "Authentication required" }, 401);

  const payload = await request.json().catch(() => ({}));
  const requestId = Number(payload.request_id);
  if (!Number.isSafeInteger(requestId) || requestId < 1) return json({ error: "Invalid request" }, 400);

  const { data: fileRequest } = await admin
    .from("contractor_requests")
    .select("id, contractor_id, engineer_id, drive_file_url")
    .eq("id", requestId)
    .maybeSingle();
  if (!fileRequest?.drive_file_url) return json({ error: "No file is available for this request" }, 404);

  const { data: profile } = await admin
    .from("profiles")
    .select("permissions")
    .eq("id", viewer.id)
    .maybeSingle();
  const role = profile?.permissions?.trim().toLowerCase();
  const permitted = role === "administrator" || role === "admin" ||
    fileRequest.contractor_id === viewer.id || fileRequest.engineer_id === viewer.id;
  if (!permitted) return json({ error: "You are not allowed to download this file" }, 403);

  const tokenValue = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 20 * 60 * 1000).toISOString();
  const { error: tokenError } = await admin.from("temporary_access_tokens").insert({
    token: tokenValue,
    request_id: requestId,
    expires_at: expiresAt,
  });
  if (tokenError) return json({ error: "Could not create download link" }, 500);

  return json({ url: `${supabaseUrl}/functions/v1/contractor-download?token=${tokenValue}`, expires_at: expiresAt });
});
