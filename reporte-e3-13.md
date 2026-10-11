TAREA: E3-13 · Solicitudes de cambio de nombre y responsable
RAMA: feat/solicitudes-cambio-barberia

## 1. QUÉ HICE (5 líneas máximo)
1. Migración D26 `solicitudes_cambio_barberia` (tipo `NOMBRE`/`RESPONSABLE`, estado `PENDIENTE`/`APROBADA`/`RECHAZADA`, `CHECK` de catálogo, de motivo y de resolución) aplicada a `dev` con `migrate deploy`.
2. `POST /barberias/:id/solicitudes-cambio` (ADMIN_BARBERIA, y 403 de servicio si es de otra sede) + bandeja de plataforma `GET /plataforma/solicitudes-cambio` y `POST /plataforma/solicitudes-cambio/:id/resolver` (ADMINISTRADOR).
3. Aprobación del cambio de responsable en UNA transacción SERIALIZABLE: `barberias.responsable_id`, el rol `ADMIN_BARBERIA` movido del anterior al nuevo (que debe existir) y la auditoría.
4. `PATCH /barberias/:id` queda limitado a `descripcion`, `ubicacion`, `logoUrl` y `telefono`: el nombre responde 422 `NOMBRE_REQUIERE_SOLICITUD`, el estado 422 `ESTADO_NO_EDITABLE` y el teléfono exige la contraseña actual (D27).
5. Pruebas: unit spec del servicio nuevo, 7 casos nuevos en `barberia.service.spec.ts`, E2E de 20 casos y matriz de permisos actualizada (68 rutas / 272 decisiones).

## 2. ARCHIVOS TOCADOS (git diff --stat, literal)
```
 AUDITORIA_HALLAZGOS.md                             |  21 +++
 backend-barberias/prisma/schema.prisma             |  36 +++++
 .../barberia/application/barberia.service.spec.ts  | 160 +++++++++++++++++++--
 .../src/barberia/application/barberia.service.ts   |  62 +++++++-
 .../application/dto/barberia-lectura.dto.ts        |   2 +
 .../application/dto/barberia-response.dto.ts       |   2 +
 .../application/dto/update-barberia.dto.ts         |  27 +++-
 backend-barberias/src/barberia/barberia.module.ts  |  12 +-
 .../infrastructure/barberia.controller.spec.ts     |  22 +++
 .../barberia/infrastructure/barberia.controller.ts |  26 +++-
 backend-barberias/test/permisos-matriz.e2e-spec.ts |  13 +-
 backend-barberias/test/permisos-matriz.spec.ts     |  25 +++-
 docs/MATRIZ_RUTAS.md                               |  14 +-
 13 files changed, 389 insertions(+), 33 deletions(-)
```
Nuevos (sin trackear):
```
 backend-barberias/prisma/migrations/20261011140000_e313_solicitudes_cambio_barberia/migration.sql
 backend-barberias/prisma/migrations/20261011140000_e313_solicitudes_cambio_barberia/  (directorio)
 backend-barberias/src/barberia/domain/solicitud-cambio.ts
 backend-barberias/src/barberia/application/solicitud-cambio.service.ts
 backend-barberias/src/barberia/application/solicitud-cambio.service.spec.ts
 backend-barberias/src/barberia/application/dto/create-solicitud-cambio.dto.ts
 backend-barberias/src/barberia/application/dto/resolver-solicitud-cambio.dto.ts
 backend-barberias/src/barberia/application/dto/listar-solicitudes-cambio.dto.ts
 backend-barberias/src/barberia/application/dto/solicitud-cambio-response.dto.ts
 backend-barberias/src/barberia/infrastructure/plataforma-solicitudes-cambio.controller.ts
 backend-barberias/test/e3-13-solicitudes-cambio.e2e-spec.ts
 reporte-e3-13.md   (este informe)
```

## 3. TEST ROJO (antes del fix, salida literal)

