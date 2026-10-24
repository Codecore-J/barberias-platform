# MATRIZ_RUTAS.md · Permisos por ruta (E1-05)

> **Estado: aplicada.** Este documento nació como inventario de solo lectura en `main` y
> ahora refleja la política que hay en `fix/matriz-permisos`, rama de E1-05.
> La tabla de rutas es la que produce `test/route-security.spec.ts` (`=== TABLA DE RUTAS (80) ===`)
> y la que verifica `test/permisos-matriz.spec.ts` (80 rutas × 4 roles = 320 decisiones). El número
> crece con cada épica: la tabla de abajo se amplía al final para no renumerar las filas ya citadas.

## Cómo leerla

- **Ruta**: cada celda lista la ruta canónica y, separados por `·`, sus alias. `AgendaController` se declara
  `@Controller(['barberias/:barberiaId/agenda', 'agenda'])`, así que `POST /agenda/bloqueos` y
  `POST /barberias/:id/agenda/bloqueos` son **la misma ruta**. Cada fila cuenta una combinación de
  método + controlador, y el decorador es el mismo para todos sus alias. Hay cinco controladores con más de
  un prefijo: `AgendaController` (`agenda`), `ReservaController` (`reservas`), `ServiciosController`
  (`servicios`), `PagoController` (`cobros`, `pagos`) y `HealthController` (`api/v1/health`).
- **Antes**: decorador que tenía la ruta en `main` (`05a0961`). **Aplicado**: decorador actual.
- **Decisión**: número de la decisión del dueño que fija la política, o «matriz» cuando sale directamente
  de la sección 4 del backlog.
- **Tenant (T)**: hace falta comprobar que el usuario tiene relación con **esa** barbería (rol detallado,
  responsable o vínculo de cliente). Sin esto, un admin de la barbería A opera la B.
- **Ownership (O)**: hace falta comprobar que el recurso concreto pertenece al actor (su reserva, su
  horario, su antecedente). Es distinto del tenant: mismo tenant, recurso de otro.

## Advertencias que afectan a todo el documento

1. **`RolesGuard` concede el acceso al `ADMINISTRADOR` antes de mirar la lista de roles.** La regla de
   jerarquía de E1-04 hace que `@Roles('CLIENTE')` signifique «CLIENTE y el administrador global», no solo
   CLIENTE. La matriz del test de E1-05 recoge esa diferencia: la política declarada y la decisión
   efectiva del guard no son la misma lista. También explica por qué `GET /barberias/:id/personal` (fila
   19), cuyo decorador solo nombra `ADMIN_BARBERIA` y `BARBERO`, sigue funcionando para el administrador
   global: el guard lo deja pasar y `findPersonal` le da acceso transversal.
2. **`@CurrentBarberiaId` no es `@Param('barberiaId', ParseUUIDPipe)`.** En `PagoController` el tenant llega
   por param, header `x-barberia-id` o query, y devuelve `null` si no hay ninguno. Por eso los alias
   `/cobros` y `/pagos` funcionan sin `barberiaId` en la URL, a diferencia de `AgendaController` y
   `AntecedenteController`, donde el `ParseUUIDPipe` devuelve 400 si falta.
3. **El frontend llama a dos rutas que no existen.** `GET /clientes/:id/ficha` y `POST /clientes/:id/notas`
   están en `frontend-barberias/src/app/core/services/clientes.service.ts:38,55`, pero `ClienteModule` no
   está registrado en `AppModule` (`app.module.ts:56-58`, comentario H22) y sus rutas responden 404. No
   figuran entre las 55 porque no existen en el servidor.
   **El rol ya está corregido** (`fix/rol-admin-inexistente`): declaraban `@Roles('BARBERO', 'ADMIN')`, y
   `ADMIN` no existe en el catálogo de roles —`roles.ts` solo tiene ADMINISTRADOR, ADMIN_BARBERIA, BARBERO
   y CLIENTE—, así que nadie podía tener ese rol y el ADMIN_BARBERIA de la sede recibía 403 en las dos
   rutas sin querer. Ahora es `@Roles('BARBERO', 'ADMIN_BARBERIA')`.
   **Lo que sigue pendiente NO es de este PR:** publicar el módulo. `app.module.spec.ts:50` exige
   explícitamente que `ClienteController` no esté en el grafo, así que registrarla es la tarea E4-05 y
   requiere desactivar ese test a la vez. El spec de este arreglo monta `ClienteModule` por separado para
   poder probar la política del controlador sin tocar esa decisión.
4. **E1-05 no cambia lógica de negocio.** Solo sustituye decoradores, con la excepción del DTO de lectura
   de `GET /barberias/:id` (decisión 3). Lo que exigía lógica nueva queda anotado como `TODO` con su
   tarea: E1-06 (vinculación en disponibilidad), E1-07 (límite de 2 barberías), E3-03 y
   E3-09 (cobro de reservas asignadas; cerrado en `4b62cf7`). De E3-03, la partición de rutas
   (`POST /reservas` solo CLIENTE + `POST /reservas/walk-in` para el staff) está cerrada en
   `758a70d`; **sigue abierto el resto de E3-03**: orden de validaciones
   (`NO_VINCULADO`/`CLIENTE_RESTRINGIDO`/pausa/horizonte/`max_pendientes`), 422
   `GRUPAL_NO_DISPONIBLE`, `FOR UPDATE` bajo SERIALIZABLE y el endpoint de cotización (D44).

## La matriz

