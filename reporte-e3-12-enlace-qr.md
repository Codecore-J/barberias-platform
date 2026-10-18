TAREA: E3-12/2 — Enlace único y QR: la puerta de entrada del cliente (regla 1.10 · último punto de E3-12)
RAMA: feat/e3-12-enlace-qr

1. QUÉ HICE (5 líneas máximo)

1. Cerré la regla 1.10 (`NO-EXISTE` desde E2-08) y con ella el último punto de E3-12: la sede ya puede COMPARTIR su puerta de entrada y el cliente ya puede entrar por ella sin que nadie le dicte un código.
2. Backend: `GET /barberias/:id/invitacion` (código + `enlaceUnico`, solo para el `ADMIN_BARBERIA` de ESA sede o el `ADMINISTRADOR` global, 403 cross-sede) y `POST /mi-estado/unirse` (`@Roles('CLIENTE')`), que acepta el código o el enlace único y se apoya en el `vincularCliente` ya blindado: D10, la reapertura de D21 (H71) y su auditoría son las mismas, sin una segunda copia de la regla.
3. Frontend: el staff ve su código, su enlace y el QR de su sede (el QR se dibuja EN el navegador); el cliente tiene un campo «Unirme a una barbería» en su home que acepta el código, el enlace suelto o la URL completa del QR, y una pantalla `/unirse/:enlaceUnico` que es el destino del enlace impreso.
4. Verde: E2E dirigido 17/17 (`EXIT=0`), unitarios del servicio y de la matriz de permisos 4/4, suite unitaria del backend 597/597 (51 archivos), frontend 62/62 (7 archivos), `nest build` y `ng build` OK, `oxlint` sin errores en los dos proyectos y matriz de rutas a **83 rutas × 4 roles = 332** decisiones.
5. `docs/MATRIZ_CUMPLIMIENTO.md`: 1.10 `NO-EXISTE` → `OK-PROBADO` (resumen 65/3/1/2/1) y E3-12 cerrada entera; `docs/MATRIZ_RUTAS.md` con las filas 70 y 71; H75 nuevo en `AUDITORIA_HALLAZGOS.md`.

2. ARCHIVOS TOCADOS (git diff --stat, literal)

```text
 AUDITORIA_HALLAZGOS.md                             |  27 +-
 .../barberia/application/barberia.service.spec.ts  | 144 +++++++
 .../src/barberia/application/barberia.service.ts   | 103 ++++-
 .../application/dto/invitacion-sede.dto.ts         |  19 +
 .../application/dto/unirse-barberia.dto.ts         |  30 ++
 .../barberia/infrastructure/barberia.controller.ts |  18 +
 .../mi-estado-barberias.controller.ts              |  37 +-
 backend-barberias/test/e3-12-enlace-qr.e2e-spec.ts | 448 +++++++++++++++++++++
 backend-barberias/test/permisos-matriz.spec.ts     |  25 +-
 docs/MATRIZ_CUMPLIMIENTO.md                        |  13 +-
 docs/MATRIZ_RUTAS.md                               |  20 +
 frontend-barberias/package.json                    |   1 +
 frontend-barberias/src/app/app.routes.ts           |  12 +
 .../src/app/core/services/tenant.service.spec.ts   | 116 ++++++
 .../src/app/core/services/tenant.service.ts        |  76 +++-
 .../src/app/core/utils/invitacion.util.spec.ts     |  92 +++++
 .../src/app/core/utils/invitacion.util.ts          | 136 +++++++
 .../app/features/barberias/barberias.component.ts  | 151 ++++++-
 .../features/barberias/unirse/unirse.component.ts  | 129 ++++++
 .../src/app/features/home/home.component.ts        | 115 +++++-
 package-lock.json                                  |   7 +
 21 files changed, 1695 insertions(+), 24 deletions(-)
```

