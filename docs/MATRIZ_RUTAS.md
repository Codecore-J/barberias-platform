# MATRIZ_RUTAS.md · Permisos por ruta (E1-05, punto 3)

> Documento de solo lectura. **No modifica código.** Generado sobre `origin/main` (`070abeb`).
> La tabla de rutas es la que produce `test/route-security.spec.ts` (`=== TABLA DE RUTAS (54) ===`).

## Cómo leerla

- **Ruta**: cada celda lista la ruta canónica y, separados por `·`, sus alias. `AgendaController` se declara
  `@Controller(['barberias/:barberiaId/agenda', 'agenda'])`, así que `POST /agenda/bloqueos` y
  `POST /barberias/:id/agenda/bloqueos` son **la misma ruta**. Cada fila cuenta una combinación de
  método + controlador, y el decorador es el mismo para todos sus alias. Hay cinco controladores con más de
  un prefijo: `AgendaController` (`agenda`), `ReservaController` (`reservas`), `ServiciosController`
  (`servicios`), `PagoController` (`cobros`, `pagos`) y `HealthController` (`api/v1/health`).
- **Tenant (T)**: hace falta comprobar que el usuario tiene relación con **esa** barbería (rol detallado,
  responsable o vínculo de cliente). Sin esto, un admin de la barbería A opera la B.
- **Ownership (O)**: hace falta comprobar que el recurso concreto pertenece al actor (su reserva, su
  horario, su antecedente). Es distinto del tenant: mismo tenant, recurso de otro.
- **Política propuesta**: sale de la sección 4 del backlog. Cuando la sección 4 no cubre la ruta o admite
  más de una lectura, la celda dice **DECISIÓN DEL DUEÑO** y el número remite a la lista final.

## Advertencias que afectan a todo el documento

1. **El decorador actual todavía cita `SUPER_ADMIN`.** Este documento se generó sobre `origin/main`, que
   no incluye E1-04. La rama `fix/roles-superadmin-ambito` lo sustituye por `ADMINISTRADOR` en
   `barberias/all`, `auditoria/*` y `reservas/*:id/estado`. La columna «decorador actual» refleja `main`.
2. **Todas las 54 rutas están cubiertas por `test/route-security.spec.ts`, pero ese test solo mira los
   metadatos del decorador**, no el comportamiento. La última columna añade el test de comportamiento
   cuando existe; `ninguno` significa que la ruta no tiene ninguna prueba de acceso.
3. **El frontend llama a dos rutas que no existen.** `GET /clientes/:id/ficha` y `POST /clientes/:id/notas`
   están en `frontend-barberias/src/app/core/services/clientes.service.ts:38,55`, pero `ClienteModule` no
   está registrado en `AppModule` (`app.module.ts:56-58`, comentario H22) y sus rutas responden 404. No
   figuran entre las 54 porque no existen en el servidor. Además declaran `@Roles('BARBERO', 'ADMIN')`, un
   alias que el backend nunca entendió: aunque se registraran, `RolesGuard` las denegaría.
4. **`@CurrentBarberiaId` no es `@Param('barberiaId', ParseUUIDPipe)`.** En `PagoController` el tenant llega
   por param, header `x-barberia-id` o query, y devuelve `null` si no hay ninguno. Por eso los alias
   `/cobros` y `/pagos` funcionan sin `barberiaId` en la URL, a diferencia de `AgendaController` y
   `AntecedenteController`, donde el `ParseUUIDPipe` devuelve 400 si falta.

## La matriz

