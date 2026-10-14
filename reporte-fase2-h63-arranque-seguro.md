# Fase 2 · Infraestructura Asíncrona — cierre de H63: arranque seguro con Redis caído

**Rama:** `feat/infraestructura-asincrona` (apilada sobre `chore/sprint-estabilizacion-p3`, `63fde8b`)
**Fecha:** 2026-10-14 · **Alcance:** arranque (bootstrap) tolerante a la caída total de Redis y degradación del encolado secundario
**Cierra:** H63 · **Abre:** H64 · **Continúa:** [reporte-fase2-asincrona.md](reporte-fase2-asincrona.md) (H62)
**Estado:** implementado y verificado en local, **con push** de la rama (iteración anterior: sin push)

---

## 1. CRITERIOS DEL ENCARGO, UNO A UNO

| Criterio pedido | Estado | Evidencia |
|---|---|---|
| El `onModuleInit` de auditoría no debe esperar de forma indefinida | ✅ | `onModuleInit(): void { void this.programarPurgaDiaria(); }` (§2) |
| Registro del cron con **tope estricto (3-5 s)** y error crítico si vence | ✅ | `REGISTRO_CRON_TIMEOUT_MS = 3000` + `logger.error('CRÍTICO: …')`; medido a los **6641 ms** de vida del proceso (§3) |
| Con Redis apagado, `Nest application successfully started` en **menos de 10 s** | ✅ | **3647 ms** (y **3901 ms** en la repetición), con `REDIS_URL=redis://127.0.0.1:6399` (§3) |
| Advertencias/logs de Redis visibles | ✅ | `ERROR [AuditoriaService] CRÍTICO: la cola de auditoría no respondió en 3000 ms …` + `WARN` de notificación (§3) |
| Suite unitaria completa en verde (48/520) | ✅ | `Test Files 48 passed (48)` / `Tests 526 passed (526)` / `EXIT=0` (§4.2) |
| `AUDITORIA_HALLAZGOS.md` con H63 **RESUELTO** | ✅ | tabla F2.1 + ficha F2.3 reescrita (§4.4) |
| `reporte-fase2-asincrona.md` con la sección de H63 corregida | ✅ | §8 pasa a RESUELTO y apunta aquí |
| Reporte final | ✅ | este documento |
| Push de la rama y prepararla para merge | ✅ | `origin/feat/infraestructura-asincrona` publicado; `main` intacto (§8) |

---

## 2. FASE 1 · LA CORRECCIÓN

### 2.1 · H63 causa 1 — el cron de auditoría bloqueaba el arranque

`src/auditoria/application/auditoria.service.ts`:

```ts
onModuleInit(): void {
  void this.programarPurgaDiaria();          // sin `await`: fuera de la cadena crítica
}

async programarPurgaDiaria(): Promise<ResultadoEncolado<void>> {
  const resultado = await encolarConLimite(
    () => this.configurarJobRecurrente(),
    REGISTRO_CRON_TIMEOUT_MS,               // 3000 ms
  );

  if (!resultado.ok) {
    this.logger.error(`CRÍTICO: la cola de auditoría no respondió en ${REGISTRO_CRON_TIMEOUT_MS} ms …`);
  }

  return resultado;
}
```

- **No se espera** y **además** hay tope: el encargo ofrecía las dos alternativas; se aplican juntas porque el tope solo no elimina el retraso (3 s por arranque y por réplica) y el `void` solo no deja rastro en el log cuando la cola no responde.
- La llamada abandonada **no se cancela**: cuando Redis vuelve, el `upsertJobScheduler` se completa solo y el cron queda registrado sin reiniciar el proceso (el id del scheduler es fijo, así que hacerlo tarde es inofensivo).
- `configurarJobRecurrente()` se deja **como estaba** (sigue capturando el rechazo de un Redis que responde mal): el techo lo pone el llamador del arranque.

### 2.2 · H63 causa 2 — la reconciliación de expiraciones también estaba en el camino crítico

Segunda causa hallada **midiendo**, no leyendo: `ExpiracionReservaService.onApplicationBootstrap` corría **con `await` dentro de `app.init()`**, antes de `listen`. Con la cola caída hacía dos trabajos pesados ahí mismo: hasta 2 s por reserva vigente y, al expirar una reserva, un encolado de notificación sin techo (que con Redis inalcanzable **no settlea nunca**).

