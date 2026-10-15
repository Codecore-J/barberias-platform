TAREA: E3-12/2 — Revinculación de D21 (cierra H71) y panel del Administrador
RAMA: feat/e3-12-cierre-y-h71

1. QUÉ HICE (5 líneas máximo)

1. Cerré H71: `vincularCliente` ya no devuelve la fila muerta —si el vínculo del par (usuario, sede) está `DESVINCULADO`, lo REABRE EN EL SITIO (`UPDATE` por `id`, no otra fila) con el estado que le toca hoy por D10— y el rechazo de la 6.ª deja de ser un callejón sin salida.
2. La reapertura conserva el historial de D20 (solo se escribe `estadoVinculacion`), audita `VINCULACION_REACTIVADA` con anterior y nuevo DENTRO de la transacción (D28) y avisa a los ADMINISTRADOR si vuelve a quedar pendiente (best-effort, DESPUÉS del commit).
3. La bandeja de E3-12 ya tiene panel: `/admin/vinculaciones` (tabla, Aprobar y Rechazar con modal de motivo) cableado a las tres rutas de `/plataforma/vinculaciones`.
4. Las bandejas de la plataforma siguen siendo del ADMINISTRADOR global, y el panel lo respeta: `authGuard` + `roleGuard(['ADMINISTRADOR'])` y SIN `tenantGuard` (es transversal, no de una sede).
5. Verde: E2E dirigido 23/23, unitarios dirigidos 55/55, suite unitaria completa 567/567 (50 archivos) con `EXIT=0`, frontend 24/24, `ng build` OK y lint 0 errores en los dos proyectos.

2. ARCHIVOS TOCADOS (git diff --stat, literal)

```
 AUDITORIA_HALLAZGOS.md                             |  31 +++--
 .../barberia/application/barberia.service.spec.ts  | 130 +++++++++++++++++++++
 .../src/barberia/application/barberia.service.ts   | 126 ++++++++++++++++++--
 .../test/e3-12-vinculacion.e2e-spec.ts             |  83 +++++++++++++
 docs/MATRIZ_CUMPLIMIENTO.md                        |  14 +--
 docs/MATRIZ_RUTAS.md                               |  17 ++-
 frontend-barberias/src/app/app.routes.ts           |  12 ++
 .../src/app/shared/layout/app-layout.component.ts  |   8 ++
 8 files changed, 392 insertions(+), 29 deletions(-)
```

**Nuevos (sin seguimiento):** `frontend-barberias/src/app/core/services/vinculaciones.service.ts` (+ spec), `frontend-barberias/src/app/features/admin/vinculaciones/admin-vinculaciones.component.ts`, `reporte-e3-12-cierre-y-h71.md`.

**Tocados:** `src/barberia/application/barberia.service.ts` (`vincularCliente` + aviso best-effort), `src/barberia/application/barberia.service.spec.ts` (+4 casos), `test/e3-12-vinculacion.e2e-spec.ts` (+4 casos), `frontend-barberias/src/app/app.routes.ts` (ruta `admin/vinculaciones`), `frontend-barberias/src/app/shared/layout/app-layout.component.ts` (entrada de menú, escritorio y móvil), `docs/MATRIZ_RUTAS.md`, `docs/MATRIZ_CUMPLIMIENTO.md`, `AUDITORIA_HALLAZGOS.md`.

3. TEST ROJO (antes del arreglo, salida literal)

Con `vincularCliente` revertido a `git checkout -- backend-barberias/src/barberia/application/barberia.service.ts` (y restaurado después: `md5sum -c` → `OK`, mismo contenido que antes del experimento). Salida filtrada con `grep` sobre el resumen:

```
       × H71 · reabre un vínculo DESVINCULADO y lo devuelve a la bandeja si el cliente sigue por encima del límite 11ms
       × H71 · con hueco libre la fila vuelve ACTIVA (D21) y no hay nada que avisar a la plataforma 5ms
 FAIL  src/barberia/application/barberia.service.spec.ts > BarberiaService > vincularCliente (T2.2) > H71 · reabre un vínculo DESVINCULADO y lo devuelve a la bandeja si el cliente sigue por encima del límite
AssertionError: expected "vi.fn()" to be called with arguments: [ { where: { …(2) } } ]
 FAIL  src/barberia/application/barberia.service.spec.ts > BarberiaService > vincularCliente (T2.2) > H71 · con hueco libre la fila vuelve ACTIVA (D21) y no hay nada que avisar a la plataforma
AssertionError: expected "vi.fn()" to be called with arguments: [ Array(1) ]
 Test Files  1 failed (1)
```

