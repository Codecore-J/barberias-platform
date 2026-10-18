> Plantilla 8.4 de `docs/BACKLOG_BARBERIAS_V1.md`. Rama `feat/h68-correccion-pagos` desde
> `main` (`15dc137`, con el PR #73 ya fusionado). **Push sin merge**, a la espera de aprobación.

# H68 · Un cobro equivocado ya se puede corregir sin borrar nada

**TAREA:** H68 — §7.3: el pago se registraba y se auditaba, pero no existía el camino de corrección.
Un cajero que cobraba mal solo tenía la base de datos a mano, y sin rastro.
**RAMA:** `feat/h68-correccion-pagos`
**HALLAZGO:** `AUDITORIA_HALLAZGOS.md` → `H68 · … — **RESUELTO**` · Regla **7.3** de la matriz.

---

## 1. QUÉ HICE

**Backend**

1. **La corrección es una ANULACIÓN, no un borrado.** La fila del pago pasa a `ANULADO` —valor nuevo del
   CHECK `pagos_estado_pago_check`— y conserva autor (`anulado_por`), fecha (`anulado_at`) y motivo
   (`motivo_anulacion`). Nada desaparece: el proyecto prohíbe el `DELETE` para representar un cambio de
   estado, y un ingreso deshecho tiene que poder explicarse después.
2. **`POST /pagos/:id/anular`** (`/cobros/:id/anular` y el alias con `:barberiaId`), con **motivo
   obligatorio**: sin él responde 422 `MOTIVO_REQUERIDO` antes de tocar la base. Valida que el pago
   exista (404), que sea de la sede que se está operando (404 en el alias ajeno, para no confirmar que
   existe), que esté `PAGADA` y que no esté ya `ANULADO` (409 `ESTADO_INVALIDO` en los dos casos).
   El `UPDATE` y el evento `PAGO_ANULADO` van **en la misma transacción SERIALIZABLE** (D28/§10.3).
3. **Solo la SEDE anula.** El barbero cobra lo suyo (E3-09/H47), pero deshacer un ingreso es una decisión
   administrativa: el servicio resuelve la sede DEL PAGO y rechaza el perfil `BARBERO` con 403
   `ANULACION_SOLO_ADMIN`. Como la ruta usa `:id`, el guard no puede ver la sede del recurso: la
   comprobación tiene que ser del servicio.
4. **La reserva no se deshace y el cobro puede volver.** El servicio se prestó: la reserva sigue
   `COMPLETADA` con su `completada_at` intacto. Por eso `registrarPagoEnPersona` admite **volver a
   cobrar** la misma reserva cuando la fila está `ANULADO` —el único camino que salta la máquina de
   estados, porque ya está en el estado destino— y devuelve el `PAGADA` sobre la MISMA fila
   (`reserva_id` es único). Sin esto, anular era un callejón sin salida para el cajero que se equivoca.
5. **`GET /pagos/historial` (el recibo).** Sale de la tabla `pagos`, no del registro de auditoría: cada
   cobro con su **estado vivo**, su cliente, sus servicios con el **precio histórico** y quién lo
   registró o lo anuló. Mismo aislamiento que la auditoría (E1-02/H18), con el filtro por sede en la
   CONSULTA. La auditoría sigue siendo el rastro inmutable y se sigue consultando por `/cobros/auditoria`.
6. **El método de pago entra en la fila.** Vivía solo en el contexto JSON de la auditoría, y un listado
   no se reconstruye desde un log. Se añade `metodo_pago` con `DEFAULT 'EN_PERSONA'` para las filas vivas.

**Frontend**

7. **«Historial de Pagos» funciona de verdad.** La tabla esperaba `reservaSnapshot`, `realizadoPor`,
   `monto` y `metodoPago`, que el endpoint de auditoría **nunca devolvió**: pintaba «Desconocido» y $0. Se
   reconecta al recibo nuevo (`PagoHistorial`) y se ajustan cliente, servicios, método, cobrado por, fecha
   y el detalle de la cita.
8. **Botón «Anular» con modal estricto.** Solo en las filas vivas; el modal explica que se deshace un
   ingreso, exige un motivo de al menos 5 caracteres (el botón está deshabilitado sin él) y avisa de que
   queda auditado. Tras el 200 se recarga el historial —el estado no se inventa en el cliente— y la fila
   se pinta como ANULADA: badge, monto tachado, autor de la anulación, motivo y acción «Corregido».
9. **Las métricas de caja excluyen lo anulado** (§7.4): «Total Recaudado», «Pagos Vivos», efectivo/tarjeta
   y los ingresos del día del home cuentan solo cobros vivos, y el card muestra cuántos se anularon. Si el
   total incluyera lo anulado, el arqueo mentiría justo cuando alguien corrige un error.

## 2. ARCHIVOS TOCADOS (`git diff --stat`, literal)

```
 AUDITORIA_HALLAZGOS.md                             |  27 +-
 backend-barberias/prisma/schema.prisma             |  13 +
 .../src/pago/application/pago.service.spec.ts      | 370 ++++++++++++++++++++-
 .../src/pago/application/pago.service.ts           | 290 +++++++++++++++-
 .../src/pago/infrastructure/pago.controller.ts     |  50 +++
 backend-barberias/test/permisos-matriz.spec.ts     |  26 +-
 docs/MATRIZ_CUMPLIMIENTO.md                        |  13 +-
 docs/MATRIZ_RUTAS.md                               |  15 +
 .../src/app/core/services/pagos.service.ts         |  77 +++--
 .../admin/tickets/admin-tickets.component.ts       | 207 ++++++++++--
 .../src/app/features/home/home.component.ts        |  10 +-
 11 files changed, 1016 insertions(+), 82 deletions(-)
```

Nuevos (no aparecen arriba por ser untracked hasta el commit):
`backend-barberias/prisma/migrations/20261018120000_h68_anulacion_pagos/migration.sql`,
`backend-barberias/src/pago/application/dto/anular-pago.dto.ts` y
`frontend-barberias/src/app/core/services/pagos.service.spec.ts`.

## 3. TEST ROJO (antes de tocar el código de producción)

```
 FAIL  src/pago/application/pago.service.spec.ts > PagoService > H68 · anular un pago > …
TypeError: service.anularPago is not a function

 FAIL  src/pago/application/pago.service.spec.ts > PagoService > H68 · historial de pagos de la sede > …
TypeError: service.listarHistorial is not a function

 Test Files  1 failed (1)
      Tests  11 failed | 16 passed (27)
EXIT=1
```

## 4. TEST VERDE

| Comprobación | Salida |
|---|---|
| `npx vitest run src/pago/application/pago.service.spec.ts` | `Tests 27 passed (27)` · `EXIT=0` |
| `npx vitest run test/permisos-matriz.spec.ts test/route-security.spec.ts` | `Tests 4 passed (4)` · **85 rutas × 4 roles = 340** decisiones |
| `npx tsc --noEmit -p tsconfig.app.json` (frontend) | sin salida · `EXIT=0` |
| `npx oxlint` (backend y frontend, archivos tocados) | `0 warnings and 0 errors` |

## 5. SUITE COMPLETA

```
 Backend  npm test             → Test Files 51 passed (51) · Tests 627 passed (627) · EXIT=0
 Frontend ng test --watch=false → Test Files 11 passed (11) · Tests  93 passed (93) · EXIT=0
 Frontend ng build              → Application bundle generation complete · EXIT=0
```

Los **12 casos nuevos** del backend —8 de `anularPago` (anula con autor/motivo/auditoría, 409 al
repetir, 409 si nunca se cobró, 422 sin motivo, 404 inexistente, 404 de sede ajena, 403 ajeno y 403 del
BARBERO), 2 de `listarHistorial` (recibo con estado vivo y 400 sin sede) y 2 de `registrarPagoEnPersona`
(volver a cobrar tras anular y el guard del cobro vivo, que ya pasaba antes)— y los **4 del frontend**
pasan dentro de esas cifras. Once de los doce estaban en ROJO.

## 6. CRITERIOS DE ACEPTACIÓN

| Criterio del encargo | Estado |
|---|---|
| Endpoint específico de anulación, protegido para la sede | ✅ `POST /pagos/:id/anular` · `@Roles(ADMIN_BARBERIA, ADMINISTRADOR)` + 403 del servicio para el BARBERO |
| Valida que el pago exista | ✅ 404 |
| Valida que no esté ya anulado | ✅ 409 `ESTADO_INVALIDO` (y 409 si nunca se cobró) |
| Cambio de estado dentro de una transacción | ✅ `withSerializableTransaction` |
| Evento en la tabla de auditoría | ✅ `PAGO_ANULADO` con motivo, monto, sede, reserva y estado previo, dentro de la transacción |
| Botón «Anular» en el historial de pagos de la sede | ✅ columna «Acción» de la tabla de tickets |
| Modal de confirmación estricto (acción financiera) | ✅ aviso de ingreso, motivo obligatorio, botón deshabilitado sin él |
| Cableado al endpoint y estado ANULADO visible tras el 200 | ✅ recarga desde el backend y fila pintada como anulada |
| Test que demuestre la anulación + auditoría | ✅ 7 casos de `anularPago` |
| Test del segundo intento rechazado (409) | ✅ caso propio |
| Suite del backend y build del frontend | ✅ 627 · 93 · build OK |
| H68 marcado RESUELTO | ✅ `AUDITORIA_HALLAZGOS.md` (+ regla **7.3** a `OK-PROBADO` y las rutas en `docs/MATRIZ_RUTAS.md`) |

## 7. DECISIONES ANOTADAS

1. **Anulación, no contra-asiento.** El diseño habla de «corregir» un pago; se eligió ANULAR (marcar el
   cobro como no válido, conservándolo) en vez de crear un movimiento negativo compensatorio, porque el
   `reserva_id` del pago es único y el modelo actual tiene un pago por reserva: un contra-asiento habría
   exigido una tabla de movimientos que hoy no existe, y el rastro de la corrección ya lo da la auditoría.
2. **Anular y volver a cobrar.** Decisión del dueño en el arranque de la tarea: anular no puede dejar al
   cajero sin salida. El precio es un camino más en `registrarPagoEnPersona` (salta la máquina de estados
   solo con la reserva ya `COMPLETADA` y el cobro `ANULADO`), y el test que lo blinda comprueba que un
   cobro VIVO sigue rechazando el segundo intento.
3. **El recibo es `GET /pagos/historial`, no la auditoría.** Se preguntó al dueño antes de escribir código.
   Motivo: la tabla de tickets se alimentaba de `/cobros/auditoria`, que devuelve eventos —sin estado del
   pago y sin id de la fila—, así que ni podía mostrar una anulación ni podía ofrecer corregirla.
4. **Los campos de anulación se limpian al volver a cobrar.** La fila cuenta su estado VIGENTE; el
   historial de anulaciones vive en la auditoría, que es inmutable. Se pierde el «esto estuvo anulado» en
   la fila, no en el rastro.
5. **`metodo_pago` sin CHECK de catálogo.** El `RegistrarPagoDto` acepta el método como texto libre y
   añadir un catálogo cerrado sería un cambio de contrato que nadie pidió; la columna solo lo guarda.
6. **Los precios del recibo son los históricos** (`participante_servicios.precio_historico`), no los del
   catálogo de hoy. El NOMBRE del servicio sí se lee del catálogo: no existe una columna de nombre
   congelado, y es un límite heredado del modelo, no de esta tarea.

## 8. HALLAZGOS

- **H76 (nuevo, cobertura):** las dos rutas nuevas **no tienen E2E**. El flujo se certifica con tests de
  servicio y de contrato HTTP del frontend, pero no hay un `test/h68-*.e2e-spec.ts` que recorra la
  anulación contra Postgres y Redis reales; el resto de épicas sí lo tienen para sus endpoints.
- **Nota de documentación (no es un hallazgo nuevo):** `docs/MATRIZ_RUTAS.md` seguía con el recuento de
  rutas de E3-12/2 (83) mientras el servidor ya tenía 85. Esta ejecución lo actualiza a **85 rutas × 4
  roles = 340** y añade las filas 72 y 73 al final de la tabla, como manda su encabezado; las cifras de la
  tarea se añaden como un «Estado real» más y no se reescriben las anteriores.

## 9. LO QUE QUEDA

- **La rama no se fusiona:** queda subida para revisión.
- **La migración no está aplicada a ninguna base** desde este entorno: `npx prisma migrate status` la
  lista como la única pendiente de las 14. En el CI la aplica `prisma migrate deploy` y la verifica
  `npm run check:integridad` (que compara los CHECK de las migraciones con los de la base). Para un
  entorno local hay que correr el mismo `deploy` antes de usar la anulación.
