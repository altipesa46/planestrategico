-- =====================================================================
-- Seguimiento de acciones del Plan Estratégico · Almesa
-- Esquema, seguridad por filas (RLS) y tiempo real.
-- Ejecutar UNA vez en Supabase > SQL Editor (o con `supabase db push`).
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------- Responsables (tabla maestra de personas asignables) ----------
create table if not exists public.responsables (
  codigo      text primary key check (codigo ~ '^[A-Z0-9ÑÁÉÍÓÚ]{1,6}$'),
  nombre      text not null,
  area        text not null default '',
  email       text not null default '',
  activo      boolean not null default true,
  orden       integer,
  actualizado timestamptz not null default now()
);

-- ---------- Perfiles de usuario (1:1 con auth.users) ----------
create table if not exists public.perfiles (
  id               uuid primary key references auth.users(id) on delete cascade,
  usuario          text not null unique check (usuario ~ '^[a-z0-9._-]{2,30}$'),
  nombre           text not null default '',
  responsable      text references public.responsables(codigo) on update cascade on delete set null,
  rol              text not null default 'usuario' check (rol in ('admin','usuario')),
  activo           boolean not null default true,
  cambiar_password boolean not null default true,
  creado           timestamptz not null default now()
);

-- ---------- Acciones (actividades y subtareas) ----------
create table if not exists public.acciones (
  id              text primary key default gen_random_uuid()::text,
  padre           text references public.acciones(id) on delete cascade,  -- null = actividad; con valor = subtarea
  modulo          text not null default '',
  grupo           text not null default '',
  subgrupo        text not null default '',
  actividad       text not null,
  estado          text not null default 'Pendiente' check (estado in ('Pendiente','En curso','Standby','Cerrada')),
  responsable     text not null default '',          -- códigos separados por " & " (p. ej. "JM & RN")
  prioridad       text not null default '' check (prioridad in ('','Alta','Media','Baja')),
  inicio          date,
  fin             date,
  notas           text not null default '',
  orden           integer,
  historial       jsonb not null default '[]'::jsonb, -- [{t, autor, texto}]
  creado          timestamptz not null default now(),
  actualizado     timestamptz not null default now(),
  actualizado_por uuid references auth.users(id) on delete set null,
  constraint fechas_ok check (inicio is null or fin is null or fin >= inicio)
);
create index if not exists acciones_padre_idx on public.acciones(padre);

-- ---------- Funciones auxiliares ----------
create or replace function public.es_usuario_activo()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.perfiles where id = auth.uid() and activo);
$$;

create or replace function public.es_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.perfiles where id = auth.uid() and activo and rol = 'admin');
$$;

-- El propio usuario marca que ya ha cambiado su contraseña provisional
create or replace function public.marcar_password_cambiada()
returns void language sql security definer set search_path = public as $$
  update public.perfiles set cambiar_password = false where id = auth.uid();
$$;

revoke all on function public.es_usuario_activo()        from public, anon;
revoke all on function public.es_admin()                 from public, anon;
revoke all on function public.marcar_password_cambiada() from public, anon;
grant execute on function public.es_usuario_activo()        to authenticated;
grant execute on function public.es_admin()                 to authenticated;
grant execute on function public.marcar_password_cambiada() to authenticated;

-- ---------- Seguridad por filas ----------
alter table public.responsables enable row level security;
alter table public.perfiles     enable row level security;
alter table public.acciones     enable row level security;

-- Responsables: todos los usuarios activos leen; solo administradores modifican
drop policy if exists responsables_leer      on public.responsables;
drop policy if exists responsables_admin_ins on public.responsables;
drop policy if exists responsables_admin_upd on public.responsables;
drop policy if exists responsables_admin_del on public.responsables;
create policy responsables_leer      on public.responsables for select to authenticated using (public.es_usuario_activo());
create policy responsables_admin_ins on public.responsables for insert to authenticated with check (public.es_admin());
create policy responsables_admin_upd on public.responsables for update to authenticated using (public.es_admin()) with check (public.es_admin());
create policy responsables_admin_del on public.responsables for delete to authenticated using (public.es_admin());

-- Perfiles: cada uno ve el suyo; los usuarios activos ven todos.
-- No hay políticas de escritura: altas, roles y contraseñas pasan por la
-- Edge Function «admin-usuarios», que comprueba que quien llama es administrador.
drop policy if exists perfiles_leer on public.perfiles;
create policy perfiles_leer on public.perfiles for select to authenticated using (id = auth.uid() or public.es_usuario_activo());

-- Acciones: cualquier usuario activo lee, crea, edita y borra
drop policy if exists acciones_leer   on public.acciones;
drop policy if exists acciones_crear  on public.acciones;
drop policy if exists acciones_editar on public.acciones;
drop policy if exists acciones_borrar on public.acciones;
create policy acciones_leer   on public.acciones for select to authenticated using (public.es_usuario_activo());
create policy acciones_crear  on public.acciones for insert to authenticated with check (public.es_usuario_activo());
create policy acciones_editar on public.acciones for update to authenticated using (public.es_usuario_activo()) with check (public.es_usuario_activo());
create policy acciones_borrar on public.acciones for delete to authenticated using (public.es_usuario_activo());

-- Sin acceso para visitantes no autenticados
revoke all on public.responsables, public.perfiles, public.acciones from anon;

-- ---------- Tiempo real (los cambios de un usuario aparecen al resto) ----------
do $$
begin
  begin alter publication supabase_realtime add table public.acciones;     exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.responsables; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.perfiles;     exception when duplicate_object then null; end;
end $$;