| # | Método | Ruta (alias incluidos) | Controlador | Antes | Aplicado | Decisión | T | O | ¿La usa el frontend? | Test |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | GET | `/` | AppController | `@Public` | `@Public` | — | — | — | no | `src/app.controller.spec.ts` |
| 2 | POST | `/auth/register` | AuthController | `@Public` | `@Public` | — | — | — | sí — `auth/auth.service.ts:62` | `src/iam/infrastructure/auth.controller.spec.ts`; `test/auth.e2e-spec.ts` |
| 3 | POST | `/auth/login` | AuthController | `@Public` | `@Public` | — | — | — | sí — `auth/auth.service.ts:83` | `src/iam/infrastructure/auth.controller.spec.ts`; `test/auth.e2e-spec.ts` |
| 4 | GET | `/auth/me` | AuthController | `@Autenticado` | `@Autenticado` | — | no | no (es el propio) | sí — `auth/auth.service.ts:153` | `src/iam/infrastructure/auth.controller.spec.ts` |
| 5 | POST | `/auth/forgot-password` | AuthController | `@Public` | `@Public` | — | — | — | sí — `auth/auth.service.ts:170` | ninguno |
| 6 | POST | `/auth/reset-password` | AuthController | `@Public` | `@Public` | — | — | — | sí — `auth/auth.service.ts:174` | ninguno |
| 7 | GET | `/health` · `api/v1/health` | HealthController | `@Public` | `@Public` | — | — | — | no | `test/health.e2e-spec.ts` |
| 8 | GET | `/notificaciones/mis-notificaciones` | NotificacionController | `@Autenticado` | `@Autenticado` | — | no | no (es el propio) | sí — `core/services/notification.service.ts:29` | ninguno |
| 9 | GET | `/auditoria` | AuditoriaController | `@Roles(ADMINISTRADOR, ADMIN_BARBERIA)` | `@Roles(ADMINISTRADOR, ADMIN_BARBERIA)` | E1-02 | **sí** | no | no — `pagos.service.ts:38` llama al alias `/cobros/auditoria`, que es la fila 37 | `test/h18-auditoria-cross-tenant.e2e-spec.ts`; `src/auditoria/application/auditoria.service.spec.ts` |
| 10 | GET | `/auditoria/estadisticas` | AuditoriaController | `@Roles(ADMINISTRADOR)` | `@Roles(ADMINISTRADOR)` | matriz | no | no | sí — `core/services/pagos.service.ts:56` | `src/auditoria/infrastructure/auditoria.controller.spec.ts` |
| 11 | POST | `/auditoria/purgar` | AuditoriaController | `@Roles(ADMINISTRADOR)` | `@Roles(ADMINISTRADOR)` | matriz | no | no | sí — `core/services/pagos.service.ts:65` | `src/auditoria/infrastructure/auditoria.controller.spec.ts` |
| 12 | GET | `/barberias` | BarberiaController | `@Autenticado` | `@Autenticado` | — | no (filtra por `responsableId`) | **sí** — `veCodigoDe` por sede (E1-07) | sí — `core/services/tenant.service.ts:64` | `test/barberia.e2e-spec.ts`; `src/barberia/application/barberia.service.spec.ts` |
| 13 | POST | `/barberias` | BarberiaController | `@Autenticado` | `@Autenticado` | **1** | no | no | sí — `core/services/tenant.service.ts:133` | `src/barberia/application/barberia.service.spec.ts` |
| 14 | PATCH | `/barberias/:id/seleccionar` | BarberiaController | `@Autenticado` | `@Roles(CLIENTE, BARBERO, ADMIN_BARBERIA, ADMINISTRADOR)` | **2** | **sí** — `cliente_barberias`, `usuario_roles` o ser el responsable (`d93e9af`) | **sí** — `estado_vinculacion = 'ACTIVO'` **solo en la vía `cliente_barberias`** | sí — `core/services/tenant.service.ts:94` y `:137` | `src/barberia/application/barberia.service.spec.ts`; `test/barberia.e2e-spec.ts` |
| 15 | GET | `/barberias/:id` | BarberiaController | `@Autenticado` | `@Autenticado` + DTO de lectura | **3** | no | no | **no** | `src/barberia/application/barberia.service.spec.ts` |
| 16 | PATCH | `/barberias/:id` | BarberiaController | `@Autenticado` | `@Roles(ADMIN_BARBERIA, ADMINISTRADOR)` | matriz | **sí** | **sí** — responsable, salvo ADMINISTRADOR. **E3-13 (D26/D27):** solo `descripcion`, `ubicacion`, `logoUrl` y `telefono`; el nombre responde 422 `NOMBRE_REQUIERE_SOLICITUD` y el estado 422 `ESTADO_NO_EDITABLE`; cambiar el teléfono exige la contraseña actual (422 `PASSWORD_REQUERIDA` / `PASSWORD_INCORRECTA`) | **no** | `test/hallazgo16-rolesguard-global.e2e-spec.ts`; `test/e3-13-solicitudes-cambio.e2e-spec.ts` |
| 17 | PATCH | `/barberias/:id/estado` | BarberiaController | — (era `DELETE /barberias/:id`) | `@Roles(ADMINISTRADOR)` | **4** | no (el guard ya acota) | **sí** — E2-07: es cambio de estado (`ACTIVO`/`INACTIVO`), idempotente, y la sede NO se borra | no | `test/permisos-matriz.e2e-spec.ts`; `test/e2-07-vocabulario.e2e-spec.ts` |
| 18 | GET | `/barberias/all` | BarberiaController | `@Roles(ADMINISTRADOR)` | `@Roles(ADMINISTRADOR)` | E1-04 | no | no | no | ninguno |
| 19 | GET | `/barberias/:id/personal` | BarberiaController | `@Roles(ADMIN_BARBERIA, BARBERO)` | `@Roles(ADMIN_BARBERIA, BARBERO)` | E1-03 | **sí** | no | sí — `core/services/personal.service.ts:22` | `test/h19-h20-lecturas-abiertas.e2e-spec.ts`; `src/barberia/application/barberia.service.spec.ts` |
| 20 | POST | `/barberias/vincular` | BarberiaController | `@Autenticado` | `@Roles(CLIENTE)` | **5** | no | **sí** — un vínculo `DESVINCULADO` del par (usuario, sede) se REABRE en vez de devolverse cerrado (D21 · H71): la misma fila vuelve a `PENDIENTE_APROBACION` —o a `ACTIVO` si ya tiene hueco— y audita `VINCULACION_REACTIVADA` con anterior y nuevo (D28). Un vínculo vivo se sigue devolviendo tal cual (idempotencia) | sí — `core/services/tenant.service.ts:115`; el botón ya solo se muestra a CLIENTE | `test/barberia.e2e-spec.ts`; `test/e3-12-vinculacion.e2e-spec.ts` (H71); `src/barberia/application/barberia.service.spec.ts` |
| 21 | GET | `/barberias/:barberiaId/agenda/bloqueos` · `/agenda/bloqueos` | AgendaController | `@Roles(ADMIN_BARBERIA, BARBERO)` | `@Roles(ADMIN_BARBERIA, BARBERO)` | E1-03 | **sí** — `validateAccess` | no | sí — `core/services/horarios.service.ts:83` | `test/h19-h20-lecturas-abiertas.e2e-spec.ts`; `src/agenda/application/agenda.service.spec.ts` |
| 22 | POST | `/barberias/:barberiaId/agenda/bloqueos` · `/agenda/bloqueos` | AgendaController | `@Autenticado` | `@Roles(ADMIN_BARBERIA, ADMINISTRADOR)` | matriz | **sí** — `validateAccess` | no | sí — `core/services/horarios.service.ts:87` | `src/agenda/application/agenda.service.spec.ts` |
| 23 | POST | `/barberias/:barberiaId/agenda/bloqueos/:id/liberar` · `/agenda/bloqueos/:id/liberar` | AgendaController | — (era `DELETE .../bloqueos/:id`) | `@Roles(ADMIN_BARBERIA, ADMINISTRADOR)` | matriz | **sí** — `validateAccess` | **sí** — el bloqueo debe ser de esa barbería | sí — `core/services/horarios.service.ts:95` | `src/agenda/application/agenda.service.spec.ts`; `test/e2-07-vocabulario.e2e-spec.ts` |
| 24 | GET | `/barberias/:barberiaId/agenda/disponibilidad` · `/agenda/disponibilidad` | AgendaController | `@Autenticado` | `@Roles(CLIENTE, BARBERO, ADMIN_BARBERIA, ADMINISTRADOR)` | **6** | **sí** — `calcularDisponibilidadDeSolicitante` (`d93e9af`) | no | sí — `core/services/reservas.service.ts:38`, que llama al alias `/agenda/disponibilidad` | `src/agenda/application/disponibilidad.service.spec.ts`; `test/e1-06-sede-del-tenant.e2e-spec.ts` |
| 25 | POST | `/barberias/:barberiaId/agenda/disponibilidad` · `/agenda/disponibilidad` | AgendaController | `@Autenticado` | `@Roles(CLIENTE, BARBERO, ADMIN_BARBERIA, ADMINISTRADOR)` | **6** | **sí** — `calcularDisponibilidadDeSolicitante` (`d93e9af`) | no | no | `src/agenda/application/disponibilidad.service.spec.ts`; `test/e1-06-sede-del-tenant.e2e-spec.ts` |
| 25bis | GET | `/barberias/:barberiaId/disponibilidad/huecos` · `/disponibilidad/huecos` | HuecosController | `@Autenticado` | `@Roles(CLIENTE, ADMIN_BARBERIA, ADMINISTRADOR)` | E4-02 | **sí** — `exigirPertenencia` (mismo guard que la disponibilidad) | no | no | `src/agenda/domain/huecos.spec.ts`; `test/permisos-matriz.e2e-spec.ts`; `test/e4-02-oportunidades.e2e-spec.ts` |
| 26 | POST | `/barberias/:barberiaId/antecedentes` | AntecedenteController | `@Autenticado` | `@Roles(BARBERO, ADMIN_BARBERIA, ADMINISTRADOR)` | **7** | **sí** | no | no | `src/antecedente/application/antecedente.service.spec.ts` |
| 27 | PATCH | `/barberias/:barberiaId/antecedentes/:id/evaluar` | AntecedenteController | `@Autenticado` | `@Roles(ADMIN_BARBERIA, ADMINISTRADOR)` | matriz (D35) | **sí** | **sí** — el antecedente debe ser de esa barbería | sí — `core/services/antecedentes.service.ts:29` | `src/antecedente/application/antecedente.service.spec.ts` |
| 28 | GET | `/barberias/:barberiaId/antecedentes/cliente/:clienteId` | AntecedenteController | `@Autenticado` | `@Roles(ADMIN_BARBERIA, ADMINISTRADOR)` | **7** | **sí** | **sí** — el cliente debe estar vinculado a esa barbería | no | `src/antecedente/application/antecedente.service.spec.ts` |
| 29 | GET | `/barberias/:barberiaId/antecedentes/pendientes` | AntecedenteController | `@Autenticado` | `@Roles(ADMIN_BARBERIA, ADMINISTRADOR)` | matriz (D35) | **sí** | no | sí — `core/services/antecedentes.service.ts:25` | `src/antecedente/application/antecedente.service.spec.ts` |
| 30 | GET | `/barberias/:barberiaId/horarios` | HorarioController | `@Autenticado` | `@Roles(BARBERO, ADMIN_BARBERIA, ADMINISTRADOR)` | **8** | **sí** | no | sí — `core/services/horarios.service.ts:49` | `test/permisos-matriz.e2e-spec.ts` |
| 31 | POST | `/barberias/:barberiaId/horarios` | HorarioController | `@Autenticado` | `@Roles(ADMIN_BARBERIA, ADMINISTRADOR)` | matriz | **sí** — `validateAccess` | no | sí — `core/services/horarios.service.ts:53` | `test/permisos-matriz.e2e-spec.ts` |
| 32 | GET | `/barberias/:barberiaId/horarios/mi-horario` | HorarioController | `@Autenticado` | `@Roles(BARBERO)` | matriz | **sí** | **sí** — `barberoId` resuelto del token, nunca del cuerpo | sí — `core/services/horarios.service.ts:57` | `test/permisos-matriz.e2e-spec.ts` |
| 33 | POST | `/barberias/:barberiaId/horarios/mi-horario` | HorarioController | `@Autenticado` | `@Roles(BARBERO)` | matriz | **sí** | **sí** — mismo caso | sí — `core/services/horarios.service.ts:61` | `test/permisos-matriz.e2e-spec.ts` |
| 34 | GET | `/barberias/:barberiaId/horarios/excepciones` | HorarioController | `@Autenticado` | `@Roles(BARBERO, ADMIN_BARBERIA, ADMINISTRADOR)` | **8** | **sí** | no | sí — `core/services/horarios.service.ts:68` | `test/permisos-matriz.e2e-spec.ts` |
| 35 | POST | `/barberias/:barberiaId/horarios/excepciones` | HorarioController | `@Autenticado` | `@Roles(ADMIN_BARBERIA, ADMINISTRADOR)` | matriz | **sí** — `validateAccess` | no | sí — `core/services/horarios.service.ts:72` | `test/permisos-matriz.e2e-spec.ts` |
| 36 | POST | `/barberias/:barberiaId/horarios/barberos/:barberoId/excepciones` | HorarioController | `@Autenticado` | `@Roles(BARBERO, ADMIN_BARBERIA, ADMINISTRADOR)` | matriz | **sí** | **sí** — un barbero solo sobre su propio `barberoId` | sí — `core/services/horarios.service.ts:76` | `test/permisos-matriz.e2e-spec.ts` |
| 37 | GET | `/barberias/:barberiaId/pagos/auditoria` · `/cobros/auditoria` · `/pagos/auditoria` | PagoController | `@Autenticado` | `@Roles(ADMIN_BARBERIA, ADMINISTRADOR)` | matriz | **sí** — `validateAccess` | no | sí — `core/services/pagos.service.ts:38` (`obtenerHistorial`), desde `admin-tickets.component.ts:329` y `home.component.ts:465` | `src/pago/application/pago.service.spec.ts` |
| 38 | POST | `/barberias/:barberiaId/pagos/en-persona` · `/cobros` · `/pagos` | PagoController | `@Autenticado` | `@Roles(BARBERO, ADMIN_BARBERIA, ADMINISTRADOR)` | **9** | **sí** — `validateAccess` | **sí** — E3-09: el BARBERO solo cobra sus reservas (las sin asignar, solo un ADMIN) | sí — `core/services/reservas.service.ts:131` | `src/pago/application/pago.service.spec.ts`; `test/pago-barbero-asignado.e2e-spec.ts` |
| 39 | POST | `/barberias/:barberiaId/reservas` · `/reservas` | ReservaController | `@Autenticado` | `@Roles(CLIENTE)` | **10** — restricción cerrada en `758a70d` (E3-03) | **sí** | **sí** — cliente vinculado, no restringido | sí — `core/services/reservas.service.ts:60`, ahora **solo** desde `reserva-wizard` | `test/hallazgo14-idor-reserva.e2e-spec.ts`; `test/reserva-walkin-split.e2e-spec.ts` |
| 39b | POST | `/barberias/:barberiaId/reservas/walk-in` · `/reservas/walk-in` | ReservaController | — no existía | `@Roles(BARBERO, ADMIN_BARBERIA, ADMINISTRADOR)` | **10** — ruta nueva en `758a70d` (E3-03) | **sí** | **sí** — la misma comprobación de servicio que la fila 39 (restricción del actor); no hay recurso previo | sí — `core/services/reservas.service.ts:79`, desde `walk-in-modal` | `test/reserva-walkin-split.e2e-spec.ts`; `test/permisos-matriz.e2e-spec.ts` |
| 40 | GET | `/barberias/:barberiaId/reservas/:id` · `/reservas/:id` | ReservaController | `@Roles(ADMIN_BARBERIA, BARBERO, CLIENTE)` | `@Roles(ADMIN_BARBERIA, BARBERO, CLIENTE)` | — | **sí** | **sí** — un `CLIENTE` solo ve la suya | no | `test/hallazgo14-idor-reserva.e2e-spec.ts`; `src/reserva/application/reserva.service.spec.ts` |
| ~~41~~ | ~~PATCH~~ | ~~`/barberias/:barberiaId/reservas/:id/estado` · `/reservas/:id/estado`~~ | ReservaController | — | — | — | — | — | **ELIMINADA en E2-02 (2026-10-11)** — era un «pon el estado que quieras»: el grafo de §5.2 sin comprobar. Ver H46 | — |
| 42 | POST | `/barberias/:barberiaId/reservas/:id/inasistencia` · `/reservas/:id/inasistencia` | ReservaController | `@Roles(ADMIN_BARBERIA, BARBERO, ADMINISTRADOR)` | `@Roles(ADMIN_BARBERIA, ADMINISTRADOR)` | matriz (D02) | **sí** | no | no | `test/permisos-matriz.e2e-spec.ts` |
| 43 | GET | `/barberias/:barberiaId/reservas/agenda` · `/reservas/agenda` | ReservaController | `@Roles(ADMIN_BARBERIA, BARBERO, ADMINISTRADOR)` | `@Roles(ADMIN_BARBERIA, BARBERO, ADMINISTRADOR)` | matriz (D16) | **sí** | **sí** — el barbero solo la suya | sí — `core/services/reservas.service.ts:94` | `test/hallazgo16-rolesguard-global.e2e-spec.ts` |
| 44 | GET | `/barberias/:barberiaId/reservas/mis-reservas` · `/reservas/mis-reservas` | ReservaController | `@Autenticado` | `@Roles(CLIENTE)` | matriz | no | **sí** — `clienteId` del token | sí — `core/services/reservas.service.ts:77`, y los enlaces «Mis Citas» solo se muestran a CLIENTE | `test/permisos-matriz.e2e-spec.ts` |
| 44b | POST | `/barberias/:barberiaId/reservas/:id/aceptar` · `/reservas/:id/aceptar` | ReservaController | — no existía | `@Roles(ADMIN_BARBERIA, ADMINISTRADOR)` | **E3-04** (decisión 12) | **sí** | **sí** — revalida el hueco bajo `FOR UPDATE` y rechaza con 409 si `expira_at` ya pasó | no | `test/e3-04-aceptar-rechazar.e2e-spec.ts`; `src/reserva/application/reserva.service.spec.ts` |
| 44c | POST | `/barberias/:barberiaId/reservas/:id/rechazar` · `/reservas/:id/rechazar` | ReservaController | — no existía | `@Roles(ADMIN_BARBERIA, ADMINISTRADOR)` | **E3-04** (decisión 12) | **sí** | **sí** — `motivo_codigo` obligatorio del catálogo §5.5 | no | `test/e3-04-aceptar-rechazar.e2e-spec.ts`; `src/reserva/application/reserva.service.spec.ts` |
| 44d | POST | `/barberias/:barberiaId/reservas/cotizar` · `/reservas/cotizar` | ReservaController | — no existía | `@Roles(CLIENTE, BARBERO, ADMIN_BARBERIA, ADMINISTRADOR)` | **E3-03/D44** (decisión 13) | **sí** | no — cálculo puro, no persiste ni consulta el recurso | sí — `core/services/reservas.service.ts`, wizard del cliente y walk-in | `test/e3-03-validaciones.e2e-spec.ts` (control D44); `test/permisos-matriz.spec.ts` |
| 44e | POST | `/barberias/:barberiaId/reservas/:id/cancelar` · `/reservas/:id/cancelar` | ReservaController | — no existía | `@Roles(CLIENTE, ADMIN_BARBERIA, ADMINISTRADOR)` | **E3-05** (decisión 14) | **sí** | **sí** — un `CLIENTE` solo cancela la suya (403 `RESERVA_AJENA`); el guard no puede ver la reserva | no — pendiente del botón de cancelación del cliente (E3-07) | `test/e3-05-expiracion-cancelacion.e2e-spec.ts`; `test/e3-06-07-reprogramacion-reglas.e2e-spec.ts`; `src/reserva/application/reserva.service.spec.ts` |
| 44f | PATCH | `/barberias/:barberiaId/reservas/:id/reprogramar` · `/reservas/:id/reprogramar` | ReservaController | — no existía | `@Roles(ADMIN_BARBERIA, ADMINISTRADOR)` | **E3-06** (decisión 15) | **sí** | **sí** — valida el bloque nuevo con `excluirReservaId`, así que la reserva no se bloquea a sí misma | no — pendiente del botón de reprogramación de la agenda | `test/e3-06-07-reprogramacion-reglas.e2e-spec.ts`; `src/reserva/application/reserva.service.spec.ts` |
| 45 | GET | `/catalogo/servicios` · `/servicios` | ServiciosController | `@Roles(ADMIN_BARBERIA, BARBERO, CLIENTE)` | `@Roles(ADMIN_BARBERIA, BARBERO, CLIENTE, ADMINISTRADOR)` + `VinculoBarberiaGuard` | **decisión del dueño** — el CLIENTE requiere fila ACTIVA en `cliente_barberias` | **sí** | **sí** — desde `81db5dc` | sí — `core/services/servicios.service.ts:32` | `src/catalogo/application/servicios.service.spec.ts`; `src/iam/infrastructure/vinculo-barberia.guard.spec.ts` |
| 46 | POST | `/catalogo/servicios` · `/servicios` | ServiciosController | `@Roles(ADMIN_BARBERIA, BARBERO)` | `@Roles(BARBERO)` + `SoloBarberoGuard` | **D16 corregido** — el catálogo lo escribe el BARBERO | **sí** | no | sí — `core/services/servicios.service.ts:58` | `test/permisos-matriz.e2e-spec.ts` |
| 47 | GET | `/catalogo/servicios/:id` · `/servicios/:id` | ServiciosController | `@Roles(ADMIN_BARBERIA, BARBERO, CLIENTE)` | `@Roles(ADMIN_BARBERIA, BARBERO, CLIENTE, ADMINISTRADOR)` + `VinculoBarberiaGuard` | **decisión del dueño** — el CLIENTE requiere fila ACTIVA | **sí** | **sí** — desde `81db5dc` | no | `test/permisos-matriz.e2e-spec.ts`; `src/iam/infrastructure/vinculo-barberia.guard.spec.ts` |
| 48 | PATCH | `/catalogo/servicios/:id` · `/servicios/:id` | ServiciosController | `@Roles(ADMIN_BARBERIA, BARBERO)` | `@Roles(BARBERO)` + `SoloBarberoGuard` | **D16 corregido** — el catálogo lo escribe el BARBERO | **sí** | no | sí — `core/services/servicios.service.ts:76` | `test/permisos-matriz.e2e-spec.ts` |
| 49 | PATCH | `/catalogo/servicios/:id/desactivar` · `/servicios/:id/desactivar` (y `.../reactivar`) | ServiciosController | — (era `DELETE /catalogo/servicios/:id`) | `@Roles(BARBERO)` + `SoloBarberoGuard` | **D16 corregido** — el catálogo lo escribe el BARBERO | **sí** | **sí** — E2-07: 422 `SERVICIO_EN_USO` con reservas `PENDIENTE`/`PROPUESTA_PENDIENTE` y 422 `SERVICIO_EN_COMBO_ACTIVO` con la lista de combos; idempotente | sí — `core/services/servicios.service.ts` (`desactivarServicio`, `reactivarServicio`) y el toggle de `features/admin/admin-servicios.component.ts` (P-SD-1) | `src/catalogo/application/servicios.service.spec.ts`; `test/e2-07-vocabulario.e2e-spec.ts` |
| 50 | GET | `/catalogo/combos` | CombosController | `@Roles(ADMIN_BARBERIA, BARBERO, CLIENTE)` | `@Roles(ADMIN_BARBERIA, BARBERO, CLIENTE, ADMINISTRADOR)` + `VinculoBarberiaGuard` | **decisión del dueño** — el CLIENTE requiere fila ACTIVA | **sí** | **sí** — desde `81db5dc` | **no** | `test/permisos-matriz.e2e-spec.ts`; `src/iam/infrastructure/vinculo-barberia.guard.spec.ts` |
| 51 | POST | `/catalogo/combos` | CombosController | `@Roles(ADMIN_BARBERIA, BARBERO)` | `@Roles(BARBERO)` + `SoloBarberoGuard` | **D16 corregido** — el catálogo lo escribe el BARBERO | **sí** | no | **no** | `test/permisos-matriz.e2e-spec.ts` |
| 52 | GET | `/catalogo/combos/:id` | CombosController | `@Roles(ADMIN_BARBERIA, BARBERO, CLIENTE)` | `@Roles(ADMIN_BARBERIA, BARBERO, CLIENTE, ADMINISTRADOR)` + `VinculoBarberiaGuard` | **decisión del dueño** — el CLIENTE requiere fila ACTIVA | **sí** | **sí** — desde `81db5dc` | **no** | `test/permisos-matriz.e2e-spec.ts`; `src/iam/infrastructure/vinculo-barberia.guard.spec.ts` |
| 53 | PATCH | `/catalogo/combos/:id` | CombosController | `@Roles(ADMIN_BARBERIA, BARBERO)` | `@Roles(BARBERO)` + `SoloBarberoGuard` | **D16 corregido** — el catálogo lo escribe el BARBERO | **sí** | no | **no** | `test/permisos-matriz.e2e-spec.ts` |
| 54 | PATCH | `/catalogo/combos/:id/desactivar` · `/catalogo/combos/:id/reactivar` | CombosController | — (era `DELETE /catalogo/combos/:id`) | `@Roles(BARBERO)` + `SoloBarberoGuard` | **D16 corregido** — el catálogo lo escribe el BARBERO | **sí** | **sí** — E2-07: idempotente; apagar el combo es la acción que desbloquea `SERVICIO_EN_COMBO_ACTIVO` | sí — `core/services/servicios.service.ts` (`desactivarCombo`, `reactivarCombo`) y el toggle de `features/admin/admin-servicios.component.ts` (P-SD-2) | `test/e2-07-vocabulario.e2e-spec.ts` |
| 55 | GET | `/barberias/:barberiaId/configuracion` | ConfiguracionBarberiaController | — no existía | `@Roles(ADMIN_BARBERIA, ADMINISTRADOR)` | **E3-11** | **sí** — el guard acota por `barberiaId` | no | no — pendiente del panel de configuración del frontend | `test/e3-11-configuracion.e2e-spec.ts`; `test/e3-11-configuracion.spec.ts` |
| 56 | PATCH | `/barberias/:barberiaId/configuracion` | ConfiguracionBarberiaController | — no existía | `@Roles(ADMIN_BARBERIA, ADMINISTRADOR)` | **E3-11** | **sí** | **sí** — 422 `HAY_PENDIENTES` (con conteo) y `max_personas_total >= max_ninos + 1` en el servicio | no | `test/e3-11-configuracion.e2e-spec.ts`; `test/e3-11-configuracion.spec.ts` |
| 57 | POST | `/barberias/:id/solicitudes-cambio` | BarberiaController | — no existía | `@Roles(ADMIN_BARBERIA)` | **E3-13** (D26) | **sí** — la ruta usa `:id`, así que el guard NO resuelve la sede del parámetro: la pertenencia real la exige el servicio (403 `SOLO_ADMIN_BARBERIA`) | **sí** — 409 `SOLICITUD_PENDIENTE`, 422 `RESPONSABLE_INEXISTENTE` / `SIN_CAMBIOS` | no — pendiente del panel de la sede | `test/e3-13-solicitudes-cambio.e2e-spec.ts`; `src/barberia/application/solicitud-cambio.service.spec.ts` |
| 58 | GET | `/plataforma/solicitudes-cambio` | PlataformaSolicitudesCambioController | — no existía | `@Roles(ADMINISTRADOR)` | **E3-13** (D26) | no (el guard ya acota) | no | no — pendiente del panel de plataforma | `test/e3-13-solicitudes-cambio.e2e-spec.ts`; `src/barberia/application/solicitud-cambio.service.spec.ts` |
| 59 | POST | `/plataforma/solicitudes-cambio/:id/resolver` | PlataformaSolicitudesCambioController | — no existía | `@Roles(ADMINISTRADOR)` | **E3-13** (D26) | no | **sí** — 409 `ESTADO_INVALIDO` y 422 `MOTIVO_REQUERIDO`; al aprobar un RESPONSABLE mueve `responsable_id`, el rol `ADMIN_BARBERIA` y audita en UNA transacción | no — pendiente del panel de plataforma | `test/e3-13-solicitudes-cambio.e2e-spec.ts`; `src/barberia/application/solicitud-cambio.service.spec.ts` |
| 60 | GET | `/barberias/:id/clientes-restringidos` | ClientesRestringidosController | — no existía | `@Roles(ADMIN_BARBERIA, ADMINISTRADOR)` | **E4-03** (D48) | **sí** — la ruta usa `:id`, así que el guard NO resuelve la sede del parámetro: la pertenencia la exige el servicio (403), igual que la fila 57 | no | no — pendiente del panel de la sede | `test/e4-03-fidelizacion.e2e-spec.ts`; `src/barberia/application/clientes-restringidos.service.spec.ts` |
| 61 | POST | `/barberias/:id/clientes/:clienteId/reactivar` | ClientesRestringidosController | — no existía | `@Roles(ADMIN_BARBERIA, ADMINISTRADOR)` | **E4-03** (D48) | **sí** — misma regla que la fila 60, más 404 si no hay vinculación | **sí** — 422 `SIN_RESTRICCION` si el cliente no estaba restringido; levanta la restricción, reinicia el contador de ESA sede y audita `RESTRICCION_LEVANTADA` con el valor anterior y el nuevo (D28) | no — pendiente del panel de la sede | `test/e4-03-fidelizacion.e2e-spec.ts`; `src/barberia/application/clientes-restringidos.service.spec.ts` |
| 62 | GET | `/barberias/:barberiaId/mi-estado` | MiEstadoController | — no existía | `@Roles(CLIENTE)` | **H54** (E4-03/2) | **sí** — la ruta usa `:barberiaId`, así que el guard SÍ acota la sede; el servicio vuelve a acotar por el usuario del token | **sí** — 403 `NO_VINCULADO` sin fila en `cliente_barberias` y `mensaje` calculado con la regla pura de §5.8 | **sí** — la tarjeta de estado de `features/barberias/barberias.component.ts` vía `core/services/mi-estado.service.ts` (E3-12/3) | `test/e4-03-fidelizacion.e2e-spec.ts` (H54); `src/barberia/application/mi-estado.service.spec.ts`; `src/reserva/domain/fidelizacion.spec.ts` |
| 63 | PATCH | `/plataforma/usuarios/:id/estado` | PlataformaUsuariosController | — no existía | `@Roles(ADMINISTRADOR)` | **E4-03/5** (D09/D24) | no (el guard ya acota: es una ruta de plataforma) | **sí** — 422 `MOTIVO_REQUERIDO`, 409 `ESTADO_INVALIDO`, 404 si la cuenta no existe; al suspender sube `token_version` (cierra TODAS las sesiones) y audita `CUENTA_SUSPENDIDA`/`CUENTA_REACTIVADA` con anterior y nuevo (D28) | no — pendiente del panel de plataforma | `test/e4-03-suspension-cuenta.e2e-spec.ts`; `src/iam/application/usuarios-plataforma.service.spec.ts`; `test/estado-cuenta-guard.spec.ts` |
| 64 | GET | `/health/liveness` · `api/v1/health/liveness` | HealthController | — no existía | `@Public` | **H64** | — | — | no | `test/h64-sondas-liveness.e2e-spec.ts`; `test/permisos-matriz.spec.ts` |

