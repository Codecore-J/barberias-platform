# Manual de despliegue y operaciones

Guía para llevar la Plataforma de Gestión de Barberías desde un checkout limpio hasta producción, y para mantenerla viva. Refleja los scripts y la infraestructura reales del repositorio.

---

## 1. Requisitos previos

| Componente | Versión mínima | Notas |
|---|---|---|
| Node.js | 20 | El CI usa Node 22; `render.yaml` no fija versión, así que conviene seleccionar 22 en el panel para tener paridad. El backend es ESM (`"type": "module"`). |
| npm | 10 | El repo usa **workspaces** (`backend-barberias`, `frontend-barberias`). |
| PostgreSQL | 15 | Neon en la nube; local con Docker o instalación nativa. |
| Redis | 7 | BullMQ lo necesita para colas, expiraciones y recordatorios. |
| Git | 2.x | — |
| Docker (opcional) | 24+ | Solo para levantar Redis/PostgreSQL locales con `docker-compose.yml`. |

Cuentas externas (producción): Render, Vercel, Neon y Upstash (o cualquier Redis gestionado).

---

## 2. Puesta en marcha local

### 2.1 Dependencias

Desde la **raíz** del monorepo:

```bash
npm ci
```

Esto instala ambos workspaces de una vez. No ejecutes `npm install` dentro de cada carpeta por separado: el `node_modules` es compartido.

### 2.2 Servicios locales

```bash
docker compose up -d redis
# PostgreSQL: usa tu instancia local o Neon; si usas Docker:
# docker run --name barberias_pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=barberias_dev -p 5432:5432 -d postgres:15
```

### 2.3 Variables de entorno

Copia la plantilla y completa los valores (detalle en `docs/ENTORNOS.md`):

```bash
cp backend-barberias/.env.example backend-barberias/.env
```

Mínimo para arrancar: `APP_ENV=dev`, `DATABASE_URL`, `JWT_SECRET`, `REDIS_URL` (o `REDIS_HOST`/`REDIS_PORT`).

> El backend no lee `.env` automáticamente. Exporta las variables (`set -a; source backend-barberias/.env; set +a`) o configúralas en tu IDE.

### 2.4 Base de datos

```bash
cd backend-barberias
npx prisma generate          # cliente tipado
npx prisma migrate deploy    # aplica las migraciones versionadas
npm run seed                 # datos base (roles, catálogo de demo)
```

Para crear el administrador global:

```bash
APP_ENV=dev \
ADMIN_EMAIL=admin@example.com \
ADMIN_PASSWORD='CambiarEstaClave123' \
ADMIN_PHONE=8090000000 \
npm run admin:create
```

En producción el mismo comando exige `CONFIRM_CREATE_ADMIN=yes`.

### 2.5 Arranque

```bash
# API (watch mode)
npm run start:backend

# Frontend (otra terminal)
npm run start:frontend
```

- API: `http://localhost:3000/api/v1`
- Frontend: `http://localhost:4200`
- Liveness: `http://localhost:3000/api/v1/health/liveness`
- Readiness: `http://localhost:3000/api/v1/health`

### 2.6 Verificación rápida

```bash
curl -s http://localhost:3000/api/v1/health/liveness
curl -s http://localhost:3000/api/v1/health   # exige PostgreSQL y Redis
cd backend-barberias && npm run test          # unitarios
```

---

## 3. Build del backend

```bash
cd backend-barberias
npx prisma generate
npm run build          # nest build → dist/
npm run start:prod     # node dist/main
```

Notas:

- `prisma generate` **antes** del build: sin el cliente, `nest build` falla con decenas de errores de tipos.
- El `postinstall` del backend (`prisma skills sync`) no genera el cliente; no confíes en él para CI.
- `dist/` no se versiona; se reconstruye en cada despliegue.
- El proceso necesita `APP_ENV`; sin él aborta antes de escuchar.

---

## 4. Migraciones en producción

```bash
cd backend-barberias
npx prisma migrate deploy
```

Reglas:

1. **Nunca** `prisma db push`, `prisma migrate reset` ni SQL destructivo contra staging/producción.
2. `migrate deploy` es forward-only: aplica las migraciones pendientes y no borra datos.
3. Haz un backup/snapshot antes de una migración con cambios de esquema.
4. Orden de despliegue: **migrar → arrancar la versión nueva**. `render.yaml` ya lo hace con `preDeployCommand`.
5. Si una migración falla, no la edites ya aplicada: corrige con una migración nueva.
6. CI valida que el repo y la base recién migrada coincidan:

```bash
DATABASE_URL=... npm run check:integridad
```

---

## 5. Build del frontend

```bash
cd frontend-barberias
npm run build          # ng build (production por defecto)
```

Salida: `frontend-barberias/dist/frontend-barberias/browser`.

- `vercel.json` (raíz) ejecuta `npm run build:frontend` y publica `frontend-barberias/dist/frontend-barberias/browser` con rewrite SPA a `index.html`.
- `frontend-barberias/vercel.json` hace lo mismo si el proyecto de Vercel apunta a esa carpeta.
- **La URL de la API está en el código**: `src/app/core/constants/api.constants.ts` usa `http://localhost:3000/api/v1` en desarrollo y una URL fija de Render en producción. Si cambia el dominio del backend, hay que editar esa constante y volver a desplegar el frontend.

