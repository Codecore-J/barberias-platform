TAREA: E3-11 — Configuración de la barbería
RAMA: feat/configuracion-barberia

1. QUÉ HICE (5 líneas máximo)
   1. Añadí GET/PATCH `/barberias/:barberiaId/configuracion` (ADMIN_BARBERIA, ADMINISTRADOR) con mapeo explícito campo por campo de la entidad Prisma antes de devolverla.
   2. Implementé el bloqueo 422 `HAY_PENDIENTES` (con `conteo` en la respuesta) sobre modo_reserva, acepta_individual, acepta_grupal y max_pendientes cuando hay reservas PENDIENTE/PROPUESTA_PENDIENTE.
   3. Endurecí las validaciones: límites ≥ 1 y `max_personas_total >= max_ninos + 1` estricto sobre los valores EFECTIVOS (incluye al adulto responsable).
   4. Verifiqué la pausa (`nuevas_reservas_activas = false` guarda motivo y pausa_desde) y que bloquea la creación de reservas; la reactivación limpia los campos.
   5. Reparé los tests E3-11 (unit + e2e) y actualicé la matriz de permisos, que exigía declarar las dos rutas nuevas.

2. ARCHIVOS TOCADOS (git diff --stat, literal)
```
 AUDITORIA_HALLAZGOS.md                              | 12 ++++++++++++
 backend-barberias/src/barberia/barberia.module.ts   | 11 +++++++----
 .../src/reserva/application/reserva.service.spec.ts |  2 +-
 .../src/reserva/application/reserva.service.ts      |  6 +++++-
 backend-barberias/src/shared/errors/d40.errors.ts   | 16 ++++++++++++++--
 backend-barberias/test/permisos-matriz.spec.ts      | 21 ++++++++++++++-------
 docs/MATRIZ_RUTAS.md                                |  8 ++++++++
 7 files changed, 61 insertions(+), 15 deletions(-)
```
Nuevos (untracked):
```
 reporte-e3-11.md                                              (este informe)
 src/barberia/application/configuracion-barberia.service.ts   263 líneas
 src/barberia/application/dto/configuracion-barberia.dto.ts    92 líneas
 src/barberia/infrastructure/configuracion-barberia.controller.ts 76 líneas
 test/e3-11-configuracion.spec.ts                             294 líneas
 test/e3-11-configuracion.e2e-spec.ts                         380 líneas
```

3. TEST ROJO (antes del fix, salida literal)

   `test/e3-11-configuracion.spec.ts` (la versión previa asertaba el texto del
   `message` de la excepción en lugar del payload y no inyectaba el reloj):
```
 × debe permitir actualizar campos no bloqueados 7ms
 × debe bloquear con 422 HAY_PENDIENTES al cambiar modo con reservas pendientes 11ms
 × debe bloquear con 422 HAY_PENDIENTES al cambiar maxPendientes con reservas pendientes 2ms
 × no debe bloquear actualizar otro campo con reservas pendientes 1ms
 × debe validar maxPersonasTotal >= maxNinos + 1 1ms
 × debe rechazar maxPersonasTotal < maxNinos + 1 1ms
 × debe validar que los valores numéricos sean >= 1 2ms
 AssertionError: expected [Function] to throw error including 'max_personas_total debe ser >= max_ni…' but got 'Unprocessable Entity Exception'

 Test Files  1 failed (1)
      Tests  7 failed | 2 passed (9)
```

   `test/e3-11-configuracion.e2e-spec.ts` (la versión previa no compilaba: usaba
   `admin`, `adminAjeno` y `cliente` fuera del ámbito de `beforeAll`):
