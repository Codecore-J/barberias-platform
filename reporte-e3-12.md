TAREA: E3-12/1 — Aprobación de la 6.ª vinculación (bandeja de plataforma · D10 · cierra H67)
RAMA: feat/e3-12-aprobacion-vinculaciones

1. QUÉ HICE (5 líneas máximo)

1. Cerré el callejón sin salida que H67 dejó a la vista: la 6.ª vinculación nace `PENDIENTE_APROBACION`, bloquea la sede y ahora tiene flujo que la resuelve (antes nadie podía aprobarla).
2. Añadí la bandeja `GET /plataforma/vinculaciones/pendientes` (D32, por orden de llegada, con el conteo de vínculos del cliente, que es lo que explica el estado) y la resolución `POST /plataforma/vinculaciones/:id/aprobar` y `.../rechazar { motivo }`.
3. Las tres rutas son `@Roles('ADMINISTRADOR')` y solo él: el límite de D10 se cuenta por USUARIO, no por sede, así que la sede es parte interesada y no decide (el E2E comprueba el 403 del `ADMIN_BARBERIA`).
4. Los dos desenlaces se escriben y se auditan en una transacción (`VINCULACION_APROBADA` / `VINCULACION_RECHAZADA` con anterior y nuevo, D28) y avisan al cliente de forma best-effort DESPUÉS del commit.
5. Verde: E2E dirigido 19/19, unitarios dirigidos 67/67, matriz de permisos 79 rutas × 4 roles = 316 decisiones, suite unitaria completa 563/563 (50 archivos) con `EXIT=0`.

2. ARCHIVOS TOCADOS (git diff --stat, literal)

```
 AUDITORIA_HALLAZGOS.md                             |  41 +-
 .../src/barberia/application/barberia.service.ts   |  13 +-
 .../dto/listar-vinculaciones-pendientes.dto.ts     |  29 ++
 .../application/dto/rechazar-vinculacion.dto.ts    |  17 +
 .../application/vinculacion.service.spec.ts        | 316 +++++++++++++
 .../barberia/application/vinculacion.service.ts    | 296 ++++++++++++
 backend-barberias/src/barberia/barberia.module.ts  |  11 +-
 .../src/barberia/domain/vinculacion.spec.ts        |  44 ++
 .../src/barberia/domain/vinculacion.ts             |  47 ++
 .../plataforma-vinculaciones.controller.ts         |  82 ++++
 .../test/e3-12-vinculacion.e2e-spec.ts             | 516 +++++++++++++++++++++
 backend-barberias/test/permisos-matriz.spec.ts     |  19 +-
 docs/MATRIZ_CUMPLIMIENTO.md                        |  26 +-
 docs/MATRIZ_RUTAS.md                               |  22 +
 reporte-e3-12.md                                   | 192 ++++++++
 15 files changed, 1643 insertions(+), 28 deletions(-)
```

**Nuevos:** `src/barberia/domain/vinculacion.ts` (+ spec), `src/barberia/application/vinculacion.service.ts` (+ spec), `src/barberia/application/dto/listar-vinculaciones-pendientes.dto.ts`, `src/barberia/application/dto/rechazar-vinculacion.dto.ts`, `src/barberia/infrastructure/plataforma-vinculaciones.controller.ts`, `test/e3-12-vinculacion.e2e-spec.ts`.

**Tocados:** `src/barberia/barberia.module.ts` (registro + `NotificacionModule`), `src/barberia/application/barberia.service.ts` (constantes compartidas), `test/permisos-matriz.spec.ts` (las 3 rutas y los conteos), `docs/MATRIZ_RUTAS.md`, `docs/MATRIZ_CUMPLIMIENTO.md`, `AUDITORIA_HALLAZGOS.md`.

3. TEST ROJO (antes del fix, salida literal)

El E2E se escribió primero, contra el código de producción AÚN sin escribir: `test/e3-12-vinculacion.e2e-spec.ts` → 13 rojos de 19, todos por 404 (las rutas no existían). Los 6 que ya pasaban son los que miden el estado que H67 describía (la 6.ª nace pendiente y NO autoriza la sede).

