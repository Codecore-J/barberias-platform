# MATRIZ_RUTAS.md · Permisos por ruta (E1-05)

> **Estado: aplicada.** Este documento nació como inventario de solo lectura en `main` y
> ahora refleja la política que hay en `fix/matriz-permisos`, rama de E1-05.
> La tabla de rutas es la que produce `test/route-security.spec.ts` (`=== TABLA DE RUTAS (54) ===`)
> y la que verifica `test/permisos-matriz.spec.ts` (54 rutas × 4 roles = 216 decisiones).

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
   figuran entre las 54 porque no existen en el servidor. Además declaran `@Roles('BARBERO', 'ADMIN')`, un
   alias que el backend nunca entendió.
4. **E1-05 no cambia lógica de negocio.** Solo sustituye decoradores, con la excepción del DTO de lectura
   de `GET /barberias/:id` (decisión 3). Lo que exigía lógica nueva queda anotado como `TODO` con su
   tarea: E1-06 (vinculación en disponibilidad), E1-07 (límite de 2 barberías), E3-03 (walk-in) y
   E3-09 (cobro de reservas asignadas).

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
| 12 | GET | `/barberias` | BarberiaController | `@Autenticado` | `@Autenticado` | — | no (filtra por `responsableId`) | no | sí — `core/services/tenant.service.ts:64` | `test/barberia.e2e-spec.ts` |
| 13 | POST | `/barberias` | BarberiaController | `@Autenticado` | `@Autenticado` | **1** | no | no | sí — `core/services/tenant.service.ts:133` | `src/barberia/application/barberia.service.spec.ts` |
| 14 | PATCH | `/barberias/:id/seleccionar` | BarberiaController | `@Autenticado` | `@Roles(CLIENTE, BARBERO, ADMIN_BARBERIA, ADMINISTRADOR)` | **2** | **sí** — vínculo en `cliente_barberias` (E1-06) | **sí** — `estado_vinculacion = 'ACTIVO'` | sí — `core/services/tenant.service.ts:94` y `:137` | `src/barberia/application/barberia.service.spec.ts`; `test/barberia.e2e-spec.ts` |
| 15 | GET | `/barberias/:id` | BarberiaController | `@Autenticado` | `@Autenticado` + DTO de lectura | **3** | no | no | **no** | `src/barberia/application/barberia.service.spec.ts` |
| 16 | PATCH | `/barberias/:id` | BarberiaController | `@Autenticado` | `@Roles(ADMIN_BARBERIA, ADMINISTRADOR)` | matriz | **sí** | **sí** — responsable, salvo ADMINISTRADOR | **no** | `test/hallazgo16-rolesguard-global.e2e-spec.ts` |
| 17 | DELETE | `/barberias/:id` | BarberiaController | `@Autenticado` | `@Roles(ADMINISTRADOR)` | **4** | no (el guard ya acota) | no | no | `test/permisos-matriz.e2e-spec.ts` |
| 18 | GET | `/barberias/all` | BarberiaController | `@Roles(ADMINISTRADOR)` | `@Roles(ADMINISTRADOR)` | E1-04 | no | no | no | ninguno |
| 19 | GET | `/barberias/:id/personal` | BarberiaController | `@Roles(ADMIN_BARBERIA, BARBERO)` | `@Roles(ADMIN_BARBERIA, BARBERO)` | E1-03 | **sí** | no | sí — `core/services/personal.service.ts:22` | `test/h19-h20-lecturas-abiertas.e2e-spec.ts`; `src/barberia/application/barberia.service.spec.ts` |
| 20 | POST | `/barberias/vincular` | BarberiaController | `@Autenticado` | `@Roles(CLIENTE)` | **5** | no | no | sí — `core/services/tenant.service.ts:115`; el botón ya solo se muestra a CLIENTE | `test/barberia.e2e-spec.ts` |
| 21 | GET | `/barberias/:barberiaId/agenda/bloqueos` · `/agenda/bloqueos` | AgendaController | `@Roles(ADMIN_BARBERIA, BARBERO)` | `@Roles(ADMIN_BARBERIA, BARBERO)` | E1-03 | **sí** — `validateAccess` | no | sí — `core/services/horarios.service.ts:83` | `test/h19-h20-lecturas-abiertas.e2e-spec.ts`; `src/agenda/application/agenda.service.spec.ts` |
| 22 | POST | `/barberias/:barberiaId/agenda/bloqueos` · `/agenda/bloqueos` | AgendaController | `@Autenticado` | `@Roles(ADMIN_BARBERIA, ADMINISTRADOR)` | matriz | **sí** — `validateAccess` | no | sí — `core/services/horarios.service.ts:87` | `src/agenda/application/agenda.service.spec.ts` |
| 23 | DELETE | `/barberias/:barberiaId/agenda/bloqueos/:id` · `/agenda/bloqueos/:id` | AgendaController | `@Autenticado` | `@Roles(ADMIN_BARBERIA, ADMINISTRADOR)` | matriz | **sí** — `validateAccess` | **sí** — el bloqueo debe ser de esa barbería | sí — `core/services/horarios.service.ts:91` | `src/agenda/application/agenda.service.spec.ts` |
| 24 | GET | `/barberias/:barberiaId/agenda/disponibilidad` · `/agenda/disponibilidad` | AgendaController | `@Autenticado` | `@Roles(CLIENTE, BARBERO, ADMIN_BARBERIA, ADMINISTRADOR)` | **6** | pendiente — E1-06 | no | sí — `core/services/reservas.service.ts:38`, que llama al alias `/agenda/disponibilidad` | `test/permisos-matriz.e2e-spec.ts` |
| 25 | POST | `/barberias/:barberiaId/agenda/disponibilidad` · `/agenda/disponibilidad` | AgendaController | `@Autenticado` | `@Roles(CLIENTE, BARBERO, ADMIN_BARBERIA, ADMINISTRADOR)` | **6** | pendiente — E1-06 | no | no | `test/permisos-matriz.e2e-spec.ts` |
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
| 38 | POST | `/barberias/:barberiaId/pagos/en-persona` · `/cobros` · `/pagos` | PagoController | `@Autenticado` | `@Roles(BARBERO, ADMIN_BARBERIA, ADMINISTRADOR)` | **9** | **sí** — `validateAccess` | pendiente — E3-09, solo reservas asignadas | sí — `core/services/reservas.service.ts:131` | `src/pago/application/pago.service.spec.ts` |
| 39 | POST | `/barberias/:barberiaId/reservas` · `/reservas` | ReservaController | `@Autenticado` | `@Roles(CLIENTE, BARBERO, ADMIN_BARBERIA, ADMINISTRADOR)` | **10** | **sí** | **sí** — cliente vinculado, no restringido | sí — `core/services/reservas.service.ts:60`, que llama al alias `/reservas`, desde `reserva-wizard` y `walk-in-modal` | `test/hallazgo14-idor-reserva.e2e-spec.ts` |
| 40 | GET | `/barberias/:barberiaId/reservas/:id` · `/reservas/:id` | ReservaController | `@Roles(ADMIN_BARBERIA, BARBERO, CLIENTE)` | `@Roles(ADMIN_BARBERIA, BARBERO, CLIENTE)` | — | **sí** | **sí** — un `CLIENTE` solo ve la suya | no | `test/hallazgo14-idor-reserva.e2e-spec.ts`; `src/reserva/application/reserva.service.spec.ts` |
| 41 | PATCH | `/barberias/:barberiaId/reservas/:id/estado` · `/reservas/:id/estado` | ReservaController | `@Roles(ADMIN_BARBERIA, BARBERO, ADMINISTRADOR)` | `@Roles(ADMIN_BARBERIA, ADMINISTRADOR)` | **11** | **sí** | no | sí — `core/services/reservas.service.ts:111`; el botón «No Asistió» ya se oculta al BARBERO | `src/reserva/application/reserva.service.spec.ts` |
| 42 | POST | `/barberias/:barberiaId/reservas/:id/inasistencia` · `/reservas/:id/inasistencia` | ReservaController | `@Roles(ADMIN_BARBERIA, BARBERO, ADMINISTRADOR)` | `@Roles(ADMIN_BARBERIA, ADMINISTRADOR)` | matriz (D02) | **sí** | no | no | `test/permisos-matriz.e2e-spec.ts` |
| 43 | GET | `/barberias/:barberiaId/reservas/agenda` · `/reservas/agenda` | ReservaController | `@Roles(ADMIN_BARBERIA, BARBERO, ADMINISTRADOR)` | `@Roles(ADMIN_BARBERIA, BARBERO, ADMINISTRADOR)` | matriz (D16) | **sí** | **sí** — el barbero solo la suya | sí — `core/services/reservas.service.ts:94` | `test/hallazgo16-rolesguard-global.e2e-spec.ts` |
| 44 | GET | `/barberias/:barberiaId/reservas/mis-reservas` · `/reservas/mis-reservas` | ReservaController | `@Autenticado` | `@Roles(CLIENTE)` | matriz | no | **sí** — `clienteId` del token | sí — `core/services/reservas.service.ts:77`, y los enlaces «Mis Citas» solo se muestran a CLIENTE | `test/permisos-matriz.e2e-spec.ts` |
| 45 | GET | `/catalogo/servicios` · `/servicios` | ServiciosController | `@Roles(ADMIN_BARBERIA, BARBERO, CLIENTE)` | `@Roles(ADMIN_BARBERIA, BARBERO, CLIENTE, ADMINISTRADOR)` | matriz | **sí** | no | sí — `core/services/servicios.service.ts:32` | `src/catalogo/application/servicios.service.spec.ts` |
| 46 | POST | `/catalogo/servicios` · `/servicios` | ServiciosController | `@Roles(ADMIN_BARBERIA, BARBERO)` | `@Roles(ADMIN_BARBERIA, ADMINISTRADOR)` | matriz (D16) | **sí** | no | sí — `core/services/servicios.service.ts:58` | `test/permisos-matriz.e2e-spec.ts` |
| 47 | GET | `/catalogo/servicios/:id` · `/servicios/:id` | ServiciosController | `@Roles(ADMIN_BARBERIA, BARBERO, CLIENTE)` | `@Roles(ADMIN_BARBERIA, BARBERO, CLIENTE, ADMINISTRADOR)` | matriz | **sí** | no | no | `test/permisos-matriz.e2e-spec.ts` |
| 48 | PATCH | `/catalogo/servicios/:id` · `/servicios/:id` | ServiciosController | `@Roles(ADMIN_BARBERIA, BARBERO)` | `@Roles(ADMIN_BARBERIA, ADMINISTRADOR)` | matriz (D16) | **sí** | no | sí — `core/services/servicios.service.ts:76` | `test/permisos-matriz.e2e-spec.ts` |
| 49 | DELETE | `/catalogo/servicios/:id` · `/servicios/:id` | ServiciosController | `@Roles(ADMIN_BARBERIA, BARBERO)` | `@Roles(ADMIN_BARBERIA, ADMINISTRADOR)` | matriz (D16) | **sí** | no | sí — `core/services/servicios.service.ts:90` | `test/permisos-matriz.e2e-spec.ts` |
| 50 | GET | `/catalogo/combos` | CombosController | `@Roles(ADMIN_BARBERIA, BARBERO, CLIENTE)` | `@Roles(ADMIN_BARBERIA, BARBERO, CLIENTE, ADMINISTRADOR)` | matriz | **sí** | no | **no** | `test/permisos-matriz.e2e-spec.ts` |
| 51 | POST | `/catalogo/combos` | CombosController | `@Roles(ADMIN_BARBERIA, BARBERO)` | `@Roles(ADMIN_BARBERIA, ADMINISTRADOR)` | matriz (D16) | **sí** | no | **no** | `test/permisos-matriz.e2e-spec.ts` |
| 52 | GET | `/catalogo/combos/:id` | CombosController | `@Roles(ADMIN_BARBERIA, BARBERO, CLIENTE)` | `@Roles(ADMIN_BARBERIA, BARBERO, CLIENTE, ADMINISTRADOR)` | matriz | **sí** | no | **no** | `test/permisos-matriz.e2e-spec.ts` |
| 53 | PATCH | `/catalogo/combos/:id` | CombosController | `@Roles(ADMIN_BARBERIA, BARBERO)` | `@Roles(ADMIN_BARBERIA, ADMINISTRADOR)` | matriz (D16) | **sí** | no | **no** | `test/permisos-matriz.e2e-spec.ts` |
| 54 | DELETE | `/catalogo/combos/:id` | CombosController | `@Roles(ADMIN_BARBERIA, BARBERO)` | `@Roles(ADMIN_BARBERIA, ADMINISTRADOR)` | matriz (D16) | **sí** | no | **no** | `test/permisos-matriz.e2e-spec.ts` |

