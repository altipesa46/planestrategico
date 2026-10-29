// Edge Function «admin-usuarios»
// Gestión de usuarios para administradores: listar, crear, modificar rol/estado,
// cambiar contraseña y eliminar. Usa la service_role key, que SOLO vive en el
// servidor de Supabase (nunca en la app ni en GitHub).
//
// Despliegue:  supabase functions deploy admin-usuarios
// Variable opcional: USER_DOMAIN (debe coincidir con config.js)

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const USER_DOMAIN = Deno.env.get("USER_DOMAIN") ?? "usuarios.almesa.app";
const USUARIO_RE = /^[a-z0-9._-]{2,30}$/;
const ROLES = ["admin", "usuario"];

class Fallo extends Error {}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  // 1. ¿Quién llama?
  const caller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false },
  });
  const { data: { user }, error: userErr } = await caller.auth.getUser();
  if (userErr || !user) return json({ error: "Sesión no válida. Vuelve a entrar." }, 401);

  // 2. ¿Es administrador activo?
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { data: yo } = await admin.from("perfiles").select("rol, activo").eq("id", user.id).maybeSingle();
  if (!yo || !yo.activo || yo.rol !== "admin") return json({ error: "Solo los administradores pueden gestionar usuarios." }, 403);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Petición no válida." }, 400); }

  const str = (v: unknown) => String(v ?? "").trim();
  const checkPassword = (p: string) => { if (p.length < 8) throw new Fallo("La contraseña debe tener al menos 8 caracteres."); };
  const checkRol = (r: string) => { if (!ROLES.includes(r)) throw new Fallo("Rol no válido."); };

  try {
    switch (body.action) {
      case "list": {
        const { data: perfiles, error } = await admin.from("perfiles").select("*").order("usuario");
        if (error) throw error;
        const { data: au, error: e2 } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
        if (e2) throw e2;
        const m = new Map(au.users.map((u) => [u.id, u]));
        return json({
          usuarios: perfiles.map((p) => ({ ...p, email: m.get(p.id)?.email ?? "", ultimo_acceso: m.get(p.id)?.last_sign_in_at ?? null })),
        });
      }

      case "create": {
        const usuario = str(body.usuario).toLowerCase();
        const password = String(body.password ?? "");
        const rol = str(body.rol) || "usuario";
        if (!USUARIO_RE.test(usuario)) throw new Fallo("Usuario: 2 a 30 caracteres, solo minúsculas, números, punto o guion.");
        checkPassword(password); checkRol(rol);
        const { data: existe } = await admin.from("perfiles").select("id").eq("usuario", usuario).maybeSingle();
        if (existe) throw new Fallo(`El usuario «${usuario}» ya existe.`);
        const { data, error } = await admin.auth.admin.createUser({
          email: `${usuario}@${USER_DOMAIN}`, password, email_confirm: true, user_metadata: { usuario },
        });
        if (error) throw new Fallo(/already/i.test(error.message) ? `El usuario «${usuario}» ya existe.` : error.message);
        const { error: pErr } = await admin.from("perfiles").insert({
          id: data.user.id, usuario, nombre: str(body.nombre), responsable: str(body.responsable) || null,
          rol, activo: body.activo !== false, cambiar_password: true,
        });
        if (pErr) { await admin.auth.admin.deleteUser(data.user.id); throw pErr; }
        return json({ id: data.user.id });
      }

      case "update": {
        const id = str(body.id);
        const rol = str(body.rol);
        const activo = body.activo !== false;
        checkRol(rol);
        if (id === user.id && (rol !== "admin" || !activo)) throw new Fallo("No puedes quitarte el rol de administrador ni desactivarte a ti mismo.");
        const { error } = await admin.from("perfiles").update({
          nombre: str(body.nombre), responsable: str(body.responsable) || null, rol, activo,
        }).eq("id", id);
        if (error) throw error;
        // Un usuario desactivado no puede iniciar sesión
        const { error: bErr } = await admin.auth.admin.updateUserById(id, { ban_duration: activo ? "none" : "876000h" });
        if (bErr) throw bErr;
        return json({ ok: true });
      }

      case "set_password": {
        const id = str(body.id);
        const password = String(body.password ?? "");
        checkPassword(password);
        const { error } = await admin.auth.admin.updateUserById(id, { password });
        if (error) throw error;
        // Contraseña puesta por un administrador = provisional (salvo la propia)
        await admin.from("perfiles").update({ cambiar_password: id !== user.id }).eq("id", id);
        return json({ ok: true });
      }

      case "delete": {
        const id = str(body.id);
        if (id === user.id) throw new Fallo("No puedes eliminar tu propio usuario.");
        const { error } = await admin.auth.admin.deleteUser(id); // el perfil se borra en cascada
        if (error) throw error;
        return json({ ok: true });
      }

      default:
        return json({ error: "Acción no reconocida." }, 400);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : (e as { message?: string })?.message ?? "Error inesperado";
    return json({ error: msg }, e instanceof Fallo ? 400 : 500);
  }
});