Los dos casos miden el `UPDATE` que no ocurría (`prisma.clienteBarberia.update` no se llamaba). Los dos casos de idempotencia NO fallan con el código viejo, que es lo correcto: miden comportamiento que ya existía y que no se debía romper.

El mismo experimento en el E2E (los cuatro casos nuevos de H71, todos en rojo):

```
       × el cliente rechazado vuelve a introducir el código y su vínculo se reabre 676ms
       × la plataforma recibe el aviso de que hay algo que aprobar otra vez 1008ms
       × la vinculación reabierta vuelve a la bandeja: ya no hay callejón sin salida 401ms
       × la segunda oportunidad termina bien: se aprueba y el cliente ya opera 537ms
 FAIL  test/e3-12-vinculacion.e2e-spec.ts > E3-12 · aprobación de la 6.ª vinculación (D10) > H71 · revincular reabre el vínculo cerrado (D21) > el cliente rechazado vuelve a introducir el código y su vínculo se reabre
AssertionError: expected { …(9) } to match object { …(2) }
 FAIL  test/e3-12-vinculacion.e2e-spec.ts > ... > la plataforma recibe el aviso de que hay algo que aprobar otra vez
AssertionError: expected "vi.fn()" to be called with arguments: [ ObjectContaining{…} ]
 FAIL  test/e3-12-vinculacion.e2e-spec.ts > ... > la vinculación reabierta vuelve a la bandeja: ya no hay callejón sin salida
AssertionError: expected undefined to match object { …(4) }
 FAIL  test/e3-12-vinculacion.e2e-spec.ts > ... > la segunda oportunidad termina bien: se aprueba y el cliente ya opera
 Test Files  1 failed (1)
```

4. TEST VERDE (después, salida literal)

```
 ✓ test/e3-12-vinculacion.e2e-spec.ts (23 tests) 27170ms
       ✓ la vinculación aprobada ya no aparece en la bandeja  662ms
       ✓ el ADMINISTRADOR rechaza con motivo: DESVINCULADO, auditado y avisado  1655ms
       ✓ el vínculo rechazado sigue sin autorizar la sede (403)  523ms
       ✓ el cliente rechazado vuelve a introducir el código y su vínculo se reabre  1209ms
       ✓ la vinculación reabierta vuelve a la bandeja: ya no hay callejón sin salida  479ms
       ✓ la segunda oportunidad termina bien: se aprueba y el cliente ya opera  2264ms

 Test Files  1 passed (1)
      Tests  23 passed (23)
   Duration  27.17s
EXIT=0
```

(19 casos antes de esta rama: **+4**, los de H71. El caso «la plataforma recibe el aviso…» también pasa y quedó fuera del recorte del `tail`.)

```
 ✓ src/barberia/application/barberia.service.spec.ts (55 tests) 1089ms

 Test Files  1 passed (1)
      Tests  55 passed (55)
   Duration  3.25s
VERDE_EXIT=0
```

(51 casos antes: **+4**.)

Frontend, con el servicio nuevo incluido:

```
 ✓  frontend-barberias  src/app/core/services/vinculaciones.service.spec.ts (7 tests) 81ms
 ✓  frontend-barberias  src/app/core/services/servicios.service.spec.ts (8 tests) 107ms
 ✓  frontend-barberias  src/app/core/guards/role.guard.spec.ts (7 tests) 57ms
 ✓  frontend-barberias  src/app/app.spec.ts (2 tests) 92ms

 Test Files  4 passed (4)
      Tests  24 passed (24)
FE_TEST_EXIT=0
```

(17 casos antes: **+7**. El CI ejecuta esta suite: `npm run test -- --watch=false` en `.github/workflows/ci.yml`.)

`ng build` (Angular, producción):

```
chunk-B5QSbp9G.js   | admin-vinculaciones-component |  13.32 kB |  3.87 kB
Application bundle generation complete. [9.338 seconds]
BUILD_EXIT=0
```

5. SUITE COMPLETA (resumen literal)

```
 Test Files  50 passed (50)
      Tests  567 passed (567)
   Duration  14.35s
UNIT_EXIT=0
```

(50 archivos y 563 pruebas antes de esta rama: **+4 casos**, ninguno de archivo.)

**Suite E2E completa (`npm run test:e2e`, 2026-10-15):**