| # | Método | Ruta (alias incluidos) | Controlador | Decorador actual | Política propuesta | T | O | ¿La usa el frontend? | Test de comportamiento hoy |
|---|---|---|---|---|---|---|---|---|---|
| 1 | GET | `/` | AppController | `@Public` | `@Public` | — | — | no | `src/app.controller.spec.ts` |
| 2 | POST | `/auth/register` | AuthController | `@Public` | `@Public` | — | — | sí — `auth/auth.service.ts:62` | `src/iam/infrastructure/auth.controller.spec.ts`; `test/auth.e2e-spec.ts` |
| 3 | POST | `/auth/login` | AuthController | `@Public` | `@Public` | — | — | sí — `auth/auth.service.ts:83` | `src/iam/infrastructure/auth.controller.spec.ts`; `test/auth.e2e-spec.ts` |
| 4 | GET | `/auth/me` | AuthController | `@Autenticado` | `@Autenticado` | no | no (es el propio) | sí — `auth/auth.service.ts:153` | `src/iam/infrastructure/auth.controller.spec.ts` |
| 5 | POST | `/auth/forgot-password` | AuthController | `@Public` | `@Public` | — | — | sí — `auth/auth.service.ts:170` | ninguno |
| 6 | POST | `/auth/reset-password` | AuthController | `@Public` | `@Public` | — | — | sí — `auth/auth.service.ts:174` | ninguno |
| 7 | GET | `/health` · `api/v1/health` | HealthController | `@Public` | `@Public` | — | — | no | `test/health.e2e-spec.ts` |
| 8 | GET | `/notificaciones/mis-notificaciones` | NotificacionController | `@Autenticado` | `@Autenticado` | no | no (es el propio) | sí — `core/services/notification.service.ts:29` | ninguno |
| 9 | GET | `/auditoria` | AuditoriaController | `@Roles(SUPER_ADMIN, ADMINISTRADOR, ADMIN_BARBERIA)` | `@Roles(ADMINISTRADOR, ADMIN_BARBERIA)` | **sí** (ya implementado en E1-02) | no | no — `pagos.service.ts:38` llama al alias `/cobros/auditoria`, que es la fila 37 | `test/h18-auditoria-cross-tenant.e2e-spec.ts`; `src/auditoria/application/auditoria.service.spec.ts` |
| 10 | GET | `/auditoria/estadisticas` | AuditoriaController | `@Roles(SUPER_ADMIN, ADMINISTRADOR)` | `@Roles(ADMINISTRADOR)` | no | no | sí — `core/services/pagos.service.ts:56` | `src/auditoria/infrastructure/auditoria.controller.spec.ts` |
| 11 | POST | `/auditoria/purgar` | AuditoriaController | `@Roles(SUPER_ADMIN, ADMINISTRADOR)` | `@Roles(ADMINISTRADOR)` | no | no | sí — `core/services/pagos.service.ts:65` | `src/auditoria/infrastructure/auditoria.controller.spec.ts` |
| 12 | GET | `/barberias` | BarberiaController | `@Autenticado` | `@Autenticado` | no (filtra por `responsableId`) | no | sí — `core/services/tenant.service.ts:64` | `test/barberia.e2e-spec.ts` |
| 13 | POST | `/barberias` | BarberiaController | `@Autenticado` | **DECISIÓN DEL DUEÑO (1)** | no | no | sí — `core/services/tenant.service.ts:133` | `src/barberia/application/barberia.service.spec.ts` |
| 14 | PATCH | `/barberias/:id/seleccionar` | BarberiaController | `@Autenticado` | **DECISIÓN DEL DUEÑO (2)** | **sí** — vínculo en `cliente_barberias` | **sí** — `estado_vinculacion = 'ACTIVO'` | sí — `core/services/tenant.service.ts:94` | `src/barberia/application/barberia.service.spec.ts`; `test/barberia.e2e-spec.ts` |
| 15 | GET | `/barberias/:id` | BarberiaController | `@Autenticado` | **DECISIÓN DEL DUEÑO (3)** | **sí** | no | **no** | ninguno |
| 16 | PATCH | `/barberias/:id` | BarberiaController | `@Autenticado` | `@Roles(ADMIN_BARBERIA, ADMINISTRADOR)` | **sí** | **sí** — responsable, salvo ADMINISTRADOR | **no** | `test/hallazgo16-rolesguard-global.e2e-spec.ts` |
| 17 | DELETE | `/barberias/:id` | BarberiaController | `@Autenticado` | **DECISIÓN DEL DUEÑO (4)** | **sí** | **sí** | no | ninguno |
| 18 | GET | `/barberias/all` | BarberiaController | `@Roles(SUPER_ADMIN)` | `@Roles(ADMINISTRADOR)` | no | no | no | ninguno |
| 19 | GET | `/barberias/:id/personal` | BarberiaController | `@Roles(ADMIN_BARBERIA, BARBERO)` | `@Roles(ADMIN_BARBERIA, BARBERO)` (ya aplicado en E1-03) | **sí** | no | sí — `core/services/personal.service.ts:22` | `test/h19-h20-lecturas-abiertas.e2e-spec.ts`; `src/barberia/application/barberia.service.spec.ts` |
| 20 | POST | `/barberias/vincular` | BarberiaController | `@Autenticado` | **DECISIÓN DEL DUEÑO (5)** | no | no | sí — `core/services/tenant.service.ts:115` | `test/barberia.e2e-spec.ts` |
| 21 | GET | `/barberias/:barberiaId/agenda/bloqueos` · `/agenda/bloqueos` | AgendaController | `@Roles(ADMIN_BARBERIA, BARBERO)` | `@Roles(ADMIN_BARBERIA, BARBERO)` (ya aplicado en E1-03) | **sí** — `validateAccess` | no | sí — `core/services/horarios.service.ts:83` | `test/h19-h20-lecturas-abiertas.e2e-spec.ts`; `src/agenda/application/agenda.service.spec.ts` |
| 22 | POST | `/barberias/:barberiaId/agenda/bloqueos` · `/agenda/bloqueos` | AgendaController | `@Autenticado` | `@Roles(ADMIN_BARBERIA, ADMINISTRADOR)` | **sí** — `validateAccess` | no | sí — `core/services/horarios.service.ts:87` | `src/agenda/application/agenda.service.spec.ts` |
| 23 | DELETE | `/barberias/:barberiaId/agenda/bloqueos/:id` · `/agenda/bloqueos/:id` | AgendaController | `@Autenticado` | `@Roles(ADMIN_BARBERIA, ADMINISTRADOR)` | **sí** — `validateAccess` | **sí** — el bloqueo debe ser de esa barbería | sí — `core/services/horarios.service.ts:91` | `src/agenda/application/agenda.service.spec.ts` |
| 24 | GET | `/barberias/:barberiaId/agenda/disponibilidad` · `/agenda/disponibilidad` | AgendaController | `@Autenticado` | **DECISIÓN DEL DUEÑO (6)** | **sí** | no | sí — `core/services/reservas.service.ts:38`, que llama al alias `/agenda/disponibilidad` | ninguno |
| 25 | POST | `/barberias/:barberiaId/agenda/disponibilidad` · `/agenda/disponibilidad` | AgendaController | `@Autenticado` | **DECISIÓN DEL DUEÑO (6)** | **sí** | no | no | ninguno |
| 26 | POST | `/barberias/:barberiaId/antecedentes` | AntecedenteController | `@Autenticado` | **DECISIÓN DEL DUEÑO (7)** | **sí** | no | no | `src/antecedente/application/antecedente.service.spec.ts` |
| 27 | PATCH | `/barberias/:barberiaId/antecedentes/:id/evaluar` | AntecedenteController | `@Autenticado` | `@Roles(ADMIN_BARBERIA, ADMINISTRADOR)` (D35) | **sí** | **sí** — el antecedente debe ser de esa barbería | sí — `core/services/antecedentes.service.ts:29` | `src/antecedente/application/antecedente.service.spec.ts` |
| 28 | GET | `/barberias/:barberiaId/antecedentes/cliente/:clienteId` | AntecedenteController | `@Autenticado` | **DECISIÓN DEL DUEÑO (7)** | **sí** | **sí** — el cliente debe estar vinculado a esa barbería | no | `src/antecedente/application/antecedente.service.spec.ts` |
| 29 | GET | `/barberias/:barberiaId/antecedentes/pendientes` | AntecedenteController | `@Autenticado` | `@Roles(ADMIN_BARBERIA, ADMINISTRADOR)` (cola de evaluación, D35) | **sí** | no | sí — `core/services/antecedentes.service.ts:25` | `src/antecedente/application/antecedente.service.spec.ts` |
| 30 | GET | `/barberias/:barberiaId/horarios` | HorarioController | `@Autenticado` | **DECISIÓN DEL DUEÑO (8)** | **sí** | no | sí — `core/services/horarios.service.ts:49` | ninguno |
| 31 | POST | `/barberias/:barberiaId/horarios` | HorarioController | `@Autenticado` | `@Roles(ADMIN_BARBERIA, ADMINISTRADOR)` | **sí** — `validateAccess` | no | sí — `core/services/horarios.service.ts:53` | ninguno |
| 32 | GET | `/barberias/:barberiaId/horarios/mi-horario` | HorarioController | `@Autenticado` | `@Roles(BARBERO)` | **sí** | **sí** — `barberoId` resuelto del token, nunca del cuerpo | sí — `core/services/horarios.service.ts:57` | ninguno |
| 33 | POST | `/barberias/:barberiaId/horarios/mi-horario` | HorarioController | `@Autenticado` | `@Roles(BARBERO)` | **sí** | **sí** — mismo caso | sí — `core/services/horarios.service.ts:61` | ninguno |
| 34 | GET | `/barberias/:barberiaId/horarios/excepciones` | HorarioController | `@Autenticado` | **DECISIÓN DEL DUEÑO (8)** | **sí** | no | sí — `core/services/horarios.service.ts:68` | ninguno |
| 35 | POST | `/barberias/:barberiaId/horarios/excepciones` | HorarioController | `@Autenticado` | `@Roles(ADMIN_BARBERIA, ADMINISTRADOR)` | **sí** — `validateAccess` | no | sí — `core/services/horarios.service.ts:72` | ninguno |
| 36 | POST | `/barberias/:barberiaId/horarios/barberos/:barberoId/excepciones` | HorarioController | `@Autenticado` | `@Roles(BARBERO, ADMIN_BARBERIA, ADMINISTRADOR)` | **sí** | **sí** — un barbero solo sobre su propio `barberoId` | sí — `core/services/horarios.service.ts:76` | ninguno |
| 37 | GET | `/barberias/:barberiaId/pagos/auditoria` · `/cobros/auditoria` · `/pagos/auditoria` | PagoController | `@Autenticado` | `@Roles(ADMIN_BARBERIA, ADMINISTRADOR)` | **sí** — `validateAccess` | no | **no** — `pagos.service.ts:38` existe pero nadie lo llama | `src/pago/application/pago.service.spec.ts` |
| 38 | POST | `/barberias/:barberiaId/pagos/en-persona` · `/cobros` · `/pagos` | PagoController | `@Autenticado` | **DECISIÓN DEL DUEÑO (9)** | **sí** — `validateAccess` | **sí** — el barbero solo sobre reservas asignadas | sí — `core/services/reservas.service.ts:131` | `src/pago/application/pago.service.spec.ts` |
| 39 | POST | `/barberias/:barberiaId/reservas` · `/reservas` | ReservaController | `@Autenticado` | **DECISIÓN DEL DUEÑO (10)** | **sí** | **sí** — cliente vinculado, no restringido | sí — `core/services/reservas.service.ts:60`, que llama al alias `/reservas`, desde `reserva-wizard` y `walk-in-modal` | `test/hallazgo14-idor-reserva.e2e-spec.ts` |
| 40 | GET | `/barberias/:barberiaId/reservas/:id` · `/reservas/:id` | ReservaController | `@Roles(ADMIN_BARBERIA, BARBERO, CLIENTE)` | `@Roles(ADMIN_BARBERIA, BARBERO, CLIENTE)` (se mantiene) | **sí** | **sí** — un `CLIENTE` solo ve la suya | no | `test/hallazgo14-idor-reserva.e2e-spec.ts`; `src/reserva/application/reserva.service.spec.ts` |
| 41 | PATCH | `/barberias/:barberiaId/reservas/:id/estado` · `/reservas/:id/estado` | ReservaController | `@Roles(ADMIN_BARBERIA, BARBERO, ADMINISTRADOR, SUPER_ADMIN)` | **DECISIÓN DEL DUEÑO (11)** | **sí** | no | sí — `core/services/reservas.service.ts:111` | `src/reserva/application/reserva.service.spec.ts` |
| 42 | POST | `/barberias/:barberiaId/reservas/:id/inasistencia` · `/reservas/:id/inasistencia` | ReservaController | `@Roles(ADMIN_BARBERIA, BARBERO, ADMINISTRADOR, SUPER_ADMIN)` | `@Roles(ADMIN_BARBERIA, ADMINISTRADOR)` (D02) | **sí** | no | no | ninguno |
| 43 | GET | `/barberias/:barberiaId/reservas/agenda` · `/reservas/agenda` | ReservaController | `@Roles(ADMIN_BARBERIA, BARBERO, ADMINISTRADOR, SUPER_ADMIN)` | `@Roles(ADMIN_BARBERIA, BARBERO, ADMINISTRADOR)` (D16: el barbero lee su agenda) | **sí** | **sí** — el barbero solo la suya | sí — `core/services/reservas.service.ts:94` | `test/hallazgo16-rolesguard-global.e2e-spec.ts` |
| 44 | GET | `/barberias/:barberiaId/reservas/mis-reservas` · `/reservas/mis-reservas` | ReservaController | `@Autenticado` | `@Roles(CLIENTE)` | no | **sí** — `clienteId` del token | sí — `core/services/reservas.service.ts:77` | ninguno |
| 45 | GET | `/catalogo/servicios` · `/servicios` | ServiciosController | `@Roles(ADMIN_BARBERIA, BARBERO, CLIENTE)` | `@Roles(ADMIN_BARBERIA, BARBERO, CLIENTE, ADMINISTRADOR)` | **sí** | no | sí — `core/services/servicios.service.ts:32` | `src/catalogo/application/servicios.service.spec.ts` |
| 46 | POST | `/catalogo/servicios` · `/servicios` | ServiciosController | `@Roles(ADMIN_BARBERIA, BARBERO)` | `@Roles(ADMIN_BARBERIA, ADMINISTRADOR)` (D16 quita `BARBERO`) | **sí** | no | sí — `core/services/servicios.service.ts:58` | ninguno |
| 47 | GET | `/catalogo/servicios/:id` · `/servicios/:id` | ServiciosController | `@Roles(ADMIN_BARBERIA, BARBERO, CLIENTE)` | `@Roles(ADMIN_BARBERIA, BARBERO, CLIENTE, ADMINISTRADOR)` | **sí** | no | no | ninguno |
| 48 | PATCH | `/catalogo/servicios/:id` · `/servicios/:id` | ServiciosController | `@Roles(ADMIN_BARBERIA, BARBERO)` | `@Roles(ADMIN_BARBERIA, ADMINISTRADOR)` (D16) | **sí** | no | sí — `core/services/servicios.service.ts:76` | ninguno |
| 49 | DELETE | `/catalogo/servicios/:id` · `/servicios/:id` | ServiciosController | `@Roles(ADMIN_BARBERIA, BARBERO)` | `@Roles(ADMIN_BARBERIA, ADMINISTRADOR)` (D16) | **sí** | no | sí — `core/services/servicios.service.ts:90` | ninguno |
| 50 | GET | `/catalogo/combos` | CombosController | `@Roles(ADMIN_BARBERIA, BARBERO, CLIENTE)` | `@Roles(ADMIN_BARBERIA, BARBERO, CLIENTE, ADMINISTRADOR)` | **sí** | no | **no** | ninguno |
| 51 | POST | `/catalogo/combos` | CombosController | `@Roles(ADMIN_BARBERIA, BARBERO)` | `@Roles(ADMIN_BARBERIA, ADMINISTRADOR)` (D16) | **sí** | no | **no** | ninguno |
| 52 | GET | `/catalogo/combos/:id` | CombosController | `@Roles(ADMIN_BARBERIA, BARBERO, CLIENTE)` | `@Roles(ADMIN_BARBERIA, BARBERO, CLIENTE, ADMINISTRADOR)` | **sí** | no | **no** | ninguno |
| 53 | PATCH | `/catalogo/combos/:id` | CombosController | `@Roles(ADMIN_BARBERIA, BARBERO)` | `@Roles(ADMIN_BARBERIA, ADMINISTRADOR)` (D16) | **sí** | no | **no** | ninguno |
| 54 | DELETE | `/catalogo/combos/:id` | CombosController | `@Roles(ADMIN_BARBERIA, BARBERO)` | `@Roles(ADMIN_BARBERIA, ADMINISTRADOR)` (D16) | **sí** | no | **no** | ninguno |

