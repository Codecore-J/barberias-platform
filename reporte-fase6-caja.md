# Fase 6 · Pagos por método y cierre de caja diario

Rama `feat/v3-pagos-caja`.

Antes de empezar se fusionaron en `main` los PRs de las fases anteriores:
#112 (catálogo híbrido backend), #113 (UI del catálogo), #114 (checkout híbrido) y
#115 (horarios del barbero). La rama nace de ese `main`.

## 1 · Base de datos

### `pagos` · la sede del cobro

`Pago` gana `barberia_id` (UUID, `NOT NULL`), copiado de la reserva en la misma
transacción. Sin esa columna, cada arqueo tendría que unir `pagos` con `reservas`
para saber de qué sede es el dinero.

La migración rellena las filas existentes desde su reserva antes de poner el
`NOT NULL`, y añade el índice `(barberia_id, registrado_at)`, que es exactamente
el filtro del arqueo.

### `cierres_caja` · la foto del día

| Campo | Tipo | Nota |
|---|---|---|
| `id` | UUID | PK |
| `barberia_id` | UUID | FK a `barberias` (cascade) |
| `fecha_arqueo` | DATE | Etiqueta del día **en la zona de la sede** |
| `total_efectivo` / `total_tarjeta` / `total_transferencia` / `total_general` | DECIMAL(12,2) | Cifras congeladas |
| `abierto_por` / `cerrado_por` | UUID | FK a `usuarios` (set null) |
| `abierto_at` / `cerrado_at` | TIMESTAMPTZ | |
| `estado` | VARCHAR(20) | `ABIERTO` / `CERRADO` |

Restricciones en la base:

- `UNIQUE (barberia_id, fecha_arqueo)` → **imposible cerrar dos veces el mismo día**,
  incluso con dos peticiones simultáneas.
- `cierres_caja_totales_check` → ningún total negativo y
  `total_general = total_efectivo + total_tarjeta + total_transferencia`.
- `cierres_caja_estado_check` → solo `ABIERTO` / `CERRADO`.

Migración: `20261029200000_v3_pagos_cierre`. Es **aditiva**: no renombra ni borra
`metodo_pago` ni `estado_pago`, cuyos valores históricos (`EN_PERSONA`, `PAGADA`,
`ANULADO`) siguen intactos para el recibo de H68.

## 2 · Backend

### Cobro

| Verbo | Ruta | Roles |
|---|---|---|
| `POST` | `/api/v1/pagos/cobrar` | `BARBERO`, `ADMIN_BARBERIA`, `ADMINISTRADOR` |
| `POST` | `/api/v1/shops/:shopId/payments` | (histórica, mismos roles) |

Las dos entran al **mismo** `PagoService.registrarPagoEnPersona`, así que las
reglas no pueden divergir:

- **Una sola vez por reserva**: el `reserva_id` es único y un pago `PAGADA`
  responde **409** «Esta reserva ya fue pagada previamente». Un cobro `ANULADO`
  se puede reanudar sobre la misma fila (H68).
- **Monto exacto**: si llega `monto`, debe coincidir con `reservas.total_pagar`
  (±0,005 de redondeo); si no, **422 `MONTO_NO_COINCIDE`** con ambas cifras. Sin
  `monto`, se cobra el total congelado de la reserva.
- **Método cerrado**: `EFECTIVO | TARJETA | TRANSFERENCIA` (`@IsIn`). El valor
  histórico `EN_PERSONA` se sigue leyendo y se pliega a efectivo en el arqueo,
  pero no se acepta en peticiones nuevas.
- **Cita iniciada**: se mantiene E3-09; una cita futura responde
  `CITA_NO_INICIADA`.
- La sede se copia de la reserva; el body no puede elegirla.

### Caja

| Verbo | Ruta | Roles |
|---|---|---|
| `GET` | `/api/v1/caja/hoy?shopId=<uuid>` | `ADMIN_BARBERIA`, `ADMINISTRADOR` |
| `POST` | `/api/v1/caja/cierre?shopId=<uuid>` | `ADMIN_BARBERIA`, `ADMINISTRADOR` |