```
 FAIL  test/e3-04-aceptar-rechazar.e2e-spec.ts > E3-04 · aceptar y rechazar solicitudes MANUALES
 FAIL  test/e3-05-expiracion-cancelacion.e2e-spec.ts > E3-05 · expiración automática y cancelación manual
 FAIL  test/health.e2e-spec.ts > Healthcheck Probes & Observability (MON-01) > debe responder HTTP 200 en /health con probes reales de base de datos y memoria
 FAIL  test/health.e2e-spec.ts > Healthcheck Probes & Observability (MON-01) > debe responder HTTP 200 en /api/v1/health para clientes de API y frontend
 Test Files  3 failed | 27 passed (30)
E2E_EXIT=1
```

Son los MISMOS tres archivos rojos que ya reportó E3-12/1 sobre esta rama y sobre `main` (`reporte-e3-12.md` §5): con la cuota de Redis agotada la cola rechaza, los `getJob` devuelven `undefined` (e3-04 y e3-05) y la sonda de preparación responde 503 (H65). `test/e3-12-vinculacion.e2e-spec.ts` NO está entre los rojos: la rama no toca reservas, colas ni la sonda, y el caso que sí cruza la cola (el aviso de la reapertura) es best-effort por diseño. **Aviso de entorno:** esta misma suite dio `2 failed | 28 passed` en una corrida previa hoy (la sonda `/health` pasó esa vez); el rojo intermitente del indicador de base es H65, no esta rama.

6. CRITERIOS DE ACEPTACIÓN: lista con [x] y la evidencia de cada uno

- [x] **Rama desde el punto correcto** — `feat/e3-12-cierre-y-h71` desde `29a9a0d` (el commit de E3-12/1). **Desviación del encargo, explicada en §7.1:** `main` NO contiene E3-12/1 todavía (su PR sigue abierto en `origin/feat/e3-12-aprobacion-vinculaciones`), y esta rama IMPORTA `ESTADOS_VINCULACION` / `LIMITE_VINCULACIONES` de `src/barberia/domain/vinculacion.ts`, que solo existe en ese commit: ramificar desde `main` no compilaría.
- [x] **`vincularCliente` actualiza (UPDATE) la fila `DESVINCULADO` en vez de devolverla** — `src/barberia/application/barberia.service.ts` (`tx.clienteBarberia.update({ where: { id: existing.id }, data: { estadoVinculacion } })`). Un vínculo VIVO (`ACTIVO`, `PENDIENTE_APROBACION`) se sigue devolviendo tal cual. Evidencia: los 4 casos unitarios nuevos y los 4 del E2E.
- [x] **La fila vuelve a `PENDIENTE_APROBACION` cuando el cliente sigue por encima del límite** — el estado no es un literal: es el que le toca hoy por D10. Evidencia: caso «reabre un vínculo DESVINCULADO y lo devuelve a la bandeja si el cliente sigue por encima del límite» (unitario) y «el cliente rechazado vuelve a introducir el código y su vínculo se reabre» (E2E, con la fila en base y el evento de auditoría).
- [x] **Se notifica al admin** — `VINCULACION_PENDIENTE_APROBACION` a cada `ADMINISTRADOR`, best-effort y DESPUÉS del commit (el `UPDATE` ya está confirmado aunque la cola falle). Evidencia: unitario «con hueco libre … no hay nada que avisar» (no se avisa cuando no hay nada que aprobar) y E2E «la plataforma recibe el aviso de que hay algo que aprobar otra vez».
- [x] **El historial de D20 se conserva** — el `UPDATE` solo escribe `estadoVinculacion`: `contador_no_presentado`, `esta_restringido` y `motivo_restriccion` no se tocan (ni `es_barberia_activa`, ver §9).
- [x] **D28: el cambio se audita en la misma transacción** — evento `VINCULACION_REACTIVADA` con anterior (`DESVINCULADO`) y nuevo, y con el `tx` como segundo argumento. Evidencia: E2E que lee `auditoria` y comprueba `usuarioId`, `entidadId` y `contexto`.
- [x] **La 6.ª reabierta no se cuenta a sí misma** — el conteo usa `NOT: { id: existing.id }`: es la MISMA vinculación que vuelve, no una séptima. Evidencia: unitario que afirma el `count` con ese `where`.
- [x] **Panel del Administrador Global con la bandeja** — `/admin/vinculaciones`, tabla con cliente, sede, nº de barberías y fecha; `features/admin/vinculaciones/admin-vinculaciones.component.ts`. Consume `GET /plataforma/vinculaciones/pendientes`. Evidencia: 7 casos nuevos de `vinculaciones.service.spec.ts` y `ng build` con el chunk propio.
- [x] **Botones «Aprobar» y «Rechazar» cableados** — `POST .../:id/aprobar` y `POST .../:id/rechazar { motivo }`; el rechazo pasa por un modal con motivo obligatorio (mínimo 10 caracteres, el mismo que exige el servicio, que responde 422 `MOTIVO_REQUERIDO`). Tras resolver, la bandeja se recarga sola.
- [x] **Tests unitarios de la revinculación (H71)** — 4 casos en `barberia.service.spec.ts` (reapertura pendiente + auditoría + aviso; reapertura activa sin aviso; idempotencia de `ACTIVO` y de `PENDIENTE_APROBACION` con `it.each`).
- [x] **Suite E2E y unitaria del backend** — unitaria 567/567 (`EXIT=0`); E2E dirigido de la tarea 23/23; E2E completa con los 3 archivos rojos preexistentes de cola/H65 (§5).
- [x] **El frontend compila** — `ng build` OK (`BUILD_EXIT=0`) y `npm run test -- --watch=false` 24/24.
- [x] **H71 marcado como RESUELTO en `AUDITORIA_HALLAZGOS.md`** — nota de la 6.ª iteración, fila del marcador de la fase y ficha §F2.8 reescrita con rojo, verde y límites.
- [x] **Push de la rama, sin merge** — `feat/e3-12-cierre-y-h71` subida a `origin`. No se hace merge.

