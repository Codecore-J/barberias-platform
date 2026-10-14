TAREA: P3 — Sprint de Estabilización · OLA 3 «Higiene» (higiene de código, E2-07, reconciliación documental y verificación final)
RAMA: chore/sprint-estabilizacion-p3 (creada desde `main`; el corte real es el cierre de la Ola 2, commit `6e1de4b`)
BASE: `main` local @ `7491c90`. La rama añade encima los commits de la Ola 1 (`02e6697`) y la Ola 2 (`6e1de4b`) — ver §7.1 y §9.
FECHA: 2026-10-13 / 2026-10-14
RESULTADO: **VERDE** — unitarios 47/47 archivos y 511/511 tests · E2E 27/27 archivos y 203/203 tests
(con Redis **local**, ver §3.b y §7.2) · lint 0 errores · build OK · `check:integridad` OK (12 migraciones
y 27 CHECK) · `prisma migrate status` → up to date.

---

## 1. QUÉ HICE (resumen)

1. **Preparación:** rama `chore/sprint-estabilizacion-p3` desde `main`, con `git status --short` limpio antes de tocar nada.
2. **Higiene de código:** eliminado el spec de borrador `test/e4-02-oportunidades.clean.e2e-spec.ts` y el `CreateReservaDto` duplicado y muerto de `cotizacion.dto.ts`; los dos guiones que no eran specs se movieron a `test/manual/` con sus tres referencias actualizadas; reparado H34 en `roles.ts`.
3. **E2-07 (no un borrado):** las 4 rutas `@Delete` **no estaban huérfanas**; se ejecutó el vocabulario completo del Spec 01 §9 (`desactivar`/`reactivar`/`liberar`) con migración, auditoría, frontend, matriz de rutas y E2E propios.
4. **Reconciliación documental:** `AUDITORIA_HALLAZGOS.md` marca RESUELTO H34, H47, H50, H52, H54, H57, H58 y H59; H56 y H60 quedan explícitamente ABIERTOS a decisión del dueño; se documentan H61 (nuevo, resuelto) y H62 (nuevo, abierto).
5. **Verificación:** suite unitaria completa, suite E2E completa, lint, build, `check:integridad` y `migrate status`, con las salidas literales en §5.

## 2. ARCHIVOS TOCADOS (`git diff --cached --stat`, literal, sin este informe)

```
 AUDITORIA_HALLAZGOS.md                             | 138 ++++++-
 backend-barberias/package.json                     |   2 +-
 .../20261013120000_e207_liberado_at/migration.sql  |  22 ++
 backend-barberias/prisma/schema.prisma             |   4 +
 .../src/agenda/application/agenda.service.spec.ts  |  74 ++++
 .../src/agenda/application/agenda.service.ts       |  58 ++-
 .../src/agenda/application/bloqueos.processor.ts   |  24 +-
 .../agenda/application/disponibilidad.service.ts   |   4 +-
 .../src/agenda/infrastructure/agenda.controller.ts |  30 +-
 .../src/agenda/infrastructure/agenda.module.ts     |   4 +
 .../barberia/application/barberia.service.spec.ts  |  46 ++-
 .../src/barberia/application/barberia.service.ts   |  40 +-
 .../application/dto/cambiar-estado-barberia.dto.ts |  16 +
 .../infrastructure/barberia.controller.spec.ts     |  22 +-
 .../barberia/infrastructure/barberia.controller.ts |  24 +-
 .../src/catalogo/application/combos.service.ts     |  31 +-
 .../catalogo/application/servicios.service.spec.ts | 119 ++++--
 .../src/catalogo/application/servicios.service.ts  | 121 ++++--
 .../catalogo/infrastructure/combos.controller.ts   |  23 +-
 .../infrastructure/servicios.controller.ts         |  31 +-
 backend-barberias/src/iam/domain/roles.ts          |   4 +-
 .../src/reserva/application/dto/cotizacion.dto.ts  |  49 +--
 .../test/e1-06-cross-tenant-admin.e2e-spec.ts      |  14 +-
 .../test/e2-07-vocabulario.e2e-spec.ts             | 411 +++++++++++++++++++++
 .../test/e4-02-oportunidades.clean.e2e-spec.ts     |  52 ---
 .../sec01-recovery.ts}                             |   6 +-
 .../test/{ => manual}/smoke-test-live.ts           |   0
 backend-barberias/test/permisos-matriz.e2e-spec.ts |  29 +-
 backend-barberias/test/permisos-matriz.spec.ts     |  32 +-
 backend-barberias/test/smoke-db-guard.spec.ts      |   2 +-
 .../test/vocabulario-sin-delete.spec.ts            |  98 +++++
 docs/BACKLOG_BARBERIAS_V1.md                       |  23 +-
 docs/MATRIZ_RUTAS.md                               |  14 +-
 docs/PLAN_ESTRATEGICO_ARQUITECTURA_Y_EJECUCION.md  |   2 +-
 .../src/app/core/services/horarios.service.ts      |   7 +-
 .../src/app/core/services/servicios.service.ts     |  25 +-
 36 files changed, 1338 insertions(+), 263 deletions(-)
```