## Recuento por política propuesta

| Política propuesta | Rutas |
|---|---|
| `@Public` (sin cambios) | 6 |
| `@Autenticado` (sin cambios) | 3 |
| `@Roles(...)` con lista concreta | 31 |
| **DECISIÓN DEL DUEÑO** | 14 |
| **Total** | **54** |

Las 14 filas pendientes son la 13, 14, 15, 17, 20, 24, 25, 26, 28, 30, 34, 38, 39 y 41. Se agrupan en once
decisiones porque la decisión 6 cubre las filas 24 y 25 (los dos verbos de disponibilidad) y la decisión 7
cubre las 26 y 28 (las dos rutas de antecedentes).

## Decisiones del dueño

**1. `POST /barberias` — ¿quién puede crear una barbería?**
Hoy es `@Autenticado` y la sección 4 dice «Crear barbería (límite 2, D04): sí, sí, sí, sí» para los cuatro
roles, así que la política sería `@Autenticado` y el límite de 2 debe aplicarlo el servicio, que hoy no lo
hace. Lo que no cuadra es el frontend: la pantalla `/barberias/nueva` está tras `roleGuard(['ADMIN'])`
(`app.routes.ts:35`), así que un `CLIENTE` ve un 403 en la pantalla pese a que la API le dejaría crear.
- **A** — `@Autenticado` en la API y abrir `/barberias/nueva` a cualquier autenticado, con el límite de 2
  aplicado en `barberia.service.create`. Coherente con D04 y con el principio 3.1 «el backend es la autoridad».
