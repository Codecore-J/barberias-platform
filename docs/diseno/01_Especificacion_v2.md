# Especificación funcional v2 — Plataforma de Gestión de Barberías

| Campo | Valor |
|---|---|
| Versión | 2.0 |
| Fecha | 2026-10-21 |
| Estado | Vigente — refleja el código en `main`/`chore/integracion-pre-auditoria` |
| Sustituye | PDF de diseño 01 (v1) |
| Fuente de verdad | Backend NestJS + Prisma (`backend-barberias/`) |

> Este documento describe el comportamiento **implementado**, no el deseado. Cuando el diseño original y el código difieren, se indica expresamente en la sección 12.

---

## 1. Propósito y actores

Plataforma multi-sede para que una barbería publique su catálogo, horarios y agenda, reciba reservas individuales o grupales, cobre y haga seguimiento de sus clientes. El backend es la única autoridad: ninguna regla se valida solo en el frontend.

### 1.1 Roles

| Rol | Ámbito | Qué puede hacer |
|---|---|---|
| `ADMINISTRADOR` | `GLOBAL` | Crear sedes, aprobar solicitudes de cambio, suspender/reactivar cuentas, ver la plataforma completa. No pertenece a una sede concreta. |
| `ADMIN_BARBERIA` | `BARBERIA` | Administrar su sede: catálogo, horarios, agenda, reservas, pagos, personal, vinculaciones y configuración. |
| `BARBERO` | `BARBERIA` | Ver y operar su agenda, marcar estados de sus citas, consultar catálogo y horarios. |
| `CLIENTE` | `GLOBAL` (se vincula por sede) | Reservar, cancelar dentro de la ventana, proponer un horario nuevo, anotarse a la lista de espera, ver sus reservas y notificaciones. |

Reglas de alcance (`src/iam/domain/roles.ts`):

- Un rol de ámbito `BARBERIA` **siempre** lleva `barberiaId`; sin él la asignación es inválida (422).
- Un `barberiaId` nulo solo actúa como comodín para roles `GLOBAL`.
- La pertenencia real de un `CLIENTE` se resuelve contra `cliente_barberias`; la de `BARBERO`/`ADMIN_BARBERIA`, contra `usuario_roles`.
- `ADMINISTRADOR` es transversal y se comprueba con `esAdministradorGlobal()`.

### 1.2 Visitante

Puede registrarse, iniciar sesión, recuperar contraseña y consultar lecturas abiertas (sedes activas, catálogo público). Todo lo demás exige JWT.

---

## 2. Onboarding y multi-sede

1. Un usuario se registra como `CLIENTE` y recibe un JWT.
2. `ADMINISTRADOR` crea la sede con nombre, teléfono, ubicación, responsable, `codigoAcceso` y `enlaceUnico`.
3. El cliente se vincula a la sede con el código de acceso o el enlace de invitación (`/unirse/:enlaceUnico`). La vinculación queda en `cliente_barberias` con `estadoVinculacion = ACTIVO`.
4. El `ADMIN_BARBERIA` invita a su personal; el rol `BARBERO` se asigna con la sede.
5. El cliente selecciona una sede activa en el frontend; esa selección viaja como cabecera `x-barberia-id` y alimenta el guard de tenant.

Una sede puede estar `ACTIVO` o `INACTIVO`. Una sede inactiva no vende huecos, no acepta reservas nuevas y no aparece en los listados públicos. El estado se cambia con **desactivar/reactivar**, nunca borrando filas.

### 2.1 Cambios sensibles de la sede (D26)

El nombre y el responsable **no** se editan directamente. `ADMIN_BARBERIA` crea una `SolicitudCambioBarberia` (tipo `NOMBRE` o `RESPONSABLE`) y `ADMINISTRADOR` la aprueba o rechaza. Descripción, ubicación y logo sí son edición directa.

---

## 3. Catálogo

### 3.1 Servicios