## Recuento aplicado

Conteo de `test/route-security.spec.ts` antes y después de E1-05:

| Política | Antes (main `05a0961`) | Aplicado (`fix/matriz-permisos`) |
|---|---|---|
| `@Public` | 6 | 6 |
| `@Autenticado` | 28 | 5 |
| `@Roles(...)` | 20 | 43 |
| ninguna | 0 | 0 |
| **Total** | **54** | **54** |

Las 5 rutas que siguen en `@Autenticado` son las que devuelven datos del propio solicitante o no son de
negocio: `GET /`, `GET /auth/me`, `POST /barberias`, `GET /barberias` y `GET /notificaciones/mis-notificaciones`.

## Decisiones tomadas

Las once decisiones que dejó abiertas el inventario, y cómo quedaron:

**1. `POST /barberias` — sigue `@Autenticado`.** El límite de 2 barberías por usuario es E1-07 y no se
implementa aquí; queda anotado como `TODO(E1-07)`. La pantalla `/barberias/nueva` sigue tras
`roleGuard(['ADMIN'])`, de modo que un CLIENTE ve la API abierta y la pantalla cerrada: es exactamente lo
que se pidió.

**2. `PATCH /barberias/:id/seleccionar` — `@Roles(CLIENTE, BARBERO, ADMIN_BARBERIA, ADMINISTRADOR)`**
(decisión 2, enmendada por el dueño). `seleccionarBarberiaActiva` exige una fila en `cliente_barberias`
con `estado_vinculacion = 'ACTIVO'`, de modo que el decorador es más generoso que el servicio: un barbero,
un responsable o el administrador global pasan el guard y reciben 404 «No estás vinculado a esta
barbería» si no tienen ese vínculo. El `TODO(E1-06)` deja apuntado dónde tiene que decidirse el vínculo
de verdad. La decisión original era solo `CLIENTE`; se ampliaron los roles de administración porque
`tenant.service.ts:137` encadena esta llamada al final de «crear barbería» (pantalla tras
`roleGuard(['ADMIN'])`), y después al barbero, que es quien más la necesita según el flujo del frontend.