- **B** — `@Roles(ADMIN_BARBERIA, ADMINISTRADOR)` y dejar la pantalla como está. Contradice D04 y E1-08.
- **Recomiendo A.** D04 y E1-08 apuntan en la misma dirección y el límite de 2 es la salvaguarda real.

**2. `PATCH /barberias/:id/seleccionar` — ¿quién puede seleccionar barbería activa?**
Hoy es `@Autenticado`, pero `seleccionarBarberiaActiva` exige una fila en `cliente_barberias`, así que en la
práctica solo puede usarla un `CLIENTE` vinculado. La sección 4 no menciona «seleccionar barbería activa».
- **A** — `@Roles(CLIENTE)` + tenant y ownership explícitos (`estado_vinculacion = 'ACTIVO'`). Es lo que el
  servicio ya hace; el decorador pasa a documentarlo.
- **B** — `@Autenticado` y ampliar el servicio para que `ADMIN_BARBERIA` y `BARBERO` también puedan elegir,
  resolviendo el tenant por rol en vez de por vínculo de cliente.
- **Recomiendo A.** Es el comportamiento actual y no cambia nada; B es una funcionalidad nueva disfrazada
  de política de permisos, y la sección 4 no la pide.

**3. `GET /barberias/:id` — leer una barbería por identificador.**
No aparece en la sección 4 y el frontend no la llama. E1-07 advierte de que podría filtrar `codigoAcceso` o
`enlaceUnico`, y `barberia.service.findOne` los devuelve a cualquier usuario con sesión.
- **A** — `@Autenticado` + tenant, y una DTO de lectura que excluya `codigoAcceso` y `enlaceUnico` salvo que
  el solicitante sea el responsable o el `ADMINISTRADOR`.