- Campos: nombre, precio, `duracionEstimada` (minutos), `margenOperativo` (minutos), destacado, estado.
- Estados: `ACTIVO` / `INACTIVO` (CHECK en base desde `20261014000000_e207_catalogo_estado_check`).
- Un servicio inactivo no se puede reservar, pero las reservas históricas conservan su snapshot.
- El precio y la duración **nunca** los envía el cliente al reservar (D44): se toman del catálogo y se congelan.

### 3.2 Combos

- Agrupan servicios y/o sub-combos; tienen `precioEspecial`, `duracionPropia` y `margenPropio`.
- Se administran en el catálogo (CRUD completo), pero **la reserva V1 opera con servicios**: los combos aún no se pueden elegir en el flujo de reserva.

### 3.3 Vocabulario de baja

No se usa `DELETE` para representar un cambio de estado. Se **desactiva** (reversible) un servicio o combo, se **cancela** una reserva, se **desvincula** un cliente y solo se **elimina** cuando el borrado es real y autorizado.

---

## 4. Horarios y agenda

| Elemento | Descripción |
|---|---|
| `horarios` | Franja semanal por sede: `diaSemana` (0–6) + `horaInicio`/`horaFin`. |
| `excepciones_horario` | Por fecha: `CERRADA` (no se atiende) o `HORARIO_ESPECIAL` (franja distinta). |
| `horarios_barbero` | Franja semanal propia de cada barbero; puede restringir la de la sede. |
| `excepciones_barbero` | Excepción puntual de un barbero (vacaciones, permiso). |
| `bloqueos_agenda` | Bloqueo manual de un tramo (reunión, mantenimiento); tiene `liberadoAt` cuando se libera. |

### 4.1 Reglas de disponibilidad

- La disponibilidad se **calcula en tiempo real**; nunca se almacena (D37).
- Rejilla de 15 minutos (`PASO_MINUTOS`); las alternativas se ofrecen cada 30 minutos (`PASO_DISPONIBILIDAD_MINUTOS`), máximo 5.
- Ocupan agenda: reservas `PENDIENTE` y `CONFIRMADA`, más los bloqueos manuales activos. Una `propuesta_horario` **no** retiene el bloque propuesto (H41: se revalida al aceptar).
- Un bloque debe caber completo, margen incluido, dentro de una franja. No se ofrecen horarios en el pasado.
- Los instantes se calculan con la **zona horaria de la sede** (`barberias.zonaHoraria`, por defecto `America/Santo_Domingo`); `fecha_cita` y `hora_*` son etiquetas locales, no UTC.
- Si el barbero tiene horario propio, la intersección con la sede es la que manda.

---

## 5. Reservas

### 5.1 Tipos

- **Individual:** un cliente, uno o más servicios.
- **Grupal (D46):** un adulto responsable más uno o más niños. El bloque es la suma de duraciones de **todos** los participantes más **un solo** margen de la sede (D42). Límites: `maxNinos` y `maxPersonasTotal` de la configuración.

### 5.2 Creación

1. Se valida la sede activa, la configuración (`nuevasReservasActivas`), el tipo aceptado y el horizonte (`horizonteReservaDias`, medido en días de la sede).
2. Se valida `maxPendientes`: la sede no admite más solicitudes mientras tenga ese número de reservas en `PENDIENTE` o `PROPUESTA_PENDIENTE`.
3. Se leen los servicios del catálogo, sus precios y duraciones y se calcula el bloque: `Σ duraciones + margenGrupalMinutos`.
4. Se comprueba la disponibilidad real y se abre una transacción `SERIALIZABLE` con `SELECT … FOR UPDATE` sobre la fila de la sede (`bloquearSedeParaEscritura`), para que dos altas simultáneas no vendan el mismo hueco.
5. Se crea la reserva con snapshots históricos:
   - `precioHistorico`, `duracionHistorica`, `margenHistorico` por servicio;
   - `margenGrupalHistorico` en la reserva;
   - `totalPagar` calculado en backend.