**3. `GET /barberias/:id` — `@Autenticado` con DTO de lectura.** Sigue abierta a cualquier autenticado
porque sus datos (nombre, descripción, teléfono, ubicación) no son secretos de negocio, pero
`BarberiaLecturaDto` oculta `codigoAcceso` y `enlaceUnico` a todo el que no sea el ADMIN_BARBERIA de esa
barbería o el ADMINISTRADOR global. Ninguna pantalla la consume hoy.

**4. `DELETE /barberias/:id` — `@Roles(ADMINISTRADOR)`.** Desactivar una sede es una decisión de
plataforma. El responsable ya no puede cerrar su propio negocio.

**5. `POST /barberias/vincular` — `@Roles(CLIENTE)`.** El método crea un vínculo `cliente_barberias`:
trata al solicitante como cliente de esa barbería. Como el botón «Vincular con Código» de la pantalla
`/barberias` se mostraba sin condición de rol, ahora solo se pinta si el usuario es CLIENTE; el botón
«Crear Barbería», que estaba justo al lado y sí estaba condicionado, no cambia.

**6. `GET` y `POST /agenda/disponibilidad` — los cuatro roles.** Consultar disponibilidad es lectura de
agenda y la usan el wizard de reservas y la pantalla de agenda. La validación de vinculación se deja
anotada como `TODO(E1-06)`.

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
«reservas asignadas» que la sección 4 exige al barbero no se implementa: queda como `TODO(E3-09)`.

