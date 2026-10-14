TAREA: H64 — separar la sonda de vida de la de preparación y apuntar `healthCheckPath` a la de vida
RAMA: `fix/h64-healthcheck-sondas`

1. QUÉ HICE (5 líneas máximo)

1. Añadí una sonda de VIDA `GET /health/liveness` · `/api/v1/health/liveness` (`@Public`, `@SkipThrottle`) que no toca base de datos ni Redis y responde `{ status: 'ok', uptimeSegundos, timestamp }`.
2. Dejé intacta la de PREPARACIÓN (`check()` en `/health` · `/api/v1/health`: base de datos, Redis y memoria), que sigue devolviendo 503 cuando falta la cola.
3. `render.yaml` pasa a `healthCheckPath: /api/v1/health/liveness`, y `src/main.ts` excluye del prefijo global las dos rutas nuevas, como ya hacía con las otras dos.
4. Registré la ruta en la matriz de permisos (fail-closed): `test/permisos-matriz.spec.ts` pasa a 76 rutas × 4 = 304 decisiones, y documenté la fila 64 en `docs/MATRIZ_RUTAS.md`.
5. Escribí primero el E2E con Redis caído (ROJO 3/5) y luego el arreglo (VERDE 5/5); medí además el apagado con SIGTERM para poder clasificar el hallazgo nuevo H66.

2. ARCHIVOS TOCADOS (git diff --stat, literal)

```
 AUDITORIA_HALLAZGOS.md                            | 54 ++++++++++++++++++-----
 backend-barberias/src/health/health.controller.ts | 37 +++++++++++++++-
 backend-barberias/src/main.ts                     |  7 ++-
 backend-barberias/test/permisos-matriz.spec.ts    | 17 ++++---
 docs/MATRIZ_RUTAS.md                              | 14 ++++++
 render.yaml                                       |  7 ++-
 6 files changed, 116 insertions(+), 20 deletions(-)
```

Fichero NUEVO (no rastreado hasta este commit):

```
 backend-barberias/test/h64-sondas-liveness.e2e-spec.ts   139 líneas
```

3. TEST ROJO (antes del fix, salida literal)

```
[H64] arranque con Redis en 127.0.0.1:60537 (nadie escucha): 922 ms
[H64] /api/v1/health/liveness → 404 {"message":"Cannot GET /api/v1/health/liveness","error":"Not Found","statusCode":404}
[H64] liveness con Redis caído: 7 ms
[H64] /api/v1/health (readiness) → 503 {"redis":{"status":"down","message":"Connection is closed."}}
 FAIL  test/h64-sondas-liveness.e2e-spec.ts > H64 · sondas de vida y de preparación
 FAIL  test/h64-sondas-liveness.e2e-spec.ts > H64 · sondas de vida y de preparación > VERDE CRÍTICO · GET /api/v1/health/liveness responde 200 con Redis caído
AssertionError: expected 404 to be 200 // Object.is equality
 FAIL  test/h64-sondas-liveness.e2e-spec.ts > H64 · sondas de vida y de preparación > la sonda de vida también se sirve sin el prefijo (/health/liveness)
 FAIL  test/h64-sondas-liveness.e2e-spec.ts > H64 · sondas de vida y de preparación > la sonda de vida NO toca la base de datos ni Redis
AssertionError: expected 404 to be 200 // Object.is equality
 Test Files  1 failed (1)
      Tests  3 failed | 2 passed (5)          ← EXIT=1
```

Las dos que pasaban son la guardia de arranque de H63 (922 ms con Redis caído) y la comprobación de que la
preparación **sí** devuelve 503: el rojo es exactamente «la ruta de vida no existe», no un problema del
entorno.

4. TEST VERDE (después, salida literal)

```
[H64] arranque con Redis en 127.0.0.1:62667 (nadie escucha): 1580 ms
[H64] /api/v1/health/liveness → 200 {"status":"ok","uptimeSegundos":6,"timestamp":"2026-10-14T18:50:25.321Z"}
[H64] liveness con Redis caído: 7 ms
[H64] /api/v1/health (readiness) → 503 {"database":{"message":"timeout of 1000ms exceeded","responseTime":1007,"status":"down"},"redis":{"status":"down","message":"Connection is closed."}}
[H64] app.close() con Redis caído: NO terminó en 5 s (H66)
 Test Files  1 passed (1)
      Tests  5 passed (5)                     ← EXIT=0
```

Y los dos E2E que ya existían, con el Redis del repositorio sano (preparación intacta):

```
$ APP_ENV=dev REDIS_URL=redis://127.0.0.1:6379 npx vitest run --config ./vitest.config.e2e.ts \
    test/health.e2e-spec.ts test/app.e2e-spec.ts
 Test Files  2 passed (2)
      Tests  4 passed (4)                     ← EXIT=0
```

5. SUITE COMPLETA: npm run test (resumen literal)

Primer intento, con el arreglo ya dentro: la matriz de permisos exige que una ruta nueva esté registrada, así
que la suite falla hasta que se declara — es el control fail-closed funcionando.