6. Según `modoReserva`:
   - `MANUAL`: nace `PENDIENTE`, con `expiraAt = ahora + 10 min` y job de expiración encolado.
   - `AUTOMATICA`: nace `CONFIRMADA`, sin temporizador.

### 5.3 Estados y transiciones

Estados (`src/shared/domain/estados.ts`): `PENDIENTE`, `CONFIRMADA`, `RECHAZADA`, `PROPUESTA_PENDIENTE`, `EXPIRADA`, `NO_PRESENTADO`, `CANCELADA`, `COMPLETADA`.

| Transición | Actor | Condición |
|---|---|---|
| creación → `PENDIENTE` | CLIENTE | modo `MANUAL` |
| creación → `CONFIRMADA` | CLIENTE | modo `AUTOMATICO` |
| `PENDIENTE` → `CONFIRMADA` | STAFF | revalidación de disponibilidad |
| `PENDIENTE` → `RECHAZADA` | STAFF | motivo del catálogo §5.5 |
| `PENDIENTE` → `EXPIRADA` | SISTEMA | `expiraAt <= ahora` |
| `CONFIRMADA` → `CANCELADA` | CLIENTE / STAFF | ventana de 30 min si es CLIENTE |
| `CONFIRMADA` → `NO_PRESENTADO` | STAFF | ahora ≥ inicio + 15 min |
| `CONFIRMADA` → `COMPLETADA` | STAFF | cita atendida |
| `PENDIENTE` → `PROPUESTA_PENDIENTE` | STAFF | declarada en el grafo; **el flujo actual de propuestas no la usa** (ver §12) |
| `PROPUESTA_PENDIENTE` → `EXPIRADA` | SISTEMA | propuesta vencida (solo si una fila llegara a ese estado) |

Las transiciones se validan en una máquina de estados pura (`ReservaStateMachine`). Una transición no declarada responde 409 `ESTADO_INVALIDO`. Al entrar en `CANCELADA`, `RECHAZADA` o `EXPIRADA` se limpia la información adicional; al salir de un estado expirable se cancela el job de expiración (best-effort, después del commit).

### 5.4 Expiración

- Toda reserva `PENDIENTE` o `PROPUESTA_PENDIENTE` tiene `expiraAt` y un job BullMQ con `jobId` determinístico (`expirar-reserva-<uuid>`).
- Si el job no llega (Redis reiniciado, proceso caído), `ExpiracionReservaService` reconcilia al arrancar: expira las vencidas y reencola las vigentes que se quedaron sin job.
- La transición es idempotente: `UPDATE … WHERE estado IN (...) AND expira_at <= ahora`; si otra operación ganó, no se audita ni se notifica.

### 5.5 Cancelación

- **Cliente:** una solicitud `PENDIENTE` se puede retirar en cualquier momento; una `CONFIRMADA` solo si faltan **30 minutos o más** para el inicio (`VENTANA_CANCELACION_CLIENTE_MIN`). Fuera de la ventana se rechaza con 422 `FUERA_DE_VENTANA`.
- **Staff de la sede:** puede cancelar en cualquier momento anterior al inicio.
- **Cancelación especial (D17):** si la sede habilita `permiteCancelacionEspecial`, el cliente puede pedirla fuera de la ventana; la sede la aprueba o rechaza. Mientras está pendiente, la reserva sigue ocupando agenda.
- Al cancelar se libera el bloque, se cancela el job de expiración, se audita `RESERVA_CANCELADA` y se avisa a la lista de espera (Carril B).

### 5.6 Reprogramación y propuestas (D18)