Archivos NUEVOS (con su tamaño real):

```
 backend-barberias/prisma/migrations/20261013120000_e207_liberado_at/migration.sql   22 líneas
 backend-barberias/src/barberia/application/dto/cambiar-estado-barberia.dto.ts       16 líneas
 backend-barberias/test/e2-07-vocabulario.e2e-spec.ts                               411 líneas
 backend-barberias/test/vocabulario-sin-delete.spec.ts                               98 líneas
```

Archivos ELIMINADOS / MOVIDOS:

```
 backend-barberias/test/e4-02-oportunidades.clean.e2e-spec.ts   -52   (eliminado)
 backend-barberias/test/test-sec01-recovery.ts → test/manual/sec01-recovery.ts
 backend-barberias/test/smoke-test-live.ts     → test/manual/smoke-test-live.ts
```

| Archivo | Cambio |
|---|---|
| `test/e4-02-oportunidades.clean.e2e-spec.ts` | **Eliminado.** Era `it('flujo básico')` con `expect(true).toBe(true)`; el glob `**/*.e2e-spec.ts` lo ejecutaba e inflaba el conteo |
| `src/reserva/application/dto/cotizacion.dto.ts` | **Una sola clase.** Sobreviven los tipos `CotizacionResponse`/`BloqueCalculado`; se va `CreateReservaDto` (clase muerta) y el import de `class-validator` que sólo ella usaba |
| `src/catalogo/application/servicios.service.ts` · `combos.service.ts` | `desactivar`/`reactivar` con `422 SERVICIO_EN_USO`, `422 SERVICIO_EN_COMBO_ACTIVO` y combos idempotentes |
| `src/catalogo/infrastructure/servicios.controller.ts` · `combos.controller.ts` | `@Delete` → `PATCH .../desactivar` y `.../reactivar` |
| `src/agenda/application/agenda.service.ts` · `infrastructure/agenda.controller.ts` | `@Delete .../bloqueos/:id` → `POST .../bloqueos/:id/liberar` (fila conservada, `liberado_at`, audita en la misma transacción) |
| `src/agenda/application/bloqueos.processor.ts` · `disponibilidad.service.ts` | La disponibilidad y el job de liberación automática ignoran los bloqueos liberados |
| `src/barberia/infrastructure/barberia.controller.ts` (+ DTO y spec) | `@Delete /barberias/:id` → `PATCH /barberias/:id/estado` (suspender y reactivar en la misma operación) |
| `src/barberia/application/barberia.service.ts` | **H61:** `findPersonal` con `orderBy` determinista (`rol.nombre`, `usuario.correo`) |
| `src/iam/domain/roles.ts` | **H34:** comentarios corruptos reparados (`laractable`, `yailtersan`) |
| `prisma/schema.prisma` + migración `20261013120000_e207_liberado_at` | `bloqueos_agenda.liberado_at` con índice parcial de vigentes |
| `test/vocabulario-sin-delete.spec.ts` | Fija sobre el CÓDIGO FUENTE que `@Delete` en el backend es **0** y que los verbos nuevos siguen declarados |
| `test/e2-07-vocabulario.e2e-spec.ts` | Ciclo HTTP completo de las tres reglas de desactivación y de la liberación de bloqueos |
| `test/permisos-matriz.*` + `docs/MATRIZ_RUTAS.md` | 73 → **75** rutas × 4 roles = **300** decisiones, con las rutas nuevas documentadas |
| Frontend (`core/services/servicios.service.ts`, `horarios.service.ts`) | Migrados los dos consumidores de las rutas `@Delete` |

## 3. TEST ROJO (salida literal, antes del arreglo)

**3.a · H61 — orden no determinista en `GET /barberias/:id/personal`.** Detectado al correr la suite E2E
completa de esta ola; `findPersonal` no tenía `orderBy`, así que el listado salía en el orden FÍSICO de las
filas y la prueba que mira `body[0]` dependía de qué fila ocupara antes el hueco de página.