---

## 6. Despliegue de la API en Render

`render.yaml` define el servicio `barberias-api`:

| Ajuste | Valor |
|---|---|
| Runtime | Node |
| Región | Ohio (`us-east-2`, co-localizada con Neon) |
| Root | `backend-barberias` |
| Build | `rm -f ../package.json && npm install --include=dev && npm run build` |
| Pre-deploy | `npx prisma migrate deploy` |
| Start | `npm run start:prod` |
| Health check | `/api/v1/health/liveness` |
| Auto-deploy | Sí |

### 6.1 Variables en el panel

El blueprint declara `NODE_ENV`, `PORT`, `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET` y `CORS_ORIGINS`. **Faltan dos que el código sí usa:**

- `APP_ENV`: sin ella la API no arranca. Define `staging` o `production`.
- `FRONTEND_URL`: el código no lee `CORS_ORIGINS`; configura aquí los orígenes del frontend separados por coma.

Checklist:

- [ ] `APP_ENV=production` (o `staging`).
- [ ] `DATABASE_URL` con SSL si Neon lo exige.
- [ ] `JWT_SECRET` de ≥ 32 caracteres, generado con CSPRNG.
- [ ] `REDIS_URL` con TLS (`rediss://`) si Upstash lo requiere.
- [ ] `FRONTEND_URL=https://tu-dominio`.
- [ ] `PORT=3000`.
- [ ] `DEBUG_PRISMA=false`.

> Si el build falla por el cliente Prisma, añade `npx prisma generate` al `buildCommand` antes de `npm run build`.

### 6.2 Health checks

- **Liveness** (`/api/v1/health/liveness`): solo confirma que el proceso responde. Es la que debe usar Render; no depende de PostgreSQL ni Redis.
- **Readiness** (`/api/v1/health`): comprueba PostgreSQL, Redis y heap (< 300 MB). Devuelve 503 si algo falta. Úsala para alertas y balanceadores, **no** como `healthCheckPath` (un Redis caído no debe reiniciar una instancia sana).

---

## 7. Workers de BullMQ en producción

### 7.1 Cómo funcionan

Los `@Processor` de BullMQ (`ReservaProcessor`, `NotificacionProcessor`, `BloqueosProcessor`, `AuditoriaProcessor`, `ListaEsperaProcessor`) se instancian **dentro del mismo proceso NestJS**. No hay un binario ni un servicio de workers separado: si la API está viva, los workers están vivos.

### 7.2 Mantenerlos vivos

**Opción A — Render (recomendada, la actual):** una instancia web con el proceso Nest. Render reinicia el proceso si muere; el health check de liveness evita reinicios por dependencias caídas. Para más carga, escala instancias: BullMQ reparte los jobs y el test-and-set del Carril B evita dobles avisos.

**Opción B — PM2:**

```bash
cd backend-barberias
npm run build
pm2 start dist/main.js --name barberias-api
pm2 save
pm2 startup
```

- Usa modo `fork` (una instancia por proceso) y escala con `pm2 scale barberias-api N`; BullMQ soporta varios consumidores.
- No uses `pm2 restart` en mitad de un job si puedes evitarlo: no hay `enableShutdownHooks()`, así que los jobs en vuelo se reintentan (entrega *at-least-once*, ya idempotente).

**Opción C — Docker:**

```dockerfile
# Dockerfile de referencia (no está en el repo)
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY backend-barberias/package*.json backend-barberias/
RUN npm ci
COPY backend-barberias backend-barberias
WORKDIR /app/backend-barberias
RUN npx prisma generate && npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/backend-barberias/dist ./dist
COPY --from=build /app/backend-barberias/node_modules ./node_modules
COPY --from=build /app/backend-barberias/prisma ./prisma
CMD ["node", "dist/main"]
```

- Ejecuta `npx prisma migrate deploy` como paso previo del despliegue (Job/init container), no en cada arranque.
- Un contenedor = un proceso Nest; escala con réplicas.

### 7.3 Redis: lo que no puede fallar

- BullMQ usa `maxRetriesPerRequest: null`; un Redis inalcanzable deja las órdenes en la cola offline de ioredis. Por eso todos los encolados de negocio usan `encolarConLimite` (techo de 2 s) y son best-effort.
- Activa persistencia (AOF o RDB) en el proveedor: los jobs con `delay` (expiración de reservas, recordatorios) se pierden si Redis se reinicia sin persistencia. La reconciliación de arranque recupera las expiraciones, pero no los recordatorios.
- Con Redis caído la API sigue arrancando y sirviendo; `/api/v1/health` devuelve 503 y `/api/v1/health/liveness` sigue en 200.

---

## 8. Frontend en Vercel

