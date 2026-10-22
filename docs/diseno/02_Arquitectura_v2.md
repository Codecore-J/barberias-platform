# Arquitectura técnica v2 — Plataforma de Gestión de Barberías

| Campo | Valor |
|---|---|
| Versión | 2.0 |
| Fecha | 2026-10-21 |
| Alcance | Monorepo completo (backend + frontend + infraestructura) |
| Fuente de verdad | Código en `backend-barberias/` y `frontend-barberias/` |

---

## 1. Stack tecnológico

### 1.1 Backend

| Pieza | Versión / elección | Uso |
|---|---|---|
| Node.js | ≥ 20 (CI usa 22) | Runtime ESM (`"type": "module"`). |
| NestJS | 12 (`@nestjs/core`, `common`, `platform-express`) | HTTP, DI, guards, módulos. |
| Express | 5 | Adaptador HTTP. |
| Prisma | 5.22 | ORM, migraciones y cliente tipado. |
| PostgreSQL | 15+ (Neon en la nube) | Base de datos relacional. |
| BullMQ | 6 (`@nestjs/bullmq` 12) | Colas y workers sobre Redis. |
| Redis | 7 (Upstash o local) | Backend de BullMQ y health check. |
| JWT | `@nestjs/jwt` + `passport-jwt` | Sesión stateless. |
| bcrypt | 6, coste 10 (D31) | Hash de contraseñas. |
| class-validator / class-transformer | 0.15 / 0.5 | DTOs y serialización. |
| Helmet | 8 | Cabeceras HTTP de seguridad. |
| Throttler | `@nestjs/throttler` 6 | Rate limiting global. |
| Terminus | 12 | Health checks. |
| Luxon | 3 | Cálculo de zonas horarias. |
| Vitest | 4 | Unitarios e integración. |
| oxlint | 1.58 | Lint con tipos. |

### 1.2 Frontend

| Pieza | Versión | Uso |
|---|---|---|
| Angular | 22.1 | SPA standalone, signals, router. |
| `@angular/build` | 22.1 | Builder `application` (ESBuild). |
| PrimeNG | 22.1 + `@primeuix/themes` | Componentes UI. |
| Tailwind CSS | 4.3 | Utilidades y layout. |
| RxJS | 7.8 | HTTP y estado reactivo. |
| Vitest + jsdom | 4 / 28 | Unitarios de componentes y servicios. |

### 1.3 Infraestructura

| Pieza | Uso |
|---|---|
| Render (Ohio) | API NestJS + workers BullMQ en el mismo proceso. |
| Vercel | Frontend Angular (rewrites SPA a `index.html`). |
| Neon | PostgreSQL gestionado. |
| Upstash / Redis 7 | Colas BullMQ. |
| GitHub Actions | CI (lint, build, tests, migraciones, gitleaks). |

---

## 2. Estructura del monorepo

```text
barberias-platform/
├── package.json                 # workspaces npm: backend-barberias, frontend-barberias
├── docker-compose.yml           # Redis local para BullMQ
├── render.yaml                  # blueprint de la API en Render
├── vercel.json                  # build del frontend desde la raíz
├── .github/workflows/ci.yml     # pipeline
├── backend-barberias/
│   ├── prisma/
│   │   ├── schema.prisma        # 28 modelos
│   │   ├── migrations/          # 16 migraciones versionadas
│   │   └── seed.ts
│   ├── scripts/check-integridad.cjs
│   ├── src/
│   │   ├── main.ts              # hardening HTTP + prefijo /api/v1
│   │   ├── app.module.ts        # composición raíz
│   │   ├── shared/              # Prisma, tiempo, colas, errores, estados
│   │   ├── iam/                 # auth, roles, guards, plataforma
│   │   ├── barberia/            # sedes, configuración, vinculación, clientes
│   │   ├── catalogo/            # servicios y combos
│   │   ├── horario/             # horarios y excepciones
│   │   ├── agenda/              # disponibilidad, bloqueos, huecos
│   │   ├── reserva/             # reservas, máquina de estados, expiración
│   │   ├── pago/                # caja
│   │   ├── antecedente/         # antecedentes y notas del cliente
│   │   ├── notificacion/        # persistencia + entrega
│   │   ├── auditoria/           # eventos y purga
│   │   ├── lista-espera/        # Carril B (alta + matcher + processor)
│   │   ├── cliente/             # módulo contenido, NO registrado (H22)
│   │   └── health/              # liveness y readiness
│   └── test/                    # E2E (vitest.config.e2e.ts) y guardias
└── frontend-barberias/
    ├── angular.json
    ├── vercel.json
    └── src/app/
        ├── core/                # guards, interceptors, servicios, tenant
        ├── auth/                # login, registro, recuperación
        ├── features/            # home, reservas, agenda, catálogo, admin…
        └── shared/              # layout y componentes reutilizables
```

