> Plantilla 8.4 de `docs/BACKLOG_BARBERIAS_V1.md`. Sin `push` ni `merge`: la rama espera aprobación.

```
TAREA: E2-03 — Migración de esquema y de datos (integridad base)
RAMA: fix/db-integridad-base (creada tras fast-forward LOCAL de main a 99ce004 = E2-04)
```

## 0. NOTA PREVIA: E2-04 no estaba en `main`

El enunciado daba E2-04 por fusionado en `main`, pero **no lo estaba** en este clon:

- `git ls-remote origin refs/heads/main` → `cf8fb8c` (merge de E2-02). `git pull` en `main` no movía nada.
- `src/shared/time/` y `prisma/migrations/…_e204_zona_horaria/` no existían en `main`.
- E2-04 vivía solo en `origin/fix/h22-zona-horaria` = `99ce004`, cuyo padre es exactamente `cf8fb8c`.

Con tu aprobación (opción «Sobre E2-04»), hice un **fast-forward LOCAL** de `main` a `99ce004` (sin `push`) y creé `fix/db-integridad-base` desde ahí. Así E2-03 se apoya en la columna `barberias.zona_horaria` de E2-04 y **no duplica** su migración (el `CHECK` de la zona sí lo añade E2-03, como dejó escrito E2-04).

## 1. QUÉ HICE

Inspeccioné por `SELECT DISTINCT` las 20 columnas de estado candidatas; la única basura fue `barberias.estado` con 6 filas `'ACTIVA'`. La migración `20261011130000_e203_integridad_base` normaliza `'ACTIVA'→'ACTIVO'`, añade `barberias.creado_at`/`logo_url` y `reservas.completada_at`, y crea **17 CHECK** (zona horaria, estado de barbería, 3 de reservas, cuenta, vinculación, pago, 2 de antecedentes, 2 de notificaciones, ámbito y 2 de excepciones). `schema.prisma` quedó sincronizado (todo `String`; **no existía ningún enum de Prisma**, así que D14 se cumple por vacío, verificado con `git grep`). Los CHECK destaparon un segundo defecto de código (`vincularCliente` escribía `'PENDIENTE'` fuera de D10) y varios fixtures de E2E fuera de catálogo; los alineé. Apliqué con `migrate deploy` en `dev` + `generate`, y escribí una prueba de integración que inserta por SQL directo estados inválidos (con rollback) — ROJO→VERDE.

## 2. ARCHIVOS TOCADOS

`git diff --stat` (modificados) + nuevos sin seguimiento:

```
 backend-barberias/prisma/schema.prisma                                    | 10 +++++++++-
 backend-barberias/src/barberia/application/barberia.service.spec.ts       | 10 +++++-----
 backend-barberias/src/barberia/application/barberia.service.ts            |  6 +++++-
 backend-barberias/test/barberia.e2e-spec.ts                              |  4 ++--
 backend-barberias/test/e1-06-cross-tenant-admin.e2e-spec.ts              |  5 +++--
 backend-barberias/test/e3-03-validaciones.e2e-spec.ts                    |  2 +-
 backend-barberias/test/hallazgo16-rolesguard-global.e2e-spec.ts          |  2 +-
 backend-barberias/test/permisos-matriz.e2e-spec.ts                       |  4 ++--
 frontend-barberias/src/app/core/services/tenant.service.ts               |  2 +-
 9 files changed, 29 insertions(+), 16 deletions(-)
```

**Nuevos (sin seguimiento):**
- `backend-barberias/prisma/migrations/20261011130000_e203_integridad_base/migration.sql`
- `backend-barberias/test/e2-03-integridad-base.e2e-spec.ts`
- `AUDITORIA_HALLAZGOS.md` (H49, H50)

## 3. TEST ROJO (antes del fix, salida literal)

Con los `CHECK` **aún no aplicados** (estado previo a la migración), la base ACEPTA los 16 valores inválidos: cada caso llega a la marca de rollback en vez de ser rechazado.

```
$ APP_ENV=dev npx vitest run --config ./vitest.config.e2e.ts test/e2-03-integridad-base.e2e-spec.ts
⎯⎯⎯⎯⎯⎯⎯⎯ Failed Tests 16 ⎯⎯⎯⎯⎯⎯⎯⎯
 FAIL  … > rechaza 'barberias.estado = ACTIVA (variante h…'
 FAIL  … > rechaza 'barberias.zona_horaria fuera del catá…'
 FAIL  … > rechaza 'reservas.estado = NO_ASISTIO (valor r…'
 FAIL  … > rechaza 'reservas.estado fuera de los 8 de §5.1'
 FAIL  … > rechaza 'reservas.tipo_reserva fuera de catálo…'
 FAIL  … > rechaza 'reservas.modo_confirmacion fuera de c…'
 FAIL  … > rechaza 'usuarios.estado_cuenta fuera de D09'
 FAIL  … > rechaza 'cliente_barberias.estado_vinculacion …'
 FAIL  … > rechaza 'pagos.estado_pago fuera de catálogo'
 FAIL  … > rechaza 'antecedentes.origen fuera de catálogo'
 FAIL  … > rechaza 'antecedentes.estado_validacion fuera …'
 FAIL  … > rechaza 'notificaciones.canal fuera de catálogo'
 FAIL  … > rechaza 'notificaciones.estado fuera de catálo…'
 FAIL  … > rechaza 'roles.ambito fuera de catálogo'
 FAIL  … > rechaza 'excepciones_horario.tipo fuera de cat…'
 FAIL  … > rechaza 'excepciones_horario_barbero.tipo fuer…'
AssertionError: la base ACEPTÓ el valor inválido: E203_ROLLBACK: expected 'E203_ROLLBACK' not to contain 'E203_ROLLBACK'

 Test Files  1 failed (1)
      Tests  16 failed | 2 passed (18)
EXIT=1
```