- El **día es el de la sede**: la ventana `[00:00, 24:00)` se compone con
  `TiempoService.aInstante` sobre `barberias.zona_horaria`, no con la fecha UTC
  del servidor.
- Solo cuentan pagos `PAGADA` de esa sede cuyo `registrado_at` cae en la ventana.
- `GET` devuelve los totales vivos si la caja está abierta y, si ya hay cierre,
  **sus** cifras con `estado: 'CERRADO'` (no se recalculan).
- `POST` calcula y crea el cierre dentro de una transacción **SERIALIZABLE**,
  audita `CIERRE_CAJA` en la misma transacción y responde **409
  `CAJA_YA_CERRADA`** si ya existía. La carrera entre dos cierres se traduce del
  `P2002` del `UNIQUE` al mismo 409.
- Suma en céntimos redondeados (`0.1 + 0.2 = 0.3`), porque el `CHECK` del cierre
  compara el total con la suma exacta.

## 3 · Frontend

### Modal de cobro (`app-cobro-modal`)

Estaba anunciado en la agenda pero **no existía**: el botón «Cobrar» abría
`turnoACobrar` y no había nada montado. Ahora:

- Muestra cliente, hora, barbero, servicios y el **total a pagar** de la reserva.
- Selector de método con tres tarjetas (Efectivo / Tarjeta / Transferencia).
- Envía `POST /pagos/cobrar` **sin `monto`**: el backend cobra el total congelado.
- Avisa y deshabilita el botón si la cita aún no empezó (E3-09).
- Errores 403/404/409/422 con mensaje legible; spinner mientras cobra.
- Al cobrar, la agenda recarga y la tarjeta pasa a **COMPLETADA**.

### Caja en la vista de Pagos (`/admin/tickets`)

- Tarjetas grandes con **Efectivo**, **Tarjeta**, **Transferencia** y **Total del
  día**, más el conteo de cobros mientras está abierta.
- Badge `Caja abierta` / `Caja cerrada`.
- Botón **«Ejecutar Cierre de Caja»** → modal de confirmación que advierte que
  los datos del día se sellan y que no se puede repetir.
- Tras el 201 la vista cambia a «Caja cerrada por hoy» con la hora del cierre y
  el botón desaparece. Un 409 muestra el mensaje del backend y recarga el cierre
  que ya existía.

## 4 · Verificación

| Comando | Resultado |
|---|---|
| `backend npm run lint` | **0 errores** (116 warnings preexistentes) |
| `backend npm test` | **80 archivos · 920 tests OK** (1 skipped) |
| `frontend npm run lint` | **0 errores** |
| `frontend npx ng build` | OK |
| `frontend npm test` | 14 archivos · **120 tests OK** |
| `permisos-matriz.spec.ts` | **432 decisiones** (108 rutas × 4 roles), 0 desviaciones |

Pruebas añadidas:

- `caja.service.spec.ts` (12): suma por método, ventana local de la sede,
  `EN_PERSONA` → efectivo, redondeo, cifras congeladas tras el cierre, 403/404,
  auditoría del cierre, **doble cierre → 409** y carrera `P2002` → 409.
- `pago.service.spec.ts` (+2): **monto distinto → 422 `MONTO_NO_COINCIDE`** y la
  sede/método por defecto que se guardan en el cobro.

## 5 · Limitación → Resuelto

> **Actualización 2026-10-29 — aplicado en `neondb`.**
>
> Las migraciones `20261029180000_reserva_catalogo_hibrido`,
> `20261029190000_v3_horarios_barbero` y `20261029200000_v3_pagos_cierre`
> **ya están aplicadas con éxito en `neondb`** mediante `prisma migrate deploy`
> en el pipeline de CI (PR #116 y PR #117, fusionados en `main`).
>
> Las 7 categorías oficiales de la sede se sembraron de forma idempotente en las
> 27 barberías existentes (189 filas en `categorias_servicio`, 7 por sede,
> 0 duplicados). Desde PR #117, `BarberiaService.create()` siembra
> automáticamente las categorías al registrar una nueva sede, dentro de la misma
> transacción SERIALIZABLE.
