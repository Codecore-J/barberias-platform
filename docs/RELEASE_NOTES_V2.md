# Release Notes · Barberías Platform V2

**Fecha:** 28 de octubre de 2026
**Alcance del documento:** fotografía técnica del despliegue en producción, incluyendo los hallazgos y hotfixes aplicados durante la certificación E2E.

---

## 1. Versión y Estado

| Campo | Valor |
|---|---|
| Versión | **V2.0.0** |
| Estado | **Producción activa y 100% certificada E2E** |
| Última verificación | 28/10/2026 — 10/10 PASS contra el entorno real (sin mocks) |
| Rama desplegada | `main` (`143ed55`) |
| Backend desplegado | Render `barberias-api-p3br` — Live, build 2m07s |
| Frontend desplegado | Vercel `barberias-platform` |

**Evidencia de la certificación más reciente** (script contra producción, ya retirado del repositorio):

| Escenario | Resultado medido |
|---|---|
| `GET /shops/overview` | 200 · 41 sedes en el periodo |
| Creación de reserva | 201 · `CONFIRMADA` 14:30→15:00 |
| Invalidación de caché tras `reserva.cancelada` | `CANCELADA` 3→4 en **327 ms** (el TTL era de 15 minutos) |
| Ejecución del matcher de lista de espera | Suscripción `NOTIFICADO`; métrica de cupos cubiertos 1→2 |
| Limpieza | Cita cancelada y 2 cuentas de prueba suspendidas |

En los logs de producción **desapareció** el aviso recurrente `No se pudo invalidar el caché de …` que se repetía antes de la V2.0.0.

---

## 2. Topología de Despliegue

```
┌──────────────────────────┐        HTTPS        ┌───────────────────────────────┐
│ Frontend (Vercel)        │ ──────────────────► │ Backend (Render)              │
│ SPA Angular estática     │                     │ Web Service Node.js / NestJS  │
│ barberias-platform       │                     │ barberias-api-p3br            │
└──────────────────────────┘                     └───────────────┬───────────────┘
                                                                 │
                                        ┌────────────────────────┼────────────────────────┐
                                        ▼                        ▼                        ▼
                            ┌────────────────────┐   ┌────────────────────┐   ┌────────────────────┐
                            │ PostgreSQL (Neon)  │   │ Redis (Upstash)    │   │ Servicios externos │
                            │ datos transacc.    │   │ caché + colas      │   │ Resend · Meta ·    │
                            │                    │   │ BullMQ in-process  │   │ Sentry             │
                            └────────────────────┘   └────────────────────┘   └────────────────────┘
```

| Capa | Componente | Detalle operativo |
|---|---|---|
| Frontend | SPA estática en **Vercel** | `https://barberias-platform.vercel.app`. Sirve estáticos sin ejecutar el `entrypoint.sh` del contenedor, por lo que la URL de la API se resuelve por el fallback de compilación de Angular. |
| Backend API | Web Service Node.js/NestJS en **Render** | `https://barberias-api-p3br.onrender.com`. Plan Free: la instancia se suspende por inactividad (primer request puede tardar ~50 s). |
| Base de datos | PostgreSQL en **Neon** | Acceso exclusivamente vía `DATABASE_URL`. Las migraciones se aplican con `prisma migrate deploy`. |
| Caché | Redis en **Upstash** | Caché de agregaciones de analíticas (TTL 15 min) con invalidación por evento. |
| Colas | **BullMQ sobre el mismo Redis** | Los workers (`ReservaProcessor`, `ListaEsperaProcessor`, `NotificacionProcessor`, bloqueos) corren **en el mismo proceso** del web service: un solo servicio en Render es suficiente, no hace falta un worker aparte. |
| Correo | Resend (opcional) | Sin `RESEND_API_KEY` el módulo arranca con el proveedor Mock y solo registra en el log. |
| WhatsApp | Meta Cloud API o gateway propio (opcional) | Envío saliente con `WHATSAPP_API_URL` + `WHATSAPP_API_TOKEN`; entrada por webhook con secreto compartido. |
| Observabilidad | Sentry (opcional) | Sin `SENTRY_DSN` el interceptor global es un no-op y los 5xx quedan solo en el log estructurado. |

