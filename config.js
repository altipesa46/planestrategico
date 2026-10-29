// Configuración pública de la app. Estos dos valores están en
// Supabase > Project Settings > API ("Project URL" y "anon public" / "publishable key").
// La clave anon es pública por diseño: la seguridad la ponen el inicio de sesión
// y las reglas RLS de la base de datos. NUNCA pongas aquí la service_role key.
window.APP_CONFIG = {
  SUPABASE_URL: "https://figoojrhrlwgetxnoxsd.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_aHMOBbaW1QMu4bbuE_C_gg_MvTsKAy-",
  // Los usuarios entran con un nombre corto (p. ej. "jm"); internamente se
  // convierte en jm@<USER_DOMAIN>. Debe coincidir con el de la Edge Function y el script.
  USER_DOMAIN: "usuarios.almesa.app"
};