```
 FAIL  test/h19-h20-lecturas-abiertas.e2e-spec.ts > H19/H20 > GET /barberias/:barberiaId/personal
AssertionError: expected 'barbero.b.h19@test.com' to be 'admin.b.h19@test.com' // Object.is equality

 Test Files  1 failed | 26 passed (27)
      Tests  2 failed | 201 passed (203)
```

**3.b · La corrida E2E completa contra el Redis remoto (cuota agotada).** No es un fallo de código: es la
cuota mensual del plan de Upstash consumida, y con ella cae toda operación de cola y, con ella, el alta de
reserva (`expected 500 to be 201`). Los 9 archivos rojos son exactamente los que encolan.

```
 APP_ENV=dev npm run test:e2e

 Test Files  9 failed | 18 passed (27)
      Tests  61 failed | 142 passed (203)

SimpleError [ReplyError]: ERR max requests limit exceeded. Limit: 500000, Usage: 500001.
See https://upstash.com/docs/redis/troubleshooting/max_requests_limit for details
Error: read ECONNRESET   (errno: -4077)

AssertionError: expected 500 to be 201
 ❯ test/e3-03-validaciones.e2e-spec.ts:290:28
 ❯ test/e3-03-validaciones.e2e-spec.ts:310:24
 ❯ crearPendiente test/e3-04-aceptar-rechazar.e2e-spec.ts:273:7
```

## 4. TEST VERDE (salida literal, después del arreglo)

**4.a · H61.** La prueba no se tocó: se arregló la causa. `orderBy: [{ rol: { nombre: 'asc' } }, { usuario: { correo: 'asc' } }]`
(pasa de rojo a verde en las dos corridas, con Redis remoto y con Redis local).

```
 ✓ test/h19-h20-lecturas-abiertas.e2e-spec.ts (9 tests) 12907ms
```

**4.b · Suite E2E completa con el Redis de `docker-compose.yml`** (§7.2). Los 9 archivos que estaban en rojo
por la cuota pasan enteros:

```
 APP_ENV=dev REDIS_URL=redis://127.0.0.1:6379 npm run test:e2e

 ✓ test/e3-03-validaciones.e2e-spec.ts (11 tests) 48402ms
 ✓ test/e3-08-cancelacion-especial-propuesta.e2e-spec.ts (15 tests) 75765ms
 ✓ test/e3-04-aceptar-rechazar.e2e-spec.ts (13 tests) 37772ms
 ✓ test/e3-06-07-reprogramacion-reglas.e2e-spec.ts (9 tests) 46717ms
 ✓ test/e4-03-fidelizacion.e2e-spec.ts (6 tests) 25955ms
 ✓ test/e4-01-reserva-grupal.e2e-spec.ts (10 tests) 27188ms
 ✓ test/e3-05-expiracion-cancelacion.e2e-spec.ts (9 tests) 39831ms
 ✓ test/hallazgo14-idor-reserva.e2e-spec.ts (5 tests) 19294ms
 ✓ test/reserva-walkin-split.e2e-spec.ts (5 tests) 14802ms
```

## 5. SUITE COMPLETA (resúmenes literales)

**5.1 · Unitarios — `npm run test`**

```
 Test Files  47 passed (47)
      Tests  511 passed (511)
   Duration  37.19s (transform 13.21s, setup 0ms, import 404.07s, tests 56.22s)
```

*(P2 cerró en 46/500: +1 archivo —`vocabulario-sin-delete.spec.ts`— y +11 casos.)*

**5.2 · E2E — `APP_ENV=dev REDIS_URL=redis://127.0.0.1:6379 npm run test:e2e`**

```
 Test Files  27 passed (27)
      Tests  203 passed (203)
   Duration  703.79s (transform 2.35s, setup 340ms, import 66.04s, tests 628.04s, environment 5ms)
EXIT=0
```

*(P2 cerró en 27/199. El neto es +4 casos: +5 de `e2-07-vocabulario.e2e-spec.ts` y −1 del spec de borrador eliminado.)*

**5.3 · Lint, build, integridad y migraciones (los pasos que corre el CI)**

```
npm run lint             → Found 54 warnings and 0 errors.  Finished in 6.9s on 206 files.  EXIT=0
npm run build            → nest build                                                        EXIT=0
npm run check:integridad → [check:integridad] OK — 12 migraciones y 27 CHECK coinciden con el esquema «public».
npx prisma migrate status → 12 migrations found in prisma/migrations · Database schema is up to date!
```

## 6. CRITERIOS DE ACEPTACIÓN