- **Reprogramación directa:** `PATCH /reservas/:id/reprogramar` (`ADMIN_BARBERIA`, `ADMINISTRADOR`). Mueve la cita de inmediato conservando su estado, previa revalidación del bloque.
- **Propuesta del cliente:** `POST /reservas/:id/proponer-horario` (`CLIENTE` dueño) crea una `propuesta_horario` en `PENDIENTE` con ventana de **10 minutos**. La reserva **no cambia de estado** y sigue ocupando su bloque actual; el bloque propuesto **no se retiene** (H41).
- La sede acepta (`…/propuesta-horario/aceptar`) o rechaza (`…/propuesta-horario/rechazar`). Al aceptar se revalida la disponibilidad bajo el lock de la sede y se mueve la cita; al rechazar o vencer, la propuesta queda resuelta y la reserva no se toca.
- Toda reprogramación o aceptación de propuesta libera el bloque anterior, que se anuncia al Carril B.

### 5.7 No presentado y fidelización (D48)

- Se puede marcar `NO_PRESENTADO` a partir de `inicio + 15 min` (5 de puntualidad + 10 de tolerancia).
- 3 inasistencias en una sede → advertencia visible en el perfil.
- 5 inasistencias en **esa** sede → `estaRestringido = true` con motivo. La restricción es por sede, nunca global, y sobrevive a desvincular/revincular.
- El cliente ve su estado en `GET /barberias/:id/mi-estado`; el admin puede levantarla con `POST /barberias/:id/clientes/:usuarioId/reactivar`.

---

## 6. Pagos

- `POST …/pagos` registra un cobro sobre una reserva; el monto es opcional (por defecto, el total pactado) y el método es texto libre (`EFECTIVO`, `TARJETA`, `TRANSFERENCIA`, …).
- `POST …/pagos/:id/anular` exige **motivo** (H68) y deja rastro de auditoría; no se borra la fila.
- El pago es potestativo: una reserva puede atenderse sin pago registrado. No hay pasarela integrada.
- `BARBERO` puede **registrar** cobros; el historial y la anulación son de `ADMIN_BARBERIA` (su sede) y `ADMINISTRADOR`.

---

## 7. Carril A — alternativas inmediatas (D47)

Cuando el bloque pedido no cabe, el error 409 `CONFLICTO_HORARIO` (o 422 `CAPACIDAD_EXCEDIDA`) incluye `alternativas`: hasta 5 bloques cercanos, calculados con el **mismo** motor puro que la disponibilidad (`src/agenda/domain/huecos.ts`).

- Cada alternativa lleva fecha/hora de inicio y fin.
- No retiene el hueco: al confirmar se revalida y, si se ocupó, responde 409. Es intencionalmente honesto.
- `GET /barberias/:barberiaId/disponibilidad/huecos` expone el mismo cálculo de forma proactiva (Carril B de E4-02). Si `oportunidadesEspacioActivas` es `false`, responde 200 con lista vacía.
- Solo lectura: no toma locks ni participa de la transacción de escritura.

---

## 8. Carril B — lista de espera reactiva (D22)

### 8.1 Alta

`POST /lista-espera` (rol `CLIENTE`):

```json
{
  "barberiaId": "uuid",
  "fechaObjetivo": "2026-10-25",
  "servicios": ["uuid-servicio-1", "uuid-servicio-2"]
}
```

- `usuarioId` sale del token, nunca del cuerpo.
- Todos los servicios deben pertenecer a esa sede (si no, 400 `SERVICIOS_INVALIDOS`).
- Solo puede existir **una suscripción viva** (`PENDIENTE`) por cliente + sede + fecha; si ya existe, 409 `SUSCRIPCION_DUPLICADA`.
- La fila nace `PENDIENTE` y no ocupa agenda.

### 8.2 Disparador

Cuando una reserva deja de ocupar su bloque, `ReservaService`/`ExpiracionReservaService` emiten el job `HUECO_LIBERADO` en la cola `lista-espera`, **después del commit** y con techo de 2 s:

- cancelación del cliente o del staff;
- cancelación especial aprobada;
- reprogramación o aceptación de propuesta (bloque anterior);
- rechazo de una solicitud;
- expiración automática.