```
 test/e3-11-configuracion.e2e-spec.ts(161,34): error TS2304: Cannot find name 'admin'.
 test/e3-11-configuracion.e2e-spec.ts(161,44): error TS2304: Cannot find name 'adminAjeno'.
 test/e3-11-configuracion.e2e-spec.ts(161,59): error TS2304: Cannot find name 'cliente'.
 test/e3-11-configuracion.e2e-spec.ts(166,27): error TS2304: Cannot find name 'admin'.
 test/e3-11-configuracion.e2e-spec.ts(201,20): error TS2304: Cannot find name 'cliente'.
 test/e3-11-configuracion.e2e-spec.ts(233,20): error TS2304: Cannot find name 'cliente'.
```
   Además el controlador no importaba `ForbiddenException` (referencia no
   definida) y el servicio llamaba `fechaDeCalendario(Date)` sobre un parámetro
   `string` (TS2345 en `configuracion-barberia.service.ts(201,11)`).

   `test/permisos-matriz.spec.ts` era ROJO al añadir las dos rutas nuevas:
```
 AssertionError: expected 65 to be 63 // Object.is equality
 AssertionError: expected 260 to be 252 // Object.is equality
```

4. TEST VERDE (después, salida literal)

   `test/e3-11-configuracion.spec.ts` (unit, 17 casos):
```
 ✓ test/e3-11-configuracion.spec.ts (17 tests) 74ms
 Test Files  1 passed (1)
      Tests  17 passed (17)
```

   `test/e3-11-configuracion.e2e-spec.ts` (HTTP contra Neon dev, 12 casos):
```
 ✓ test/e3-11-configuracion.e2e-spec.ts (12 tests) 19880ms
     ✓ ADMINISTRADOR lee la configuración  608ms
     ✓ un CLIENTE no puede leer ni modificar la configuración (403)  1064ms
     ✓ ADMINISTRADOR actualiza un campo no sensible sin reservas en curso  950ms
     ✓ 422 HAY_PENDIENTES con conteo al cambiar modoReserva con una reserva PENDIENTE  810ms
     ✓ 422 HAY_PENDIENTES con conteo al cambiar aceptaIndividual con dos reservas en curso  716ms
     ✓ 422 HAY_PENDIENTES con conteo al cambiar aceptaGrupal y maxPendientes  1202ms
     ✓ permite cambiar campos no bloqueados aunque haya reservas en curso  1093ms
     ✓ 422 VALIDACION si max_personas_total < max_ninos + 1  551ms
     ✓ 422 VALIDACION estricta al enviar solo maxPersonasTotal frente al max_ninos persistido  608ms
     ✓ acepta max_personas_total = max_ninos + 1  680ms
     ✓ la pausa guarda motivo y pausa_desde, y la reactivación los limpia  1345ms
     ✓ la pausa es visible para el resto de la lectura de configuración  1096ms
 Test Files  1 passed (1)
      Tests  12 passed (12)
```

   Matriz de permisos (con el conteo actualizado a 65 rutas):
```
 ✓ test/permisos-matriz.spec.ts (3 tests) 25ms
 === MATRIZ ROL × RUTA (65 rutas × 4 roles = 260 decisiones) ===
```

5. SUITE COMPLETA

   `npm test` (vitest run, suite unitaria; el `include` de `vitest.config.ts` es
   `**/*.spec.ts`, así que NO incluye los `*.e2e-spec.ts`):
```
 Test Files  38 passed (38)
      Tests  393 passed (393)
```

   Suite E2E completa (`npm run test:e2e`, 21 archivos, salida literal):
```
 Test Files  7 failed | 14 passed (21)
      Tests  16 failed | 117 passed | 18 skipped (151)
```
   Los 7 archivos en rojo son PRE-EXISTENTES y ajenos a E3-11: 4 suites abortan
   en `beforeAll` por CHECK de la base dev (ver Hallazgos) y 3 archivos
   (`e3-06-07`, `e3-08`) fallan por `Test timed out in 5000ms`. El archivo de
   E3-11 es uno de los 14 en verde (12/12).