### 2.1 Capas del backend

Cada dominio sigue la misma separación:

- `domain/`: reglas puras (estados, márgenes, fidelización, huecos). Sin Prisma ni Nest.
- `application/`: servicios de caso de uso, DTOs, processors de cola.
- `infrastructure/`: controllers, módulos, guards y decoradores.
- `shared/`: infraestructura transversal (Prisma, tiempo, colas, errores).

El flujo canónico de una petición es: **Autenticación → Autorización → Validación (DTO) → Regla de negocio → Máquina de estados → Concurrencia → Persistencia → Auditoría → Evento/Notificación**.

---

## 3. Multi-tenant

### 3.1 Aislamiento

- Cada entidad de negocio lleva `barberiaId` (servicios, combos, horarios, reservas, pagos, bloqueos, lista de espera, auditoría, etc.).
- Las consultas de aplicación filtran **siempre** por `barberiaId`; los IDs que llegan por URL se cruzan con la sede del token o de la cabecera.
- Un `ADMINISTRADOR` global puede operar cross-tenant solo en las rutas de plataforma (`/plataforma/...`).

### 3.2 Resolución del tenant

1. El JWT incluye roles con `barberiaId` y ámbito.
2. El frontend envía `x-barberia-id` con la sede activa.
3. `@CurrentBarberiaId()` resuelve y valida la sede contra la sesión; `@CurrentUser()` expone `UsuarioAutenticado`.
4. Los guards comprueban el rol (`RolesGuard`), la pertenencia real (`perteneceABarberia`) y el estado de la cuenta.

### 3.3 Reglas de alcance

- Rol `BARBERIA` + `barberiaId` nulo = fila corrupta, sin acceso.
- `CLIENTE` es global, pero la pertenencia a una sede se comprueba en `cliente_barberias`.
- `ADMINISTRADOR` no necesita `barberiaId`.

---

## 4. Autenticación y seguridad

### 4.1 Cadena de guards globales (orden de ejecución)

1. **`ThrottlerGuard`** — 120 peticiones/min por IP; `@SkipThrottle()` solo en health.
2. **`JwtAuthGuard`** — exige `Authorization: Bearer`; `@Public()` lo omite.
3. **`RolesGuard`** — exige `@Roles(...)` o `@Autenticado()`; **fail-closed**: sin decorador, 403.

Guards adicionales por ruta: `VinculoBarberiaGuard` (pertenencia a la sede) y la comprobación de `estadoCuenta` (`ACTIVO`/`SUSPENDIDO`).

### 4.2 Tokens y sesión

- JWT firmado con `JWT_SECRET`; expiración de 24 h configurada en `IamModule`.
- `tokenVersion` en `usuarios`: cambiarla invalida todos los tokens emitidos (cierre de sesión global y suspensión).
- Recuperación de contraseña con token aleatorio hasheado (`token_hash`, SHA-256) y expiración; un token usado no se reutiliza.
- Contraseñas con bcrypt coste 10; `passwordHash` se excluye de toda respuesta con `ClassSerializerInterceptor`.
- En producción `getJwtSecret()` aborta el arranque si el secreto falta, es trivial o mide menos de 32 caracteres.