**3.1 · El servicio nuevo no existe** (`npx vitest run src/barberia/application/solicitud-cambio.service.spec.ts`):
```
 ❯ src/barberia/application/solicitud-cambio.service.spec.ts (0 test)

⎯⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯⎯

 FAIL  src/barberia/application/solicitud-cambio.service.spec.ts [ src/barberia/application/solicitud-cambio.service.spec.ts ]
Error: Cannot find module './solicitud-cambio.service.js' imported from .../solicitud-cambio.service.spec.ts

 Test Files  1 failed (1)
      Tests  no tests
EXIT=1
```

**3.2 · Las pruebas nuevas contra el código de producción ANTERIOR.** Para obtener un rojo real de las
reglas de `PATCH`, se guardó el estado actual, se restauraron temporalmente a HEAD los tres archivos de
producción (`barberia.service.ts`, `update-barberia.dto.ts`, `barberia.controller.ts`) con `git stash` y se
corrieron las pruebas nuevas. Salida literal (`EXIT=1`):
```
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 5 ⎯⎯⎯⎯⎯⎯

 FAIL  src/barberia/infrastructure/barberia.controller.spec.ts > BarberiaController > E3-13 · crearSolicitudCambio > delega en el servicio con la sede del parámetro y la sesión
TypeError: controller.crearSolicitudCambio is not a function
 ❯ src/barberia/infrastructure/barberia.controller.spec.ts:109:24

 × 422 NOMBRE_REQUIERE_SOLICITUD al intentar cambiar el nombre y NO toca la base 20ms
 × el responsable puede actualizar descripcion, ubicacion y logo 9ms
 × 422 PASSWORD_REQUERIDA al cambiar el teléfono sin contraseña actual 7ms
 × 422 PASSWORD_INCORRECTA cuando la contraseña no coincide 140ms
 Test Files  2 failed (2)
      Tests  5 failed | 49 passed (54)
EXIT=1
```
Después, `git stash pop` devolvió el árbol de trabajo y la integridad se verificó archivo por archivo
(`OK barberia.service.ts`, `OK barberia.controller.ts`; el DTO solo cambió el terminador de línea a CRLF,
que es el del repo).

**3.3 · E2E.** No se capturó una corrida E2E "antes": en ese momento las tres rutas no existían (404) y el
código se implementó en el mismo ciclo. El rojo del comportamiento queda cubierto por 3.2 y por la
ejecución verde del E2E.

## 4. TEST VERDE (después, salida literal)

**4.1 · Unit del servicio nuevo y de los specs tocados** (`npx vitest run src/barberia`):
```
 ✓ src/barberia/application/solicitud-cambio.service.spec.ts (12 tests)
 Test Files  3 passed (3)
      Tests  65 passed (65)
```

**4.2 · E2E de E3-13** (`APP_ENV=dev npx vitest run --config ./vitest.config.e2e.ts test/e3-13-solicitudes-cambio.e2e-spec.ts`),
última corrida tras el ciclo de `git stash` de 3.2 (confirma que la restauración dejó el árbol correcto):
```
 ✓ test/e3-13-solicitudes-cambio.e2e-spec.ts (20 tests) 20037ms
       ✓ 422 NOMBRE_REQUIERE_SOLICITUD al intentar cambiar el nombre y la sede no cambia  714ms
       ✓ permite descripcion, ubicacion y logoUrl sin contraseña  503ms
       ✓ 422 PASSWORD_REQUERIDA si se intenta cambiar el teléfono sin la contraseña actual (D27)  426ms
       ✓ 422 PASSWORD_INCORRECTA si la contraseña actual no coincide  562ms
       ✓ cambia el teléfono con la contraseña actual correcta  632ms
       ✓ 201: el ADMIN_BARBERIA de la sede crea la solicitud en PENDIENTE  975ms
       ✓ 409 SOLICITUD_PENDIENTE si se repite el mismo tipo pendiente  548ms
       ✓ el ADMINISTRADOR lista las solicitudes y los demás roles reciben 403  1091ms
       ✓ aprobar el nombre actualiza la sede, la solicitud y deja auditoría  1404ms
       ✓ 409 ESTADO_INVALIDO al intentar resolver dos veces la misma solicitud  482ms
       ✓ 422 MOTIVO_REQUERIDO y rechazo con motivo en una segunda solicitud  2093ms
       ✓ 201: el responsable solicita el cambio a un usuario existente  851ms
       ✓ 422 RESPONSABLE_INEXISTENTE si el usuario propuesto no existe  562ms
       ✓ aprobar mueve responsable_id y el rol ADMIN_BARBERIA al nuevo responsable  2117ms
       ✓ el nuevo responsable puede editar la sede  928ms

 Test Files  1 passed (1)
      Tests  20 passed (20)
   Duration  24.16s
EXIT=0
```
(Vitest resume aquí 15 de los 20 casos; los cinco restantes —«el CLIENTE sigue recibiendo 403», «403
SOLO_ADMIN_BARBERIA…», «el antiguo responsable pierde la edición directa (403)» y los dos 400 de
validación— salen en el mismo resumen por archivo y no imprimen línea propia en esta forma de reporter.
El segundo de ellos es el que sostiene el 403 del hallazgo H51.)

