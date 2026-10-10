> Plantilla 8.4 de `docs/BACKLOG_BARBERIAS_V1.md`. Sin `push` ni `merge`: la rama espera aprobación.

```
TAREA: E2-04 — Zona horaria de la barbería
RAMA: fix/h22-zona-horaria (desde main = cf8fb8c, tras merge del PR de E2-02)
HALLAZGO: H36
```

## 1. QUÉ HICE

Instalé `luxon` (D15) y creé `src/shared/time/tiempo.service.ts`: un `TiempoService` con `ahora()` sobre un **reloj inyectable** (token `RELOJ`; en pruebas se sustituye por uno fijo) y los métodos `diaSemana(fechaIso, tz)`, `aInstante(fecha, hora, tz)`, `desdeInstante(instante, tz)`, más los atajos `fechaLocal`, `sumarDias` y `fechaDeCalendario` y dos helpers puros de etiqueta (`fechaCalendarioISO`, `horaRelojHHMM`) que leen las partes UTC de un `DATE`/`TIME` de Prisma. El servicio se registra y exporta desde `SharedModule` (global).

Añadí `barberias.zona_horaria VARCHAR(50) NOT NULL DEFAULT 'America/Santo_Domingo'` (columna que E2-03 dejará con su CHECK) con la migración `20261011120000_e204_zona_horaria`, aplicada a `dev` con `migrate deploy` y sincronizada en `schema.prisma`. La zona **siempre** se lee de esa columna.

Refactoricé los cuatro servicios del enunciado al reloj central. Lo medular:

- **`disponibilidad.service`**: `fecha.getDay()` → `tiempo.diaSemana(fechaIso, tz)`; el `mergeDateAndTime` que usaba `setHours` del SERVIDOR → `tiempo.aInstante` en la zona de la sede. La jornada, las excepciones, los bloqueos y las reservas se componen como **instantes reales**, de modo que la comparación con `Date.now()` (ventanas) es exacta. `fecha` acepta la etiqueta `YYYY-MM-DD` y, si falta, se resuelve «hoy» en la zona de la sede.
- **`reserva.service`**: el instante de la cita (`instanteInicioCita`), la ventana de 30 min de §5.7, el bloque solicitado en crear/reprogramar/validar propuesta, el horizonte de reserva («hoy» de la sede), `expira_at` de solicitud y propuesta, y el `programarRecordatorio` pasan por el reloj central. `fechaISO`/`horaHHMM` dejan de usar `toISOString().slice/split`.
- **`horario.service`** y **`agenda.service`**: las fechas de excepción/bloqueo son etiquetas `DATE` y se construyen con `tiempo.fechaDeCalendario` en vez de `new Date(dto.fecha)`.

Además eliminé el resto de usos de `toISOString().slice/split` **sobre fechas de cita** en `src/`: `expiracion-reserva.service` (mensaje de expiración), `catalogo/servicios.service` (texto de servicios bloqueados) y el default de `GET /reservas/agenda` del controller (ahora lo resuelve el servicio con la zona de la sede). Las etiquetas DATE/TIME se leen por sus partes UTC.

## 2. ARCHIVOS TOCADOS (`git diff --stat`, literal)

```
 AUDITORIA_HALLAZGOS.md                             |   4 +-
 backend-barberias/package.json                     |   5 +
 backend-barberias/prisma/schema.prisma             |   5 +
 .../src/agenda/application/agenda.service.ts       |   8 +-
 .../application/disponibilidad.service.spec.ts     |   4 +
 .../agenda/application/disponibilidad.service.ts   | 127 +++++++---
 .../src/agenda/infrastructure/agenda.controller.ts |   7 +-
 .../src/catalogo/application/servicios.service.ts  |   8 +-
 .../src/horario/application/horario.service.ts     |  15 +-
 .../application/notificacion.service.ts            |  28 ++-
 .../application/expiracion-reserva.service.ts      |  12 +-
 .../src/reserva/application/reserva-e308.spec.ts   |  19 +-
 .../reserva/application/reserva.service.spec.ts    | 115 ++++++---
 .../src/reserva/application/reserva.service.ts     | 279 +++++++++++----------
 .../reserva/infrastructure/reserva.controller.ts   |   5 +-
 backend-barberias/src/shared/shared.module.ts      |  12 +-
 package-lock.json                                  | 120 +++++++--
 17 files changed, 522 insertions(+), 251 deletions(-)
```

**Nuevos (sin seguimiento todavía):**

- `backend-barberias/prisma/migrations/20261011120000_e204_zona_horaria/migration.sql`
- `backend-barberias/src/shared/time/tiempo.service.ts` (232 líneas) y `tiempo.service.spec.ts` (14 pruebas)
- `backend-barberias/src/agenda/application/disponibilidad-zona.spec.ts` (3 pruebas)
- `backend-barberias/src/reserva/application/reserva.service.spec.ts` → +1 prueba H36

## 3. TEST ROJO (antes del fix, salida literal)

**ROJO A · la prueba H36 contra el código VIEJO de `instanteInicioCita` con `TZ=UTC`** (composición con la zona del servidor, restaurada temporalmente para medir):

```
 FAIL  src/reserva/application/reserva.service.spec.ts > ReservaService > E3-07 ventana de cancelación del CLIENTE > H36: la ventana de una cita a las 21:00 locales se mide contra la SEDE, no contra el servidor
UnprocessableEntityException: Unprocessable Entity Exception
 ❯ reglaDeNegocio src/shared/errors/d40.errors.ts:43:10
 ❯ ReservaService.exigirVentanaDeCancelacion src/reserva/application/reserva.service.ts:1235:11
 ❯ src/reserva/application/reserva.service.ts:1466:14

 Test Files  1 failed (1)
      Tests  1 failed | 44 skipped (45)
   Start at  19:52:17
   Duration  2.92s

EXIT=1
```