### 4.3 Endurecimiento HTTP (`src/main.ts`)

- `APP_ENV` obligatorio y validado (`dev`, `staging`, `production`); si falta, el proceso termina con error.
- `helmet()`: CSP, `X-Frame-Options`, `X-Content-Type-Options`, HSTS, `Referrer-Policy`.
- Cuerpo máximo **100 kB** para JSON y `urlencoded`.
- `trust proxy = 1` para resolver la IP real detrás de Render/Cloudflare.
- CORS con lista blanca explícita + `FRONTEND_URL` (coma-separada) + previsualizaciones de Vercel del equipo; `credentials: true`; preflight cacheado 24 h.
- Prefijo global `/api/v1` (health excluido).
- `ValidationPipe` con `whitelist`, `forbidNonWhitelisted` y `transform`.
- `PrismaExceptionFilter` global traduce errores de unicidad, no encontrado y concurrencia.

### 4.4 Roles

`ADMINISTRADOR` (global), `ADMIN_BARBERIA`, `BARBERO`, `CLIENTE`. La jerarquía y la matriz de rutas están en `src/iam/domain/roles.ts` y `docs/MATRIZ_RUTAS.md`.

---

## 5. Modelo de datos

28 modelos Prisma agrupados en:

| Grupo | Modelos |
|---|---|
| Identidad | `Usuario`, `Rol`, `Permiso`, `RolPermiso`, `UsuarioRol`, `TokenRecuperacion` |
| Tenant | `Barberia`, `ConfiguracionBarberia`, `ClienteBarberia`, `SolicitudCambioBarberia` |
| Catálogo | `Servicio`, `Combo`, `ComboItem` |
| Agenda | `Horario`, `ExcepcionHorario`, `HorarioBarbero`, `ExcepcionHorarioBarbero`, `BloqueosAgenda` |
| Reservas | `Reserva`, `PropuestaHorario`, `ParticipanteReserva`, `ParticipanteServicio` |
| Caja | `Pago` |
| Cliente | `Antecedente`, `Reporte` (antecedentes y notas del cliente) |
| Comunicación | `Notificacion`, `ListaEspera` |
| Auditoría | `Auditoria` |

Notas de modelado:

- `fecha_cita`, `hora_inicio`, `hora_fin` son `DATE`/`TIME` interpretados como etiquetas locales de la sede; `expira_at`, `creado_at` y similares son `timestamptz`.
- Los estados son `VARCHAR` con `CHECK` en base (Prisma no modela catálogos); las constantes viven en `src/shared/domain/estados.ts`.
- Índices compuestos para las consultas del matcher: `(barberia_id, fecha_objetivo, estado)` y `(usuario_id, barberia_id, fecha_objetivo, estado)`.
- Migraciones versionadas; prohibido `prisma db push` y `migrate reset` contra staging/producción.

---

## 6. Concurrencia

- **Transacciones SERIALIZABLE** con reintentos y backoff (`withSerializableTransaction`, 3 intentos, jitter): cubre creación de reservas, cancelaciones, pagos, vinculaciones y el matcher.
- **Bloqueo pesimista por sede**: `SELECT … FOR UPDATE` sobre `barberias` antes de escribir agenda (`bloquearSedeParaEscritura`, SQL calificado con `Prisma.raw`).
- **Test-and-set** para la lista de espera: `UPDATE … WHERE estado = 'PENDIENTE'` y verificación de `count`.
- **Idempotencia de jobs**: `jobId` determinístico para expiraciones y recordatorios.
- Los errores de serialización agotados se convierten en **409**, nunca en 500.

---

## 7. Motor asíncrono (BullMQ)

### 7.1 Colas