**4.3 · Matriz rol × ruta sobre HTTP** (incluida en el lote 1 de la suite completa). Salida literal del
recuadro (43 casos × 4 roles), con las tres filas nuevas:
```
=== MATRIZ HTTP (43 rutas × 4 roles) ===
PATCH /barberias/{A}                                     | ADM: 200 | ADM_B: 200 | BARB:403  | CLIEN:403
POST /barberias/{A}/solicitudes-cambio                   | ADM: 201 | ADM_B: 409 | BARB:403  | CLIEN:403
GET /plataforma/solicitudes-cambio                       | ADM: 200 | ADM_B:403  | BARB:403  | CLIEN:403
POST /plataforma/solicitudes-cambio/<uuid>/resolver      | ADM: 404 | ADM_B:403  | BARB:403  | CLIEN:403
```
(Los `409`/`404` de las filas de ADMINISTRADOR y de `ADM_B` no son 403: el guard les deja pasar y es la
lógica de negocio quien responde; la matriz solo mide el 403 del guard.)

## 5. SUITE COMPLETA: npm run test (resumen literal)
```
 Test Files  39 passed (39)
      Tests  409 passed (409)
   Duration  12.76s
EXIT=0
```
Antes de E3-13: 38 archivos / 393 tests. Sobre esa base: `+1` archivo (`solicitud-cambio.service.spec.ts`)
y `+16` tests.

**Suite E2E completa** (`APP_ENV=dev npm run test:e2e`, `= vitest run --config ./vitest.config.e2e.ts`).
La corrida entera no cabe en una sola invocación de este entorno (tope de 600 s; la suite tarda ~590 s), así
que **se ejecutó en dos lotes disjuntos que cubren los 22 archivos, sin solapamiento**:

```
Lote 1/2 (11 archivos: app, auth, barberia, cliente-ficha-roles, e1-06-cross-tenant-admin,
e1-06-sede-del-tenant, e3-03, e3-04, e3-05, e3-06-07, e3-13)
 Test Files  11 passed (11)
      Tests  105 passed (105)
   Duration  303.51s
EXIT=0

Lote 2/2 (11 archivos: e3-08, e3-11, h18, h19-h20, hallazgo14, hallazgo16, health,
pago-barbero-asignado, permisos-matriz, reserva-walkin-split, throttler-rate-limit)
 Test Files  11 passed (11)
      Tests  66 passed (66)
   Duration  303.59s
EXIT=0
```
Total E2E: **22 archivos / 171 tests en verde** (antes: 21 archivos / 151 tests → `+1` archivo, `+20`
tests).

