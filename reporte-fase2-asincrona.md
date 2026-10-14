# Fase 2 · Infraestructura Asíncrona — primer paso: el alta de reserva deja de depender de la cola (H62)

**Rama:** `feat/infraestructura-asincrona` (apilada sobre `chore/sprint-estabilizacion-p3`, `63fde8b`)
**Fecha:** 2026-10-14 · **Alcance:** resiliencia del encolado BullMQ · **Cierra:** H62 · **Abre:** H63
**Estado:** implementado y verificado en local. **Sin push, sin merge y sin PR.**

---

## 1. CRITERIOS DE ACEPTACIÓN, UNO A UNO

| Criterio del encargo | Estado | Evidencia |
|---|---|---|
| Estar en `main` y crear `feat/infraestructura-asincrona` | ⚠️ **con desviación** | `main` **no** contenía las Olas 1-3 (ver §2). Con tu decisión, la rama se apila sobre `chore/sprint-estabilizacion-p3` |
| Revisar la configuración actual de Redis/BullMQ | ✅ | §3, con las cuatro colas y los cinco productores inventariados |
| Envolver el `enqueue` del alta en un `try/catch` | ✅ | `encolarConLimite` en `crearReserva` (§4) |
| Si el `enqueue` falla, **no** devolver 500 y **sí** permitir el 201 | ✅ | Prueba unitaria + E2E dirigido; rojo→verde medido (§6) |
| Registrar el fallo como **advertencia** | ✅ | `logger.warn('No se pudo encolar el job de expiración de la reserva …')`, asertado en el spec |
| Test unitario que demuestre que con el mock de BullMQ lanzando, el servicio sigue en éxito | ✅ | `H62 · el alta de la reserva no depende de la cola` (3 casos, §6.1) |
| Suite unitaria en verde | ✅ | `Test Files 48 passed (48)` / `Tests 520 passed (520)` / `EXIT=0` |
| Reporte de la implementación | ✅ | este documento |
| No hacer push ni merge | ✅ | la rama queda en local, `HEAD` = `63fde8b` + un commit sin enviar |

---

## 2. PREPARACIÓN · LA PREMISA DE PARTIDA NO SE SOSTENÍA

El encargo daba por hecho que el PR global estaba fusionado y que `main` ya contenía las Olas 1 y 2.
Comprobado contra el remoto, no era así:

```
$ git ls-remote origin main
b3af077e87136c81d94213bff90ddec5aad663a2   refs/heads/main     ← PR #56, 4 commits por detrás del sprint

$ git merge-base --is-ancestor 6e1de4b main   → NO
$ git merge-base --is-ancestor 63fde8b main   → NO
$ git log --oneline origin/main | grep -i estabiliza
bd95d79 Merge pull request #51 from Codecore-J/fix/h38-h49-estabilizar-e2e   ← lo único que aparece
```

Las tres ramas del sprint siguen **sin fusionar** en `origin` (`fix/sprint-estabilizacion-p1` = `02e6697`,
`fix/sprint-estabilizacion-p2` = `6e1de4b`, `chore/sprint-estabilizacion-p3` = `63fde8b`).

**Lo que sí se verificó antes de decidir:** el código que hay que tocar es el MISMO en las dos bases.
`git diff main..chore/sprint-estabilizacion-p3 -- src/reserva/application/reserva.service.ts` no tiene ni un
hunk cerca del `enqueue` (línea 819 en `main`, 837 en la rama), así que el arreglo no dependía de la base.
Con esa información elegiste **apilar sobre `chore/sprint-estabilizacion-p3`**, y eso es lo que se hizo:

```
$ git merge-base --is-ancestor chore/sprint-estabilizacion-p3 HEAD && echo apilada
apilada sobre chore/sprint-estabilizacion-p3 (SI)
```

---

## 3. CONFIGURACIÓN REVISADA (Fase 1 del encargo)

- **Conexión:** `src/app.module.ts` → `BullModule.forRoot({ connection: process.env.REDIS_URL ? new Redis(REDIS_URL, { maxRetriesPerRequest: null }) : { host, port } })`. El `maxRetriesPerRequest: null` es el que exige BullMQ **y es la pieza clave del H63/H62**: sin él, ioredis descartaría las órdenes; con él, las deja en su cola offline y la promesa no settlea.
- **Cuatro colas** (`src/shared/queues/queue.constants.ts`), registradas en sus módulos: `reservas-pendientes` (`reserva.module.ts`), `notificaciones` (`notificacion.module.ts`), `auditoria-purga` (`auditoria.module.ts`), `agenda-bloqueos` (`agenda.module.ts`).
- **Cinco puntos que hablan con la cola**, con su estado tras este paso:

| Punto | Llamada | ¿Puede tumbar una petición? | Estado |
|---|---|---|---|
| `reserva.service.ts` (`crearReserva`) | `add` del job de expiración | **Sí** (dentro de la transacción) → 500 | ✅ **resuelto aquí** (H62) |
| `expiracion-reserva.service.ts` (`reconciliar`) | `getJob` + `add` por reserva | No tumba la app (el arranque captura), pero abortaba el resto del bucle | ✅ **resuelto aquí** |
| `notificacion.service.ts` (`enviarNotificacion`, `programarRecordatorio`) | `add` | No: sus dos llamadores del alta son fire-and-forget con `.catch()` | Sin cambios (ya degradaba) |
| `agenda.service.ts` (`crearBloqueo`) | `add` del `liberar-bloqueo` + `jobId` en la misma transacción | Sí → 500 | Sin cambios **a propósito**: si el job no existe, el bloqueo nunca se liberaría; fallar es más honesto que degradar en silencio (no hay reconciliación de bloqueos) |
| `auditoria.service.ts` (`onModuleInit`) | `upsertJobScheduler` del cron de purga | **Sí, y más grave: impide el arranque** | ⬜ **H63**, documentado y no tocado |

---

## 4. CAMBIOS

```
 AUDITORIA_HALLAZGOS.md                             | 45 ++++++++++-
 .../application/expiracion-reserva.service.spec.ts | 35 ++++++++
 .../application/expiracion-reserva.service.ts      | 50 +++++++++---
 .../reserva/application/reserva.service.spec.ts    | 92 +++++++++++++++++++++-
 .../src/reserva/application/reserva.service.ts     | 35 ++++++--
 5 files changed, 236 insertions(+), 21 deletions(-)
```

Archivos NUEVOS (no rastreados hasta este commit):

```
 backend-barberias/src/shared/queues/encolado-seguro.ts        82 líneas
 backend-barberias/src/shared/queues/encolado-seguro.spec.ts   55 líneas
```

| Archivo | Cambio |
|---|---|
| `src/shared/queues/encolado-seguro.ts` (+ spec) | `encolarConLimite(encolar, timeoutMs?)`: ejecuta el encolado contra un temporizador (`ENCOLADO_TIMEOUT_MS = 2000`), devuelve `{ ok, valor \| motivo, encoladoEnMs }` y **nunca lanza** |
| `src/reserva/application/reserva.service.ts` | el `add` del job de expiración pasa por el helper; `log` si entra, `warn` si no. El `jobId` determinista y el `delay` de 10 min no cambian |
| `src/reserva/application/expiracion-reserva.service.ts` | el bloque `getJob` + `add` de cada reserva pasa a ser best-effort independiente y con techo |
| `src/reserva/application/reserva.service.spec.ts` | describe `H62 · el alta de la reserva no depende de la cola`: rechazo de la cola, cuelgue de la cola y guardia de que un fallo de escritura sigue propagándose |
| `src/reserva/application/expiracion-reserva.service.spec.ts` | una reserva que no se puede reencolar no impide reencolar las siguientes |
| `AUDITORIA_HALLAZGOS.md` | H62 marcado RESUELTO (ficha + tabla) y abierta la sección de la Fase 2 con **H63** |

---

## 5. DECISIONES DE DISEÑO (y por qué)

- **El helper no es un `try/catch`: lleva techo de tiempo.** Medido antes de escribir una línea de código. Con `maxRetriesPerRequest: null`:
  - contra un Redis sano → `[local] RESUELVE OK jobId=probe-local en 47ms`;
  - contra un puerto cerrado → `EXIT_REAL=124` (lo mató el `timeout 20`), y **cero** líneas de resolución o rechazo: `add` no falla, **espera para siempre**. Un `try/catch` habría dejado la petición HTTP —y su transacción con los `FOR UPDATE`— abiertas sin fin, que es peor que el 500 que se quería evitar.
- **El job de expiración es defensa en profundidad, no un requisito del alta.** El contrato que fija H62: el cliente sale con 201, el fallo queda en el log y `ExpiracionReservaService.reconciliar()` (que ya corría en `OnApplicationBootstrap`) es la red de seguridad, porque reencola las vigentes sin job con el MISMO `jobId` determinista que ya calcula `jobIdExpiracionReserva()`.
- **No se cambió el `jobId` ni el `delay`.** El `jobId` determinista es lo que hace que "perder" el job sea recuperable y que un reencolado no duplique: no se toca.
- **El techo es 2 s.** 47 ms medidos en local y unos cientos contra un Redis remoto: 2 s deja margen para una cola lenta y sigue siendo un límite útil para una cola muerta.
- **La orden no se cancela al vencer.** No hay forma de sacarla de la cola offline de ioredis; si Redis vuelve, el job entra igual. Eso es inofensivo (el `jobId` es determinista y el processor es idempotente) y se documenta en lugar de fingir una cancelación.
- **Se descartó el 503 con reintento.** Castigar al usuario por el fallo de un sistema que no es el suyo contradice el objetivo de la fase; y la reserva SÍ queda bien creada en la base.