**Endpoints de salud:**

- `GET /api/v1/health` → estado completo (base de datos y dependencias).
- `GET /api/v1/health/liveness` → sonda liviana, sin dependencias; responde 200 aunque Neon o Redis estén lentos.

Ambas rutas quedan fuera del prefijo global junto con el webhook (ver §5.2).

---

## 3. Diccionario de Entorno (Producción)

Variables que el backend necesita en Render. **Ningún valor real se documenta aquí**: esta tabla solo fija nombres, obligatoriedad y formato.

### 3.1 Obligatorias

| Variable | Obligatoria | Formato / efecto |
|---|---|---|
| `DATABASE_URL` | Sí | Cadena PostgreSQL con SSL (`postgresql://…`). Es la única fuente del esquema transaccional. |
| `JWT_SECRET` | Sí | Secreto largo y aleatorio (≥ 32 caracteres). Firma y verifica los tokens de sesión. |
| `REDIS_URL` | Sí en producción | `rediss://…` de Upstash. Habilita caché compartida y colas BullMQ. Sin ella, la caché cae a memoria del proceso y las colas quedan inertes. |
| `APP_ENV` | Sí | `production` en Render. Habilita las salvaguardas de CLI (por ejemplo, `CONFIRM_CREATE_ADMIN`) y la configuración de entorno lógico. |
| `NODE_ENV` | Sí | `production` para que el arranque use el bundle compilado y `isDevMode()` del frontend sea `false`. |
| `FRONTEND_URL` | Sí | Origen autorizado en CORS (`https://barberias-platform.vercel.app`). |
| `PORT` | No (por defecto 3000) | Puerto HTTP del servicio; Render lo inyecta. |

### 3.2 De notificaciones (opcionales, encienden los proveedores reales)

| Variable | Efecto si se define | Efecto si falta |
|---|---|---|
| `RESEND_API_KEY` | Enciende `ResendEmailProvider` | Se usa `MockEmailProvider` (solo log) |
| `EMAIL_FROM` | Remitente verificado en Resend | Requerido junto a `RESEND_API_KEY` |
| `WHATSAPP_API_URL` | Endpoint de Meta Cloud API o del gateway | Se usa `MockWhatsAppProvider` |
| `WHATSAPP_API_TOKEN` | Token del proveedor | Igual que el caso anterior |
| `WHATSAPP_WEBHOOK_SECRET` | Valida el header `x-webhook-secret` del webhook entrante | El endpoint responde **503** (nunca queda abierto por omisión) |

### 3.3 Observabilidad y rendimiento

| Variable | Efecto |
|---|---|
| `SENTRY_DSN` | Inicializa Sentry y activa el interceptor global de excepciones |
| `UV_THREADPOOL_SIZE` | Tamaño del threadpool de libuv (16 recomendado: bcrypt + I/O) |
| `DEBUG_PRISMA` | `true` activa el log de consultas de Prisma (solo diagnóstico) |

### 3.4 Frontend (runtime config)

| Variable | Dónde se define | Efecto |
|---|---|---|
| `API_URL` | Solo en el contenedor Docker (`entrypoint.sh`) | Reescribe `assets/env.js` con la URL real de la API. En Vercel **no** se define: el archivo estático queda neutro y manda el fallback de Angular. |

> **Regla estricta:** ningún secreto real (claves, cadenas de conexión, tokens) se versiona ni se documenta. En Render se administran desde *Environment*; en Vercel, desde *Settings → Environment Variables*.

---

## 4. Comandos Operativos Críticos

Todos se ejecutan desde `backend-barberias/` (host, nunca dentro del contenedor de producción del backend).

### 4.1 Puesta a punto de la base de datos

```bash
npx prisma migrate deploy   # aplica las migraciones pendientes (idempotente)
npm run seed                # roles, permisos y matriz de permisos base
```