Payload: `barberiaId`, `fecha` (`YYYY-MM-DD` de la sede), `inicio` y `fin` como instantes ISO, `reservaId` para trazabilidad.

### 8.3 Emparejamiento

`ListaEsperaMatcherService`:

1. Descarta payloads inválidos, bloques pasados o **en curso** y sedes inexistentes.
2. Lee `margenGrupalMinutos` de la configuración vigente (no el histórico de la reserva cancelada).
3. Busca suscripciones `PENDIENTE` de esa sede y fecha, orden `creadoAt asc, id asc` (FIFO).
4. Para cada una calcula `Σ duracionEstimada + margen` y comprueba que quepa en la duración física del hueco.
5. La primera que cabe pasa a `NOTIFICADO` con un `UPDATE … WHERE estado = 'PENDIENTE'` dentro de una transacción `SERIALIZABLE`; si el conteo es 0, otro worker ganó y se sigue con la siguiente.
6. Solo entonces se notifica. **Un hueco produce como mucho un aviso**: avisar a varios convertiría el hueco en una carrera donde todos menos uno reciben 409.

### 8.4 Estados de la suscripción

`PENDIENTE → NOTIFICADO → CERRADO`.

- `PENDIENTE`: esperando un hueco.
- `NOTIFICADO`: ya recibió el aviso de un hueco concreto (una vez por hueco).
- `CERRADO`: terminal (venció o el cliente consiguió cita). **El cierre automático aún no está implementado**; hoy lo hará una tarea posterior.

### 8.5 Límites conocidos

- El aviso no reserva el hueco: entre `NOTIFICADO` y la reserva real, otro cliente puede tomarlo (el aviso es una oportunidad, no un bloqueo).
- Si el worker muere justo después del test-and-set, un reintento del job podría avisar a una segunda candidata (HALLAZGO-CB-02, abierto).
- La implementación V1 es una lista explícita de suscripciones; no es el fan-out a 25 elegibles que describía el borrador de D22 (ver §12).

---

## 9. Notificaciones

- Se persisten en `notificaciones` (`PENDIENTE` → `ENVIADO`) y se encolan en la cola `notificaciones`.
- Tipos actuales: `RESERVA_CREADA`, `RESERVA_CONFIRMADA`, `RESERVA_RECHAZADA`, `RESERVA_CANCELADA`, `RESERVA_EXPIRADA`, `RESERVA_REPROGRAMADA`, `LISTA_ESPERA_HUECO_LIBERADO`, `RECORDATORIO_CITA`.
- El recordatorio se programa 1 hora antes y se descarta si la reserva ya está cancelada, expirada o no presentada.
- **El envío externo está simulado**: `NotificacionProcessor` registra el mensaje y marca `ENVIADO`; no hay proveedor de email/SMS/push conectado.
- El cliente consulta las suyas en `GET /notificaciones/mis-notificaciones`.

---

## 10. Auditoría

- Cada operación sensible registra `usuarioId`, `accion`, `entidad`, `entidadId`, contexto y `barberiaId` cuando aplica.
- Acciones típicas: `RESERVA_CREADA`, `RESERVA_CONFIRMADA`, `RESERVA_RECHAZADA`, `RESERVA_CANCELADA`, `RESERVA_EXPIRADA`, `PAGO_REGISTRADO`, `PAGO_ANULADO`, `CLIENTE_RESTRINGIDO`, `VINCULACION_*`, `SOLICITUD_CAMBIO_*`.
- La purga corre a las 03:00 (job `purga-auditoria-diaria`); retención por defecto: 365 días.
- `ADMINISTRADOR` puede consultar la auditoría de la plataforma; el staff, la de su sede.

---

## 11. Contrato de errores (D40)

Los errores de negocio tienen forma estable:

```json
{
  "statusCode": 409,
  "codigo": "CONFLICTO_HORARIO",
  "mensaje": "El horario seleccionado ya no está disponible."
}
```