- **B** — cerrar la ruta a `@Roles(ADMIN_BARBERIA, ADMINISTRADOR)`. Nadie la usa hoy, así que es más simple.
- **Recomiendo A**, aunque hoy no la consume nadie: los datos de una barbería (nombre, descripción, teléfono,
  ubicación) no son secretos de negocio, y filtrar los dos campos sensibles resuelve el riesgo de E1-07 sin
  cerrar la puerta a las pantallas públicas que la necesitarán.

**4. `DELETE /barberias/:id` — desactivar una barbería.**
Es un soft-delete que pone `estado = 'INACTIVO'`. La sección 4 separa «Editar datos directos de su barbería»
(`ADMIN_BARBERIA` sí) de «Aprobar 6ª vinculación, **suspender barbería**, resolver cambios» (`ADMINISTRADOR`
solo). Leerlo al pie de la letra deja al responsable sin poder desactivar su propia barbería.
- **A** — `@Roles(ADMINISTRADOR)`, lectura literal de «suspender barbería».
- **B** — `@Roles(ADMIN_BARBERIA, ADMINISTRADOR)` con tenant: el responsable puede desactivar la suya.
- **Recomiendo B.** La fila de «suspender» habla del poder de plataforma sobre otras sedes; quitar al
  responsable la capacidad de cerrar su propio negocio es una regresión que nadie pidió.