| 65 | GET | `/plataforma/vinculaciones/pendientes` | PlataformaVinculacionesController | — no existía | `@Roles(ADMINISTRADOR)` | **E3-12** (D10 · H67) | no (el guard ya acota: es una ruta de plataforma) | no | sí — `features/admin/vinculaciones/admin-vinculaciones.component.ts` (bandeja) + `core/services/vinculaciones.service.ts` (E3-12/2) | `test/e3-12-vinculacion.e2e-spec.ts`; `src/barberia/application/vinculacion.service.spec.ts` |
| 66 | POST | `/plataforma/vinculaciones/:id/aprobar` | PlataformaVinculacionesController | — no existía | `@Roles(ADMINISTRADOR)` | **E3-12** (D10 · H67) | no | **sí** — 404 si la vinculación no existe y 409 `ESTADO_INVALIDO` si ya se resolvió; deja el vínculo `ACTIVO` y audita `VINCULACION_APROBADA` con el valor anterior y el nuevo (D28) en UNA transacción | sí — el botón «Aprobar» de la bandeja | `test/e3-12-vinculacion.e2e-spec.ts`; `src/barberia/application/vinculacion.service.spec.ts` |
| 67 | POST | `/plataforma/vinculaciones/:id/rechazar` | PlataformaVinculacionesController | — no existía | `@Roles(ADMINISTRADOR)` | **E3-12** (D10 · H67) | no | **sí** — 422 `MOTIVO_REQUERIDO` sin motivo (o con una palabra suelta), 409 `ESTADO_INVALIDO`; deja `DESVINCULADO` con `es_barberia_activa = false` y audita `VINCULACION_RECHAZADA` con el motivo | sí — el botón «Rechazar» de la bandeja, con modal de motivo | `test/e3-12-vinculacion.e2e-spec.ts`; `src/barberia/application/vinculacion.service.spec.ts` |
| 68 | POST | `/barberias/:barberiaId/mi-estado/desvincular` | MiEstadoController | — no existía | `@Roles(CLIENTE)` | **E3-12/3** (D20/D21 · regla 1.9) | **sí** — misma ruta base que la 62: el `:barberiaId` deja que el guard acote la sede y el servicio vuelve a acotar por el usuario del token | **sí** — cierra la PROPIA fila (403 `NO_VINCULADO` sin vínculo, 409 `ESTADO_INVALIDO` si ya estaba cerrada) y 422 `RESERVAS_EN_CURSO` con el conteo si hay reservas `PENDIENTE`/`PROPUESTA_PENDIENTE`/`CONFIRMADA` de hoy en adelante; conserva contador y restricción (D20) y audita `CLIENTE_DESVINCULADO_VOLUNTARIAMENTE` con anterior y nuevo | **sí** — el botón «Desvincularme de esta Barbería» de la tarjeta, con modal de confirmación | `test/e3-12-desvinculacion.e2e-spec.ts`; `src/barberia/application/mi-estado.service.spec.ts`; `test/permisos-matriz.e2e-spec.ts` |
| 69 | GET | `/mi-estado/barberias` | MiEstadoBarberiasController | — no existía | `@Roles('CLIENTE')` | **H72** (hallazgo 5 · cierra la visibilidad de la fila 68) | no — la ruta NO lleva `:barberiaId`, así que el guard solo filtra el rol: el acotado por usuario del TOKEN lo exige el servicio | **sí** — los dos filtros van en la CONSULTA: `estado_vinculacion IN ('ACTIVO','PENDIENTE_APROBACION')` (D10) y `barberias.estado = 'ACTIVO'` (E2-07). Nunca devuelve los vínculos de otro, ni un historial `DESVINCULADO`, ni una sede suspendida; tampoco `codigoAcceso` ni `enlaceUnico` | **sí** — `core/services/tenant.service.ts` (`cargarBarberias`, que la consulta cuando el listado por responsabilidad viene vacío) y la tarjeta `features/barberias/components/sede-card/sede-card.component.ts`, pintada en «Tus Barberías» y en el home del cliente | `test/h72-listado-sedes-cliente.e2e-spec.ts`; `src/barberia/application/cliente-barberias.service.spec.ts`; `test/permisos-matriz.spec.ts` |
| 70 | GET | `/barberias/:id/invitacion` | BarberiaController | — no existía | `@Roles(ADMIN_BARBERIA, ADMINISTRADOR)` | **E3-12/2** (regla 1.10) | **sí** — la ruta usa `:id`, así que el guard NO resuelve la sede del parámetro: la pertenencia la exige `BarberiaService.obtenerInvitacion` (403) con la MISMA regla que entrega `codigoAcceso` en la fila 11 (`veCodigoDe`, E1-05/E1-07) | **sí** — devuelve SOLO `{ barberiaId, nombre, codigoAcceso, enlaceUnico }` (nunca el resto de datos de la sede) y 404 si la sede no existe | **sí** — el bloque «Invitación de la Sede» de `features/barberias/barberias.component.ts` (código, enlace y QR) vía `core/services/tenant.service.ts` (`obtenerInvitacion`) | `test/e3-12-enlace-qr.e2e-spec.ts` (7 casos de invitación); `src/barberia/application/barberia.service.spec.ts` (`obtenerInvitacion`); `test/permisos-matriz.spec.ts` |
| 71 | POST | `/mi-estado/unirse` | MiEstadoBarberiasController | — no existía | `@Roles('CLIENTE')` | **E3-12/2** (regla 1.10 · D10/D21) | no — la ruta NO lleva `:barberiaId` (la sede se nombra por código o por enlace en el CUERPO), así que el guard solo filtra el rol y el acotado por usuario lo hace el servicio con el usuario del token | **sí** — reutiliza `vincularCliente`: el vínculo nace `ACTIVO` o `PENDIENTE_APROBACION` según el conteo de D10, reabre la fila `DESVINCULADO` (D21 · H71) y audita `VINCULACION_REACTIVADA` cuando toca; 422 `INVITACION_REQUERIDA` sin puerta y `INVITACION_AMBIGUA` con las dos; 404 de sede inexistente o `INACTIVO` (E2-07); idempotente (200 con la MISMA fila) | **sí** — el campo «Unirme a una barbería» del home del cliente y la pantalla `features/barberias/unirse/unirse.component.ts` (destino del QR), vía `TenantService.unirsePorInvitacion`; el modal de vinculación usa la MISMA puerta | `test/e3-12-enlace-qr.e2e-spec.ts` (10 casos de unión); `src/barberia/application/barberia.service.spec.ts`; `src/app/core/utils/invitacion.util.spec.ts`; `test/permisos-matriz.spec.ts` |
| 72 | GET | `/barberias/:barberiaId/pagos/historial` · `/cobros/historial` · `/pagos/historial` | PagoController | — no existía | `@Roles(ADMIN_BARBERIA, ADMINISTRADOR)` | **matriz** (H68 · §7.3) | **sí** — `validateAccess` sobre la barbería del param o del header (400 si no hay y no es ADMINISTRADOR), igual que la auditoría de la fila 37 | **sí** — el `where` filtra por `reserva.barberiaId` en la CONSULTA y devuelve el recibo de cada cobro (cliente, servicios con precio histórico, quién lo registró y quién lo anuló); nunca un pago de otra sede | **sí** — `PagosService.obtenerHistorial` (`core/services/pagos.service.ts`), consumido por la tabla «Historial de Pagos» de `features/admin/tickets` y por las métricas del home | `src/pago/application/pago.service.spec.ts` (`listarHistorial`); `src/app/core/services/pagos.service.spec.ts`; `test/permisos-matriz.spec.ts` |
| 73 | POST | `/barberias/:barberiaId/pagos/:id/anular` · `/cobros/:id/anular` · `/pagos/:id/anular` | PagoController | — no existía | `@Roles(ADMIN_BARBERIA, ADMINISTRADOR)` | **matriz** (H68 · §7.3) | **sí** — la ruta usa `:id` (no `:barberiaId`), así que el guard NO resuelve la sede del parámetro: `PagoService.anularPago` la resuelve por el PAGO y exige `ADMIN` (403 `ANULACION_SOLO_ADMIN` si quien anula es un BARBERO de esa sede), y responde 404 si el `:barberiaId` del alias no es el del cobro | **sí** — solo anula un pago `PAGADA` (409 `ESTADO_INVALIDO` si ya está `ANULADO` o nunca se cobró), exige motivo (422 `MOTIVO_REQUERIDO`), no borra nada y deja `PAGO_ANULADO` en la auditoría dentro de la transacción del cambio | **sí** — el botón «Anular» con su modal de motivo en `features/admin/tickets/admin-tickets.component.ts`, vía `PagosService.anularPago` | `src/pago/application/pago.service.spec.ts` (`anularPago`); `src/app/core/services/pagos.service.spec.ts`; `test/permisos-matriz.spec.ts` |