- `codigo` en `SCREAMING_SNAKE_CASE`; `mensaje` en español, apto para el usuario.
- 400 validación / 401 sin sesión / 403 sin permiso / 404 no existe / 409 conflicto / 422 regla de negocio.
- Algunos 422 añaden datos extra (`detalle`, `conteo`, `alternativas`), siempre junto al contrato base.
- El filtro global de Prisma traduce `P2002` a 409, `P2025` a 404 y los errores de serialización a 409.

---

## 12. Reglas consolidadas y desviaciones

### 12.1 Reglas innegociables

| Regla | Contenido |
|---|---|
| **D42** | El margen del bloque (individual o grupal) es `configuracion_barberia.margen_grupal_minutos` (default 10, rango 0–60), con snapshot en `reservas.margen_grupal_historico`. Nunca la suma ni el mayor de los márgenes individuales; nunca lo provee el cliente. |
| **D37** | La disponibilidad se calcula; no se almacena. Una sugerencia no retiene el hueco. |
| **D44** | Precio, duración y margen los decide el backend; el cliente solo pide servicios y una ventana. |
| **D47** | Un único calculador de huecos para Carril A, Carril B proactivo, creación y cotización. |
| **D29** | Prohibido el borrado físico para representar estados. |
| **D15 / E2-04** | Etiquetas de fecha/hora locales a la sede + zona horaria; instantes en UTC. |
| **D11** | `APP_ENV` obligatorio (`dev`, `staging`, `production`); los tests destructivos solo corren en `dev`. |
| **Snapshot** | Precio, duración y margen de una reserva confirmada se congelan y no cambian si el catálogo cambia. |
| **Fail-closed** | Todo endpoint declara `@Public()`, `@Autenticado()` o `@Roles(...)`; sin decorador, se deniega. |

### 12.2 Desviaciones documentadas

1. **Carril B V1** implementa una lista de espera con suscripción explícita (FIFO, un aviso por hueco). El borrador de D22 describía un fan-out a un máximo de 25 clientes elegibles con notificación APP; esa variante no está implementada. La suscripción permite al cliente declarar qué aceptaría y evita avisos masivos.
2. **Notificaciones**: el procesador simula el envío; no hay SendGrid/Twilio/FCM.
3. **Cierre de suscripciones**: `CERRADO` existe en el catálogo y en el CHECK, pero todavía no hay job que cierre por vencimiento ni al conseguir cita.
4. **Reportes**: la tabla `reportes` y el módulo existen en el esquema, pero el módulo `src/cliente/` está deliberadamente sin registrar (H22). Las rutas de ficha/notas responden 404.
5. **`PROPUESTA_PENDIENTE` sin escritor**: el estado está en el catálogo y en la máquina, y la expiración lo contempla, pero el flujo de E3-08 guarda la propuesta en `propuestas_horario` sin mover el estado de la reserva. Se documenta para no asumir que una reserva con propuesta vive en `PROPUESTA_PENDIENTE`.
6. **Ocupación de propuestas (H41)**: la disponibilidad solo cuenta reservas `PENDIENTE`/`CONFIRMADA` y bloqueos; el bloque propuesto no se retiene y se revalida al aceptar.

---

## 13. Fuera de alcance de esta versión

- Pasarela de pago real y conciliación.
- Proveedor real de email/SMS/WhatsApp/push.
- Reportes y métricas de negocio.
- Lista de espera con reserva automática o bloqueo temporal del hueco.
- App móvil nativa.

---

## 14. Referencias

- `docs/BACKLOG_BARBERIAS_V1.md` — decisiones D01–D48 y criterios de aceptación.
- `docs/MATRIZ_RUTAS.md` — rutas, roles y guards por endpoint.
- `docs/diseno/02_Arquitectura_v2.md` — mapa técnico.
- `docs/ENTORNOS.md` y `docs/DESPLIEGUE.md` — operación.