**Nuevos:** `src/barberia/application/dto/invitacion-sede.dto.ts`, `src/barberia/application/dto/unirse-barberia.dto.ts`, `test/e3-12-enlace-qr.e2e-spec.ts` (backend); `core/utils/invitacion.util.ts` (+ spec), `features/barberias/unirse/unirse.component.ts` (frontend); `reporte-e3-12-enlace-qr.md`.

**Tocados:** `barberia.service.ts` (+ su spec), `barberia.controller.ts`, `mi-estado-barberias.controller.ts`, `test/permisos-matriz.spec.ts`, `tenant.service.ts` (+ su spec), `barberias.component.ts`, `home.component.ts`, `app.routes.ts`, `frontend-barberias/package.json` + `package-lock.json` (dependencia nueva `qrcode-generator`), `docs/MATRIZ_CUMPLIMIENTO.md`, `docs/MATRIZ_RUTAS.md`, `AUDITORIA_HALLAZGOS.md`.

**De dónde parte la rama:** de `main` (`a8339ba`) MÁS el trabajo parcial sin commitear que quedó de la sesión interrumpida —las dos rutas esbozadas y el bloque estático de invitación—. Esta entrega lo termina y lo corrige (ver §7.1 y §7.2); el `git diff` de arriba ya lo incluye.

3. TEST ROJO (antes del fix, salida literal)

El E2E se escribió ANTES de tocar el servicio y corrió contra el árbol tal y como estaba (las rutas esbozadas, sin `enlaceUnico` y sin la comprobación de pertenencia). **17 casos, 8 rojos**:

```text
 ❯ test/e3-12-enlace-qr.e2e-spec.ts (17 tests | 8 failed) 16186ms
       ✓ sin token responde 401 (fail-closed) 4ms
       ✓ una sede inexistente responde 404 290ms
       ✓ ciclo completo: el cliente usa el código que el staff le entregó y queda ACTIVO  2955ms
       ✓ es idempotente: volver a introducir el código devuelve el MISMO vínculo  1858ms
       × el enlace único del QR entra igual, y con cinco vínculos previos nace PENDIENTE_APROBACION (D10) 218ms
       × el enlace del QR se acepta tal y como lo pega un humano: con espacios y en mayúsculas 507ms
       ✓ una sede INACTIVA no entrega vínculo: 404 (E2-07)  664ms
       × un código o un enlace inexistente responde 404 1011ms
       × sin código ni enlace responde 422 INVITACION_REQUERIDA (contrato D40) 218ms
       × con las DOS puertas a la vez responde 422 INVITACION_AMBIGUA 220ms
       ✓ un BARBERO no entra por aquí: la ruta es del CLIENTE (403) 219ms
       ✓ sin token responde 401 4ms

      Tests  8 failed | 9 passed (17)
```

Los errores, literales:

```text
 FAIL  test/e3-12-enlace-qr.e2e-spec.ts > ... > GET /barberias/:id/invitacion > el ADMIN_BARBERIA de la sede recibe su código y su enlace único
AssertionError: expected { …(10) } to match object { …(3) }
-   "barberiaId": "8eb7509d-ce23-46be-acb6-5c854a50cb6d",

 FAIL  test/e3-12-enlace-qr.e2e-spec.ts > ... > el ADMIN_BARBERIA de OTRA sede recibe 403: la puerta de entrada no se presta
Error: expected 403 "Forbidden", got 200 "OK"

 FAIL  test/e3-12-enlace-qr.e2e-spec.ts > ... > el enlace único del QR entra igual, y con cinco vínculos previos nace PENDIENTE_APROBACION (D10)
Error: expected 200 "OK", got 400 "Bad Request"

 FAIL  test/e3-12-enlace-qr.e2e-spec.ts > ... > un código o un enlace inexistente responde 404
Error: expected 404 "Not Found", got 400 "Bad Request"

 FAIL  test/e3-12-enlace-qr.e2e-spec.ts > ... > sin código ni enlace responde 422 INVITACION_REQUERIDA (contrato D40)
Error: expected 422 "Unprocessable Entity", got 400 "Bad Request"
```

