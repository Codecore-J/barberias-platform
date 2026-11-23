# Mapa rutas → acciones de la matriz objetivo

> **Documento de revisión.** No cambia código. Propone, para cada una de las **123 rutas**
> del backend, qué acción de `docs/MATRIZ_PERMISOS_OBJETIVO.md` le corresponde, o
> `sin acción` si la matriz no la cubre. Lo revisa el dueño antes de tocar controladores.

## 1 · Cómo se construyó

- **Fuente de las rutas:** `backend-barberias/test/permisos-matriz.spec.ts`, constante
  `POLITICA_DECLARADA`. Ese diccionario es hoy el inventario cerrado de rutas: el test
  falla si el servidor descubre una ruta que no esté ahí, y también si sobra una clave.
  Hoy tiene **123 claves** y el test exige **492 evaluaciones** (123 × 4 roles).
- **Fuente de las acciones:** `docs/MATRIZ_PERMISOS_OBJETIVO.md` (PR #172). Los **21
  identificadores vigentes se usan tal cual**, sin renombrar ni derivar; las **nueve altas**
  de §7 están ya escritas en esa matriz (marcadas con †), pendientes de aprobación.
- **La propuesta no ajusta la matriz.** Donde la matriz no tiene acción, la fila dice
  `sin acción`; si la operación es de sede o plataforma, §6 propone un rol y, cuando ningún
  identificador vigente la cubre, una acción nueva en §7. Las nueve altas están ya escritas
  en la matriz como pendientes (†); siguen necesitando la aprobación explícita del dueño.

### Leyenda de la columna «Propuesta»

| Valor | Significado |
|---|---|
| `acción` | La matriz tiene una acción que cubre la operación. Ese es el permiso que debe imponer la ruta. |
| `acción` + nota | La matriz cubre la operación en lo esencial, pero hay un matiz (lectura, escritura o alcance) que la matriz no distingue. |
| `acción nueva` (propuesta) | La matriz no tiene acción y se propone una. **No está en la matriz**: requiere la aprobación del dueño (§7). |
| `sin acción` + nota | La matriz no tiene acción para esta ruta. Se propone dejarla fuera de la matriz (identidad, autoservicio, vitrina, integración) **o** se señala como **brecha** si es una operación de sede/plataforma que la matriz debería cubrir. |

## 2 · Resumen

| Categoría | Rutas |
|---|:-:|
| Con acción de la matriz (directa o con matiz) | 69 |
| `sin acción` — fuera del alcance de la matriz (identidad, autoservicio, vitrina, integración) | 41 |
| `sin acción` — **brecha**: operación que la matriz debería cubrir y no cubre | 13 |
| **Total** | **123** |

Las 69 con acción incluyen la ruta 72: la matriz vigente le da `cita.estado.marcar` a la sede
y al barbero, y el dueño aprobó que el CLIENTE que cancela lo suyo use una acción propia,
`cita.propia.cancelar` (§5.1), que todavía **no** está en la matriz.

De esas 69, **12** señalan además una **brecha actual** de roles del código respecto a la
matriz (33, 36, 79, 94, 105, 107, 111, 113, 114, 115, 116 y 118): se corrigen en T-11
(§5.3). Las cuatro de combos (111, 113, 114 y 115) se sumaron al aplicar la decisión del
dueño sobre el catálogo (§5.5): hoy el código también deja gestionarlas al BARBERO.

De las 13 brechas `sin acción`, §6 explica para cada una qué hace, qué rol debería tenerla
y por qué. **Doce** rutas necesitan acciones nuevas (§7) —ocho acciones—; la ruta 44 se
cubre con acciones vigentes. El número bajó de 18 a 16 porque las rutas 60 y 61 resultaron
no ser una brecha (§5.4), y de 16 a 13 porque las **121–123** dejaron de serlo al aprobarse
la solicitud de servicio (§5.10): no son código que sobra, son la petición propia del
barbero.

## 3 · Tabla (123 rutas)

### 3.1 Identidad, sesión e integraciones (15)

| # | Ruta | Propuesta | Nota |
|--:|---|---|---|
| 1 | `GET /` | `sin acción` | Raíz del servicio; no es operación de negocio. |
| 2 | `POST /auth/register` | `sin acción` | Alta de cuenta propia. |
| 3 | `POST /auth/login` | `sin acción` | Autenticación. |
| 4 | `GET /auth/me` | `sin acción` | Perfil del propio token. |
| 5 | `POST /auth/logout` | `sin acción` | Cierra la sesión del propio token (QA2-02). |
| 6 | `POST /auth/forgot-password` | `sin acción` | Recuperación de acceso. |
| 7 | `POST /auth/reset-password` | `sin acción` | Recuperación de acceso. |
| 8 | `POST /auth/send-otp` | `sin acción` | Verificación de canal propia. |
| 9 | `POST /auth/verify-otp` | `sin acción` | Verificación de canal propia. |
| 10 | `POST /auth/otp/resend` | `sin acción` | Reenvío del OTP propio (T-21). |
| 11 | `PATCH /auth/otp/update-contact` | `sin acción` | Corrección del contacto propio (T-21). |
| 12 | `GET /health,api/v1/health` | `sin acción` | Sonda de preparación. |
| 13 | `GET /health/liveness,api/v1/health/liveness` | `sin acción` | Sonda de vida. |
| 14 | `GET /notificaciones/mis-notificaciones` | `sin acción` | Datos propios del token. |
| 15 | `POST /webhooks/whatsapp/` | `sin acción` | Integración: se autentica con `x-webhook-secret`, no con rol. |

### 3.2 Plataforma (16)

| # | Ruta | Propuesta | Nota |
|--:|---|---|---|
| 16 | `GET /auditoria/` | `plataforma.auditoria.ver` | — |
| 17 | `GET /auditoria/estadisticas` | `plataforma.auditoria.ver` | — |
| 18 | `POST /auditoria/purgar` | `plataforma.auditoria.ver` | La matriz solo tiene la acción de ver; la purga es escritura y no aparece en la matriz. Mismo rol (ADMINISTRADOR). |
| 19 | `GET /shops/all` | `plataforma.sedes.gestionar` | La matriz no tiene «ver todas las sedes»; se propone la acción de gestión, que es del mismo rol. |
| 20 | `GET /analytics/plataforma/hoy` | `plataforma.metricas.ver` | — |
| 21 | `GET /plataforma/solicitudes-cambio/` | `sin acción` — **brecha** | La resolución de solicitudes es de la plataforma y la matriz no tiene acción para ella. |
| 22 | `POST /plataforma/solicitudes-cambio/:id/resolver` | `sin acción` — **brecha** | Ídem: falta una acción de resolución de plataforma. |
| 23 | `GET /plataforma/vinculaciones/pendientes` | `sin acción` — **brecha** | 6.ª vinculación (D10): la decide la plataforma y la matriz no la nombra. |
| 24 | `POST /plataforma/vinculaciones/:id/aprobar` | `sin acción` — **brecha** | Ídem. |
| 25 | `POST /plataforma/vinculaciones/:id/rechazar` | `sin acción` — **brecha** | Ídem. |
| 26 | `PATCH /plataforma/usuarios/:id/estado` | `plataforma.usuarios.gestionar` | Suspender/reactivar cuenta. |
| 27 | `GET /plataforma/usuarios/` | `plataforma.usuarios.gestionar` | La acción nombra crear/suspender/eliminar; la lectura de la bandeja es del mismo rol. |
| 28 | `POST /plataforma/usuarios/` | `plataforma.usuarios.gestionar` | — |
| 29 | `GET /plataforma/usuarios/:id/auditoria` | `plataforma.auditoria.ver` | Historial de una cuenta. |
| 30 | `GET /plataforma/usuarios/:id/roles` | `plataforma.usuarios.gestionar` | Lectura de vínculos de rol de una cuenta (I-05). |
| 31 | `PATCH /plataforma/usuarios/:id/administrador` | `plataforma.usuarios.gestionar` | Concede o retira el rol global. |

### 3.3 Sedes, vínculos y configuración (22)

| # | Ruta | Propuesta | Nota |
|--:|---|---|---|
| 32 | `GET /shops/` | `sin acción` | Vitrina de sedes activas. |
| 33 | `POST /shops/` | `plataforma.sedes.gestionar` | Crear sede. **Brecha actual:** hoy la declaran los cuatro roles. |
| 34 | `GET /shops/:shopId` | `sin acción` | Lectura pública de la sede. |
| 35 | `PATCH /shops/:shopId/select` | `sin acción` | Preferencia de sesión del propio usuario. |
| 36 | `PATCH /shops/:shopId` | `plataforma.sedes.gestionar` | Editar datos de la sede. **Brecha actual:** hoy también ADMIN_BARBERIA. |
| 37 | `PATCH /shops/:shopId/status` | `plataforma.sedes.gestionar` | Suspender/reactivar sede (E2-07). |
| 38 | `POST /shops/link` | `sin acción` | Vínculo del propio usuario con una sede. |
| 39 | `GET /shops/:shopId/invitation` | `sin acción` | Compartir la puerta de entrada de la sede (E3-12/2); la matriz no la cubre. |
| 40 | `GET /shops/:shopId/settings/` | `sin acción` — **brecha** | No hay acción de configuración de sede en la matriz. |
| 41 | `PATCH /shops/:shopId/settings/` | `sin acción` — **brecha** | Ídem, y esta además es escritura. |
| 42 | `GET /shops/:shopId/analytics/` | `caja.ver_y_cerrar` | Es el mismo balance financiero que la caja; la matriz no tiene «analíticas de sede». |
| 43 | `GET /shops/:shopId/analytics/export` | `caja.ver_y_cerrar` | Exportación CSV del mismo panel. |
| 44 | `GET /shops/overview` | `sin acción` — **brecha** | Resumen multisede de franquicia; la matriz no lo cubre. |
| 45 | `POST /shops/:shopId/change-requests` | `solicitudes_cambio.gestionar` | La sede propone el cambio. |
| 46 | `GET /shops/:shopId/change-requests` | `solicitudes_cambio.gestionar` | La sede ve el estado de lo que propuso. |
| 47 | `GET /shops/:shopId/restricted-clients/` | `sin acción` — **brecha** | Bandeja local de restringidos (E4-03); la matriz no la cubre. |
| 48 | `POST /shops/:shopId/restricted-clients/:clientId/reactivate` | `sin acción` — **brecha** | Ídem. |
| 49 | `GET /shops/:shopId/membership/` | `sin acción` | Estado propio del cliente en esa sede (H54). |
| 50 | `POST /shops/:shopId/membership/unlink` | `sin acción` | Desvinculación a petición del propio cliente. |
| 51 | `GET /mi-estado/barberias` | `sin acción` | Sedes propias del cliente (H72). |
| 52 | `GET /mi-estado/membresias` | `sin acción` | Fidelización de las sedes propias. |
| 53 | `POST /mi-estado/unirse` | `sin acción` | Unión por invitación (regla 1.10). |

### 3.4 Personal (3)

| # | Ruta | Propuesta | Nota |
|--:|---|---|---|
| 54 | `GET /shops/:shopId/staff` | `personal.gestionar` | La matriz no tiene lectura de personal; el BARBERO la necesita para operar. **Decisión pendiente.** |
| 55 | `POST /shops/:shopId/staff` | `personal.gestionar` | Invitar personal. |
| 56 | `PATCH /shops/:shopId/staff/:userId` | `personal.gestionar` | Desactivar/activar personal. |

### 3.5 Agenda, reservas y bloqueos (36)

| # | Ruta | Propuesta | Nota |
|--:|---|---|---|
| 57 | `GET /shops/:shopId/appointments/schedule/blocks` | `agenda.sede.ver` | Lectura de bloqueos de la sede. |
| 58 | `POST /shops/:shopId/appointments/schedule/blocks` | `agenda.sede.ver` | La matriz no tiene «gestionar bloqueos»; se propone la acción de agenda de sede. |
| 59 | `POST /shops/:shopId/appointments/schedule/blocks/:id/release` | `agenda.sede.ver` | Ídem (E2-07: liberar, no borrar). |
| 60 | `GET /shops/:shopId/appointments/schedule/availability` | `sin acción` | **No es brecha** (§5.4): no es la disponibilidad *declarada* de la sede, sino el cálculo de huecos libres para reservar (`DisponibilidadService.calcularDisponibilidadDeSolicitante`), el mismo que la fila 62 y la que consume el wizard del cliente. |
| 61 | `POST /shops/:shopId/appointments/schedule/availability` | `sin acción` | **No es brecha** (§5.4): el mismo cálculo con cuerpo tipado (fecha, duración, barbero). No escribe configuración; por eso los cuatro roles son correctos y no hay nada que endurecer. |
| 62 | `GET /shops/:shopId/appointments/schedule/slots` | `sin acción` | Cálculo de huecos para reservar (E4-02); lo consume también el cliente. |
| 63 | `POST /shops/:shopId/appointments/` | `sin acción` | El CLIENTE crea su propia reserva. |
| 64 | `POST /shops/:shopId/appointments/walk-in` | `walkin.crear` | — |
| 65 | `POST /shops/:shopId/appointments/walk-in-pago` | `walkin.crear` | Cita directa cobrada: la matriz no separa el cobro. ADMINISTRADOR sale por la matriz (§3). |
| 66 | `POST /shops/:shopId/appointments/quote` | `sin acción` | Cotización sin persistir (D44). |
| 67 | `GET /shops/:shopId/appointments/mine` | `sin acción` | Reservas propias del cliente. |
| 68 | `GET /shops/:shopId/appointments/:id` | `sin acción` | Detalle acotado por servicio (propia, asignada o de la sede). |
| 69 | `POST /shops/:shopId/appointments/:id/no-show` | `cita.estado.marcar` | — |
| 70 | `POST /shops/:shopId/appointments/:id/accept` | `cita.estado.marcar` | — |
| 71 | `POST /shops/:shopId/appointments/:id/reject` | `cita.estado.marcar` | — |
| 72 | `POST /shops/:shopId/appointments/:id/cancel` | `cita.estado.marcar` + `cita.propia.cancelar` (**acción nueva**, propuesta) | **Decidido (opción A, §5.1):** la sede y el barbero cancelan con `cita.estado.marcar`; el CLIENTE, solo su propia reserva, con la acción nueva. La matriz todavía no la incluye. |
| 73 | `PATCH /shops/:shopId/appointments/:id/reschedule` | `cita.estado.marcar` | Reprogramar es decisión de la sede (E3-06). |
| 74 | `POST /shops/:shopId/appointments/:id/special-cancellation` | `cita.estado.marcar` | Cancelación especial (D17). |
| 75 | `POST /shops/:shopId/appointments/:id/propose-time` | `sin acción` — **brecha** | Propuesta de horario del cliente (D18); la matriz no la cubre. |
| 76 | `POST /shops/:shopId/appointments/:id/proposed-time/accept` | `cita.estado.marcar` | — |
| 77 | `POST /shops/:shopId/appointments/:id/proposed-time/reject` | `cita.estado.marcar` | — |
| 78 | `GET /shops/:shopId/appointments/proposals/pending` | `cita.estado.marcar` | Bandeja de propuestas (H-03); lectura de la misma decisión. |
| 79 | `GET /shops/:shopId/appointments/day` | `agenda.sede.ver` | **Brecha actual:** hoy también BARBERO. La matriz separa `agenda.sede.ver` de `agenda.propia.ver`. |
| 80 | `PATCH /reservas/:id/asignar-barbero` | `cita.estado.marcar` | La matriz no tiene «reasignar»; es decisión de la sede (D02). |
| 81 | `GET /shops/:shopId/hours/` | `agenda.sede.ver` | Horarios del personal de la sede. |
| 82 | `POST /shops/:shopId/hours/` | `personal.gestionar` | Horario base del personal (la matriz lo incluye en `personal.gestionar`). |
| 83 | `GET /shops/:shopId/hours/mine` | `agenda.propia.ver` | Horario propio del barbero. |
| 84 | `POST /shops/:shopId/hours/mine` | `excepciones.propias.registrar` | Excepción propia. |
| 85 | `GET /shops/:shopId/mi-horario/` | `agenda.propia.ver` | Semana propia (V3 fase 5). |
| 86 | `PUT /shops/:shopId/mi-horario/` | `excepciones.propias.registrar` | Declarar la semana propia. |
| 87 | `GET /shops/:shopId/mi-horario/base` | `agenda.propia.ver` | Plantilla base propia. |
| 88 | `PUT /shops/:shopId/mi-horario/base` | `excepciones.propias.registrar` | Propone la base; aprobarla es `horario.base.aprobar`. |
| 89 | `GET /shops/:shopId/hours/exceptions` | `excepciones.ajenas.gestionar` | Lectura de excepciones de la sede. El barbero ve además las propias. |
| 90 | `POST /shops/:shopId/hours/exceptions` | `excepciones.ajenas.gestionar` | — |
| 91 | `POST /shops/:shopId/hours/barbers/:barberoId/exceptions` | `excepciones.ajenas.gestionar` | Excepción de otro barbero. |
| 92 | `POST /lista-espera/` | `sin acción` | Alta del propio cliente (D22). |

### 3.6 Antecedentes y evaluaciones (4)

| # | Ruta | Propuesta | Nota |
|--:|---|---|---|
| 93 | `POST /shops/:shopId/records/` | `antecedentes.solicitar` | — |
| 94 | `PATCH /shops/:shopId/records/:id/evaluate` | `antecedentes.resolver` | **Brecha actual:** hoy ADMIN_BARBERIA; la matriz lo da solo al ADMINISTRADOR. |
| 95 | `GET /shops/:shopId/records/client/:clientId` | `antecedentes.ver` | Barbero: solo clientes con cita suya (C-5). |
| 96 | `GET /shops/:shopId/records/pending` | `antecedentes.ver` | — |

### 3.7 Caja y cobros (7)

| # | Ruta | Propuesta | Nota |
|--:|---|---|---|
| 97 | `GET /shops/:shopId/payments/audit` | `caja.ver_y_cerrar` | — |
| 98 | `POST /shops/:shopId/payments/` | `sin acción` — **brecha** | Cobrar no es «caja» ni «anular» en la matriz; falta `pagos.cobrar`. Hoy lo hacen tres roles. |
| 99 | `GET /shops/:shopId/payments/history` | `caja.ver_y_cerrar` | — |
| 100 | `POST /pagos/cobrar` | `sin acción` — **brecha** | Misma brecha que la 98 (cobro desde la agenda). |
| 101 | `GET /caja/hoy` | `caja.ver_y_cerrar` | — |
| 102 | `POST /caja/cierre` | `caja.ver_y_cerrar` | — |
| 103 | `POST /shops/:shopId/payments/:id/void` | `pagos.anular` | — |

### 3.8 Catálogo (20)

| # | Ruta | Propuesta | Nota |
|--:|---|---|---|
| 104 | `GET /shops/:shopId/services/` | `sin acción` | Vitrina de servicios. |
| 105 | `POST /shops/:shopId/services/` | `catalogo.servicios.gestionar` | **Brecha actual:** hoy lo declaran BARBERO y ADMIN_BARBERIA; la matriz lo da solo a ADMIN_BARBERIA. |
| 106 | `GET /shops/:shopId/services/:id` | `sin acción` | Vitrina. |
| 107 | `PATCH /shops/:shopId/services/:id` | `catalogo.servicios.gestionar` | **Brecha actual:** hoy BARBERO también. |
| 108 | `PATCH /shops/:shopId/services/:id/deactivate` | `catalogo.servicios.gestionar` | — |
| 109 | `PATCH /shops/:shopId/services/:id/reactivate` | `catalogo.servicios.gestionar` | — |
| 110 | `GET /shops/:shopId/combos/` | `sin acción` | Vitrina de combos. |
| 111 | `POST /shops/:shopId/combos/` | `catalogo.servicios.gestionar` | La matriz no nombra combos; se propone la acción del catálogo. **Brecha actual:** hoy también BARBERO (§5.5). |
| 112 | `GET /shops/:shopId/combos/:id` | `sin acción` | Vitrina. |
| 113 | `PATCH /shops/:shopId/combos/:id` | `catalogo.servicios.gestionar` | Ídem. **Brecha actual:** hoy también BARBERO (§5.5). |
| 114 | `PATCH /shops/:shopId/combos/:id/deactivate` | `catalogo.servicios.gestionar` | Ídem. **Brecha actual:** hoy también BARBERO (§5.5). |
| 115 | `PATCH /shops/:shopId/combos/:id/reactivate` | `catalogo.servicios.gestionar` | Ídem. **Brecha actual:** hoy también BARBERO (§5.5). |
| 116 | `POST /shops/:shopId/categorias/` | `catalogo.categorias.gestionar` | **Brecha actual:** hoy ADMIN_BARBERIA; la matriz lo da solo al ADMINISTRADOR. |
| 117 | `GET /shops/:shopId/categorias/` | `catalogo.categorias.ver` | — |
| 118 | `PATCH /shops/:shopId/categorias/:id` | `catalogo.categorias.gestionar` | **Brecha actual:** hoy ADMIN_BARBERIA. |
| 119 | `GET /shops/:shopId/categorias/:id` | `catalogo.categorias.ver` | — |
| 120 | `GET /shops/:shopId/servicios` | `sin acción` | Catálogo anidado de la vitrina del cliente. |
| 121 | `POST /shops/:shopId/mis-servicios` | `sin acción` | **Decisión 10 (§5.10):** es la **solicitud** del barbero (nombre, categoría, duración, precio, descripción e imagen), nace `PENDIENTE`. Hoy esta ruta publica el servicio directamente. Autoservicio propio: el `barberoId` sale del JWT. |
| 122 | `GET /shops/:shopId/mis-servicios` | `sin acción` | Panel propio: sus solicitudes con estado y motivo de rechazo, y los servicios ya aprobados. |
| 123 | `PATCH /shops/:shopId/mis-servicios/:id` | `sin acción` | Solo su solicitud **mientras está `PENDIENTE`**. Sobre un servicio publicado no escribe: para cambiarlo manda una solicitud nueva (§5.10). |

## 4 · Lo que esta tabla no hace

- No cambia controladores, guards ni decoradores.
- No modifica el inventario de `test/permisos-matriz.spec.ts`: lo ampliarán T-11 y T-12 con
  las rutas nuevas.
- Las nueve altas y las rutas de las solicitudes **sí** están escritas en
  `docs/MATRIZ_PERMISOS_OBJETIVO.md` (§1 y §5 de ese documento, PR #172), sin tocar sus 21
  filas vigentes.
- No propone fusionar nada. T-10, T-11 y T-12 siguen sin empezar.

## 5 · Decisiones del dueño (22 nov 2026)

1. **Cancelación del cliente (ruta 72) — opción A.** Se propone la acción nueva
   `cita.propia.cancelar`, que solo tiene el CLIENTE y solo sobre su propia reserva (el
   servicio ya comprueba la propiedad y responde 403 `RESERVA_AJENA`). La sede y el barbero
   siguen cancelando con `cita.estado.marcar`. La matriz se amplía con ella cuando el dueño
   la apruebe; hasta entonces la ruta queda como está.
2. **Horario base (la acción sin ruta).** Se propone la ruta de §8:
   `PATCH /shops/:shopId/hours/barbers/:barberoId/base`, con `{ aprobar, motivoRechazo? }`.
   Hoy no existe ningún flujo de propuesta: `PUT …/mi-horario/base` escribe la plantilla
   directamente, así que `horario.base.aprobar` no tiene sobre qué actuar.
3. **Las brechas actuales de rol** (33, 36, 79, 94, 105, 107, 111, 113, 114, 115, 116 y 118:
   doce) se corrigen en T-11, sin tocar la matriz: el código es el que se adapta.
4. **Las 18 rutas `sin acción` quedan revisadas.** Después de leer los controladores y
   servicios, **16** siguen siendo brecha (§6) y **2** no lo son: las rutas **60 y 61**
   (`appointments/schedule/availability`) no declaran la disponibilidad de la sede, sino que
   **calculan huecos libres para reservar** —el mismo cálculo que la fila 62 (`slots`), con
   el cuerpo tipado en el POST—. Las consume el wizard del cliente, no escriben
   configuración y por eso los cuatro roles son correctos. Se reclasifican como
   `sin acción` fuera del alcance de la matriz y bajan el total de brechas de 18 a 16.

### Segunda ronda (misma fecha)

5. **Catálogo: solo el ADMIN_BARBERIA de la sede crea servicios; el barbero los pide.**
   `catalogo.servicios.gestionar` se queda como está —solo ADMIN_BARBERIA— y **se retira la
   propuesta `catalogo.propios.gestionar`**. Consecuencias:
   - 105 y 107 ya eran brecha actual; se suman **111, 113, 114 y 115 (combos)**, porque hoy
     el BARBERO también las declara y el combo va con la misma acción del catálogo. Las
     brechas de rol pasan de 8 a **12**.
   - **121–123 (`mis-servicios`)** dejan de ser un hueco de matriz: el código es el que
     sobra, porque hoy dejan al BARBERO publicar y editar un servicio con su propio precio.
     Pasan a **brecha de código** y se cierran en T-11.
   - **Pendiente de definir (no lo doy por decidido):** «el barbero los pide» no existe hoy
     en el código. O lo pide al ADMIN_BARBERIA fuera del sistema —y T-11 solo cierra la
     creación—, o se convierte en una **solicitud con aprobación** con estado propio en
     `ServicioBarbero`, como el horario base de §8, que sería trabajo de T-12. Las dos
     lecturas caben en la decisión y no elijo una por mi cuenta.
6. **Cobro: el barbero cobra sus propias citas.** `pagos.cobrar` ✅ BARBERO (solo sus
   citas). El ADMIN_BARBERIA conserva la sede entera: una reserva sin barbero asignado no la
   puede cobrar el barbero (E3-09). El resto del cobro no cambia.
7. **El ADMINISTRADOR global no cobra.** `pagos.cobrar` ❌ para él, y queda cerrado el punto
   que §7 tenía a confirmar. Hoy entra por la jerarquía del `RolesGuard`; T-11 necesita un
   guard que lo excluya expresamente, como `OperadorBarberiaGuard` hace en el catálogo.
8. **El ADMINISTRADOR global ve la configuración de sede y los restringidos, en solo
   lectura.** Se separan lectura y escritura: `configuracion.sede.ver` y
   `restringidos_locales.ver` (nuevas; ADMINISTRADOR ✅ solo lectura, ADMIN_BARBERIA ✅), y
   `configuracion.sede.gestionar` / `restringidos_locales.gestionar` quedan solo para
   ADMIN_BARBERIA. Son cuatro acciones donde antes se proponían dos.
9. **El horario base tiene estados PENDIENTE, APROBADA y RECHAZADA.** Confirma §8 y
   convierte `PUT …/mi-horario/base` en una **propuesta** del barbero (hoy escribe la
   plantilla vigente). La decisión la resuelve `horario.base.aprobar` con la ruta de §8; el
   estado es cambio de modelo y va en T-12, no en T-11.

### Tercera ronda (misma fecha)

10. **Servicios: la solicitud del barbero con aprobación (cierra el pendiente de §5.5).**
    El BARBERO crea una **solicitud de servicio** con nombre, categoría, duración, precio,
    descripción e imagen; nace `PENDIENTE`. El ADMIN_BARBERIA de la sede la resuelve:
    **aprobarla crea el servicio** (`APROBADA`) o la **rechaza con motivo**
    (`RECHAZADA`, 422 `MOTIVO_RECHAZO_REQUERIDO`). El barbero **no edita servicios
    publicados**: si quiere un cambio, manda una solicitud nueva.
    - Las tres rutas del barbero siguen siendo **autoservicio propio**, sin acción de la
      matriz: la 121 crea la solicitud, la 122 muestra sus solicitudes con estado y motivo y
      la 123 solo edita una solicitud `PENDIENTE`. El `barberoId` sale del JWT y
      `SoloBarberoGuard` sigue siendo el guard de rol.
    - La resolución usa `catalogo.servicios.gestionar`, que ya es solo del ADMIN_BARBERIA:
      aprobar **es** crear el servicio. Por eso las altas siguen siendo **nueve**.
    - **Rutas nuevas:** la bandeja y la resolución del administrador están en §7.2. No
      existen hoy: las crea T-12 junto con los estados.
    - **Pendiente de T-12:** en qué tabla aterriza el servicio aprobado, porque hay dos
      catálogos —`Servicio`, el de la sede, que ve el panel de administración y del que se
      arman los combos, y `ServicioBarbero`, el que pinta la vitrina del cliente con precio
      y barbero propios—. La consecuencia está en §5.11. Los campos nuevos (estado, motivo
      de rechazo, descripción e imagen) no existen en ninguna de las dos tablas, y la imagen
      necesita definir dónde se guarda.
11. **Combos: solo el ADMIN_BARBERIA los crea y edita, sin solicitudes (aceptado).** No veo
    problema de permisos: las rutas 111, 113, 114 y 115 caen en
    `catalogo.servicios.gestionar`, que la matriz ya da solo al ADMIN_BARBERIA, y siguen
    siendo brechas de rol que T-11 cierra. Sí veo tres consecuencias operativas, y las dejo
    escritas para que no aparezcan en QA como defectos:
    - **Un combo no puede llevar un servicio de barbero.** `ComboItem.servicioId` apunta a
      `Servicio`, no a `ServicioBarbero`. Si el servicio aprobado nace en
      `ServicioBarbero`, no se puede meter en un combo desde la pantalla de combos y el
      administrador no tiene forma de hacerlo. Se resuelve al decidir la tabla del alta
      (§5.10) o moviendo `ComboItem`, que es más trabajo.
    - **El precio del combo es de la sede y el del servicio es de cada barbero.**
      `Combo.precioEspecial` es uno para toda la sede, mientras `ServicioBarbero.precio`
      cambia por barbero: el mismo descuento cae distinto en cada uno y el combo no puede
      respetar los precios individuales. Si eso importa, el combo tendría que ser por
      barbero, y eso no está en la decisión.
    - **Desactivar un combo es lo que desbloquea `SERVICIO_EN_COMBO_ACTIVO`.** Con el combo
      solo en manos del administrador, un barbero bloqueado por un combo activo deja de
      poder desbloquearse solo: depende de la sede. Es coherente con que el catálogo sea de
      la sede, pero es una espera nueva.
    Lo demás no cambia: el combo no se borra (E2-07/D29) y las lecturas siguen igual.

## 6 · Revisión de las 13 rutas `sin acción`

Para cada ruta: qué hace hoy en el código, qué rol debería tenerla y por qué. La columna
«Acción» es una **propuesta**; las acciones nuevas están en la matriz como altas †, todavía
pendientes de aprobación.

| # | Ruta | Qué hace | Rol propuesto | Acción | Por qué |
|--:|---|---|---|---|---|
| 21 | `GET /plataforma/solicitudes-cambio/` | Bandeja paginada de las solicitudes de cambio de nombre o responsable que proponen las sedes (E3-13, D26/D32). | ADMINISTRADOR | `plataforma.solicitudes_cambio.gestionar` (**nueva**) | La sede es parte interesada: si resolviera su propia solicitud, el control sería un trámite. Mismo criterio que la 6.ª vinculación (D10). |
| 22 | `POST /plataforma/solicitudes-cambio/:id/resolver` | Aprueba o rechaza una solicitud; al aprobar un cambio de responsable mueve `responsable_id`, el rol ADMIN_BARBERIA y la auditoría en una transacción. | ADMINISTRADOR | `plataforma.solicitudes_cambio.gestionar` (**nueva**) | Es la escritura de la misma decisión de plataforma: quien ve la bandeja es quien resuelve, y nadie más. |
| 23 | `GET /plataforma/vinculaciones/pendientes` | Clientes que esperan aprobación de la 6.ª vinculación, con su sede y cuántos vínculos acumulan (E3-12, D10). | ADMINISTRADOR | `plataforma.vinculaciones.gestionar` (**nueva**) | El límite de D10 se cuenta **por usuario**, no por sede: la sede es parte interesada y aprobar su propia sexta vinculación convertiría el límite en un trámite. |
| 24 | `POST /plataforma/vinculaciones/:id/aprobar` | Pasa la vinculación a `ACTIVO` y audita `VINCULACION_APROBADA`. | ADMINISTRADOR | `plataforma.vinculaciones.gestionar` (**nueva**) | Misma decisión de plataforma que la bandeja; el `ADMIN_BARBERIA` de la sede ya recibe 403 (probado en `e3-12-vinculacion.e2e-spec.ts`). |
| 25 | `POST /plataforma/vinculaciones/:id/rechazar` | Deja el vínculo `DESVINCULADO` con motivo obligatorio (422 `MOTIVO_REQUERIDO`) y audita `VINCULACION_RECHAZADA`. | ADMINISTRADOR | `plataforma.vinculaciones.gestionar` (**nueva**) | Rechazar es la otra mitad de la misma decisión: separar la acción solo añadiría una fila con la misma columna. |
| 40 | `GET /shops/:shopId/settings/` | Configuración **operativa** de la sede: modo de reserva (manual/automático), cupos (`maxPendientes`, `maxNinos`, `maxPersonasTotal`), horizonte de reserva, pausas, cancelación especial y oportunidades de espacio. | ADMIN_BARBERIA de esa sede · ADMINISTRADOR (solo lee) | `configuracion.sede.ver` (**nueva**) | Es operación de la sede, no de la plataforma: la palanca de plataforma sobre una sede es suspenderla (`plataforma.sedes.gestionar`). **Decisión 8 (§5.8):** el ADMINISTRADOR global conserva la lectura y pierde la escritura (41). |
| 41 | `PATCH /shops/:shopId/settings/` | La escritura de esa misma configuración (es la que cambia el comportamiento de las reservas). | ADMIN_BARBERIA de esa sede | `configuracion.sede.gestionar` (**nueva**) | **Decisión 8 (§5.8):** leer y escribir se separan (`configuracion.sede.ver` para 40) porque el ADMINISTRADOR global ve sin cambiar. T-11 le quita este PATCH. |
| 44 | `GET /shops/overview` | Consolidado del panel: ingresos y ocupación por sede. El servicio acota el alcance: el ADMIN_BARBERIA ve las sedes que administra y el ADMINISTRADOR el consolidado global (E4-04). | ADMIN_BARBERIA (sus sedes) y ADMINISTRADOR (global) | `caja.ver_y_cerrar` para el ADMIN_BARBERIA · `plataforma.metricas.ver` para el ADMINISTRADOR | No hace falta acción nueva: es el mismo balance que la caja (filas 42 y 43) para la sede, y la métrica de plataforma para el ADMINISTRADOR. **A confirmar:** que `caja.ver_y_cerrar` cubra el consolidado multisede y no solo el día. |
| 47 | `GET /shops/:shopId/restricted-clients/` | Lista negra **local** de la sede: inasistencias acumuladas y motivo (E4-03, D48). | ADMIN_BARBERIA de esa sede · ADMINISTRADOR (solo lee) | `restringidos_locales.ver` (**nueva**) | D48 la hace local y sin acción de cuenta global; la herramienta de plataforma es suspender la cuenta (`plataforma.usuarios.gestionar`). **Decisión 8 (§5.8):** el ADMINISTRADOR global la ve en solo lectura; el barbero no. |
| 48 | `POST /shops/:shopId/restricted-clients/:clientId/reactivate` | Levanta la restricción de esa sede, reinicia el contador y audita el motivo. | ADMIN_BARBERIA de esa sede | `restringidos_locales.gestionar` (**nueva**) | Es la escritura de la misma bandeja local; el barbero no debe poder levantar la restricción de un cliente. **Decisión 8 (§5.8):** el ADMINISTRADOR global la ve pero no la levanta; T-11 le quita este POST. |
| 75 | `POST /shops/:shopId/appointments/:id/propose-time` | El CLIENTE dueño propone otro bloque para su cita. No ocupa agenda: deja una propuesta `PENDIENTE` con 10 minutos de ventana que resuelve la sede (E3-08, D18). | CLIENTE (solo la suya) | `cita.propia.proponer_horario` (**nueva**) | No es marcar estado: crea una propuesta. El estado lo mueve la sede con `cita.estado.marcar` (filas 76 y 77). Darle `cita.estado.marcar` al CLIENTE abriría también aceptar, rechazar y no presentado. |
| 98 | `POST /shops/:shopId/payments/` | Registra atención y cobro en persona. El BARBERO solo cobra sus reservas asignadas; una reserva sin barbero solo la cobra la sede (E3-09). | ADMIN_BARBERIA (toda la sede) y BARBERO (solo sus citas) | `pagos.cobrar` (**nueva**) | La matriz separa `caja.ver_y_cerrar` (ver y cerrar) de `pagos.anular` (deshacer), pero **no tiene cobrar**, que es la operación central de la caja. **Decisiones 2 y 3 (§5.6–§5.7):** el barbero cobra sus citas y el ADMINISTRADOR global no cobra; hoy entra por jerarquía y T-11 debe excluirlo. |
| 100 | `POST /pagos/cobrar` | El mismo cobro desde la agenda (V3 fase 6); entra al mismo `PagoService.registrarPagoEnPersona`, así que las reglas no pueden desincronizarse. | ADMIN_BARBERIA (toda la sede) y BARBERO (solo sus citas) | `pagos.cobrar` (**nueva**) | Es la misma operación que la 98 con otro contrato: una sola acción para las dos rutas evita que una quede con permiso y la otra no. **Decisiones 2 y 3 (§5.6–§5.7):** el ADMINISTRADOR global tampoco cobra por esta ruta. |
| 121 | `POST /shops/:shopId/mis-servicios` | Crea la **solicitud** de servicio (nombre, categoría, duración, precio, descripción, imagen), que nace `PENDIENTE`; hoy publica el servicio directamente. El `barberoId` sale del JWT y `SoloBarberoGuard` impide pedir «en su nombre». | BARBERO (solo la suya) | `sin acción` — autoservicio propio | Decisión 10 (§5.10): la petición es del barbero y no publica nada; la resolución usa `catalogo.servicios.gestionar` (§7.2). |
| 122 | `GET /shops/:shopId/mis-servicios` | Panel propio: sus solicitudes con estado y motivo de rechazo, y los servicios ya aprobados. | BARBERO (solo las suyas) | `sin acción` — autoservicio propio | Es su propio panel; el `barberoId` sale del JWT. |
| 123 | `PATCH /shops/:shopId/mis-servicios/:id` | Edita su solicitud **mientras está `PENDIENTE`**; sobre un servicio ya publicado no escribe. | BARBERO (solo la suya) | `sin acción` — autoservicio propio | Decisión 10: el barbero no edita servicios publicados; T-12 devuelve 409 si la solicitud ya está resuelta. |

## 7 · Acciones nuevas propuestas

Nueve acciones: `cita.propia.cancelar`, que el dueño ya aprobó (§5.1), y ocho más. **Ya
están escritas en `docs/MATRIZ_PERMISOS_OBJETIVO.md`** (§1 de ese documento, rama
`docs/matriz-permisos-objetivo`, PR #172) como altas marcadas con †, junto con las rutas de
las solicitudes (§5 de ese documento); el dueño todavía no las aprobó y #172 sigue sin
fusionar. La matriz pasa de **21 a 30 acciones** y **ninguna de las 21 filas vigentes cambia
de celda**: las decisiones del dueño solo añaden.

| Acción nueva | ADMINISTRADOR | ADMIN_BARBERIA | BARBERO | CLIENTE | Rutas |
|---|:-:|:-:|:-:|:-:|---|
| `cita.propia.cancelar` (aprobada, §5.1) | ❌ | ❌ | ❌ | ✅ (solo la suya) | 72 |
| `cita.propia.proponer_horario` | ❌ | ❌ | ❌ | ✅ (solo la suya) | 75 |
| `pagos.cobrar` | ❌ (§5.7) | ✅ (toda la sede) | ✅ (solo sus citas, §5.6) | ❌ | 98, 100 |
| `configuracion.sede.ver` | ✅ (solo lectura, §5.8) | ✅ | ❌ | ❌ | 40 |
| `configuracion.sede.gestionar` | ❌ | ✅ | ❌ | ❌ | 41 |
| `restringidos_locales.ver` | ✅ (solo lectura, §5.8) | ✅ | ❌ | ❌ | 47 |
| `restringidos_locales.gestionar` | ❌ | ✅ | ❌ | ❌ | 48 |
| `plataforma.solicitudes_cambio.gestionar` | ✅ | ❌ | ❌ | ❌ | 21, 22 |
| `plataforma.vinculaciones.gestionar` | ✅ | ❌ | ❌ | ❌ | 23, 24, 25 |

`catalogo.propios.gestionar`, que esta lista proponía para 121–123, **queda retirada** por
la decisión §5.5.

### Pendientes que la matriz todavía no resuelve

1. **`GET /shops/overview` (fila 44) con dos acciones según el alcance.** Es la única de las
   13 que no necesita acción nueva, pero exige que el guard distinga audiencia (sede vs
   plataforma). No está decidido cómo.
2. **En qué tabla aterriza el servicio aprobado (§5.10).** En `Servicio` (sede, panel de
   administración, sirve para combos) o en `ServicioBarbero` (vitrina del cliente, con
   precio y barbero). Decide si el servicio aprobado puede entrar en un combo (§5.11).
3. **Si la solicitud del barbero lleva acción propia.** Hoy queda como autoservicio propio
   para no pasar de nueve altas; si el dueño la quiere en la matriz sería una décima,
   `catalogo.solicitudes_servicio.proponer` (BARBERO ✅, el resto ❌).
4. **Si el barbero puede desactivar un servicio ya aprobado** o eso también es una solicitud
   al administrador. Hoy `PATCH …/mis-servicios/:id` lo permite.

### Rutas de las solicitudes (objetivo, todavía no existen)

Las altas son nueve; las rutas de la solicitud de servicio y de la propuesta de horario base
son estas. No están implementadas: T-12 las crea junto con los estados.

| Ruta | Quién | Qué hace | Acción |
|---|---|---|---|
| `POST /shops/:shopId/mis-servicios` | BARBERO | Crea la solicitud `PENDIENTE`. | `sin acción` (autoservicio propio) |
| `GET /shops/:shopId/mis-servicios` | BARBERO | Sus solicitudes y servicios aprobados, con estado y motivo. | `sin acción` |
| `PATCH /shops/:shopId/mis-servicios/:id` | BARBERO | Edita la solicitud mientras está `PENDIENTE`. | `sin acción` |
| `GET /shops/:shopId/solicitudes-servicio` (**nueva**) | ADMIN_BARBERIA | Bandeja de solicitudes `PENDIENTE` de la sede. | `catalogo.servicios.gestionar` |
| `PATCH /shops/:shopId/solicitudes-servicio/:id` (**nueva**) | ADMIN_BARBERIA | `{aprobar:true}` crea el servicio y deja la solicitud `APROBADA`; `{aprobar:false,motivoRechazo}` la deja `RECHAZADA` (422 `MOTIVO_RECHAZO_REQUERIDO`). | `catalogo.servicios.gestionar` |
| `PUT /shops/:shopId/mi-horario/base` | BARBERO | Pasa a crear la **propuesta** `PENDIENTE` (hoy escribe la plantilla vigente). | `excepciones.propias.registrar` |
| `PATCH /shops/:shopId/hours/barbers/:barberoId/base` (**nueva**, §8) | ADMIN_BARBERIA | Aprueba o rechaza la propuesta, con motivo en el rechazo. | `horario.base.aprobar` |

- Las propuestas de horario base pendientes se leen por la ruta que ya existe,
  `GET /shops/:shopId/hours/` (81), añadiendo el estado; no hace falta bandeja aparte.
- Los estados son los mismos en las dos solicitudes (`PENDIENTE`, `APROBADA`,
  `RECHAZADA` con motivo); la de servicio añade descripción e imagen, que hoy no existen en
  ninguna de las dos tablas del catálogo.

## 8 · Ruta propuesta para `horario.base.aprobar`

`horario.base.aprobar` es la única de las 21 acciones sin endpoint. Propuesta:

```
PATCH /shops/:shopId/hours/barbers/:barberoId/base
Cuerpo: { "aprobar": true }  |  { "aprobar": false, "motivoRechazo": "..." }
Roles: ADMIN_BARBERIA de esa sede (ADMINISTRADOR ❌, BARBERO ❌, CLIENTE ❌)
200 OK
```

- Cuelga de `/shops/:shopId/hours/barbers/:barberoId/...`, que ya existe para las excepciones
  (`POST …/hours/barbers/:barberoId/exceptions`), así que no inventa un espacio de rutas.
- Una sola ruta resuelve aprobar y rechazar, como la matriz tiene **una** acción para la
  decisión; el rechazo exige motivo (422 `MOTIVO_RECHAZO_REQUERIDO`).
- **El sustrato está confirmado (decisión 9, §5.9):** los estados son `PENDIENTE`,
  `APROBADA` y `RECHAZADA`. T-12 tiene que añadirlos y convertir `PUT …/mi-horario/base`
  —hoy un upsert directo sobre la plantilla— en la **propuesta** del barbero; esta ruta es
  la que aprueba o rechaza. Es
  cambio de modelo de datos, no solo de guard: por eso queda fuera de T-11.
- Entra en la matriz como `horario.base.aprobar` (ya existe), no como acción nueva.

## 9 · Estado de este documento

- **No** modifica el spec de rutas, ni controladores, guards o decoradores.
- **No** fusiona nada ni empieza T-10, T-11 ni T-12.
- **Sí** escribe: las nueve altas y las rutas de las solicitudes están ya en
  `docs/MATRIZ_PERMISOS_OBJETIVO.md` (§1 y §5 de ese documento, rama
  `docs/matriz-permisos-objetivo`, PR #172), marcadas como altas pendientes de aprobación.
  Las 21 filas vigentes de la matriz no se tocaron.
- Pendiente: el visto bueno del dueño sobre las nueve altas, la autorización para fusionar
  #172 y #174, y las cuatro preguntas de §7.1.