**Flake observado (una vez, en la PRIMERA corrida del lote 1):**
```
 FAIL  test/e3-03-validaciones.e2e-spec.ts > E3-03 · parte 2 — reglas de creación de reserva > ROJO: LIMITE_PENDIENTES 422 cuando ya alcanza max_pendientes
AssertionError: expected 409 to be 201
 Test Files  1 failed | 10 passed (11)
      Tests  1 failed | 104 passed (105)
   Duration  341.65s
EXIT=1
```
No es una regresión: el 409 es el `ConflictException` de `withSerializableTransaction` por contención
contra la BD remota (la misma familia que documentan H38 y E2-06). El archivo pasa al re-ejecutarlo aislado
(`✓ test/e3-03-validaciones.e2e-spec.ts (11 tests) 43543ms`, `Test Files 1 passed (1)`, `Tests 11 passed
(11)`, exit 0) y en la segunda corrida del lote 1 (`105 passed (105)`, exit 0).

**Checks estáticos**
- `npx tsc --noEmit` → **25 errores**, exactamente los mismos 25 preexistentes del repo (H38/H49): 7 en
  `reserva.service.spec.ts`, 3 en `e3-11-configuracion.spec.ts`, 3 en `e3-03-validaciones.e2e-spec.ts`,
  3 en `prisma/seed-demo-users.ts`, 2 en `permisos-matriz.e2e-spec.ts` (`cuerpo: []`), 2 en
  `barberia.controller.spec.ts` (claves `update`/`remove` duplicadas del mock), 2 en
  `barberia.service.spec.ts` (líneas 763/779, `vinculo`), 1 en `app.e2e-spec.ts`, 1 en
  `prisma-exception.filter.spec.ts`, 1 en `prisma.config.ts`. **Ninguno en los archivos nuevos ni en las
  líneas añadidas.**
- `npm run lint` → **0 errores**, 52 avisos (preexistentes, `unbound-method`). Mi aserción nueva del
  controller añade una instancia de ese mismo aviso, igual que las ~10 que ya tenía el archivo.

## 6. CRITERIOS DE ACEPTACIÓN
Del backlog (E3-13):
- [x] **El nombre no se puede cambiar por `PATCH`.** `PATCH /barberias/:id` con `nombre` → **422
  `NOMBRE_REQUIERE_SOLICITUD`** y la sede conserva su nombre (E2E «422 NOMBRE_REQUIERE_SOLICITUD al
  intentar cambiar el nombre y la sede no cambia», que además relee la BD; unit
  «422 NOMBRE_REQUIERE_SOLICITUD al intentar cambiar el nombre y NO toca la base», que verifica que
  `barberia.update` NO se llama).
- [x] **Aprobar el cambio de responsable mueve el rol correctamente.** E2E «aprobar mueve
  responsable_id y el rol ADMIN_BARBERIA al nuevo responsable»: `barberia.responsableId = nuevo`,
  `usuario_roles` del anterior en esa sede → `null`, fila del nuevo con el mismo `barberia_id` → presente,
  y `auditoria` con `SOLICITUD_CAMBIO_RESPONSABLE_APROBADA`. Corolarios en el mismo archivo: el antiguo
  responsable recibe 403 al editar y el nuevo puede editar.

De las cinco acciones de la Fase 2:
- [x] **Migración D26** con `CHECK` de `tipo`, `estado`, motivo de rechazo y coherencia
  `resuelto_por`/`resuelto_at`; aplicada con `prisma migrate deploy` (`All migrations have been
  successfully applied`), y verificada en `information_schema.tables` / `pg_indexes`.
- [x] **Rutas**: `POST /barberias/:id/solicitudes-cambio` (`@Roles(ADMIN_BARBERIA)`),
  `GET /plataforma/solicitudes-cambio` y `POST /plataforma/solicitudes-cambio/:id/resolver`
  (`@Roles(ADMINISTRADOR)`), declaradas en `test/permisos-matriz.spec.ts` (68 rutas / 272 decisiones) y en
  `docs/MATRIZ_RUTAS.md` (filas 57-59).
- [x] **Lógica de aprobación atómica**: las cuatro escrituras (rol, `responsable_id`, estado de la
  solicitud y auditoría) van dentro de un único `withSerializableTransaction`; si el usuario propuesto ya
  no existe, la transacción aborta entera (422 `RESPONSABLE_INEXISTENTE`).
