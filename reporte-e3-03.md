```
TAREA: E3-03 (parte 2) — Validaciones de creación de reserva y contrato de errores D40
RAMA: feat/e3-03-validaciones
```

---

## 1. QUÉ HICE

Implementé las cuatro reglas de negocio que faltaban en `crearReserva` (`RESERVAS_PAUSADAS`, `FUERA_DE_HORIZONTE`, `LIMITE_PENDIENTES`, `GRUPAL_NO_DISPONIBLE`) resolviéndolas **antes** del `SELECT ... FOR UPDATE`, y apliqué el contrato D40 `{ statusCode, codigo, mensaje }` a todos los errores de negocio del flujo (`NO_VINCULADO`, `CLIENTE_RESTRINGIDO`, `SERVICIO_FUERA_DE_BARBERIA` incluidos). El contrato quedó en un único módulo compartido en vez de repetido en cada `throw`. Corregí cinco defectos de datos de prueba en el E2E de E3-03 (los cuatro solicitados más uno que descubrí en el test de carrera). Ajusté una expectativa del spec unitario que codificaba el contrato viejo (400 en vez de 422).

---

## 2. ARCHIVOS TOCADOS

Literal de `git diff --stat` (sin los ficheros no trackeados):

```
 .../reserva/application/reserva.service.spec.ts    |  8 +--
 .../src/reserva/application/reserva.service.ts     | 83 +++++++++++++++++-----
 .../reserva/infrastructure/reserva.controller.ts   | 16 +++--
 .../test/e3-03-validaciones.e2e-spec.ts            | 79 ++++++++++++++------
 .../test/hallazgo14-idor-reserva.e2e-spec.ts       |  6 +-
 backend-barberias/test/permisos-matriz.spec.ts     | 12 ++--
 .../test/reserva-walkin-split.e2e-spec.ts          | 12 ++++
 7 files changed, 158 insertions(+), 58 deletions(-)
```

Ficheros nuevos (no trackeados, no aparecen en `diff --stat`):

- `backend-barberias/src/shared/errors/d40.errors.ts` — contrato D40 (`errorDePermiso` 403, `errorDeSolicitud` 400, `reglaDeNegocio` 422).

---

## 3. TEST ROJO (antes del fix, salida literal)

**NO DISPONIBLE.** No pude capturar la salida literal en rojo del E2E porque el arnés no alcanza la base de datos desde esta máquina. Evidencia literal del bloqueo (bucle de 4 consultas contra el `DATABASE_URL` del `.env`, ejecutado tras varias reintentos):

```
q0 ERR 5035ms
q1 ERR 5014ms
q2 ERR 5035ms
q3 ERR 5018ms
DB_UNUSABLE
```

Regla 6 del protocolo: si no pude verificar algo, lo digo. No invento la salida roja.

Estado previo del código, para dejar constancia de qué cambiaba (esto es lectura de código, no salida de terminal): las reglas `FUERA_DE_HORIZONTE` y `LIMITE_PENDIENTES` no existían en `reserva.service.ts`, y las cinco que sí existían lanzaban `BadRequestException` (HTTP 400) con el código embebido en el texto del mensaje (`'RESERVAS_PAUSADAS: ...'`), sin campo `codigo` y con estado incorrecto según D40.

---

## 4. TEST VERDE (después, salida literal)

**Contrato D40 verificado en runtime** con una app Nest mínima (sin base de datos), atacada por HTTP con supertest. Salida literal:

```
OK   /t/pausa -> 422 {"statusCode":422,"codigo":"RESERVAS_PAUSADAS","mensaje":"La barbería no está aceptando nuevas reservas actualmente."} keys=[codigo,mensaje,statusCode]
OK   /t/vinculo -> 403 {"statusCode":403,"codigo":"NO_VINCULADO","mensaje":"No estás vinculado a esta barbería."} keys=[codigo,mensaje,statusCode]
OK   /t/servicio -> 400 {"statusCode":400,"codigo":"SERVICIO_FUERA_DE_BARBERIA","mensaje":"Servicio inactivo."} keys=[codigo,mensaje,statusCode]
D40_CONTRACT_OK
```

Esto verifica los tres puntos que importan del contrato: estado HTTP correcto por familia, nombre del campo `codigo` (no `code`) y cuerpo sin claves extra.

**El rojo→verde del E2E de E3-03 (`test/e3-03-validaciones.e2e-spec.ts`) NO se ejecutó aquí.** Queda delegado a CI, según lo acordado. El script de verificación terminó sin dejar artefactos: se eliminó tras la ejecución.

---

## 5. SUITE COMPLETA: `npm run test` (resumen literal)

```
 Test Files  30 passed (30)
      Tests  261 passed (261)
   Start at  16:38:31
   Duration  8.76s (transform 5.69s, setup 0ms, import 62.98s, tests 18.97s, environment 17ms)
```

