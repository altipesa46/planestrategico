# Seguimiento de acciones · Plan Estratégico Almesa

App web para seguir las acciones operativas del plan estratégico: actividades y subtareas por Módulo › Grupo › Sub-grupo, con responsables, estados, prioridad y fechas de inicio y cierre objetivo. Tiene vista de lista, calendario y cronograma, una tabla de responsables y gestión de usuarios con roles.

- **Frontend:** una página web estática (`index.html`, `app.js`, `config.js`), sin compilación. Se publica en GitHub Pages.
- **Backend:** Supabase. Los usuarios inician sesión con Supabase Auth. Los datos están en Postgres, protegidos con reglas por fila (RLS). Los cambios llegan en tiempo real al resto de usuarios. La gestión de usuarios pasa por una Edge Function.

## Estructura

```
index.html                         Página y estilos
app.js                             Lógica de la app
config.js                          URL y clave pública de Supabase (editar)
supabase/migrations/…_esquema.sql  Tablas, funciones y reglas de seguridad
supabase/seed.sql                  Responsables y 32 actividades actuales
supabase/functions/admin-usuarios  Alta, rol, contraseña y baja de usuarios (solo administradores)
scripts/crear-usuarios.mjs         Alta inicial de los usuarios (una sola vez)
```

## Roles

| Rol | Puede |
|---|---|
| **Administrador** (Juan, Ricardo) | Todo lo del usuario, más: crear, modificar, desactivar y eliminar usuarios; asignar contraseñas; editar la tabla de responsables. |
| **Usuario** | Ver todo el plan; crear, editar y borrar actividades y subtareas; cambiar su propia contraseña. |

- Un usuario desactivado no puede entrar.
- Toda contraseña asignada por un administrador es provisional. En el primer acceso la app obliga a cambiarla.
- Nadie puede quitarse a sí mismo el rol de administrador ni desactivarse.

## Puesta en marcha (unos 20 minutos)

### 1. Crear el proyecto en Supabase

1. En [supabase.com](https://supabase.com), crea un proyecto nuevo. La región recomendada es *West EU (Ireland)* o *Central EU (Frankfurt)*.
2. Ve a **Authentication › Sign In / Providers › Email** y configura:
   - **Confirm email**: desactivado. Los usuarios no tienen buzón real; entran con un nombre corto.
   - **Allow new users to sign up**: desactivado. Solo los administradores dan de alta usuarios.

### 2. Crear las tablas y cargar los datos

En **SQL Editor**, ejecuta en este orden:

1. El contenido de `supabase/migrations/20261016000000_esquema.sql`.
2. El contenido de `supabase/seed.sql`.

### 3. Desplegar la función de usuarios

Con la [CLI de Supabase](https://supabase.com/docs/guides/cli):

```bash
supabase login
supabase link --project-ref TU_PROJECT_REF
supabase functions deploy admin-usuarios
```

Si no quieres usar la CLI, ve a **Edge Functions › Deploy a new function › Via Editor**, llámala `admin-usuarios` y pega el contenido de `supabase/functions/admin-usuarios/index.ts`.

Supabase pone automáticamente a disposición de la función `SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY`. Solo hace falta `USER_DOMAIN` si cambias el dominio interno (ver más abajo).

### 4. Crear los usuarios iniciales

Necesitas Node.js 18 o superior. Desde la carpeta `scripts`:

```bash
cd scripts
npm install
node crear-usuarios.mjs https://TU-PROYECTO.supabase.co TU_SERVICE_ROLE_KEY
```

El script crea los usuarios `jm` y `rn` (administradores) y `mjf` y `bg` (usuarios), cada uno vinculado a su responsable. Muestra en pantalla una contraseña provisional para cada uno. Comunícalas por un canal privado.

> La **service_role key** (Project Settings › API) da acceso total a la base de datos. Úsala solo en este comando y en la función. No la guardes en ningún archivo ni la subas a GitHub.

**Alternativa sin Node:**

1. Crea el usuario `jm@usuarios.almesa.app` en **Authentication › Users › Add user**, con *Auto Confirm User* marcado.
2. En el SQL Editor, ejecuta:

   ```sql
   insert into public.perfiles (id, usuario, nombre, responsable, rol, activo, cambiar_password)
   select id, 'jm', 'Juan Montesinos', 'JM', 'admin', true, true
   from auth.users where email = 'jm@usuarios.almesa.app';
   ```

3. Entra en la app y crea el resto de usuarios desde la pestaña **Usuarios**.

### 5. Configurar la app

Edita `config.js` con estos dos valores de **Project Settings › API**:

- `SUPABASE_URL`: la *Project URL*.
- `SUPABASE_ANON_KEY`: la clave *anon public*, también llamada *publishable key*.

La clave anon es pública por diseño. La protección la ponen el inicio de sesión y las reglas RLS: sin sesión válida de un usuario activo, la base de datos no devuelve nada.

### 6. Publicar en GitHub Pages

```bash
git init
git add .
git commit -m "App de seguimiento del plan estratégico"
git branch -M main
git remote add origin https://github.com/TU-ORGANIZACION/seguimiento-pe.git
git push -u origin main
```

En GitHub, ve a **Settings › Pages**. En *Source* elige *Deploy from a branch*, rama `main`, carpeta `/ (root)`. En uno o dos minutos la app estará en `https://TU-ORGANIZACION.github.io/seguimiento-pe/`.

Recomendado: haz el repositorio **privado**. GitHub Pages desde un repositorio privado necesita un plan de pago (Team o Enterprise). Con repositorio público el código es visible, pero los datos siguen protegidos por el login.

### 7. Primer acceso

Entra con `jm` y la contraseña provisional. La app te pedirá elegir una contraseña propia.

## Uso diario para administradores

**Pestaña Usuarios:**

- **+ Nuevo usuario**: elige el nombre de usuario, el nombre, el responsable vinculado y el rol. Pulsa **Generar** para crear una contraseña provisional. La app la muestra una vez al guardar, para que la comuniques.
- **Contraseña**: asigna una contraseña nueva cuando alguien la olvide. Será provisional.
- **Activo**: desmárcalo para retirar el acceso sin borrar el historial.

**Nuevos responsables:** primero da de alta a la persona en la pestaña **Responsables**. Después crea su usuario y vincúlalo.

## Dominio interno de usuarios

Supabase identifica a cada usuario por un email. Para que el equipo entre con un nombre corto (`jm`), la app lo convierte en `jm@usuarios.almesa.app`. Esas direcciones no existen y no se envía ningún correo.

Para cambiar el dominio, pon el mismo valor en tres sitios:

- `USER_DOMAIN` en `config.js`.
- El secreto `USER_DOMAIN` de la función: `supabase secrets set USER_DOMAIN=...`.
- El tercer argumento del script de alta.

## Copias de seguridad

Los planes de pago de Supabase hacen copias diarias. En el plan gratuito, exporta periódicamente desde **Database › Backups**, o con:

```bash
supabase db dump --data-only > copia.sql
```
