# TAREA: E3-06 · Reprogramación de reservas + E3-07 · Reglas de cancelación del CLIENTE

**RAMA:** `feat/e3-06-07-reprogramacion-reglas` (desde `main` = `c90b55a`, merge del PR #43 de E3-05)

---

## 1. QUÉ HICE (5 líneas máximo)

1. **E3-07:** el `CLIENTE` solo puede cancelar una cita **ya agendada** hasta 30 minutos antes del inicio;
   pasado el límite responde **422 `FUERA_DE_VENTANA`**. Una solicitud todavía `PENDIENTE` se cancela
   siempre y el staff no tiene ventana.
2. **E3-06:** nuevo `PATCH /barberias/:barberiaId/reservas/:id/reprogramar`
   (`ADMIN_BARBERIA`, `ADMINISTRADOR`) que valida el bloque nuevo (estado, configuración, horizonte,
   duración frente a los servicios congelados y disponibilidad bajo `FOR UPDATE`) y mueve la cita sin
   tocar estado, snapshots ni total.
3. La reprogramación **libera el bloque viejo y toma el nuevo en una sola escritura** (la ocupación es la
   propia fila de `reservas`), y revalida con `excluirReservaId` para no bloquearse a sí misma.
4. Reparé la **deuda de migraciones**: la BD de desarrollo estaba 2 migraciones por detrás y con la
   primera en estado fallido (P3018); ahora `migrate status` dice `Database schema is up to date!`.
5. Tests: **+13 unitarios** (294 → 307) y un **E2E nuevo de 9 casos** que corre contra la BD/Redis reales,
   medido ROJO → VERDE. Sin `push` ni `merge`.

---

## 2. ARCHIVOS TOCADOS (`git diff --stat`, literal)

```
 AUDITORIA_HALLAZGOS.md                             |  33 ++
 .../reserva/application/reserva.service.spec.ts    | 334 ++++++++++++++++++++-
 .../src/reserva/application/reserva.service.ts     | 266 ++++++++++++++++
 .../reserva/infrastructure/reserva.controller.ts   |  22 ++
 backend-barberias/test/permisos-matriz.spec.ts     |  19 +-
 docs/MATRIZ_RUTAS.md                               |  21 +-
 6 files changed, 687 insertions(+), 8 deletions(-)
```

Dos archivos **nuevos** (no aparecen en `git diff --stat` porque están sin trackear):

| Archivo | Líneas | Qué es |
|---|---|---|
| `backend-barberias/src/reserva/application/dto/reprogramar-reserva.dto.ts` | 28 | DTO del bloque nuevo (`fecha`, `horaInicio`, `horaFin`). No expone servicios ni precio: reprogramar no cambia lo pactado |
| `backend-barberias/test/e3-06-07-reprogramacion-reglas.e2e-spec.ts` | 475 | Los 9 casos E2E de E3-06 y E3-07 |

---

## 3. TEST ROJO (antes del fix, salida literal)

Se midió **con los tests finales** y el código de producción en `HEAD`, sacando la implementación con un
`git stash` temporal (mismo método que E3-05). El stash NO incluye los tests: eso es lo que hace válida la
medición.

### 3.1 Suite unitaria

```
$ APP_ENV=dev npx vitest run --config ./vitest.config.ts
 Test Files  2 failed | 31 passed (33)
      Tests  11 failed | 296 passed (307)
EXIT=1
```

Los 11 fallos son exactamente los nuevos:

```
× ROJO: a 29 minutos → 422 FUERA_DE_VENTANA y la reserva no se toca
× ROJO: una CONFIRMADA que ya empezó → 422 FUERA_DE_VENTANA
× VERDE: mueve la cita al bloque nuevo, excluye su propio hueco y audita el cambio
× ROJO: colisión con otro hueco ocupado → 409 CONFLICTO_HORARIO y la cita no se mueve
× ROJO: con la sede en pausa no se aceptan cambios de horario → 422 RESERVAS_PAUSADAS
× ROJO: fuera del horizonte de la sede → 422 FUERA_DE_HORIZONTE
× ROJO: un bloque más corto que los servicios congelados → 400
× ROJO: una reserva inexistente en esa sede → 404
× ROJO: una reserva terminal → 409 ESTADO_INVALIDO
× descubrir las 60 rutas del servidor y todas tienen decision
  → AssertionError: expected 59 to be 60
× RolesGuard concede a cada rol exactamente lo que dice la matriz
  → MATRIZ ROL × RUTA (59 rutas × 4 roles = 236 decisiones) · expected 236 to be 240
```

**Los 3 casos `VERDE:` de la ventana (31 min, `PENDIENTE`, staff) ya pasaban en ROJO**, y es lo correcto:
sin la barrera *toda* cancelación se permite, así que su valor es el de guardia de regresión (que la
ventana no cierre de más), no el de rojo. El rojo lo llevan los dos `ROJO:` de 29 min y “ya empezó”.

### 3.2 E2E (`test/e3-06-07-reprogramacion-reglas.e2e-spec.ts`)

```
$ APP_ENV=dev npx vitest run --config ./vitest.config.e2e.ts --testTimeout=30000 \
    test/e3-06-07-reprogramacion-reglas.e2e-spec.ts
 Test Files  1 failed (1)
      Tests  6 failed | 3 passed (9)
EXIT=1
```

Causa literal de los fallos de E3-06 y de la barrera:

```
AssertionError: {"message":"Cannot PATCH /api/v1/barberias/…/reservas/…/reprogramar",
"error":"Not Found","statusCode":404}: expected 404 to be 200 // Object.is equality
…
AssertionError: {…,"estado":"CANCELADA",…,"horaInicio":"1970-01-01T22:09:00.000Z",…}: expected 201 to be 422
```

Es decir: la ruta no existía (404) y a 29 minutos del inicio la cancelación del `CLIENTE` **sí** se
ejecutaba (201 en vez del 422 que exige el §5.7).

---

## 4. TEST VERDE (después, salida literal)

### 4.1 Suite unitaria

```
$ APP_ENV=dev npx vitest run --config ./vitest.config.ts
 Test Files  33 passed (33)
      Tests  307 passed (307)
EXIT=0
```

**294 → 307 (+13).** Reparto de los nuevos: 6 de E3-07 (ventana) y 7 de E3-06 (reprogramación).

Dos controles de comportamiento importantes, con su aserción literal:

- La ventana se mide **exacta** con reloj falso (`vi.setSystemTime`): a las 11:29 de una cita de las 12:00
  (31 min) cancela; a las 11:30 (30 min justos) **también** cancela —el límite del backlog es
  `ahora ≤ inicio − 30`—; a las 11:31 (29 min) → `response: { codigo: 'FUERA_DE_VENTANA', statusCode: 422 }`.
- La reprogramación escribe **solo** el cuándo:
  `expect(reserva.update).toHaveBeenCalledWith({ where: { id: 'uuid-reserva' }, data: { fechaCita, horaInicio, horaFin } })`
  y la auditoría guarda `horaAnterior: '09:00-09:30'` / `horaNueva: '10:00-10:30'`, con la transacción
  como segundo argumento (`registrarEvento(…, expect.anything())`).

### 4.2 E2E

```
$ APP_ENV=dev npx vitest run --config ./vitest.config.e2e.ts --testTimeout=30000 \
    test/e3-06-07-reprogramacion-reglas.e2e-spec.ts
 ✓ test/e3-06-07-reprogramacion-reglas.e2e-spec.ts (9 tests) 45515ms
     ✓ VERDE: el admin de la sede mueve la cita, audita el cambio y libera el bloque viejo  7576ms
     ✓ ROJO: chocar con otro bloque ocupado → 409 CONFLICTO_HORARIO y la cita no se mueve  6675ms
     ✓ ROJO: un admin de otra sede no puede reprogramar (403 del guard)  2832ms
     ✓ ROJO: un CLIENTE no reprograma por su cuenta (403 del guard)  2669ms
     ✓ ROJO: reprogramar una reserva ya cancelada → 409 ESTADO_INVALIDO  3947ms
     ✓ ROJO: a 29 minutos del inicio el CLIENTE recibe 422 FUERA_DE_VENTANA  3545ms
     ✓ VERDE: a 31 minutos del inicio el CLIENTE sí cancela  3578ms
     ✓ VERDE: el STAFF no tiene ventana — cancela a 5 minutos del inicio  3569ms
     ✓ VERDE: una solicitud PENDIENTE se cancela siempre, aunque falten 5 minutos  2141ms
 Test Files  1 passed (1)
      Tests  9 passed (9)
EXIT=0
```

> **Nota de entorno:** `--testTimeout=30000` no es cosmético. Con el default de 5 s la MISMA ejecución da
> `Tests 6 failed (9)` con duraciones de `5005`/`5012`/`5015` ms: son timeouts contra una BD remota, no
> fallos de negocio (H38).

### 4.3 Estado de la BD tras la reparación de migraciones

```
$ npx prisma migrate status
Database schema is up to date!
$ npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script
-- This is an empty migration.
```

---

## 5. SUITE COMPLETA: `npm run test` (resumen literal)

```
$ npm run test
 Test Files  33 passed (33)
      Tests  307 passed (307)
EXIT=0
```

Complementarios:

| Comando | Salida literal | ¿Bloquea? |
|---|---|---|
| `npm run lint` (oxlint) | `Found 46 warnings and 0 errors.` / `Finished in 738ms on 155 files with 111 rules using 16 threads.` | No: **mismo recuento que la base** (46 en E3-05). Los dos warnings de `reserva.service.ts` y `reserva.service.spec.ts` son preexistentes (`CotizacionResponse` sin usar y el parámetro `options` del mock) |
| `npx tsc --noEmit -p tsconfig.json` | `22` errores, **idénticos a los preexistentes** y **ninguno** en los archivos de esta rama | No: el repo ya venía con 22 |
| `test/permisos-matriz.spec.ts` | `=== MATRIZ ROL × RUTA (60 rutas × 4 roles = 240 decisiones) ===` | Sí: pasa |

---

## 6. CRITERIOS DE ACEPTACIÓN

### Lo pedido en el encargo

- [x] **`CLIENTE` + faltan < 30 minutos → 422.** Unitario con reloj falso (29 min → 422 `FUERA_DE_VENTANA`)
      y E2E real (`colocarCita(reservaId, 29)` → 422, reserva sigue `CONFIRMADA`, 0 auditorías).
- [x] **31 min → se cancela** (unitario y E2E: 201, `estado: 'CANCELADA'`, 1 auditoría
      `RESERVA_CANCELADA`). **Borde exacto de 30 minutos** verificado en el unitario.
- [x] **El staff no tiene ventana** (unitario y E2E: cancela a 5 minutos del inicio). Y una **`PENDIENTE`
      se cancela siempre** (§5.7), también a 5 minutos.
- [x] **`PATCH /barberias/:barberiaId/reservas/:id/reprogramar`** con la lógica transaccional:
      `withSerializableTransaction` + `SELECT … FOR UPDATE` sobre la barbería, validación del horario nuevo
      (estado → configuración/pausa → horizonte → duración frente a los servicios **congelados** →
      disponibilidad), liberación del bloque actual y toma del nuevo, y auditoría `RESERVA_REPROGRAMADA`
      **dentro** de la misma transacción.
- [x] **Colisión de reprogramación:** E2E y unitario → 409 `CONFLICTO_HORARIO`, la cita conserva su horario
      y no hay auditoría nueva.
- [x] **Reprogramación exitosa:** E2E → 200, la fila queda con la fecha/hora nuevas, el estado sigue
      `CONFIRMADA`, el `totalPagar` no cambia, hay 1 auditoría y **el bloque viejo vuelve a ser reservable**
      (otro cliente crea ahí y recibe 201).
- [x] **Suite unitaria completa desde la base de 294:** 307 en verde con `EXIT=0`.
- [x] **Reporte con la plantilla 8.4** (este documento).
- [x] **Sin `push` ni `merge`** (sección 10).

### Del backlog (§E3-07 puntos 1-5)

- [x] `PENDIENTE` siempre; `CONFIRMADA` solo hasta 30 minutos antes → `CANCELADA`.
- [x] 422 `FUERA_DE_VENTANA` pasado el límite.
- [x] “Un cliente no puede cancelar reservas ajenas” sigue vigente (403 `RESERVA_AJENA`): era de E3-05 y su
      caso sigue verde en esta rama.
- [x] “La cancelación del cliente no cuenta como no presentado”: el `update` de la cancelación lleva
      **solo** `{ estado: 'CANCELADA' }` (lo afirma el unitario), así que no toca contadores ni
      `estaRestringido`.
- [x] “Cancela jobs”: el job de expiración se borra (`jobId` determinista `expirar-reserva-<uuid>`); el
      recordatorio no se borra pero **se descarta al dispararse** si la reserva dejó de estar activa
      (`notificacion.processor.ts`: `['CANCELADA','NO_ASISTO','EXPIRADA']` → `SKIPPED / RESERVA_INACTIVA`).
- [ ] **“Borra la información adicional”** — H32/RD-1: la columna no existe. No es ejecutable y no se
      declara cumplido.
- [ ] **Migración D17** (`cancelado_por`, `cancelacion_especial_estado`, `cancelacion_especial_motivo`,
      `configuracion_barberia.permite_cancelacion_especial`) y la **cancelación especial** — H33/RD-2:
      siguen pendientes; de ahí que el 422 invite a “contacta con la barbería”.
- [ ] **“Dispara oportunidad de espacio (E4-04)”** — RD-3: E4-04 no existe.

---

## 7. DECISIONES O DESVIACIONES

- **RD-4 · El `CLIENTE` no reprograma; se lo deja al staff.** No lo dijo el encargo y el backlog tampoco lo
  pide: el §5.4 da al cliente la **propuesta** con ventana de 10 minutos para aceptar o rechazar, no un
  `PATCH` libre. Programé la ruta con `@Roles(ADMIN_BARBERIA, ADMINISTRADOR)` (fila 44f de la matriz y
  prueba E2E de que un CLIENTE recibe 403). **Si quieres que el cliente mueva su propia cita, hay que
  decidirlo explícitamente**: implica ventana, revalidación y auditoría propias.
- **RD-5 · `PATCH /…/reprogramar` no es la tarea E3-06 del backlog.** El backlog pide
  `propuestas_horario` (D18) + `POST .../proponer` / `propuesta/aceptar` / `propuesta/rechazar`. Lo
  entregado es lo que pediste (un endpoint de reprogramación transaccional) y **la propuesta queda
  abierta** (H35).
- **RD-6 · La ventana se ancla al DÍA ETIQUETADO, no al instante.** `fecha_cita` es `DATE` y `hora_inicio`
  es `TIME`: dos rótulos sin zona. Compuse el instante leyendo el día por sus partes UTC y montando la hora
  en la zona del **servidor** (`instanteInicioCita`). Es a propósito: la composición que usa
  `aceptarReserva` (`new Date(fecha); setHours(...)`) cae al día anterior cuando el servidor está al oeste
  de UTC, y ese corrimiento *allí* se cancela solo porque los dos lados de la comparación se construyen
  igual; aquí se compara contra `Date.now()`, así que un día de menos cerraría la cancelación de una cita
  de mañana. **En el servidor de producción (UTC) el resultado coincide con el de `aceptarReserva`.**
  Queda como H36: la versión exacta quiere `barberias.zona_horaria` + `tiempo.service` (E2-04/D15).
- **RD-7 · El estado destino de la cancelación sigue siendo `CANCELADA`** (no `CANCELADA_CLIENTE`), como
  decidiste en E3-05: es el valor que `pago.service` y `notificacion.processor` ya reconocen.
- **RD-8 · La reprogramación no reencola el job de expiración.** Su `delay` sale de `expira_at`, que no
  cambia, y su `jobId` es determinista, así que es el mismo job; reencolarlo sería un no-op. Documentado en
  el JSDoc del método.
- **RD-9 · “Un bloque más corto que los servicios congelados” sigue lanzando `BadRequestException` (400)
  sin campo `codigo`**, igual que en `crearReserva`: el catálogo §6 no tiene código para esa regla y no
  inventé uno. Es la misma deuda que E3-03 dejó anotada.
- **RD-10 · Toqué la BD de desarrollo con tu aprobación explícita** (`migrate deploy`) para poder ejecutar
  el E2E. Ver H37 para lo que apareció.

---

## 8. HALLAZGOS NUEVOS

Registrados en [AUDITORIA_HALLAZGOS.md](AUDITORIA_HALLAZGOS.md) con su evidencia:

| ID | Qué | Severidad | Estado |
|---|---|---|---|
| **H35** | La reprogramación entregada **no es** la propuesta de horario del backlog: faltan `propuestas_horario`, `proponer`, `propuesta/aceptar`, `propuesta/rechazar` (y `PROPUESTA_PENDIENTE` sigue sin productor) | Media | Abierto (E3-06 del backlog) |
| **H36** | La ventana de 30 min **no usa la zona de la barbería** (no hay `luxon`, `tiempo.service` ni `zona_horaria`). Con la sede en UTC-4 y el servidor en UTC la barrera cierra ~4 h tarde | Media | Abierto (E2-04) |
| **H37** | La BD de desarrollo estaba **desincronizada del ledger**: `margen_grupal_minutos` existía sin registro de la migración y **sin su CHECK** (0 filas en `pg_constraint`); la migración quedó fallida (P3018 / SQLSTATE 42701) y bloqueaba la de E3-04. Impedía ejecutar cualquier E2E (P2022 → 500) | Media | **Reconciliado** el 2026-10-09 con tu aprobación: añadido el CHECK del propio `migration.sql`, `migrate resolve --applied` y `migrate deploy` |
| **H38** | Los E2E no tienen `testTimeout` y el default de 5 s no alcanza contra una BD remota: fallos que parecen de negocio y son timeouts | Baja | Abierto (E2-06 ya lo pide) |
| **H39** | El recordatorio no se puede **borrar** al cancelar: `programarRecordatorio` lo encola sin `jobId` (el id lo pone BullMQ). Hoy no pasa nada porque el processor lo descarta si la reserva no está activa, pero el job queda en Redis | Informativa | Abierto |

---

## 9. PENDIENTE O NO VERIFICADO

Como hechos, no como deseos:

1. **La propuesta de horario del backlog (H35) no está implementada.** No hay tabla, ni rutas, ni los
   `tipo`/`estado` de D18.
2. **La cancelación especial (E3-07 §3) y la migración D17 (H33) no están implementadas.** Un cliente
   fuera de ventana recibe 422 con el texto que lo invita a llamar a la sede, pero no existe
   `POST .../cancelacion-especial`.
3. **La zona horaria de la sede (H36/E2-04).** La ventana es correcta para el servidor en UTC; con sedes en
   otra zona la barrera se desplaza hasta que exista `tiempo.service`.
4. **“Borra la información adicional” (H32)** sigue sin ser ejecutable: la columna no existe.
5. **Oportunidad de espacio (E4-04)**: no existe; la cancelación no la dispara.
6. **El borde exacto de 30 minutos se verifica solo en el unitario** (reloj falso). En el E2E los casos son
   29 y 31 minutos, separados por un minuto real para no depender del segundo en que corre el test.
7. **Solo se ejecutó MI archivo E2E**, no la suite E2E completa. Además, las migraciones aplicadas hoy
   (H37) son la primera vez que esta BD puede ejecutar los E2E de E3-03/E3-04/E3-05: ese reaprovechamiento
   queda sin medir.
8. **El E2E necesita `--testTimeout=30000`** (H38). Sin ese flag, los fallos por timeout son
   indistinguibles de los de negocio.
9. **No hice `push` ni `merge`**, así que CI todavía no ha ejecutado nada de esta rama.

---

## 10. GIT

```
$ git status --short
 M AUDITORIA_HALLAZGOS.md
 M backend-barberias/src/reserva/application/reserva.service.spec.ts
 M backend-barberias/src/reserva/application/reserva.service.ts
 M backend-barberias/src/reserva/infrastructure/reserva.controller.ts
 M backend-barberias/test/permisos-matriz.spec.ts
 M docs/MATRIZ_RUTAS.md
?? backend-barberias/src/reserva/application/dto/reprogramar-reserva.dto.ts
?? backend-barberias/test/e3-06-07-reprogramacion-reglas.e2e-spec.ts

$ git log --oneline -3
c90b55a Merge pull request #43 from Codecore-J/feat/e3-05-expiracion-cancelacion
0402fb0 feat(reservas): worker de expiracion, cancelacion manual y fix BullMQ (E3-05)
96469ef Merge pull request #42 from Codecore-J/feat/e3-04-aceptar-rechazar

$ git log -1 --oneline
c90b55a Merge pull request #43 from Codecore-J/feat/e3-05-expiracion-cancelacion
```

La rama está **sin commits propios**: todo el trabajo está en el árbol de trabajo, a la espera de tu
aprobación. **No hice merge.**