`src/reserva/application/expiracion-reserva.service.ts`:

```ts
onApplicationBootstrap(): void {
  void this.reconciliarEnArranque();     // en segundo plano: no retrasa el listen
}

async reconciliarEnArranque(): Promise<void> {   // público: el hook no lo espera, los tests sí
  try { … } catch (err) { this.logger.warn(`No se pudo reconciliar las expiraciones al arrancar: …`); }
}
```

y dentro de `notificarExpiracion`, el encolado pasa por el mismo helper de H62:

```ts
const encolado = await encolarConLimite(() => this.notificacionService!.enviarNotificacion({ … }));
if (!encolado.ok) {
  this.logger.warn(`No se pudo notificar la expiración de ${reservaId} (${encolado.motivo}): la reserva ya quedó EXPIRADA y el espacio liberado.`);
}
```

Con esto la reconciliación **termina** con la cola muerta (avisando por log) en vez de quedarse colgada para siempre, y la expiración de la reserva —que ya está confirmada en la BD— no se reabre por una notificación.

### 2.3 · Alcance del diff

```
 backend-barberias/src/auditoria/application/auditoria.service.ts        | 60 ++++++++++++-
 backend-barberias/src/auditoria/application/auditoria.service.spec.ts   | 60 ++++++++++++-
 backend-barberias/src/reserva/application/expiracion-reserva.service.ts | 46 ++++++++----
 .../reserva/application/expiracion-reserva.service.spec.ts              | 65 +++++++++++++-
 4 files changed, 215 insertions(+), 16 deletions(-)
```

Sin cambios en `app.module.ts` (la conexión de BullMQ sigue igual: `maxRetriesPerRequest: null` es obligatorio y **no** se toca), sin cambios en colas, `jobId`, `delay` ni `ENCOLADO_TIMEOUT_MS` (2 s). `.env` intacto.

---

## 3. LA MEDICIÓN QUE DECIDE: ARRANQUE REAL CON REDIS CAÍDO

Arnés versionado en [backend-barberias/test/manual/h63-arranque-sin-redis.mjs](backend-barberias/test/manual/h63-arranque-sin-redis.mjs) (vive en `test/manual/` como las demás herramientas a mano, fuera de las suites `*.spec.ts` / `*.e2e-spec.ts`): lanza el **artefacto real** `node dist/main.js` —lo mismo que sirve `npm run start:prod` en Render— con `REDIS_URL=redis://127.0.0.1:6399` (puerto cerrado), marca cada línea de log con los ms transcurridos, sondea HTTP y `GET /api/v1/health`.

### 3.1 · ROJO — antes del arreglo (2026-10-14)

```
================ RESUMEN H63 ================
REDIS_URL en el hijo  : redis://127.0.0.1:6399
HTTP listo            : NO en 30s
"successfully started": NUNCA (bootstrap bloqueado)
primer ECONNREFUSED   : 3620ms
líneas de log         : 1185          ← todas reintentos ECONNREFUSED de ioredis
```

Es el mismo síntoma que la fase anterior había dejado documentado como `Hook timed out in 120000ms` con `Tests 11 skipped (11)`: no es que una ruta falle, es que **la instancia no llega a escuchar**.

### 3.2 · VERDE — después del arreglo (dos ejecuciones)

```
================ RESUMEN H63 ================        (1.ª)              (2.ª)              (3.ª)
REDIS_URL en el hijo  : redis://127.0.0.1:6399   127.0.0.1:6399     127.0.0.1:6399
HTTP listo            : sí, 3752ms (GET / → 404)  sí, 4009ms          sí, 3986ms
/api/v1/health        : —                        503 a los 4659ms   503 a los 4891ms
"successfully started": 3647ms                   3901ms             3871ms
log CRÍTICO del cron  : 6641ms                   6880ms             6865ms
reconciliación hecha  : 11333ms                  sin nada que reg.  sin nada que reg.
aviso notificación    : 6468ms (1.º de 3)        —                  —
primer ECONNREFUSED   : 3008ms                   3327ms             2949ms
líneas de log         : 845                      853                853
```

Líneas literales del log (1.ª ejecución):

