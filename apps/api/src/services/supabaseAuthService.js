function supabaseAuthConfig() {
  const supabaseUrl = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const explicitlyDisabled = process.env.SUPABASE_AUTH_SYNC_ENABLED === "false";
  if (explicitlyDisabled || !supabaseUrl || !serviceRoleKey) return null;
  return { supabaseUrl, serviceRoleKey, required: process.env.SUPABASE_AUTH_SYNC_REQUIRED === "true" };
}

async function supabaseAuthRequest(config, path, options = {}) {
  const response = await fetch(`${config.supabaseUrl}/auth/v1${path}`, {
    ...options,
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = payload.message || payload.error_description || payload.error || response.statusText;
    throw new Error(`Supabase Auth request failed: ${detail}`);
  }
  return payload;
}

async function findSupabaseAuthUserByEmail(config, email) {
  const normalizedEmail = email.toLowerCase();
  for (let page = 1; page <= 20; page += 1) {
    const payload = await supabaseAuthRequest(config, `/admin/users?page=${page}&per_page=100`);
    const users = Array.isArray(payload) ? payload : payload.users || [];
    const match = users.find((user) => user.email?.toLowerCase() === normalizedEmail);
    if (match) return match;
    if (users.length < 100) return null;
  }
  return null;
}

export async function updateSupabaseAuthPassword({ email, password }) {
  const config = supabaseAuthConfig();
  if (!config) return { status: "skipped", reason: "supabase_auth_not_configured" };

  try {
    const authUser = await findSupabaseAuthUserByEmail(config, email);
    if (!authUser?.id) {
      if (config.required) throw new Error(`No Supabase Auth user found for ${email}.`);
      return { status: "skipped", reason: "supabase_auth_user_not_found" };
    }
    await supabaseAuthRequest(config, `/admin/users/${authUser.id}`, {
      method: "PUT",
      body: JSON.stringify({ password })
    });
    return { status: "updated", authUserId: authUser.id };
  } catch (error) {
    if (config.required) throw error;
    return { status: "warning", reason: error.message };
  }
}