Los 9 verdes del ROJO son el estado real de `main` y por eso NO se tocan: la unión por código existe desde T2.2 y es idempotente, la sede `INACTIVO` ya daba 404 (E2-07), el BARBERO ya recibía 403 y sin token ya era 401.

Un SEGUNDO rojo, del spec unitario del parser, al escribirlo antes del arreglo:

```text
 FAIL   frontend-barberias  src/app/core/utils/invitacion.util.spec.ts > parsearInvitacion · la puerta de entrada del cliente > devuelve null cuando no hay nada que leer: la pantalla avisa sin llamar al backend
AssertionError: expected { enlaceUnico: 'unirse' } to be null
 ❯ src/app/core/utils/invitacion.util.spec.ts:57:66
      Tests  1 failed | 61 passed (62)
```

Es decir: la primera versión leía `https://…/unirse/` (la ruta sin valor detrás) como `enlaceUnico: 'unirse'`. El caso estaba en el spec antes de existir el arreglo.

4. TEST VERDE (después, salida literal)

```text
 Test Files  1 passed (1)
      Tests  17 passed (17)
   Duration  19.84s (transform 942ms, setup 25ms, import 2.19s, tests 17.42s, environment 0ms)
EXIT=0
```

```text
 ✓ src/barberia/application/barberia.service.spec.ts (68 tests)   →  +6 de `obtenerInvitacion` y +6 de `vincularCliente` por enlace
 ✓ test/permisos-matriz.spec.ts (3 tests)
 ✓ test/route-security.spec.ts (1 test)
 Test Files  3 passed (3)
      Tests  72 passed (72)
EXIT=0
```

```text
 ✓ frontend-barberias  src/app/core/utils/invitacion.util.spec.ts (13 tests) 20ms
 ✓ frontend-barberias  src/app/core/services/tenant.service.spec.ts (19 tests) 119ms
 Test Files  7 passed (7)
      Tests  62 passed (62)
EXIT=0
```

Matriz de permisos (fail-closed), con las dos rutas nuevas descubiertas del servidor y su decisión declarada:

```text
GET /barberias/:id/invitacion                               | si  | si  | si  | si
POST /mi-estado/unirse                                      | si  | si  | si  | si
 ✓ test/permisos-matriz.spec.ts (3 tests) 219ms
 ✓ test/route-security.spec.ts (1 test) 224ms   → === CONTEO === Public: 7 | Autenticado: 5 | Roles: 71 | ninguno: 0
 Test Files  2 passed (2)
      Tests  4 passed (4)
```

5. SUITE COMPLETA: npm run test (resumen literal)

Backend (`npm run test`, `vitest run`):

```text
 === CONTEO === Public: 7 | Autenticado: 5 | Roles: 71 | ninguno: 0
 Test Files  51 passed (51)
      Tests  597 passed (597)
   Duration  8.59s (transform 5.22s, setup 0ms, import 70.25s, tests 22.80s, environment 12ms)
```

(50 archivos y 563 pruebas eran el estado de `main` según el informe de E3-12; H72, H74 y esta rama fueron sumando. En ESTA rama: +2 archivos de spec —`invitacion.util.spec.ts` y el E2E— y +25 casos unitarios.)

Frontend (`npm run test -- --watch=false`):

```text
 ✓  frontend-barberias  src/app/core/services/tenant.service.spec.ts (19 tests) 119ms
 ✓  frontend-barberias  src/app/core/utils/invitacion.util.spec.ts (13 tests) 20ms
 Test Files  7 passed (7)
      Tests  62 passed (62)
   Duration  2.52s
```

Otros comandos del encargo:

```text
backend:   npm run build   → nest build sin salida de error (EXIT=0)
backend:   npm run lint    → Found 79 warnings and 0 errors.
frontend:  npm run build   → Application bundle generation complete. [5.122 seconds]
frontend:  npm run lint    → Found 0 warnings and 0 errors.
```