**5. `POST /barberias/vincular` — vincularse con un código de acceso.**
No está en la sección 4. El método crea un vínculo `cliente_barberias`, es decir, trata al solicitante como
cliente de esa barbería.
- **A** — `@Roles(CLIENTE)`.
- **B** — `@Autenticado`, para que un `BARBERO` pueda vincularse sin que el sistema le cree un vínculo de
  cliente que no le corresponde.
- **Recomiendo A.** Un barbero ya entra por rol en su barbería y no necesita vínculo de cliente; dejarlo
  abierto crea filas que luego complican las consultas de agenda.

**6. `GET` y `POST /agenda/disponibilidad` — consultar disponibilidad.**
La sección 4 dice «Consultar disponibilidad calculada: sí, sí, sí, sí», o sea los cuatro roles. Pero el
tenant es obligatorio: sin `@barberiaId` la ruta responde 400.
- **A** — `@Autenticado` (los cuatro roles) + tenant obligatorio. Es la lectura literal.
- **B** — `@Roles(CLIENTE, BARBERO, ADMIN_BARBERIA, ADMINISTRADOR)` explícito, para que el decorador declare
  la política y no dependa solo de «autenticado».
- **Recomiendo B.** El principio 7 del backlog pide que todo endpoint declare su política, y E1-01 dejó
  `@Autenticado` como marcador de trabajo con `TODO(E1-05)`.

