> Plantilla 8.4 de `docs/BACKLOG_BARBERIAS_V1.md`. Rama `feat/h72-listado-sedes-cliente` desde `main`
> (`4017878`, el merge del PR #66). **Push sin merge**, a la espera de aprobación.

# H72 · El cliente ya puede LISTAR sus sedes (y por fin alcanza su botón de salir)

**TAREA:** H72 — el `CLIENTE` no tenía ninguna forma de listar sus sedes; la tarjeta de su vínculo y el
botón «Desvincularme» de E3-12/3 solo se pintaban donde `GET /barberias` traía algo, y a un cliente puro le
devuelve `[]` porque filtra por `responsableId`.
**RAMA:** `feat/h72-listado-sedes-cliente`
**HALLAZGO:** resoluciones en `AUDITORIA_HALLAZGOS.md` → `H72 · … — **RESUELTO**`

---

## 1. QUÉ HICE

1. **La ruta que faltaba:** `GET /mi-estado/barberias` (`MiEstadoBarberiasController`, `@Roles('CLIENTE')`,
   fila 69 de `docs/MATRIZ_RUTAS.md`), con el acotado por `usuarioId` del token en el servicio.
2. **Los dos filtros del encargo, en la CONSULTA** (`ClienteBarberiasService.listarSedesDelCliente`):
   `estado_vinculacion IN ('ACTIVO','PENDIENTE_APROBACION')` (D10, la constante vive en
   `domain/vinculacion.ts`) y `barberias.estado = 'ACTIVO'` (E2-07). Nunca `DESVINCULADO`, nunca una sede
   suspendida.
3. **Contrato cerrado:** `BarberiaLecturaDto` (E1-05) más `estadoVinculacion` y `esBarberiaActiva`, sin
   `codigoAcceso` ni `enlaceUnico`; el `id` que viaja es el de la SEDE.
4. **Frontend:** `TenantService.cargarBarberias()` pregunta primero por responsabilidad y, si viene vacío,
   por vínculo; la tarjeta se extrajo a `SedeCardComponent` (sin servicios: `@Input` + `<ng-content>`) y el
   home del cliente pinta la MISMA tarjeta con el estado del vínculo visible.
5. **Pruebas:** E2E nuevo (12 casos: aislamiento, filtros, política y contrato) + 5 unitarios del servicio;
   matriz de permisos a 81 rutas y las unidades de `barberia.controller.spec.ts` que había dejado a medias
   la iteración interrumpida, corregidas en el mismo paso.

## 2. ARCHIVOS TOCADOS (`git diff --stat`, literal)

```
 AUDITORIA_HALLAZGOS.md                             |  15 +-
 .../application/cliente-barberias.service.spec.ts  | 126 ++++++++
 .../application/cliente-barberias.service.ts       |  93 ++++++
 backend-barberias/src/barberia/barberia.module.ts  |   6 +
 .../src/barberia/domain/vinculacion.ts             |  17 +
 .../infrastructure/barberia.controller.spec.ts     |  50 +++
 .../barberia/infrastructure/barberia.controller.ts |   3 +
 .../mi-estado-barberias.controller.ts              |  33 ++
 .../test/h72-listado-sedes-cliente.e2e-spec.ts     | 341 +++++++++++++++++++++
 backend-barberias/test/permisos-matriz.spec.ts     |  24 +-
 docs/MATRIZ_CUMPLIMIENTO.md                        |   2 +-
 docs/MATRIZ_RUTAS.md                               |  24 +-
 .../src/app/core/services/tenant.service.ts        |  62 +++-
 .../app/features/barberias/barberias.component.ts  | 147 +++------
 .../components/sede-card/sede-card.component.ts    | 152 +++++++++
 .../src/app/features/home/home.component.ts        |  61 +++-
 16 files changed, 1025 insertions(+), 131 deletions(-)
```

## 3. TEST ROJO (antes del fix, salida literal)

Dos rojos medidos, porque la tarea tiene dos mitades (la ruta y su regla de filtrado).

**(a) La ruta no existe** — medido en la iteración interrumpida, con el endpoint aún sin registrar:
`test/permisos-matriz.spec.ts` fallaba con `rutas sin decision en la matriz: GET /mi-estado/barberias` y la
unidad del controlador no compilaba (`ReferenceError: clienteBarberiasService is not defined`). Es el mismo
rojo que se capturó al escribir el E2E por primera vez: sin controlador, las 12 peticiones responden 404.

**(b) Los DOS filtros desactivados** (evidencia de que el E2E no pasa por casualidad) — con
`ClienteBarberiasService` consultando solo `usuarioId`:

```
 ❯ test/h72-listado-sedes-cliente.e2e-spec.ts (12 tests | 4 failed) 10167ms
       × 200: solo la activa y la pendiente, con la activa primero 657ms
       × excluye el vínculo DESVINCULADO: el historial no es una sede donde operar 313ms
       × excluye la barbería inactiva aunque el vínculo esté ACTIVO 584ms
       × el token de A no devuelve ninguna sede de B 315ms
⎯⎯⎯⎯ Failed Tests 4 ⎯⎯⎯
AssertionError: expected [ …(4) ] to deeply equal [ …(2) ]
AssertionError: expected [ …(4) ] to not include '781571f7-0299-4c9d-9bb5-d520346780e0'
AssertionError: expected [ …(4) ] to not include '1cb11da7-04c0-4e7a-9ea8-5113215aecc8'
AssertionError: expected [ { …(10) }, { …(10) }, …(2) ] to have a length of 2 but got 4
 Test Files  1 failed (1)
      Tests  4 failed | 8 passed (12)
```

El filtro restaurado vuelve a verde sin tocar ninguna prueba (ver §4).

## 4. TEST VERDE (después, salida literal)

```
 ✓ test/h72-listado-sedes-cliente.e2e-spec.ts (12 tests) 13094ms
       ✓ 200: solo la activa y la pendiente, con la activa primero  727ms
       ✓ el estado del vínculo viaja para que la tarjeta pueda anunciarlo  347ms
       ✓ no expone la puerta de entrada: sin codigoAcceso ni enlaceUnico  345ms
       ✓ excluye el vínculo DESVINCULADO: el historial no es una sede donde operar  340ms
       ✓ excluye la barbería inactiva aunque el vínculo esté ACTIVO  337ms
       ✓ la sede que existe pero no tiene vínculo tampoco aparece  343ms
       ✓ el token de A no devuelve ninguna sede de B  336ms
       ✓ el token de B solo trae la suya  681ms
 Test Files  1 passed (1)
      Tests  12 passed (12)
```

Y la pareja con la matriz HTTP de permisos (`APP_ENV=dev`, misma corrida):

```
 Test Files  2 passed (2)
      Tests  15 passed (15)
PAIR_EXIT=0
```

`test/permisos-matriz.e2e-spec.ts` aparte: `Test Files 1 passed (1)` / `Tests 3 passed (3)`
(`✓ denegar o permitir cada ruta segun el rol (51 rutas × 4 roles) 113918ms`).

## 5. SUITE COMPLETA

- **Backend, unitaria (`npx vitest run`, literal):**
  `Test Files  51 passed (51)` · `Tests  585 passed (585)` · `EXIT=0` (5 de esos casos son nuevos:
  `src/barberia/application/cliente-barberias.service.spec.ts`).
- **Matriz de rutas, literal:** `descubrir las 81 rutas del servidor y todas tienen decision` (era 80) y
  `RolesGuard concede a cada rol exactamente lo que dice la matriz` con `81 × 4 = 324` decisiones (era 320).
  `test/route-security.spec.ts`: `=== CONTEO === Public: 7 | Autenticado: 5 | Roles: 69 | ninguno: 0` y la
  fila nueva sale en la tabla como
  `/mi-estado/barberias | GET | MiEstadoBarberiasController | @Roles(CLIENTE)`.
- **Backend, build/lint:** `npm run build` (`nest build`) `EXIT=0`; `npm run lint` (`oxlint --type-aware`)
  `Found 74 warnings and 0 errors.` `LINT_EXIT=0` (los warnings son preexistentes).
- **Frontend:** `npm run lint` → `Found 0 warnings and 0 errors.` (`LINT_EXIT=0`); `ng build` →
  `Application bundle generation complete. [8.220 seconds]` (`BUILD_EXIT=0`); `npm run test -- --watch=false`
  → `Test Files 5 passed (5)` · `Tests 30 passed (30)` · `FE_TEST_EXIT=0`.

## 6. CRITERIOS DE ACEPTACIÓN

- [x] **Fase 1 · rama desde `main`.** `feat/h72-listado-sedes-cliente` sobre `4017878` (merge del PR #66),
      árbol limpio antes de empezar.
- [x] **Fase 2 · la ruta existe y la protege el rol.** `GET /mi-estado/barberias` con `@Roles('CLIENTE')`
      (sin `@Public`/`@Autenticado`, fail-closed por defecto). Evidencia: tabla de `route-security.spec.ts`
      (`ninguno: 0`), la matriz unitaria (324 decisiones) y el E2E de política: `401` sin token, `403` para
      `BARBERO` y para el `ADMIN_BARBERIA` de la sede, `200` y `[]` para el `ADMINISTRADOR` (jerarquía E1-04).
- [x] **Fase 2 · la consulta busca en `cliente_barberias` por el `usuarioId` del token.** La ruta no lleva
      `:barberiaId`, así que el guard no puede acotar nada: el `where.usuarioId` es del servicio y es lo
      único que separa un cliente de otro. Evidencia: unitario «filtra por el usuario del token…» y E2E
      «el token de A no devuelve ninguna sede de B».
- [x] **Fase 2 · solo `ACTIVO` o `PENDIENTE_APROBACION`; fuera `DESVINCULADO`.** Evidencia: E2E «excluye el
      vínculo DESVINCULADO» y unitario sobre `where.estadoVinculacion.in`, que además afirma que
      `DESVINCULADO` NO está en la lista.
- [x] **Fase 2 · fuera las barberías inactivas.** Evidencia: E2E «excluye la barbería inactiva aunque el
      vínculo esté `ACTIVO`» (fila con `estadoVinculacion = 'ACTIVO'` sobre una sede `INACTIVO`) y unitario
      sobre `where.barberia`.
- [x] **Fase 3 · el home del cliente consume el endpoint.** `TenantService.cargarBarberias()` cae a
      `GET /mi-estado/barberias` cuando el listado por responsabilidad viene vacío, y el home pinta la lista
      en la sección «Mis Barberías».
- [x] **Fase 3 · la lista se renderiza con la tarjeta de sede.** El bloque de tarjeta de
      `barberias.component.ts` se extrajo a `features/barberias/components/sede-card/sede-card.component.ts`
      y ahora lo usan las dos pantallas (`@for` sobre `tenantService.barberiasVinculadas()`).
- [x] **Fase 3 · el estado del vínculo es visible en la tarjeta.** La tarjeta rotula «Tu vínculo:
      `ACTIVO`/`PENDIENTE_APROBACION`/`DESVINCULADO`» y, cuando está pendiente, explica que todavía no se
      puede reservar; en el home el dato sale del propio listado (sin una petición extra por sede) y en
      «Tus Barberías» del `mi-estado` (H54), que trae además contador y restricción.
- [x] **Fase 4 · E2E de aislamiento y de filtros.** `test/h72-listado-sedes-cliente.e2e-spec.ts`, 12 casos:
      2 de aceptación, 3 de filtros, 2 de aislamiento y 5 de política/contrato. Rojo medido con los filtros
      desactivados (§3b) y verde con ellos puestos (§4).
- [x] **Fase 4 · suite unitaria del backend + lint y build del frontend.** §5.
- [x] **Fase 4 · `AUDITORIA_HALLAZGOS.md` marca H72 como RESUELTO**, con qué se hizo, la evidencia roja/verde
      y los límites honestos. Además se actualizaron `docs/MATRIZ_RUTAS.md` (fila 69, nota y cierre del
      hallazgo 5 de E1-06) y la nota de la regla 1.9 en `docs/MATRIZ_CUMPLIMIENTO.md`.
- [x] **Entrega:** este informe 8.4 y `push` de la rama. **Sin merge.**

## 7. DECISIONES O DESVIACIONES

1. **La ruta es `/mi-estado/barberias` (no `/barberias/mis-vinculaciones`).** El remedio que anotó E3-12
   sugería una ruta `@Autenticado` bajo `/barberias`; se desvía por dos motivos: (a) `/barberias` ya
   significa «las sedes donde YO SOY responsable» (fila 12 de la matriz) y colgar ahí un listado con otro
   criterio haría que la misma base dijera dos cosas según el rol; (b) el encargo pedía `CLIENTE`, y
   `mi-estado` es el espacio de lo que el usuario ve de SÍ MISMO, hermano de la fila 62.
2. **El `ADMIN_BARBERIA` y el `BARBERO` reciben 403 aquí** y no un listado vacío: sus listados existen por
   otra vía (`responsableId` para el dueño, `usuario_roles` para el barbero). Se documenta en el E2E para
   que la política no se «relaje» por comodidad.
3. **El frontend pregunta primero por responsabilidad y solo cae al vínculo si viene vacío.** La
   alternativa —leer el rol del token— obligaba a `TenantService` a depender de `AuthService` (ciclo de
   inyección) o a leer `authState()` antes de que `/auth/me` responda, que es exactamente el momento en que
   el `app-layout` dispara la carga. Con la caída por vacío el selector de sede funciona para los cuatro
   roles sin adivinar nada. Coste: una petición extra para quien no tiene sedes por responsabilidad.
4. **El estado del vínculo viaja en el listado, no se pide sede a sede.** El home podría haber reutilizado
   `mi-estado` (que además trae contador y restricción), pero eso sería N peticiones en una pantalla de
   aterrizaje. El E2E fija el contrato (`estadoVinculacion` y `esBarberiaActiva` en el payload) para que la
   tarjeta pueda anunciarlo sin más viajes.
5. **Se retiró la dependencia `uuid` que arrastraba la iteración interrumpida.** El borrador del servicio
   fabricaba un `id: uuidv4()` por fila; eso obligaba a una dependencia nueva (`backend-barberias/package.json`
   y `package-lock.json`) y devolvía un identificador que no corresponde a ningún recurso. El `id` que viaja
   es el de la SEDE, que es lo que el frontend necesita para `track` y para la sede activa; `package.json` y
   `package-lock.json` quedaron sin cambios.
6. **El botón «Seleccionar» no se ofrece sobre un vínculo `PENDIENTE_APROBACION`.** Se comprobó que
   `PATCH /barberias/:id/seleccionar` responde **403** para ese vínculo (D10), así que la tarjeta muestra
   «Esperando aprobación» en su lugar, en las dos pantallas. Sin esto, el botón recién alcanzable habría
   llevado a un 403 en el primer clic.
7. **Se corrigió la tarjeta compartida para no hablar de vínculos donde no los hay.** El antiguo bloque de
   `mi-estado` solo se pintaba si el padre había consultado el estado; ahora la tarjeta lo pinta también
   cuando la propia sede trae `estadoVinculacion` (el caso del cliente), y lo sigue ocultando para el staff
   —cuyo listado no trae ese campo—, de modo que un `ADMIN_BARBERIA` no lee «Tu vínculo: ACTIVO» sobre una
   sede que simplemente responsabiliza.

## 8. HALLAZGOS NUEVOS

1. **H73 (provisional) · El Redis de la máquina de desarrollo está por encima de su cuota y las colas de
   BullMQ no operan.** Severidad **Baja (entorno, no producto)**. Evidencia literal, repetida en cada
   corrida E2E: `SimpleError [ReplyError]: ERR max requests limit exceeded. Limit: 500000, Usage: 500001.
   See https://upstash.com/docs/redis/troubleshooting/max_requests_limit` para `bull:notificaciones:*`,
   `bull:agenda-bloqueos:*` y `bull:auditoria-purga:*`. Consecuencia práctica: una corrida encadenada puede
   abortar por el error no capturado de una cola y no por un fallo de negocio (se observó una vez: la
   primera corrida conjunta de H72 + permisos-matriz salió con `EXIT=1`, y la segunda, idéntica, pasó con
   `Test Files 2 passed (2)` / `Tests 15 passed (15)` / `PAIR_EXIT=0`). Ninguna prueba de esta entrega
   depende de las colas: el E2E siembra por Prisma y no encola nada. Conveniencia: rotar la instancia de
   Upstash o mover los E2E locales a un Redis de contenedor.
2. **H74 (provisional) · `TenantService` no limpia la sede activa cuando deja de tener sedes.** Severidad
   **Baja**. `cargarBarberias()` solo llama a `setBarberiaActiva` si encuentra alguna; con la lista vacía,
   `barberiaActiva()` y la caché de `localStorage` conservan la sede anterior. En el flujo que abre esta
   tarea se ve al desvincularse de la última sede: el roster queda vacío pero la cabecera sigue anunciando
   la sede cerrada, y `tenantGuard` (que lee la señal) puede dejar entrar a una pantalla de sede sin sedes.
   No se toca aquí porque exige decidir qué debe hacer el guard cuando el usuario se queda sin ninguna sede
   —¿redirigir a `/barberias`? ¿a `/`?—, y eso es una tarea de alcance propio. Evidencia: `tenant.service.ts`,
   rama `if (activa)` de `cargarBarberias`, y `core/guards/tenant.guard.ts`.

## 9. PENDIENTE O NO VERIFICADO

- **Suite E2E completa, no ejecutada.** Se ejecutaron los ficheros que esta tarea toca o pone en riesgo
  (`h72-listado-sedes-cliente`, `permisos-matriz` unitario y HTTP). El resto de la suite E2E arrastra la
  cuota de Redis de H73 y tardaría minutos por fichero; conviene una corrida completa con Redis sano antes
  de dar por bueno el conjunto.
- **Verificación visual en navegador, NO hecha.** El cambio de frontend está verificado con `oxlint`, `ng build`
  y las 30 pruebas existentes del frontend, pero no se levantó `ng serve` para mirar la sección «Mis
  Barberías» ni el recorrido «cliente con dos sedes → Desvincularme». Es la comprobación que queda pendiente
  de un recorrido real.
- **Sin migración.** La tarea no toca el esquema ni los datos: solo añade una lectura. `git status --short`
  no muestra migraciones nuevas.
- **H71/1.9 sin cambios:** esta tarea no toca la desvinculación ni el cupo de D10; solo hace alcanzable su
  botón.

## 10. GIT

```
 M AUDITORIA_HALLAZGOS.md
 A backend-barberias/src/barberia/application/cliente-barberias.service.spec.ts
 A backend-barberias/src/barberia/application/cliente-barberias.service.ts
 M backend-barberias/src/barberia/barberia.module.ts
 M backend-barberias/src/barberia/domain/vinculacion.ts
 M backend-barberias/src/barberia/infrastructure/barberia.controller.spec.ts
 M backend-barberias/src/barberia/infrastructure/barberia.controller.ts
 A backend-barberias/src/barberia/infrastructure/mi-estado-barberias.controller.ts
 A backend-barberias/test/h72-listado-sedes-cliente.e2e-spec.ts
 M backend-barberias/test/permisos-matriz.spec.ts
 M docs/MATRIZ_CUMPLIMIENTO.md
 M docs/MATRIZ_RUTAS.md
 M frontend-barberias/src/app/core/services/tenant.service.ts
 M frontend-barberias/src/app/features/barberias/barberias.component.ts
 A frontend-barberias/src/app/features/barberias/components/sede-card/sede-card.component.ts
 M frontend-barberias/src/app/features/home/home.component.ts
```

`git log --oneline -5` (antes del commit de esta rama):

```
4017878 Merge pull request #66 from Codecore-J/feat/e3-12-desvinculacion-cliente
bc5a347 feat(e3-12): la salida del cliente y el cupo de D10 (regla 1.9)
47ff6df Merge pull request #65 from Codecore-J/feat/e3-12-cierre-y-h71
f694bab feat(e3-12): reabrir el vínculo rechazado (D21) y bandeja de plataforma
29a9a0d feat(e3-12): la 6.ª vinculación ya tiene el flujo que la resuelve (D10 · H67)
```

**No se hace merge. La rama se deja empujada, a la espera de aprobación.**
