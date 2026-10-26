# Entornos y variables de entorno

Guía de configuración de la Plataforma de Gestión de Barberías. Refleja las variables que el código **lee realmente** (`grep process.env` en `backend-barberias/src`, `prisma/` y `scripts/`).

- Plantilla base: `backend-barberias/.env.example`.
- El backend no carga `.env` por sí mismo: en local se exporta con tu shell, con `dotenv`/`tsx`, o con el panel de tu IDE. En Render/Vercel se definen como *environment variables* del servicio.
- El frontend **no** usa variables de entorno: la URL de la API se decide en `frontend-barberias/src/app/core/constants/api.constants.ts` según `isDevMode()`.

---

## 1. Entornos (D11)

| Entorno | Base de datos | Backend | Frontend | `APP_ENV` |
|---|---|---|---|---|
| `dev` | Rama `dev` de Neon o PostgreSQL local | `localhost:3000` | `localhost:4200` | `dev` |
| `staging` | Rama principal de Neon | Render | Vercel (preview) | `staging` |
| `production` | Base dedicada (L-01) | Render | Vercel (dominio oficial) | `production` |

Reglas:

1. **`APP_ENV` es obligatorio.** `main.ts` termina el proceso si falta o no es `dev`, `staging` o `production`.
2. Los tests destructivos y los E2E solo corren con `APP_ENV=dev`; `test/setup.e2e.ts` aborta en cualquier otro valor.
3. `NODE_ENV=production` activa la validación estricta de `JWT_SECRET` (falla el arranque si es débil).
4. Nunca se reutiliza la base de producción para pruebas ni para staging.

---

## 2. Variables del backend

### 2.1 Obligatorias

| Variable | Para qué sirve | Ejemplo dummy (`dev`) |
|---|---|---|
| `APP_ENV` | Entorno lógico de la plataforma. Valida al arrancar y protege los tests destructivos. | `dev` |
| `DATABASE_URL` | Cadena de conexión PostgreSQL usada por Prisma (runtime y migraciones). | `postgresql://barberia_dev:clave_falsa@localhost:5432/barberias_dev?schema=public` |
| `JWT_SECRET` | Secreto de firma/verificación de los JWT. En producción exige ≥ 32 caracteres y rechaza valores por defecto. | `dev_secreto_falso_de_64_caracteres_para_firmar_jwt_0123456789` |
| `REDIS_URL` | Conexión de BullMQ, del health check y de la caché de analíticas (sin ella esa caché vive en memoria del proceso, que es lo que usan el desarrollo local y el CI). Tiene prioridad sobre `REDIS_HOST`/`REDIS_PORT`. Obligatoria salvo que se usen estas dos. | `redis://default:clave_falsa@localhost:6379` |

### 2.2 Recomendadas

| Variable | Para qué sirve | Default / ejemplo |
|---|---|---|
| `PORT` | Puerto HTTP donde escucha NestJS. | `3000` |
| `FRONTEND_URL` | Orígenes adicionales permitidos por CORS, separados por coma. La lista base ya incluye localhost y los dominios de Vercel. | `http://localhost:4200` |
| `NODE_ENV` | Entorno estándar de Node. Con `production` se endurece la validación del secreto JWT. | `development` |
| `REDIS_HOST` | Host de Redis cuando no se usa `REDIS_URL`. | `127.0.0.1` |
| `REDIS_PORT` | Puerto de Redis cuando no se usa `REDIS_URL`. | `6379` |
| `UV_THREADPOOL_SIZE` | Tamaño del pool de libuv (bcrypt/IO). El código lo eleva a 16 si no se define. | `16` |
| `DEBUG_PRISMA` | `true` activa el log de consultas SQL de Prisma (solo desarrollo). | `false` |
| `SENTRY_DSN` | DSN del proyecto de Sentry. **Si no está definida, Sentry no se inicializa** y el interceptor global de errores no hace nada: no rompe ni el desarrollo ni el CI. | `https://clave_falsa@o000000.ingest.sentry.io/0000000` |
| `SENTRY_TRACES_SAMPLE_RATE` | Proporción de trazas que se envían (0 a 1). Default `0.1`. | `0.1` |
| `SENTRY_PROFILES_SAMPLE_RATE` | Proporción de perfiles (0 a 1). Se recorta al valor de trazas para no perfilar sin traza. Default `0.1`. | `0.1` |
| `SENTRY_RELEASE` | Etiqueta de versión que Sentry asocia a cada evento; normalmente el SHA del despliegue. | `barberias-api@1.0.0` |

> **Nota de despliegue:** `render.yaml` declara `CORS_ORIGINS`, pero el código **no** lee esa variable; usa `FRONTEND_URL`. Configura `FRONTEND_URL` en Render (ver `docs/DESPLIEGUE.md`).

### 2.3 Solo para herramientas de administración

