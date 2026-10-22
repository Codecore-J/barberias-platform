# E4-02 · D22 · Carril B — Motor reactivo (matcher de lista de espera)

> Plantilla 8.4 de `docs/BACKLOG_BARBERIAS_V1.md`.
> Rama actual: `chore/integracion-pre-auditoria`. **Sin commit, sin push, sin merge.**

## 1. QUÉ HICE

- Verifiqué que el proyecto **no** usa `@nestjs/event-emitter`: el bus real es **BullMQ** (`@nestjs/bullmq` + `bullmq`), la convención interna que permite el enunciado.
- `ReservaService` ahora emite `HUECO_LIBERADO` **después del commit** al cancelar, cancelar con motivo especial, reprogramar y aceptar una propuesta horaria, con `barberiaId`, `fecha` (YYYY-MM-DD de la sede) e `inicio`/`fin` como instantes ISO.
- `ListaEsperaProcessor` consume la cola `lista-espera` y delega en `ListaEsperaMatcherService`, que recorre la fila **FIFO** de suscripciones `PENDIENTE` de esa sede y fecha y comprueba `Σ duraciones + margenGrupalMinutos ≤ duración del hueco`.
- El aviso se gana con un **test-and-set** `UPDATE … WHERE estado = 'PENDIENTE'` dentro de transacción SERIALIZABLE; solo el worker que actualiza una fila notifica, y un hueco produce **como mucho un aviso**.
- 16 unitarios nuevos del matcher + 2 de integración en `ReservaService`; suite completa y build en verde.

## 2. ARCHIVOS TOCADOS

`git diff --stat` literal (la rama arrastra también cambios de fases anteriores, marcados abajo):

```text
 backend-barberias/prisma/schema.prisma             |  40 +++++++      (fase anterior: modelo ListaEspera)
 backend-barberias/src/app.module.ts                |   6 +
 .../reserva/application/reserva.service.spec.ts    |  57 ++++++++++
 .../src/reserva/application/reserva.service.ts     | 122 ++++++++++++++++++++-
 .../src/reserva/infrastructure/reserva.module.ts   |   6 +
 backend-barberias/src/shared/domain/estados.ts     |  18 +++          (fase anterior: ESTADOS_LISTA_ESPERA)
 .../src/shared/queues/queue.constants.spec.ts      |  10 ++
 .../src/shared/queues/queue.constants.ts           |  28 +++++
 backend-barberias/test/permisos-matriz.spec.ts     |  16 ++-          (fase anterior: ruta de suscripción)
 .../src/app/auth/interfaces/auth.interface.ts      |   5 +-           (fase anterior: frontend)
 .../src/app/auth/login/login.component.ts          |   2 +-           (fase anterior: frontend)
 .../src/app/auth/register/register.component.ts    |  31 ++++--       (fase anterior: frontend)
 12 files changed, 326 insertions(+), 15 deletions(-)
```

Nuevos (untracked, de esta fase y de la anterior):

- `src/lista-espera/application/lista-espera.matcher.service.ts` **(nuevo, esta fase)**
- `src/lista-espera/application/lista-espera.matcher.service.spec.ts` **(nuevo, esta fase)**
- `src/lista-espera/application/lista-espera.processor.ts` **(nuevo, esta fase)**
- `src/lista-espera/lista-espera.module.ts` (registra processor + matcher, esta fase)
- `src/lista-espera/application/lista-espera.service.ts`, `.../dto/create-lista-espera.dto.ts`, `.../infrastructure/lista-espera.controller.ts` (fase anterior)
- `prisma/migrations/20261020120000_e402_lista_espera/` (fase anterior)

## 3. TEST ROJO

La sesión que ejecutó el ciclo rojo original se interrumpió antes de guardar su salida, así que **no conservo ese log**. Para no afirmar un rojo que no puedo mostrar, verifiqué que la aserción crítica discrimina con una **mutación controlada** del matcher (se sustituyó el `return` que corta la búsqueda tras el primer aviso por un `continue`), restaurando el archivo byte a byte después:

```text
mutado
     × un hueco = un aviso: si dos caben, el segundo SIGUE PENDIENTE 27ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
AssertionError: expected null to be 'espera-1' // Object.is equality
      Tests  1 failed | 15 skipped (16)
RESTAURADO_OK
```

## 4. TEST VERDE

Matcher (16/16):

```text
 Test Files  1 passed (1)
      Tests  16 passed (16)
   Duration  2.46s
```

Integración del productor en `ReservaService` (filtro `-t "E4-02"`, 7 casos: 2 nuevos + los que ya contenían la etiqueta):

```text
       ✓ E4-02 · D22: al cancelar avisa al Carril B del bloque que quedó libre  495ms
 Test Files  1 passed (1)
      Tests  7 passed | 63 skipped (70)
```

Los unitarios cubren: sin candidatas, consulta FIFO por sede+fecha+estado, descarte por duración y aviso al siguiente, **dos candidatas que caben y solo la primera se notifica**, carrera perdida (`count 0`) que pasa a la siguiente, `YA_TOMADAS`, `NINGUNA_CABE`, margen de sede 10 vs 20, margen por defecto sin configuración, payload imposible, bloque pasado, **bloque en curso**, sede inexistente, contenido del aviso con hora de la sede y funcionamiento sin canal de notificaciones.

## 5. SUITE COMPLETA · `npm run test`

```text
 Test Files  55 passed (55)
      Tests  665 passed (665)
```

`npm run build` (`nest build`): `build_exit=0`.

## 6. CRITERIOS DE ACEPTACIÓN

- [x] Bus de eventos verificado: no hay `@nestjs/event-emitter`; se usa BullMQ, la convención del proyecto. Evidencia: `package.json` (`@nestjs/bullmq`, `bullmq`) y `queue.constants.ts`.
- [x] `HuecoLiberado*` con `barberiaId`, `fecha` YYYY-MM-DD e instantes `inicio`/`fin`. Evidencia: `HuecoLiberadoJobPayload`.
- [x] Emisión al cancelar **con éxito**, tras el commit y best-effort (`encolarConLimite`). Evidencia: unitario "al cancelar avisa al Carril B…" y "si la cola falla, la cancelación NO se rompe".
- [x] También al reprogramar y al aceptar propuesta (liberan el bloque viejo) y en la cancelación especial.
- [x] Consumidor dentro de `lista-espera` que escucha el job y delega en el matcher.
- [x] Búsqueda `PENDIENTE` por `barberiaId` + `fechaObjetivo`, orden `creadoAt asc, id asc`.
- [x] Match = Σ `duracionEstimada` de los servicios + `margenGrupalMinutos` de la sede (D42) ≤ duración física del hueco.
- [x] Transacción SERIALIZABLE + test-and-set `PENDIENTE → NOTIFICADO` con verificación de `count`.
- [x] `Logger` estructurado `LISTA_ESPERA_HUECO_LIBERADO` con usuario, suscripción y bloque, más notificación persistida/encolada si el módulo está disponible.
- [x] Recorrido FIFO que descarta por duración y sigue con la siguiente; un hueco = un aviso.
- [x] Dos candidatas que caben: la segunda queda `PENDIENTE` (unitario dedicado).
- [x] `npm run test` y `npm run build` en verde, sin E2E nuevos.

## 7. DECISIONES O DESVIACIONES