6. CRITERIOS DE ACEPTACIÓN
   - [x] Cambiar el modo con una reserva pendiente → 422.
         Evidencia: unit `bloquea 422 HAY_PENDIENTES con el conteo al cambiar modoReserva…`
         + e2e `422 HAY_PENDIENTES con conteo al cambiar modoReserva con una reserva PENDIENTE`
         (assert `codigo: 'HAY_PENDIENTES'`, `conteo: 1`, `mensaje` con «1 reserva(s) pendiente(s)»).
   - [x] La pausa bloquea la creación de reservas (E3-03).
         Evidencia: `src/reserva/application/reserva.service.spec.ts` →
         «debe rechazar con UnprocessableEntityException (422 D40) si la barbería pausó nuevas
         reservas», endurecido a `{ response: { codigo: 'RESERVAS_PAUSADAS', statusCode: 422 } }`;
         el bloqueo vive en `ReservaService.crearReserva` (`!config.nuevasReservasActivas`).
   - [x] Reglas 2 y 3 del backlog (conteo en HAY_PENDIENTES; max_personas_total ≥ max_ninos + 1).
         Evidencia: 4 casos `it.each` (los cuatro campos) + validación estricta sobre valores
         efectivos (solo `maxPersonasTotal`, solo `maxNinos`) + borde exacto `= max_ninos + 1`.
   - [x] Auditoría `CONFIG_ACTUALIZADA` con valor anterior y nuevo.
         Evidencia: unit `audita CONFIG_ACTUALIZADA con el valor anterior y el nuevo`.
   - [x] Matriz de cumplimiento actualizada (65 rutas × 4 roles = 260), `docs/MATRIZ_RUTAS.md`
         y `test/permisos-matriz.spec.ts`.

7. DECISIONES O DESVIACIONES
   - Mapeo explícito campo por campo en `aMapearConfiguracion`, tipado contra el modelo
     `ConfiguracionBarberia` de Prisma (no `any`). La respuesta dejó de exponer `creadoAt`/
     `actualizadoAt` —columnas que NO existen en la tabla— y ahora expone `reactivacion_real`,
     que sí existe. Motivo: el contrato de salida debe reflejar columnas reales.
   - `reglaDeNegocio()` acepta un tercer parámetro opcional `detalle` para añadir `conteo` a la
     respuesta sin romper el contrato base `{ statusCode, codigo, mensaje }` (los demás códigos
     siguen devolviendo exactamente las tres claves).
   - La validación `max_personas_total >= max_ninos + 1` se evalúa sobre los valores efectivos
     (DTO ∪ persistido), no solo cuando llegan los dos campos: «estricta» significa que el estado
     resultante siempre debe ser válido.
   - Se mantuvo `ForbiddenException` (403) para «la barbería no tiene configuración»/«no
     encontrada» por fidelidad al comportamiento previo; D40 sugeriría 404, pero cambiarlo excede
     el alcance de E3-11 (se deja como nota, no como cambio).
   - El controlador quedó solo con `@Roles('ADMIN_BARBERIA','ADMINISTRADOR')`; el `RolesGuard`
     ya acota por el `:barberiaId` del parámetro. La comprobación manual duplicada se mantiene
     respecto al código previo de la rama, pero se eliminó la inyección de `BarberiaService` que
     no se usaba y se añadió el `ForbiddenException` que faltaba.

8. HALLAZGOS NUEVOS (ID provisional, severidad, evidencia)
   - **H49 · [ALTA] La base de desarrollo tiene CHECK que contradicen los datos de los tests E2E
     (drift nuevo respecto a H37).** Las migraciones del repo NO declaran estos CHECK, pero la BD
     `dev` sí los tiene (aplicados con `db push`/SQL a mano; `pg_constraint` los devuelve):
     `barberias_estado_check = CHECK (estado IN ('ACTIVO','INACTIVO'))` y
     `cliente_barberias_estado_vinculacion_check` (rechaza `'SUSPENDIDO'`). Varios E2E insertan
     `estado: 'ACTIVA'` / `estadoVinculacion: 'SUSPENDIDO'` y abortan en `beforeAll`. Evidencia
     literal (extractos):
     ```
     new row for relation "barberias" violates check constraint "barberias_estado_check"
     detail: Failing row contains (…, ACTIVA, America/Santo_Domingo, …)

     new row for relation "cliente_barberias" violates check constraint "cliente_barberias_estado_vinculacion_check"
     detail: Failing row contains (…, SUSPENDIDO, f, 0, f, null, …)
     ```
     (Consulta de solo lectura al `pg_constraint` de `dev`: `barberias_estado_check = CHECK ((estado)::text = ANY (ARRAY['ACTIVO','INACTIVO']::text[]))`.)
     Archivos afectados: `e1-06-cross-tenant-admin.e2e-spec.ts`, `e3-03-validaciones.e2e-spec.ts`,
     `hallazgo16-rolesguard-global.e2e-spec.ts`, `permisos-matriz.e2e-spec.ts` y
     `barberia.e2e-spec.ts` (500 en la 6.ª vinculación). NO causado por E3-11: los fallos ocurren
     en `prisma.barberia.create` / `prisma.clienteBarberia.create` en crudo, antes de tocar
     cualquier ruta. Nota: H37 se dio por reconciliado el 2026-10-09 porque `migrate diff` no
     cubre los CHECK; conviene reconciliar estos desde `pg_constraint`, con aprobación del dueño.
   - **Timeouts de 5 s (NO es hallazgo nuevo):** `e3-06-07-reprogramacion-reglas.e2e-spec.ts`
     (6 casos) y `e3-08-cancelacion-especial-propuesta.e2e-spec.ts` (6 casos) fallan con
     `Error: Test timed out in 5000ms`; es la reincidencia de **H38** (abierto: falta
     `testTimeout` en `vitest.config.e2e.ts`). Ajeno a E3-11.