- [x] **Limitación de la edición directa** y **D27**: el teléfono exige `passwordActual`
  (`bcrypt.compare`, timing-safe) → 422 `PASSWORD_REQUERIDA` sin ella y 422 `PASSWORD_INCORRECTA` si no
  coincide; con la correcta, 200 y el teléfono cambia.
- [x] **Pruebas** unitarias y E2E de los dos puntos pedidos, más matriz, suite unitaria completa y E2E
  completa.

## 7. DECISIONES O DESVIACIONES
1. **`logo_url` no existía en el esquema.** La tarea exige que `PATCH` admita `logo_url`, pero `barberias`
   no tenía esa columna ni en el esquema ni en el ledger (la BD `dev` sí la tenía, huérfana: H50). Se
   añadió en la misma migración con `ADD COLUMN IF NOT EXISTS "logo_url" TEXT` y se declaró `@db.Text` en
   `schema.prisma`, para que `migrate deploy` funcione sobre `dev` y una base nueva quede idéntica.
2. **`nombre` y `estado` se conservan en `UpdateBarberiaDto`** solo para poder responder el error de
   negocio (422) en lugar del 400 genérico que produce D30 (`forbidNonWhitelisted`). No se editan: el
   servicio los rechaza antes de leer nada.
3. **La ruta usa `:id`, no `:barberiaId`**, como pide el backlog. Consecuencia: el `RolesGuard` no resuelve
   la sede del parámetro y la pertenencia real la comprueba el servicio (403 `SOLO_ADMIN_BARBERIA`).
   Registrado como H51; se descartó renombrar el parámetro por contradecir la ruta pedida.
4. **`POST .../resolver` responde 201** (el `@Post` por defecto de Nest) y no 200. Se documenta porque el
   E2E lo asierta tal cual.
5. **Una sola solicitud PENDIENTE por sede y tipo** (409 `SOLICITUD_PENDIENTE`). No lo pedía el backlog,
   pero sin esa invariante dos solicitudes vivas del mismo tipo dejan la aprobación ambigua.
6. **Orden de validaciones en la creación**: pertenencia → existencia de la sede → valor (`SIN_CAMBIOS`,
   `RESPONSABLE_INEXISTENTE`) → duplicado pendiente → inserción. Por eso el E2E de un uuid inexistente
   recibe 422 y no 409.
7. **Listado paginado D32** (`{ data, total, page, pageSize }`) en lugar de un array plano, con `estado`,
   `barberiaId`, `page` y `pageSize` opcionales, y la sede incluida en cada fila.
8. **No se añadió notificación** al nuevo responsable ni al solicitante (E3-12 sí la exigía; E3-13 no la
   menciona). Queda en §9.
9. **La edición directa no audita** (solo la creación, aprobación y rechazo de solicitudes). Es el
   comportamiento previo del módulo; si se quiere rastro de cada cambio de teléfono, es una decisión
   aparte.

## 8. HALLAZGOS NUEVOS
Registrados en `AUDITORIA_HALLAZGOS.md` (sección «HALLAZGOS DE E3-13»):
- **H50 · Media-Alta · abierto.** El ledger de `dev` registra `20261011130000_e203_integridad_base`, una
  migración que **no existe** en `prisma/migrations` ni en git (`finished_at = 2026-10-10T20:28:32`), y la
  columna `barberias.logo_url` existe sin migración que la declare. E3-13 la esquivó (migración
  idempotente) pero no la resolvió. Evidencia: `_prisma_migrations` de `dev`; `P3018 / 42701` al hacer
  `migrate deploy`.
- **H51 · Baja · mitigado.** Las rutas con `:id` quedan fuera del acotado por tenant del `RolesGuard`
  (decisión intencional de E1-06); la pertenencia debe comprobarla siempre el servicio. Evidencia: el E2E
  de la sede ajena (403 `SOLO_ADMIN_BARBERIA`).