7. DECISIONES O DESVIACIONES (con motivo)

1. **La rama sale del commit de E3-12/1, no de `main`.** El encargo pedía «`main` después de fusionar tu PR anterior», pero ese PR sigue **abierto** (`origin/feat/e3-12-aprobacion-vinculaciones` = `29a9a0d`, PR sin fusionar; `main` sigue en `5ab5907`). Además de ser el único punto coherente, es el único que compila: `vincularCliente` usa `ESTADOS_VINCULACION` y `LIMITE_VINCULACIONES` de `src/barberia/domain/vinculacion.ts`, que introdujo ese commit. Consecuencia práctica: el PR de esta rama debe abrirse DESPUÉS de fusionar el de E3-12/1 (o fusionarse los dos juntos); si se abre antes, GitHub mostrará también los cambios de E3-12/1 en el diff.
2. **Se reabre la fila, no se crea otra.** D21 dice «reactiva la misma fila» y el `uk_cliente_barberia` (usuario, sede) lo impediría de todos modos. Un `create` habría fallado con una violación de unicidad dentro de una transacción `SERIALIZABLE`.
3. **El estado de la reapertura se calcula, no se fija.** Fijarlo en `PENDIENTE_APROBACION` habría sido lo más simple, pero es incorrecto: si el cliente ya tiene hueco (sus vínculos bajaron por debajo del límite), dejar la fila pendiente crea una segunda espera que nadie pidió. Se reutilizan las constantes del dominio que usa el alta, así que el flujo que crea el estado y el que lo reabre no pueden divergir.
4. **El conteo excluye la fila que se reabre.** Contarla a sí misma inflaría el conteo en uno y mandaría a la plataforma una solicitud que, sin ella, ya cabría. Es la MISMA vinculación que vuelve: no consume un cupo nuevo.
5. **La idempotencia de T2.2 se conserva intacta.** Reintroducir el código de un vínculo VIVO devuelve la fila sin `UPDATE`, sin evento y sin segundo aviso: el comportamiento que ya probaba la suite (y que el E2E de E3-12 usa) no cambia. Solo la fila cerrada tiene camino nuevo.
6. **El aviso es en segundo plano y posterior al commit.** `avisarReaperturaPendiente` no se espera (`void … .catch()`) y los fallos se registran sin subir: una cola caída no puede dejar sin reabrir una vinculación que en la base ya está reabierta (mismo criterio que H62/H67). Se resuelven los destinatarios con `usuarioRol` y `distinct` por usuario, no con un `where` sobre usuarios: el rol es lo que define al ADMINISTRADOR.
7. **El panel es del ADMINISTRADOR y sin `tenantGuard`.** Es una pantalla transversal de la plataforma (el límite de D10 se cuenta por usuario, no por sede): pedir sede activa para decidir una sexta vinculación no tiene sentido y bloquearía al administrador global cuando no tenga ninguna seleccionada. El backend ya lo exige (`@Roles('ADMINISTRADOR')`, fail-closed).
8. **El rechazo captura el motivo con un modal, no con un `prompt`.** El encargo permitía las dos cosas; un `prompt` del navegador no se puede validar ni vestir, y el servicio exige un mínimo de 10 caracteres que la pantalla ahora comprueba antes de enviar (y muestra el 422 del backend si aun así llega mal). Es la misma decisión que ya tomó la bandeja de solicitudes de cambio (E3-13).
9. **El panel no decide nada por su cuenta.** Pinta lo que devuelve la bandeja y enseña el `mensaje` del contrato D40 tal cual: quien tiene la última palabra sobre si una vinculación se puede resolver es el servidor (409 `ESTADO_INVALIDO`, 403 de rol, 404 si no existe), y la pantalla no lo duplica.