---

## 6. PRUEBAS Y EVIDENCIA (salidas literales)

### 6.0 · Las sondas del comportamiento de la cola (desechables, no commiteadas)

Probe contra el `add` real de BullMQ (`queue.add('job', {...}, { delay: 60000 })`), con las mismas opciones de conexión que `app.module.ts`:

```
=== A) Redis local (control) ===
[local] RESUELVE OK jobId=probe-local en 47ms
=== B) Redis inalcanzable (puerto 6399, como 'Redis caído') ===
EXIT_REAL=124
--- mencion de RECHAZA/RESUELVE ---
0
```

Sonda de arranque, un módulo Nest con **solo** `BullModule.forRoot` + `registerQueue` contra el mismo puerto muerto:

```
[1] compilando un modulo MINIMO (solo BullModule.forRoot + registerQueue)...
    MODULO MINIMO COMPILADO en 569 ms
    APP MINIMA INICIADA
```

Conclusión: registrar colas sin Redis **no** bloquea el arranque; lo que bloquea es un `await` contra la cola durante el ciclo de vida (H63).

### 6.1 · ROJO — los tests nuevos fallan sin el arreglo (2026-10-14)

Con `git stash push` sobre los dos servicios implicados y los specs ya escritos:

```
 FAIL  src/reserva/application/reserva.service.spec.ts > ReservaService > H62 · el alta de la reserva no depende de la cola > VERDE: si el `add` RECHAZA (cuota agotada), la reserva se crea igual y el fallo queda como advertencia
 FAIL  src/reserva/application/reserva.service.spec.ts > ReservaService > H62 · el alta de la reserva no depende de la cola > ROJO: si el `add` NO resuelve ni rechaza (Redis inalcanzable), el alta no espera sin fin
 FAIL  src/reserva/application/expiracion-reserva.service.spec.ts > ExpiracionReservaService (E3-05) > reconciliar (arranque) > H62: una reserva que no se puede reencolar no impide reencolar las siguientes

 Test Files  2 failed (2)
      Tests  4 failed | 73 passed (77)
```

Causas literales, que son exactamente los dos síntomas medidos en producción:

```
AssertionError: promise rejected "Error: SimpleError [ReplyError]: ERR max requests limit exceeded. Limit: 500000, Usage: 500001" instead of resolving
Error: Test timed out in 5000ms.
```

### 6.2 · VERDE — suite unitaria completa (`npm test`)

```
 Test Files  48 passed (48)
      Tests  520 passed (520)
   Duration  13.02s
UNIT_EXIT=0
```

(La Ola 3 cerró en 47/511: +1 archivo —`encolado-seguro.spec.ts`— y +9 casos.)

### 6.3 · VERDE — E2E dirigido contra el Redis local (`REDIS_URL=redis://127.0.0.1:6379`)

```
 ✓ test/e3-03-validaciones.e2e-spec.ts (11 tests) 55033ms
     ✓ CONTROL: MANUAL → PENDIENTE, expira_at = ahora + 10 min y job de expiración  1603ms
     ✓ Race: 10 solicitudes simultáneas al mismo hueco → exactamente una 201 y nueve 409  13764ms
 ✓ test/e3-05-expiracion-cancelacion.e2e-spec.ts (9 tests) 41022ms
     ✓ VERDE: la reconciliación de arranque expira las vencidas y reencola las vigentes sin job  4778ms
 Test Files  2 passed (2)
      Tests  20 passed (20)
   Duration  103.59s
E2E_EXIT=0
```

Es la comprobación por la interfaz real: el alta responde 201 **y** el job sigue encolándose cuando la cola está sana.

### 6.4 · Lint, build y el intento de E2E con Redis muerto

```
npm run lint   → Found 54 warnings and 0 errors.  (208 archivos)   LINT_EXIT=0
npm run build  → nest build                                        BUILD_EXIT=0
```

```
# REDIS_URL=redis://127.0.0.1:6399 APP_ENV=dev npx vitest run --config ./vitest.config.e2e.ts test/e3-03-validaciones.e2e-spec.ts -t "CONTROL: MANUAL"
 FAIL  test/e3-03-validaciones.e2e-spec.ts > E3-03 · parte 2 — reglas de creación de reserva
Error: Hook timed out in 120000ms.
 Test Files  1 failed (1)
      Tests  11 skipped (11)
```