> **Filas 65 a 67 (E3-12, 2026-10-15).** La 6.ª vinculación (D10) la resuelve la PLATAFORMA y no la
> sede, y el motivo es el conteo: `vincularCliente` cuenta las vinculaciones del USUARIO
> (`cliente_barberias` de esa persona), no las de una sede. La sede interesada en captar al cliente
> aprobaría siempre, así que el límite dejaría de existir; por eso las tres rutas son
> `@Roles(ADMINISTRADOR)` y el E2E comprueba que el `ADMIN_BARBERIA` de la sede recibe 403. Las filas se
> numeran al final (65 a 67) para no renumerar las anteriores ni romper las referencias del texto a
> «fila 57», «fila 62», etc.

> **Filas 20 y 65 a 67 · cierre de E3-12 y H71 (2026-10-15, E3-12/2).** La bandeja ya tiene pantalla
> (`/admin/vinculaciones`, `authGuard` + `roleGuard(['ADMINISTRADOR'])` y SIN `tenantGuard`: es una
> pantalla transversal de la plataforma, no de una sede) y cablea las tres rutas de arriba, así que
> ninguna queda sin interfaz. Además, `POST /barberias/vincular` deja de devolver la fila muerta (fila
> 20, H71): si el vínculo está `DESVINCULADO`, lo reabre (D21). Con eso el rechazo de la 6.ª vinculación
> deja de ser un callejón sin salida: el cliente reintroduce el código, la fila vuelve a la bandeja y la
> plataforma puede aprobarla.