**Fase 1 · Preparación**

- [x] Rama `chore/sprint-estabilizacion-p3` creada desde `main` (`git merge-base --is-ancestor main HEAD` → cierto). Evidencia: `git branch --show-current` → `chore/sprint-estabilizacion-p3`.
- [x] `git status --short` limpio antes de empezar.

**Fase 2 · Higiene**

- [x] `test/e4-02-oportunidades.clean.e2e-spec.ts` eliminado. Evidencia: `git diff --cached --stat` → `.../test/e4-02-oportunidades.clean.e2e-spec.ts | 52 ---`, y la suite sigue verde con 27 archivos.
- [x] `CreateReservaDto` duplicado y muerto eliminado. Evidencia: `cotizacion.dto.ts` pasa de 100 a 49 líneas; el único import vivo sigue siendo `./create-reserva.dto.ts` y los unitarios/E2E que cotizan pasan (`e4-01` 10/10, `e3-13` 20/20).
- [x] E2-07: `@Delete` en el backend = **0**, fijado por `test/vocabulario-sin-delete.spec.ts` (verde) y con las tres reglas nuevas cubiertas por `test/e2-07-vocabulario.e2e-spec.ts` (5/5 verde). **Desviación importante** respecto al encargo: las 4 rutas NO estaban huérfanas (§7.1).
- [x] Resto de archivos/duplicados revisados: los dos guiones que no eran specs se movieron a `test/manual/` con sus tres referencias actualizadas (la guardia de `smoke-db-guard.spec.ts` sigue ejecutándolos: verde). H34 reparado.

**Fase 3 · Reconciliación documental**

- [x] H50, H47, H57, H58, H52, H54 y H59 (más H34) tachados/marcados **RESUELTO** en sus fichas y en la tabla de la §3.1 de `AUDITORIA_HALLAZGOS.md`; H59 con su ficha ya tachada.
- [x] **H60** documentado formalmente como ABIERTO (autosuspensión del último administrador), con severidad, evidencia y remedio propuesto; **H56** queda igualmente listado como abierto.
- [x] Documentados además **H61** (nuevo, resuelto en esta ola) y **H62** (nuevo, abierto: §3.6).

**Fase 4 · Verificación y reporte**

- [x] Unitarios 47/47 y 511/511 (§5.1).
- [x] E2E 27/27 y 203/203 con `EXIT=0` (§5.2), con la causa del rojo anterior aislada y documentada (§3.b, H62).
- [x] lint 0 errores, build OK, `check:integridad` OK, `migrate status` up to date (§5.3).
- [x] Este informe 8.4.
- [x] Push de la rama, **sin merge**.

## 7. DECISIONES O DESVIACIONES (con motivo)

**7.1 · E2-07 completo en vez de borrar las 4 rutas `@Delete`.** El encargo decía «borrar las 4 rutas que
quedaron huérfanas». Comprobado antes de tocar nada, **no estaban huérfanas**: cada una llamaba a un método de
servicio vivo y las ejercitaban tests y el frontend. Borrarlas sin migrar a sus consumidores habría puesto en
rojo la matriz de permisos, tres E2E y el borrado de bloqueos de la pantalla de horarios. Se te avisó y se
ejecutó **E2-07 completo** (el vocabulario del Spec 01 §9). El resultado cumple el criterio del backlog
(`@Delete` = 0) sin romper consumidores.

**7.2 · El E2E se corrió contra el Redis LOCAL del repo, no contra el remoto.** Con tu aprobación expresa
(era la única forma de tener una corrida verde): `docker compose up -d redis` en la raíz y
`REDIS_URL=redis://127.0.0.1:6379` en el entorno de la corrida. **No se tocó `.env` ni una línea de código**;
sólo el entorno del proceso de pruebas. Los mismos 9 archivos que caían por la cuota pasan enteros. La causa
raíz queda como **H62** en la auditoría.

**7.3 · Los «specs huérfanos» no eran basura.** La guardia de `test/manual/smoke-test-live.ts` está probada por
`test/smoke-db-guard.spec.ts` (que ejecuta el script real como proceso hijo) y el smoke test se invoca con
`npm run test:smoke`; el de SEC-01 importa `dist/` y se ejecuta a mano. Se movieron a `test/manual/` para que
`test/` contenga sólo archivos que un runner ejecuta. **No se borró** nada que tuviera consumidores.

**7.4 · H61: se arregló la causa, no la prueba.** `findPersonal` devolvía `Array.from(map.values())` sobre un
`findMany` sin orden: el orden era el físico de las páginas de la tabla. Se añadió un `orderBy` estable con
sentido para la pantalla (primero el `ADMIN_BARBERIA` de la sede, luego por correo) y la aserción existente
pasa a ser correcta sin editarla.