```
 FAIL  test/permisos-matriz.spec.ts > Matriz de permisos rol × ruta (E1-05) > RolesGuard concede a cada rol exactamente lo que dice la matriz
AssertionError: expected 304 to be 300 // Object.is equality
 Test Files  1 failed | 47 passed (48)
      Tests  1 failed | 525 passed (526)
```

Tras registrar la ruta y actualizar los dos contadores (`76 rutas` y `304` decisiones):

```
 Test Files  48 passed (48)
      Tests  526 passed (526)
   Duration  16.18s
UNIT_EXIT=0
```

Detalle literal de los dos inventarios que la propia suite imprime:

```
=== MATRIZ ROL × RUTA (76 rutas × 4 roles = 304 decisiones) ===
GET /health,api/v1/health                                  | si  | si  | si  | si
GET /health/liveness,api/v1/health/liveness                | si  | si  | si  | si
=== TABLA DE RUTAS (76) ===
/health,api/v1/health                          | GET | HealthController   | @Public
/health/liveness,api/v1/health/liveness        | GET | HealthController   | @Public
=== CONTEO === Public: 7 | Autenticado: 5 | Roles: 64 | ninguno: 0
```

Estáticos:

```
npm run lint   → Found 54 warnings and 0 errors.  (210 archivos)   LINT_EXIT=0
npm run build  → nest build                                        BUILD_EXIT=0
```

6. CRITERIOS DE ACEPTACIÓN

- [x] **Estar en `main` y crear `fix/h64-healthcheck-sondas`.** `main` local estaba en `7491c90` (1 commit por detrás del remoto): `git fetch origin --prune` → `origin/main` = `60ecd8b Merge pull request #59 from Codecore-J/feat/infraestructura-asincrona`, fast-forward de `main` y rama creada desde ahí. `git status --short` limpio antes de empezar.
- [x] **Endpoint `GET /api/v1/health/liveness` que solo verifica que Nest está vivo.** `liveness()` no usa `@HealthCheck()` ni ningún indicador: responde `{"status":"ok","uptimeSegundos":6,"timestamp":"…"}` y el E2E comprueba que no trae `info`/`details` (o sea, que no hay indicadores) y que tarda **7 ms** con Redis caído.
- [x] **Mantener la preparación comprobando base de datos y Redis.** `check()` sin cambios: `/health` y `/api/v1/health` siguen con `database`, `redis` y `memory_heap`; medido con Redis caído devuelve **503** con `redis: down`. El E2E con Redis sano (`test/health.e2e-spec.ts`) sigue en verde.
- [x] **`healthCheckPath` apuntando a la sonda de vida.** `render.yaml`: `healthCheckPath: /api/v1/health/liveness` (antes `/health`), con el motivo escrito en el propio fichero.
- [x] **Con Redis apagado (puerto cerrado), `liveness` responde 200.** Puerto libre reservado y liberado por el propio test para garantizar que nadie escucha: `200 {"status":"ok",…}` en **7 ms** y la app arrancando en **1,6 s**.
- [x] **Unitarios 100 % verdes.** `Test Files 48 passed (48)` / `Tests 526 passed (526)` / `EXIT=0`.
- [x] **`AUDITORIA_HALLAZGOS.md` con H64 RESUELTO.** Tabla F2.1 y ficha F2.4 reescrita (qué, cómo, evidencia roja y verde, trade-off); además quedan abiertos H65 y H66 (nuevos).
- [x] **Reporte con la plantilla 8.4.** Este documento.
- [x] **Push a la rama, sin merge.** Al final de este informe (§10).

7. DECISIONES O DESVIACIONES

1. **La sonda de vida no usa Terminus.** El encargo permitía «un chequeo básico de memoria o simplemente devolver `{ status: 'ok' }`». Se eligió lo segundo porque un umbral de memoria en la ruta que decide reinicios convierte presión de heap en un reinicio que no arregla nada, y porque sin indicadores la respuesta es determinista y de 7 ms.
2. **La vida se sirve con y sin prefijo** (`/health/liveness` y `/api/v1/health/liveness`), replicando el patrón de `/health`, y `src/main.ts` excluye las dos del prefijo global. El alias no estaba pedido: se añade por coherencia con la ruta que ya existía.
3. **No se añadió `/health/readiness`.** El encargo decía «`/api/v1/health` (o `/health/readiness`)»: se mantuvo la ruta como estaba para no ampliar el alcance. Si hace falta el nombre explícito, es una línea.
4. **Trade-off aceptado y documentado:** Render solo admite **una** ruta de comprobación, así que con la vida como `healthCheckPath` un despliegue puede declararse sano aunque la base no esté lista. Se prefiere que un Redis caído no provoque reinicios en bucle; la preparación queda en `/api/v1/health` para alertas o balanceador externo. Revertirlo es una línea de `render.yaml`.
5. **El E2E no afirma el estado del indicador de base de datos.** Dos corridas dieron `database: timeout of 1000ms exceeded` sirviendo la API con normalidad (H65). Se comprueba que el indicador *existe* (la preparación sí mira la base, la vida no) y no cuál es su estado, para no fabricar un test intermitente por una latencia ajena a H64.
6. **El `afterAll` acota `app.close()`.** Con Redis caído el cierre no termina (H66 medido): en vez de dejar que la suite fallara por el desmontaje, se espera un máximo de 5 s y se registra el resultado. El apagado se midió aparte con SIGTERM para clasificar el hallazgo.
7. **La fila 64 de `docs/MATRIZ_RUTAS.md` se numera al final**, no junto a la fila 7 (las dos son de `HealthController`), para no renumerar 56 filas ni romper las referencias del texto a «fila 57», «fila 62», etc. Queda explicado en el propio documento.