| Variable | Para qué sirve | Ejemplo dummy |
|---|---|---|
| `ADMIN_EMAIL` | Correo del administrador global que crea `npm run admin:create`. | `admin@example.com` |
| `ADMIN_PASSWORD` | Contraseña inicial; mínimo 8 caracteres. Cámbiala tras el primer acceso. | `CambiarEstaClave123` |
| `ADMIN_PHONE` | Teléfono único del administrador (obligatorio: `usuarios.telefono` es único). | `8090000000` |
| `ADMIN_NAME` | Nombre visible del administrador. | `Administrador de plataforma` |
| `CONFIRM_CREATE_ADMIN` | En `APP_ENV=production` debe valer exactamente `yes` para permitir la creación. | `no` |
| `DEMO_USERS_PASSWORD` | Contraseña de los usuarios de demostración de `prisma/seed-demo-users.ts`. | `DemoFalsa123` |

Estas variables **no** son necesarias para arrancar la API: solo para los comandos de alta de datos.

### 2.4 No usadas por el código

| Variable | Observación |
|---|---|
| `CORS_ORIGINS` | Aparece en `render.yaml`, pero `main.ts` solo lee `FRONTEND_URL`. Se conserva por compatibilidad del blueprint; no tiene efecto. |

---

## 3. Ejemplo completo para `dev`

```dotenv
# --- Obligatorias ---
APP_ENV=dev
DATABASE_URL="postgresql://barberia_dev:clave_falsa@localhost:5432/barberias_dev?schema=public"
JWT_SECRET="dev_secreto_falso_de_64_caracteres_para_firmar_jwt_0123456789"
REDIS_URL="redis://default:clave_falsa@localhost:6379"

# --- Recomendadas ---
PORT=3000
FRONTEND_URL="http://localhost:4200"
NODE_ENV=development
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
UV_THREADPOOL_SIZE=16
DEBUG_PRISMA=false

# --- Opcionales: herramientas de administración ---
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=CambiarEstaClave123
ADMIN_PHONE=8090000000
ADMIN_NAME="Administrador de plataforma"
CONFIRM_CREATE_ADMIN=no
DEMO_USERS_PASSWORD=DemoFalsa123
```

> Ninguno de estos valores es real. No copies secretos de producción ni los subas al repositorio; `.env` y `.env.*` (salvo `.env.example`) están ignorados por Git.

---

## 4. Ejemplo para `staging` / `production`

```dotenv
APP_ENV=production
NODE_ENV=production
PORT=3000
DATABASE_URL="postgresql://usuario:clave@host.neon.tech/barberias?sslmode=require"
JWT_SECRET="<secreto aleatorio de al menos 64 caracteres>"
REDIS_URL="rediss://default:<clave>@<host>.upstash.io:6379"
FRONTEND_URL="https://barberias-platform.vercel.app"
UV_THREADPOOL_SIZE=16
DEBUG_PRISMA=false
```

Checklist antes de desplegar:

- [ ] `APP_ENV` definido en el panel del servicio (Render no lo incluye por defecto en el blueprint).
- [ ] `JWT_SECRET` generado con un CSPRNG (`openssl rand -hex 64`) y guardado solo en el panel de secretos.
- [ ] `DATABASE_URL` con `sslmode=require` cuando el proveedor lo exija.
- [ ] `REDIS_URL` con TLS (`rediss://`) si el proveedor lo ofrece.
- [ ] `FRONTEND_URL` con el dominio real del frontend.
- [ ] `DEBUG_PRISMA=false`.

---

## 5. Dónde se valida cada variable

| Variable | Punto de validación | Comportamiento |
|---|---|---|
| `APP_ENV` | `src/main.ts` | Falta o valor inválido → `process.exit(1)`. |
| `JWT_SECRET` | `src/iam/iam.config.ts` | `NODE_ENV=production` + secreto débil → excepción al arrancar. En desarrollo hay un fallback de 256 bits. |
| `DATABASE_URL` | Prisma | Error de conexión al primer query/migración si falta. |
| `REDIS_URL` / `REDIS_HOST` | `app.module.ts` | Sin URL usa `localhost:6379`; Redis caído no impide arrancar, pero la readiness falla. |
| `PORT` | `main.ts` | Default `3000`. |
| `UV_THREADPOOL_SIZE` | `main.ts` | Default `16`. |
| `DEBUG_PRISMA` | `shared/prisma/prisma.service.ts` | `true` → log de queries. |
| `CONFIRM_CREATE_ADMIN` | `src/cli/create-admin.ts` | En producción, distinto de `yes` → aborta. |

---

## 6. Buenas prácticas

1. Un `.env` por máquina; nunca compartir el de producción.
2. Rotar `JWT_SECRET` invalida todas las sesiones: coordinar con el despliegue.
3. Las claves de Redis y PostgreSQL se pegan **solo** en el panel del proveedor o en el `.env` local; nunca en el chat, en issues ni en logs.
4. Si sospechas una filtración: rotar la credencial, revisar `git log -S` y ejecutar Gitleaks.
5. Los valores de `NODE_ENV` y `APP_ENV` no son intercambiables: el primero describe Node, el segundo la plataforma y sus reglas de seguridad.