Este intento **no llegó a medir el alta**: se quedó en el `beforeAll`. No es un fallo del arreglo —con Redis inalcanzable la app ni siquiera completa su arranque—, es el hallazgo nuevo **H63** (§8).

---

## 7. LO QUE **NO** SE HIZO EN ESTE PASO

- **`getJob` en aceptar / rechazar / cancelar** sigue sin techo: con Redis inalcanzable esas rutas esperan. Quedan fuera del alcance pedido (el encargo hablaba del alta) y se listan como límite en la ficha de H62.
- **`agenda.service.ts` (`crearBloqueo`)**: no se tocó a propósito. Su job es la única vía de liberación del bloqueo y el `jobId` se escribe en la misma transacción; degradar en silencio dejaría un bloqueo eterno sin reconciliación que lo recupere.
- **Node API 2 (encolar después del commit)**: el encolado sigue dentro de `prisma.$transaction`. Moverlo fuera es el arreglo de fondo (no retendría los `FOR UPDATE` mientras la cola está degradada), pero cambia la estructura de `crearReserva` y se prefirió no mezclarlo con el arreglo de H62.
- **Reintentos del job (`attempts`/`backoff`)**: el job de expiración sigue con la política por defecto (1 intento). Si el processor falla en su momento, la reserva PENDIENTE no expira hasta el próximo arranque. Es una mejora de la fase, no de este paso.
- **H63**: medido, documentado y **sin tocar**.
- **Frontend**: intacto. **`.env`**: intacto (el E2E se corrió pasando `REDIS_URL` por entorno, como en la Ola 3).

---

## 8. HALLAZGO NUEVO: H63 — con Redis inalcanzable la API no arranca

- **Causa exacta:** `AuditoriaService.onModuleInit()` → `await this.configurarJobRecurrente()` → `purgaQueue.upsertJobScheduler(...)`. El método ya captura el caso «Redis responde con error» (por eso la app SÍ arrancó con la cuota agotada y solo fallaban las rutas), pero cuando Redis **no responde** esa promesa no resuelve nunca. Nest espera a `onModuleInit`, así que `app.init()` no termina.
- **Evidencia:** `Hook timed out in 120000ms` en el `beforeAll`, cero líneas `[Nest]` en el log, `Tests 11 skipped (11)`; y la sonda mínima (§6.0) demuestra que el registro de colas por sí solo arranca en 569 ms.
- **Impacto:** un Redis caído no degrada una ruta: **no levanta la instancia**. Es el mismo defecto de fondo que H62 (una llamada a Redis sin techo en el camino crítico), pero en el arranque.
- **Remedio propuesto:** envolver el registro del cron con `encolarConLimite` o trasladarlo a `onApplicationBootstrap` con reintento, de modo que la app arranque sin cola y registre el cron cuando Redis vuelva. Decidir, además, si se acota `getJob` donde quedó pendiente para que la degradación sea homogénea.
- **Estado:** **ABIERTO** (documentado en `AUDITORIA_HALLAZGOS.md`).

---

## 9. CÓMO REPRODUCIR (comandos literales)

```bash
# Unitarios (48 archivos / 520 casos)
cd backend-barberias && npm test

# El rojo: revertir el arreglo sin perder los tests
git stash push -- backend-barberias/src/reserva/application/reserva.service.ts \
                  backend-barberias/src/reserva/application/expiracion-reserva.service.ts
npx vitest run src/reserva/application/reserva.service.spec.ts src/reserva/application/expiracion-reserva.service.spec.ts
git stash pop

# E2E dirigido del alta (necesita el Redis del repo y una BD alcanzable)
docker compose up -d redis
REDIS_URL=redis://127.0.0.1:6379 APP_ENV=dev npx vitest run --config ./vitest.config.e2e.ts \
  test/e3-03-validaciones.e2e-spec.ts test/e3-05-expiracion-cancelacion.e2e-spec.ts

# H63: con Redis inalcanzable la app no arranca (esperado ~120 s de hook timeout)
REDIS_URL=redis://127.0.0.1:6399 APP_ENV=dev npx vitest run --config ./vitest.config.e2e.ts \
  test/e3-03-validaciones.e2e-spec.ts -t "CONTROL: MANUAL"

npm run lint ; npm run build
```

---

## 10. ESTADO FINAL

La rama `feat/infraestructura-asincrona` queda **apilada sobre `chore/sprint-estabilizacion-p3`**, con un
commit que cierra H62 y deja H63 documentado. **No se hizo push, no se hizo merge y no se abrió PR**, como
pediste. H62 pasa a **RESUELTO** en `AUDITORIA_HALLAZGOS.md` y la Fase 2 estrena su propio apartado con el
marcador de la fase.