`npm run seed` es idempotente (`upsert` sobre `permiso`, `rol` y `rolPermiso`): crea los 4 roles (`CLIENTE`, `ADMIN_BARBERIA`, `BARBERO`, `ADMINISTRADOR`) y su matriz de permisos. No crea sedes, servicios ni usuarios: esos datos se dan de alta por la interfaz (o con `admin:create` para el administrador global). Volver a ejecutarlo no duplica nada.

### 4.2 Alta del Administrador global por CLI

El administrador **no** se crea desde la interfaz pública: se aprovisiona por CLI, que exige confirmación explícita en producción.

```bash
APP_ENV=production \
CONFIRM_CREATE_ADMIN=yes \
ADMIN_EMAIL='admin@tudominio.com' \
ADMIN_PASSWORD='<mínimo exigido por el validador>' \
ADMIN_PHONE='8090000000' \
npm run admin:create
```

- `APP_ENV` es obligatorio y debe ser uno de `dev`, `staging`, `production`.
- En `production` el script **aborta** sin `CONFIRM_CREATE_ADMIN=yes`.
- `ADMIN_PHONE` es obligatorio: `usuarios.telefono` es único.
- `ADMIN_NAME` es opcional (por defecto, «Administrador de plataforma»).

Contra la base de producción, la `DATABASE_URL` real vive en el panel de Render; el `.env` local apunta a una rama de desarrollo de Neon. Para apuntar el CLI a producción hay que proveer la cadena por entorno, sin dejarla escrita en disco.

### 4.3 Verificación rápida del despliegue

```bash
curl -i https://barberias-api-p3br.onrender.com/api/v1/health/liveness   # 200
curl -i https://barberias-api-p3br.onrender.com/api/v1/health            # 200 + dependencias
curl -s  https://barberias-platform.vercel.app/assets/env.js             # window.__env neutro
```

### 4.4 Suites locales

```bash
npm run lint                # oxlint --type-aware
npm run build               # nest build
npm test                    # unitarias (vitest)
npm run test:e2e            # end-to-end (requiere PostgreSQL y Redis accesibles)
```

---

## 5. Soluciones Arquitectónicas Aplicadas (Hotfixes V2)

### 5.1 Invalidación de Caché en Redis

**Síntoma:** el panel de analíticas servía cifras de hasta 15 minutos antes. La purga se lanzaba en cada evento `reserva.*`, pero abortaba con `Unexpected non-whitespace character after JSON at position 6`.

**Causa raíz:** la invalidación usaba `Keyv.iterator()`. En Redis, ese iterador ignora el namespace y recorre **todo** el keyspace deserializando cada valor con `JSON.parse`. El Redis de la aplicación está compartido con BullMQ, cuyas claves no son JSON: el primer valor ajeno lanzaba la excepción y la purga no borraba nada.

**Solución:** `src/shared/cache/cache-purger.ts`. La purga filtra **en Redis** con `SCAN MATCH <prefijo>*` (lotes de 200, `TYPE string`) y borra con `DEL` **sin leer valores**, de modo que no puede tropezar con datos de terceros. Sin Redis (desarrollo local y CI), recorre el store en memoria de Keyv, donde todos los valores son propios. La ruta está cubierta por pruebas unitarias del purgador y del listener.

**Resultado medido en producción:** invalidación visible en 327 ms.

### 5.2 Endpoint Meta/WhatsApp

**Ruta canónica:** `POST https://barberias-api-p3br.onrender.com/webhooks/whatsapp`

- Está **fuera** del prefijo global `api/v1` (exclusión explícita en `main.ts`), junto con las rutas de salud. La URL que se configura en el portal de Meta es la anterior, **sin** `/api/v1`.
- La autenticación es por header `x-webhook-secret` y la comparación se hace con `timingSafeEqual` de `node:crypto` (tiempo constante). Una cabecera ausente o errónea responde **401** `WEBHOOK_SECRETO_INVALIDO`, e indistinguible entre ambos casos: no revela si el secreto existe.
- Si la variable no está configurada, el endpoint responde **503**; nunca queda abierto por omisión.
- Se retiró del array de exclusiones la entrada muerta `api/v1/webhooks/whatsapp`: excluir una ruta no la publica y su presencia hacía creer que la versión con prefijo existía.