```
 3647ms | [Nest] … LOG [NestApplication] Nest application successfully started +649ms
 6641ms | [Nest] … ERROR [AuditoriaService] CRÍTICO: la cola de auditoría no respondió en 3000 ms al programar el cron de purga (la cola no respondió en 3000 ms). La aplicación arranca SIN el cron diario; la purga retomará cuando la cola vuelva (la llamada queda pendiente y se completa sola), sin necesidad de reiniciar.
 6468ms | [Nest] … WARN [ExpiracionReservaService] No se pudo notificar la expiración de 4da7d0d2-… (la cola no respondió en 2000 ms): la reserva ya quedó EXPIRADA y el espacio liberado.
11333ms | [Nest] … LOG [ExpiracionReservaService] Reconciliación de expiraciones: 3 reserva(s) vencida(s) expirada(s), 0 job(s) reencolado(s).
```

Lectura de los números:

- **El arranque ya no depende de Redis**: 3,6-3,9 s hasta `successfully started` (y `GET /` responde a los 3,75-4,0 s) frente a *nunca*, con el mismo Redis inalcanzable.
- **El cron de purga queda degradado y declarado**: el error crítico aparece a los ~6,6 s, es decir **después** de que la API ya está escuchando (3,0 s del tope + el arranque). La instancia sirve y el operador ve el motivo en el log.
- **La reconciliación corre en segundo plano**: la BD ya se está atendiendo a los 3,9 s mientras la reconciliación expira 3 reservas y termina a los 11,3 s. Cada una de esas expiraciones avisa que la notificación no se pudo encolar (techo de 2 s) **en vez de quedarse colgada**, que es lo que habría dejado el arranque (y la purga) eternamente pendientes.
- La `salida 404` de `GET /` es la esperada en este artefacto: el prefijo global es `/api/v1`, así que `/` no existe; lo que prueba es que el socket escucha y atiende HTTP.
- Efecto colateral asumido: esa reconciliación **sí** expiró en la BD `dev` las 3 reservas vencidas que había (es su trabajo; por eso la 2.ª ejecución no registra nada).

---

## 4. PRUEBAS Y EVIDENCIA

### 4.1 · ROJO — los tests nuevos fallan sin el arreglo

Con los dos hooks restaurados a su forma anterior (respaldo previo de los ficheros, revert selectivo y restauración literal después):

```
 × H63: el hook de arranque NO espera a la reconciliación (no retrasa el listen)
 FAIL  src/auditoria/application/auditoria.service.spec.ts > … > onModuleInit no espera al registro del cron aunque la cola no responda
AssertionError: expected Promise{…} to be undefined
- Expected: undefined
+ Received: Promise {}
 FAIL  src/reserva/application/expiracion-reserva.service.spec.ts > … > H63: el hook de arranque NO espera a la reconciliación (no retrasa el listen)
AssertionError: expected Promise{…} to be undefined

 Test Files  2 failed (2)
      Tests  2 failed | 28 passed (30)      ← EXIT=1
```

La aserción es la correcta para este defecto: si el hook devuelve una promesa, **Nest la espera**; por eso lo que se fija con el test es que el hook sea síncrono *y* que el registro del cron se intente igual (degradar, no desactivar).

### 4.2 · VERDE — unitarios

```
# dirigido
 Test Files  2 passed (2)
      Tests  30 passed (30)        ← EXIT=0

# suite completa (npm test)
 Test Files  48 passed (48)
      Tests  526 passed (526)      ← EXIT=0
   Duration  16.18s
```

(La iteración de H62 cerró en 520 casos: **+6** de esta iteración —2 guardias de hook síncrono, 1 del techo del cron con error crítico, 1 del cron sano, 1 de la expiración que no se cuelga al notificar y 1 del registro de degradación— sin añadir ficheros.)

### 4.3 · VERDE — E2E **por HTTP real** con Redis caído (lo que la iteración anterior no pudo medir)

```
$ REDIS_URL=redis://127.0.0.1:6399 npx vitest run --config ./vitest.config.e2e.ts \
    test/e3-03-validaciones.e2e-spec.ts -t "CONTROL"

 ✓ test/e3-03-validaciones.e2e-spec.ts (11 tests | 8 skipped) 28355ms
     ✓ CONTROL: MANUAL → PENDIENTE, expira_at = ahora + 10 min y job de expiración  4375ms
     ✓ CONTROL: AUTOMATICO → CONFIRMADA sin temporizador  1509ms
     ✓ CONTROL: cotización sin persistir (D44) - mismo blanco que crear  686ms

 Test Files  1 passed (1)
      Tests  3 passed | 8 skipped (11)      ← EXIT=0
   Duration  33.41s
```

