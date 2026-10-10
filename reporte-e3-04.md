TAREA: E3-04 — Aceptar y rechazar solicitudes
RAMA: feat/e3-04-aceptar-rechazar (creada desde `origin/feat/e3-03-validaciones`, por decisión del dueño)

> **Nota de base (leer primero).** La instrucción de la Fase 1 asumía que el PR de
> `feat/e3-03-validaciones` ya estaba fusionado en `main`. **No lo está.** La salida literal:
>
> ```
> $ git ls-remote origin refs/heads/main refs/heads/feat/e3-03-validaciones
> 5927e15a7b437129d3851c9a3acd8c25874b5ee1   refs/heads/feat/e3-03-validaciones
> edcceda1aab312362eb88c2bd5a73cd1e0940979   refs/heads/main
> $ git merge-base --is-ancestor 5927e15 origin/main   # → NO es ancestro
> $ git log --oneline origin/main..origin/feat/e3-03-validaciones
> 5927e15 ci: parche de ECR public para bases de datos
> e477826 test(e2e): corrige fixtures E3-03, implementa contrato D40 y genera reporte
> 49eb25b feat(reserva): endpoint cotizar D44 y fix E2E
> ```
>
> `main` está en `edcceda` (PR #40, `feat/reservas-split-cliente-walkin`) y la rama de
> validaciones sigue viva, 3 commits por delante, sin fusionar. Como E3-04 **depende de E3-03**
> y necesita el contrato D40 (`src/shared/errors/d40.errors.ts`, que solo existe en esa rama),
> el dueño aprobó crear la rama **desde `origin/feat/e3-03-validaciones`** en lugar de desde
> `main`. `main` sí quedó sincronizado (`git pull` fast-forward `5f754a7..edcceda`).

---

1. QUÉ HICE (5 líneas máximo)

1. Migración `20261009000000_e304_motivos_reserva`: `reservas.motivo_codigo` (VARCHAR(40)) y `reservas.motivo_detalle` (TEXT), con dos `CHECK` que replican el catálogo §5.5.
2. Contrato D40: helper `errorDeConflicto()` (409 `{statusCode, codigo, mensaje}`) y `RechazarReservaDto` con el catálogo de rechazo y la regla de `OTRO`.
3. `POST /barberias/:barberiaId/reservas/:id/aceptar` y `.../:id/rechazar` con `@Roles(ADMIN_BARBERIA, ADMINISTRADOR)`.
4. `ReservaService.aceptarReserva` (PENDIENTE→CONFIRMADA, `FOR UPDATE`, revalidación de disponibilidad, 409 `SOLICITUD_EXPIRADA`) y `rechazarReserva` (PENDIENTE→RECHAZADA con motivo).
5. Efectos secundarios: `jobId` determinista + cancelación del job de expiración, auditoría `RESERVA_CONFIRMADA`/`RESERVA_RECHAZADA` en la misma transacción y notificación al cliente.

---

2. ARCHIVOS TOCADOS (`git diff --stat`, literal)

```
$ git diff --stat
 backend-barberias/prisma/schema.prisma             |   4 +
 .../agenda/application/disponibilidad.service.ts   |  11 +-
 .../reserva/application/reserva.service.spec.ts    | 226 +++++++++++++++
 .../src/reserva/application/reserva.service.ts     | 308 ++++++++++++++++++++-
 .../reserva/infrastructure/reserva.controller.ts   |  34 +++
 .../src/reserva/infrastructure/reserva.module.ts   |   3 +
 backend-barberias/src/shared/errors/d40.errors.ts  |   9 +
 backend-barberias/test/permisos-matriz.spec.ts     |  17 +-
 docs/MATRIZ_RUTAS.md                               |  15 +
 9 files changed, 619 insertions(+), 8 deletions(-)
```

Ficheros **nuevos** (aún sin trackear; hay que añadirlos explícitamente):

```
$ git status --short
?? prisma/migrations/20261009000000_e304_motivos_reserva/
?? src/reserva/application/dto/rechazar-reserva.dto.ts
?? test/e3-04-aceptar-rechazar.e2e-spec.ts
```

---

3. TEST ROJO (antes del fix, salida literal)

Capturado apartando temporalmente el código fuente con `git stash` (dejando las pruebas nuevas en su sitio)
y volviendo a correrlas. El stash se restauró después (`git stash list` queda vacío).

**Unitario — `npx vitest run --config ./vitest.config.ts src/reserva/application/reserva.service.spec.ts`**

```
-     "jobId": "expirar-reserva-uuid-reserva",
+   {
+     "delay": 600000,
    },
  ]

Number of calls: 1

 ❯ src/reserva/application/reserva.service.spec.ts:489:29

 Test Files  1 failed (1)
      Tests  10 failed | 12 passed (22)
   Start at  18:23:13
   Duration  2.95s
UNIT_EXIT=1
```

Los 10 fallos son exactamente los 10 casos E3-04 nuevos; los 12 que pasan son los preexistentes del spec.

**E2E — `npx vitest run --config ./vitest.config.e2e.ts test/e3-04-aceptar-rechazar.e2e-spec.ts`**

```
     × ROJO: aceptar una solicitud expirada → 409 SOLICITUD_EXPIRADA 204ms
     × ROJO: un admin de otra barbería recibe 403 al aceptar 115ms
     × ROJO: un CLIENTE no puede aceptar su propia solicitud (403) 140ms
     × ROJO: aceptar una reserva que ya no está PENDIENTE → 409 ESTADO_INVALIDO 138ms
     × ROJO: rechazar sin motivo → 400 112ms
     × ROJO: rechazar con un motivo fuera del catálogo §5.5 → 400 103ms
     × ROJO: OTRO sin detalle suficiente → 400 (§5.5 exige 5 caracteres) 102ms
     × ROJO: un admin de otra barbería recibe 403 al rechazar 103ms
     × CONTROL: aceptar PENDIENTE → CONFIRMADA, audita y cancela el job de expiración 159ms
     × CONTROL: rechazar con OTRO → RECHAZADA con motivo persistido, audita y cancela el job 151ms
     × CONTROL: rechazar libera el hueco (§5.3) y otra reserva entra en él 99ms
     ✓ CONTROL: el CHECK de la migración rechaza un motivo fuera del catálogo 101ms
     ✓ CONTROL: el CHECK exige detalle de 5 caracteres cuando el código es OTRO 99ms
⎯⎯⎯⎯⎯⎯ Failed Tests 11 ⎯⎯⎯⎯⎯⎯⎯
FAIL ... > ROJO: aceptar una solicitud expirada → 409 SOLICITUD_EXPIRADA
AssertionError: {"message":"Cannot POST /api/v1/barberias/.../reservas/.../aceptar","error":"Not Found","statusCode":404}: expected 404 to be 409

 Test Files  1 failed (1)
      Tests  11 failed | 2 passed (13)
E2E_EXIT=1
```

Los 2 que pasan en rojo son los del `CHECK`: prueban la **base de datos**, no el código, y la migración ya
estaba aplicada. Es correcto que pasen antes del fix.

---

4. TEST VERDE (después, salida literal)

```
$ APP_ENV=dev npx vitest run --config ./vitest.config.ts
 Test Files  30 passed (30)
      Tests  271 passed (271)
   Start at  18:26:39
   Duration  8.34s (transform 5.70s, setup 0ms, import 59.62s, tests 18.27s, environment 11ms)
UNIT_EXIT=0
```

```
$ APP_ENV=dev DATABASE_URL=<postgres local> npx vitest run --config ./vitest.config.e2e.ts \
    test/e3-04-aceptar-rechazar.e2e-spec.ts
 ✓ test/e3-04-aceptar-rechazar.e2e-spec.ts (13 tests) 3692ms
     ✓ CONTROL: aceptar PENDIENTE → CONFIRMADA, audita y cancela el job de expiración  355ms
     ✓ CONTROL: rechazar con OTRO → RECHAZADA con motivo persistido, audita y cancela el job  365ms
     ✓ CONTROL: rechazar libera el hueco (§5.3) y otra reserva entra en él  376ms
 Test Files  1 passed (1)
      Tests  13 passed (13)
E2E_EXIT=0
```

**Entorno de ejecución del E2E (no es `staging`).** Neon sigue inalcanzable desde esta máquina
(el `SELECT 1` agota 60 s sin responder). Para poder verificar de verdad levanté un **PostgreSQL 16
efímero en Docker** y apliqué ahí la cadena de migraciones completa:

```
$ docker images postgres
postgres:15
postgres:16
$ docker run -d --name barberias_pg_e304 -e POSTGRES_PASSWORD=*** -e POSTGRES_USER=e304 \
    -e POSTGRES_DB=neondb -p 55432:5432 postgres:16
$ DATABASE_URL='postgresql://e304:***@localhost:55432/neondb?schema=public' npx prisma migrate deploy
Applying migration `20260916223855_init`
Applying migration `20260929184500_add_unique_partial_index_cliente_barberia_activa`
Applying migration `20261001000000_fix_missing_tables`
Applying migration `20261002000000_add_margen_grupal_minutos`
Applying migration `20261009000000_e304_motivos_reserva`
All migrations have been successfully applied.
MIGRATE_EXIT=0
```

El contenedor sigue arriba para que puedas repetir el E2E; se retira con
`docker rm -f barberias_pg_e304`.

---

5. SUITE COMPLETA: `npm run test` (resumen literal)

`npm run test` ejecuta `vitest run`, que es la misma configuración que usé
(`--config ./vitest.config.ts`). Resumen literal de la corrida sobre el árbol final:

```
 Test Files  30 passed (30)
      Tests  271 passed (271)
```

**271 = 261 de la línea base + 10 casos E3-04 nuevos.** La línea base de 261 estaba en `main`
(`30 files / 261 tests`, `EXIT=0`) y sigue intacta: ninguna prueba preexistente se debilitó.
Aparte, esta rama arrastra los tests de E3-03 (también 261 en su base).

---

6. CRITERIOS DE ACEPTACIÓN

Del backlog E3-04:

- [x] **Aceptar una reserva expirada → 409 `SOLICITUD_EXPIRADA`.**
  - E2E: `ROJO: aceptar una solicitud expirada → 409 SOLICITUD_EXPIRADA` (asserta status 409, `body.codigo === 'SOLICITUD_EXPIRADA'` y que la reserva sigue `PENDIENTE` en BD).
  - Unitario: `ROJO: aceptar una solicitud expirada → 409 SOLICITUD_EXPIRADA` (`rejects.toMatchObject({ response: { codigo: 'SOLICITUD_EXPIRADA', statusCode: 409 } })`) y comprueba que **no** hubo `reserva.update`.
- [x] **Rechazar sin motivo → 400.**
  - E2E: `ROJO: rechazar sin motivo → 400` (`400`), más `ROJO: rechazar con un motivo fuera del catálogo §5.5 → 400` y `ROJO: OTRO sin detalle suficiente → 400`.
  - Unitario: `ROJO: rechazar sin motivo → 400 MOTIVO_INVALIDO`, `... código fuera del catálogo → 400`, `... OTRO y detalle corto → 400`. La regla vive en el servicio, no solo en el DTO.
- [x] **Un admin de otra barbería recibe 403.**
  - E2E: `ROJO: un admin de otra barbería recibe 403 al aceptar` y `... al rechazar` (además verifican que la reserva sigue `PENDIENTE` y sin motivo).
  - Extra: `ROJO: un CLIENTE no puede aceptar su propia solicitud (403)`.
  - Estructural: `test/permisos-matriz.spec.ts` incluye las dos rutas en `POLITICA_DECLARADA` con `[ADMIN_BARBERIA, ADMINISTRADOR]`.

De la instrucción de la Fase 2:

- [x] **Migración `motivo_codigo` / `motivo_detalle`.** `prisma migrate deploy` aplica
  `20261009000000_e304_motivos_reserva` sin error (`MIGRATE_EXIT=0`). Los dos `CHECK` del catálogo
  §5.5 se verifican contra la base real en dos casos E2E (`CONTROL: el CHECK ... rechaza un motivo
  fuera del catálogo` y `... exige detalle de 5 caracteres cuando el código es OTRO`), ambos en verde.
- [x] **Transición `PENDIENTE → CONFIRMADA`.** `CONTROL: aceptar PENDIENTE → CONFIRMADA` (status 201,
  `body.estado === 'CONFIRMADA'` y fila en BD en `CONFIRMADA`). Estado inválido → 409
  `ESTADO_INVALIDO` (`ROJO: aceptar una reserva que ya no está PENDIENTE`).
- [x] **Revalidación de disponibilidad bajo bloqueo `FOR UPDATE`.** El servicio toma
  `SELECT id FROM "barberias" WHERE id = $1::uuid FOR UPDATE` **antes** de revalidar, igual que
  `crearReserva`. Caso de conflicto: unitario `ROJO: aceptar sin hueco disponible → 409 CONFLICTO_HORARIO`
  (sin slots disponibles, y sin llegar a escribir).
- [x] **`motivo_codigo` obligatorio del catálogo de §5.5.** `RechazarReservaDto` + `validarMotivoRechazo`
  en el servicio; catálogo único en TS replicado en el `CHECK` de SQL.
- [x] **Transición `PENDIENTE → RECHAZADA`, libera el espacio.** `CONTROL: rechazar libera el hueco (§5.3)
  y otra reserva entra en él`: se rechaza la de las 19:00 y otra reserva entra en ese mismo hueco (201).
- [x] **Cancelar el job de expiración de BullMQ.** `CONTROL: aceptar ... cancela el job de expiración`
  comprueba `colaReservas.getJob('expirar-reserva-<id>')` **antes** (existe) y **después** (falso); el
  mismo control en `CONTROL: rechazar con OTRO ...`.
- [x] **Auditoría `RESERVA_CONFIRMADA` / `RESERVA_RECHAZADA`.** Los dos controles anteriores consultan
  `prisma.auditoria.findFirst({ accion, entidadId })` y exigen fila. Se registra **dentro** de la misma
  transacción que el cambio de estado.

---

7. DECISIONES O DESVIACIONES

1. **Base de la rama: `origin/feat/e3-03-validaciones`, no `main`.** Aprobado por el dueño tras el
   hallazgo de que el PR de validaciones no estaba fusionado. Motivo: E3-04 depende de E3-03 y el
   contrato D40 (409 con `codigo`) solo existe en esa rama.
2. **`jobId` determinista en el job de expiración.** Se añadió `jobId: 'expirar-reserva-<reservaId>'` al
   encolar en `crearReserva` (antes BullMQ generaba un id aleatorio). Sin esto, "cancelar el job" era
   **imposible**: no había forma de localizarlo. Efecto colateral positivo: reencolar la misma reserva no
   duplica el job (idempotencia, que es el objetivo de E3-05).
3. **`disponibilidad.service.ts`: nueva opción `excluirReservaId`.** La reserva sigue `PENDIENTE`
   mientras se revalida su propio hueco, así que sin excluirla se bloquearía a sí misma y **todo**
   aceptar legítimo daría 409. Cambio mínimo y aditivo: el parámetro es opcional y `crearReserva` no lo usa.
4. **`errorDeConflicto()` (409) en `d40.errors.ts`.** El fichero documentaba que 409 usa clases de Nest
   "para no perder el `instanceof`"; se mantiene esa regla y solo se añade el helper que inyecta
   `{statusCode, codigo, mensaje}`.
5. **Auditoría obligatoria, no `@Optional`.** `ReservaService` recibe `AuditoriaService` sin `@Optional`
   (a diferencia de `notificacionService`) para que un fallo de cableado explote al arrancar en lugar de
   saltarse la auditoría en silencio. `ReservaModule` importa `AuditoriaModule`.
6. **La notificación es best-effort; la cancelación del job también.** BullMQ y las notificaciones son
   sistemas aparte y no pueden tumbar una transición de estado ya confirmada. Además `ReservaProcessor`
   solo expira reservas en `PENDIENTE`, así que un job superviviente no puede mover una reserva que ya
   dejó de estar pendiente. Se registra `warn` si falla.
7. **Nombre de rama.** El backlog dice `Rama: feat/aceptar-rechazar`; seguí tu instrucción literal
   (`feat/e3-04-aceptar-rechazar`).
8. **`PATCH /reservas/:id/estado` no se toca.** Sigue existiendo el cambio de estado genérico: E3-04
   añade las dos rutas específicas, no retira la anterior (fuera de alcance).
9. **«No amplíes el alcance».** No implementé "borrar la información adicional" (§5) porque **no existe
   ninguna columna de información adicional** en `reservas`; ver Hallazgo E304-03.
10. **Qué catálogo apliqué al rechazo (léelo, es una interpretación).** Tu instrucción decía "`motivo_codigo`
   obligatorio en el body (basado en el catálogo de cancelaciones)". §5.5 tiene **dos** catálogos: el de
   *rechazo* (`HORARIO_NO_DISPONIBLE`, `SERVICIO_NO_DISPONIBLE`, `RESPONSABLE_AUSENTE`,
   `CLIENTE_RESTRINGIDO`, `OTRO`) y el de *cancelación por el admin* (`EMERGENCIA`, `ENFERMEDAD`,
   `CIERRE_IMPREVISTO`, `FUERZA_MAYOR`, `OTRO`). Como esta ruta es un **rechazo** y el backlog E3-04 pide
   "`motivo_codigo` obligatorio del catálogo 5.5", usé el catálogo de **rechazo**, que es el que exige el
   propio enunciado del backlog. El de cancelación llega con su ruta (`cancelar-admin`, E3-06) y **no** se
   admite en esta ruta ni en el `CHECK`: si querías el otro, dime y lo cambio (es un `CHECK`, una lista TS
   y un `@IsIn`).

---

8. HALLAZGOS NUEVOS

**HALLAZGO-E304-01 · Media · `jobId` de BullMQ no admite `:`**
El primer intento de `jobId` fue `expirar-reserva:<id>` y `POST /reservas` devolvió **500** con
`Error: Custom Id cannot contain :`. Lo detectó el propio E2E (13/13 en 500). Se corrigió a
`expirar-reserva-<id>`. Evidencia: `[Nest] ERROR [ExceptionsHandler] Error: Custom Id cannot contain :`
en la primera corrida.

**HALLAZGO-E304-02 · Media · `queue.constants.ts` no coincide con las colas reales**
`QUEUES.RESERVAS` vale `'queue:reservas'` y `JOBS.EXPIRAR_RESERVA` vale `'job:expirar-reserva'`, pero la
cola real es `'reservas-pendientes'` y el job real es `'expirar-reserva'` (literales repetidos en
`reserva.service.ts:48,325-326`, `reserva.module.ts:17` y `reserva.processor.ts:6,17`). Son constantes muertas que
invitan a cablear mal la cancelación. No las unifiqué para no cambiar el nombre de la cola en E3-04.

**HALLAZGO-E304-03 · Baja · «Borrar la información adicional» no es implementable**
§5 exige borrar la "información adicional" al pasar a `RECHAZADA`/`EXPIRADA`/`CANCELADA`, pero
`reservas` no tiene ninguna columna de ese tipo (`BACKLOG` §7 ya la listaba como regla ausente del
diseño). Sin campo no hay nada que borrar; queda anotado en `docs/MATRIZ_RUTAS.md`.

**HALLAZGO-E304-04 · Baja · La rejilla de slots (30 min) choca con el bloque real (duración + margen)**
`calcularDisponibilidad` avanza el cursor cada 30 min pero cada reserva ocupa `duración + margen`, así
que dos citas a 30 min de distancia se solapan y la segunda recibe 409. No es un bug del servicio
—`crearReserva` ya se comportaba así— pero es una restricción real que sorprende: lo viví al escribir
el E2E (3 pruebas fallaron con 409 hasta separar las citas una hora) y es lo que en la práctica limita
la agenda. Candidato a revisar en E3-05/E4.

**HALLAZGO-E304-05 · Alta (proceso) · El PR de `feat/e3-03-validaciones` no está fusionado**
`origin/main` está en `edcceda` y no contiene `49eb25b`/`e477826`/`5927e15`. Ver la nota de base arriba.

---

9. PENDIENTE O NO VERIFICADO

- **E2E verificado contra PostgreSQL 16 local (Docker), NO contra Neon ni `staging`.** Neon sigue
  inalcanzable desde esta máquina. Lo verificado es el comportamiento del código y las migraciones, no
  el entorno desplegado.
- **La migración NO se ha aplicado a Neon ni a `staging`.** Solo al Postgres local. Falta
  `prisma migrate deploy` en el entorno real.
- **CI: no ejecutado.** No hice push (no me lo has pedido). El parche de CI de E3-03 (`5927e15`) está en
  esta rama porque es su base.
- **No corrí la suite E2E completa**, solo el fichero nuevo de E3-04. Los demás `*.e2e-spec.ts` se
  escribieron para Neon y no los validé en este entorno.
- **`tsc --noEmit`: 22 errores, todos preexistentes.** Comprobado que **ninguno** está en los ficheros
  nuevos de E3-04 (`grep … | grep -E "e3-04|reserva.service.ts\(|d40.errors|rechazar-reserva|reserva.controller|reserva.module|disponibilidad.service.ts\("` → sin coincidencias). El proyecto valida con `vitest`, no con `tsc` limpio.
- **`PATCH /reservas/:id/estado` sigue sin validar transiciones** (asigna cualquier estado). Es el
  hallazgo del backlog para la tarea de la máquina de estados; E3-04 no lo toca.
- **No hice merge.** Espero tu aprobación.

---

10. `git status --short` / `git log -1 --oneline` / `git log --oneline -5`

(rutas normalizadas desde la raíz del repo; el último `??` es este informe, que no existía en la
primera captura)

```
$ git status --short
 M backend-barberias/prisma/schema.prisma
 M backend-barberias/src/agenda/application/disponibilidad.service.ts
 M backend-barberias/src/reserva/application/reserva.service.spec.ts
 M backend-barberias/src/reserva/application/reserva.service.ts
 M backend-barberias/src/reserva/infrastructure/reserva.controller.ts
 M backend-barberias/src/reserva/infrastructure/reserva.module.ts
 M backend-barberias/src/shared/errors/d40.errors.ts
 M backend-barberias/test/permisos-matriz.spec.ts
 M docs/MATRIZ_RUTAS.md
?? backend-barberias/prisma/migrations/20261009000000_e304_motivos_reserva/
?? backend-barberias/src/reserva/application/dto/rechazar-reserva.dto.ts
?? backend-barberias/test/e3-04-aceptar-rechazar.e2e-spec.ts
?? reporte-e3-04.md

$ git log -1 --oneline
5927e15 ci: parche de ECR public para bases de datos

$ git log --oneline -5
5927e15 ci: parche de ECR public para bases de datos
e477826 test(e2e): corrige fixtures E3-03, implementa contrato D40 y genera reporte
49eb25b feat(reserva): endpoint cotizar D44 y fix E2E
edcceda Merge pull request #40 from Codecore-J/feat/reservas-split-cliente-walkin
632a3a8 docs(matriz): documentar la partición de POST /reservas (E3-03) en matriz y backlog
```

No hagas merge. Espera aprobación.