### 5.3 Configuración estática en Vercel

**Síntoma:** producción apuntaba a `http://localhost:3000/api/v1`.

**Causa raíz:** `public/assets/env.js` traía hardcodeado `window.__env.API_URL = "http://localhost:3000/api/v1"`. Vercel sirve estáticos sin ejecutar el entrypoint, así que ese valor llegaba al navegador tal cual y ganaba sobre el fallback de compilación.

**Solución:** el archivo quedó **neutro** (`window.__env = window.__env || {};`). `api.constants.ts` resuelve la URL con el fallback basado en `isDevMode()`:

- desarrollo → `http://localhost:3000/api/v1`
- producción → `https://barberias-api-p3br.onrender.com/api/v1`

El `entrypoint.sh` del contenedor solo sobrescribe `API_URL` si la variable fue provista, de modo que Docker mantiene el runtime config y Vercel usa el fallback.

### 5.4 Colisión de Rutas UUID

**Síntoma:** `GET /shops/overview` respondía **400** con `Validation failed (uuid is expected)`.

**Causa raíz:** Express resuelve por orden de registro y la ruta estática quedaba después del comodín `@Get(':shopId')`, que intentaba parsear `overview` como UUID.

**Solución:** las rutas estáticas se declaran **antes** que las dinámicas —`GET /shops/overview` vive en `BarberiaController`, por encima de `GET /shops/:shopId`—. La regla aplica a cualquier endpoint nuevo: primero lo literal, después el parámetro.

### 5.5 Deriva de Esquema

**Migración manual:** `20261028000000_fix_cedula_nullable_drift`.

Corrige la deriva entre la base desplegada y el esquema de Prisma en torno a la columna de cédula (que debía ser opcional desde `20261024152729_make_cedula_nullable` pero quedó como `NOT NULL` en la base existente). Es una migración **manual y por eso queda documentada con nombre propio**: una migración generada automáticamente no la habría producido.

> Tras aplicar una migración manual, `prisma migrate deploy` vuelve a la senda normal; conviene comprobar `npm run check:integridad` para confirmar que el esquema desplegado coincide con `schema.prisma`.

### 5.6 Event Bus BullMQ

**Síntoma:** las notificaciones de la lista de espera y la purga del caché no se ejecutaban, sin ningún error visible.

**Causa raíz:** sin la opción `wildcard`, `EventEmitter2` trata `reserva.*` como el nombre **literal** del evento. Los listeners suscritos con el patrón —`AnalyticsCacheListener` y `NotificacionesListener`— nunca se invocaban, aunque el productor emitiera `reserva.creada` o `reserva.cancelada`.

**Solución:** `wildcard: true` en las opciones del bus (`src/shared/events/event-emitter.options.ts`), con su propia prueba para que no se pierda en un refactor. Los processors de BullMQ (`@Processor` + `WorkerHost`) se ejecutan dentro del mismo web service, así que **no se requiere un worker de fondo independiente** en `render.yaml`.

---

## 6. Limitaciones conocidas

- La instancia Free de Render se suspende por inactividad: el primer request tras un periodo ocioso puede tardar hasta ~50 s. Las sondas de salud externas deberían tolerar ese arranque en frío.
- El proveedor de correo y de WhatsApp son opcionales por diseño: sin credenciales, los envíos quedan en el log (adaptadores Mock). Un despliegue que «pierda» notificaciones suele tener esta causa, no un fallo del bus.
- La caché de analíticas tiene TTL de 15 minutos y se invalida por evento: si Redis está caído, la lectura degrada a *cache miss* y se recalcula contra Prisma (nunca devuelve 500), pero el panel pierde la ventaja de rendimiento.