Es el mismo comando que antes moría en `Hook timed out in 120000ms` con `Tests 11 skipped (11)`. Ahora el `beforeAll` completa, la app arranca y **el alta de reserva responde 201 con la cola muerta** (~2 s de más por el techo del encolado, que es el precio explícito de no fallar). El caso que exige el job encolado se deja fuera a propósito: su verde es el de la iteración de H62 (con Redis sano, `20 passed (20)`).

### 4.4 · Documentación y estáticos

```
npm run lint   → Found 54 warnings and 0 errors.  (208 archivos)   LINT_EXIT=0
npm run build  → nest build                                        BUILD_EXIT=0
```

`AUDITORIA_HALLAZGOS.md`: la tabla F2.1 marca **H63 ✅ RESUELTO**, la ficha F2.3 pasa a RESUELTO con el qué/por qué/cómo/evidencia/límites, y se suma **H64** (§5). `reporte-fase2-asincrona.md`: su §8 deja de decir ABIERTO y apunta aquí.

### 4.5 · Una prueba de esta iteración se quedó en verde-only

El caso «una expiración no se cuelga si la notificación no puede encolarse» (unitario, con temporizadores falsos) **no** se midió en rojo de forma aislada: revertir solo ese cambio requería deshacer el bloque completo y se optó por no tocar el código ya verificado. Su modo de fallo, sin embargo, **está medido**: es el mismo «la promesa ni resuelve ni rechaza» que se midió contra un puerto cerrado en la iteración de H62 (§6.0 de su reporte) y que en el arranque rojo aparece como 1185 líneas de `ECONNREFUSED` sin un solo `successfully started`. Se declara como límite de la verificación, no como verde medido en rojo.

---

## 5. HALLAZGO NUEVO · H64 — `/health` sigue devolviendo 503 con Redis caído, y Render usa `/health` como sonda

- **Dato medido (2.ª y 3.ª ejecución, §3.2):** con la app **arrancada y sirviendo**, `GET /api/v1/health` → **503 a los 4659 y 4891 ms** (`src/health/health.controller.ts` devuelve el indicador `redis: { status: 'down' }`, y Terminus convierte cualquier indicador `down` en 503).
- **Por qué importa:** `render.yaml` declara `healthCheckPath: /health`. La degradación elegante que se acaba de conseguir —la instancia sirve reservas, pagos y catálogos con Redis caído— puede quedar anulada por el orquestador si trata esa ruta como sonda de **vida**: el contenedor se marcaría como unhealthy y se reiniciaría en bucle pese a estar atendiendo.
- **Remedio propuesto (decisión del dueño, no aplicado):** separar sonda de vida de sonda de preparación (una ruta que solo compruebe el proceso y la BD para `healthCheckPath`, y el detalle de Redis en la de preparación), o degradar el indicador de Redis a `degraded` sin tumbar el 200 cuando la cola es secundaria. Cambia el contrato de monitorización, así que no se toca sin tu visto bueno.
- **Nota:** el cliente de Redis de la sonda está acotado (`maxRetriesPerRequest: 1`, `connectTimeout: 5000`), así que este endpoint no se cuelga: responde 503, que es correcto como *readiness* y peligroso como *liveness*.

---

## 6. LÍMITES Y TRABAJO QUE QUEDA ABIERTO

- **H64** (§5) y los límites de H62, que siguen vigentes: `getJob` sin techo en aceptar/rechazar/cancelar, el encolado del alta aún **dentro** de la transacción (hasta 2 s reteniendo `FOR UPDATE`; el arreglo de fondo es encolar tras el commit) y el job de expiración con 1 intento.
- **El cron de purga no se reintenta por sí solo**: si la cola está caída en el arranque, el registro se queda pendiente y se completa cuando Redis vuelva *en ese mismo proceso*; si el proceso se reinicia antes, vuelve a intentarlo. Un reintento explícito con backoff sería más explícito que confiar en la cola offline de ioredis.
- **La reconciliación de arranque sigue siendo secuencial**: con muchas reservas vigentes y la cola muerta acumula 2 s por reserva en segundo plano (ya no bloquea el arranque, pero alarga el trabajo). Paralelizar con un límite o cortocircuitar tras el primer fallo de cola es la mejora natural.
- **No se corrió la suite E2E completa** (27 ficheros): se ejecutó el E2E dirigido con Redis caído (§4.3) y el E2E dirigido con Redis sano de la iteración anterior. La afirmación «sin regresiones» queda limitada a esos casos.
- **Frontend y esquema**: intactos.