| Cola | Productor | Consumidor | Jobs |
|---|---|---|---|
| `reservas-pendientes` | `ReservaService` | `ReservaProcessor` | `expirar-reserva` |
| `notificaciones` | `NotificacionService` | `NotificacionProcessor` | `enviar-notificacion`, `recordatorio-cita` |
| `agenda-bloqueos` | `AgendaService` | `BloqueosProcessor` | `liberar-bloqueo` |
| `auditoria-purga` | `AuditoriaModule` | `AuditoriaProcessor` | `purga-auditoria-diaria` |
| `lista-espera` | `ReservaService`, `ExpiracionReservaService` | `ListaEsperaProcessor` | `hueco-liberado` |

Los nombres y payloads están tipados en `src/shared/queues/queue.constants.ts`. BullMQ prohíbe `:` en nombres de cola y en `jobId`; por eso los identificadores usan `-`.

### 7.2 Configuración

- Conexión por `REDIS_URL` (con `maxRetriesPerRequest: null`) o `REDIS_HOST`/`REDIS_PORT`.
- Reintentos por defecto: 3 con backoff exponencial de 2 s (expiración, notificación, hueco liberado).
- `encolarConLimite` (H62): techo de 2 s para el `add`; nunca lanza, devuelve `{ ok, motivo }`. Evita que un Redis colgado bloquee una transacción ya confirmada.
- La reconciliación de arranque (H63) no se espera: `onApplicationBootstrap` lanza la promesa en segundo plano para no retrasar `listen`.

### 7.3 Flujo del Carril B

```text
cancelación / rechazo / expiración / reprogramación
        │  (commit OK)
        ▼
ReservaService.avisarHuecoLiberado ──► cola "lista-espera" (job hueco-liberado)
                                               │
                                               ▼
                                   ListaEsperaProcessor
                                               │
                                               ▼
                       ListaEsperaMatcherService (FIFO + margen D42)
                         │ test-and-set SERIALIZABLE
                         ▼
              PENDIENTE → NOTIFICADO + NotificacionService
```

Características:

- Se emite **después del commit**: un rollback no genera avisos de huecos inexistentes.
- Best-effort con techo de 2 s: la cancelación ya confirmada no falla porque Redis esté caído.
- Un hueco = un aviso; la fila que no cabe permanece `PENDIENTE` para otro hueco.
- El matcher relee la sede para usar `margenGrupalMinutos` vigente y descarta bloques pasados o en curso.

### 7.4 Operación de workers

- Los processors corren **dentro del proceso NestJS**; no hay workers separados.
- En producción puede haber varias instancias: BullMQ reparte los jobs y el test-and-set evita dobles avisos.
- No hay `enableShutdownHooks()`: en un despliegue, los jobs en vuelo pueden reintentarse (entrega **at-least-once**). Por eso todas las transiciones son idempotentes.
- Redis debe tener persistencia (AOF/RDB) para no perder jobs con `delay` (expiración y recordatorios).

---

## 8. Tiempo y zonas horarias

- `TiempoService` centraliza `ahora()`, `fechaDeCalendario()`, `aInstante()` y `desdeInstante()`.
- Las etiquetas de fecha/hora se leen por sus partes UTC del almacenamiento; nunca con `toISOString().slice()`.
- La zona de la sede (`barberias.zonaHoraria`) se usa para componer instantes y para medir "hoy" en horizonte, cancelación y no-show.
- La suite corre con `TZ=UTC` y `TZ=America/Santo_Domingo` (`npm run test:tz-utc`, `test:tz-santo-domingo`).

---

## 9. Errores y validación

- Contrato D40: `{ statusCode, codigo, mensaje }`, códigos en inglés, mensajes en español.
- Helpers: `errorDeSolicitud` (400), `errorDePermiso` (403), `errorDeConflicto` (409), `reglaDeNegocio` (422, con detalle opcional).
- `PrismaExceptionFilter`: `P2002 → 409`, `P2025 → 404`, `P2034/40001/40P01 → 409`.
- Los DTOs validan en el borde; el servicio revalida las reglas de negocio que no pueden depender del transporte.

---

## 10. Frontend Angular