> **Fila 68 · la salida del cliente (2026-10-15, E3-12/3).** La otra mitad de la regla 1.9: el cliente ya
> puede CERRAR su propio vínculo. La fila se numera al final (68) y **la ruta se desvía a propósito** de la
> que sugería el backlog (`POST /barberias/:id/desvincular`): vive bajo `mi-estado`, el mismo recurso que la
> fila 62, para que el `:barberiaId` del path deje que el `RolesGuard` acote la sede — con `:id` el guard no
> la resuelve y la pertenencia quedaría solo en el servicio. Además, cerrar un vínculo devuelve el CUPO de
> D10: el conteo de `vincularCliente` (fila 20) pasa a mirar los vínculos VIVOS, así que desvincularse no
> condena a la bandeja de aprobación para la siguiente sede. Queda abierta **una** mitad de E3-12: el
> enlace único y su QR (sin fila en esta matriz porque no existe como ruta). Y hay un límite de alcance
> conocido y anterior: **no existe ninguna ruta que liste las barberías de un `CLIENTE`** (hallazgo 5 de
> este mismo documento), así que la tarjeta del cliente solo aparece donde su lista de sedes trae algo — el
> botón ya está cableado y probado, pero su visibilidad depende de esa tarea pendiente.

> **Filas 70 y 71 · la puerta de entrada del cliente (2026-10-17, E3-12/2 · regla 1.10).** Cierran la última
> mitad de E3-12. La 70 es de la SEDE —su código de acceso y su `enlaceUnico`, el que codifica el QR— y la 71
> es del CLIENTE, que entra por cualquiera de las dos. La 71 NO reimplementa la vinculación: llama al mismo
> `vincularCliente` de la fila 20, así que D10, la reapertura de D21 (H71) y su auditoría son las de siempre y
> no hay dos sitios donde se decida qué estado le toca a un vínculo. Es hermana de la fila 68 —vive bajo
> `mi-estado`, el espacio del vínculo propio— y por eso es del CLIENTE. El QR lo compone y lo dibuja el
> NAVEGADOR (`core/utils/invitacion.util.ts`): el backend no conoce el dominio del frontend, y lo que se
> codifica es una puerta de entrada, así que no se manda a ningún servicio externo para dibujarla.

> **Filas 72 y 73 · el recibo de cobros y su corrección (2026-10-18, H68).** §7.3 pedía que un pago pudiera
> corregirse después con rastro, y la tabla de «Historial de Pagos» no tenía de dónde sacarlo: leía la
> auditoría —un rastro inmutable y paginado por evento—, que no devuelve el estado del pago ni el id de su
> fila. La fila 72 sirve el recibo desde la tabla `pagos` (estado VIVO, incluido `ANULADO`) y la 73 lo
> corrige sin borrar nada, con motivo obligatorio. La anulación es de la SEDE: el barbero cobra lo suyo
> (fila 38) y no deshace un ingreso. Las dos se numeran al final, como manda el encabezado, para no
> renumerar las 71 filas anteriores.

> **Fila 69 · el cliente ya tiene su lista de sedes (2026-10-16, H72).** Cierra el **hallazgo 5** de este
> documento, que E3-12/3 dejó a la vista: `GET /barberias` responde por responsabilidad (`responsableId`,
> fila 12) y a un cliente puro le devuelve `[]`, así que ni «Tus Barberías» ni el botón de salir de la fila
> 68 tenían lista donde pintarse. La ruta NO cuelga de `/barberias` a propósito —esa base ya significa
> «donde YO SOY responsable»— y vive bajo `mi-estado`, el espacio de lo que el usuario ve de sí mismo.
> `TenantService.cargarBarberias()` pregunta primero por responsabilidad y, si viene vacío, por vínculo: el
> selector de sede vuelve a funcionar para el CLIENTE sin que el frontend tenga que adivinar el rol del
> token (que en el primer render, antes de que `/auth/me` responda, todavía no conoce).

> **Fila 64 (H64, 2026-10-14).** Sonda de VIDA separada de la de preparación: `check()` sigue en
> `/health` · `/api/v1/health` mirando base de datos, Redis y memoria, y la vida responde sin tocar nada
> externo. `render.yaml` apunta `healthCheckPath` a esta ruta. La fila se numera al final y no junto a la 7
> (que es la otra ruta de `HealthController`) para no renumerar las 56 filas siguientes ni romper las
> referencias del texto a «fila 57», «fila 62», etc.

## Recuento aplicado

Conteo de `test/route-security.spec.ts` antes y después de E1-05. El total aplicado pasa a **55** con
E3-03 (`758a70d`), que añade `POST /reservas/walk-in`:

| Política | Antes (main `05a0961`) | Aplicado (`fix/matriz-permisos`) |
|---|---|---|
| `@Public` | 6 | 6 |
| `@Autenticado` | 28 | 5 |
| `@Roles(...)` | 20 | 44 |
| ninguna | 0 | 0 |
| **Total** | **54** | **55** |

Las 5 rutas que siguen en `@Autenticado` son las que devuelven datos del propio solicitante o no son de
negocio: `GET /`, `GET /auth/me`, `POST /barberias`, `GET /barberias` y `GET /notificaciones/mis-notificaciones`.

**Estado real tras H68 (2026-10-18):** `test/route-security.spec.ts` cuenta **85 rutas**
(`@Public` 7 · `@Autenticado` 5 · `@Roles` 73 · ninguna 0) y `test/permisos-matriz.spec.ts` comprueba
**85 rutas × 4 roles = 340** decisiones. Sobre las 83 de E3-12/2: `+2` por el historial de cobros y la
anulación de un pago (H68, filas 72 y 73).

**Estado real tras E3-04 (2026-10-09):** `test/route-security.spec.ts` cuenta **58 rutas**
(`@Public` 6 · `@Autenticado` 5 · `@Roles` 47 · ninguna 0). Sobre las 55 del cuadro de arriba: `+1` por
`POST /reservas/cotizar` (D44) y `+2` por `POST /reservas/:id/aceptar` y `POST /reservas/:id/rechazar` (E3-04).
`test/permisos-matriz.spec.ts` comprueba ahora **58 rutas × 4 roles = 232** decisiones.

**Estado real tras E3-05 (2026-10-09):** `test/route-security.spec.ts` cuenta **59 rutas**
(`@Public` 6 · `@Autenticado` 5 · `@Roles` 48 · ninguna 0). Sobre las 58 de E3-04, `+1` por
`POST /reservas/:id/cancelar` (E3-05, fila 44e). `test/permisos-matriz.spec.ts` comprueba ahora
**59 rutas × 4 roles = 236** decisiones.

**Estado real tras E3-06/E3-07 (2026-10-09):** `test/route-security.spec.ts` cuenta **60 rutas**
(`@Public` 6 · `@Autenticado` 5 · `@Roles` 49 · ninguna 0). Sobre las 59 de E3-05, `+1` por
`PATCH /reservas/:id/reprogramar` (E3-06, fila 44f). `test/permisos-matriz.spec.ts` comprueba ahora
**60 rutas × 4 roles = 240** decisiones. **E3-07 no añade rutas:** cambia el COMPORTAMIENTO de la 44e
(la ventana de 30 minutos del CLIENTE), que es una regla de negocio del servicio, no una decisión de
permisos nueva.

**Estado real tras E3-08 (2026-10-10):** eran **64 rutas** (`@Public` 6 · `@Autenticado` 5 · `@Roles` 53)
= **64 × 4 = 256** decisiones.

**Estado real tras E2-02 (2026-10-11):** **63 rutas × 4 roles = 252** decisiones. Es la PRIMERA vez que
la matriz encoge: `PATCH /reservas/:id/estado` (fila 41) se eliminó porque escribía `reservas.estado`
directo, sin comprobar el grafo de §5.2 y saltándose las condiciones de cada flujo —un ADMIN podía pasar
una reserva a `COMPLETADA` sin registrar el pago, o cancelarla sin motivo—. El único punto de escritura
de estado es ahora `ReservaService.cambiarEstado`, privado y con `ReservaStateMachine` delante. El botón
«No Asistió» del frontend, que era su único llamador, apunta a `POST /reservas/:id/inasistencia` (fila 42)
y solo aparece en `CONFIRMADA`, que es el único origen que §5.2 admite para el no presentado. Evidencia:
`test/permisos-matriz.spec.ts` (63 rutas, 252 decisiones) y `test/permisos-matriz.e2e-spec.ts`
(`40 rutas × 4 roles` sobre HTTP).

**Estado real tras E3-11 (2026-10-11):** `test/permisos-matriz.spec.ts` cuenta **65 rutas × 4 roles = 260**
decisiones. Sobre las 63 de E2-02, `+2` por `GET` y `PATCH /barberias/:barberiaId/configuracion` (E3-11,
filas 55 y 56): la política de ambas es `@Roles(ADMIN_BARBERIA, ADMINISTRADOR)` y el `RolesGuard` las
acota al `barberiaId` del parámetro, así que el admin de otra sede recibe 403. Evidencia:
`test/e3-11-configuracion.e2e-spec.ts` (12 casos) y `test/e3-11-configuracion.spec.ts` (17 casos).

**Estado real tras E3-13 (2026-10-11):** `test/permisos-matriz.spec.ts` cuenta **68 rutas × 4 roles = 272**
decisiones. Sobre las 65 de E3-11, `+3` por las solicitudes de cambio (E3-13, filas 57 a 59): la de la sede
es `@Roles(ADMIN_BARBERIA)` —y por eso el 403 de pertenencia vive en el servicio, no en el guard: con `:id`
el guard no resuelve la sede del parámetro— y las dos de plataforma son `@Roles(ADMINISTRADOR)`. Además,
la fila 16 cambia de reglas: `PATCH /barberias/:id` deja de admitir `nombre` (422
`NOMBRE_REQUIERE_SOLICITUD`) y `estado` (422 `ESTADO_NO_EDITABLE`), y el teléfono exige la contraseña
actual (D27). Evidencia: `test/e3-13-solicitudes-cambio.e2e-spec.ts` (20 casos) y
`src/barberia/application/solicitud-cambio.service.spec.ts` (12 casos).

**Estado real tras E4-03 (2026-10-12):** `test/permisos-matriz.spec.ts` cuenta **71 rutas × 4 roles = 284**
decisiones. Sobre las 69 de E4-02, `+2` por la bandeja local de restringidos (filas 60 y 61): ambas declaran
`@Roles(ADMIN_BARBERIA, ADMINISTRADOR)` y usan `:id`, así que el acotado por sede es de servicio. D48: la
penalización por inasistencias es LOCAL — ninguno de los dos endpoints puede suspender la cuenta global
(`usuarios.estado_cuenta`), y el bloqueo de la creación de reservas (403 `CLIENTE_RESTRINGIDO`) lo aplica
`ReservaService.crearReserva` para individuales y grupales. Evidencia: `test/e4-03-fidelizacion.e2e-spec.ts`,
`src/barberia/application/clientes-restringidos.service.spec.ts`, `src/reserva/domain/fidelizacion.spec.ts`,
el describe E4-03 de `src/reserva/application/reserva.service.spec.ts` y los dos casos nuevos de
`test/permisos-matriz.e2e-spec.ts`.