**7. `POST /antecedentes` y `GET /antecedentes/cliente/:clienteId` — D43.**
La sección 4 distingue tres acciones: proponer (`BARBERO` sí), evaluar (D35, solo `ADMIN_BARBERIA`) y
**declaración propia** (D43, solo `CLIENTE`). Hoy `POST /antecedentes` es el endpoint de «proponer» y acepta
un `usuarioId` ajeno en el cuerpo; no existe ninguna ruta para que un cliente declare lo suyo. D43 además
exige que la declaración no pase por aprobación y que se etiquete como tal, y el modelo `Antecedente` no
tiene ningún campo que distinga el origen.
- **A** — `POST /antecedentes` = `@Roles(BARBERO, ADMIN_BARBERIA, ADMINISTRADOR)` y dejar la declaración
  propia (D43) para cuando exista su ruta y su campo de origen.
- **B** — `POST /antecedentes` = `@Roles(CLIENTE, BARBERO, ADMIN_BARBERIA, ADMINISTRADOR)`, con el
  `usuarioId` forzado al token cuando el actor es `CLIENTE`, reutilizando la ruta para D43.
- **Recomiendo A.** B metería dos cosas distintas en un endpoint cuyo servicio ya valida «quien registra
  un antecedente sobre otro usuario tiene rol en esa barbería»; la declaración propia necesita su propio
  contrato, porque D43 dice que no pasa por aprobación y el flujo actual siempre nace en `PENDIENTE`.

**8. `GET /horarios` y `GET /horarios/excepciones` — lectura de horarios.**
La sección 4 solo regula la escritura («Horarios, excepciones, bloqueos (escribir): `ADMIN_BARBERIA` sí,
`BARBERO` solo `mi-horario`»). No dice quién lee el horario de la barbería, y el frontend lo lee desde
`admin/horarios`, que es `roleGuard(['ADMIN'])`.
- **A** — `@Autenticado` + tenant, como ahora en la práctica.
- **B** — `@Roles(CLIENTE, BARBERO, ADMIN_BARBERIA, ADMINISTRADOR)` + tenant, alineado con «consultar
  disponibilidad: los cuatro».
- **Recomiendo B**, por el mismo motivo que la decisión 6: declarar la política en el decorador en vez de
  dejarla implícita. Si además quieres que un `CLIENTE` vea el horario de su barbería, esta es la fila que
  lo decide.