(Los 2 que pasan son los controles positivos: un valor válido sí entra, así que el rechazo no vendrá de una causa ajena al CHECK.)

## 4. TEST VERDE (después, salida literal)

Con la migración aplicada:

```
$ APP_ENV=dev npx vitest run --config ./vitest.config.e2e.ts test/e2-03-integridad-base.e2e-spec.ts
 Test Files  1 passed (1)
      Tests  18 passed (18)
EXIT=0
```

Ejemplo del mensaje que devuelve la base ahora (SQLSTATE 23514):

```
Raw query failed. Code: `23514`. Message: `ERROR: new row for relation "reservas" violates check constraint "reservas_estado_check"`
```

Aplicación de la migración en `dev`:

```
$ npx prisma migrate deploy
8 migrations found in prisma/migrations
Applying migration `20261011130000_e203_integridad_base`
All migrations have been successfully applied.
```

## 5. SUITE COMPLETA

```
$ npm run test:tz-utc              # TZ=UTC
 Test Files  37 passed (37)
      Tests  376 passed (376)      EXIT=0

$ npm run test:tz-santo-domingo    # TZ=America/Santo_Domingo
 Test Files  37 passed (37)
      Tests  376 passed (376)      EXIT=0

$ APP_ENV=dev npx vitest run --config ./vitest.config.e2e.ts --testTimeout=40000
 Test Files  21 passed (21)
      Tests  157 passed (157)      EXIT=0
                                     # 139 previos + 18 nuevos

$ npx tsc --noEmit -p tsconfig.build.json     EXIT=0      # backend
$ (frontend) npx tsc --noEmit -p tsconfig.app.json   EXIT=0 # tipo estadoVinculacion
$ npm run lint                                Found 46 warnings and 0 errors.  EXIT=0
$ npx prisma migrate diff --from-schema-datasource prisma/schema.prisma \
      --to-schema-datamodel prisma/schema.prisma --exit-code
No difference detected.                       EXIT=0
```

## 6. CRITERIOS DE ACEPTACIÓN

- [x] **Insertar un estado inválido por SQL directo falla (test de integración en `dev`).** 16 columnas probadas; cada INSERT, dentro de una transacción que revierte, es rechazado con `23514`/`_check` (§3 ROJO, §4 VERDE).
- [x] **`prisma migrate diff` sin diferencias.** `No difference detected`, `EXIT=0` (`--from-schema-datasource` = base real vs. `schema.prisma`).
- [x] **`barberias` con `zona_horaria`, `creado_at`, `logo_url` y `CHECK (estado IN …)`.** Migración §1; `SELECT DISTINCT` previo documentado en §7.
- [x] **`CHECK` en las columnas del punto 2 de E2-03.** `reservas.estado/tipo_reserva/modo_confirmacion`, `usuarios.estado_cuenta`, `cliente_barberias.estado_vinculacion`, `pagos.estado_pago`, `antecedentes.origen/estado_validacion`, `notificaciones.canal/estado`, `roles.ambito`, `excepciones_horario.tipo`.
- [x] **`reservas.completada_at TIMESTAMPTZ NULL`.** Añadida.
- [x] **`schema.prisma`: columnas como `String` y enums sin uso eliminados.** Todas las columnas de estado ya eran `String`; **no existe ningún `enum` de Prisma** en el esquema (`grep '^enum'` vacío) ni import de enum de `@prisma/client` (los `EstadoReserva` del código son el type de `src/shared/domain/estados.ts`). Nada que eliminar.
- [x] **Aplicado con `migrate deploy` en `dev`; sin `db push`.** §4.

## 7. DECISIONES O DESVIACIONES