**ROJO B · medición directa viejo vs. nuevo** (script temporal, ya eliminado; `node` con `luxon`):

```
########## TZ=UTC ##########
TZ del proceso = UTC
— día de la semana del 2026-10-05 (lunes) —
  viejo getDay()        = 1
  nuevo diaSemana(sede) = 1
— instante de la cita 2026-10-10 21:00 locales —
  viejo = 2026-10-10T21:00:00.000Z        ← 4 h antes del inicio real
  nuevo = 2026-10-11T01:00:00.000Z
— 16:35 local (4h25 antes) (se espera PERMITE) —
  viejo = 25 min -> 422                    ← BUG: cierra la ventana 4 h antes
  nuevo = 265 min -> PERMITE
— 20:31 local (29 min antes) (se espera 422) —
  viejo = -211 min -> 422
  nuevo = 29 min -> 422
########## TZ=America/Santo_Domingo ##########
TZ del proceso = (sin TZ)
— día de la semana del 2026-10-05 (lunes) —
  viejo getDay()        = 7                 ← BUG: domingo por la medianoche UTC
  nuevo diaSemana(sede) = 1
— instante de la cita 2026-10-10 21:00 locales —
  viejo = 2026-10-11T01:00:00.000Z
  nuevo = 2026-10-11T01:00:00.000Z
```

## 4. VERDE (después del fix)

**Prueba H36 (solo ella, `TZ=UTC`):**

```
 Test Files  1 passed (1)
      Tests  1 passed | 44 skipped (45)
   Duration  2.85s

EXIT=0
```

**Suite unitaria completa, DOS zonas (dos scripts npm nuevos):**

```
$ npm run test:tz-utc            # TZ=UTC
 Test Files  37 passed (37)
      Tests  376 passed (376)
   Duration  10.35s
EXIT=0

$ npm run test:tz-santo-domingo  # TZ=America/Santo_Domingo
 Test Files  37 passed (37)
      Tests  376 passed (376)
   Duration  9.89s
EXIT=0
```

Cobertura no degradada: sobre las 357 pruebas de E2-02, el delta es +19 (14 del reloj central, 3 de disponibilidad-zona, 1 de H36 y 1 más de las suites re-ancladas); ninguna aserción se aflojó (se re-anclaron al nuevo reloj).

**E2E completo (`dev`, `--testTimeout=30000`):**

```
 Test Files  20 passed (20)
      Tests  139 passed (139)
   Duration  560.62s
EXIT=0
```

**Lint (`oxlint --type-aware`):** `Found 46 warnings and 0 errors` (los warnings son los preexistentes de specs, ninguno nuevo bloqueante).

## 5. PRUEBAS DE BORDE AÑADIDAS

- `src/shared/time/tiempo.service.spec.ts`: `aInstante` de las **21:00** (01:00 UTC del día siguiente), **23:59** (03:59 UTC del siguiente), **00:00** (04:00 UTC del mismo día) y **cierre a medianoche** (las 00:00 locales del día siguiente); round-trip etiqueta→instante→etiqueta; `diaSemana` del lunes 2026-10-05 = 1 con el proceso en la zona de la sede (regresión de `getDay()`) y domingo = 7; reloj inyectable; helpers de etiqueta.
- `src/agenda/application/disponibilidad-zona.spec.ts`: un turno de 18:00 a 23:59 locales no produce **ningún** slot que cruce la medianoche (el de 23:30 se descarta), el slot de las 21:00 es 01:00 UTC del día siguiente y la consulta sin fecha usa «hoy» de la sede.
- `reserva.service.spec.ts` (H36): a las 16:35 locales (4 h 25 min antes de una cita de 21:00) el CLIENTE cancela; a las 20:31 locales (29 min) → 422.

## 6. BÚSQUEDAS DE ACEPTACIÓN (literal)

```
$ grep -rn "\.getDay()" src/ | grep -v comentario
  (sin coincidencias de código; solo aparece en comentarios explicativos)

$ grep -rn "toISOString()\.\(slice\|split\)" src/ | grep -v comentario
  (sin coincidencias en código de producción; solo la descripción de una prueba)

$ grep -rn "new Date('20" src/ | grep -v "\.spec\.ts:"
  (sin coincidencias: todos los `new Date('2026-…')` restantes están en fixtures .spec.ts)
```

## 7. HALLAZGOS / LÍMITES

- **E2-03 sigue pendiente**: `barberias.zona_horaria` queda con el `DEFAULT` del catálogo; su `CHECK` y el de `reservas.estado`, etc., corresponden a E2-03. La migración se aplicó a `dev` para que los E2E usen la columna.
- **Comparación menor no migrada**: `catalogo/servicios.service.deactivate` sigue filtrando `fechaCita: { gte: new Date() }` («hoy» del servidor) para decidir si una reserva es futura. No es una de las construcciones prohibidas por la aceptación y no toca el cálculo del bloque, pero para una sede con desfase de día merece su propio cambio (candidato a hallazgo de E2-05).
- **Rango por defecto de `GET horarios/excepciones` y `GET agenda/bloqueos`**: los controllers siguen calculando `from`/`to` por defecto con `new Date()` del servidor cuando no llegan parámetros; el camino con parámetros (el que usan las pantallas) es correcto. Anotado para no ampliar el alcance de E2-04.
- **`reservas.fecha_cita`/`hora_inicio`/`hora_fin`** siguen sin `CHECK` de coherencia ni conversión a `TIMESTAMPTZ` (no lo pide D15: son etiquetas locales por diseño).
- No hubo `push` ni `merge`; todo queda en el árbol de trabajo de `fix/h22-zona-horaria` para revisión.
