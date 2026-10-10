```
TAREA: E3-05 — Expiración automática, jobs idempotentes y cancelación manual
RAMA: feat/e3-05-expiracion-cancelacion
```

## 0. Punto de partida

- `main` local estaba **por detrás** de `origin/main` (faltaba el merge del PR #42 de E3-04). `git pull --ff-only` lo puso al día: `96469ef Merge pull request #42 from Codecore-J/feat/e3-04-aceptar-rechazar`. `git status --short` limpio antes de crear la rama.
- Base de tests declarada por el dueño: **271 unitarios**. Medida antes de tocar nada:
  `Test Files 30 passed (30) · Tests 271 passed (271)` · `EXIT=0`.

## 1. QUÉ HICE (5 líneas máximo)

1. Unifiqué el nombre real de la cola (`reservas-pendientes`) y del job (`expirar-reserva`) en `queue.constants.ts` y cableé productor, consumidor y `registerQueue` a esa única fuente. El archivo declaraba `queue:reservas` / `job:expirar-reserva`, valores que BullMQ **rechaza** por contener `:`, y nadie lo importaba.
2. Extraje la decisión a `ExpiracionReservaService`: expira solo si la reserva sigue en `PENDIENTE`/`PROPUESTA_PENDIENTE` **y** `expira_at <= ahora`, con `updateMany` condicionado (idempotente por construcción), auditoría en la misma transacción y notificación best-effort.
3. El `ReservaProcessor` ahora solo reconoce su job por las constantes y delega; ignora sin reintento cualquier job desconocido o sin `reservaId`.
4. Añadí la reconciliación de arranque (`OnApplicationBootstrap`): expira las vencidas y reencola con `delay` restante las vigentes que se quedaron sin job.
5. Añadí `POST /barberias/:barberiaId/reservas/:id/cancelar` (CLIENTE dueño, ADMIN_BARBERIA, ADMINISTRADOR) con validación de pertenencia en el servicio, `→ CANCELADA`, cancelación del job y auditoría `RESERVA_CANCELADA`.

## 2. ARCHIVOS TOCADOS (`git diff --stat`, literal)

```
 AUDITORIA_HALLAZGOS.md                             |  37 ++++++
 .../src/reserva/application/reserva.processor.ts   |  54 +++++---
 .../reserva/application/reserva.service.spec.ts    | 129 +++++++++++++++++-
 .../src/reserva/application/reserva.service.ts     | 145 +++++++++++++++++----
 .../reserva/infrastructure/reserva.controller.ts   |  18 +++
 .../src/reserva/infrastructure/reserva.module.ts   |  10 +-
 .../src/shared/queues/queue.constants.ts           |  57 ++++++--
 backend-barberias/test/permisos-matriz.spec.ts     |  18 ++-
 docs/MATRIZ_RUTAS.md                               |  14 ++
 9 files changed, 419 insertions(+), 63 deletions(-)
```

Sin trackear (nuevos): `expiracion-reserva.service.ts`, `expiracion-reserva.service.spec.ts`,
`reserva.processor.spec.ts`, `queue.constants.spec.ts`, `test/e3-05-expiracion-cancelacion.e2e-spec.ts`.

## 3. TEST ROJO (antes del fix, salida literal)

Los tests se escribieron primero y se midieron contra `HEAD` (`96469ef`) con un `git stash` temporal
de la implementación (`git stash push -u` de los 6 archivos de `src/`, conservando los specs):

```
$ npx vitest run --config ./vitest.config.ts <los 5 archivos>
⎯⎯⎯⎯⎯⎯ Failed Suites 2 ⎯⎯⎯⎯⎯⎯

 FAIL  src/reserva/application/expiracion-reserva.service.spec.ts
Error: Cannot find module './expiracion-reserva.service.js' imported from .../expiracion-reserva.service.spec.ts

 FAIL  src/reserva/application/reserva.processor.spec.ts
Error: Cannot find module './expiracion-reserva.service.js' imported from .../reserva.processor.spec.ts

⎯⎯⎯⎯⎯⎯ Failed Tests 13 ⎯⎯⎯⎯⎯⎯

 FAIL  test/permisos-matriz.spec.ts > descubrir las 59 rutas del servidor y todas tienen decision
AssertionError: expected 58 to be 59 // Object.is equality

 FAIL  test/permisos-matriz.spec.ts > RolesGuard concede a cada rol exactamente lo que dice la matriz
AssertionError: expected 232 to be 236 // Object.is equality

 FAIL  src/reserva/application/reserva.service.spec.ts > E3-04 ... > el job de expiración se encola con un jobId determinista (E3-04 §4)
AssertionError: expected "vi.fn()" to be called with arguments: [ 'expirar-reserva', { …(2) }, …(1) ]

 FAIL  src/reserva/application/reserva.service.spec.ts > E3-05 cancelación manual > VERDE: el CLIENTE dueño cancela su PENDIENTE → CANCELADA, audita y borra el job
 FAIL  src/reserva/application/reserva.service.spec.ts > E3-05 cancelación manual > ROJO: un CLIENTE no puede cancelar la reserva de OTRO cliente → 403 RESERVA_AJENA
 FAIL  src/reserva/application/reserva.service.spec.ts > E3-05 cancelación manual > ROJO: cancelar una reserva ya terminal → 409 ESTADO_INVALIDO
 FAIL  src/reserva/application/reserva.service.spec.ts > E3-05 cancelación manual > ROJO: sin rol en esa barbería → 403 antes de tocar la reserva
 FAIL  src/reserva/application/reserva.service.spec.ts > E3-05 cancelación manual > VERDE: el staff de la sede cancela una CONFIRMADA y la auditoría lo marca como STAFF
TypeError: service.cancelarReserva is not a function

 FAIL  src/shared/queues/queue.constants.spec.ts > ningún nombre de cola contiene ":" (BullMQ lanza "Queue name cannot contain :")
AssertionError: expected 'QUEUES.RESERVAS=queue:reservas contie…' to be '' // Object.is equality

 FAIL  src/shared/queues/queue.constants.spec.ts > ningún nombre de job ni jobId determinista contiene ":"
AssertionError: expected 'JOBS.EXPIRAR_RESERVA=job:expirar-rese…' to be '' // Object.is equality

 FAIL  src/shared/queues/queue.constants.spec.ts > los valores son los nombres REALES que viajan por Redis (renombrarlos huérfana jobs)
AssertionError: expected 'queue:reservas' to be 'reservas-pendientes' // Object.is equality

 FAIL  src/shared/queues/queue.constants.spec.ts > el consumidor declara exactamente la misma cola que la constante
AssertionError: expected 'reservas-pendientes' to be 'queue:reservas' // Object.is equality

 Test Files  5 failed (5)
      Tests  13 failed | 22 passed (35)
EXIT=1
```

Lectura del ROJO: la ruta de cancelación no existía (58 vs 59 rutas, 232 vs 236 decisiones), la
constante de cola era inutilizable (`queue:reservas` contiene `:`), el consumidor real no coincidía con
la constante declarada, y `cancelarReserva` no existía en el servicio.

## 4. TEST VERDE (después, salida literal)

```
$ npx vitest run --config ./vitest.config.ts
 ✓ test/route-security.spec.ts (1 test) 386ms

 Test Files  33 passed (33)
      Tests  294 passed (294)
   Start at  21:01:03
   Duration  10.15s
EXIT=0
```

Desglose de lo nuevo (23 casos): `queue.constants.spec.ts` 5 · `reserva.processor.spec.ts` 3 ·
`expiracion-reserva.service.spec.ts` 10 · describe `E3-05 cancelación manual` de
`reserva.service.spec.ts` 5.

```
$ npm run lint
Found 46 warnings and 0 errors.
Finished in 827ms on 153 files with 111 rules using 16 threads.
LINT_EXIT=0
```

```
$ npx tsc --noEmit -p tsconfig.json
TSC_EXIT=2   (22 errores, los MISMOS preexistentes de la rama; ninguno en los archivos de E3-05)
```

## 5. SUITE COMPLETA: `npm run test` (el comando que exige la skill)

```
$ npm run test
 Test Files  33 passed (33)
      Tests  294 passed (294)
   Duration  10.74s
EXIT=0
```

(`npm run test` es `vitest run` con `vitest.config.ts`; el mismo resultado se obtuvo invocando
`npx vitest run --config ./vitest.config.ts` de forma explícita.)

De 271 a 294: **+23 casos, 0 fallos, 0 saltados**.

## 6. CRITERIOS DE ACEPTACIÓN

Del pedido del dueño:

- [x] **Fase 1 — deuda de constantes resuelta.** `queue.constants.ts` es la única fuente: el productor
      (`reserva.service.ts`), el consumidor (`@Processor(QUEUES.RESERVAS)`) y el `registerQueue` del módulo
      leen de ahí. Evidencia: `expected 'queue:reservas' to be 'reservas-pendientes'` en ROJO →
      `queue.constants.spec.ts` 5/5 en VERDE, incluido «el consumidor declara exactamente la misma cola que
      la constante» (lee la metadata `bullmq:processor_metadata` del processor real).
- [x] **Fase 2 — worker de expiración.** Transición con `updateMany` condicionado a estado y a
      `expira_at <= ahora`; auditoría `RESERVA_EXPIRADA` en la misma transacción.
      Evidencia: `expiracion-reserva.service.spec.ts` (10 casos) en verde.
- [x] **Fase 2 — cancelación manual.** `POST /barberias/:barberiaId/reservas/:id/cancelar` con
      `@Roles('CLIENTE', 'ADMIN_BARBERIA', 'ADMINISTRADOR')`, pertenencia validada en el servicio,
      cancelación del job y auditoría `RESERVA_CANCELADA`.
      Evidencia: 5 casos del describe `E3-05 cancelación manual` + fila 44e de `docs/MATRIZ_RUTAS.md` +
      `test/permisos-matriz.spec.ts` (59 rutas × 4 roles = 236).
- [x] **Fase 3 — suite unitaria completa.** 294/294, `EXIT=0`, partiendo de los 271 declarados.
- [x] **Test ROJO antes del fix.** 13 fallos con la implementación en `HEAD` (sección 3).
- [x] **Reporte con la plantilla 8.4.** Este documento.
- [x] **Sin push y sin merge.** Todo queda en la rama local; `git log -1` sigue siendo `96469ef`.

Del backlog §E3-05:

- [x] `jobId` determinístico `expirar-reserva-<uuid>` (D33). **Evidencia:** `queue.constants.spec.ts` y el
      caso `VERDE: … cancela su solicitud … se borra el job de expiración` del E2E.
- [x] El processor es idempotente: expira solo si sigue en `PENDIENTE`/`PROPUESTA_PENDIENTE` **y**
      `expira_at <= ahora`.
- [x] Cancelar el job (`remove`) al aceptar, rechazar y cancelar.
- [x] Reconciliación al arrancar (`OnApplicationBootstrap`): expira vencidas y reencola vigentes sin job.
- [x] Al expirar: estado `EXPIRADA`, libera el espacio (la disponibilidad se calcula; deja de contar la
      reserva), notifica al cliente y audita.
- [ ] **Borrar la información adicional** al expirar/rechazar/cancelar: **NO EJECUTABLE**, no existe esa
      columna ni tabla en el esquema. Registrado como **H32**.
- [x] **«Ejecutar el processor dos veces no cambia nada»** — unitario:
      `expiracion-reserva.service.spec.ts > VERDE: ejecutar la expiración dos veces no cambia nada` (el
      segundo intento devuelve `NO_APLICA` y no hay segunda auditoría ni segunda notificación).
      E2E escrito (`VERDE: una reserva vencida pasa a EXPIRADA, se audita y el job es idempotente`) pero
      **no ejecutado aquí** (ver sección 9).
- [x] **«Una reserva vencida durante una caída se expira al reiniciar»** — unitario:
      `reconciliar (arranque) > VERDE: expira las vencidas y reencola las vigentes SIN job, con el delay
      restante`. E2E escrito pero **no ejecutado aquí**.

## 7. DECISIONES O DESVIACIONES

1. **Estados: `EXPIRADA` y `CANCELADA`, no `CANCELADA_SISTEMA`/`CANCELADA_CLIENTE`.** Consulté al dueño
   antes de escribir nada y eligió esta opción. Motivo: el backlog §E3-05 punto 5 dice «Al expirar: estado
   `EXPIRADA`», el processor ya escribía `EXPIRADA`, y `pago.service.ts:136` y
   `notificacion.processor.ts:44` tratan `['CANCELADA','NO_ASISTIO','EXPIRADA']` como terminales: con
   nombres nuevos, un pago o una notificación podían colarse en una reserva ya muerta. Quién canceló se
   distingue en `auditoria.contexto.canceladoPor` (`'CLIENTE'`/`'STAFF'`), no en el estado.
2. **No se renombra ninguna cola.** Los valores de `QUEUES` se alinearon a la realidad
   (`reservas-pendientes`, `notificaciones`, `auditoria-purga`, `agenda-bloqueos`) en vez de forzar el
   `queue:*` del archivo: `queue:reservas` es imposible (BullMQ lo rechaza en el constructor) y renombrar
   la cola real habría dejado huérfanos los jobs pendientes en Redis.
3. **Nombre de rama.** Pedido: `feat/e3-05-expiracion-cancelacion` (el backlog proponía
   `fix/expiracion-idempotente`). Se usó el que pidió el dueño.
4. **Payload del job ampliado** con `barberiaId` (`{ reservaId, barberiaId }`), que es lo que declara
   `ExpirarReservaJobPayload`. Consecuencia inevitable: había que actualizar la aserción de
   `reserva.service.spec.ts:491`, que esperaba `{ reservaId }`; es parte del ROJO de la sección 3.
5. **`PROPUESTA_PENDIENTE` entra en `ESTADOS_EXPIRABLES`** aunque `propuestas_horario` (E3-06) todavía no
   exista: el backlog §E3-05 punto 2 lo exige explícitamente y no cuesta nada tenerlo listo.
6. **`POST /reservas/:id/cancelar` admite tres roles en la ruta**, aunque a un CLIENTE solo le valga su
   propia reserva. El `RolesGuard` no puede ver la reserva (solo mira rol y `barberiaId`), así que declarar
   `@Roles('CLIENTE')` a secas habría dejado a la sede sin poder cancelar por mostrador; la restricción
   real vive en el servicio (`403 RESERVA_AJENA`), igual que en `obtenerDetalleReserva` (HALLAZGO-14).
7. **Sin migración.** No se creó ninguna: el cambio de estado y la auditoría usan columnas existentes. Las
   columnas de cancelación (`cancelado_por`, D17) son de E3-07 (ver H33).
8. **La ventana de 30 minutos del cliente (§5.7) NO se implementó**: es E3-07. Aquí un CLIENTE puede
   cancelar su reserva en cualquier momento mientras siga vigente.

## 8. HALLAZGOS NUEVOS

Registrados en `AUDITORIA_HALLAZGOS.md` (IDs libres desde H30):

| ID | Título | Severidad | Estado |
|---|---|---|---|
| **H31** | Constantes de cola y job imposibles de cumplir, y sin usar | Media | **Resuelto en E3-05** |
| **H32** | El esquema no tiene `informacion_adicional`, que el backlog manda borrar | Baja | Abierto |
| **H33** | No hay forma de registrar quién canceló ni el flujo de cancelación especial (D17) | Baja | Abierto (E3-07) |
| **H34** | Comentarios corruptos en `src/iam/domain/roles.ts` (líneas 75 y 107) | Informativa | Abierto |

H31 es el que justifica la Fase 1: BullMQ rechaza en el constructor cualquier nombre de cola con `:`
(`node_modules/bullmq/dist/cjs/classes/queue-base.js`) y cualquier `jobId` propio con `:`
(`classes/job.js`), así que `QUEUES.RESERVAS = 'queue:reservas'` no era una convención pendiente de cablear
sino un valor que habría hecho caer el arranque.

## 9. PENDIENTE O NO VERIFICADO

1. **El E2E no se ejecutó.** `test/e3-05-expiracion-cancelacion.e2e-spec.ts` está escrito (9 casos) y
   **carga y compila** bajo su configuración: `npx vitest run --config ./vitest.config.e2e.ts
   test/e3-05-expiracion-cancelacion.e2e-spec.ts -t "NO_EXISTE_ESTE_TEST"` → `1 skipped (1)` /
   `9 skipped (9)` / `EXIT=0`. Pero ejecutarlo de verdad es imposible en esta máquina: **no hay Redis**
   (nada escuchando en 6379/6380, demonio de Docker apagado y WSL solo con la distro `docker-desktop` sin
   `bash`), y el módulo registra la cola real, así que `app.init()` no llega a término. Acordado con el
   dueño: el rojo→verde del E2E queda para CI al hacer push.
2. **Neon sí responde** (`TCP connect OK`), así que el bloqueo es exclusivamente Redis.
3. **Casos del E2E sin ejecutar** (todos escritos): expiración y liberación del horario, idempotencia del
   processor, reconciliación, 403 `RESERVA_AJENA`, 403 de sede ajena, cancelación del dueño con borrado del
   job, 409 al cancelar dos veces y cancelación de una CONFIRMADA por el admin.
4. **No se documentó `reporte-e3-04.md`/H31-cruzado**: el reporte de E3-04 ya nombraba esta deuda como
   `HALLAZGO-E304-01`, pero no estaba en `AUDITORIA_HALLAZGOS.md`. Ahora es H31.
5. **Sin commit.** Nada se ha añadido al índice ni se ha commiteado: el árbol queda con los cambios de
   trabajo y el dueño decide el mensaje.

## 10. `git status --short` / `git log -1 --oneline` / `git log --oneline -5`

```
 M AUDITORIA_HALLAZGOS.md
 M backend-barberias/src/reserva/application/reserva.processor.ts
 M backend-barberias/src/reserva/application/reserva.service.spec.ts
 M backend-barberias/src/reserva/application/reserva.service.ts
 M backend-barberias/src/reserva/infrastructure/reserva.controller.ts
 M backend-barberias/src/reserva/infrastructure/reserva.module.ts
 M backend-barberias/src/shared/queues/queue.constants.ts
 M backend-barberias/test/permisos-matriz.spec.ts
 M docs/MATRIZ_RUTAS.md
?? backend-barberias/src/reserva/application/expiracion-reserva.service.spec.ts
?? backend-barberias/src/reserva/application/expiracion-reserva.service.ts
?? backend-barberias/src/reserva/application/reserva.processor.spec.ts
?? backend-barberias/src/shared/queues/queue.constants.spec.ts
?? backend-barberias/test/e3-05-expiracion-cancelacion.e2e-spec.ts

96469ef Merge pull request #42 from Codecore-J/feat/e3-04-aceptar-rechazar

96469ef Merge pull request #42 from Codecore-J/feat/e3-04-aceptar-rechazar
f8e01a1 fix(e2e): horarios de fixture con diaSemana 1..7 (domingo incluido)
50a8655 fix(reservas): la cotizacion D44 respeta los minutos de horaFin
b43f480 docs: agrega reporte final de E3-04
ddca690 fix(reservas): permite rol CLIENTE en endpoint cotizar
```

No hagas merge. Espera aprobación.