```
 FAIL  test/e3-12-vinculacion.e2e-spec.ts > E3-12 · aprobación de la 6.ª vinculación (D10) > POST /plataforma/vinculaciones/:id/aprobar > el ADMINISTRADOR aprueba: la vinculación pasa a ACTIVO y queda auditada
Error: expected 200 "OK", got 404 "Not Found"

 FAIL  test/e3-12-vinculacion.e2e-spec.ts > ... > POST /plataforma/vinculaciones/:id/rechazar > 422 MOTIVO_REQUERIDO sin motivo: el rechazo tiene que estar justificado
Error: expected 422 "Unprocessable Entity", got 404 "Not Found"

 Test Files  1 failed (1)
      Tests  13 failed | 6 passed (19)
```

Los dos specs unitarios, ejecutados antes de existir sus módulos:

```
 FAIL  src/barberia/domain/vinculacion.spec.ts [ src/barberia/domain/vinculacion.spec.ts ]
Error: Cannot find module './vinculacion.js' imported from C:/.../backend-barberias/src/barberia/domain/vinculacion.spec.ts

 Test Files  2 failed (2)
      Tests  no tests
```

4. TEST VERDE (después, salida literal)

```
 ✓ test/e3-12-vinculacion.e2e-spec.ts (19 tests) 20467ms
       ✓ 201: con cinco vínculos previos, la sexta nace pendiente y sin sede activa  1491ms
       ✓ el vínculo pendiente NO autoriza la sede: seleccionar responde 403  466ms
       ✓ el ADMINISTRADOR ve las vinculaciones en espera, con cliente, sede y conteo  756ms
       ✓ el ADMIN_BARBERIA de la sede NO entra en la bandeja de plataforma (403)  396ms
       ✓ el ADMIN_BARBERIA de la sede no puede aprobar (403) y la fila sigue pendiente  357ms
       ✓ el ADMINISTRADOR aprueba: la vinculación pasa a ACTIVO y queda auditada  1095ms
       ✓ una vez ACTIVO el cliente ya opera: selecciona la sede y su estado es ACTIVO  1121ms
       ✓ 409 ESTADO_INVALIDO al aprobar dos veces la misma vinculación  525ms
       ✓ el ADMINISTRADOR rechaza con motivo: DESVINCULADO, auditado y avisado  1406ms
       ✓ el vínculo rechazado sigue sin autorizar la sede (403)  532ms

 Test Files  1 passed (1)
      Tests  19 passed (19)
```

```
 ✓ src/barberia/domain/vinculacion.spec.ts (5 tests) 8ms
 ✓ src/barberia/application/vinculacion.service.spec.ts (11 tests) 409ms
 ✓ src/barberia/application/barberia.service.spec.ts (51 tests) 1122ms
 Test Files  3 passed (3)
      Tests  67 passed (67)
```

Matriz de permisos (fail-closed), que descubre las rutas del servidor y compara la decisión del `RolesGuard` con la matriz declarada:

```
POST /plataforma/vinculaciones/:id/aprobar                 | si  | si  | si  | si
POST /plataforma/vinculaciones/:id/rechazar                | si  | si  | si  | si
=== MATRIZ ROL × RUTA (79 rutas × 4 roles = 316 decisiones) ===
 ✓ test/permisos-matriz.spec.ts (3 tests) 394ms
```

5. SUITE COMPLETA: npm run test (resumen literal)

```
 ✓ test/route-security.spec.ts (1 test) 408ms          → 79 rutas · Public: 7 | Autenticado: 5 | Roles: 67 | ninguno: 0
 Test Files  50 passed (50)
      Tests  563 passed (563)
   Duration  13.38s
EXIT=0
```

(48 archivos y 547 pruebas antes de esta rama: **+2 archivos y +16 casos**, todos de la vinculación.)

**Suite E2E completa (`npm run test:e2e`, 2026-10-15):** `Test Files 3 failed | 27 passed (30)`. Los tres archivos
rojos son de la cola, no de esta rama, y se reprodujeron SIN los cambios de esta rama (mismo comando,
trabajo de la rama en `git stash`, sobre `main`):