---

## 7. CÓMO REPRODUCIR

```bash
cd backend-barberias

# 1. ROJO: el arranque con Redis inalcanzable en el artefacto real
#    (antes del arreglo: "successfully started" NUNCA, HTTP no responde en 30 s)
npm run build
REDIS_URL=redis://127.0.0.1:6399 node dist/main.js        # Ctrl+C a los ~30 s

# 2. El mismo arranque, medido línea a línea (necesita DATABASE_URL del .env)
set -a; . ./.env; set +a
REDIS_URL=redis://127.0.0.1:6399 node test/manual/h63-arranque-sin-redis.mjs 30 3999
#    → "successfully started": ~3,6-3,9 s · /api/v1/health 503 · CRÍTICO del cron a los ~6,9 s
#    Sin REDIS_URL usa el Redis de docker-compose.yml como control verde.

# 3. Unitarios: 48 ficheros / 526 casos
npm test

# 4. El rojo de los tests nuevos: devolver los hooks a `await` y volver a correr
npx vitest run src/auditoria/application/auditoria.service.spec.ts \
               src/reserva/application/expiracion-reserva.service.spec.ts

# 5. E2E por HTTP real con Redis caído
REDIS_URL=redis://127.0.0.1:6399 APP_ENV=dev npx vitest run --config ./vitest.config.e2e.ts \
  test/e3-03-validaciones.e2e-spec.ts -t "CONTROL"

npm run lint ; npm run build
```

---

## 8. ESTADO FINAL

- La rama `feat/infraestructura-asincrona` queda **apilada sobre `chore/sprint-estabilizacion-p3`**, con la conexión de BullMQ, las colas, los `jobId` y los `delay` **sin cambios**, y con H62 y H63 cerrados.
- **Push hecho a `origin/feat/infraestructura-asincrona`** (primera vez en esta épica, a petición del dueño). Local y remoto coinciden: `5113a4b`.
- **Preparada para merge, y medido cómo sería:** `git merge-base --is-ancestor origin/main HEAD` devuelve **sí**, así que fusionar esta rama en `main` sería un **fast-forward sin conflictos**; arrancaría **7 commits** y **78 ficheros** (+6105 / −349).
  
  ```
  $ git log --oneline origin/main..HEAD
  5113a4b fix(fase2): el arranque deja de depender de la cola de Redis (H63)
  476648b feat(fase2): el alta de reserva deja de depender de la cola (H62)
  63fde8b docs(estabilizacion): informe final 8.4 de la Ola 3 (P3 · Higiene)
  432c372 chore(estabilizacion): higiene de P3, vocabulario de E2-07 y auditoría al día
  6e1de4b feat(estabilizacion): cierra las brechas de negocio de la Ola 2 (H52, H54, D09/D24, H58)
  02e6697 fix(estabilizacion): alinea el esquema con dev y cierra H47 y los minutos fantasma
  7491c90 docs(estabilizacion): plan de ataque del sprint Camino B
  ```

  Es decir: como la rama está apilada, **fusionarla en `main` fusiona también todo el Sprint de Estabilización** (el `main` remoto sigue en `b3af077`, que es ancestro de esta rama). Si quieres llevar solo la Fase 2 a `main` sin arrastrar el sprint, habría que re-apilar sobre `main` o esperar al merge del sprint: es una decisión tuya y **no se ha tomado ninguna**. El PR se puede abrir en `https://github.com/Codecore-J/barberias-platform/pull/new/feat/infraestructura-asincrona`.
- Lo que **no** se puede prometer: que la instancia sea *considerada* sana por el orquestador mientras Redis esté caído (**H64**), y la ausencia de regresiones fuera de los casos medidos (§6).