1. **BullMQ en vez de `@nestjs/event-emitter`.** El proyecto no tiene el paquete y ya usa colas BullMQ con Redis para todo lo asíncrono (expiración, notificaciones, bloqueos). Un evento en proceso se perdería al reiniciar y no viaja entre instancias; la cola da reintentos (`attempts: 3`, backoff exponencial) y un único consumidor por job.
2. **`lista-espera.processor.ts` en vez de `lista-espera.listener.ts`.** Es el nombre que la convención del repo da al consumidor de una cola (`ReservaProcessor`, `NotificacionProcessor`, `BloqueosProcessor`). El spec equivalente es `lista-espera.matcher.service.spec.ts`, porque el processor solo valida el payload y toda la regla vive en el matcher.
3. **Un solo aviso por hueco.** Avisar a todos los que caben convierte el hueco en una carrera donde todos menos uno reciben 409. El primero de la fila que cabe se queda el aviso; los demás esperan otro hueco.
4. **Margen de la configuración vigente**, no `margenGrupalHistorico` de la reserva cancelada: el hueco se ofrece a una reserva nueva (D42).
5. **Bloques pasados o en curso se descartan** (`HUECO_EN_EL_PASADO`): prometer "de 11:45 a 12:45" a las 12:00 sería ofrecer un resto parcial como si fuera entero.
6. **La notificación no se espera** (`.catch` + log): la fila de `notificaciones` y el encolado ocurren dentro de `enviarNotificacion`; un Redis lento no puede atascar al matcher ya notificado.
7. **El aviso al Carril B nunca rompe la operación de negocio**: se emite tras el commit y con techo de 2 s (H62). Si la cola está caída, la cancelación sigue siendo un éxito y queda el `warn`.

## 8. HALLAZGOS NUEVOS

- **HALLAZGO-CB-01 · Media · La agenda también se libera al expirar o al rechazar una reserva, y ahí no hay aviso.** `ExpiracionReservaService` (EXPIRADA) y `rechazarReserva` (RECHAZADA) sacan la cita de la agenda sin emitir `HUECO_LIBERADO`; el Carril B solo reacciona a cancelación/reprogramación/aceptación de propuesta. Evidencia: `grep -n "HUECO_LIBERADO\|avisarHuecoLiberado" src/reserva/application/reserva.service.ts` no aparece en `rechazarReserva` ni en `expiracion-reserva.service.ts`.
- **HALLAZGO-CB-02 · Baja · Ventana de doble aviso si el worker muere justo después del test-and-set.** El estado `NOTIFICADO` se confirma antes de notificar; si el proceso cae entre el commit y el cierre del job, BullMQ reintenta el job y la siguiente candidata podría recibir un aviso del mismo hueco. Cerrarlo del todo requiere persistir el hueco avisado en la suscripción (columna nueva) o un `jobId` determinístico con política de fallidos; no se hizo para no ampliar el esquema en esta fase.

## 9. PENDIENTE O NO VERIFICADO

- E2E del circuito completo (cancelar → job → matcher → `notificaciones`), expresamente fuera de alcance en esta tarea.
- Cierre de la suscripción cuando el cliente consigue cita (`CERRADO`) y vencimiento de suscripciones: dependen de flujos posteriores; el matcher solo mueve `PENDIENTE → NOTIFICADO`.
- El aviso no reserva el hueco: entre `NOTIFICADO` y la reserva real el bloque puede ocuparlo otro cliente (el cliente recibirá 409). Es coherente con D22 (aviso, no bloqueo), pero no hay ventana de exclusividad.
- Verificación limitada a unitarios y build: no se levantó Redis ni la base para un smoke manual.

## 10. ESTADO GIT

```text
$ git status --short
 M backend-barberias/prisma/schema.prisma
 M backend-barberias/src/app.module.ts
 M backend-barberias/src/reserva/application/reserva.service.spec.ts
 M backend-barberias/src/reserva/application/reserva.service.ts
 M backend-barberias/src/reserva/infrastructure/reserva.module.ts
 M backend-barberias/src/shared/domain/estados.ts
 M backend-barberias/src/shared/queues/queue.constants.spec.ts
 M backend-barberias/src/shared/queues/queue.constants.ts
 M backend-barberias/test/permisos-matriz.spec.ts
 M frontend-barberias/src/app/auth/interfaces/auth.interface.ts
 M frontend-barberias/src/app/auth/login/login.component.ts
 M frontend-barberias/src/app/auth/register/register.component.ts
?? backend-barberias/prisma/migrations/20261020120000_e402_lista_espera/
?? backend-barberias/src/lista-espera/

$ git log -1 --oneline
81d40a0 fix(e2-05): resolucion de conflicto de margenes de tiempo alineado a D42
```

No se hizo commit, push ni merge. La rama queda a la espera de aprobación.
