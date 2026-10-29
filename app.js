/* Seguimiento de acciones del Plan Estratégico — Almesa
 * App estática (GitHub Pages) + Supabase (Auth, Postgres con RLS, Realtime, Edge Function).
 */
(() => {
"use strict";
const CFG = window.APP_CONFIG || {};
const ESTADOS = ["Pendiente","En curso","Standby","Cerrada"];
const PRIOS = ["Alta","Media","Baja"];
const MESES = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
const MES3 = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
const MSKEYS = ["actividad","modulo","grupo","subgrupo","estado","resp","prio"];
const MSLABEL = {actividad:"Actividad",modulo:"Módulo",grupo:"Grupo",subgrupo:"Sub-grupo",estado:"Estado",resp:"Responsable",prio:"Prioridad"};
const CHEV = `<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const pad = n => String(n).padStart(2,"0");
const iso = d => d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate());
const parse = s => { if(!s) return null; const [y,m,d] = s.split("-").map(Number); return new Date(y,m-1,d); };
const today = iso(new Date());
const addDays = (s,n) => { const d = parse(s); d.setDate(d.getDate()+n); return iso(d); };
const diffDays = (a,b) => Math.round((parse(b)-parse(a))/86400000);
const fmt = s => { if(!s) return "—"; const d = parse(s); return pad(d.getDate())+" "+MES3[d.getMonth()]+" "+String(d.getFullYear()).slice(2); };
const fmtTs = t => { if(!t) return "—"; const d = new Date(t); return fmt(iso(d)) + " " + pad(d.getHours())+":"+pad(d.getMinutes()); };
const stClass = e => "st-" + String(e||"Pendiente").replace(/\s+/g,"-");
const splitResp = r => String(r||"").split(/\s*(?:&|,|\/)\s*/).map(x=>x.trim()).filter(Boolean);
const isOverdue = r => r.fin && r.fin < today && r.estado !== "Cerrada";
const uniq = arr => [...new Set(arr.filter(Boolean))];
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)+Math.random().toString(36).slice(2));

/* ---------- estado ---------- */
let sb = null, me = null, isAdmin = false, canWrite = false;
let rows = [], resps = [], byId = new Map(), respMap = new Map();
let usuarios = null, usuariosErr = "";
let loaded = false, drawer = null, openKey = null, channel = null;
const store = { get(k,d){ try{ const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; }catch(e){ return d; } }, set(k,v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} } };
const blankF = () => ({actividad:[],modulo:[],grupo:[],subgrupo:[],estado:[],resp:[],prio:[],desde:"",hasta:"",fechas:""});
let st = Object.assign({ view:"lista", cal: today.slice(0,7), col:{} }, store.get("pe-ui", {}));
st.f = Object.assign(blankF(), st.f || {});
for (const k of MSKEYS) st.f[k] = Array.isArray(st.f[k]) ? st.f[k] : (st.f[k] ? [st.f[k]] : []);
if (!st.col || typeof st.col !== "object") st.col = {};
const saveUi = () => store.set("pe-ui", st);

/* ---------- datos (Supabase) ---------- */
const fromDb = r => ({
  id: r.id, padre: r.padre || "", modulo: r.modulo || "", grupo: r.grupo || "", subgrupo: r.subgrupo || "",
  actividad: r.actividad || "", estado: r.estado || "Pendiente", responsable: r.responsable || "", prioridad: r.prioridad || "",
  inicio: r.inicio || "", fin: r.fin || "", notas: r.notas || "", orden: r.orden, historial: Array.isArray(r.historial) ? r.historial : [],
  creado: r.creado, actualizado: r.actualizado
});
async function loadAcciones(){
  const { data, error } = await sb.from("acciones").select("*");
  if (error) throw error;
  rows = data.map(fromDb); byId = new Map(rows.map(r => [r.id, r]));
}
async function loadResps(){
  const { data, error } = await sb.from("responsables").select("*");
  if (error) throw error;
  resps = data.map(p => ({ ...p, id: p.codigo })); respMap = new Map(resps.map(p => [p.id, p]));
}
async function loadUsuarios(){
  if (!isAdmin) return;
  usuariosErr = "";
  try { const d = await adminCall("list"); usuarios = d.usuarios || []; }
  catch(e){ usuarios = usuarios || []; usuariosErr = e.message; }
}
async function adminCall(action, payload){
  const { data, error } = await sb.functions.invoke("admin-usuarios", { body: Object.assign({ action }, payload || {}) });
  if (error){
    let msg = error.message || "Error";
    try { const j = await error.context.json(); if (j && j.error) msg = j.error; } catch(e){}
    if (/Failed to send|fetch/i.test(msg)) msg = "No se puede contactar con la función admin-usuarios. ¿Está desplegada?";
    throw new Error(msg);
  }
  return data;
}
const timers = {};
function scheduleReload(what){
  clearTimeout(timers[what]);
  timers[what] = setTimeout(async () => {
    try {
      if (what === "acciones") await loadAcciones();
      else if (what === "responsables") await loadResps();
      else if (what === "perfiles"){ await refreshMe(); if (st.view === "usuarios") await loadUsuarios(); }
      refresh();
    } catch(e){ console.error(e); }
  }, 250);
}
function subscribe(){
  if (channel) sb.removeChannel(channel);
  channel = sb.channel("pe-cambios")
    .on("postgres_changes", { event:"*", schema:"public", table:"acciones" }, () => scheduleReload("acciones"))
    .on("postgres_changes", { event:"*", schema:"public", table:"responsables" }, () => scheduleReload("responsables"))
    .on("postgres_changes", { event:"*", schema:"public", table:"perfiles" }, () => scheduleReload("perfiles"))
    .subscribe();
}
function dbErr(e){
  const m = (e && (e.message || "")) + " " + (e && e.code || "");
  if (/42501|row-level security|permission/i.test(m)) return "No tienes permiso para hacer este cambio.";
  if (/fechas_ok/.test(m)) return "El cierre objetivo no puede ser anterior al inicio.";
  if (/Failed to fetch|NetworkError/i.test(m)) return "Sin conexión. Revisa tu red e inténtalo de nuevo.";
  return "No se pudo guardar: " + (e && e.message || "error desconocido");
}

/* ---------- acceso ---------- */
function gate(html, onsubmit){
  $("#app").hidden = true; $("#gate").hidden = false;
  const f = $("#gate-form"); f.innerHTML = html; f.onsubmit = e => { e.preventDefault(); onsubmit && onsubmit(f); };
  const first = f.querySelector("input"); first && first.focus();
}
function showConfigMissing(){
  gate(`<div class="eyebrow">Almesa · Plan estratégico</div><h1>Falta la configuración</h1>
    <p>Edita <b>config.js</b> con la URL del proyecto de Supabase y su clave pública (anon). El README explica dónde encontrarlas.</p>`);
}
function showLogin(msg){
  gate(`<div class="eyebrow">Almesa · Plan estratégico</div><h1>Seguimiento de acciones</h1>
    <p>Entra con tu usuario y contraseña.</p>
    <div class="fld"><label for="lg-user">Usuario</label><input id="lg-user" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="p. ej. jm"></div>
    <div class="fld"><label for="lg-pass">Contraseña</label><input id="lg-pass" type="password" autocomplete="current-password"></div>
    <span class="err" id="lg-err">${esc(msg || "")}</span>
    <button class="btn primary" type="submit" id="lg-btn">Entrar</button>
    <p style="font-size:12.5px">¿Has olvidado la contraseña? Pide a un administrador que te asigne una nueva.</p>`, doLogin);
}
async function doLogin(f){
  const u = f.querySelector("#lg-user").value.trim().toLowerCase(), p = f.querySelector("#lg-pass").value;
  const err = f.querySelector("#lg-err"), btn = f.querySelector("#lg-btn");
  if (!u || !p){ err.textContent = "Escribe usuario y contraseña."; return; }
  const email = u.includes("@") ? u : `${u}@${CFG.USER_DOMAIN || "usuarios.almesa.app"}`;
  btn.disabled = true; btn.textContent = "Entrando…"; err.textContent = "";
  const { error } = await sb.auth.signInWithPassword({ email, password: p });
  if (error){
    btn.disabled = false; btn.textContent = "Entrar";
    err.textContent = /invalid login|invalid credentials/i.test(error.message) ? "Usuario o contraseña incorrectos." : /banned/i.test(error.message) ? "Tu usuario está desactivado. Habla con un administrador." : "No se pudo entrar: " + error.message;
    return;
  }
  await enter();
}
function showChangePassword(forced){
  const html = `<div class="eyebrow">${forced ? "Primer acceso" : "Tu cuenta"}</div><h1>${forced ? "Elige tu contraseña" : "Cambiar contraseña"}</h1>
    <p>${forced ? "Has entrado con una contraseña provisional. Elige una nueva para continuar." : "Escribe la nueva contraseña dos veces."} Mínimo 8 caracteres.</p>
    <div class="fld"><label for="cp-1">Nueva contraseña</label><input id="cp-1" type="password" autocomplete="new-password"></div>
    <div class="fld"><label for="cp-2">Repite la contraseña</label><input id="cp-2" type="password" autocomplete="new-password"></div>
    <span class="err" id="cp-err"></span>
    <button class="btn primary" type="submit" id="cp-btn">Guardar contraseña</button>
    ${forced ? `<button class="btn" type="button" id="cp-out">Salir</button>` : `<button class="btn" type="button" id="cp-cancel">Cancelar</button>`}`;
  gate(html, async f => {
    const a = f.querySelector("#cp-1").value, b = f.querySelector("#cp-2").value, err = f.querySelector("#cp-err"), btn = f.querySelector("#cp-btn");
    if (a.length < 8){ err.textContent = "La contraseña debe tener al menos 8 caracteres."; return; }
    if (a !== b){ err.textContent = "Las dos contraseñas no coinciden."; return; }
    btn.disabled = true; btn.textContent = "Guardando…";
    const { error } = await sb.auth.updateUser({ password: a });
    if (error){ btn.disabled = false; btn.textContent = "Guardar contraseña"; err.textContent = /same|different/i.test(error.message) ? "La nueva contraseña debe ser distinta de la anterior." : "No se pudo cambiar: " + error.message; return; }
    await sb.rpc("marcar_password_cambiada");
    if (me) me.cambiar_password = false;
    toast("Contraseña actualizada");
    await enter();
  });
  const o = $("#cp-out"); if (o) o.onclick = logout;
  const c = $("#cp-cancel"); if (c) c.onclick = () => showApp();
}
async function refreshMe(){
  const { data: { user } } = await sb.auth.getUser();
  if (!user){ me = null; return; }
  const { data } = await sb.from("perfiles").select("*").eq("id", user.id).maybeSingle();
  me = data || null;
  isAdmin = !!(me && me.activo && me.rol === "admin");
  canWrite = !!(me && me.activo);
}
async function enter(){
  try { await refreshMe(); } catch(e){ showLogin("No se pudo comprobar tu usuario."); return; }
  if (!me){ await sb.auth.signOut(); showLogin("Tu cuenta no tiene perfil en la app. Habla con un administrador."); return; }
  if (!me.activo){ await sb.auth.signOut(); showLogin("Tu usuario está desactivado. Habla con un administrador."); return; }
  if (me.cambiar_password){ showChangePassword(true); return; }
  showApp();
  try { await Promise.all([loadAcciones(), loadResps()]); loaded = true; refresh(); subscribe(); }
  catch(e){ $("#view").innerHTML = `<div class="empty"><h2>No se pudieron cargar los datos</h2><p>${esc(e.message || "")}</p></div>`; }
}
async function logout(){ if (channel){ sb.removeChannel(channel); channel = null; } await sb.auth.signOut(); me = null; rows = []; resps = []; usuarios = null; loaded = false; closeDrawer(); showLogin(); }
function showApp(){
  $("#gate").hidden = true; $("#app").hidden = false;
  $("#me").innerHTML = me ? `<span><b>${esc(me.nombre || me.usuario)}</b> · ${esc(me.usuario)}</span><span class="role">${me.rol === "admin" ? "Administrador" : "Usuario"}</span>
    <button class="btn" id="me-pass">Cambiar contraseña</button><button class="btn" id="me-out">Salir</button>` : "";
  const mp = $("#me-pass"); if (mp) mp.onclick = () => showChangePassword(false);
  const mo = $("#me-out"); if (mo) mo.onclick = logout;
  $("#tab-users").hidden = !isAdmin;
  if (!isAdmin && st.view === "usuarios") st.view = "lista";
  $("#mine").hidden = !(me && me.responsable);
  render();
}

/* ---------- modelo ---------- */
const isTop = r => !r.padre || !byId.has(r.padre);
const parentOf = r => r.padre ? byId.get(r.padre) : null;
function eff(r){ const p = parentOf(r) || r; return { modulo:p.modulo||"", grupo:p.grupo||"", subgrupo:p.subgrupo||"", nombre:p.actividad||"" }; }
function valueOf(r, key){
  const e = eff(r);
  switch(key){
    case "actividad": return e.nombre;
    case "modulo": case "grupo": case "subgrupo": return e[key];
    case "estado": return r.estado || "Pendiente";
    case "resp": { const c = splitResp(r.responsable); return c.length ? c : ["(sin)"]; }
    case "prio": return r.prioridad || "(sin)";
  }
}
const sorted = list => list.slice().sort((a,b) => (a.orden??1e9) - (b.orden??1e9) || String(a.actividad).localeCompare(b.actividad));
const kidsOf = id => sorted(rows.filter(r => r.padre === id));
function matchesExcept(r, skip){
  const f = st.f;
  for (const k of MSKEYS){
    if (k === skip || !f[k].length) continue;
    const vals = [].concat(valueOf(r,k));
    if (!vals.some(v => f[k].includes(v))) return false;
  }
  if (f.desde || f.hasta){
    const s = r.inicio || r.fin, e = r.fin || r.inicio;
    if (!s) return false;
    if (f.desde && e < f.desde) return false;
    if (f.hasta && s > f.hasta) return false;
  }
  if (f.fechas === "vencidas" && !isOverdue(r)) return false;
  if (f.fechas === "sin" && (r.inicio || r.fin)) return false;
  if (f.fechas === "semana" && !(r.fin && r.estado!=="Cerrada" && r.fin >= today && r.fin <= addDays(today,7))) return false;
  if (f.fechas === "mes" && !(r.fin && r.estado!=="Cerrada" && r.fin >= today && r.fin <= addDays(today,30))) return false;
  return true;
}
const matches = r => matchesExcept(r, null);
function visibleTops(){
  const out = [];
  for (const t of sorted(rows.filter(isTop))){
    const all = kidsOf(t.id), vk = all.filter(matches), m = matches(t);
    if (m || vk.length) out.push({ r:t, ctx:!m, kids:vk, all });
  }
  return out;
}
function groupTree(entries){
  const tree = new Map();
  for (const en of entries){
    const r = en.r, m = r.modulo || "Sin módulo", g = r.grupo || "Sin grupo", s = r.subgrupo || "Sin sub-grupo";
    if (!tree.has(m)) tree.set(m, new Map());
    const gm = tree.get(m); if (!gm.has(g)) gm.set(g, new Map());
    const sm = gm.get(g); if (!sm.has(s)) sm.set(s, []);
    sm.get(s).push(en);
  }
  return tree;
}

/* ---------- filtros multi-selección ---------- */
function respLabel(c){ if (c === "(sin)") return "Sin asignar"; const p = respMap.get(c); return p && p.nombre ? `${c} · ${p.nombre}` : c; }
const UPS = {modulo:[],grupo:["modulo"],subgrupo:["modulo","grupo"],actividad:["modulo","grupo","subgrupo"]};
function optionsFor(key){
  let vals = [], hints = {};
  if (UPS[key]){
    const src = sorted(rows.filter(isTop)).filter(r => UPS[key].every(u => !st.f[u].length || st.f[u].includes(valueOf(r,u))));
    vals = uniq(src.map(r => valueOf(r,key)));
    if (key === "actividad") for (const r of src){ const h = r.subgrupo || ""; hints[r.actividad] = hints[r.actividad] && hints[r.actividad] !== h ? "Varios sub-grupos" : h; }
  }
  else if (key === "estado") vals = ESTADOS;
  else if (key === "prio") vals = PRIOS.concat(["(sin)"]);
  else if (key === "resp"){
    const known = resps.slice().sort((a,b)=>(a.orden??999)-(b.orden??999)||a.id.localeCompare(b.id)).map(p=>p.id);
    vals = uniq(known.concat(rows.flatMap(r => splitResp(r.responsable)))).concat(["(sin)"]);
  }
  for (const v of st.f[key]) if (!vals.includes(v)) vals.push(v);
  const tops = rows.filter(isTop);
  return vals.map(v => ({
    v, label: key==="resp" ? respLabel(v) : key==="prio" && v==="(sin)" ? "Sin prioridad" : v, hint: hints[v] || "",
    n: tops.filter(r => matchesExcept(r,key) && [].concat(valueOf(r,key)).includes(v)).length
  }));
}
function msLabel(key){
  const sel = st.f[key];
  if (!sel.length) return key === "actividad" ? "Todas · buscar…" : "Todos";
  if (sel.length === 1) return key==="resp" ? respLabel(sel[0]) : key==="prio" && sel[0]==="(sin)" ? "Sin prioridad" : sel[0];
  return `${sel.length} seleccionados`;
}
function buildMs(){
  for (const key of MSKEYS){
    const host = $("#ms-"+key);
    host.innerHTML = `<span class="lbl" id="lbl-${key}">${MSLABEL[key]}</span>
      <button type="button" class="ms-btn" id="msb-${key}" aria-haspopup="listbox" aria-expanded="false" aria-labelledby="lbl-${key} msb-${key}"><span class="v"></span><span class="caret">▼</span></button>
      <div class="ms-pop" hidden>
        <input class="ms-q" id="msq-${key}" type="search" placeholder="${key==="actividad"?"Escribe para buscar actividades…":"Buscar…"}" autocomplete="off">
        <div class="ms-tools"><button type="button" class="btn link" data-msall>Seleccionar visibles</button><button type="button" class="btn link" data-msnone>Quitar selección</button></div>
        <div class="ms-list" role="listbox" aria-multiselectable="true"></div>
      </div>`;
    host.querySelector(".ms-btn").addEventListener("click", e => { e.stopPropagation(); openKey === key ? closeMs() : openMs(key); });
    host.querySelector(".ms-q").addEventListener("input", () => renderMsList(key));
    host.querySelector(".ms-list").addEventListener("change", e => {
      const v = e.target.value, sel = st.f[key];
      st.f[key] = e.target.checked ? uniq(sel.concat([v])) : sel.filter(x => x !== v);
      onFilterChange(key);
    });
    host.querySelector("[data-msall]").addEventListener("click", () => {
      const vis = [...host.querySelectorAll(".ms-list input")].map(i => i.value);
      st.f[key] = uniq(st.f[key].concat(vis)); onFilterChange(key);
    });
    host.querySelector("[data-msnone]").addEventListener("click", () => { st.f[key] = []; onFilterChange(key); });
  }
  document.addEventListener("pointerdown", e => { if (openKey && !e.target.closest("#ms-"+openKey)) closeMs(); });
}
function openMs(key){
  closeMs(); openKey = key;
  const host = $("#ms-"+key), pop = host.querySelector(".ms-pop");
  pop.hidden = false; pop.classList.remove("right");
  host.querySelector(".ms-btn").setAttribute("aria-expanded","true");
  host.querySelector(".ms-q").value = "";
  renderMsList(key);
  const r = pop.getBoundingClientRect(); if (r.right > window.innerWidth - 8) pop.classList.add("right");
  host.querySelector(".ms-q").focus();
}
function closeMs(){
  if (!openKey) return;
  const host = $("#ms-"+openKey); openKey = null;
  host.querySelector(".ms-pop").hidden = true;
  host.querySelector(".ms-btn").setAttribute("aria-expanded","false");
}
function renderMsList(key){
  const host = $("#ms-"+key), q = host.querySelector(".ms-q").value.trim().toLowerCase();
  const opts = optionsFor(key).filter(o => !q || (o.label+" "+o.hint).toLowerCase().includes(q));
  const sel = st.f[key];
  host.querySelector(".ms-list").innerHTML = opts.length ? opts.map(o => `<label class="opt ${o.n?"":"zero"}"><input type="checkbox" value="${esc(o.v)}" ${sel.includes(o.v)?"checked":""}><span class="ol">${esc(o.label)}${o.hint?`<span class="oh">${esc(o.hint)}</span>`:""}</span><span class="oc">${o.n}</span></label>`).join("") : `<div class="ms-empty">Sin coincidencias</div>`;
}
function prune(){
  for (const k of ["grupo","subgrupo","actividad"]){
    const avail = new Set(sorted(rows.filter(isTop)).filter(r => UPS[k].every(u => !st.f[u].length || st.f[u].includes(valueOf(r,u)))).map(r=>valueOf(r,k)));
    st.f[k] = st.f[k].filter(v => avail.has(v));
  }
}
function onFilterChange(key){
  if (["modulo","grupo","subgrupo"].includes(key)) prune();
  saveUi(); renderFilterLabels(); if (openKey) renderMsList(openKey); renderSummary(); renderView();
}
function renderFilterLabels(){
  for (const key of MSKEYS){
    const b = $("#msb-"+key); b.querySelector(".v").textContent = msLabel(key); b.classList.toggle("on", st.f[key].length > 0);
  }
  $("#f-desde").value = st.f.desde; $("#f-hasta").value = st.f.hasta; $("#f-fechas").value = st.f.fechas;
  const active = MSKEYS.filter(k => st.f[k].length).length + ["desde","hasta","fechas"].filter(k => st.f[k]).length;
  $("#clear").disabled = !active;
  $("#ftoggle").textContent = active ? `Filtros (${active})` : "Filtros";
}
function bindStatic(){
  for (const k of ["desde","hasta","fechas"]) $("#f-"+k).addEventListener("change", e => { st.f[k] = e.target.value; onFilterChange(k); });
  $("#clear").addEventListener("click", () => { st.f = blankF(); closeMs(); onFilterChange("modulo"); });
  $("#mine").addEventListener("click", () => { if (!me || !me.responsable) return; st.f = blankF(); st.f.resp = [me.responsable]; if (["responsables","usuarios"].includes(st.view)) st.view = "lista"; saveUi(); render(); });
  $("#ftoggle").addEventListener("click", () => $("#filters").classList.toggle("collapsed"));
  document.querySelectorAll(".tabs button").forEach(b => b.addEventListener("click", async () => {
    st.view = b.dataset.view; saveUi(); render();
    if (st.view === "usuarios"){ await loadUsuarios(); renderView(); }
  }));
  $("#add").addEventListener("click", () => st.view === "responsables" ? openResp(null) : st.view === "usuarios" ? openUser(null) : openDrawer(null, {}));
  $("#expand").addEventListener("click", () => { st.col = {}; saveUi(); renderView(); });
  $("#collapse").addEventListener("click", () => { st.col = {}; for (const r of rows) if (isTop(r)) st.col["m:"+(r.modulo||"Sin módulo")] = true; saveUi(); renderView(); });
  document.addEventListener("keydown", e => { if (e.key !== "Escape") return; if (openKey){ closeMs(); return; } if (drawer) closeDrawer(); });
}
function renderSummary(){
  const vis = visibleTops(), nk = vis.reduce((a,e)=>a+e.kids.length,0), total = rows.filter(isTop).length;
  let msg = loaded ? `Mostrando ${vis.length} de ${total} actividades${nk?` · ${nk} subtareas`:""}` : "";
  if (st.view === "responsables") msg = loaded ? `${resps.length} responsables registrados` : "";
  if (st.view === "usuarios") msg = usuarios ? `${usuarios.length} usuarios` : "";
  if (!canWrite) msg += (msg?" · ":"") + "Solo lectura";
  $("#fsummary").textContent = msg;
  const addOk = st.view === "responsables" || st.view === "usuarios" ? isAdmin : canWrite;
  $("#add").hidden = !addOk || !loaded;
  $("#add").textContent = st.view === "responsables" ? "+ Nuevo responsable" : st.view === "usuarios" ? "+ Nuevo usuario" : "+ Nueva actividad";
  $("#treeacts").hidden = st.view !== "lista";
  const noFilters = ["responsables","usuarios"].includes(st.view);
  $("#filters").style.opacity = noFilters ? ".45" : "";
}

/* ---------- Lista (árbol) ---------- */
function statsHtml(entries, short){
  const tops = entries.map(e=>e.r);
  const n = tops.length, cerr = tops.filter(r=>r.estado==="Cerrada").length, cur = tops.filter(r=>r.estado==="En curso").length;
  const late = tops.filter(isOverdue).length + entries.reduce((a,e)=>a+e.kids.filter(isOverdue).length,0);
  const ks = entries.reduce((a,e)=>a+e.kids.length,0);
  const pct = n ? Math.round(cerr*100/n) : 0;
  if (short) return `${n} actividades · ${cur} en curso · ${cerr} cerradas${late?` · <span class="late">${late} vencidas</span>`:""}${ks?` · ${ks} subtareas`:""}`;
  return `<span><b>${n}</b> actividades</span><span><b>${cur}</b> en curso</span><span><b>${cerr}</b> cerradas</span>${late?`<span class="bad"><b>${late}</b> vencidas</span>`:""}${ks?`<span><b>${ks}</b> subtareas</span>`:""}<span class="minibar" title="${pct}% cerradas"><i style="width:${pct}%"></i></span><span class="mono">${pct}%</span>`;
}
function whoHtml(r){ const p = splitResp(r.responsable); return p.length ? p.map(x=>`<span class="who" title="${esc(respLabel(x))}">${esc(x)}</span>`).join("") : `<span class="muted" style="font-size:12px">Sin asignar</span>`; }
function dueHtml(r){
  if (!r.fin) return `<span class="mono">—</span>`;
  let sub = "";
  if (r.estado !== "Cerrada"){ const d = diffDays(today, r.fin); sub = d < 0 ? `<small class="late">${-d} d de retraso</small>` : d === 0 ? `<small>hoy</small>` : `<small>en ${d} d</small>`; }
  return `<span class="mono ${isOverdue(r)?"late":""}">${fmt(r.fin)}</span>${sub}`;
}
const chevBtn = key => `<button class="chev" data-tog="${esc(key)}" aria-expanded="${!st.col[key]}" aria-label="${st.col[key]?"Desplegar":"Plegar"}">${CHEV}</button>`;
function rowHtml(r, ind, o){
  o = o || {};
  const kc = o.all ? o.all.length : 0, done = o.all ? o.all.filter(x=>x.estado==="Cerrada").length : 0;
  return `<div class="tr ${o.kid?"kid":""} ${o.ctx?"ctx":""}" tabindex="0" data-id="${esc(r.id)}" style="--ind:${ind}">
    <div class="act">${kc ? chevBtn("a:"+r.id) : `<span class="chev-sp"></span>`}<div class="txt"><span>${esc(r.actividad || "(sin descripción)")}</span>${kc?` <span class="kc">· ${done}/${kc} subtareas</span>`:""}${!o.kid && canWrite ? ` <button class="addsub" data-addsub="${esc(r.id)}">+ Subtarea</button>`:""}${r.notas?`<div class="meta">${esc(r.notas.slice(0,110))}${r.notas.length>110?"…":""}</div>`:""}</div></div>
    <div class="c-who">${whoHtml(r)}</div>
    <div class="c-st"><span class="pill ${stClass(r.estado)}">${esc(r.estado||"Pendiente")}</span></div>
    <div class="c-pr"><span class="prio ${esc(r.prioridad||"")}">${esc(r.prioridad||"—")}</span></div>
    <div class="d c-d1"><span class="mono">${fmt(r.inicio)}</span></div>
    <div class="d c-d2">${dueHtml(r)}</div>
  </div>`;
}
function renderLista(){
  const vis = visibleTops();
  if (!vis.length) return emptyFiltered();
  let h = `<div class="tree">`;
  for (const [m, gm] of groupTree(vis)){
    const km = "m:"+m, mAll = [...gm.values()].flatMap(sm => [...sm.values()].flat());
    h += `<div class="lv lv0" data-tog="${esc(km)}"><span class="nm">${chevBtn(km)}<b>${esc(m)}</b></span><span class="sts">${statsHtml(mAll)}</span></div>`;
    if (st.col[km]) continue;
    for (const [g, sm] of gm){
      const kg = "g:"+m+"|"+g, gAll = [...sm.values()].flat();
      h += `<div class="lv lv1" data-tog="${esc(kg)}"><span class="nm">${chevBtn(kg)}<b>${esc(g)}</b></span><span class="sts">${statsHtml(gAll)}</span></div>`;
      if (st.col[kg]) continue;
      for (const [s, items] of sm){
        const ks = "s:"+m+"|"+g+"|"+s, closed = !!st.col[ks];
        h += `<div class="sh" data-tog="${esc(ks)}">
          <div class="shn">${chevBtn(ks)}<b>${esc(s)}</b>${canWrite?`<button class="btn small" data-add='${esc(JSON.stringify({modulo:m,grupo:g,subgrupo:s}))}'>+ Añadir</button>`:""}<span class="shs">${statsHtml(items, true)}</span></div>
          ${closed ? "" : `<span class="hc">Responsable</span><span class="hc">Estado</span><span class="hc">Prioridad</span><span class="hc">Inicio</span><span class="hc">Cierre objetivo</span>`}
        </div>`;
        if (closed) continue;
        for (const en of items){
          h += rowHtml(en.r, 0, { all: en.all, ctx: en.ctx });
          if (en.all.length && !st.col["a:"+en.r.id]) for (const kd of en.kids) h += rowHtml(kd, 1, { kid:true });
        }
      }
    }
  }
  return h + `</div>`;
}

/* ---------- Calendario ---------- */
const nameOf = r => (r.padre && parentOf(r) ? "↳ " : "") + (r.actividad || "");
function renderCal(){
  const list = sorted(rows.filter(matches));
  const [Y,M] = st.cal.split("-").map(Number);
  const first = new Date(Y, M-1, 1), last = new Date(Y, M, 0);
  const start = new Date(first); start.setDate(first.getDate() - ((first.getDay()+6)%7));
  const end = new Date(last); end.setDate(last.getDate() + (6-((last.getDay()+6)%7)));
  const dated = list.filter(r => r.inicio || r.fin).map(r => { let s = r.inicio || r.fin, e = r.fin || r.inicio; if (e < s) [s,e] = [e,s]; return {r,s,e}; });
  let h = `<div class="calnav"><h2>${MESES[M-1]} ${Y}</h2>
    <button class="btn" data-cal="-1" aria-label="Mes anterior">‹</button><button class="btn" data-cal="0">Hoy</button><button class="btn" data-cal="1" aria-label="Mes siguiente">›</button></div>
    <div class="calscroll"><div class="cal"><div class="dow">${["Lun","Mar","Mié","Jue","Vie","Sáb","Dom"].map(d=>`<div>${d}</div>`).join("")}</div>`;
  for (let w = new Date(start); w <= end; w.setDate(w.getDate()+7)){
    const ws = iso(w), we = addDays(ws, 6);
    let bg = "", nums = "";
    for (let i=0;i<7;i++){
      const ds = addDays(ws,i), d = parse(ds);
      bg += `<div class="${d.getMonth()!==M-1?"out":(i>=5?"we":"")}"></div>`;
      nums += `<div class="dnum ${ds===today?"today":""}" style="grid-column:${i+1}"><span>${d.getDate()}</span></div>`;
    }
    const items = dated.filter(x => x.e >= ws && x.s <= we).sort((a,b)=> a.s.localeCompare(b.s) || b.e.localeCompare(a.e));
    const lanes = []; let bars = "";
    for (const x of items){
      const s = x.s < ws ? ws : x.s, e = x.e > we ? we : x.e, c0 = diffDays(ws, s), c1 = diffDays(ws, e);
      let lane = lanes.findIndex(endCol => endCol < c0); if (lane < 0){ lane = lanes.length; lanes.push(-1); }
      lanes[lane] = c1;
      const r = x.r;
      bars += `<div class="cbar ${stClass(r.estado)} ${x.s<ws?"cont-l":""} ${x.e>we?"cont-r":""} ${isOverdue(r)?"overdue":""}" tabindex="0" data-id="${esc(r.id)}" style="grid-column:${c0+1}/${c1+2};grid-row:${lane+2}" title="${esc(nameOf(r))} · ${esc(r.responsable||"")} · ${fmt(x.s)} → ${fmt(x.e)}">${esc(nameOf(r))}${r.responsable?` · <span class="mono">${esc(splitResp(r.responsable).join("·"))}</span>`:""}</div>`;
    }
    h += `<div class="week"><div class="wbg">${bg}</div>${nums}${bars}</div>`;
  }
  h += `</div></div>`;
  const undated = list.filter(r => !r.inicio && !r.fin).length;
  h += `<div class="legend">${ESTADOS.map(e=>`<span class="pill ${stClass(e)}">${e}</span>`).join("")}<span>Borde rojo: vencida · ↳ subtarea</span>${undated?`<span>· ${undated} sin fechas no aparecen</span>`:""}</div>`;
  if (!dated.length) h = `<div class="note" style="margin-bottom:12px">Ninguna actividad filtrada tiene fechas todavía. Abre una actividad y pon su fecha de inicio y de cierre objetivo para verla aquí.</div>` + h;
  return h;
}

/* ---------- Cronograma ---------- */
function span(r){ let s=r.inicio||r.fin, e=r.fin||r.inicio; if(e<s)[s,e]=[e,s]; return {s,e}; }
function renderGantt(){
  const vis = visibleTops().map(en => ({...en, dk: en.kids.filter(k=>k.inicio||k.fin), dated: !en.ctx && (en.r.inicio||en.r.fin)})).filter(en => en.dated || en.dk.length);
  if (!vis.length) return `<div class="note">Ninguna actividad filtrada tiene fechas todavía. Al añadir fecha de inicio y cierre objetivo, aparecerán aquí como barras en el tiempo.</div>`;
  const all = vis.flatMap(en => (en.dated?[en.r]:[]).concat(en.dk)).map(span);
  let lo = st.f.desde || all.reduce((m,x)=>x.s<m?x.s:m, all[0].s);
  let hi = st.f.hasta || all.reduce((m,x)=>x.e>m?x.e:m, all[0].e);
  if (!st.f.desde && today < lo) lo = today;
  if (!st.f.hasta && today > hi) hi = today;
  const L = parse(lo), H = parse(hi);
  const R0 = new Date(L.getFullYear(), L.getMonth(), 1), R1 = new Date(H.getFullYear(), H.getMonth()+1, 1);
  const r0 = iso(R0), r1 = iso(R1), tot = diffDays(r0, r1);
  const pct = s => Math.max(0, Math.min(100, diffDays(r0, s) / tot * 100));
  let months = "", lines = "";
  for (let d = new Date(R0); d < R1; d.setMonth(d.getMonth()+1)){
    const a = pct(iso(d)), b = pct(iso(new Date(d.getFullYear(), d.getMonth()+1, 1)));
    months += `<div class="gmonth" style="left:${a}%;width:${b-a}%">${MES3[d.getMonth()]} ${String(d.getFullYear()).slice(2)}</div>`;
    lines += `<div class="gline" style="left:${a}%"></div>`;
  }
  const tl = today >= r0 && today < r1 ? `<div class="gtoday" style="left:${pct(today)}%"></div>` : "";
  const bar = r => { const x = span(r), a = pct(x.s), b = pct(addDays(x.e,1)); return `<div class="gbar ${stClass(r.estado)} ${isOverdue(r)?"overdue":""}" tabindex="0" data-id="${esc(r.id)}" style="left:${a}%;width:${Math.max(b-a,.4)}%" title="${esc(nameOf(r))} · ${fmt(x.s)} → ${fmt(x.e)} · ${esc(r.estado||"Pendiente")}"></div>`; };
  const who = r => splitResp(r.responsable).map(p=>`<span class="who">${esc(p)}</span>`).join("");
  let h = `<div class="gscroll"><div class="gantt"><div class="grow hdr"><div class="glabel"><b>Actividad</b></div><div class="gtrack">${months}${tl}</div></div>`;
  for (const [m,gm] of groupTree(vis)) for (const [g,sm] of gm) for (const [s,items] of sm){
    h += `<div class="grow sec"><div class="glabel">${esc(m)} › ${esc(g)} › ${esc(s)}</div><div class="gtrack">${lines}${tl}</div></div>`;
    for (const en of items){
      const r = en.r;
      h += `<div class="grow"><div class="glabel" title="${esc(r.actividad)}">${who(r)} ${esc(r.actividad)}</div><div class="gtrack">${lines}${tl}${en.dated?bar(r):""}</div></div>`;
      for (const k of en.dk) h += `<div class="grow kid"><div class="glabel" title="${esc(k.actividad)}">↳ ${who(k)} ${esc(k.actividad)}</div><div class="gtrack">${lines}${tl}${bar(k)}</div></div>`;
    }
  }
  return h + `</div></div><div class="legend">${ESTADOS.map(e=>`<span class="pill ${stClass(e)}">${e}</span>`).join("")}<span>Línea amarilla: hoy · ↳ subtarea</span></div>`;
}

/* ---------- Responsables ---------- */
function renderResp(){
  const open = c => rows.filter(r => r.estado !== "Cerrada" && splitResp(r.responsable).includes(c)).length;
  const late = c => rows.filter(r => isOverdue(r) && splitResp(r.responsable).includes(c)).length;
  const list = resps.slice().sort((a,b)=>(a.activo===false)-(b.activo===false) || (a.orden??999)-(b.orden??999) || a.id.localeCompare(b.id));
  const orphan = uniq(rows.flatMap(r=>splitResp(r.responsable))).filter(c => !respMap.has(c));
  let h = `<div class="rhead"><h2>Responsables</h2>${isAdmin?`<button class="btn primary" data-newresp>+ Nuevo responsable</button>`:`<span class="muted" style="font-size:13px">Solo los administradores pueden modificar esta tabla.</span>`}</div>`;
  if (!list.length && !orphan.length) return h + `<div class="note">Aún no hay responsables. Añade a cada persona con un código corto (p. ej. JM) para poder asignarla a actividades.</div>`;
  h += `<div class="tscroll"><table class="rt"><thead><tr><th>Código</th><th>Nombre</th><th class="c-area">Área / departamento</th><th class="c-mail">Email</th><th class="num">Abiertas</th><th class="num c-venc">Vencidas</th><th class="c-est">Estado</th><th></th></tr></thead><tbody>`;
  for (const p of list){
    const o = open(p.id), l = late(p.id);
    h += `<tr data-resp="${esc(p.id)}" class="${p.activo===false?"off":""}" tabindex="0"><td><span class="who">${esc(p.id)}</span></td><td>${esc(p.nombre||"—")}</td><td class="c-area">${esc(p.area||"—")}</td><td class="c-mail">${esc(p.email||"—")}</td><td class="num">${o}</td><td class="num c-venc ${l?"late":""}">${l}</td><td class="c-est">${p.activo===false?"Inactivo":"Activo"}</td><td><button class="btn small" data-seeresp="${esc(p.id)}">Ver actividades</button></td></tr>`;
  }
  for (const c of orphan) h += `<tr data-orphan="${esc(c)}" tabindex="0"><td><span class="who">${esc(c)}</span></td><td colspan="6" class="muted">Código usado en actividades pero no registrado.${isAdmin?" Pulsa para darlo de alta.":""}</td><td></td></tr>`;
  return h + `</tbody></table></div>`;
}

/* ---------- Usuarios (solo administradores) ---------- */
function renderUsers(){
  if (!isAdmin) return `<div class="empty"><h2>Sin acceso</h2><p>Solo los administradores pueden gestionar usuarios.</p></div>`;
  let h = `<div class="rhead"><h2>Usuarios</h2><button class="btn primary" data-newuser>+ Nuevo usuario</button></div>`;
  if (usuariosErr) h += `<div class="note" style="margin-bottom:12px;color:var(--danger)">${esc(usuariosErr)}</div>`;
  if (!usuarios) return h + `<div class="note">Cargando usuarios…</div>`;
  if (!usuarios.length) return h + `<div class="note">No hay usuarios todavía.</div>`;
  h += `<div class="tscroll"><table class="rt"><thead><tr><th>Usuario</th><th>Nombre</th><th>Responsable</th><th class="c-rol2">Rol</th><th class="c-est">Estado</th><th class="c-acc">Último acceso</th><th></th></tr></thead><tbody>`;
  const list = usuarios.slice().sort((a,b)=> (a.rol!=="admin")-(b.rol!=="admin") || a.usuario.localeCompare(b.usuario));
  for (const u of list){
    h += `<tr data-user="${esc(u.id)}" class="${u.activo?"":"off"}" tabindex="0">
      <td class="mono">${esc(u.usuario)}${u.id===me.id?' <span class="muted" style="font-family:var(--f-body)">(tú)</span>':""}</td><td>${esc(u.nombre||"—")}</td>
      <td>${u.responsable?`<span class="who">${esc(u.responsable)}</span>`:"—"}</td>
      <td class="c-rol2"><span class="badge role-${u.rol}">${u.rol==="admin"?"Administrador":"Usuario"}</span></td>
      <td class="c-est">${u.activo?(u.cambiar_password?"Pendiente de cambiar contraseña":"Activo"):"Desactivado"}</td>
      <td class="c-acc mono" style="font-size:12.5px">${esc(fmtTs(u.ultimo_acceso))}</td>
      <td><button class="btn small" data-userpass="${esc(u.id)}">Contraseña</button></td></tr>`;
  }
  return h + `</tbody></table></div>`;
}

function emptyFiltered(){ return `<div class="empty"><h2>Ninguna actividad coincide</h2><p>Cambia o limpia los filtros para ver más resultados.</p></div>`; }
function renderView(){
  const v = $("#view");
  document.querySelectorAll(".tabs button").forEach(b => b.setAttribute("aria-selected", String(b.dataset.view === st.view)));
  if (!loaded){ v.innerHTML = `<div class="empty"><h2>Cargando actividades…</h2><p>Las acciones del plan estratégico aparecerán aquí agrupadas por módulo, grupo y sub-grupo.</p></div>`; return; }
  if (st.view === "responsables"){ v.innerHTML = renderResp(); return; }
  if (st.view === "usuarios"){ v.innerHTML = renderUsers(); return; }
  if (!rows.length){ v.innerHTML = `<div class="empty"><h2>Aún no hay actividades</h2><p>Pulsa «+ Nueva actividad» para registrar la primera acción del plan, con su responsable y fechas.</p></div>`; return; }
  v.innerHTML = st.view === "calendario" ? renderCal() : st.view === "cronograma" ? renderGantt() : renderLista();
}
function render(){ renderFilterLabels(); renderSummary(); renderView(); }
function refresh(){ render(); if (openKey) renderMsList(openKey); if (drawer && drawer.kind==="act" && drawer.id && !byId.has(drawer.id)) closeDrawer(); }

function bindView(){
  $("#view").addEventListener("click", e => {
    const t = e.target;
    const add = t.closest("[data-add]"); if (add){ e.stopPropagation(); openDrawer(null, JSON.parse(add.dataset.add)); return; }
    const as = t.closest("[data-addsub]"); if (as){ e.stopPropagation(); newSub(as.dataset.addsub); return; }
    const cal = t.closest("[data-cal]");
    if (cal){ const k = +cal.dataset.cal; if (k===0) st.cal = today.slice(0,7); else { const [y,m] = st.cal.split("-").map(Number); const d = new Date(y, m-1+k, 1); st.cal = d.getFullYear()+"-"+pad(d.getMonth()+1); } saveUi(); renderView(); return; }
    if (t.closest("[data-newresp]")){ openResp(null); return; }
    if (t.closest("[data-newuser]")){ openUser(null); return; }
    const up = t.closest("[data-userpass]"); if (up){ e.stopPropagation(); openUser(up.dataset.userpass, true); return; }
    const uu = t.closest("[data-user]"); if (uu){ openUser(uu.dataset.user); return; }
    const see = t.closest("[data-seeresp]"); if (see){ e.stopPropagation(); st.f = blankF(); st.f.resp = [see.dataset.seeresp]; st.view = "lista"; st.col = {}; saveUi(); render(); return; }
    const rr = t.closest("[data-resp]"); if (rr){ openResp(rr.dataset.resp); return; }
    const ro = t.closest("[data-orphan]"); if (ro){ if (isAdmin) openResp(null, ro.dataset.orphan); return; }
    const tg = t.closest("[data-tog]");
    if (tg && (t.closest(".chev") || !t.closest("[data-id]"))){ const k = tg.dataset.tog; if (st.col[k]) delete st.col[k]; else st.col[k] = true; saveUi(); renderView(); return; }
    const it = t.closest("[data-id]"); if (it) openDrawer(it.dataset.id);
  });
  $("#view").addEventListener("keydown", e => {
    if (!(e.key==="Enter"||e.key===" ")) return;
    const t = e.target;
    if (t.matches("[data-id]")){ e.preventDefault(); openDrawer(t.dataset.id); }
    else if (t.matches("[data-resp]")){ e.preventDefault(); openResp(t.dataset.resp); }
    else if (t.matches("[data-user]")){ e.preventDefault(); openUser(t.dataset.user); }
    else if (t.matches("[data-orphan]") && isAdmin){ e.preventDefault(); openResp(null, t.dataset.orphan); }
  });
}

/* ---------- Ficha de actividad / subtarea ---------- */
function newSub(pid){
  const p = byId.get(pid); if (!p) return;
  openDrawer(null, { padre: pid, modulo:p.modulo, grupo:p.grupo, subgrupo:p.subgrupo, responsable: p.responsable || "" });
}
function openDrawer(id, preset){
  const r = id ? byId.get(id) : null;
  const d = r ? {...r} : Object.assign({modulo:"",grupo:"",subgrupo:"",actividad:"",estado:"Pendiente",responsable:"",prioridad:"",inicio:"",fin:"",notas:"",padre:""}, preset||{});
  d.sel = splitResp(d.responsable);
  drawer = { kind:"act", id, draft: d, confirmDel:false, error:"", nota:"" };
  renderDrawer();
  setTimeout(()=>{ const f = document.querySelector(id ? "#d-estado" : (d.modulo ? "#d-actividad" : "#d-modulo")); f && f.focus(); }, 30);
}
function openResp(id, code){
  const p = id ? respMap.get(id) : null;
  drawer = { kind:"resp", id, draft: p ? {...p} : { id: code || "", nombre:"", area:"", email:"", activo:true }, confirmDel:false, error:"" };
  renderDrawer();
  setTimeout(()=>{ const f = document.querySelector(id ? "#r-nombre" : "#r-codigo"); f && f.focus(); }, 30);
}
function openUser(id, focusPass){
  const u = id ? (usuarios || []).find(x => x.id === id) : null;
  drawer = { kind:"user", id, draft: u ? {...u, password:""} : { usuario:"", nombre:"", responsable:"", rol:"usuario", activo:true, password:"" }, confirmDel:false, error:"", done:"" };
  renderDrawer();
  setTimeout(()=>{ const f = document.querySelector(focusPass ? "#u-password" : id ? "#u-nombre" : "#u-usuario"); f && f.focus(); }, 30);
}
function closeDrawer(){ drawer = null; $("#drawer-root").innerHTML = ""; }
function renderDrawer(){
  if (!drawer) return;
  if (drawer.kind === "resp") return renderRespDrawer();
  if (drawer.kind === "user") return renderUserDrawer();
  const d = drawer.draft, ro = !canWrite, isSub = !!d.padre, parent = isSub ? byId.get(d.padre) : null;
  const dis = ro ? "disabled" : "";
  const dl = (id, vals) => `<datalist id="${id}">${vals.map(v=>`<option value="${esc(v)}"></option>`).join("")}</datalist>`;
  const tops = rows.filter(isTop);
  const hist = (byId.get(drawer.id)?.historial || []).slice().reverse();
  const opt = (vals, cur, blank) => (blank?`<option value="">${blank}</option>`:"") + vals.map(v=>`<option ${v===cur?"selected":""}>${esc(v)}</option>`).join("");
  const respCodes = uniq(resps.filter(p=>p.activo!==false).sort((a,b)=>(a.orden??999)-(b.orden??999)||a.id.localeCompare(b.id)).map(p=>p.id).concat(d.sel));
  const kids = drawer.id && !isSub ? kidsOf(drawer.id) : [];
  const title = drawer.id ? (isSub ? "Subtarea" : "Actividad") : (isSub ? "Nueva subtarea" : "Nueva actividad");
  $("#drawer-root").innerHTML = `<div class="scrim" id="scrim"></div>
  <aside class="drawer" role="dialog" aria-modal="true" aria-labelledby="d-title">
    <div class="dhead"><h2 id="d-title">${title}</h2><button class="btn" id="d-close" aria-label="Cerrar">✕</button></div>
    <div class="crumb">${esc([d.modulo,d.grupo,d.subgrupo].filter(Boolean).join(" › "))}${parent?` › <button class="btn link" id="d-parent">${esc(parent.actividad)}</button>`:""}</div>
    <form class="dbody" id="d-form">
      ${isSub ? "" : `<div class="fld full"><label for="d-modulo">Módulo</label><input id="d-modulo" list="dl-mod" value="${esc(d.modulo)}" ${dis}></div>
      <div class="fld"><label for="d-grupo">Grupo</label><input id="d-grupo" list="dl-grp" value="${esc(d.grupo)}" ${dis}></div>
      <div class="fld"><label for="d-subgrupo">Sub-grupo</label><input id="d-subgrupo" list="dl-sub" value="${esc(d.subgrupo)}" ${dis}></div>`}
      <div class="fld full"><label for="d-actividad">${isSub?"Subtarea":"Actividad"}</label><textarea id="d-actividad" rows="2" ${dis}>${esc(d.actividad)}</textarea></div>
      <div class="fld"><label for="d-estado">Estado</label><select id="d-estado" ${dis}>${opt(ESTADOS, d.estado||"Pendiente")}</select></div>
      <div class="fld"><label for="d-prioridad">Prioridad</label><select id="d-prioridad" ${dis}>${opt(PRIOS, d.prioridad, "Sin prioridad")}</select></div>
      <div class="fld full"><span class="lbl">Responsable(s)</span>
        <div class="chips" id="d-resp">${respCodes.length ? respCodes.map(c=>`<button type="button" class="chip" data-code="${esc(c)}" aria-pressed="${d.sel.includes(c)}" ${dis}><b>${esc(c)}</b>${esc(respMap.get(c)?.nombre||"")}</button>`).join("") : `<span class="muted" style="font-size:13px">No hay responsables registrados.</span>`}</div>
      </div>
      <div class="fld"><label for="d-inicio">Fecha de inicio</label><input id="d-inicio" type="date" value="${esc(d.inicio)}" ${dis}></div>
      <div class="fld"><label for="d-fin">Fecha objetivo de cierre</label><input id="d-fin" type="date" value="${esc(d.fin)}" ${dis}></div>
      <div class="fld full"><label for="d-notas">Notas / descripción</label><textarea id="d-notas" rows="3" ${dis}>${esc(d.notas)}</textarea></div>
      ${drawer.id && !isSub ? `<div class="full"><div class="sect"><span>Subtareas (${kids.length})</span>${ro?"":`<button type="button" class="btn small" id="d-addsub">+ Añadir subtarea</button>`}</div>
        ${kids.length ? `<div class="kids">${kids.map(k=>`<button type="button" class="kidbtn" data-kid="${esc(k.id)}"><span class="pill ${stClass(k.estado)}">${esc(k.estado||"Pendiente")}</span><span>${esc(k.actividad)}</span><span>${splitResp(k.responsable).map(x=>`<span class="who">${esc(x)}</span>`).join("")}</span><span class="mono ${isOverdue(k)?"late":""}" style="font-size:12px">${fmt(k.fin)}</span></button>`).join("")}</div>` : `<p class="muted" style="font-size:13px;margin:0">Divide la actividad en pasos con su propio responsable y fechas.</p>`}</div>` : ""}
      ${drawer.id && !ro ? `<div class="fld full"><label for="d-nota">Añadir nota de seguimiento</label><textarea id="d-nota" rows="2" placeholder="Qué se ha hecho, bloqueos, próximos pasos…">${esc(drawer.nota)}</textarea></div>`:""}
      ${drawer.id ? `<div class="full"><div class="sect"><span>Historial de seguimiento</span></div>${hist.length?`<ul class="hist">${hist.map(h=>`<li><div class="h"><span class="mono">${esc(fmtTs(h.t))}</span> · ${esc(h.autor || "Importado")}</div>${esc(h.texto)}</li>`).join("")}</ul>`:`<p class="muted" style="font-size:13px;margin:0">Sin anotaciones todavía.</p>`}</div>`:""}
      ${dl("dl-mod", uniq(sorted(tops).map(r=>r.modulo)))}${dl("dl-grp", uniq(sorted(tops).map(r=>r.grupo)))}${dl("dl-sub", uniq(sorted(tops).map(r=>r.subgrupo)))}
    </form>
    <div class="dfoot">
      <div>${drawer.id && !ro ? (drawer.confirmDel ? `<span class="err">${kids.length?`¿Eliminar también sus ${kids.length} subtareas?`:"¿Eliminar definitivamente?"}</span> <button class="btn danger" id="d-del-yes">Sí, eliminar</button> <button class="btn" id="d-del-no">No</button>` : `<button class="btn danger" id="d-del">Eliminar</button>`) : ""}</div>
      <div class="r"><span class="err">${esc(drawer.error)}</span>${ro?`<button class="btn" id="d-cancel">Cerrar</button>`:`<button class="btn" id="d-cancel">Cancelar</button><button class="btn primary" id="d-save">Guardar</button>`}</div>
    </div>
  </aside>`;
  bindDrawerCommon();
  const form = $("#d-form");
  form.addEventListener("input", e => { const k = e.target.id && e.target.id.slice(2); if (!k) return; if (k === "nota") drawer.nota = e.target.value; else drawer.draft[k] = e.target.value; });
  form.addEventListener("change", e => { const k = e.target.id && e.target.id.slice(2); if (k && k !== "nota") drawer.draft[k] = e.target.value; });
  $("#d-resp").addEventListener("click", e => { const c = e.target.closest(".chip"); if (!c || ro) return; const code = c.dataset.code, s = drawer.draft.sel; drawer.draft.sel = s.includes(code) ? s.filter(x=>x!==code) : s.concat([code]); c.setAttribute("aria-pressed", String(drawer.draft.sel.includes(code))); });
  const asb = $("#d-addsub"); if (asb) asb.onclick = () => newSub(drawer.id);
  form.querySelectorAll("[data-kid]").forEach(b => b.onclick = () => openDrawer(b.dataset.kid));
  const dp = $("#d-parent"); if (dp) dp.onclick = () => openDrawer(d.padre);
  const s = $("#d-save"); if (s) s.onclick = saveAct;
  const dy = $("#d-del-yes"); if (dy) dy.onclick = removeAct;
}
function bindDrawerCommon(){
  $("#scrim").onclick = closeDrawer; $("#d-close").onclick = closeDrawer; $("#d-cancel").onclick = closeDrawer;
  $("#d-form").addEventListener("submit", e => e.preventDefault());
  const del = $("#d-del"); if (del) del.onclick = () => { drawer.confirmDel = true; renderDrawer(); };
  const dn = $("#d-del-no"); if (dn) dn.onclick = () => { drawer.confirmDel = false; renderDrawer(); };
}
function toast(msg){ const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(()=> t.hidden = true, 2400); }
function busy(on, label){ const b = $("#d-save"); if (b){ b.disabled = on; b.textContent = on ? (label || "Guardando…") : "Guardar"; } }

async function saveAct(){
  const d = drawer.draft, clean = k => String(d[k]||"").trim();
  const body = { modulo:clean("modulo"), grupo:clean("grupo"), subgrupo:clean("subgrupo"), actividad:clean("actividad"), estado:d.estado||"Pendiente", prioridad:d.prioridad||"", responsable:d.sel.join(" & "), inicio:d.inicio||null, fin:d.fin||null, notas:String(d.notas||"").trim(), padre: d.padre || null };
  if (!body.actividad){ drawer.error = "Escribe la descripción."; renderDrawer(); return; }
  if (!body.padre && (!body.modulo || !body.grupo)){ drawer.error = "Indica al menos módulo y grupo."; renderDrawer(); return; }
  if (body.inicio && body.fin && body.fin < body.inicio){ drawer.error = "El cierre objetivo no puede ser anterior al inicio."; renderDrawer(); return; }
  const now = new Date().toISOString(), prev = drawer.id ? byId.get(drawer.id) : null, autor = me.nombre || me.usuario;
  const hist = (prev?.historial || []).slice(), push = texto => hist.push({ t: now, autor, texto });
  if (!prev) push((body.padre ? "Subtarea creada" : "Actividad creada") + (body.estado!=="Pendiente" ? ` · estado ${body.estado}` : ""));
  else {
    if ((prev.estado||"Pendiente") !== body.estado) push(`Estado: ${prev.estado||"Pendiente"} → ${body.estado}`);
    if ((prev.inicio||"") !== (body.inicio||"")) push(`Inicio: ${fmt(prev.inicio)} → ${fmt(body.inicio)}`);
    if ((prev.fin||"") !== (body.fin||"")) push(`Cierre objetivo: ${fmt(prev.fin)} → ${fmt(body.fin)}`);
    if ((prev.responsable||"") !== body.responsable) push(`Responsable: ${prev.responsable||"—"} → ${body.responsable||"—"}`);
    if (!body.padre && (prev.modulo+prev.grupo+prev.subgrupo) !== (body.modulo+body.grupo+body.subgrupo)) push(`Movida a ${body.modulo} › ${body.grupo} › ${body.subgrupo}`);
  }
  if (drawer.nota && drawer.nota.trim()) push(drawer.nota.trim());
  Object.assign(body, { orden: prev?.orden ?? (rows.reduce((m,r)=>Math.max(m, r.orden||0), 0) + 1), actualizado: now, actualizado_por: me.id, historial: hist.slice(-80) });
  busy(true);
  try {
    let res;
    if (prev) res = await sb.from("acciones").update(body).eq("id", prev.id).select("id");
    else res = await sb.from("acciones").insert(Object.assign({ id: newId(), creado: now }, body)).select("id");
    if (res.error) throw res.error;
    if (!res.data || !res.data.length) throw { message: "permission" };
    if (prev && !body.padre && (prev.modulo!==body.modulo || prev.grupo!==body.grupo || prev.subgrupo!==body.subgrupo)){
      const r2 = await sb.from("acciones").update({ modulo:body.modulo, grupo:body.grupo, subgrupo:body.subgrupo }).eq("padre", prev.id);
      if (r2.error) throw r2.error;
    }
    await loadAcciones(); refresh();
    const back = body.padre && !prev ? body.padre : null;
    closeDrawer(); toast(prev ? "Cambios guardados" : (body.padre ? "Subtarea creada" : "Actividad creada"));
    if (back) openDrawer(back);
  } catch(e){ drawer.error = dbErr(e); renderDrawer(); }
}
async function removeAct(){
  const id = drawer.id, pid = byId.get(id)?.padre;
  const { error } = await sb.from("acciones").delete().eq("id", id); /* las subtareas se borran en cascada */
  if (error){ drawer.error = dbErr(error); drawer.confirmDel = false; renderDrawer(); return; }
  await loadAcciones(); refresh(); closeDrawer(); toast("Eliminada");
  if (pid && byId.has(pid)) openDrawer(pid);
}

/* ---------- Ficha de responsable ---------- */
function renderRespDrawer(){
  const d = drawer.draft, ro = !isAdmin, dis = ro ? "disabled" : "", isNew = !drawer.id;
  const used = drawer.id ? rows.filter(r => splitResp(r.responsable).includes(drawer.id)).length : 0;
  $("#drawer-root").innerHTML = `<div class="scrim" id="scrim"></div>
  <aside class="drawer" role="dialog" aria-modal="true" aria-labelledby="d-title">
    <div class="dhead"><h2 id="d-title">${isNew ? "Nuevo responsable" : "Responsable " + esc(drawer.id)}</h2><button class="btn" id="d-close" aria-label="Cerrar">✕</button></div>
    <form class="dbody" id="d-form">
      <div class="fld"><label for="r-codigo">Código</label><input id="r-codigo" value="${esc(d.id)}" maxlength="6" placeholder="p. ej. JM" ${isNew&&!ro?"":"disabled"} style="text-transform:uppercase"></div>
      <div class="fld"><label for="r-nombre">Nombre</label><input id="r-nombre" value="${esc(d.nombre)}" ${dis}></div>
      <div class="fld full"><label for="r-area">Área / departamento</label><input id="r-area" value="${esc(d.area)}" list="dl-area" ${dis}></div>
      <div class="fld full"><label for="r-email">Email</label><input id="r-email" type="email" value="${esc(d.email)}" ${dis}></div>
      <label class="check full"><input id="r-activo" type="checkbox" ${d.activo!==false?"checked":""} ${dis}> Activo (aparece al asignar actividades)</label>
      ${isNew ? `<p class="muted full" style="font-size:13px;margin:0">El código es lo que se muestra en las actividades. No se puede cambiar después.</p>` : `<p class="muted full" style="font-size:13px;margin:0">Asignado en ${used} actividades o subtareas.</p>`}
      <datalist id="dl-area">${uniq(resps.map(p=>p.area)).map(a=>`<option value="${esc(a)}"></option>`).join("")}</datalist>
    </form>
    <div class="dfoot">
      <div>${!isNew && !ro ? (used ? `<span class="muted" style="font-size:13px">Para retirarlo, desmarca «Activo».</span>` : drawer.confirmDel ? `<span class="err">¿Eliminar?</span> <button class="btn danger" id="d-del-yes">Sí, eliminar</button> <button class="btn" id="d-del-no">No</button>` : `<button class="btn danger" id="d-del">Eliminar</button>`) : ""}</div>
      <div class="r"><span class="err">${esc(drawer.error)}</span>${ro?`<button class="btn" id="d-cancel">Cerrar</button>`:`<button class="btn" id="d-cancel">Cancelar</button><button class="btn primary" id="d-save">Guardar</button>`}</div>
    </div>
  </aside>`;
  bindDrawerCommon();
  $("#d-form").addEventListener("input", e => { const k = e.target.id.slice(2); if (k === "codigo") d.id = e.target.value; else if (k === "activo") d.activo = e.target.checked; else d[k] = e.target.value; });
  $("#r-activo").addEventListener("change", e => d.activo = e.target.checked);
  const s = $("#d-save"); if (s) s.onclick = saveResp;
  const dy = $("#d-del-yes"); if (dy) dy.onclick = async () => {
    const { error } = await sb.from("responsables").delete().eq("codigo", drawer.id);
    if (error){ drawer.error = dbErr(error); renderDrawer(); return; }
    await loadResps(); refresh(); closeDrawer(); toast("Responsable eliminado");
  };
}
async function saveResp(){
  const d = drawer.draft, code = String(d.id||"").trim().toUpperCase();
  if (!/^[A-Z0-9ÑÁÉÍÓÚ]{1,6}$/.test(code)){ drawer.error = "El código debe tener de 1 a 6 letras o números, sin espacios."; renderDrawer(); return; }
  if (!drawer.id && respMap.has(code)){ drawer.error = `Ya existe el código ${code}.`; renderDrawer(); return; }
  if (!String(d.nombre||"").trim()){ drawer.error = "Escribe el nombre."; renderDrawer(); return; }
  const prev = respMap.get(code);
  const body = { codigo: code, nombre: String(d.nombre).trim(), area: String(d.area||"").trim(), email: String(d.email||"").trim(), activo: d.activo !== false, orden: prev?.orden ?? (resps.reduce((m,p)=>Math.max(m,p.orden||0),0)+1), actualizado: new Date().toISOString() };
  busy(true);
  const { error } = await sb.from("responsables").upsert(body, { onConflict: "codigo" });
  if (error){ drawer.error = dbErr(error); renderDrawer(); return; }
  await loadResps(); refresh(); closeDrawer(); toast(prev ? "Responsable actualizado" : "Responsable añadido");
}

/* ---------- Ficha de usuario (administradores) ---------- */
function genPassword(){
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"; const b = new Uint32Array(10); crypto.getRandomValues(b);
  return Array.from(b, x => a[x % a.length]).join("");
}
function renderUserDrawer(){
  const d = drawer.draft, isNew = !drawer.id, self = !isNew && drawer.id === me.id;
  const respOpts = `<option value="">Sin vincular</option>` + resps.slice().sort((a,b)=>a.id.localeCompare(b.id)).map(p => `<option value="${esc(p.id)}" ${p.id===d.responsable?"selected":""}>${esc(p.id)} · ${esc(p.nombre||"")}</option>`).join("");
  $("#drawer-root").innerHTML = `<div class="scrim" id="scrim"></div>
  <aside class="drawer" role="dialog" aria-modal="true" aria-labelledby="d-title">
    <div class="dhead"><h2 id="d-title">${isNew ? "Nuevo usuario" : "Usuario " + esc(d.usuario)}</h2><button class="btn" id="d-close" aria-label="Cerrar">✕</button></div>
    <form class="dbody" id="d-form" autocomplete="off">
      ${drawer.done ? `<div class="okbox full">${drawer.done}</div>` : ""}
      <div class="fld"><label for="u-usuario">Usuario (para entrar)</label><input id="u-usuario" value="${esc(d.usuario)}" ${isNew?"":"disabled"} autocapitalize="none" spellcheck="false" placeholder="p. ej. jm"></div>
      <div class="fld"><label for="u-nombre">Nombre</label><input id="u-nombre" value="${esc(d.nombre)}"></div>
      <div class="fld"><label for="u-responsable">Responsable vinculado</label><select id="u-responsable">${respOpts}</select></div>
      <div class="fld"><label for="u-rol">Rol</label><select id="u-rol" ${self?"disabled":""}><option value="usuario" ${d.rol==="usuario"?"selected":""}>Usuario</option><option value="admin" ${d.rol==="admin"?"selected":""}>Administrador</option></select></div>
      <label class="check full"><input id="u-activo" type="checkbox" ${d.activo?"checked":""} ${self?"disabled":""}> Activo (puede entrar en la app)</label>
      <div class="fld full"><label for="u-password">${isNew ? "Contraseña provisional" : "Nueva contraseña (déjala vacía para no cambiarla)"}</label>
        <div class="pwrow"><input id="u-password" type="text" value="${esc(d.password)}" autocomplete="new-password" spellcheck="false" placeholder="Mínimo 8 caracteres"><button type="button" class="btn" id="u-gen">Generar</button></div></div>
      <div class="infobox full">Comunica la contraseña a la persona por un canal privado. Al entrar por primera vez, la app le pedirá que elija una propia.</div>
      ${self ? `<p class="muted full" style="font-size:13px;margin:0">No puedes quitarte el rol de administrador ni desactivarte a ti mismo.</p>` : ""}
    </form>
    <div class="dfoot">
      <div>${!isNew && !self ? (drawer.confirmDel ? `<span class="err">¿Eliminar el usuario?</span> <button class="btn danger" id="d-del-yes">Sí, eliminar</button> <button class="btn" id="d-del-no">No</button>` : `<button class="btn danger" id="d-del">Eliminar</button>`) : ""}</div>
      <div class="r"><span class="err">${esc(drawer.error)}</span><button class="btn" id="d-cancel">${drawer.done?"Cerrar":"Cancelar"}</button><button class="btn primary" id="d-save">Guardar</button></div>
    </div>
  </aside>`;
  bindDrawerCommon();
  $("#d-form").addEventListener("input", e => { const k = e.target.id.slice(2); if (k === "activo") d.activo = e.target.checked; else d[k] = e.target.value; });
  $("#d-form").addEventListener("change", e => { const k = e.target.id.slice(2); if (k === "activo") d.activo = e.target.checked; else d[k] = e.target.value; });
  $("#u-gen").onclick = () => { d.password = genPassword(); $("#u-password").value = d.password; };
  $("#d-save").onclick = saveUser;
  const dy = $("#d-del-yes"); if (dy) dy.onclick = async () => {
    try { await adminCall("delete", { id: drawer.id }); await loadUsuarios(); closeDrawer(); renderView(); toast("Usuario eliminado"); }
    catch(e){ drawer.error = e.message; drawer.confirmDel = false; renderDrawer(); }
  };
}
async function saveUser(){
  const d = drawer.draft, isNew = !drawer.id;
  const usuario = String(d.usuario||"").trim().toLowerCase(), pw = String(d.password||"");
  if (isNew && !/^[a-z0-9._-]{2,30}$/.test(usuario)){ drawer.error = "Usuario: 2 a 30 caracteres, solo minúsculas, números, punto o guion."; renderDrawer(); return; }
  if (!String(d.nombre||"").trim()){ drawer.error = "Escribe el nombre."; renderDrawer(); return; }
  if ((isNew || pw) && pw.length < 8){ drawer.error = "La contraseña debe tener al menos 8 caracteres."; renderDrawer(); return; }
  busy(true);
  try {
    const datos = { nombre: String(d.nombre).trim(), responsable: d.responsable || null, rol: d.rol, activo: !!d.activo };
    if (isNew){
      const r = await adminCall("create", Object.assign({ usuario, password: pw }, datos));
      drawer.id = r.id; d.usuario = usuario;
    } else {
      await adminCall("update", Object.assign({ id: drawer.id }, datos));
      if (pw) await adminCall("set_password", { id: drawer.id, password: pw });
    }
    await loadUsuarios(); renderView();
    if (pw){
      drawer.done = `${isNew ? "Usuario creado." : "Contraseña cambiada."} Datos de acceso para ${esc(d.nombre)}: usuario <code>${esc(d.usuario)}</code> · contraseña <code>${esc(pw)}</code>`;
      d.password = ""; drawer.error = ""; renderDrawer();
    } else { closeDrawer(); toast("Usuario actualizado"); }
  } catch(e){ drawer.error = e.message; renderDrawer(); }
}

/* ---------- arranque ---------- */
async function boot(){
  if (!CFG.SUPABASE_URL || !CFG.SUPABASE_ANON_KEY || /TU-PROYECTO|PEGA_AQUI/.test(CFG.SUPABASE_URL + CFG.SUPABASE_ANON_KEY) || !window.supabase){ showConfigMissing(); return; }
  sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
  buildMs(); bindStatic(); bindView();
  const { data: { session } } = await sb.auth.getSession();
  if (session) await enter(); else showLogin();
  sb.auth.onAuthStateChange(ev => { if (ev === "SIGNED_OUT" && me) { me = null; showLogin(); } });
}
boot();
})();
