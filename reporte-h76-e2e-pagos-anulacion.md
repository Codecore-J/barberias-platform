> Plantilla 8.4 de `docs/BACKLOG_BARBERIAS_V1.md`. Rama `chore/h76-e2e-pagos-anulacion`
> desde `feat/h68-correccion-pagos` (`00537f9`). **Sin merge**, a la espera de aprobación.
>
> **Aviso de la rama base:** H68 **no estaba en `main`** al empezar esta tarea. `main`
> remoto está en `15dc137` (PR #73) y no contiene ni la anulación ni la migración
> `h68_anulacion_pagos`; la rama `feat/h68-correccion-pagos` seguía viva en el remoto. Como
> el E2E certifica precisamente esas rutas, esta rama se creó SOBRE la de H68: contiene sus
> commits y su diff con `main` sigue siendo el suyo + el de este cierre. Al fusionar H68 en
> `main` queda como una rama normal; mientras tanto, un PR contra `main` mostrará también los
> commits de H68, que ya tienen su propio PR.

# H76 · El ciclo de anulación, certificado de punta a punta — y el bug que solo un E2E veía

**TAREA:** H76 — la anulación de un cobro movía dinero sin ningún recorrido E2E contra
Postgres real: solo tests de servicio con mocks y el contrato HTTP del frontend.
**RAMA:** `chore/h76-e2e-pagos-anulacion`
**HALLAZGO:** `AUDITORIA_HALLAZGOS.md` → `H76 · … — **RESUELTO**` · Regla **7.3** de la matriz.

---

## 1. QUÉ HICE

1. **Nuevo spec E2E: `backend-barberias/test/h76-pago-anulacion.e2e-spec.ts` (4 casos).**
   Recorre el ciclo entero por HTTP contra la base real, en el mismo estilo de arreglo que
   `test/pago-barbero-asignado.e2e-spec.ts` (AppModule, throttler anulado, `PrismaExceptionFilter`,
   `ValidationPipe`, `ClassSerializerInterceptor`, limpieza idempotente al entrar y al salir):
   - **Ciclo completo:** el CLIENTE crea la reserva por el wizard (E3-03) → la SEDE la cobra
     (`POST /cobros`: `pagos` en `PAGADA`, reserva `COMPLETADA` con `completada_at`) → anular
     **sin motivo** da 422 `MOTIVO_REQUERIDO` (y 400 si el campo ni llega: dos contratos distintos)
     → anular con motivo da 200 y la **fila** queda `ANULADO` con autor, fecha y motivo, con su
     `PAGO_ANULADO` en la auditoría y la reserva todavía `COMPLETADA` → `GET /cobros/historial`
     devuelve el recibo ANULADO con su motivo y su autor → **volver a cobrar** deja `PAGADA` la
     MISMA fila (`reserva_id` único), con el rastro de anulación limpio y `completada_at` intacto.
   - **403:** el BARBERO y el CLIENTE no anulan; el pago y su auditoría no se mueven.
   - **404:** el cobro de otra sede no se alcanza con el alias de esta (no se filtra la ajena).
   - **409:** anular dos veces no es idempotente y la fila conserva el PRIMER motivo.
2. **Arreglo de un defecto vivo que el E2E destapó (§2).** `listarHistorial` consultaba
   `participantes.servicios`; la relación Prisma real es `participanteServicios`. Prisma
   rechaza la consulta entera, así que **`GET /pagos/historial` respondía 400 en TODAS las
   llamadas**. Corregido en `pago.service.ts`, y el mock del test de servicio alineado al
   esquema real (era el que enseñaba la forma inventada).
3. **Documentación:** H76 a `RESUELTO` en `AUDITORIA_HALLAZGOS.md` (fila F2.1 + párrafo de la
   11.ª iteración), regla **7.3** con el E2E como evidencia en `docs/MATRIZ_CUMPLIMIENTO.md`,
   y este informe.

## 2. POR QUÉ EXISTE ESTE TEST (el bug que encontró)

El 627 de tests de servicio pasaban y la matriz de rutas estaba al día; aun así el recibo de
la sede no podía cargar nunca. En `listarHistorial` la consulta incluía
`participantes: { select: { servicios: {...} } }`, pero en `schema.prisma` la relación de
`ParticipanteReserva` se llama `participanteServicios`. Prisma no resuelve un select sobre una
relación inexistente: lanza `PrismaClientValidationError`, el filtro global lo traduce a **400
«Datos de consulta o mutación invalidos con el esquema»** y la respuesta nunca llega. La
pantalla de tickets (`pagos.service.ts` → `GET /cobros/historial`) habría mostrado siempre
error.

El test de servicio no lo vio porque `filaDePago()` devolvía `participantes[].servicios`:
el mock **inventaba la forma del esquema en vez de copiarla**, y el test certificaba esa
invención. Corregido el servicio, se corrigió también el mock, porque dejarlo como estaba
habría dejado el mismo agujero listo para volver.

**Lección que queda escrita en la auditoría:** un mock que no copia el esquema real no
certifica nada; un E2E contra la base es el único sitio donde una relación mal nombrada se
manifiesta.

## 3. EVIDENCIA

**ROJO (antes del arreglo, el 2026-10-18):** el caso «ciclo completo» fallaba en el paso del
historial con
`AssertionError: {"statusCode":400,"error":"Bad Request","message":"Datos de consulta o
mutación incompatibles con el esquema de base de datos."}` mientras el resto del ciclo (cobro,
422, 200 anulación) pasaba: la anulación funcionaba y el recibo no.

**VERDE (después):**

| Chequeo | Resultado |
| :--- | :--- |
| `test/h76-pago-anulacion.e2e-spec.ts` (dirigido) | `Tests 4 passed (4)`, `EXIT=0` |
| Suite E2E completa (`npm run test:e2e`, config E2E) | `Test Files 3 failed | 31 passed (34)`, `Tests 5 failed | 281 passed (286)`, 872 s. **Los 5 fallos son del entorno** (§4); el spec de H76 pasó dentro de la suite entera |
| Unitarios backend (`npm run test`) | `Test Files 51 passed (51)`, `Tests 627 passed (627)`, `EXIT=0` |
| `npm run lint` | `0 errors` (84 warnings de base, ninguno en los ficheros tocados) |
| `nest build` | `EXIT=0` |

## 4. EL ENTORNO DE VERIFICACIÓN (lo que no es del alcance y quedó pendiente)

La suite E2E completa corrió contra el entorno dev del proyecto (Neon + Upstash, `.env` local).
**La cuota de Redis de Upstash está agotada** (`ERR max requests limit exceeded. Limit: 500000,
Usage: 500001`), y eso explica los 5 fallos, todos ajenos a H76:

- `e3-04-aceptar-rechazar` (2 casos) y `e3-05-expiracion-cancelacion` (2 casos): fallan donde
  el test espera que el job de expiración exista en la cola (`getJob` → `undefined`) — es
  H62 en acción: con la cola degradada el alta sigue siendo 201 best-effort.
- `health`: `/health` responde 503 porque la sonda de preparación incluye Redis y está caído.

Ninguno toca el flujo de pagos. Reproducibles en cualquier entorno con la misma cuota
agotada; no son regresiones de esta rama.

También en el entorno dev: la migración `20261018120000_h68_anulacion_pagos` estaba
**pendiente** en la base local (la que usa el E2E). Se aplicó con `prisma migrate deploy`
antes de ejecutar, tal como hace el CI —sin ella, el propio cobro devolvía 500 por la columna
inexistente. `prisma migrate status` queda limpio.

## 5. DECISIONES QUE EL TEST FIJA (y por qué)

- **La cita se crea HOY y en una hora ya pasada.** No es un atajo: §5.2 fila 11 prohíbe cobrar
  una cita que no ha empezado, así que una reserva futura nunca puede llegar a caja y el ciclo
  completo solo es recorrible con una cita iniciada. Las etiquetas `DATE`/`TIME` se calculan en
  el reloj de la SEDE (`America/Santo_Domingo`, la única zona que admite el CHECK de D15, con
  UTC-4 fijo sin DST), no en el del servidor de CI.
- **Sin motivo se comprueban los DOS contratos.** Campo ausente → 400 (lo corta el DTO con
  `whitelist`); espacios en blanco → 422 `MOTIVO_REQUERIDO` (la regla de negocio del servicio).
  El frontend puede tropezar con cualquiera de los dos y el test fija ambos.
- **404, no 403, para el cobro de otra sede:** responder 403 confirmaría que ese cobro existe
  en otra sede. Es la decisión de H68 y este test la certifica.
- **Cada caso negativo usa su propio cobro.** Así el 403/404/409 no depende del estado que
  deje el ciclo anterior y un fallo en un paso no enmascara al resto.
- **El throttler se anula con el override del resto de specs:** sin él, los logins y los POST
  de esta suite se comerían el límite global de 120/min y un 429 falsearía el resultado.

## 6. QUÉ NO QUEDÓ HECHO

- **No se hizo merge** (queda fuera de lo pedido; la rama está empujada para revisión).
- El E2E certifica el flujo; **no hay E2E del recorrido completo del CLIENTE** (sus
  notificaciones o su `mis-reservas` tras la anulación). No es alcance de H76.
- La observación de que el alta de reserva acepta un hueco YA pasado (que este test aprovecha
  a propósito) queda anotada como comportamiento, no como defecto: corregirla implicaría
  decidir el camino walk-in de E3-03 y no es H76.
