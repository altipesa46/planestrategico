// Crea los usuarios iniciales (uno por responsable) con contraseña provisional.
// Se ejecuta UNA vez, desde tu ordenador, después de aplicar el esquema y los datos.
//
//   cd scripts
//   npm install
//   node crear-usuarios.mjs https://TU-PROYECTO.supabase.co TU_SERVICE_ROLE_KEY
//
// La service_role key está en Supabase > Project Settings > API. Es secreta:
// no la guardes en ningún archivo ni la subas a GitHub.

import { createClient } from "@supabase/supabase-js";
import { randomInt } from "node:crypto";

const [url, serviceKey, domainArg] = process.argv.slice(2);
const USER_DOMAIN = domainArg || "usuarios.almesa.app"; // debe coincidir con config.js
if (!url || !serviceKey) {
  console.error("Uso: node crear-usuarios.mjs <SUPABASE_URL> <SERVICE_ROLE_KEY> [dominio]");
  process.exit(1);
}

// Usuarios iniciales: uno por responsable. Juan y Ricardo son administradores.
const USUARIOS = [
  { usuario: "jm",  nombre: "Juan Montesinos", responsable: "JM",  rol: "admin" },
  { usuario: "rn",  nombre: "Ricardo",         responsable: "RN",  rol: "admin" },
  { usuario: "mjf", nombre: "M. José Feltrer", responsable: "MJF", rol: "usuario" },
  { usuario: "bg",  nombre: "Begoña",          responsable: "BG",  rol: "usuario" },
];

const ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
const generar = () => Array.from({ length: 10 }, () => ALFABETO[randomInt(ALFABETO.length)]).join("");

const sb = createClient(url, serviceKey, { auth: { persistSession: false } });
const resultado = [];

for (const u of USUARIOS) {
  const { data: existe } = await sb.from("perfiles").select("id").eq("usuario", u.usuario).maybeSingle();
  if (existe) { resultado.push({ ...u, password: "(ya existía, no se ha cambiado)" }); continue; }
  const password = generar();
  const { data, error } = await sb.auth.admin.createUser({
    email: `${u.usuario}@${USER_DOMAIN}`, password, email_confirm: true, user_metadata: { usuario: u.usuario },
  });
  if (error) { console.error(`✗ ${u.usuario}: ${error.message}`); continue; }
  const { error: pErr } = await sb.from("perfiles").insert({
    id: data.user.id, usuario: u.usuario, nombre: u.nombre, responsable: u.responsable, rol: u.rol, activo: true, cambiar_password: true,
  });
  if (pErr) { console.error(`✗ ${u.usuario}: ${pErr.message}`); await sb.auth.admin.deleteUser(data.user.id); continue; }
  resultado.push({ ...u, password });
}

console.log("\nUsuarios creados (contraseñas provisionales, se pedirá cambiarlas al entrar):\n");
console.table(resultado.map(({ usuario, nombre, rol, password }) => ({ usuario, nombre, rol, "contraseña provisional": password })));
console.log("\nComunica cada contraseña a su persona por un canal privado y no la guardes en este equipo.\n");