1. Importa el repositorio y deja la **raíz** como directorio del proyecto (usa `vercel.json` de la raíz) o `frontend-barberias` (usa su propio `vercel.json`).
2. Build command: `npm run build:frontend` (raíz) o `ng build` (carpeta).
3. Output: `frontend-barberias/dist/frontend-barberias/browser` (raíz) o `dist/frontend-barberias/browser` (carpeta).
4. Rewrites SPA ya configurados: cualquier ruta → `index.html`.
5. Variables de entorno del frontend: **ninguna**. La API se resuelve en código; si cambia, hay que redeployar.

---

## 9. CI (GitHub Actions)

`.github/workflows/ci.yml` se ejecuta en push/PR a `main`:

1. Levanta PostgreSQL 15 y Redis 7 como servicios.
2. `npm ci` único en la raíz (workspaces).
3. `npx prisma generate`.
4. Lint backend y frontend.
5. Build backend y frontend.
6. Gitleaks (escaneo de secretos).
7. `npx prisma migrate deploy` contra la base de test.
8. `npm run check:integridad` (migraciones + CHECK).
9. `npm run test` (unitarios/integración).
10. `npm run test:e2e` con `APP_ENV=dev`.
11. Tests del frontend (`ng test --watch=false`).

Si el pipeline falla en migraciones, revisa primero que la base de test esté limpia y que `prisma/migrations` no tenga divergencias con `schema.prisma`.

---

## 10. Verificación post-despliegue

- [ ] `GET /api/v1/health/liveness` → 200.
- [ ] `GET /api/v1/health` → 200 con `database` y `redis` en `up`.
- [ ] Login de un usuario real y carga del panel.
- [ ] Crear una reserva en una sede de prueba (modo MANUAL): debe quedar `PENDIENTE` y expirar a los 10 minutos si no se acepta.
- [ ] Confirmar/rechazar como staff y comprobar la auditoría.
- [ ] Cancelar una reserva y verificar en logs el job `hueco-liberado` y, si hay suscripción, el aviso `LISTA_ESPERA_HUECO_LIBERADO`.
- [ ] Revisar logs de Render: sin `ECONNREFUSED` a Redis ni errores de Prisma.
- [ ] Confirmar que las migraciones aplicadas coinciden (`npx prisma migrate status`).

---

## 11. Operación y mantenimiento

| Tarea | Comando / acción |
|---|---|
| Ver migraciones pendientes | `npx prisma migrate status` |
| Aplicar migraciones | `npx prisma migrate deploy` |
| Integridad de esquema/CHECK | `npm run check:integridad` |
| Crear administrador | `npm run admin:create` (con `ADMIN_*`) |
| Seed base | `npm run seed` |
| Smoke test contra API viva | `npm run test:smoke` (requiere URL y credenciales) |
| Tests con otra zona horaria | `npm run test:tz-utc`, `npm run test:tz-santo-domingo` |
| Logs | Panel de Render (stdout del proceso) |
| Backup de BD | Snapshots de Neon / `pg_dump` programado |

### 11.1 Rollback

- **Aplicación:** vuelve a desplegar el commit anterior desde Render (Deploy → Rollback) o `git revert` + push.
- **Base de datos:** las migraciones no se revierten automáticamente. Restaura el snapshot previo y despliega la versión compatible; nunca ejecutes `migrate reset`.
- **Redis:** si hay que vaciarlo, hazlo solo con la API detenida; se pierden jobs pendientes. La reconciliación de expiraciones se recupera al arrancar.

### 11.2 Incidentes típicos

| Síntoma | Causa probable | Acción |
|---|---|---|
| La API no arranca: “APP_ENV is required” | Falta `APP_ENV` en el panel | Definir `APP_ENV=staging`/`production`. |
| La API no arranca: “JWT_SECRET … insegura” | Secreto corto o de ejemplo en producción | Rotar `JWT_SECRET` (≥ 32 caracteres). |
| `/health` 503 con `redis: down` | Redis caído o credenciales malas | Revisar `REDIS_URL`; la API sigue sirviendo. |
| Jobs que no se procesan | Redis sin persistencia, workers caídos o cola pausada | Revisar logs, estado de Redis y reiniciar la instancia. |
| Recordatorios no llegan | Job perdido al reiniciar Redis | Reencolar manualmente o esperar al siguiente ciclo; no hay reconciliación de recordatorios. |
| 409 intermitentes en alta de reservas | Contención SERIALIZABLE | Es esperado; el cliente debe reintentar. |
| Frontend apunta a localhost | Build de desarrollo o URL mal configurada | `npm run build` de producción y revisar `api.constants.ts`. |
| Lint falla solo en CI | Versión de Node distinta | Usar Node 22 como el pipeline. |

---

## 12. Resumen del flujo de despliegue

```text
git push a main
   │
   ├─ CI: lint → build → gitleaks → migrate deploy (test) → integridad → tests → e2e
   │
   ├─ Render: install → prisma generate/build → prisma migrate deploy → start:prod
   │            └─ API + workers BullMQ en el mismo proceso
   │
   └─ Vercel: npm run build:frontend → dist/.../browser → SPA
```

Con esto el sistema queda desplegable en cualquier entorno que provea Node 20+, PostgreSQL 15+ y Redis 7.