Las 79 advertencias de `oxlint` del backend son las mismas que ya reportó E3-12 (58) más las de las ramas siguientes: **ninguna está en un archivo nuevo o modificado por esta rama** (la que se ve en la salida es de `reserva.service.spec.ts:1896`, preexistente).

**Suite E2E completa: no ejecutada.** Se ejecutó el E2E dirigido de esta tarea (17/17) y, como control, `test/e3-12-vinculacion.e2e-spec.ts` antes de tocar nada: `Tests  23 passed (23)` con su `afterAll` agotando los 60 s (`Error: Hook timed out in 60000ms`). Es el ruido ya documentado en **H73** (la cuota de Upstash de esta máquina está agotada: `ERR max requests limit exceeded. Limit: 500000, Usage: 500001`), no un fallo de negocio, y esta rama no encola nada que lo empeore. Ver §9.

6. CRITERIOS DE ACEPTACIÓN: lista con [x] y la evidencia de cada uno

- [x] **Rama desde `main` actualizado** — `feat/e3-12-enlace-qr` desde `a8339ba` (merge del PR #70). El árbol traía el trabajo parcial sin commitear de la sesión interrumpida; ver §7.1.
- [x] **El modelo de base confirmado sin migración nueva** — `ClienteBarberia` no cambia y `barberias` ya tiene `codigoAcceso` (UNIQUE) y `enlaceUnico` (UNIQUE) desde la migración base (`schema.prisma:100-101`), con el generador en `create` (`generateSlug` + sufijo). **No hace falta migración**: no se añade ni se cambia ninguna columna, tabla o CHECK — por eso no se ejecutó `check:integridad`.
- [x] **Ruta para que el staff obtenga su código de invitación** — `GET /barberias/:id/invitacion` (`barberia.controller.ts:149`), `@Roles('ADMIN_BARBERIA', 'ADMINISTRADOR')`, que responde `{ barberiaId, nombre, codigoAcceso, enlaceUnico }`. Evidencia: 7 casos del E2E (el admin de la sede, el global, el de otra sede 403, el BARBERO 403, el CLIENTE 403, sin token 401 y sede inexistente 404).
- [x] **Ruta de unión bajo el rol CLIENTE, apoyada en `vincularCliente`** — `POST /mi-estado/unirse` (`mi-estado-barberias.controller.ts:63`) llama a `BarberiaService.vincularCliente`; el servicio solo resuelve por qué puerta se nombra la sede (`resolverPuertaDeEntrada`). Evidencia: el E2E y los 6 casos nuevos de `barberia.service.spec.ts` (`where: { enlaceUnico: 'enlace-uno' }`, la 6.ª pendiente, el código solo recortado, `INVITACION_REQUERIDA`, `INVITACION_AMBIGUA` y el enlace inexistente sin crear vínculo).
- [x] **El ciclo completo pasa por el 200 y refresca el listado** — E2E «ciclo completo: el cliente usa el código que el staff le entregó y queda ACTIVO»: lee la invitación con el token del staff, la usa con el del cliente y comprueba que la sede ya está en `GET /mi-estado/barberias`. El frontend lo hace dentro de `TenantService.unirsePorInvitacion` (recarga tras el 200), fijado en `tenant.service.spec.ts`.
- [x] **La regla D10 se respeta por las DOS puertas** — E2E «el enlace único del QR entra igual, y con cinco vínculos previos nace `PENDIENTE_APROBACION`» (+ `esBarberiaActiva: false`) y el unitario de la sexta por enlace. La sexta por CÓDIGO ya la cubría `test/e3-12-vinculacion.e2e-spec.ts` y sigue verde: no hay una regla paralela, es la misma.
- [x] **Bloque de UI para copiar la invitación en el panel de la sede** — `features/barberias/barberias.component.ts`: código con su botón de copiar, enlace completo con el suyo y el QR de la sede, más el nombre de la sede. La invitación se pide para la sede activa (o la primera de la lista si el auto-pick todavía no la fijó) y se recarga al cambiar de sede.
- [x] **Campo «Unirme a una Barbería» en el home del cliente** — `home.component.ts`, con `parsearInvitacion` delante: acepta el código, el enlace suelto y la URL del QR; avisa sin llamar al backend si el texto no es ninguna de las dos; tras el 200 dice si el vínculo quedó `ACTIVO` o `PENDIENTE_APROBACION`.
- [x] **El enlace único del QR tiene destino** — ruta `unirse/:enlaceUnico` (`features/barberias/unirse/unirse.component.ts`) que consume la invitación y cuenta el resultado. Y el QR se genera EN el navegador: `qrDeInvitacion` no manda la invitación a ningún servicio externo.
- [x] **E2E del ciclo completo con 200 y regla D10** — `test/e3-12-enlace-qr.e2e-spec.ts`, 17 casos, ROJO 8/17 antes y VERDE 17/17 después (§3 y §4).
- [x] **Suite unitaria, linter y build de los dos proyectos** — §5, con la salvedad declarada de la suite E2E completa.
- [x] **Regla 1.10 en `OK-PROBADO`** — `docs/MATRIZ_CUMPLIMIENTO.md`: fila 1.10 reescrita con evidencia y tests, la nota de la sección 1, el bullet de «Lo que esta reconciliación deja a la vista» retirado y el resumen a **65 OK-PROBADO · 3 OK-SIN-TEST · 1 PARCIAL · 2 NO-EXISTE · 1 NO-VERIFICADO (72)**.
- [x] **Rutas nuevas en la matriz de permisos del CI** — `test/permisos-matriz.spec.ts`: 83 rutas × 4 roles = 332 decisiones, y filas 70/71 en `docs/MATRIZ_RUTAS.md` con el recuento actualizado.

7. DECISIONES O DESVIACIONES (con motivo)

1. **El punto de partida era `main` + trabajo parcial sin commitear.** La sesión anterior dejó en el árbol dos rutas esbozadas (`GET /barberias/:id/invitacion` devolviendo `findOne` y `POST /mi-estado/unirse` con el DTO del código) y un bloque estático de invitación que nunca recibía datos. Se conservó como punto de partida —es literalmente esta tarea— y se corrigió lo que estaba mal: `findOne` no valida pertenencia (devolvía 200 con los datos abiertos de una sede ajena) y el bloque pintaba un `signal` que nadie llenaba.
2. **La ruta usa `:id` y por eso la pertenencia la exige el servicio.** Es la misma desviación que ya tomaron E3-13 y la bandeja de restringidos: con `:id` el `RolesGuard` no resuelve la sede del parámetro. Se prefirió eso a renombrar a `:barberiaId` porque `GET /barberias/:id` (fila 11) ya usa `:id` y dos nombres para el mismo recurso en el mismo controlador sería peor; el 403 lo da `obtenerInvitacion` con la regla que YA entregaba el código en la lectura por id (`veCodigoDe`).
3. **200 y no 201 en `unirse`.** Lo pedía el encargo y es coherente con el módulo: `unirse` es un verbo de negocio sobre un vínculo (como `desvincular`, `aprobar` o `reactivar`) y es idempotente —reintentar el código devuelve la MISMA fila—, así que un 201 prometería un recurso nuevo en cada llamada. `POST /barberias/vincular` sigue devolviendo 201 y no se tocó.
4. **Exactamente UNA puerta de entrada, y el rechazo en 422 (D40).** Ni ninguna (`INVITACION_REQUERIDA`) ni las dos (`INVITACION_AMBIGUA`): aceptar las dos en silencio dejaría al cliente sin saber cuál se usó, y `forbidNonWhitelisted` no cubre un caso cruzado. Se valida ANTES de abrir la transacción serializable para no gastar una conexión en un cuerpo inválido.
5. **El enlace se normaliza; el código, no.** El enlace viaja IMPRESO (QR), así que llega con espacios y en cualquier caja: `trim` + minúsculas, que es como lo guarda `create`. El código de acceso solo se recorta: su alfabeto es de mayúsculas y reescribir lo que el usuario tecleó escondería un código mal copiado.
6. **El frontend tiene UNA puerta.** `vincularBarberia` (el modal que ya existía) pasa a ser `unirsePorInvitacion({ codigoAcceso })`: dos caminos hacia el mismo vínculo acaban teniendo dos mensajes de error distintos para el mismo fallo. El modal no cambia de comportamiento: cambia la ruta que llama.
7. **El QR se dibuja en el navegador con `qrcode-generator`.** Se descartó un servicio externo de QR (mandaría la puerta de entrada de una sede a un tercero para que la pinte) y se descartó escribirlo a mano (es un algoritmo entero que no es de este dominio). La dependencia no trae dependencias a su vez y publica sus tipos. El enlace se compone con el origen real de la pantalla (`urlDeInvitacion`): el backend no conoce —ni debe— el dominio del frontend.
8. **Un solo parser para las dos entradas.** `parsearInvitacion` lo usan el campo del home y la pantalla del enlace; acepta el código, el enlace suelto, la ruta relativa y la URL completa con query o fragmento. Los casos están en su spec, incluidos los que devuelven `null`.
9. **La pantalla de unión está bajo `authGuard`.** El vínculo que crea es de un CLIENTE concreto; sin sesión, el guard pide entrar antes. Consecuencia: **H75** (abajo), declarada y no escondida.
10. **No se tocó nada fuera del encargo.** Las otras tres mitades de E3-12 ya estaban cerradas (1.7, 1.8, 1.9) y no se reabrieron; no se añadió rotación ni caducidad de la invitación (el diseño 1.10 no las pide) y no se tocó la purga de la sede activa ni el arranque de sesión (de ahí que H75 quede para su propia tarea en vez de resolverse de paso cambiando el login de todos los roles).

8. HALLAZGOS NUEVOS (ID provisional, severidad, evidencia)

**H75 · Baja-Media · El enlace del QR pierde la invitación cuando lo abre alguien sin sesión.** La pantalla `unirse/:enlaceUnico` vive bajo `authGuard` y el guard devuelve `router.createUrlTree(['/auth/login'])` **sin `returnUrl`**; `AuthService.login` navega a `/`, `/admin/agenda` o `/barberias` según el rol, así que la URL original se pierde en cuanto la sesión empieza. Quien escanea un QR impreso sin tener cuenta (o con la sesión caducada) llega al login y, tras entrar, al dashboard: la invitación ya no está y solo le queda pedir el código o pegar el enlace a mano en el home (que sí funciona). Evidencia: `frontend-barberias/src/app/core/guards/auth.guard.ts` (el `createUrlTree` sin `queryParams`), `frontend-barberias/src/app/auth/login/login.component.ts` y la ruta de `app.routes.ts`. Remedio propuesto: `returnUrl` en el guard y navegación a esa URL en el `next` del login, con lista blanca de rutas internas; toca el arranque de sesión de TODOS los roles, así que merece su tarea y sus casos. Registrado en `AUDITORIA_HALLAZGOS.md` §F2.10.

**Fallo encontrado por el test nuevo (y corregido dentro de esta rama, sin llegar a `main`):** la primera versión de `parsearInvitacion` leía `https://…/unirse/` —la ruta sin valor detrás— como `enlaceUnico: 'unirse'`. Se corrigió exigiendo un valor DESPUÉS del segmento de ruta; el caso quedó fijado en `invitacion.util.spec.ts`.

9. PENDIENTE O NO VERIFICADO

- **Suite E2E completa: no ejecutada** (ver §5). Lo ejecutado es el E2E de la tarea (17/17) y el de la épica como control (23/23 con su `afterAll` agotando el tiempo por la cuota de Upstash). Con Redis disponible, `npm run test:e2e` debería encadenar los ~30 archivos sin que el aborto de una cola arrastre al proceso (**H73**).
- **Pruebas de componente: no existen en el proyecto.** Los dos bloques de interfaz nuevos (el de administración con el QR y la pantalla `/unirse/:enlaceUnico`) se verifican con `lint` y `build`, igual que declararon H72 y H74. Lo que sí es lógica —el parser, la composición de la URL, el QR y las dos llamadas del servicio— tiene casos unitarios.
- **Comprobación en navegador: no hecha.** No se levantó `ng serve` ni se recorrió el ciclo a mano; el ciclo se comprueba por HTTP en el E2E y por unidades en el frontend.
- **El QR no se escaneó con un lector real.** Se verifica que es una imagen embebible válida y que un enlace más largo produce un código mayor; que un teléfono lo lea es un paso de verificación manual pendiente.
- **No verificado por HTTP:** que el `enlaceUnico` del QR sea EXACTAMENTE el que resuelve el backend en un despliegue real (el E2E lo hace con la base de `dev`, que es la misma en la que se generan los enlaces).
- **No ejecutado:** `npm run check:integridad` (no hay migración nueva: la tarea no añade ni cambia columnas, tablas ni CHECK) y las corridas de zona horaria (`test:tz-utc`, `test:tz-santo-domingo`), que cubre el CI.

10. git status --short / git log -1 --oneline / git log --oneline -5

```text
$ git status --short
 M AUDITORIA_HALLAZGOS.md
 M backend-barberias/src/barberia/application/barberia.service.spec.ts
 M backend-barberias/src/barberia/application/barberia.service.ts
 M backend-barberias/src/barberia/infrastructure/barberia.controller.ts
 M backend-barberias/src/barberia/infrastructure/mi-estado-barberias.controller.ts
 M backend-barberias/test/permisos-matriz.spec.ts
 M docs/MATRIZ_CUMPLIMIENTO.md
 M docs/MATRIZ_RUTAS.md
 M frontend-barberias/package.json
 M frontend-barberias/src/app/app.routes.ts
 M frontend-barberias/src/app/core/services/tenant.service.spec.ts
 M frontend-barberias/src/app/core/services/tenant.service.ts
 M frontend-barberias/src/app/features/barberias/barberias.component.ts
 M frontend-barberias/src/app/features/home/home.component.ts
 M package-lock.json
 A backend-barberias/src/barberia/application/dto/invitacion-sede.dto.ts
 A backend-barberias/src/barberia/application/dto/unirse-barberia.dto.ts
 A backend-barberias/test/e3-12-enlace-qr.e2e-spec.ts
 A frontend-barberias/src/app/core/utils/invitacion.util.spec.ts
 A frontend-barberias/src/app/core/utils/invitacion.util.ts
 A frontend-barberias/src/app/features/barberias/unirse/unirse.component.ts
 A reporte-e3-12-enlace-qr.md

$ git log --oneline -5
a8339ba Merge pull request #70 from Codecore-J/feat/sincronizar-sede-activa-backend
844cec2 fix(hallazgo-2): la sede activa la autoriza y la registra el backend
4d34c50 Merge pull request #69 from Codecore-J/chore/ci-docker-limit-fix
c4187c7 Merge pull request #68 from Codecore-J/fix/h74-purga-tenant-cache
c4d9851 fix(h74): la sede activa del tenant se purga cuando su vínculo desaparece
```

El informe no incluye el hash del commit propio: `reporte-e3-12-enlace-qr.md` viaja dentro de ese commit, que es el paso siguiente de la rama. **No hago merge.** La rama queda subida y espera aprobación.

**Lo que este cierre deja dicho de E3-12:** las cuatro mitades de la épica están cerradas y probadas —la 6.ª vinculación y su bandeja (1.7/1.8, `NO-EXISTE` en E2-08), la vuelta del rechazo (D21 · H71), la salida del cliente con el cupo que vuelve (1.9) y la puerta de entrada por enlace único y QR (1.10)—. La regla 1.10 ya no es trabajo pendiente en `docs/MATRIZ_CUMPLIMIENTO.md`, y lo único que queda abierto alrededor es **H75**: que un QR escaneado sin sesión no conserve la invitación al pasar por el login.
