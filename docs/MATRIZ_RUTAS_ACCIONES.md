# Mapa rutas → acciones de la matriz objetivo

> **Documento de revisión.** No cambia código. Propone, para cada una de las **123 rutas**
> del backend, qué acción de `docs/MATRIZ_PERMISOS_OBJETIVO.md` le corresponde, o
> `sin acción` si la matriz no la cubre. Lo revisa el dueño antes de tocar controladores.

## 1 · Cómo se construyó

- **Fuente de las rutas:** `backend-barberias/test/permisos-matriz.spec.ts`, constante
  `POLITICA_DECLARADA`. Ese diccionario es hoy el inventario cerrado de rutas: el test
  falla si el servidor descubre una ruta que no esté ahí, y también si sobra una clave.
  Hoy tiene **123 claves** y el test exige **492 evaluaciones** (123 × 4 roles).
- **Fuente de las acciones:** `docs/MATRIZ_PERMISOS_OBJETIVO.md` (PR #172). Se usan los
  **21 identificadores tal cual**, sin renombrar ni derivar.
- **La propuesta no ajusta la matriz.** Donde la matriz no tiene acción, la fila dice
  `sin acción` y la nota explica la brecha; no se inventa un identificador nuevo.

### Leyenda de la columna «Propuesta»

| Valor | Significado |
|---|---|
| `acción` | La matriz tiene una acción que cubre la operación. Ese es el permiso que debe imponer la ruta. |
| `acción` + nota | La matriz cubre la operación en lo esencial, pero hay un matiz (lectura, escritura o alcance) que la matriz no distingue. |
| `sin acción` + nota | La matriz no tiene acción para esta ruta. Se propone dejarla fuera de la matriz (identidad, autoservicio, vitrina, integración) **o** se señala como **brecha** si es una operación de sede/plataforma que la matriz debería cubrir. |

## 2 · Resumen

| Categoría | Rutas |
|---|:-:|
| Con acción de la matriz (directa o con matiz) | 69 |
| `sin acción` — fuera del alcance de la matriz (identidad, autoservicio, vitrina, integración) | 36 |
| `sin acción` — **brecha**: operación que la matriz debería cubrir y no cubre | 18 |
| **Total** | **123** |

De las 69 rutas con acción, **8** señalan además una **brecha actual** del código respecto a
la matriz (roles 33, 36, 79, 94, 105, 107, 116 y 118) y **1** una **tensión** que necesita
decisión (ruta 72: el cliente cancela su propia reserva y la matriz le niega la acción).

Brechas que necesitan decisión del dueño (detalle en §5): `pagos.cobrar`, lectura de
personal, configuración de la sede, analíticas de sede, panel multisede, bloqueos y
disponibilidad de agenda, bandejas de plataforma (solicitudes de cambio, vinculaciones),
restringidos locales, cancelación del cliente, propuesta de horario del cliente,
publicación propia del barbero, combos, reasignación de barbero y purga de auditoría.

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
| 60 | `GET /shops/:shopId/appointments/schedule/availability` | `sin acción` — **brecha** | Disponibilidad declarada de la sede; la matriz no la cubre. |
| 61 | `POST /shops/:shopId/appointments/schedule/availability` | `sin acción` — **brecha** | Ídem, y es escritura: hoy la declaran los cuatro roles. |
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
| 72 | `POST /shops/:shopId/appointments/:id/cancel` | `cita.estado.marcar` | **Tensión:** hoy el CLIENTE cancela lo suyo y la matriz le niega `cita.estado.marcar`. Necesita decisión del dueño. |
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
| 111 | `POST /shops/:shopId/combos/` | `catalogo.servicios.gestionar` | La matriz no nombra combos; se propone la acción del catálogo. |
| 112 | `GET /shops/:shopId/combos/:id` | `sin acción` | Vitrina. |
| 113 | `PATCH /shops/:shopId/combos/:id` | `catalogo.servicios.gestionar` | Ídem. |
| 114 | `PATCH /shops/:shopId/combos/:id/deactivate` | `catalogo.servicios.gestionar` | Ídem. |
| 115 | `PATCH /shops/:shopId/combos/:id/reactivate` | `catalogo.servicios.gestionar` | Ídem. |
| 116 | `POST /shops/:shopId/categorias/` | `catalogo.categorias.gestionar` | **Brecha actual:** hoy ADMIN_BARBERIA; la matriz lo da solo al ADMINISTRADOR. |
| 117 | `GET /shops/:shopId/categorias/` | `catalogo.categorias.ver` | — |
| 118 | `PATCH /shops/:shopId/categorias/:id` | `catalogo.categorias.gestionar` | **Brecha actual:** hoy ADMIN_BARBERIA. |
| 119 | `GET /shops/:shopId/categorias/:id` | `catalogo.categorias.ver` | — |
| 120 | `GET /shops/:shopId/servicios` | `sin acción` | Catálogo anidado de la vitrina del cliente. |
| 121 | `POST /shops/:shopId/mis-servicios` | `sin acción` — **brecha** | Publicación propia del barbero; la matriz le niega `catalogo.servicios.gestionar` y no tiene acción alternativa. |
| 122 | `GET /shops/:shopId/mis-servicios` | `sin acción` — **brecha** | Ídem (lectura propia). |
| 123 | `PATCH /shops/:shopId/mis-servicios/:id` | `sin acción` — **brecha** | Ídem (edición propia). |

## 4 · Lo que esta tabla no hace

- No cambia controladores, guards ni decoradores.
- No modifica `docs/MATRIZ_PERMISOS_OBJETIVO.md` (PR #172) ni `test/permisos-matriz.spec.ts`.
- No propone fusionar nada. T-10, T-11 y T-12 siguen sin empezar.

## 5 · Brechas para decisión del dueño

Estas rutas son operaciones de sede o de plataforma que la matriz objetivo no cubre.
Hasta que se decida, no se tocan:

1. **Cobrar** (`POST /shops/:shopId/payments/`, `POST /pagos/cobrar`): falta `pagos.cobrar`.
2. **Lectura de personal** (`GET /shops/:shopId/staff`): la matriz solo tiene `personal.gestionar`.
3. **Configuración de sede** (`GET|PATCH /shops/:shopId/settings/`).
4. **Analíticas de sede** (`GET …/analytics/`, `…/analytics/export`): propuestas como `caja.ver_y_cerrar`.
5. **Panel multisede** (`GET /shops/overview`).
6. **Bloqueos y disponibilidad** (`schedule/blocks`, `schedule/availability`, `schedule/slots`).
7. **Bandejas de plataforma** (`solicitudes-cambio`, `vinculaciones`): la resolución es de la plataforma.
8. **Restringidos locales** (`restricted-clients/`).
9. **Cancelación del cliente** (`POST …/:id/cancel`): la matriz le niega `cita.estado.marcar`.
10. **Propuesta de horario del cliente** (`POST …/:id/propose-time`).
11. **Publicación propia del barbero** (`mis-servicios`).
12. **Combos** y **reasignación de barbero** (`PATCH /reservas/:id/asignar-barbero`).
13. **`horario.base.aprobar` no tiene ruta.** Es la única de las 21 acciones de la matriz
    sin endpoint: el barbero propone su plantilla en `PUT …/mi-horario/base`, pero no
    existe la ruta con la que la sede la aprueba o rechaza.