- **Standalone components** con router de Angular 22; sin NgModules.
- Carpetas por dominio en `src/app/features/`; servicios HTTP en `core/services/`.
- Guards funcionales: `authGuard` (sesión), `roleGuard` (rol), `tenantGuard` (sede activa seleccionada).
- `auth.interceptor` añade el Bearer y centraliza el 401.
- `TenantService` persiste la sede activa y alimenta `x-barberia-id`.
- `API_URL` en `core/constants/api.constants.ts`: `http://localhost:3000/api/v1` en desarrollo y la URL de Render en producción. No hay archivo de environment: se decide con `isDevMode()`.
- UI con PrimeNG + Tailwind; iconos PrimeIcons; QR generado en cliente con `qrcode-generator`.
- Build de producción: `dist/frontend-barberias/browser` (Vercel sirve esa carpeta con rewrite SPA).

---

## 11. Calidad y verificación

| Capa | Herramienta | Estado actual |
|---|---|---|
| Unitarios/integración backend | Vitest (`npm run test`) | 55 archivos, 669 tests |
| E2E backend | Vitest (`vitest.config.e2e.ts`, `npm run test:e2e`) | Requiere PostgreSQL y Redis; aborta si `APP_ENV !== 'dev'`. |
| Frontend | `ng test` (Vitest + jsdom) | Servicios y guards principales. |
| Lint | oxlint type-aware | 0 errores. |
| Build | `nest build`, `ng build` | Verdes. |
| Integridad BD | `npm run check:integridad` | Compara migraciones y CHECK contra la base migrada. |
| Secretos | Gitleaks en CI | Falla el pipeline si detecta claves. |

---

## 12. Observabilidad

- `GET /api/v1/health/liveness` — solo proceso vivo (uptime, timestamp). Es la sonda de Render.
- `GET /api/v1/health` — readiness: ping a PostgreSQL, PING a Redis y heap < 300 MB. Devuelve 503 si algo falla; no debe usarse como sonda de vida.
- Logs estructurados de Nest con contexto; los eventos críticos (jobs, matcher, encolados fallidos) emiten líneas con identificadores (`suscripcionId`, `reservaId`, `jobId`).
- No hay APM ni trazas distribuidas integradas.

---

## 13. Deuda técnica conocida

| ID | Descripción | Impacto |
|---|---|---|
| HALLAZGO-CB-02 | Reintento del job tras el test-and-set puede avisar a una segunda candidata. | Bajo; requiere persistir el hueco avisado. |
| — | Cierre automático de suscripciones (`CERRADO`) no implementado. | Las filas quedan `NOTIFICADO` indefinidamente. |
| — | `PROPUESTA_PENDIENTE` no lo escribe el flujo de propuestas. | El estado existe en el catálogo, pero la reserva conserva su estado mientras hay propuesta. |
| — | Envío de notificaciones simulado. | No hay email/SMS real. |
| H22 | `src/cliente/` sin registrar (ficha y notas). | Rutas 404. |
| — | Sin `enableShutdownHooks()`. | Jobs en vuelo se reintentan al desplegar. |
| — | `render.yaml` no declara `APP_ENV` ni usa `FRONTEND_URL`. | Hay que configurarlas a mano en Render (ver `docs/DESPLIEGUE.md`). |

---

## 14. Decisiones arquitectónicas clave

1. **Backend como única autoridad** de reglas, precios, márgenes y estados.
2. **BullMQ en lugar de eventos en proceso** para todo lo que debe sobrevivir a un reinicio o cruzar instancias.
3. **PostgreSQL con transacciones SERIALIZABLE + lock por sede** en vez de confiar en comprobaciones optimistas aisladas.
4. **Etiquetas locales + zona de sede** en vez de almacenar instantes para las citas.
5. **Un único calculador puro de huecos** (D47) reutilizado por disponibilidad, alternativas, creación y cotización.
6. **Tests como contrato**: TZ dual, integridad de migraciones/CHECK y E2E con guardia de entorno.