Exit code `0`. Corrida sobre el árbol final (los ficheros `*.e2e-spec.ts` no entran en el runner unitario: su `include` es `**/*.spec.ts`). Como `src/reserva/application/reserva.service.spec.ts` importa el servicio y el módulo D40 nuevo, esta corrida también prueba que ambos compilan y resuelven sus imports.

---

## 6. CRITERIOS DE ACEPTACIÓN

Del enunciado de la tarea (las cuatro reglas) y de `BACKLOG_BARBERIAS_V1.md` → E3-03:

- [x] `nuevasReservasActivas=false` → 422 `RESERVAS_PAUSADAS`. **Evidencia:** verificado en runtime (bloque del punto 4) y por lectura de `reserva.service.ts:139`.
- [x] Cita fuera de `horizonteReservaDias` → 422 `FUERA_DE_HORIZONTE`. **Evidencia:** implementado comparando día de calendario `YYYY-MM-DD` (no depende de la zona horaria); verificado por lectura de `reserva.service.ts:157-172`.
- [x] `max_pendientes` alcanzado → 422 `LIMITE_PENDIENTES`. **Evidencia:** conteo por sede de reservas `PENDIENTE`/`PROPUESTA_PENDIENTE`; por lectura de `reserva.service.ts:177-190`.
- [x] `tipo=GRUPAL` con `aceptaGrupal=false` → 422 `GRUPAL_NO_DISPONIBLE`. **Evidencia:** verificado por lectura de `reserva.service.ts:151`.
- [x] Contrato D40 `{ statusCode, codigo, mensaje }` aplicado a los errores de negocio del flujo. **Evidencia:** salida literal del punto 4.
- [ ] Cliente no vinculado → 403 `NO_VINCULADO`; restringido → 403 `CLIENTE_RESTRINGIDO` (criterio del backlog). **No verificado en E2E** (base inalcanzable); el contrato sí está verificado en runtime.
- [ ] Dos solicitudes simultáneas al mismo espacio: una 201 y otra 409. **No verificado** (base inalcanzable). El test de carrera quedó corregido pero sin ejecutar.
- [x] Suite unitaria completa en verde. **Evidencia:** punto 5 (261/261, exit 0).
- [ ] CI en verde. **Pendiente**: lo ejecuta el dueño tras el push.

---

## 7. DECISIONES O DESVIACIONES

1. **Las reglas de negocio se evalúan antes del `FOR UPDATE`** (pedido explícito de la tarea). Un rechazo por D40 no necesita serializar la barbería entera. La verificación de disponibilidad y la persistencia siguen dentro del bloqueo.
2. **`max_pendientes` cuenta por SEDE, no por cliente.** El enunciado decía "del cliente", pero el E2E espera el ámbito por sede (`cG` llena el cupo y `cH`, otro cliente, recibe 422) y el campo vive en `configuracion_barberia`; la regla hermana `HAY_PENDIENTES` (E3-10) también cuenta por sede. **Confirmado con el Dueño de Producto antes de codificar.**
3. **Cambié una expectativa del spec unitario**: el test "la barbería pausó nuevas reservas" afirmaba `BadRequestException` (400), que contradice D40 para una regla de negocio; ahora afirma `UnprocessableEntityException`. Era obligado por el comportamiento pedido, no una forma de hacer pasar el test. Siguen siendo 261.
4. **En el E2E, `res.body.code` → `res.body.codigo` y `FUERO_DE_HORIZONTE` → `FUERA_DE_HORIZONTE`.** El test codificaba un nombre de campo y un código que D40 y el catálogo del backlog contradicen (`docs/BACKLOG_BARBERIAS_V1.md:176`).
5. **Añadí una quinta corrección no solicitada al test de carrera** (ver hallazgo H-E3-03-05). Sin ella CI habría vuelto a fallar por datos de prueba, que es justo lo que se pedía evitar.
6. **Deuda técnica aceptada por el Dueño de Producto**, fuera de alcance: el chequeo de `aceptaIndividual` sigue devolviendo 400 con el mensaje prefijado `RESERVAS_PAUSADAS:` (el catálogo canónico no define código para "no acepta individuales"), y `PrismaExceptionFilter` responde con `code` en vez de `codigo`, así que la misma API usa los dos nombres según el origen del error.

---

## 8. HALLAZGOS NUEVOS

**H-E3-03-01 · `reporte-e3-03.md` anterior era inexacto · severidad: media**
La versión previa de este reporte (sin trackear) afirmaba que las validaciones ya estaban implementadas con 422 y `codigo`. Al leer el código, las cinco reglas existentes lanzaban `BadRequestException` (400) sin campo `codigo`, y dos reglas sencillamente no existían. El reporte también declaraba verdes E2E que nunca se ejecutaron. **Evidencia:** lectura de `reserva.service.ts` (estado en `HEAD~`) frente a lo que describía el reporte.