**7.5 · La numeración de rutas.** La matriz pasa de 73 a 75 rutas (300 decisiones de rol), no a menos: E2-07
sustituye cada `@Delete` por dos verbos nuevos (`desactivar` y `reactivar`), y la liberación de bloqueos es
una ruta distinta del borrado.

**7.6 · Lo que se dejó sin tocar a propósito.** H29/P3.6 (lockfiles por proyecto): el CI usa el de la raíz y
borrarlos no es inocuo. E2-08 (`docs/MATRIZ_CUMPLIMIENTO.md`): sigue sin existir. H48, H44, H43, H41/H42, H32,
H55, H51 y H53: siguen como estaban (ninguna es de higiene). Frontend: sólo la migración de los dos
consumidores de las rutas `@Delete`, sin cambios de negocio.

## 8. HALLAZGOS NUEVOS

| ID | Título | Severidad | Estado |
|---|---|---|---|
| **H61** | `GET /barberias/:id/personal` devolvía el personal en orden no determinista (listado sin `orderBy`) | Baja | ✅ **RESUELTO** en esta ola |
| **H62** | La suite E2E dependía de un Redis remoto con cuota mensual; agotada la cuota, 9 archivos (61 casos) caen con 500 en el alta de reserva. Y: `POST .../reservas` responde 500 cuando el `enqueue` del job de expiración falla | Media | ⬜ **ABIERTO** — a decisión del dueño (medido y documentado, sin tocar código) |

Remedio propuesto para H62: fijar en el README/CI que el E2E se corre contra el Redis de `docker-compose.yml`
(local, sin cuota); decidir el contrato del alta de reserva cuando la cola no está disponible (500 actual,
503 con reintento, o confirmar sin job y reconciliar al arrancar como ya hace `ExpiracionReservaService`); y,
si Upstash se queda en el runtime, separar su cuota de la de las pruebas.

## 9. PENDIENTE O NO VERIFICADO

1. **H62 sigue abierto.** La suite se verificó verde con Redis **local**; contra el Redis remoto seguirá roja
   mientras la cuota de Upstash esté agotada. No se reintentó contra el remoto y no se decidió todavía el
   contrato del alta de reserva con la cola caída.
2. **H60 y H56 abiertos** por decisión del dueño (autosuspensión / último administrador; y la zona horaria
   literal del CHECK de `barberias`).
3. **Base de la rama.** `origin/main` sigue en `b3af077` (PR #56) incluso después de `git fetch origin`, y el
   `main` local está en `7491c90`: **ninguno de los dos contiene los commits de la Ola 1 (`02e6697`) ni de la
   Ola 2 (`6e1de4b`)**, que sólo viven en las ramas. La rama P3 se apila sobre `6e1de4b`, tal como se acordó.
   Si el merge del «PR global» ya ocurrió en tu entorno, **comprueba que ese commit es ancestro de tu `main`
   antes de abrir el PR**, o el diff incluirá las dos olas anteriores. No reescribí historia ni rebasé nada.
4. **H29 / P3.6** (lockfiles por proyecto) intacto; **E2-08** sin crear.
5. El spec de SEC-01 (`test/manual/sec01-recovery.ts`) y el smoke test contra un entorno vivo **no** se
   ejecutaron en esta ola: se movieron y siguen ahí como guiones manuales.

## 10. `git status --short` / `git log -1 --oneline` / `git log --oneline -5`

```
$ git status --short
?? reporte-sprint-p3.md

$ git log -1 --oneline
432c372 chore(estabilizacion): higiene de P3, vocabulario de E2-07 y auditoría al día

$ git log --oneline -5
432c372 chore(estabilizacion): higiene de P3, vocabulario de E2-07 y auditoría al día
6e1de4b feat(estabilizacion): cierra las brechas de negocio de la Ola 2 (H52, H54, D09/D24, H58)
02e6697 fix(estabilizacion): alinea el esquema con dev y cierra H47 y los minutos fantasma
7491c90 docs(estabilizacion): plan de ataque del sprint Camino B
b3af077 Merge pull request #56 from Codecore-J/feat/fidelizacion-restricciones
```

El commit de higiene (`432c372`) se cerró **antes** de escribir este informe; el informe viaja en el commit
siguiente de la misma rama. La rama queda empujada **sin merge** y el merge a `main` es tuyo. **No se hizo
merge ni PR.**