**Estado real tras la Ola 2 del sprint de estabilización (2026-10-12):** `test/permisos-matriz.spec.ts` cuenta
**73 rutas × 4 roles = 292** decisiones. Sobre las 71 de E4-03, `+2`: el `mi-estado` del cliente (fila 62, H54)
y la suspensión de cuenta de la plataforma (fila 63, E4-03/5). Las dos cierran brechas de negocio que los
reportes declaraban «documentadas pero ausentes», y las dos acotan por sí mismas lo que el guard no ve: 62 por
el usuario del token y 63 por el rol global. Evidencia: `test/e4-03-fidelizacion.e2e-spec.ts` (H54),
`test/e4-03-suspension-cuenta.e2e-spec.ts` (ciclo completo de suspensión y reactivación),
`src/barberia/application/mi-estado.service.spec.ts`, `src/iam/application/usuarios-plataforma.service.spec.ts`
y `test/estado-cuenta-guard.spec.ts` (D48 sobre el código fuente: los únicos escritores de
`usuarios.estado_cuenta` son el alta y esta ruta manual).

**Estado real tras la Ola 3 y H64 (2026-10-14):** `test/route-security.spec.ts` cuenta **76 rutas**
(`@Public` 7 · `@Autenticado` 5 · `@Roles` 64 · ninguna 0) y `test/permisos-matriz.spec.ts` comprueba
**76 rutas × 4 roles = 304** decisiones. La Ola 3 había dejado el total en **75** (el párrafo anterior se
quedó en 73: retiró cuatro `@Delete` y añadió los seis verbos del vocabulario del diseño) y H64 sumó `+1`
con la sonda de vida (fila 64), que es la única ruta nueva de las tres iteraciones de la Fase 2. Evidencia:
la tabla que imprime `test/route-security.spec.ts` y la matriz rol × ruta de `test/permisos-matriz.spec.ts`.

**Estado real tras E3-12/2 (2026-10-17):** `test/route-security.spec.ts` cuenta **83 rutas**
(`@Public` 7 · `@Autenticado` 5 · `@Roles` 71 · ninguna 0) y `test/permisos-matriz.spec.ts` comprueba
**83 rutas × 4 roles = 332** decisiones. Sobre las 81 de H72, `+2`: la invitación de la sede (fila 70) y la
entrada del cliente (fila 71), que cierran la regla 1.10 y con ella el punto 2 de E3-12. La 70 usa `:id` y la
71 no lleva sede en la ruta, así que en las dos el acotado real es de servicio —pertenencia en la 70, usuario
del token en la 71—, y las dos se declaran aquí para que el guard no sea la única política que exista.
Evidencia: `test/e3-12-enlace-qr.e2e-spec.ts` (17 casos), la fila de 1.10 de `docs/MATRIZ_CUMPLIMIENTO.md` y
las dos suites unitarias del frontend (`invitacion.util.spec.ts` y `tenant.service.spec.ts`).

**Estado real tras E3-12 (2026-10-15):** `test/route-security.spec.ts` cuenta **79 rutas**
(`@Public` 7 · `@Autenticado` 5 · `@Roles` 67 · ninguna 0) y `test/permisos-matriz.spec.ts` comprueba
**79 rutas × 4 roles = 316** decisiones. Sobre las 76 de H64, `+3` por la bandeja de aprobación de la 6.ª
vinculación (filas 65 a 67): las tres declaran `@Roles(ADMINISTRADOR)` porque el límite de D10 se cuenta
por USUARIO y no por sede, así que la sede es parte interesada y no puede decidir. Cierra H67: el estado
`PENDIENTE_APROBACION` ya tiene flujo que lo resuelve. Evidencia: `test/e3-12-vinculacion.e2e-spec.ts`
(19 casos, con el ciclo pendiente → aprobado → el cliente ya opera, y el rechazo con motivo) y
`src/barberia/application/vinculacion.service.spec.ts` (11 casos) más
`src/barberia/domain/vinculacion.spec.ts` (5 casos).

## Decisiones tomadas

Las once decisiones que dejó abiertas el inventario, y cómo quedaron:

**1. `POST /barberias` — sigue `@Autenticado`.** El límite de 2 barberías por usuario es E1-07 y no se
implementa aquí; queda anotado como `TODO(E1-07)`. La pantalla `/barberias/nueva` sigue tras
`roleGuard(['ADMIN'])`, de modo que un CLIENTE ve la API abierta y la pantalla cerrada: es exactamente lo
que se pidió.

**2. `PATCH /barberias/:id/seleccionar` — `@Roles(CLIENTE, BARBERO, ADMIN_BARBERIA, ADMINISTRADOR)`**
(decisión 2, enmendada por el dueño). **Arreglado en E1-06** (`d93e9af`). Antes
`seleccionarBarberiaActiva` exigía una fila en `cliente_barberias` con `estado_vinculacion = 'ACTIVO'`,
de modo que el decorador era más generoso que el servicio: un barbero, un responsable o el administrador
global pasaban el guard y recibían 404 «No estás vinculado a esta barbería». La decisión original era
solo `CLIENTE`; se ampliaron los roles de administración porque `tenant.service.ts:137` encadena esta
llamada al final de «crear barbería» (pantalla tras `roleGuard(['ADMIN'])`), y después al barbero, que es
quien más la necesita según el flujo del frontend.

Ahora el servicio admite los tres vínculos reales, en este orden: `cliente_barberias` con
`estado_vinculacion = 'ACTIVO'` (el cliente que entró por código, que es el único caso que mueve la marca
`esBarberiaActiva`), `usuario_roles.barberia_id` (barbero y ADMIN_BARBERIA) y `barberia.responsable_id`
(el dueño). El ADMINISTRADOR global no necesita vínculo: es transversal. Quien no tenga ninguno de los
tres sigue recibiendo 404, y quien tenga el vínculo de cliente en `PENDIENTE` sigue recibiendo 403.

**3. `GET /barberias/:id` — `@Autenticado` con DTO de lectura.** Sigue abierta a cualquier autenticado
porque sus datos (nombre, descripción, teléfono, ubicación) no son secretos de negocio, pero
`BarberiaLecturaDto` oculta `codigoAcceso` y `enlaceUnico` a todo el que no sea el ADMIN_BARBERIA de esa
barbería o el ADMINISTRADOR global. Ninguna pantalla la consume hoy.

**4. `PATCH /barberias/:id/estado` — `@Roles(ADMINISTRADOR)`.** Desactivar una sede es una decisión de
plataforma. El responsable ya no puede cerrar su propio negocio. **E2-07 (2026-10-13):** la ruta dejó de
ser `DELETE` y pasó a ser un cambio de estado explícito que también sabe REACTIVAR; antes, volver a
activar una sede exigía tocar la base a mano.

**5. `POST /barberias/vincular` — `@Roles(CLIENTE)`.** El método crea un vínculo `cliente_barberias`:
trata al solicitante como cliente de esa barbería. Como el botón «Vincular con Código» de la pantalla
`/barberias` se mostraba sin condición de rol, ahora solo se pinta si el usuario es CLIENTE; el botón
«Crear Barbería», que estaba justo al lado y sí estaba condicionado, no cambia.

**6. `GET` y `POST /agenda/disponibilidad` — los cuatro roles.** Consultar disponibilidad es lectura de
agenda y la usan el wizard de reservas y la pantalla de agenda. **Arreglado en E1-06** (`d93e9af`).

El hueco era real y no era un `TODO` decorativo: el guard y el decorador validan el ROL, pero el rol no es
la pertenencia. `CLIENTE` es de ámbito GLOBAL con `barberia_id` nulo, y `alcanceCumple` trata ese nulo como
comodín, así que un cliente autenticado que enviara `x-barberia-id` de otra sede pasaba el guard y leía los
horarios, las excepciones y los bloqueos de una barbería ajena. Ahora ambos verbos llaman a
`calcularDisponibilidadDeSolicitante`, que exige pertenencia real vía `perteneceABarberia` y devuelve 403
con «No perteneces a esta barbería» cuando no la hay. El ADMINISTRADOR global se acepta aparte por ser
transversal (D05).

El POST tenía además un segundo defecto: leía `params.barberiaId` con `ParseUUIDPipe`, así que en el alias
`/agenda/disponibilidad` —que es el que usa `reservas.service.ts:38`— el parámetro no existía y la ruta
respondía 400 por un id vacío. Ahora la sede sale de `@CurrentBarberiaId`, la misma cadena que usa el guard.

**7. Antecedentes.** `POST /antecedentes` pasa a `@Roles(BARBERO, ADMIN_BARBERIA, ADMINISTRADOR)`: propone
un antecedente sobre otro usuario, que es tarea del personal. `GET /antecedentes/cliente/:clienteId` pasa a
`@Roles(ADMIN_BARBERIA, ADMINISTRADOR)`. La declaración propia del cliente (D43) no se implementa: necesita
su propia ruta y un campo que distinga el origen del antecedente, porque el flujo actual siempre nace en
`PENDIENTE`.

**8. `GET /horarios` y `GET /horarios/excepciones` — `@Roles(BARBERO, ADMIN_BARBERIA, ADMINISTRADOR)`.**
Sin CLIENTE: las únicas pantallas que las llaman son `/admin/horarios` (`roleGuard(['ADMIN'])`) y el catálogo,
que no lee horarios.

**9. `POST /cobros` (y alias `/pagos`) — `@Roles(BARBERO, ADMIN_BARBERIA, ADMINISTRADOR)`.** Es el botón
«Cobrar» del modal de cobro, en una pantalla cuyo `roleGuard` sigue admitiendo BARBERO. La condición de
«reservas asignadas» que la sección 4 exige al barbero se implementa en E3-09: el guard no cambia (solo
ve el rol), la comprobación vive en `PagoService.registrarPagoEnPersona`, que con el perfil que devuelve
`validateAccess` exige a un BARBERO que `reserva.barberoId` sea el suyo y rechaza con 403 las reservas sin
asignar; el ADMIN_BARBERIA y el ADMINISTRADOR conservan su bypass.

**10. `POST /reservas` solo CLIENTE, y el walk-in pasa a `POST /reservas/walk-in` —
`@Roles(BARBERO, ADMIN_BARBERIA, ADMINISTRADOR)` (E3-03, cerrado en `758a70d`).** La sección 4 pedía
solo CLIENTE, pero el mismo alias lo usaban DOS pantallas: el wizard del cliente
(`reserva-wizard.component.ts:341`, manda `barberoId: null`) y el modal de walk-in de la pantalla de
agenda (`walk-in-modal.component.ts:147`, exige `barberoId`). Restringirla a CLIENTE dejaba sin walk-in a
la pantalla que más lo usa, así que la política declarada eran los cuatro roles y la restricción quedaba
como `TODO(E3-03)`. Ahora cada pantalla tiene ruta propia: el alias vuelve a ser exclusivo del cliente y
el walk-in —que solo ocurre en la sede y siempre con barbero— se sirve en `/reservas/walk-in`, llamada
por `walk-in-modal.component.ts` vía `ReservasService.crearReservaWalkIn`. Cubierto por
`test/reserva-walkin-split.e2e-spec.ts` (5 casos, rojo→verde) y por las filas 39 y 39b de esta matriz.

**11. `PATCH /reservas/:id/estado` — `@Roles(ADMIN_BARBERIA, ADMINISTRADOR)`.** El barbero deja de cambiar
el estado de una reserva. El botón «No Asistió» de `/admin/agenda` lo llama a esta ruta y el componente no
tenía condición de rol, así que ahora se oculta cuando el usuario es BARBERO: puede seguir cobrando y
registrando walk-ins, pero no le ofrezca una acción que el backend le va a denegar.