**10. `POST /reservas` — `@Roles(CLIENTE, BARBERO, ADMIN_BARBERIA, ADMINISTRADOR)`.** La sección 4 pide
solo CLIENTE, pero el frontend usa el mismo alias `/reservas` para el walk-in del modal de la pantalla de
agenda. Restringirla deja esa pantalla sin walk-in, así que la política declarada incluye a los cuatro
roles y la restricción real queda como `TODO(E3-03)`, que además pide una ruta aparte para el walk-in.

**11. `PATCH /reservas/:id/estado` — `@Roles(ADMIN_BARBERIA, ADMINISTRADOR)`.** El barbero deja de cambiar
el estado de una reserva. El botón «No Asistió» de `/admin/agenda` lo llama a esta ruta y el componente no
tenía condición de rol, así que ahora se oculta cuando el usuario es BARBERO: puede seguir cobrando y
registrando walk-ins, pero no le ofrezca una acción que el backend le va a denegar.

### Ajustes sobre las decisiones, decididos con el dueño

- **Decisión 2 ampliada dos veces**: `/seleccionar` admite además a `ADMIN_BARBERIA` y `ADMINISTRADOR`
  (para no romper el flujo de crear y cambiar de sede) y después también a `BARBERO`.
- **Decisión 10 ampliada**: `/reservas` incluye también al `ADMINISTRADOR`, que entra en `/admin/agenda` y
  usa el walk-in.
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
2. **La sede activa del frontend no pasa por `/seleccionar`.** `tenant.service.ts:59-82` la elige localmente
   entre las que devuelve `GET /barberias` (caché → `esBarberiaActiva` → la primera) y la guarda en
   `localStorage`; `/seleccionar` solo se invoca desde el botón «Seleccionar» de una tarjeta
   (`barberias.component.ts:166`) y desde el encadenado de `crearBarberia` (`tenant.service.ts:137`). El
   interceptor manda ese id en `x-barberia-id` (`auth.interceptor.ts:16-18`), que es lo que leen
   `@CurrentBarberiaId` y `RolesGuard`.