8. HALLAZGOS NUEVOS

Ninguno. La ejecución CIERRA H71 y no abre hallazgos nuevos: los límites que quedan son de alcance (§9), no defectos medidos. En particular, el estado de `es_barberia_activa` tras una reapertura (a) se midió y hoy no es alcanzable por la vía normal.

9. PENDIENTE O NO VERIFICADO

- **Pendiente de E3-12 (no solicitado aquí):** enlace único/QR (punto 2 · matriz 1.10) y desvinculación a petición del cliente con bloqueo por reservas futuras (punto 3 · la otra mitad de la matriz 1.9).
- **`es_barberia_activa` en la reapertura:** la reapertura NO toca la marca. Si el cliente no tuviera ningún otro vínculo, la fila volvería `ACTIVO` sin ser la sede activa. Hoy no es alcanzable por la vía normal —la fila cerrada la produce el rechazo de una 6.ª, así que hay al menos 5 vínculos más— y el cliente puede fijarla con `PATCH /barberias/:id/seleccionar`; queda anotado como límite conocido en `AUDITORIA_HALLAZGOS.md` §F2.8 (a) en vez de ampliar el alcance con un cambio de comportamiento no pedido.
- **Sin tope de reintentos:** D21 pide que reintroducir el código reabra la fila y nada dice cuántas veces, así que un rechazo se puede volver a pedir de inmediato. El remedio propuesto por la auditoría («decidir si el rechazo debe bloquear el reintento con una ventana temporal») sigue siendo una decisión del dueño, no de esta ejecución.
- **El aviso no se observa por HTTP:** el E2E sustituye `NotificacionService` por un espía (el mismo criterio que ya usaba E3-12/1): comprueba que el aviso se DESPACHA con el tipo y el destinatario correctos, no el transporte por la cola, que tiene sus propias pruebas.
- **Ruido de entorno:** cuota de Upstash agotada (`ERR max requests limit exceeded`) durante toda la sesión; es la causa de los 3 archivos rojos del E2E completo (§5) y de que la sonda de preparación parpadee (H65).
- **No ejecutado:** `npm run check:integridad` (no hay migración: esta tarea no añade columnas, tablas ni `CHECK`) y las corridas de zona horaria (`test:tz-utc`, `test:tz-santo-domingo`), que el CI cubre.
- **Lint:** backend `67 warnings / 0 errores` (`EXIT=0`), frontend `0 / 0`. Ninguna advertencia nueva en los archivos de esta rama.

10. git status --short / git log --oneline -5

```text
$ git status --short
 M AUDITORIA_HALLAZGOS.md
 M backend-barberias/src/barberia/application/barberia.service.spec.ts
 M backend-barberias/src/barberia/application/barberia.service.ts
 M backend-barberias/test/e3-12-vinculacion.e2e-spec.ts
 M docs/MATRIZ_CUMPLIMIENTO.md
 M docs/MATRIZ_RUTAS.md
 M frontend-barberias/src/app/app.routes.ts
 M frontend-barberias/src/app/shared/layout/app-layout.component.ts
?? frontend-barberias/src/app/core/services/vinculaciones.service.spec.ts
?? frontend-barberias/src/app/core/services/vinculaciones.service.ts
?? frontend-barberias/src/app/features/admin/vinculaciones/

$ git log -1 --oneline
29a9a0d feat(e3-12): la 6.ª vinculación ya tiene el flujo que la resuelve (D10 · H67)

$ git log --oneline -5
29a9a0d feat(e3-12): la 6.ª vinculación ya tiene el flujo que la resuelve (D10 · H67)
5ab5907 Merge pull request #64 from Codecore-J/docs/e2-08-matriz-cumplimiento
1ae660f docs(e2-08): corrige la cabecera del plan y el nombre del informe
d2d8eac docs(e2-08): matriz de cumplimiento con evidencia y test por regla
12d7ffe Merge pull request #63 from Codecore-J/chore/psd5-guarda-vocabulario
```

El informe viaja dentro del commit propio de la rama (el `git log` de arriba es el de ANTES de commitear). No hago merge: la rama queda subida y espera aprobación, y su PR debe abrirse después (o junto) al de E3-12/1 — ver §7.1.