**12. `POST /reservas/:id/aceptar` y `POST /reservas/:id/rechazar` — `@Roles(ADMIN_BARBERIA, ADMINISTRADOR)`.**
Aceptar o rechazar una solicitud es una decisión de la SEDE, igual que marcar el no presentado (D02, fila 42)
y que cambiar el estado (decisión 11, fila 41): el BARBERO queda fuera. La ruta se acota al `barberiaId` del
parámetro, así que un admin de otra sede recibe 403 antes de llegar al servicio. E3-04 no toca el
`PATCH /reservas/:id/estado` genérico: sigue existiendo tal cual.

**13. `POST /reservas/cotizar` (D44) — `@Roles(CLIENTE, BARBERO, ADMIN_BARBERIA, ADMINISTRADOR)`.**
La cotización no persiste nada: es el cálculo puro que el frontend usa para nunca calcular bloques ni
precios. Restringirla al staff como el walk-in dejaba al CLIENTE sin poder cotizar antes de crear su propia
reserva, y el wizard del cliente comparte este blanco. El `RolesGuard` la acota al `barberiaId` del
parámetro. Cubierto por el control D44 de `test/e3-03-validaciones.e2e-spec.ts` (usa un token de CLIENTE y
espera 201) y por la fila 44d de la matriz de permisos.

**14. `POST /reservas/:id/cancelar` (E3-05) — `@Roles(CLIENTE, ADMIN_BARBERIA, ADMINISTRADOR)`.**
Cancelar la declaran los tres roles porque son dos flujos distintos sobre el mismo recurso: el CLIENTE
cancela SU reserva y la sede cancela por teléfono o mostrador. El `RolesGuard` no puede distinguirlos
—solo mira el rol y el `barberiaId` del parámetro, y el `CLIENTE` es de ámbito GLOBAL—, así que la
pertenencia la resuelve el servicio: sin rol de sede en esa barbería, la reserva tiene que ser suya o
responde 403 `RESERVA_AJENA` (mismo criterio que la fila 40 para el detalle). La ventana de 30 minutos
del §5.7 es E3-07 y NO se implementa aquí.

**15. `PATCH /reservas/:id/reprogramar` (E3-06) — `@Roles(ADMIN_BARBERIA, ADMINISTRADOR)`.**
Mover una cita es una decisión de la SEDE, igual que aceptar (12), rechazar (12) o marcar el no
presentado (D02): el decorador declara solo esos dos roles y el `RolesGuard` acota la ruta al `barberiaId`
del parámetro, así que un admin de otra sede recibe 403. El CLIENTE **no** reprograma por su cuenta: su
vía para cambiar de horario es la propuesta con ventana de 10 minutos del §5.4 (E3-06 del backlog), que
necesita la tabla `propuestas_horario` y sus tres rutas propias y **sigue pendiente** (ver H35).

**16. E3-07 no añade ninguna ruta.** La barrera de los 30 minutos del CLIENTE vive dentro del servicio de
la fila 44e (`cancelarReserva`), porque depende del ESTADO de la reserva y de la hora de la cita —dos
cosas que el `RolesGuard` no consulta—. La política de la 44e no cambia: sigue declarando los tres roles.

**17. `POST /reservas/:id/cancelacion-especial` (E3-08) — `@Roles(ADMIN_BARBERIA, ADMINISTRADOR)`.**
Cancelar fuera de la ventana de los 30 minutos es una decisión de la SEDE con motivo obligatorio del
catálogo §5.5, así que declara los mismos dos roles que aceptar, rechazar o reprogramar (filas 12 y 15);
el `RolesGuard` la acota al `barberiaId` del parámetro. La pertenencia no llega al servicio porque el guard
ya la resolvió: un admin de otra sede recibe 403 antes de entrar. La bandera D17
(`configuracion_barberia.permite_cancelacion_especial`, por defecto FALSE) NO la ve el guard —necesita
consultar la configuración—, así que el servicio responde 422 `CANCELACION_ESPECIAL_NO_HABILITADA` cuando
la sede no la tiene activada. Cubierto por el E2E de E3-08 (rojo→verde) y por el describe E3-08 del spec
unitario.

**18. `POST /reservas/:id/proponer-horario` (E3-08 / §5.4) — `@Roles(CLIENTE)`.**
Es la vía del CLIENTE dueño para pedir un bloque nuevo sin ocupar agenda. El `RolesGuard` deja pasar
también al `ADMINISTRADOR` por jerarquía, pero la pertenencia la resuelve el servicio: solo el `clienteId`
de la reserva puede proponer, y cualquier otro (incluido un admin que no sea el dueño) recibe 403
`RESERVA_AJENA`, el mismo criterio de las filas 14 y 40. Proponer no mueve la cita ni cambia su estado:
deja una fila `PENDIENTE` en `propuestas_horario` con 10 minutos de ventana.

**19. `POST /reservas/:id/propuesta-horario/aceptar|rechazar` (E3-08 / §5.4) — `@Roles(ADMIN_BARBERIA, ADMINISTRADOR)`.**
Resolver la propuesta vuelve a ser de la SEDE, con los mismos dos roles que la reprogramación directa.
Aceptar revalida el hueco bajo el lock de la sede y solo entonces mueve la cita; rechazar no la toca. La
propuesta PENDIENTE **no** reserva el hueco (a diferencia de D37), así que la revalidación puede devolver
409 `CONFLICTO_HORARIO`.

### Ajustes sobre las decisiones, decididos con el dueño

- **Decisión 2 ampliada dos veces**: `/seleccionar` admite además a `ADMIN_BARBERIA` y `ADMINISTRADOR`
  (para no romper el flujo de crear y cambiar de sede) y después también a `BARBERO`.
- **Decisión 10 ampliada**: `/reservas` incluye también al `ADMINISTRADOR`, que entra en `/admin/agenda` y
  usa el walk-in. Tras E3-03 (`758a70d`) esa ampliación se materializa en la fila 39b: el walk-in se
  declara con los tres roles de la sede **más** `ADMINISTRADOR`, y en el alias de cliente el
  `ADMINISTRADOR` sigue pasando por la jerarquía del guard (E1-04), no por el decorador.
- **Consecuencia del guard**: `RolesGuard` concede el acceso al `ADMINISTRADOR` antes de mirar la lista, así
  que en la fila 20 el administrador global también pasa, aunque la política solo declare `CLIENTE`.

## Hallazgos de la traza del flujo de sede

Salen de seguir el flujo de un `BARBERO` después de iniciar sesión. **No se arreglan aquí**: son lógica de
negocio y cada uno necesita su propia tarea.

1. **`GET /barberias` solo devuelve las sedes donde el usuario es `responsableId`.** Es lo que hace
   `findAllByResponsable` (`barberia.service.ts`). Para un `BARBERO` y para un `CLIENTE` la respuesta es
   `[]`, aunque tengan barberías por `usuario_roles` o por `cliente_barberias`. Consecuencia: tras el login,
   `auth.service.ts:110-119` manda al barbero a `/barberias` porque la lista viene vacía, y ahí no hay
   tarjetas que seleccionar: su sede activa solo sobrevive desde la caché de `localStorage`
   (`tenant.service.ts:145-154`). En un dispositivo nuevo, el barbero queda sin forma de fijar su sede.
2. ~~**La sede activa del frontend no pasa por `/seleccionar`.**~~ **Arreglado en `feat/sincronizar-sede-activa-backend`**
   (2026-10-17). El texto original del hallazgo: `tenant.service.ts:59-82` la elige localmente entre las que
   devuelve `GET /barberias` (caché → `esBarberiaActiva` → la primera) y la guarda en `localStorage`;
   `/seleccionar` solo se invoca desde el botón «Seleccionar» de una tarjeta (`barberias.component.ts:166`) y
   desde el encadenado de `crearBarberia` (`tenant.service.ts:137`). El interceptor manda ese id en
   `x-barberia-id` (`auth.interceptor.ts:16-18`), que es lo que leen `@CurrentBarberiaId` y `RolesGuard`.
   Ahora `TenantService` tiene UNA sola puerta para que una sede pase a ser activa —`pedirSeleccion`, el
   propio `PATCH /barberias/:id/seleccionar`— y `sincronizarSedeActiva` la usa en su rama de cambio de manos:
   la sede que ya era activa y SIGUE en la lista solo refresca su objeto cacheado (no hubo cambio de manos:
   la eligió el usuario y el backend la registró cuando la fijó), y toda sede que PASA a ser activa —la
   sustituta de una purgada por H74, la que el backend marcó `esBarberiaActiva` o la primera de un
   dispositivo nuevo— pide el cambio al backend y no se fija en señal ni `localStorage` hasta el 200. Un 403
   (vínculo `PENDIENTE_APROBACION`), un 404 (sin vínculo) o una caída de red no fijan nada: el mensaje
   queda en `error()`, que la pantalla de barberías muestra en su banner. El botón «Seleccionar» y el
   encadenado de `crearBarberia` ya pasaban por la misma ruta; ahora no queda ningún camino que fije sede
   sin preguntar. Cubierto por `frontend-barberias/src/app/core/services/tenant.service.spec.ts` (13 casos,
   5 de ellos del contrato nuevo, rojo→verde: con el servicio viejo, `Tests 5 failed | 38 passed (43)`).
