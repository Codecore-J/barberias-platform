# MAPA FUNCIONAL DE ROLES Y LÓGICA

**Plataforma de Gestión de Barberías · `Codecore-J/barberias-platform`**
Fecha: **13 de noviembre de 2026** · Rama auditada: `fix/sprint-resto` (PR #138)
Alcance: diagnóstico. **No se modificó nada para producir este documento.**

## Cómo se construyó (y qué NO se verificó)

- **Rutas del frontend**: leídas de `frontend-barberias/src/app/app.routes.ts` (252 líneas) y de los tres guards (`auth.guard.ts`, `role.guard.ts`, `tenant.guard.ts`).
- **Endpoints del backend**: extraídos con un script que recorre los 26 controladores de `backend-barberias/src/**/*.controller.ts` y lee `@Controller`, `@Get/Post/Patch/Put/Delete`, `@Roles`, `@Autenticado`, `@Public`, `@UseGuards`. Son **121 endpoints**.
- **Política global**: `app.module.ts` registra `ThrottlerGuard`, `JwtAuthGuard` y `RolesGuard` como `APP_GUARD`, así que **todo endpoint exige JWT salvo `@Public()`**.
- **Verificación en ejecución**: los puntos marcados *verificado en navegador* se probaron contra el preview del PR #138 con la API de producción (sesiones ADMINISTRADOR, ADMIN_BARBERIA y BARBERO reales).
- **No verificado**: comportamiento bajo carga, ni los flujos que dependen de proveedores externos (WhatsApp/SMS, correo), ni OTP con teléfono real. Tampoco leí el `.env` ni la base de datos directamente: todo sale de código y de respuestas HTTP observadas.

Leyenda de roles: `ADMINISTRADOR` (global), `ADMIN_BARBERIA` (responsable de UNA sede, D06), `BARBERO` (vista limitada, D16), `CLIENTE`.
`SUPER_ADMIN` **no existe** en el código: no aparece ni en rutas, ni en guards, ni en el catálogo de roles. ✅

---

## 1 · Rutas del frontend por rol

`roleGuard(['ADMIN'])` **no significa «solo ADMINISTRADOR»**: el guard traduce `'ADMIN'` a `ADMINISTRADOR | ADMIN_BARBERIA | ADMIN` (variante heredada). Lo dejo explícito porque es la fuente de casi todas las discrepancias de esta tabla.

| Ruta | Guard(s) | ¿tenantGuard? | Roles que entran | Qué hace |
|---|---|---|---|---|
| `/auth/login` | — | No | Anónimo | Login |
| `/auth/register` | — | No | Anónimo | Registro (nace CLIENTE) |
| `/auth/verify` | — | No | Con token | Verificación OTP; se autoprotege |
| `''` (layout) | `authGuard` | — | Autenticados | Contenedor del panel |
| `''` (home) | `authGuard` | No | Autenticados | Dashboard por rol |
| `/barberias` | `authGuard` | No | Autenticados | Hub/selector de sede |
| `/unirse/:enlaceUnico` | `authGuard` | No | Autenticados | Alta de vínculo por enlace |
| `/barberias/nueva` | `roleGuard(['ADMIN'])` | No | ADMINISTRADOR, ADMIN_BARBERIA | Crear sede |
| `/reservas/nueva` | — | **Sí** | Cualquiera con sede activa | Wizard de reserva |
| `/reservar` | — | **Sí** | Cualquiera con sede activa | Alias de reserva |
| `/admin/agenda` | `roleGuard(['ADMIN','BARBERO'])` | **Sí** | ADMINISTRADOR, ADMIN_BARBERIA, BARBERO | Agenda de la sede |
| `/reservas/mis-reservas` | `authGuard` | No | Autenticados | Reservas propias (backend exige CLIENTE) |
| `/catalogo` | — | **Sí** | Cualquiera con sede activa | Catálogo público de la sede |
| `/admin/servicios` | `roleGuard(['ADMIN','BARBERO'])` | **Sí** | ADMINISTRADOR, ADMIN_BARBERIA, BARBERO | Catálogo de la sede |
| `/admin/horarios` | `roleGuard(['ADMIN'])` | **Sí** | ADMINISTRADOR, ADMIN_BARBERIA | Horarios y bloqueos |
| `/admin/propuestas-horario` | `roleGuard(['ADMIN_BARBERIA','ADMINISTRADOR'])` | **Sí** | ADMIN_BARBERIA, ADMINISTRADOR | Propuestas de hora de clientes |
| `/admin/personal` | `roleGuard(['ADMIN'])` | **Sí** | ADMINISTRADOR, ADMIN_BARBERIA | Equipo de la sede |
| `/admin/antecedentes` | `roleGuard(['ADMIN'])` | **Sí** | ADMINISTRADOR, ADMIN_BARBERIA | Antecedentes de clientes (huérfana en el menú) |
| `/admin/tickets` | `roleGuard(['ADMIN'])` | **Sí** | ADMINISTRADOR, ADMIN_BARBERIA | **Pagos**: caja, historial, anulaciones |
| `/admin/analiticas` | `roleGuard(['ADMIN'])` | **Sí** | ADMINISTRADOR, ADMIN_BARBERIA | Analíticas de la sede |
| `/admin/solicitudes-cambio` | `roleGuard(['ADMIN_BARBERIA','ADMINISTRADOR'])` | **Sí** | ADMIN_BARBERIA, ADMINISTRADOR | Solicitudes nombre/responsable |
| `/admin/clientes-restringidos` | `roleGuard(['ADMIN_BARBERIA','ADMINISTRADOR'])` | **Sí** | ADMIN_BARBERIA, ADMINISTRADOR | Clientes bloqueados por inasistencias |
| `/admin/vinculaciones` | `roleGuard(['ADMINISTRADOR'])` | **No** | ADMINISTRADOR | Aprobar/rechazar vínculos |
| `/admin/usuarios` | `roleGuard(['ADMINISTRADOR'])` | **No** | ADMINISTRADOR | Cuentas de la plataforma |
| `/barbero/horarios` | `roleGuard(['BARBERO'])` | **Sí** | BARBERO | Horario propio |
| `/admin/categorias` | `roleGuard(['ADMIN_BARBERIA'], {mensaje})` | **Sí** | ADMIN_BARBERIA | Taxonomía del catálogo |
| `/barbero/servicios` | `roleGuard(['BARBERO'])` | **Sí** | BARBERO | Servicios propios del barbero |
| `**` | — | — | — | Redirige a `''` |

**Rutas sin `roleGuard`** (las señaladas como «peligrosas» en el encargo): `/reservas/nueva`, `/reservar`, `/catalogo`, `/reservas/mis-reservas`, `/barberias`, `/unirse/:enlaceUnico`. Todas quedan detrás de `authGuard`/`tenantGuard`, y **el backend sí acota cada una por rol**, así que no hay fuga: son pantallas compartidas, no rutas abiertas.

**Observación de nomenclatura:** existe una ruta `/admin/tickets` que en el menú se llama **«Pagos»** y cuyo contenido es caja + historial de pagos + purga de auditoría. El nombre del path no describe la función.

---

## 2 · Endpoints del backend por rol

**Política global:** `JwtAuthGuard` + `RolesGuard` como `APP_GUARD`. Sin `@Public`, `@Autenticado` ni `@Roles`, el endpoint **falla cerrado** (403 «la ruta no declara su politica de acceso»)… **salvo para el ADMINISTRADOR global**, que pasa por bypass explícito en `RolesGuard`.

`@Autenticado()` = cualquier usuario con sesión, sin rol concreto.
`Guards extra` = segunda capa (`VinculoBarberiaGuard` exige pertenencia real; `OperadorBarberiaGuard` exige ser staff; `SoloBarberoGuard` exige rol BARBERO; `VerificacionGuard` exige teléfono verificado).

| Módulo | Método y ruta | Roles | Guards extra |
|---|---|---|---|
| Agenda | `GET /shops/:shopId/appointments/schedule/availability` | CLIENTE, BARBERO, ADMIN_BARBERIA, ADMINISTRADOR | - |
| Agenda | `POST /shops/:shopId/appointments/schedule/blocks` | ADMIN_BARBERIA, ADMINISTRADOR | - |
| Agenda | `GET /shops/:shopId/appointments/schedule/blocks` | ADMIN_BARBERIA, BARBERO | - |
| Agenda | `POST /shops/:shopId/appointments/schedule/blocks/:id/release` | ADMIN_BARBERIA, ADMINISTRADOR | - |
| Agenda | `POST /shops/:shopId/appointments/schedule/availability` | CLIENTE, BARBERO, ADMIN_BARBERIA, ADMINISTRADOR | - |
| Agenda | `GET /shops/:shopId/appointments/schedule/slots` | CLIENTE, ADMIN_BARBERIA, ADMINISTRADOR | - |
| Analíticas | `GET /shops/:shopId/analytics` | ADMINISTRADOR, ADMIN_BARBERIA | Jwt+Roles+Vinculo |
| Analíticas | `GET /shops/:shopId/analytics/export` | ADMINISTRADOR, ADMIN_BARBERIA | Jwt+Roles+Vinculo |
| Antecedentes | `POST /shops/:shopId/records` | BARBERO, ADMIN_BARBERIA, ADMINISTRADOR | - |
| Antecedentes | `PATCH /shops/:shopId/records/:id/evaluate` | ADMIN_BARBERIA, ADMINISTRADOR | - |
| Antecedentes | `GET /shops/:shopId/records/pending` | ADMIN_BARBERIA, ADMINISTRADOR | - |
| Antecedentes | `GET /shops/:shopId/records/client/:clientId` | ADMIN_BARBERIA, ADMINISTRADOR | - |
| Auditoría | `GET /auditoria/estadisticas` | ADMINISTRADOR | - |
| Auditoría | `GET /auditoria` | ADMINISTRADOR, ADMIN_BARBERIA | - |
| Auditoría | `POST /auditoria/purgar` | ADMINISTRADOR | - |
| Barberías y sedes | `POST /shops` | @Autenticado (cualquier rol) | - |
| Barberías y sedes | `POST /shops/link` | CLIENTE, ADMINISTRADOR | - |
| Barberías y sedes | `GET /shops` | @Autenticado (cualquier rol) | - |
| Barberías y sedes | `GET /shops/all` | ADMINISTRADOR | - |
| Barberías y sedes | `GET /shops/:shopId` | @Autenticado (cualquier rol) | - |
| Barberías y sedes | `GET /shops/overview` | ADMINISTRADOR, ADMIN_BARBERIA | - |
| Barberías y sedes | `GET /shops/:shopId/staff` | ADMIN_BARBERIA, BARBERO | - |
| Barberías y sedes | `POST /shops/:shopId/staff` | ADMIN_BARBERIA, ADMINISTRADOR | - |
| Barberías y sedes | `PATCH /shops/:shopId/staff/:userId` | ADMIN_BARBERIA, ADMINISTRADOR | - |
| Barberías y sedes | `GET /shops/:shopId` | @Autenticado (cualquier rol) | - |
| Barberías y sedes | `GET /shops/:shopId/change-requests` | ADMIN_BARBERIA, ADMINISTRADOR | - |
| Barberías y sedes | `POST /shops/:shopId/change-requests` | ADMIN_BARBERIA | - |
| Barberías y sedes | `GET /shops/:shopId/invitation` | ADMIN_BARBERIA, ADMINISTRADOR | - |
| Barberías y sedes | `PATCH /shops/:shopId/select` | CLIENTE, BARBERO, ADMIN_BARBERIA, ADMINISTRADOR | - |
| Barberías y sedes | `PATCH /shops/:shopId` | ADMIN_BARBERIA, ADMINISTRADOR | - |
| Barberías y sedes | `PATCH /shops/:shopId/status` | ADMINISTRADOR | - |
| Barberías y sedes | `GET /shops/:shopId/restricted-clients` | ADMIN_BARBERIA, ADMINISTRADOR | - |
| Barberías y sedes | `POST /shops/:shopId/restricted-clients/:clientId/reactivate` | ADMIN_BARBERIA, ADMINISTRADOR | - |
| Barberías y sedes | `GET /shops/:shopId/settings` | ADMIN_BARBERIA, ADMINISTRADOR | - |
| Barberías y sedes | `PATCH /shops/:shopId/settings` | ADMIN_BARBERIA, ADMINISTRADOR | - |
| Barberías y sedes | `GET /mi-estado/barberias` | CLIENTE | - |
| Barberías y sedes | `GET /mi-estado/membresias` | CLIENTE | - |
| Barberías y sedes | `POST /mi-estado/unirse` | CLIENTE | - |
| Barberías y sedes | `GET /shops/:shopId/membership` | CLIENTE | - |
| Barberías y sedes | `POST /shops/:shopId/membership/unlink` | CLIENTE | - |
| Barberías y sedes | `GET /plataforma/solicitudes-cambio` | ADMINISTRADOR | - |
| Barberías y sedes | `POST /plataforma/solicitudes-cambio/:id/resolver` | ADMINISTRADOR | - |
| Barberías y sedes | `GET /plataforma/vinculaciones/pendientes` | ADMINISTRADOR | - |
| Barberías y sedes | `POST /plataforma/vinculaciones/:id/aprobar` | ADMINISTRADOR | - |
| Barberías y sedes | `POST /plataforma/vinculaciones/:id/rechazar` | ADMINISTRADOR | - |
| Caja | `GET /caja/hoy` | ADMIN_BARBERIA, ADMINISTRADOR | - |
| Caja | `POST /caja/cierre` | ADMIN_BARBERIA, ADMINISTRADOR | - |
| Catálogo | `POST /shops/:shopId/categorias` | ADMIN_BARBERIA | OperadorBarberiaGuard, VinculoBarberiaGuard |
| Catálogo | `GET /shops/:shopId/categorias` | ADMIN_BARBERIA, BARBERO | VinculoBarberiaGuard |
| Catálogo | `PATCH /shops/:shopId/categorias/:id` | ADMIN_BARBERIA | OperadorBarberiaGuard, VinculoBarberiaGuard |
| Catálogo | `POST /shops/:shopId/combos` | BARBERO, ADMIN_BARBERIA | OperadorBarberiaGuard, VinculoBarberiaGuard |
| Catálogo | `GET /shops/:shopId/combos` | ADMIN_BARBERIA, BARBERO, CLIENTE, ADMINISTRADOR | VinculoBarberiaGuard |
| Catálogo | `GET /shops/:shopId/combos/:id` | ADMIN_BARBERIA, BARBERO, CLIENTE, ADMINISTRADOR | VinculoBarberiaGuard |
| Catálogo | `PATCH /shops/:shopId/combos/:id` | BARBERO, ADMIN_BARBERIA | OperadorBarberiaGuard, VinculoBarberiaGuard |
| Catálogo | `PATCH /shops/:shopId/combos/:id/deactivate` | BARBERO, ADMIN_BARBERIA | OperadorBarberiaGuard, VinculoBarberiaGuard |
| Catálogo | `PATCH /shops/:shopId/combos/:id/reactivate` | BARBERO, ADMIN_BARBERIA | OperadorBarberiaGuard, VinculoBarberiaGuard |
| Catálogo | `GET /shops/:shopId/servicios` | CLIENTE, BARBERO, ADMIN_BARBERIA, ADMINISTRADOR | VinculoBarberiaGuard |
| Catálogo | `POST /shops/:shopId/mis-servicios` | BARBERO | SoloBarberoGuard, VinculoBarberiaGuard |
| Catálogo | `GET /shops/:shopId/mis-servicios` | BARBERO | SoloBarberoGuard, VinculoBarberiaGuard |
| Catálogo | `PATCH /shops/:shopId/mis-servicios/:id` | BARBERO | SoloBarberoGuard, VinculoBarberiaGuard |
| Catálogo | `POST /shops/:shopId/services` | BARBERO, ADMIN_BARBERIA | OperadorBarberiaGuard, VinculoBarberiaGuard |
| Catálogo | `GET /shops/:shopId/services` | ADMIN_BARBERIA, BARBERO, CLIENTE, ADMINISTRADOR | VinculoBarberiaGuard |
| Catálogo | `GET /shops/:shopId/services/:id` | ADMIN_BARBERIA, BARBERO, CLIENTE, ADMINISTRADOR | VinculoBarberiaGuard |
| Catálogo | `PATCH /shops/:shopId/services/:id` | BARBERO, ADMIN_BARBERIA | OperadorBarberiaGuard, VinculoBarberiaGuard |
| Catálogo | `PATCH /shops/:shopId/services/:id/deactivate` | BARBERO, ADMIN_BARBERIA | OperadorBarberiaGuard, VinculoBarberiaGuard |
| Catálogo | `PATCH /shops/:shopId/services/:id/reactivate` | BARBERO, ADMIN_BARBERIA | OperadorBarberiaGuard, VinculoBarberiaGuard |
| Clientes (staff) | `GET /shops/:shopId/clients/:id/profile` | BARBERO, ADMIN_BARBERIA | - |
| Clientes (staff) | `POST /shops/:shopId/clients/:id/notes` | BARBERO, ADMIN_BARBERIA | - |
| Horarios | `GET /shops/:shopId/mi-horario` | BARBERO | VinculoBarberiaGuard |
| Horarios | `PUT /shops/:shopId/mi-horario` | BARBERO | VinculoBarberiaGuard |
| Horarios | `GET /shops/:shopId/mi-horario/base` | BARBERO | VinculoBarberiaGuard |
| Horarios | `PUT /shops/:shopId/mi-horario/base` | BARBERO | VinculoBarberiaGuard |
| Horarios | `GET /shops/:shopId/hours` | BARBERO, ADMIN_BARBERIA, ADMINISTRADOR | - |
| Horarios | `POST /shops/:shopId/hours` | ADMIN_BARBERIA, ADMINISTRADOR | - |
| Horarios | `GET /shops/:shopId/hours/exceptions` | BARBERO, ADMIN_BARBERIA, ADMINISTRADOR | - |
| Horarios | `POST /shops/:shopId/hours/exceptions` | ADMIN_BARBERIA, ADMINISTRADOR | - |
| Horarios | `GET /shops/:shopId/hours/mine` | BARBERO | - |
| Horarios | `POST /shops/:shopId/hours/mine` | BARBERO | - |
| Horarios | `POST /shops/:shopId/hours/barbers/:barberoId/exceptions` | BARBERO, ADMIN_BARBERIA, ADMINISTRADOR | - |
| Identidad y cuentas | `POST /auth/register` | @Public | - |
| Identidad y cuentas | `POST /auth/login` | @Public | - |
| Identidad y cuentas | `GET /auth/me` | - | - |
| Identidad y cuentas | `POST /auth/send-otp` | - | - |
| Identidad y cuentas | `POST /auth/verify-otp` | - | - |
| Identidad y cuentas | `POST /auth/forgot-password` | @Public | - |
| Identidad y cuentas | `POST /auth/reset-password` | @Public | - |
| Identidad y cuentas | `PATCH /plataforma/usuarios/:id/estado` | ADMINISTRADOR | - |
| Identidad y cuentas | `GET /plataforma/usuarios` | ADMINISTRADOR | JwtAuthGuard, RolesGuard |
| Identidad y cuentas | `POST /plataforma/usuarios` | ADMINISTRADOR | JwtAuthGuard, RolesGuard |
| Identidad y cuentas | `GET /plataforma/usuarios/:id/roles` | ADMINISTRADOR | JwtAuthGuard, RolesGuard |
| Identidad y cuentas | `PATCH /plataforma/usuarios/:id/administrador` | ADMINISTRADOR | - |
| Identidad y cuentas | `GET /plataforma/usuarios/:id/auditoria` | ADMINISTRADOR | JwtAuthGuard, RolesGuard |
| Lista de espera | `POST /lista-espera` | CLIENTE | VerificacionGuard+Verificación |
| Notificaciones | `GET /notificaciones/mis-notificaciones` | @Autenticado (cualquier rol) | - |
| Webhooks | `POST /webhooks/whatsapp` | @Public | - |
| Pagos | `POST /pagos/cobrar` | BARBERO, ADMIN_BARBERIA, ADMINISTRADOR | - |
| Pagos | `POST /shops/:shopId/payments` | BARBERO, ADMIN_BARBERIA, ADMINISTRADOR | - |
| Pagos | `GET /shops/:shopId/payments/history` | ADMIN_BARBERIA, ADMINISTRADOR | - |
| Pagos | `POST /shops/:shopId/payments/:id/void` | ADMIN_BARBERIA, ADMINISTRADOR | - |
| Pagos | `GET /shops/:shopId/payments/audit` | ADMIN_BARBERIA, ADMINISTRADOR | - |
| Reservas | `PATCH /reservas/:id/asignar-barbero` | ADMIN_BARBERIA, ADMINISTRADOR | - |
| Reservas | `GET /shops/:shopId/appointments/day` | ADMIN_BARBERIA, BARBERO, ADMINISTRADOR | - |
| Reservas | `GET /shops/:shopId/appointments/mine` | CLIENTE | - |
| Reservas | `POST /shops/:shopId/appointments` | CLIENTE | VerificacionGuard+Verificación |
| Reservas | `POST /shops/:shopId/appointments/walk-in` | BARBERO, ADMIN_BARBERIA, ADMINISTRADOR | - |
| Reservas | `POST /shops/:shopId/appointments/walk-in-pago` | ADMIN_BARBERIA, ADMINISTRADOR | - |
| Reservas | `POST /shops/:shopId/appointments/quote` | CLIENTE, BARBERO, ADMIN_BARBERIA, ADMINISTRADOR | - |
| Reservas | `POST /shops/:shopId/appointments/:id/accept` | ADMIN_BARBERIA, ADMINISTRADOR | - |
| Reservas | `POST /shops/:shopId/appointments/:id/reject` | ADMIN_BARBERIA, ADMINISTRADOR | - |
| Reservas | `POST /shops/:shopId/appointments/:id/cancel` | CLIENTE, ADMIN_BARBERIA, ADMINISTRADOR | - |
| Reservas | `PATCH /shops/:shopId/appointments/:id/reschedule` | ADMIN_BARBERIA, ADMINISTRADOR | - |
| Reservas | `POST /shops/:shopId/appointments/:id/special-cancellation` | ADMIN_BARBERIA, ADMINISTRADOR | - |
| Reservas | `POST /shops/:shopId/appointments/:id/propose-time` | CLIENTE | - |
| Reservas | `POST /shops/:shopId/appointments/:id/proposed-time/accept` | ADMIN_BARBERIA, ADMINISTRADOR | - |
| Reservas | `POST /shops/:shopId/appointments/:id/proposed-time/reject` | ADMIN_BARBERIA, ADMINISTRADOR | - |
| Reservas | `GET /shops/:shopId/appointments/proposals/pending` | ADMIN_BARBERIA, ADMINISTRADOR | - |
| Reservas | `GET /shops/:shopId/appointments/:id` | ADMIN_BARBERIA, BARBERO, CLIENTE | - |
| Reservas | `POST /shops/:shopId/appointments/:id/no-show` | ADMIN_BARBERIA, ADMINISTRADOR | - |

### Notas de lectura de la tabla

- **`ADMINISTRADOR` atraviesa cualquier `@Roles`.** `RolesGuard.canActivate` hace `if (esAdministradorGlobal(user)) return true;` **antes** de evaluar los roles pedidos. Por eso el admin puede *llegar* a endpoints de BARBERO/ADMIN_BARBERIA; lo que lo frena después son los guards y las comprobaciones del servicio (D16 para catálogo, por ejemplo).
- **`GET /shops`, `POST /shops` y `GET /shops/:shopId` son `@Autenticado()`**: cualquier usuario con sesión, **incluido CLIENTE**, crea una sede y queda como ADMIN_BARBERIA de ella (D04). La respuesta de `GET /shops/:shopId` oculta `codigoAcceso`/`enlaceUnico` salvo al ADMIN_BARBERIA de esa sede y al ADMINISTRADOR.
- **`GET /shops/:shopId/appointments/day` admite BARBERO y devuelve el día COMPLETO de la sede**; el recorte a «solo mi columna» ocurre en el frontend (§5, L5).
- **`/shops/:shopId/clients/:id/profile` y `/notes` admiten BARBERO**: un barbero lee la ficha y escribe notas de **cualquier** cliente de la sede, no solo de los suyos.

---

## 3 · Recorrido completo de cada rol

### ADMINISTRADOR (global)

- **Al entrar**: `AuthService` lo manda a `/admin/usuarios` (verificado en navegador). No hereda sede: el hub no lo autoselecciona (`cargarBarberias({ autoSeleccionar: !esSuperadmin() })`).
- **Operar sin sede**: puede ver Usuarios, Vinculaciones y su propio hub sin sede activa. **No** puede entrar a `/admin/agenda` sin elegir sede: `tenantGuard` lo devuelve a `/barberias`.
- **Ver sin poder modificar**: catálogo completo de cualquier sede (servicios, combos, categorías), con precios — pero toda escritura de catálogo responde **403 D16** («El catálogo lo gestionan el BARBERO y el ADMIN_BARBERIA de la sede»). *Verificado en navegador.*
- **Modificar de otras sedes**: sí en lo de plataforma — suspender/reactivar sede (`PATCH /shops/:id/status`), editar datos de sede (`PATCH /shops/:id`), invitar personal, cambiar estado de cualquier cuenta, resolver solicitudes y vinculaciones.
- **¿Menos acceso que ADMIN_BARBERIA?** **Sí, en catálogo** (L1). El rol más alto no puede crear ni editar un servicio; el dueño de la sede sí.

### ADMIN_BARBERIA (una sede, D06)

- **Ve**: su sede, su personal, su catálogo, su caja y sus analíticas. No ve otras sedes en `/shops` (el servicio filtra por `responsableId` **o** `usuario_roles` de esa sede).
- **¿Toca datos de otra sede?** Por API, no: los endpoints con `:shopId` pasan por `VinculoBarberiaGuard` (pertenencia real contra `usuario_roles`/`cliente_barberias`) y los que no lo llevan resuelven la sede en el servicio con la misma comprobación. Sin embargo, **`GET /shops/:shopId` es `@Autenticado` y devuelve la ficha de cualquier sede** (sin código de acceso): es lectura cross-tenant deliberada (decisión 3).
- **Ruta de ADMINISTRADOR por URL directa** (`/admin/usuarios`): `roleGuard` la expulsa. **Y el backend también**: `@Roles('ADMINISTRADOR')`. Las dos capas coinciden.
- **¿Quién bloquea?** El backend, siempre. Los endpoints de catálogo, personal, caja, pagos y agenda llevan `@Roles` propio; el frontend solo evita el viaje.
- **¿Más de una sede?** El modelo lo permite (`usuario_roles` es N:M y `MAX_BARBERIAS_POR_RESPONSABLE = 2` para el creador), pero **V1 asume una**: el hub no ofrece crear una segunda y el menú oculta «Sedes y Equipo» (`*ngIf="userRole() !== 'ADMINISTRADOR'"`). Un ADMIN_BARBERIA con dos sedes por API vería las dos tarjetas y podría alternar — no está impedido, solo no está diseñado.

### BARBERO (vista limitada, D16)

- **Qué ve en su agenda**: en pantalla, **solo su columna**. `puedeVerTodoElEquipo` (línea 627 de `admin-agenda.component.ts`) devuelve `false` cuando el usuario tiene BARBERO y no tiene ADMIN_BARBERIA/ADMINISTRADOR.
- **Lo que realmente recibe del backend**: **toda la agenda de la sede**. `GET /shops/:shopId/appointments/day` no filtra por barbero; el recorte es de presentación. **Hallazgo L5.**
- **Seleccionar su sede y navegar**: funciona. Verificado en navegador con sesión BARBERO real: hub → «Entrar» → `/admin/agenda`. El bug histórico del botón que no navegaba está corregido (T-06, commits `234af90`/`942e889`).
- **¿Información de clientes que no son suyos?** Sí: `GET /shops/:shopId/clients/:id/profile` y `POST .../notes` admiten `BARBERO` sin comprobar que ese cliente tenga cita con él. `VinculoBarberiaGuard` solo valida pertenencia a la sede.
- **¿Cancelar o modificar reservas?** **No.** `POST /appointments/:id/cancel` es `CLIENTE, ADMIN_BARBERIA, ADMINISTRADOR`; reprogramar, aceptar, rechazar, inasistencia y propuestas son de ADMIN_BARBERIA/ADMINISTRADOR. Un BARBERO con un 403 en `/admin/agenda` al intentar gestionar una cita es el comportamiento diseñado.
- **`/admin/usuarios` por URL**: `roleGuard` lo saca y, como su token incluye BARBERO, lo devuelve a `/admin/agenda` (rama H24 del guard). Con mensaje solo si la ruta lo declara; esta no.

### CLIENTE

- **¿Reservas o datos de otro cliente?** No por API: `GET /appointments/mine` filtra por el token; `GET /appointments/:id` exige pertenencia en el servicio; `clientes/:id/profile` es de staff.
- **¿Catálogo de una sede a la que no está vinculado?** `GET /shops/:shopId/services|combos|servicios` llevan `VinculoBarberiaGuard` → 403 si no hay vínculo ACTIVO. **Cerrado** (es el agujero que E1-06 documenta haber tapado).
- **¿Reservar sin vínculo?** **No.** `crearReserva` comprueba `cliente_barberias` dentro de la transacción y responde **403 `NO_VINCULADO`**. El hallazgo previo («se podía reservar sin vínculo») **ya no se reproduce**. Lo confirmé leyendo `reserva.service.ts` (líneas ~710-725) y creando el caso opuesto: el walk-in del staff fallaba justamente por esa misma comprobación (corregido en `942e889`).
- **Registro → OTP**: `verify-otp.component.ts` tiene **reenvío con cuenta atrás** («Reenviar en N s» / «Reenviar código»), así que **no hay callejón sin salida en la UI**. Lo que sí falló en la auditoría de producción fue el envío real del código (proveedor), no el flujo: sin proveedor configurado, el usuario queda esperando un código que nunca llega.

---

## 4 · Casos cruzados

**1 · ¿Un ADMIN_BARBERIA ve todas las sedes o solo la suya?**
Solo la suya. `GET /shops` → `findAllByResponsable` filtra por `responsableId` **o** fila `usuario_roles` de esa sede; `GET /shops/all` es `@Roles('ADMINISTRADOR')`. **No hay fuga.** ✅

**2 · ¿Un BARBERO de la Sede A ve algo de la Sede B?**
Con `:shopId` de B, `VinculoBarberiaGuard` responde 403 «No estás vinculado a esta barbería». Los endpoints sin `:shopId` resuelven la sede por el token/servicio. **Cerrado**, salvo el caso L4 (identidad mixta) que es de visibilidad, no de datos.

**3 · ¿Qué rol puede suspender a un ADMINISTRADOR?**
Solo otro ADMINISTRADOR. `PATCH /plataforma/usuarios/:id/estado` y `/:id/administrador` son `@Roles('ADMINISTRADOR')`, y `PATCH /shops/:id/status` (suspender sede) también. **No hay camino** para que un ADMIN_BARBERIA toque una cuenta de plataforma: no tiene la ruta y el backend la cierra. ✅
*Matiz:* el ADMINISTRADOR sí puede degradar a otro ADMINISTRADOR (`/:id/administrador`) sin segunda aprobación. No hay «dos llaves» para el rol más alto.

**4 · ¿Coinciden guard del frontend y guard del backend?**
Coinciden en casi todo, con **tres desajustes reales**:
- `/admin/servicios`: el frontend admite ADMINISTRADOR; el backend **le prohíbe escribir** (D16). → **botón que siempre falla** (L1/L10).
- `/admin/antecedentes`: ruta viva, backend vivo… y **no aparece en ningún menú**. Pantalla huérfana (L12).
- `/admin/tickets`: el path dice «tickets», la pantalla es «Pagos» y contiene una acción (purgar auditoría) que solo el ADMINISTRADOR puede ejecutar, correctamente oculta por rol en el componente (`roles.includes('ADMINISTRADOR')`). Coherente, pero la pantalla mezcla dos audiencias.

**5 · Usuario con MÚLTIPLES roles (ADMIN_BARBERIA en A, CLIENTE en B)**
**Se maneja mal.** `rolEfectivo` toma el rol más alto y el layout pinta **un solo menú** (el de staff). Peor: en `/shops`, la rama del cliente está condicionada a `if (!esStaff && tieneRol('CLIENTE'))` — **un usuario que es staff en cualquier sede nunca recibe sus sedes de cliente**. Es decir: el barbero que también es cliente de otra barbería **no puede llegar a ella desde el hub**. **Hallazgo L4.**

---

## 5 · Errores lógicos (diseño, no sintaxis)

### L1 · LÓGICA CUESTIONABLE: el rol más alto no puede gestionar el catálogo, pero la UI le ofrece hacerlo

**Lo que pasa hoy:** el menú del ADMINISTRADOR incluye «Servicios — Catálogo, combos y precios» (`app-layout.component.ts`, bloque `userRole() === 'ADMINISTRADOR'`), la ruta `/admin/servicios` lo admite (`roleGuard(['ADMIN','BARBERO'])`) y el panel muestra «Nuevo Servicio» con formulario completo. Al guardar: **403** `«El catálogo lo gestionan el BARBERO y el ADMIN_BARBERIA de la sede: el ADMINISTRADOR global y el CLIENTE solo pueden consultarlo.»` *Verificado en navegador.*
**Por qué no tiene sentido:** el rol jerárquicamente superior tiene **menos** capacidad de acción que el dueño de la sede en una tarea que la propia UI le presenta como suya. No es un bug de permisos: son dos decisiones (D16 y el menú) que se contradicen.
**Backlog:** D16 (catálogo operado por la sede) y D05 (admin transversal de solo lectura).
**Impacto:** Confusión de UX + acción visible que el backend nunca aceptará.
**¿Intencional?** El read-only es intencional (comentario «solo lectura en catálogo, usuarios, auditoría y aprobaciones»), pero la pantalla de escritura no se adaptó.

### L2 · LÓGICA CUESTIONABLE: el `RolesGuard` deja pasar al ADMINISTRADOR por cualquier `@Roles`

**Lo que pasa hoy:** `roles.guard.ts` ejecuta `if (esAdministradorGlobal(user)) return true;` **antes** de evaluar los roles exigidos. El admin atraviesa también rutas de BARBERO (`/mis-servicios`, `/mi-horario`).
**Por qué no tiene sentido:** la autorización efectiva queda repartida entre el guard (que dice sí) y cada servicio (que puede decir no). Es exactamente el patrón que produce L1 y hace imposible razonar los permisos leyendo solo el decorador.
**Backlog:** D05 (transversal) frente al principio 7 (fail-closed).
**Impacto:** Riesgo de seguridad latente: cualquier endpoint nuevo que confíe **solo** en su `@Roles` se abre al global por diseño.
**¿Intencional?** Sí (comentario E1-04), pero el efecto secundario no está documentado en el backlog.

### L3 · LÓGICA CUESTIONABLE: el hub del staff muestra sedes suspendidas que llevan a un 403

**Lo que pasa hoy:** `findAllByResponsable` filtra `estado: 'ACTIVO'` para el ADMINISTRADOR y para el CLIENTE (`barberia: { estado: 'ACTIVO' }`), pero **la rama del staff no filtra por estado**: devuelve la sede suspendida con su tarjeta y su botón «Entrar». Al entrar, `VinculoBarberiaGuard` responde 403 «La barbería está suspendida…» en cada pantalla.
**Por qué no tiene sentido:** el mismo endpoint aplica tres criterios distintos de visibilidad según el rol, y el criterio más laxo es el del personal, que es quien menos puede hacer con una sede apagada.
**Impacto:** UX rota (callejón sin salida) y soporte: «mi barbería desapareció / no me deja entrar».
**¿Intencional?** No parece: el comentario del código solo justifica el caso del ADMINISTRADOR.

### L4 · LÓGICA CUESTIONABLE: un staff que también es cliente no ve sus vínculos

**Lo que pasa hoy:** `if (!esStaff && tieneRol('CLIENTE'))` (barberia.service.ts). Si el usuario tiene cualquier rol de staff, la consulta de `cliente_barberias` **no se ejecuta**; sus sedes de cliente no llegan al hub.
**Por qué no tiene sentido:** una persona puede cortarse el pelo en la barbería donde trabaja… o en otra. El modelo de datos lo soporta (N:M), la pantalla no.
**Impacto:** Dato invisible para el usuario; funciones de cliente (reservar, mis citas) inalcanzables desde el hub.
**¿Intencional?** Es una decisión de implementación (H72) sin rastro en el backlog.

### L5 · LÓGICA CUESTIONABLE: el BARBERO recibe toda la agenda y las fichas de cualquier cliente

**Lo que pasa hoy:** `GET /shops/:shopId/appointments/day` es `@Roles('ADMIN_BARBERIA','BARBERO','ADMINISTRADOR')` y devuelve el día completo. El filtro «solo mi columna» está en el componente (`puedeVerTodoElEquipo`). Igual con `clients/:id/profile` y `notes`: admiten BARBERO sin comprobar relación con el cliente.
**Por qué no tiene sentido:** D16 dice «vista limitada» del barbero. Ocultar en el navegador no limita nada: con la URL o con Postman, el barbero obtiene nombres, teléfonos y notas de todo el día y de cualquier cliente de la sede.
**Backlog:** D16.
**Impacto:** **Riesgo de seguridad / privacidad** (dato personal cross-barbero).
**¿Intencional?** El comentario de la agenda dice que el backend filtra por barbero «porque `turnosPorBarbero` filtra por `turno.barbero.id`» — eso describe el frontend, no el backend.

### L6 · LÓGICA CUESTIONABLE: cualquier CLIENTE puede crear una barbería

**Lo que pasa hoy:** `POST /shops` es `@Autenticado()` (con `@Throttle` 5/min). Un CLIENTE crea una sede y el servicio le asigna ADMIN_BARBERIA en ella.
**Por qué no tiene sentido:** choca con el embudo del producto (el registro nace CLIENTE) y con la idea de que administrar sedes es una capacidad concedida. Además el límite de 2 sedes solo aplica a quien no es admin global.
**Backlog:** D04 lo autoriza explícitamente.
**Impacto:** Otro (decisión de producto) + superficie de abuso (creación masiva de sedes con datos basura).
**¿Intencional?** **Sí**, es D04. Se documenta porque sorprende a cualquiera que lea el sistema por primera vez.

### L7 · LÓGICA CUESTIONABLE: fail-closed con una excepción fail-open

**Lo que pasa hoy:** una ruta sin `@Public`/`@Autenticado`/`@Roles` responde 403… **excepto si el usuario es ADMINISTRADOR**, que pasa.
**Por qué no tiene sentido:** el principio 7 del backlog es fail-closed. Aquí lo es para todos menos para el rol más poderoso, que es justo el que más daño puede causar si una política se olvida.
**Impacto:** Riesgo de seguridad + deuda invisible (el olvido no falla en CI ni en los tests del admin).
**¿Intencional?** Sí (comentario E1-04). Recomendación: prohibir el bypass y exigir política explícita en toda ruta nueva (un test que recorra los controladores ya existe en `test/route-security.spec.ts`).

### L8 · LÓGICA CUESTIONABLE: la única mutación que no devuelve la entidad

**Lo que pasa hoy:** `PATCH /shops/:shopId/status` responde **200 sin cuerpo**; el resto de mutaciones devuelven el recurso actualizado. *Verificado en navegador.*
**Por qué no tiene sentido:** obliga al cliente a creer su propio payload; el frontend quedó con el estado viejo hasta que escribí el valor a mano (fue un bug real, `33d31d3`).
**Impacto:** Dato incorrecto en la UI si el backend normaliza algo.
**¿Intencional?** No parece; es un `@HttpCode(200)` sin `return`.

### L9 · LÓGICA CUESTIONABLE: dos pantallas para la misma tarea con criterios distintos

**Lo que pasa hoy:** `/admin/categorias` exige `ADMIN_BARBERIA` estricto (T-29, con toast explicativo); `/admin/servicios` admite ADMINISTRADOR, que no puede escribir. Ambas son «el catálogo de la sede» y viven en el mismo desplegable.
**Por qué no tiene sentido:** el criterio de acceso a dos mitades de la misma tarea es distinto.
**Impacto:** Confusión de UX.
**¿Intencional?** La restricción de categorías es reciente (T-29) y la de servicios quedó sin actualizar.

### L10 · LÓGICA CUESTIONABLE: pantalla viva sin entrada en el menú

**Lo que pasa hoy:** `/admin/antecedentes` existe, tiene guard, componente y cuatro endpoints (`records`) con roles propios… y **no aparece en el menú lateral** de ningún rol.
**Por qué no tiene sentido:** funcionalidad completa e inalcanzable por navegación (solo por URL).
**Impacto:** Confusión / funcionalidad fantasma.
**¿Intencional?** No lo parece; puede ser un resto de una reorganización del menú.

### L11 · LÓGICA CUESTIONABLE: dos definiciones del rol y un rol inexistente

**Lo que pasa hoy:** el frontend usa `'ADMIN'` como alias de tres roles en `roleGuard`; el backend **no conoce `'ADMIN'`** (el propio `cliente.controller.ts` documenta que no existe en el catálogo y que usarlo dejaba fuera al ADMIN_BARBERIA). Además `rolEfectivo` (frontend) y `RolesGuard` (backend) derivan el rol por su cuenta.
**Por qué no tiene sentido:** la misma pregunta («¿qué rol es este usuario?») tiene dos implementaciones y un valor mágico que solo existe en una capa.
**Impacto:** Riesgo de seguridad (si alguien escribe `@Roles('ADMIN')` en el backend, **nadie** pasa) + mantenimiento.

### L12 · LÓGICA CUESTIONABLE: nombre de ruta que no corresponde

**Lo que pasa hoy:** `/admin/tickets` muestra **Pagos**; su acción de mantenimiento (purgar auditoría) es de ADMINISTRADOR y convive en la pantalla que usa ADMIN_BARBERIA.
**Por qué no tiene sentido:** el path, el menú y el contenido dicen tres cosas distintas; y mezcla una operación de plataforma dentro de una pantalla de sede.
**Impacto:** Confusión + riesgo operativo (una purga global en un contexto local).
**¿Intencional?** Heredado; la acción sí está bien oculta por rol.

---

## 6 · Diagrama de acceso

```mermaid
graph TD
    A[ADMINISTRADOR] -->|Ve| A1[Todas las sedes /shops/all]
    A -->|Ve| A2[Todos los usuarios y auditoría]
    A -->|Ve| A3[Analíticas y catálogo de cualquier sede (solo lectura)]
    A -->|Modifica| A4[Sedes: datos, suspender/reactivar]
    A -->|Modifica| A5[Cuentas: estado, rol administrador]
    A -->|Modifica| A6[Vinculaciones y solicitudes]
    A -.->|NO puede| A7[Escribir catálogo (D16) aunque la UI lo ofrezca]
    A -.->|NO puede| A8[Operar agenda sin sede activa]

    B[ADMIN_BARBERIA] -->|Ve| B1[Su sede, su equipo, su catálogo]
    B -->|Modifica| B2[Catálogo, horarios, personal, caja, pagos]
    B -->|Modifica| B3[Agenda: aceptar, rechazar, reprogramar, inasistencia]
    B -.->|NO puede| B4[Otras sedes ni otros equipos]
    B -.->|NO puede| B5[Cuentas de plataforma]

    C[BARBERO] -->|Ve| C1[Su columna de agenda (frontend)]
    C -->|Modifica| C2[Sus servicios y su horario]
    C -.->|NO puede| C3[Cancelar, reprogramar ni aceptar reservas]
    C -.->|NO puede| C4[Catálogo de la sede ni caja]
    C -.->|RECIBE igual| C5[Toda la agenda de la sede por API]

    D[CLIENTE] -->|Ve| D1[Catálogo de sus sedes vinculadas]
    D -->|Ve| D2[Sus propias reservas]
    D -->|Modifica| D3[Sus reservas dentro de reglas y su perfil]
    D -->|Crea| D4[Barbería propia (D04) y queda ADMIN_BARBERIA]
    D -.->|NO puede| D5[Otros clientes ni catálogo sin vínculo]
```

Árbol resumido:

```
ADMINISTRADOR
  ├── Ve: todas las sedes, todos los usuarios, auditoría, analíticas, catálogo (lectura)
  ├── Modifica: sedes (datos/estado), cuentas, vinculaciones, solicitudes
  └── NO puede: escribir catálogo (D16), operar agenda sin sede activa
ADMIN_BARBERIA
  ├── Ve: su sede, su equipo, su catálogo, su caja/analíticas
  ├── Modifica: catálogo, horarios, personal, pagos, toda la agenda
  └── NO puede: otras sedes, cuentas de plataforma, purgas globales
BARBERO
  ├── Ve: su columna de agenda; por API, toda la agenda y fichas de clientes
  ├── Modifica: sus servicios, su horario
  └── NO puede: gestionar reservas, catálogo de sede, caja
CLIENTE
  ├── Ve: catálogo de sus sedes, sus reservas
  ├── Modifica: sus reservas y su perfil; puede crear su propia barbería (D04)
  └── NO puede: ver a otros clientes, reservar sin vínculo
```

---

## 7 · Resumen de una página: los 5 hallazgos más graves

1. **Un BARBERO recibe toda la agenda y las fichas de cualquier cliente (L5).** El recorte es cosmético: `GET /appointments/day` y `clients/:id/profile` no filtran por barbero. Es una exposición de datos personales (nombre, teléfono, notas) a un rol que D16 define como «vista limitada». **Riesgo: seguridad/privacidad.**
2. **El ADMINISTRADOR atraviesa cualquier `@Roles` y el fail-closed tiene su excepción (L2, L7).** La autorización real está repartida entre guard y servicio; una ruta nueva con `@Roles` hereda un bypass silencioso. **Riesgo: seguridad latente + deuda invisible.**
3. **El hub del staff muestra sedes suspendidas que no llevan a ninguna parte (L3).** Tres criterios distintos de visibilidad en el mismo `GET /shops`; la variante del personal conduce a un 403 en todas las pantallas. **Riesgo: UX rota y soporte.**
4. **El rol más alto es invitado a escribir lo que el backend le prohíbe (L1, L9).** Menú y pantalla ofrecen crear servicios; el 403 es de negocio (D16) y llega tras rellenar el formulario. **Riesgo: confusión y pérdida de confianza en la UI.**
5. **Un staff que también es cliente no ve sus vínculos (L4).** El hub no puede representar identidades mixtas: la rama del cliente se desactiva en cuanto hay un rol de staff. **Riesgo: funcionalidad inalcanzable.**

**Lo que está bien y conviene no tocar:** el aislamiento entre sedes para ADMIN_BARBERIA (contrato + `VinculoBarberiaGuard`), la imposibilidad de reservar sin vínculo, la protección del CLIENTE frente a datos de otros clientes, y la verificación global fail-closed (`JwtAuthGuard` en `APP_GUARD` con `@Public` explícito).

---

*Documento generado el 2026-11-13 sobre la rama `fix/sprint-resto`. Las tablas provienen del código; los puntos marcados «verificado en navegador» se ejercitaron contra el preview del PR #138 con datos de producción QA.*