9. PENDIENTE O NO VERIFICADO
   - El job de reactivación automática (`reactivacion_programada` → `reactivacion_real`) NO está
     implementado: hoy el PATCH guarda `reactivacion_programada` (ahora + 24 h desde la
     medianoche de la sede) cuando se pausa con `reactivacion_motivo`, pero no existe el job de
     BullMQ que la ejecute ni escribe `reactivacion_real`. Se deja como pendiente de E3-11; no
     forma parte de los dos criterios de aceptación.
   - El frontend no tiene panel de configuración (los dos endpoints no los consume ninguna
     pantalla); se anota como pendiente.
   - `npx tsc --noEmit` NO está limpio en el repo (errores preexistentes en `prisma/*.ts`,
     `*.spec.ts` y `test/e2e-*`). No introduje errores nuevos; los archivos de E3-11 compilan.
   - `ARCHIVO_INTERNO.txt` (1 línea, untracked) contiene el error `fatal: path
     'test/e3-11-configuracion.e2e-spec.ts' does not exist in 'HEAD'`. No lo creé yo y no lo
     eliminé por ambigüedad de propiedad; conviene borrarlo.

10. git status --short / git log -1 --oneline / git log --oneline -5
```
 M AUDITORIA_HALLAZGOS.md
 M backend-barberias/src/barberia/barberia.module.ts
 M backend-barberias/src/reserva/application/reserva.service.spec.ts
 M backend-barberias/src/reserva/application/reserva.service.ts
 M backend-barberias/src/shared/errors/d40.errors.ts
 M backend-barberias/test/permisos-matriz.spec.ts
 M docs/MATRIZ_RUTAS.md
?? backend-barberias/ARCHIVO_INTERNO.txt
?? backend-barberias/src/barberia/application/configuracion-barberia.service.ts
?? backend-barberias/src/barberia/application/dto/configuracion-barberia.dto.ts
?? backend-barberias/src/barberia/infrastructure/configuracion-barberia.controller.ts
?? backend-barberias/test/e3-11-configuracion.e2e-spec.ts
?? backend-barberias/test/e3-11-configuracion.spec.ts
?? reporte-e3-11.md
```
```
git log -1 --oneline
7d17d2f test(e2e): ancla calculo de ventana de cancelacion a la zona de la sede

git log --oneline -5
cec0528 Merge pull request #48 from Codecore-J/fix/e204-ventana-cancelacion-zona-sede
7d17d2f test(e2e): ancla calculo de ventana de cancelacion a la zona de la sede
99ce004 fix(time): integra luxon y resuelve zona horaria H36 (E2-04)
cf8fb8c Merge pull request #46 from Codecore-J/fix/maquina-estados-reserva
ef94a5e fix(reservas): implementa maquina de estados estricta (E2-02)
```
(La rama `feat/configuracion-barberia` no tiene commits propios: todo E3-11 está en el
working tree sin commitear.)

No hago merge. Quedo a la espera de aprobación.