8. HALLAZGOS NUEVOS

- **H65 · severity Baja · abierto:** el `pingCheck` de la base de datos de la sonda de PREPARACIÓN usa el tope por defecto de Terminus (1000 ms) y la base de `dev` está en Neon (remota). Evidencia literal, en la corrida verde de H64 **y** en una anterior: `{"database":{"message":"timeout of 1000ms exceeded","responseTime":1007,"status":"down"}}` mientras la API servía con normalidad; en una corrida intermedia el mismo indicador salió `up`. No afecta a la vida; puede hacer parpadear una alerta de preparación. Remedio propuesto: subir el `timeout` del `pingCheck` y decidir si un timeout de base debe marcar `down`.
- **H66 · severity Baja hoy / Media si se añade apagado controlado · abierto:** con Redis caído `app.close()` no termina. Evidencia literal: `Error: Hook timed out in 10000ms` en el `afterAll` del E2E de H64 y, con espera acotada, `[H64] app.close() con Redis caído: NO terminó en 5 s (H66)`. En producción hoy no se nota porque `src/main.ts` **no** llama a `enableShutdownHooks()`: medido con el artefacto real, `SIGTERM` mata el proceso en **22 ms** (`SIGTERM: el proceso murió en 22 ms (code=null, señal=SIGTERM)`). Remedio propuesto: acotar el cierre de colas cuando se implemente apagado controlado.

9. PENDIENTE O NO VERIFICADO

- **No se corrió la suite E2E completa** (27 ficheros): se ejecutaron el E2E nuevo con Redis caído y los dos ficheros que tocan las rutas modificadas (`health`, `app`) con Redis sano. La afirmación «sin regresiones» vale para esos casos.
- **No se verificó en Render.** El cambio de `healthCheckPath` está en el repositorio, pero el comportamiento del orquestador (y que la ruta responda 200 en el arranque real del despliegue) no se puede comprobar desde aquí: queda para el siguiente despliegue.
- **No se midió el `SIGTERM` con Redis caído *y* `enableShutdownHooks()` activado**, porque esa opción no existe hoy en el código (por eso H66 se clasifica como riesgo futuro y no como fallo actual).
- **H65 y H66 siguen abiertos** y fuera del alcance de H64.
- **El frontend no se toca** y no consume estas rutas.

10. git status --short / git log -1 --oneline / git log --oneline -5

Estado **justo antes** de crear el commit de este cambio (es el que documenta el diff de §2; después del
commit el árbol queda limpio):

```
$ git status --short
 M AUDITORIA_HALLAZGOS.md
 M backend-barberias/src/health/health.controller.ts
 M backend-barberias/src/main.ts
 M backend-barberias/test/permisos-matriz.spec.ts
 M docs/MATRIZ_RUTAS.md
 M render.yaml
?? backend-barberias/test/h64-sondas-liveness.e2e-spec.ts

$ git log --oneline -5
60ecd8b Merge pull request #59 from Codecore-J/feat/infraestructura-asincrona
6200821 docs(fase2): deja medido el estado de merge de la rama (H63)
5113a4b fix(fase2): el arranque deja de depender de la cola de Redis (H63)
476648b feat(fase2): el alta de reserva deja de depender de la cola (H62)
63fde8b docs(estabilizacion): informe final 8.4 de la Ola 3 (P3 · Higiene)
```

Y ya con el commit de este cambio dentro:

```
$ git log -1 --oneline
cf7c027 fix(health): separa la sonda de vida de la de preparacion (H64)
$ git status --short
(árbol limpio)
```

11. ESTADO DEL COMMIT Y DEL PUSH

El commit que contiene el arreglo, el E2E y este informe es **`cf7c027`**
(`fix(health): separa la sonda de vida de la de preparacion (H64)`, 8 ficheros, +428/−20) y la rama
`fix/h64-healthcheck-sondas` queda **subida** a `origin`. **No se ha hecho merge**, como pediste: el PR se
abre en `https://github.com/Codecore-J/barberias-platform/pull/new/fix/h64-healthcheck-sondas`.

Nota de fidelidad: la sección 11 se completó **después** del commit, así que el commit que la contiene es uno
posterior (`docs(h64): completa el estado del commit en el informe`) que solo toca este fichero, tras lo cual
la rama se sube una sola vez.