3. ~~**`@CurrentBarberiaId` cae en `params.id`.**~~ **Arreglado en E1-06** (`c5e5111`, rama
   `fix/e1-06-currentbarberiaid-params-id`; cerrado en su totalidad por `d93e9af`). El decorador tenía cuatro
   fuentes y la cuarta era `params.id`,
   que en las rutas con `:id` es el id del recurso: en `GET /catalogo/servicios/:id` y
   `GET /catalogo/combos/:id` —cuyos controladores no llevan `:barberiaId` en el path— el servicio recibía el
   id del recurso como sede y buscaba `{ id, barberiaId }` con los dos iguales. `RolesGuard` usaba la misma
   cadena **sin** ese fallback, así que el guard verificaba una sede y el servicio consultaba otra.
   Alcance real: **9 rutas**, no 2 —las 6 del catálogo y las 3 de reservas cuando se llaman por su alias
   `/reservas/...`. Ahora hay un único `resolverBarberiaId` con tres fuentes (`params.barberiaId`,
   `x-barberia-id`, `?barberiaId=`) y, si no hay ninguna, la ruta responde **400** en vez de inventarse un
   tenant. Cubierto por `current-barberia.decorator.spec.ts` (12 tests) y
   `test/e1-06-sede-del-tenant.e2e-spec.ts` (27, sin ejecutar).
   **Fuga que salió de paso:** `GET /catalogo/servicios` sin sede devolvía 200 con los servicios de **todas**
   las barberías, porque `ServiciosService.findAll` solo filtra cuando recibe la sede
   (`servicios.service.ts:34-43`).

   **Corrección de alcance (2026-10-05, `e538566`, rama `test/cross-tenant-admin`):** la ruta empezó a
   responder 400 en cuanto el decorador pasó a ser obligatorio, pero eso cerró el **síntoma**, no la causa:
   el servicio conservaba la rama `if (barberiaId)` que se comía el filtro, así que cualquier llamador
   interno —o un futuro refactor que dejara de usar el decorador— volvía a listar el catálogo entero. Lo
   mismo en `CombosService.findAll`, donde `where: { barberiaId }` era literal y un `undefined` hacía que
   Prisma descartara el campo en vez de filtrar por él. Los dos servicios exigen ahora sede y el `where`
   lleva siempre `barberiaId`. Añadido en el mismo commit: **validación de formato UUID** en el decorador.
   Antes `x-barberia-id: no-es-uuid` viajaba intacto hasta la columna `uuid` y era Prisma quien respondía
   400, después de abrir conexión; ahora el 400 sale del decorador y la variante opcional devuelve `null`.
   Cubierto por `current-barberia.decorator.spec.ts` (12), `servicios.service.spec.ts` y
   `combos.service.spec.ts` (nuevo).

   **El catálogo exige vínculo (decisión del dueño, `81db5dc`, rama `fix/catalogo-requiere-vinculo`).** Las cuatro
   lecturas del catálogo —`GET /catalogo/servicios`, `GET /catalogo/servicios/:id`, `GET /catalogo/combos`
   y `GET /catalogo/combos/:id`— siguen admitting a los cuatro roles por rol, pero ahora pasan además
   por `VinculoBarberiaGuard`. Motivo: el rol `CLIENTE` es GLOBAL con `barberia_id` nulo, así que
   `alcanceCumple` lo trata como comodín y un cliente autenticado leía el catálogo **de cualquier sede**
   con solo mandar `x-barberia-id`: no era una fuga de datos de una sede a otra, era un directorio de
   precios de todas las sedes a la que llegaba cualquiera con una cuenta. El hallazgo salió en el paso 5 de
   E1-06 y quedó fijado como desviación conocida en `test/e1-06-cross-tenant-admin.e2e-spec.ts`, que
   esperaba el 200; ahí se invierte la expectativa a 403.

   La regla, tal como queda:
   - `ADMIN_BARBERIA` y `BARBERO`: el vínculo ya está en `usuario_roles.barberia_id`, no cambia nada.
   - `CLIENTE`: necesita fila en `cliente_barberias` con `estado_vinculacion = 'ACTIVO'`. Un vínculo
     suspendido no habilita.
   - `ADMINISTRADOR` global: **bypass intacto**, es transversal por diseño (D05).

   El guard resuelve la sede con la misma cadena que `@CurrentBarberiaId` (`params` > cabecera > query, con
   validación de UUID), para que la comprobación y la consulta miren siempre la misma sede. Si no hay sede,
   no decide y deja que la ruta conteste 400, que es el mensaje que corresponde. Las escrituras del
   catálogo (`POST`, `PATCH`, `DELETE`) no lo llevan: `RolesGuard` ya las acota al `ADMIN_BARBERIA` de esa
   sede, así que el vínculo está implícito.

   Cubierto por `vinculo-barberia.guard.spec.ts` (11, nuevo) y por los casos del e2e: sin vínculo 403 en
   servicios y combos, con vínculo ACTIVO 200 y con el catálogo acotado a su sede, y con vínculo suspendido
   403. La mutación de quitar el filtro `ACTIVO` deja el e2e en rojo, que es lo que demuestra que el caso
   suspendido no es decorativo.

   **Complemento de `d93e9af`:** quitar el fallback arregló que la sede fuera correcta, pero no que el
   solicitante *perteneciera* a ella. El rol `CLIENTE` es GLOBAL con `barberia_id` nulo, de modo que
   `alcanceCumple` lo admitía contra cualquier sede: la fuga estaba un peldaño más abajo, en el guard, y
   afectaba a rutas cuyo decorador ya era correcto. Ese segundo peldaño es el que cerraba `/agenda/disponibilidad`
   y `/seleccionar`, y es la razón por la que este hallazgo no se dio por cerrado con `c5e5111` solo.
4. ~~**La regla del código de acceso solo está escrita en `findOne`.**~~ **Arreglado en E1-07**
   (`6bc243f`, rama `fix/e1-07-veCodigo-findallbyresponsable`). `GET /barberias` mapeaba con `toResponse` —
   con `codigoAcceso` y `enlaceUnico`— filtrando solo por `responsableId` y sin mirar el rol, mientras que
   `GET /barberias/:id` sí comprobaba `veCodigo`. No era explotable (quien es `responsableId` de una sede es
   su ADMIN_BARBERIA y la lista nunca trae barberías ajenas), pero eran dos reglas distintas para el mismo
   dato: bastaba una fila `usuario_roles` ausente —la corrupción que ya hubo en E1-04— para que el
   responsable recibiera por una ruta lo que por la otra no. Ahora las dos lecturas pasan por el mismo
   helper `veCodigoDe`, aplicado sede a sede dentro de la lista. Cubierto por
   `barberia.service.spec.ts` → `findAllByResponsable · E1-07`.
5. ~~**No existe ninguna ruta que liste las barberías de un `CLIENTE`.**~~ **Arreglado en H72**
   (2026-10-16, rama `feat/h72-listado-sedes-cliente`; **fila 69** de esta matriz). `cliente_barberias` solo
   se leía con `findUnique` por `(usuarioId, barberiaId)` —en `vincularCliente`, `seleccionarBarberiaActiva`
   y `reserva.service.ts:42,316`—, nunca con `findMany`, y la única lista del backend era `GET /barberias`,
   que filtra por `responsableId` y devuelve `[]` a un cliente (hallazgo 1). `GET /mi-estado/barberias`
   (`@Roles('CLIENTE')`, `ClienteBarberiasService`) devuelve las sedes del vínculo propio con sus dos
   filtros en la consulta —estados vivos de D10 y sede `ACTIVO` de E2-07— y la pantalla del cliente dejó de
   depender de la caché de `localStorage` para saber dónde está.

## Qué queda pendiente de esta tarea

| Tarea | Qué falta | Dónde está anotado |
|---|---|---|
| E1-06 | ~~Comprobar el vínculo del solicitante al calcular disponibilidad~~ — cerrado en `d93e9af` | `agenda.controller.ts`, ambos verbos |
| E1-06 | ~~Resolver el vínculo de la sede seleccionada~~ — cerrado en `d93e9af` | `barberia.controller.ts`, `PATCH /barberias/:id/seleccionar` |
| E1-07 | Límite de 2 barberías por usuario al crear | `barberia.controller.ts`, `POST /barberias` |
| E3-03 | ~~Reservar la creación de reservas al CLIENTE y crear la ruta de walk-in~~ — cerrado en `758a70d` | `reserva.controller.ts`, `POST /reservas` y `POST /reservas/walk-in` |
| E3-03 | **El resto de E3-03 sigue abierto** (no es alcance de la partición de rutas): orden de validaciones `NO_VINCULADO`/`CLIENTE_RESTRINGIDO`/pausa/horizonte/`max_pendientes`, 422 `GRUPAL_NO_DISPONIBLE`, `FOR UPDATE` bajo SERIALIZABLE y `POST /reservas/cotizar` (D44) | `BACKLOG_BARBERIAS_V1.md` → E3-03; `reserva.service.ts` |
| E3-09 | ~~Un BARBERO solo cobra las reservas que tiene asignadas~~ — cerrado en `4b62cf7` | `pago.controller.ts`, `POST /cobros` |
| D43 | Declaración propia del cliente con su ruta y su campo de origen | `antecedente.controller.ts`, `POST /antecedentes` |
| E3-04 | ~~Aceptar y rechazar solicitudes~~ — cerrado en la rama `feat/e3-04-aceptar-rechazar`: rutas, `motivo_codigo`/`motivo_detalle` con CHECK, cancelación del job de expiración y auditoría | `reserva.controller.ts`, `reserva.service.ts`, migración `20261009000000_e304_motivos_reserva` |
| E3-04 | **No implementado:** «borrar la información adicional» al cerrar la reserva (§5) — no existe ninguna columna de información adicional en `reservas` | `BACKLOG_BARBERIAS_V1.md` → §7; `schema.prisma` |

### E1-06 · estado de verificación de la parte 3

- **Unitarios:** `roles.vinculo.spec.ts` (5) y `disponibilidad.service.spec.ts` (5) son nuevos;
  `barberia.service.spec.ts` pasa de 32 a 40. Suite completa del backend: **27 ficheros / 223 tests**
  (`npm test`, `EXIT=0`).
- **Unitarios de la corrección `e538566` (2026-10-05):** `combos.service.spec.ts` es nuevo y el spec del
  decorador se reescribe sobre una app Nest real con `supertest`. Suite completa: **28 ficheros / 242 tests**
  (`npm test`, `EXIT_TEST=0`); `nest build` `EXIT_BUILD=0`; `oxlint` `EXIT_LINT=0` con 48 warnings.
  Rojo previo al fix: `Test Files 3 failed (3)` · `Tests 14 failed | 19 passed (33)` · `EXIT_TEST=1`.
- **Mutación:** `perteneceABarberia` forzada a `true` deja **4 rojos**; el criterio de vínculo de
  `seleccionarBarberiaActiva` forzado a `true` deja **5 rojos**. Ambas revertidas.
- **Build y lint:** `nest build` en 0, `oxlint` en 0 con 49 warnings preexistentes.
- **e2e: NO EJECUTADO.** Los 8 casos nuevos de `test/e1-06-sede-del-tenant.e2e-spec.ts` (27 en total)
  están escritos y el fichero compila, pero en esta máquina no hay Postgres ni Redis
  (`ECONNREFUSED 127.0.0.1:5432` y `:6379`) y Docker Desktop no está instalado, así que `beforeAll`
  aborta y los tests quedan sin ejecutar. Necesitan una corrida con la base de pruebas levantada antes
  de darse por verificados.
- **La CI tampoco los ejecuta, y eso es un hallazgo de proceso aparte.** `.github/workflows/ci.yml` monta
  `postgres:15` y `redis:7` y aplica las migraciones, pero **ningún paso invoca los `*.e2e-spec.ts`**: el
  único paso de pruebas del backend es `npm run test` (`ci.yml:93`), que carga `vitest.config.ts` con
  `include: ['**/*.spec.ts']`, glob que no casa con los ficheros terminados en `-spec.ts`. Revisadas las 19
  versiones históricas de `ci.yml`: ninguna ha tenido un paso de e2e. Los «223 tests» que acompañaron a
  E1-01..E1-07 eran solo unitarios. Estado real: **11 ficheros e2e / 67 tests escritos y nunca ejecutados.**
  La rama `ci/run-e2e-tests` añade ese paso (incluido `APP_ENV=dev`, obligatorio porque `test/setup.e2e.ts`
  aborta sin él).

### Deuda que dejó E1-06 (sin arreglar, con nombre)

Ninguna de estas cuatro es un fallo de E1-06: son huecos de cobertura y una limitación de navegación
que aparecieron al revisar el contrato de sede antes de fusionar.

| # | Deuda | Dónde se nota |
|---|---|---|
| a | **El frontend no tiene ni un test de estos flujos.** Solo existen `app.spec.ts` y `core/guards/role.guard.spec.ts` (9 tests): nadie comprueba que `tenantGuard` bloquee una ruta sin sede ni que `auth.interceptor` ponga `x-barberia-id`. El e2e de E1-06 comprueba el backend, no la app | `frontend-barberias/src/app/core/guards/tenant.guard.ts`, `auth/auth.interceptor.ts` |
| b | **`/reservas/:id` por alias, con un recurso real.** La matriz de permisos usa `randomUUID()`, así que prueba el guard y no el filtrado por tenant. Lo mismo para `/reservas/:id/estado` y `/reservas/:id/inasistencia`, que además **no tienen ningún llamador** en el frontend | `reserva.controller.ts`, `PATCH/GET/POST /reservas/:id*` |
| c | **`POST /servicios` con carga real.** La matriz manda `cuerpo: {}`, que falla en el `ValidationPipe` antes de llegar a la lógica de sede: el camino de escritura con tenant sigue sin ejercitarse de punta a punta | `servicios.controller.ts`, `POST /servicios` |
| d | **El ADMINISTRADOR global no puede entrar a las rutas con `tenantGuard`.** `GET /barberias` le devuelve `[]` porque filtra por `responsableId`, así que `tenantGuard` lo manda a `/barberias` y le bloquea `/catalogo`, `/admin/agenda`, `/admin/servicios` y `/admin/tickets`. Es H17 y es **preexistente**, no lo causa E1-06 | `core/guards/tenant.guard.ts`, `core/services/tenant.service.ts` |