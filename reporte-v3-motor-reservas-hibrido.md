# Reporte — V3 Fase 4: catálogo híbrido integrado al motor de reservas

Rama: `feat/v3-motor-reservas-hibrido`
Base: `feat/v3-frontend-catalogo` (que ya contiene el backend del PR #112 y la UI del PR #113)

## 1 · Base de datos

`Reserva` no tiene tabla puente propia: el desglose de una cita vive en
`participantes_reserva` → `participante_servicios`, que era el snapshot
inmutable de cada `Servicio`.

- `participante_servicios.servicio_id` pasa a **nullable**.
- Nueva columna `servicio_barbero_id` (UUID, FK `ON DELETE RESTRICT` a
  `servicios_barbero`).
- Índices `idx_participante_servicios_servicio` y `idx_participante_servicios_barbero`.
- `CHECK participante_servicios_un_solo_servicio_check`:
  `(servicio_id IS NOT NULL) <> (servicio_barbero_id IS NOT NULL)` — exactamente
  uno de los dos catálogos, nunca los dos ni ninguno.
- Migración: `prisma/migrations/20261029180000_reserva_catalogo_hibrido/`.
  Es aditiva y no reescribe histórico: las reservas viejas conservan su
  `servicio_id`.

## 2 · Backend

### `CreateReservaDto`
- Nuevo `serviciosBarberoIds?: string[]` (UUID v4, no vacío si se envía).
- `serviciosIds` deja de ser obligatorio solo cuando llegan servicios del
  barbero: la regla de «al menos un servicio» se mantiene, pero la aplica el
  servicio con un 400 explícito en lugar de relajarse en silencio.

### `ReservaService.crearReserva`
Validaciones nuevas (todas 400 D40, antes de la transacción salvo las de catálogo):

| Código | Cuándo |
| --- | --- |
| `SERVICIOS_REQUERIDOS` | individual sin servicios de ningún catálogo |
| `CATALOGO_AMBIGUO` | llegan `serviciosIds` y `serviciosBarberoIds` a la vez |
| `CATALOGO_HIBRIDO_GRUPAL` | reserva GRUPAL con servicios propios (el grupo sigue en el catálogo heredado) |
| `BARBERO_REQUERIDO` | servicios propios sin `barberoId` |
| `SERVICIO_FUERA_DE_BARBERIA` | algún id no existe, está inactivo, no es de ese barbero o su categoría no es de esa sede |

Con `serviciosBarberoIds`:
- El precio (`totalPagar`) y la duración se **calculan en el servidor** sumando
  `precio` y `duracionMinutos` del catálogo del barbero. El
  `precioTotalEsperado` del cliente no decide el total.
- `horaFin` se deriva de `horaInicio + Σ duraciones` (el margen de la sede sigue
  yendo aparte en `margen_grupal_historico`, D42) y la disponibilidad se mide
  contra ese bloque, igual que en la reserva grupal.
- El snapshot se guarda con `servicio_barbero_id` y `margen_historico = 0`.

Con `serviciosIds` el camino es **exactamente el anterior**: misma validación,
mismo snapshot, mismo precio. Nada cambia para sedes no migradas ni para la app
móvil.

### `cotizar`
Acepta el mismo payload híbrido y devuelve `bloqueTotal` (Σ + margen de la sede),
`horaFin` calculada y `desgloseServicios` con `servicioBarberoId`. `ServicioDesglose`
ahora declara `servicioId` y `servicioBarberoId` como opcionales y excluyentes.

### Lecturas
- Agenda del día y «Mis reservas»: el nombre del servicio cae a
  `servicioBarbero.nombrePersonalizado` cuando no hay `servicio`.
- Detalle de reserva: incluye `servicioBarbero`.
- Recibo de pagos: el nombre también sale del catálogo híbrido.

## 3 · Frontend (`reserva-wizard.component.ts`)

El paso 1 pasa a **categoría → barbero → servicios de ese barbero**:

1. Pills de categoría (se preselecciona la primera).
2. Tarjetas de barbero con el número de servicios de esa categoría.
3. Servicios del barbero elegido, seleccionables, con precio y duración.
4. El paso 2 pide disponibilidad con `barberoId`, así los huecos mostrados son
   los de ese barbero.
5. El paso 3 muestra el barbero, el desglose y el total; avisa de que el total
   lo confirma el servidor.

Payload: `{ fecha, horaInicio, horaFin, serviciosBarberoIds, barberoId, precioTotalEsperado }`.
Si la sede no tiene catálogo híbrido, el asistente cae al catálogo heredado y
envía `serviciosIds`, sin romper el flujo de reserva.

`ReservasService.CrearReservaDto` incorpora `serviciosBarberoIds` y deja
`serviciosIds` opcional.

## 4 · Validación ejecutada

| Comprobación | Resultado |
| --- | --- |
| `npm run build` (backend, `nest build`) | OK |
| `npm run lint` (backend) | 0 errores (116 warnings preexistentes; ninguno nuevo en los archivos tocados) |
| `npm test` (backend) | 78 archivos, **890 passed**, 1 skipped |
| `npx vitest run reserva.service.spec.ts` | 79 tests (5 nuevos del flujo híbrido) |
| `npm run lint` (frontend) | 0 warnings, 0 errors |
| `npx ng build` (frontend) | OK |
| `npm test -- --watch=false` (frontend) | 14 archivos, 120 tests |
| E2E real contra Postgres | OK |

### E2E de la reserva híbrida (esquema temporal en la base configurada)

Se creó un esquema aislado `e2e_hibrido_<ts>`, se aplicaron **las 23 migraciones**
con `prisma migrate deploy` y se sembró sede, horario, categoría, dos servicios
del barbero y el cliente vinculado. Después se llamó al MISMO
`ReservaService.crearReserva` que usa el endpoint, con el payload del asistente
(`serviciosBarberoIds` + `barberoId` + `precioTotalEsperado: 0`):

```
PASS · reserva creada
PASS · total calculado por el servidor = 30        (el cliente había mandado 0)
PASS · hora_fin derivada de Σ duraciones → 10:40
PASS · dos líneas de snapshot
PASS · todas apuntan a servicios_barbero (servicio_id NULL)
PASS · precios históricos congelados → 20, 10
PASS · CHECK rechaza una fila con los dos catálogos
PASS · CHECK rechaza una fila sin catálogo
```

El esquema temporal se eliminó al terminar (`DROP SCHEMA ... CASCADE`); la base
compartida no recibió datos de prueba.

## 5 · Alcance consciente

- La reserva **grupal** sigue usando el catálogo heredado
  (`CATALOGO_HIBRIDO_GRUPAL`). Mezclar participantes con servicios de varios
  barberos exige decidir primero si un grupo puede ocupar a más de un barbero;
  esa regla no está en el modelo y no se inventó aquí.
- La cotización híbrida **no** persiste nada, igual que la heredada.
- El walk-in comparte `crearReserva`, así que acepta el payload híbrido aunque su
  modal todavía no lo ofrece.