```
# Con la rama:          Test Files  3 failed | 27 passed (30)
# Sin la rama (main):   las MISMAS 4 aserciones rojas de e3-04 y e3-05, y el health ya rojo antes de empezar
 FAIL  test/e3-04-aceptar-rechazar.e2e-spec.ts > ... > CONTROL: aceptar PENDIENTE → CONFIRMADA, audita y cancela el job de expiración
AssertionError: expected undefined to be truthy
 ❯ test/e3-04-aceptar-rechazar.e2e-spec.ts:400:59   expect(await colaReservas.getJob(jobIdDe(reservaId))).toBeTruthy();
```

Es el estado que H62/SEC-04 ya documentó: con la cuota de Redis agotada la cola rechaza (`ERR max requests limit
exceeded`), los jobs no existen y los casos que los consultan fallan. `test/health.e2e-spec.ts` (sonda de
preparación en 503) falló igual en la PRIMERA corrida de esta sesión, antes de tocar ningún archivo. La rama no
toca reservas, colas ni la sonda: **e3-12 pasa en verde con y sin el resto de la suite en ese estado**.

6. CRITERIOS DE ACEPTACIÓN: lista con [x] y la evidencia de cada uno

- [x] **Rama desde `main` actualizado** — `feat/e3-12-aprobacion-vinculaciones` desde `5ab5907` (merge del PR #64), árbol limpio al crearla.
- [x] **`estadoVinculacion` revisado en el esquema** — `ClienteBarberia` (`schema.prisma:130`): `ACTIVO` · `PENDIENTE_APROBACION` · `DESVINCULADO`, con `CHECK` en `prisma/migrations/20261011130000_e203_integridad_base/migration.sql:84`. No hace falta migración: no se añade ninguna columna ni tabla.
- [x] **Bandeja de solicitudes** — `GET /plataforma/vinculaciones/pendientes` (`plataforma-vinculaciones.controller.ts:47`). Devuelve los clientes que esperan aprobación con cliente, sede, correo, teléfono, fecha de solicitud y `vinculacionesDelCliente`. Evidencia: E2E «el ADMINISTRADOR ve las vinculaciones en espera, con cliente, sede y conteo».
- [x] **Endpoint de resolución** — `POST /plataforma/vinculaciones/:id/aprobar` y `.../rechazar { motivo }` (`:58` y `:73`). Aprobar deja `ACTIVO`; rechazar deja `DESVINCULADO` (el vocabulario de D10 no tiene «rechazada») y apaga `es_barberia_activa`. Evidencia: E2E «el ADMINISTRADOR aprueba: … queda auditada» y «el ADMINISTRADOR rechaza con motivo: DESVINCULADO, auditado y avisado».
- [x] **Rutas protegidas con decoradores de rol** — `@Roles('ADMINISTRADOR')` en las tres (fail-closed: ninguna declara `@Public` ni `@Autenticado`). El `ADMIN_BARBERIA` de la sede recibe 403 en la bandeja y al aprobar; sin token, 401. Se decidió NO admitir al `ADMIN_BARBERIA` (ver §7). Evidencia: 4 casos del E2E + `test/permisos-matriz.spec.ts`.
- [x] **Un cliente pendiente puede ser aprobado** — E2E «el ADMINISTRADOR aprueba: la vinculación pasa a ACTIVO y queda auditada» (fila en base `ACTIVO`, evento `VINCULACION_APROBADA` con anterior y nuevo, aviso al cliente).
- [x] **Una vez ACTIVO, el cliente opera con normalidad** — E2E «una vez ACTIVO el cliente ya opera»: `PATCH /barberias/:id/seleccionar` pasa de 403 (pendiente) a 200 (activo) y `GET .../mi-estado` informa `ACTIVO`.
- [x] **H67 marcado como RESUELTO** — `AUDITORIA_HALLAZGOS.md`: marcador de la fase (ahora 5.ª iteración) y la ficha del hallazgo, con salida roja y verde y lo que sigue pendiente de E3-12.
- [x] **Matriz de cumplimiento actualizada** — `docs/MATRIZ_CUMPLIMIENTO.md`: 1.8 `NO-EXISTE` → `OK-PROBADO` y 1.7 `PARCIAL` → `OK-PROBADO`; resumen 63/3/1/4/1. `docs/MATRIZ_RUTAS.md`: filas 65 a 67 y el recuento a 79 rutas.
- [x] **Rutas nuevas en la matriz de permisos del CI** — `test/permisos-matriz.spec.ts` (79 rutas × 4 roles = 316).

7. DECISIONES O DESVIACIONES (con motivo)

1. **Ruta y rol: se siguió el DISEÑO, no la forma sugerida en el encargo.** El encargo proponía `GET /barberias/:barberiaId/vinculaciones/pendientes` y `PATCH .../:clienteId/estado` con `ADMIN_BARBERIA` de la sede o ADMINISTRADOR, y añadía «o la ruta que mejor encaje en la convención actual». La convención y el diseño de registro (backlog E3-12, D10) dicen `/plataforma/vinculaciones/...` con `ADMINISTRADOR` solo, y hay dos razones de peso para no admitir a la sede: (a) `vincularCliente` cuenta las vinculaciones del USUARIO, no las de una sede, así que la 6.ª es una decisión global; (b) la sede es parte interesada —aprobaría siempre— y el límite dejaría de existir. Admitir al `ADMIN_BARBERIA` en solo-lectura tampoco: le mostraría que ese cliente tiene cinco barberías más, que es información de otras sedes (aislamiento del principio 2).
2. **Dos rutas de resolución en vez de un `PATCH .../estado`.** El repo usa verbos de negocio (`/aceptar`, `/rechazar`, `/resolver`, `/reactivar`) en vez de un campo de estado genérico; el backlog escribe `aprobar|rechazar` y así queda. Evita además que un estado arbitrario llegue por el cuerpo: los dos únicos desenlaces posibles están en el código.
3. **`rechazar` exige motivo (422 `MOTIVO_REQUERIDO`, mínimo 10 caracteres)** como el rechazo de E3-13. La longitud se valida EN EL SERVICIO y no con `@MinLength` en el DTO para que la respuesta sea el 422 del contrato D40 y no el 400 del `ValidationPipe` (mismo criterio que `CambiarEstadoCuentaDto`).
4. **Rechazar apaga `es_barberia_activa`.** Un vínculo que deja de estar activo no puede seguir siendo la sede activa del cliente; si no, `mi-estado` y el índice único parcial de E2-03 dirían cosas distintas.
5. **Aviso best-effort y posterior al commit.** `NotificacionService` entra como `@Optional()` y el despacho va con `.catch()` después de la transacción, como el alta de reserva (H62/H67): una cola caída no puede dejar sin resolver una decisión ya tomada.
6. **`LIMITE_VINCULACIONES` y `ESTADOS_VINCULACION` se movieron al dominio** (`src/barberia/domain/vinculacion.ts`) y `vincularCliente` los usa. Antes el 5 y los literales estaban sueltos en el servicio: con un segundo camino que escribe el mismo estado, dos copias garantizan divergencia. No cambia el comportamiento (los 51 casos de `barberia.service.spec.ts` siguen verdes).
7. **No se tocó el punto 2 (enlace único/QR), el 3 (desvinculación) ni el 4 (D21) de E3-12**, que el encargo no pidió. El 4 queda registrado como hallazgo nuevo H71 porque el rechazo —que sí es de esta tarea— deja filas `DESVINCULADO` que hoy no se pueden reactivar.

8. HALLAZGOS NUEVOS (ID provisional, severidad, evidencia)

**H71 · Baja-Media · D21 sin implementar: cerrar un vínculo no tiene vuelta.** `vincularCliente` devuelve la fila existente sin mirar `estadoVinculacion` (`src/barberia/application/barberia.service.ts:508-516`), así que quien vuelve a introducir el código de acceso de una sede recibe la MISMA fila `DESVINCULADO` y sigue sin operar. Antes de E3-12 el estado `DESVINCULADO` no lo escribía nadie; ahora lo escribe el rechazo, así que la brecha tiene un camino que la produce. D21 dice lo contrario («revincular reactiva la misma fila») y D20 que el contador y la restricción se conservan. Evidencia: `test/e3-12-vinculacion.e2e-spec.ts` («el vínculo rechazado sigue sin autorizar la sede») y la lectura del servicio. Registrado en `AUDITORIA_HALLAZGOS.md` §F2.8. Remedio: reactivar la fila `DESVINCULADO` al vincular, conservando contador y restricción.

9. PENDIENTE O NO VERIFICADO

- **Pendiente de E3-12 (no solicitado aquí):** desvinculación por el cliente con bloqueo por reservas futuras, enlace único/QR y la revinculación de D21 (H71).
- **Sin verificar:** el panel de plataforma del frontend para esta bandeja (la tarea es backend; las tres rutas quedan marcadas «no — pendiente del panel de plataforma» en `docs/MATRIZ_RUTAS.md`).
- **Aviso no observado por HTTP:** el E2E sustituye `NotificacionService` por un espía (el mismo criterio con el que ya sustituye `ThrottlerStorage`): comprueba que el aviso se DESPACHA con el tipo y el destinatario correctos, no el transporte por la cola, que tiene sus propias pruebas.
- **Ruido de entorno observado durante el E2E:** la cola responde `ERR max requests limit exceeded` (cuota de Upstash agotada) al reconciliar reservas en el arranque. No afecta a esta tarea —la degradación es la de H62— pero conviene saber que el entorno local no está encolando nada de verdad. Es la causa de los 3 archivos rojos de la suite E2E completa, reproducidos sobre `main` sin esta rama (§5).
- **Lint:** `npm run lint` = **58 warnings, 0 errores** (`EXIT=0`), ninguna advertencia en los archivos nuevos o modificados de esta rama (las dos de `barberia.service.ts` son de la línea 281, código preexistente). `npm run build` (`nest build`) = OK.
- **No ejecutado:** `npm run check:integridad` (no hay migración nueva: la tarea no añade columnas ni tablas, así que no cambia ningún `CHECK` ni el esquema) y las corridas de zona horaria (`test:tz-utc`, `test:tz-santo-domingo`), que el CI cubre.

10. git status --short / git log -1 --oneline / git log --oneline -5

```text
$ git status --short
M  AUDITORIA_HALLAZGOS.md
M  backend-barberias/src/barberia/application/barberia.service.ts
A  backend-barberias/src/barberia/application/dto/listar-vinculaciones-pendientes.dto.ts
A  backend-barberias/src/barberia/application/dto/rechazar-vinculacion.dto.ts
A  backend-barberias/src/barberia/application/vinculacion.service.spec.ts
A  backend-barberias/src/barberia/application/vinculacion.service.ts
M  backend-barberias/src/barberia/barberia.module.ts
A  backend-barberias/src/barberia/domain/vinculacion.spec.ts
A  backend-barberias/src/barberia/domain/vinculacion.ts
A  backend-barberias/src/barberia/infrastructure/plataforma-vinculaciones.controller.ts
A  backend-barberias/test/e3-12-vinculacion.e2e-spec.ts
M  backend-barberias/test/permisos-matriz.spec.ts
M  docs/MATRIZ_CUMPLIMIENTO.md
M  docs/MATRIZ_RUTAS.md
A  reporte-e3-12.md

$ git log --oneline -5
5ab5907 Merge pull request #64 from Codecore-J/docs/e2-08-matriz-cumplimiento
1ae660f docs(e2-08): corrige la cabecera del plan y el nombre del informe
d2d8eac docs(e2-08): matriz de cumplimiento con evidencia y test por regla
12d7ffe Merge pull request #63 from Codecore-J/chore/psd5-guarda-vocabulario
04e48d6 test(psd5): la guarda de vocabulario vigila datos y frontend
```

El informe no incluye el hash del commit propio: `reporte-e3-12.md` viaja dentro de ese commit, que es el paso
siguiente de la rama. No hago merge. La rama queda subida y espera aprobación.