## 9. PENDIENTE O NO VERIFICADO
- **Frontend**: no hay panel de solicitudes (ni en la sede ni en plataforma). Las tres rutas quedan sin
  consumidor, igual que las de E3-11.
- **Notificación** al nuevo responsable / al solicitante, y **auditoría de la edición directa**: no
  implementadas (no pedidas por la tarea).
- **H50 sin resolver**: la migración ausente del ledger sigue sin recrearse y una base creada desde cero
  no reproducirá los `CHECK` de D09/D10 que sí tiene `dev`.
- **`PENDIENTE_APROBACION` de la 6.ª vinculación (D10/E3-12) sigue sin rutas**: esta bandeja resuelve
  *solicitudes de cambio de la sede*, no *vinculaciones de cliente*.
- **Flake de contención**: la primera corrida del lote 1 de E2E falló una vez en `e3-03` por contención
  SERIALIZABLE contra la BD remota (verde aislado y verde en la repetición). E2-06 sigue sin sus 3
  corridas consecutivas.
- **E2E en dos lotes**: por el tope de 600 s de la herramienta, la suite E2E completa se ejecutó en dos
  invocaciones disjuntas (11 + 11 archivos). No se observó ninguna interferencia entre lotes, pero no es
  una única corrida.
- **`tsc --noEmit`**: 25 errores preexistentes ajenos a esta tarea (mismos que antes del cambio).
- **No se hizo push ni merge.**

## 10. git status --short / git log -1 --oneline / git log --oneline -5
```
 M AUDITORIA_HALLAZGOS.md
 M backend-barberias/prisma/schema.prisma
 M backend-barberias/src/barberia/application/barberia.service.spec.ts
 M backend-barberias/src/barberia/application/barberia.service.ts
 M backend-barberias/src/barberia/application/dto/barberia-lectura.dto.ts
 M backend-barberias/src/barberia/application/dto/barberia-response.dto.ts
 M backend-barberias/src/barberia/application/dto/update-barberia.dto.ts
 M backend-barberias/src/barberia/barberia.module.ts
 M backend-barberias/src/barberia/infrastructure/barberia.controller.spec.ts
 M backend-barberias/src/barberia/infrastructure/barberia.controller.ts
 M backend-barberias/test/permisos-matriz.e2e-spec.ts
 M backend-barberias/test/permisos-matriz.spec.ts
 M docs/MATRIZ_RUTAS.md
?? backend-barberias/prisma/migrations/20261011140000_e313_solicitudes_cambio_barberia/
?? backend-barberias/src/barberia/application/dto/create-solicitud-cambio.dto.ts
?? backend-barberias/src/barberia/application/dto/listar-solicitudes-cambio.dto.ts
?? backend-barberias/src/barberia/application/dto/resolver-solicitud-cambio.dto.ts
?? backend-barberias/src/barberia/application/dto/solicitud-cambio-response.dto.ts
?? backend-barberias/src/barberia/application/solicitud-cambio.service.spec.ts
?? backend-barberias/src/barberia/application/solicitud-cambio.service.ts
?? backend-barberias/src/barberia/domain/
?? backend-barberias/src/barberia/infrastructure/plataforma-solicitudes-cambio.controller.ts
?? backend-barberias/test/e3-13-solicitudes-cambio.e2e-spec.ts
?? reporte-e3-13.md

=== git log -1 --oneline ===
bd95d79 Merge pull request #51 from Codecore-J/fix/h38-h49-estabilizar-e2e

=== git log --oneline -5 ===
bd95d79 Merge pull request #51 from Codecore-J/fix/h38-h49-estabilizar-e2e
8b061de fix(test): resuelve timeouts H38 y corrige fixtures/datos H49
fff6d54 Merge pull request #50 from Codecore-J/feat/configuracion-barberia
d8593be feat(configuracion): modulo de configuracion y limites de reservas (E3-11)
cec0528 Merge pull request #48 from Codecore-J/fix/e204-ventana-cancelacion-zona-sede
```
No hagas merge. Espera aprobación.