**H-E3-03-02 · El `@Roles` de `POST /reservas/walk-in` había quedado desplazado · severidad: alta**
El commit `49eb25b` insertó el método `cotizar` entre el decorador `@Roles(...)` y `@Post('walk-in')`, de modo que la ruta walk-in quedaba sin política y el guard fail-closed la denegaba con 403, mientras que `cotizar` heredaba el decorador. **Evidencia:** `git show 49eb25b`; corregido en esta rama y verificado por la matriz de rutas (unitarias: 56 rutas × 4 roles = 224 evaluaciones).

**H-E3-03-03 · El E2E de E3-03 nunca se ejecutó contra una base real · severidad: alta**
La fixture contenía al menos cinco defectos que impedían que pasara incluso con el servicio correcto. **Evidencia:** los cinco puntos corregidos en el punto 7 y en H-E3-03-05.

**H-E3-03-04 · `POST /reservas` usaba `res.body.code` mientras D40 define `codigo` · severidad: media**
El test afirmaba un contrato que no existe en la decisión D40. **Evidencia:** `docs/BACKLOG_BARBERIAS_V1.md:170`.

**H-E3-03-05 · El test de carrera de E3-03 chocaba con una reserva previa del mismo hueco · severidad: alta**
`calcularDisponibilidad` construye las ocupaciones filtrando solo por `barberiaId` + `fechaCita` + `estado IN ('PENDIENTE','CONFIRMADA')`, **sin filtrar por `barberoId`** (`src/agenda/application/disponibilidad.service.ts:98-102`). Como el test CONTROL crea antes una reserva `PENDIENTE` en la sede A para `fecha(1)` 10:00-10:30 y el test de carrera usaba exactamente el mismo hueco, la carrera habría dado 0×201 y 10×409, no 1×201 y 9×409. **Evidencia:** lectura de `disponibilidad.service.ts:98-102`; corregido moviendo la carrera a `fecha(3)`.

**H-E3-03-06 · El spec de E3-03 tiene tres errores de tipos preexistentes · severidad: baja**
`npx tsc --noEmit` reporta `Object is possibly 'null'` en `test/e3-03-validaciones.e2e-spec.ts` (líneas 176, 216 y 236: `responsableId`, `usuarioRol.create` y `u.id`). Son anteriores a esta tarea y no bloquean, porque la verificación del proyecto es `vitest` (transpila sin chequear tipos) y la suite unitaria está en verde. **Evidencia:** `npx tsc --noEmit`.

---

## 9. PENDIENTE O NO VERIFICADO

- **El E2E completo de E3-03 no se ejecutó**: `test/e3-03-validaciones.e2e-spec.ts` no se pudo correr en esta máquina. El bloqueo es de red contra Neon, no de código (punto 3). Lo ejecuta CI / el dueño.
- **No verificado por tanto:** el rojo→verde de las cuatro reglas contra la base, el 403 de `NO_VINCULADO`/`CLIENTE_RESTRINGIDO` end-to-end, la carrera `1×201 / 9×409` y el `expiraAt` real de las reservas MANUAL.
- Las cinco correcciones de la fixture están aplicadas y verificadas **por inspección y por tipos**, no por ejecución.
- Deuda técnica aceptada y fuera de alcance: el 400 de `aceptaIndividual` y la dualidad `code`/`codigo` del filtro de Prisma.

---

## 10. ESTADO DE GIT

```
$ git status --short
 M src/reserva/application/reserva.service.spec.ts
 M src/reserva/application/reserva.service.ts
 M src/reserva/infrastructure/reserva.controller.ts
 M test/e3-03-validaciones.e2e-spec.ts
 M test/hallazgo14-idor-reserva.e2e-spec.ts
 M test/permisos-matriz.spec.ts
 M test/reserva-walkin-split.e2e-spec.ts
?? ../.agents/
?? src/shared/errors/
?? ../reporte-e3-03.md

$ git log -1 --oneline
49eb25b feat(reserva): endpoint cotizar D44 y fix E2E

$ git log --oneline -5
49eb25b feat(reserva): endpoint cotizar D44 y fix E2E
edcceda Merge pull request #40 from Codecore-J/feat/reservas-split-cliente-walkin
632a3a8 docs(matriz): documentar la partición de POST /reservas (E3-03) en matriz y backlog
758a70d feat(reservas): E3-03 — partir POST /reservas en alias de cliente y ruta walk-in
5f754a7 Merge pull request #39 from Codecore-J/feat/pago-barbero-asignado
```

---

**No hago merge. Espero aprobación.**
