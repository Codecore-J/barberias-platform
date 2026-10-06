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
   figuran entre las 54 porque no existen en el servidor.
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
| 12 | GET | `/barberias` | BarberiaController | `@Autenticado` | `@Autenticado` | — | no (filtra por `responsableId`) | **sí** — `veCodigoDe` por sede (E1-07) | sí — `core/services/tenant.service.ts:64` | `test/barberia.e2e-spec.ts`; `src/barberia/application/barberia.service.spec.ts` |
| 13 | POST | `/barberias` | BarberiaController | `@Autenticado` | `@Autenticado` | **1** | no | no | sí — `core/services/tenant.service.ts:133` | `src/barberia/application/barberia.service.spec.ts` |
| 14 | PATCH | `/barberias/:id/seleccionar` | BarberiaController | `@Autenticado` | `@Roles(CLIENTE, BARBERO, ADMIN_BARBERIA, ADMINISTRADOR)` | **2** | **sí** — `cliente_barberias`, `usuario_roles` o ser el responsable (`d93e9af`) | **sí** — `estado_vinculacion = 'ACTIVO'` **solo en la vía `cliente_barberias`** | sí — `core/services/tenant.service.ts:94` y `:137` | `src/barberia/application/barberia.service.spec.ts`; `test/barberia.e2e-spec.ts` |
| 15 | GET | `/barberias/:id` | BarberiaController | `@Autenticado` | `@Autenticado` + DTO de lectura | **3** | no | no | **no** | `src/barberia/application/barberia.service.spec.ts` |
| 16 | PATCH | `/barberias/:id` | BarberiaController | `@Autenticado` | `@Roles(ADMIN_BARBERIA, ADMINISTRADOR)` | matriz | **sí** | **sí** — responsable, salvo ADMINISTRADOR | **no** | `test/hallazgo16-rolesguard-global.e2e-spec.ts` |
| 17 | DELETE | `/barberias/:id` | BarberiaController | `@Autenticado` | `@Roles(ADMINISTRADOR)` | **4** | no (el guard ya acota) | no | no | `test/permisos-matriz.e2e-spec.ts` |
| 18 | GET | `/barberias/all` | BarberiaController | `@Roles(ADMINISTRADOR)` | `@Roles(ADMINISTRADOR)` | E1-04 | no | no | no | ninguno |
| 19 | GET | `/barberias/:id/personal` | BarberiaController | `@Roles(ADMIN_BARBERIA, BARBERO)` | `@Roles(ADMIN_BARBERIA, BARBERO)` | E1-03 | **sí** | no | sí — `core/services/personal.service.ts:22` | `test/h19-h20-lecturas-abiertas.e2e-spec.ts`; `src/barberia/application/barberia.service.spec.ts` |
| 20 | POST | `/barberias/vincular` | BarberiaController | `@Autenticado` | `@Roles(CLIENTE)` | **5** | no | no | sí — `core/services/tenant.service.ts:115`; el botón ya solo se muestra a CLIENTE | `test/barberia.e2e-spec.ts` |
| 21 | GET | `/barberias/:barberiaId/agenda/bloqueos` · `/agenda/bloqueos` | AgendaController | `@Roles(ADMIN_BARBERIA, BARBERO)` | `@Roles(ADMIN_BARBERIA, BARBERO)` | E1-03 | **sí** — `validateAccess` | no | sí — `core/services/horarios.service.ts:83` | `test/h19-h20-lecturas-abiertas.e2e-spec.ts`; `src/agenda/application/agenda.service.spec.ts` |
| 22 | POST | `/barberias/:barberiaId/agenda/bloqueos` · `/agenda/bloqueos` | AgendaController | `@Autenticado` | `@Roles(ADMIN_BARBERIA, ADMINISTRADOR)` | matriz | **sí** — `validateAccess` | no | sí — `core/services/horarios.service.ts:87` | `src/agenda/application/agenda.service.spec.ts` |
| 23 | DELETE | `/barberias/:barberiaId/agenda/bloqueos/:id` · `/agenda/bloqueos/:id` | AgendaController | `@Autenticado` | `@Roles(ADMIN_BARBERIA, ADMINISTRADOR)` | matriz | **sí** — `validateAccess` | **sí** — el bloqueo debe ser de esa barbería | sí — `core/services/horarios.service.ts:91` | `src/agenda/application/agenda.service.spec.ts` |
| 24 | GET | `/barberias/:barberiaId/agenda/disponibilidad` · `/agenda/disponibilidad` | AgendaController | `@Autenticado` | `@Roles(CLIENTE, BARBERO, ADMIN_BARBERIA, ADMINISTRADOR)` | **6** | **sí** — `calcularDisponibilidadDeSolicitante` (`d93e9af`) | no | sí — `core/services/reservas.service.ts:38`, que llama al alias `/agenda/disponibilidad` | `src/agenda/application/disponibilidad.service.spec.ts`; `test/e1-06-sede-del-tenant.e2e-spec.ts` |
| 25 | POST | `/barberias/:barberiaId/agenda/disponibilidad` · `/agenda/disponibilidad` | AgendaController | `@Autenticado` | `@Roles(CLIENTE, BARBERO, ADMIN_BARBERIA, ADMINISTRADOR)` | **6** | **sí** — `calcularDisponibilidadDeSolicitante` (`d93e9af`) | no | no | `src/agenda/application/disponibilidad.service.spec.ts`; `test/e1-06-sede-del-tenant.e2e-spec.ts` |
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

**4. `DELETE /barberias/:id` — `@Roles(ADMINISTRADOR)`.** Desactivar una sede es una decisión de
plataforma. El responsable ya no puede cerrar su propio negocio.

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
5. **No existe ninguna ruta que liste las barberías de un `CLIENTE`.** `cliente_barberias` solo se lee con
   `findUnique` por `(usuarioId, barberiaId)` —en `vincularCliente`, `seleccionarBarberiaActiva` y
   `reserva.service.ts:42,316`—, nunca con `findMany`. La única lista del backend es `GET /barberias`, que
   filtra por `responsableId` y devuelve `[]` a un cliente (hallazgo 1). Resuelve la pregunta que quedaba
   abierta en el informe de estado: la pantalla de barberías del cliente no puede estar saliendo de ningún
   endpoint; si el cliente ve sedes hoy, vienen de la caché en `localStorage` o de datos de otra versión.

## Qué queda pendiente de esta tarea

| Tarea | Qué falta | Dónde está anotado |
|---|---|---|
| E1-06 | ~~Comprobar el vínculo del solicitante al calcular disponibilidad~~ — cerrado en `d93e9af` | `agenda.controller.ts`, ambos verbos |
| E1-06 | ~~Resolver el vínculo de la sede seleccionada~~ — cerrado en `d93e9af` | `barberia.controller.ts`, `PATCH /barberias/:id/seleccionar` |
| E1-07 | Límite de 2 barberías por usuario al crear | `barberia.controller.ts`, `POST /barberias` |
| E3-03 | Reservar la creación de reservas al CLIENTE y crear la ruta de walk-in | `reserva.controller.ts`, `POST /reservas` |
| E3-09 | Un BARBERO solo cobra las reservas que tiene asignadas | `pago.controller.ts`, `POST /cobros` |
| D43 | Declaración propia del cliente con su ruta y su campo de origen | `antecedente.controller.ts`, `POST /antecedentes` |

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