1. **Base de la rama: E2-04 (99ce004), no `cf8fb8c`.** Explicado en §0; sin esto E2-03 re-añadiría `zona_horaria` y duplicaría la migración de E2-04.
2. **Corrección de datos en la migración (H49).** `barberias.estado` tenía `ACTIVA=6`, `ACTIVO=38`. `'ACTIVA'` es variante ortográfica de `'ACTIVO'` (no un estado distinto), así que se normaliza con `UPDATE` antes del `CHECK`. El resto de columnas inspeccionadas ya estaba dentro de catálogo.
3. **`CHECK` de `barberias.zona_horaria`.** E2-04 difirió expresamente este `CHECK` a E2-03 (comentario en su migración y en `schema.prisma`). Catálogo D15 vigente: `'America/Santo_Domingo'`. Es de un solo valor a propósito (V1); ampliarlo es una migración de una línea.
4. **`CHECK` también en `excepciones_horario_barbero.tipo`** (además del `excepciones_horario.tipo` del backlog): ambos comparten el catálogo `TipoExcepcionHorario` y la tabla está vacía. Se marca como extensión mínima de integridad.
5. **Alineación de código a D10 (H50).** `vincularCliente` escribía `estado_vinculacion = 'PENDIENTE'`; el catálogo D10 es `ACTIVO`/`PENDIENTE_APROBACION`/`DESVINCULADO`. Se renombró a `'PENDIENTE_APROBACION'` (cambio de contrato del API `estadoVinculacion`, reflejado en el tipo del frontend). Sin esto el `CHECK` rompía la vinculación: no es una regla nueva, es alineación con el catálogo que el `CHECK` impone. E4 (aprobación de la 6ª) construye sobre este valor.
6. **Fixtures de E2E alineados.** `barberias.estado: 'ACTIVA'` → `'ACTIVO'` (permisos-matriz ×2, e3-03, hallazgo16) y `cliente_barberias.estadoVinculacion: 'SUSPENDIDO'` → `'DESVINCULADO'` (e1-06-cross-tenant). El esquema viejo los toleraba; el `CHECK` no.
7. **Metodología del ROJO.** Con la migración ya aplicada, para capturar el ROJO con el test DEFINITIVO (no una versión intermedia) quité temporalmente **solo** los 17 `CHECK` en `dev` (`scratch/e203-cks-down.sql`), capturé la salida y los restauré con el mismo SQL de la migración (`scratch/e203-cks-up.sql`). No se tocaron datos ni columnas; `migrate diff` volvió a dar «no difference».

## 8. HALLAZGOS NUEVOS

- **H49** (Medio) — `barberias.estado` con 6 filas `'ACTIVA'` fuera del catálogo D04. **Resuelto** con la corrección de datos de la migración. Evidencia: `SELECT estado, count(*) … GROUP BY 1` → `ACTIVA=6, ACTIVO=38` antes; `ACTIVO=44` después.
- **H50** (Medio) — `vincularCliente` escribía `estado_vinculacion='PENDIENTE'` fuera de D10, y los E2E usaban `'ACTIVA'`/`'SUSPENDIDO'`. **Resuelto** alineando código, specs y fixtures. Evidencia: unitario y E2E ahora esperan `PENDIENTE_APROBACION`; migración `cliente_barberias_estado_vinculacion_check`.

Ambos quedan registrados en [AUDITORIA_HALLAZGOS.md](AUDITORIA_HALLAZGOS.md).

## 9. PENDIENTE O NO VERIFICADO

- **No hice `push` ni `merge`** (pedido explícito). Los cambios están **sin commitear** en la rama.
- **`main` local** quedó en `99ce004` por el fast-forward; `origin/main` sigue en `cf8fb8c`. Si el PR de E2-04 no está realmente fusionado, conviene fusionarlo antes que esta rama.
- **`excepciones_horario_barbero.tipo`** recibió `CHECK` por decisión propia (punto 4 de §7); si se prefiere ceñirse literalmente al punto 2 del backlog, basta quitar esa constraint.
- **`reservas.completada_at`** se añade pero todavía **nadie la escribe**: el flujo de atención (que la fijaría) es de una tarea posterior.
- El catálogo de `notificaciones.estado` incluye `FALLIDO`, valor que el código aún no escribe (los reintentos de BullMQ no lo persisten). Es preventivo.

## 10. git status / git log

```
$ git status --short
 M prisma/schema.prisma
 M src/barberia/application/barberia.service.spec.ts
 M src/barberia/application/barberia.service.ts
 M test/barberia.e2e-spec.ts
 M test/e1-06-cross-tenant-admin.e2e-spec.ts
 M test/e3-03-validaciones.e2e-spec.ts
 M test/hallazgo16-rolesguard-global.e2e-spec.ts
 M test/permisos-matriz.e2e-spec.ts
 M ../frontend-barberias/src/app/core/services/tenant.service.ts
?? prisma/migrations/20261011130000_e203_integridad_base/
?? test/e2-03-integridad-base.e2e-spec.ts

$ git log -1 --oneline
99ce004 fix(time): integra luxon y resuelve zona horaria H36 (E2-04)

$ git log --oneline -5
99ce004 fix(time): integra luxon y resuelve zona horaria H36 (E2-04)
cf8fb8c Merge pull request #46 from Codecore-J/fix/maquina-estados-reserva
ef94a5e fix(reservas): implementa maquina de estados estricta (E2-02)
d6f4875 Merge pull request #45 from Codecore-J/feat/e3-08-cancelacion-especial-propuesta
9f4a4a6 feat(reservas): cancelacion especial y propuestas de horario (E3-08)
```

No hagas merge. Espera aprobación.