**9. `POST /cobros` — registrar atención y pago (atención y pago de una reserva).**
La sección 4 dice «Registrar atención y pago: `BARBERO` sí (**reservas asignadas**), `ADMIN_BARBERIA` sí,
`ADMINISTRADOR` sí». Hoy el decorador es `@Autenticado` y `pago.service.validateAccess` concede a cualquier
`BARBERO` de la barbería, sin comprobar que la reserva sea suya. El frontend cobra desde el modal de cobro de
`admin/agenda`, ruta que admite `BARBERO`.
- **A** — `@Roles(BARBERO, ADMIN_BARBERIA, ADMINISTRADOR)` y añadir la comprobación de «reserva asignada»
  para el `BARBERO`. Es la lectura literal de la sección 4.
- **B** — quitar `BARBERO` y dejarlo en `@Roles(ADMIN_BARBERIA, ADMINISTRADOR)`, porque «atención» y «pago»
  son la misma operación y el modelo no separa ambas cosas.
- **Recomiendo A.** La matriz dice «reservas asignadas» de forma explícita, y esa frase está escrita
 exactamente para este caso. Si eliges B, `admin/agenda` deja de poder cobrar para un barbero.

**10. `POST /reservas` — creación de reserva y walk-in.**
E1-05 punto 2 dice «Reservas: crear solo `CLIENTE`», y la sección 4 lo confirma: «Crear reserva: `CLIENTE` sí
(vinculado activo, no restringido), `BARBERO` No, `ADMIN_BARBERIA` No, `ADMINISTRADOR` No». Pero **el
frontend usa la misma ruta para el walk-in**: `features/agenda/components/walk-in-modal/walk-in-modal.component.ts:151`
llama `reservasService.crearReserva(payload)`, que es `core/services/reservas.service.ts:60` → `POST /reservas`.
El modal vive en `admin/agenda`, cuya ruta es `roleGuard(['ADMIN', 'BARBERO'])`. Con «solo `CLIENTE`», ni el
barbero ni el administrador podrían registrar un walk-in y la pantalla se rompería.
- **A** — mantener `@Autenticado` y confiar en el servicio para exigir vinculación activa y no restricción,
  aceptando que un admin pueda crear reservas en nombre de un cliente.
- **B** — restringir a `CLIENTE` y añadir una ruta aparte para el walk-in (por ejemplo
  `POST /barberias/:id/walk-in`) con `@Roles(BARBERO, ADMIN_BARBERIA, ADMINISTRADOR)` y el `clienteId` en el
  cuerpo. Es más fiel a la matriz, pero exige tocar frontend y backend.
- **Recomiendo B**, porque es la única que respeta «crear reserva: solo `CLIENTE`» sin romper una pantalla
  que existe y se usa a diario. Si prefieres no tocar el frontend ahora, A es un malabarismo aceptable como
  paso intermedio, pero hay que dejarlo escrito en el backlog.

**11. `PATCH /reservas/:id/estado` — cambiar el estado de una reserva.**
Hoy admite `BARBERO`, y el frontend lo llama desde `admin-agenda` (`reservas.service.ts:111`) para el botón
«No Asistió», que en realidad enruta a `marcarInasistencia`. E1-05 punto 2 dice «`PATCH :id/estado` queda
restringido a `ADMIN_BARBERIA` y `ADMINISTRADOR` hasta que E3 lo reemplace», y D02 reserva el no presentado a
los administradores. La sección 4, en cambio, da al `BARBERO` «Registrar atención y pago», lo que sugiere que
sí debería poder cerrar su turno.
- **A** — `@Roles(ADMIN_BARBERIA, ADMINISTRADOR)`, literal de E1-05. El barbero pierde el botón «No Asistió».
- **B** — `@Roles(BARBERO, ADMIN_BARBERIA, ADMINISTRADOR)` pero con una tabla de transiciones por rol, para que
  el barbero solo pueda llevar sus reservas a `COMPLETADA` y nunca a `CANCELADA`.
- **Recomiendo B**, porque es lo que dice la sección 4 para el barbero, y con una tabla de transiciones se
  respeta también D02. Si eliges A, hay que quitar el botón del `admin/agenda` para que no muestre un 403.

---

**Nota de alcance.** Este documento no cambia ni un decorador. Aplicar la columna «política propuesta» es
la tarea E1-05 (`fix/matriz-permisos`), que sigue abierta y depende de E1-04.