3. **`@CurrentBarberiaId` cae en `params.id`** (`current-barberia.decorator.ts:22-26`). En
   `GET /catalogo/servicios/:id` y `GET /catalogo/combos/:id` el primer argumento del servicio es por tanto
   el id del propio recurso, y `findOne(barberiaId, id)` busca `{ id, barberiaId }` con los dos iguales: esas
   dos rutas no pueden devolver nunca un recurso.
4. **La regla del código de acceso solo está escrita en `findOne`.** `GET /barberias/:id` calcula `veCodigo`
   (solo ADMIN_BARBERIA de esa sede o ADMINISTRADOR) y usa el DTO de lectura; `GET /barberias` usa
   `toResponse` —con `codigoAcceso` y `enlaceUnico`— filtrando solo por `responsableId`, sin mirar el rol
   (`barberia.service.ts:251-257`). Hoy no se abre nada: quien es `responsableId` de una sede es su
   ADMIN_BARBERIA, y `findAllByResponsable` no devuelve barberías ajenas. Pero las dos lecturas de la misma
   sede aplican reglas distintas, y basta con que una fila `usuario_roles` se borre para que el responsable
   reciba por una ruta lo que por la otra no. Fijado por
   `barberia.service.spec.ts` → `findAllByResponsable · hueco conocido de E1-05`; cerrarlo es decisión del
   dueño (E1-07 o tarea nueva).
5. **No existe ninguna ruta que liste las barberías de un `CLIENTE`.** `cliente_barberias` solo se lee con
   `findUnique` por `(usuarioId, barberiaId)` —en `vincularCliente`, `seleccionarBarberiaActiva` y
   `reserva.service.ts:42,316`—, nunca con `findMany`. La única lista del backend es `GET /barberias`, que
   filtra por `responsableId` y devuelve `[]` a un cliente (hallazgo 1). Resuelve la pregunta que quedaba
   abierta en el informe de estado: la pantalla de barberías del cliente no puede estar saliendo de ningún
   endpoint; si el cliente ve sedes hoy, vienen de la caché en `localStorage` o de datos de otra versión.

## Qué queda pendiente de esta tarea

| Tarea | Qué falta | Dónde está anotado |
|---|---|---|
| E1-06 | Comprobar el vínculo del solicitante al calcular disponibilidad | `agenda.controller.ts`, ambos verbos |
| E1-06 | Resolver el vínculo de la sede seleccionada: hoy la exige `cliente_barberias` y el barbero no lo tiene | `barberia.controller.ts`, `PATCH /barberias/:id/seleccionar` |
| E1-07 | Límite de 2 barberías por usuario al crear | `barberia.controller.ts`, `POST /barberias` |
| E3-03 | Reservar la creación de reservas al CLIENTE y crear la ruta de walk-in | `reserva.controller.ts`, `POST /reservas` |
| E3-09 | Un BARBERO solo cobra las reservas que tiene asignadas | `pago.controller.ts`, `POST /cobros` |
| D43 | Declaración propia del cliente con su ruta y su campo de origen | `antecedente.controller.ts`, `POST /antecedentes` |