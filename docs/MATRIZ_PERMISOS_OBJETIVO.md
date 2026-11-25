# Matriz de permisos objetivo
## Fuente de verdad · decisiones del dueño del 20-23 nov 2026
Plan de referencia: docs/PLAN_ROLES_CATALOGO.md

> Esta matriz define **cómo debe ser** el sistema. Si el código actual no coincide,
> el código es el que hay que cambiar, no la matriz. No derives esta tabla del código.

Convenciones: ✅ permitido · ❌ prohibido (403 `ACCION_NO_PERMITIDA_PARA_ROL`) ·
condición entre paréntesis cuando el permiso no es total.

## 1 · Matriz

| ID de acción | ADMINISTRADOR | ADMIN_BARBERIA | BARBERO | CLIENTE |
|---|:-:|:-:|:-:|:-:|
| `plataforma.metricas.ver` | ✅ | ❌ | ❌ | ❌ |
| `plataforma.sedes.gestionar` (crear, suspender) | ✅ | ❌ | ❌ | ❌ |
| `plataforma.usuarios.gestionar` (crear, suspender, eliminar) | ✅ | ❌ | ❌ | ❌ |
| `plataforma.auditoria.ver` | ✅ | ❌ | ❌ | ❌ |
| `catalogo.categorias.gestionar` (crear, editar, eliminar) | ✅ | ❌ | ❌ | ❌ |
| `catalogo.categorias.ver` | ✅ | ✅ | ✅ | ✅ (solo de sus sedes) |
| `catalogo.servicios.gestionar` (crear, editar, desactivar) | ❌ | ✅ | ❌ | ❌ |
| `personal.gestionar` (invitar, desactivar, horario base) | ❌ | ✅ | ❌ | ❌ |
| `horario.base.aprobar` (propuestas de cambio base) | ❌ | ✅ | ❌ | ❌ |
| `excepciones.ajenas.gestionar` (ver, modificar, revocar) | ❌ | ✅ | ❌ | ❌ |
| `excepciones.propias.registrar` | ❌ | ✅ | ✅ | ❌ |
| `agenda.sede.ver` (todas las columnas) | ❌ | ✅ | ❌ | ❌ |
| `agenda.propia.ver` (solo su columna) | ❌ | ❌ | ✅ | ❌ |
| `walkin.crear` | ❌ | ✅ | ✅ | ❌ |
| `cita.estado.marcar` | ❌ | ✅ (todas de la sede) | ✅ (solo sus citas) | ❌ |
| `solicitudes_cambio.gestionar` | ❌ | ✅ | ❌ | ❌ |
| `antecedentes.solicitar` | ❌ | ✅ | ✅ | ❌ |
| `antecedentes.resolver` (aprobar, denegar) | ✅ | ❌ | ❌ | ❌ |
| `antecedentes.ver` | ✅ (todos) | ✅ (su sede) | ✅ (solo clientes con cita suya) | ❌ |
| `caja.ver_y_cerrar` | ❌ | ✅ | ❌ | ❌ |
| `pagos.anular` | ❌ | ✅ | ❌ | ❌ |
| `plataforma.solicitudes_cambio.gestionar` (resolver lo que proponen las sedes) | ✅ | ❌ | ❌ | ❌ |
| `plataforma.vinculaciones.gestionar` (6.ª vinculación) | ✅ | ❌ | ❌ | ❌ |
| `cita.propia.cancelar` (solo su propia reserva) | ❌ | ❌ | ❌ | ✅ |
| `cita.propia.proponer_horario` (solo su propia reserva) | ❌ | ❌ | ❌ | ✅ |
| `pagos.cobrar` (toda la sede / solo sus citas) | ❌ | ✅ | ✅ (solo sus citas) | ❌ |
| `configuracion.sede.ver` | ✅ (solo lectura) | ✅ | ❌ | ❌ |
| `configuracion.sede.gestionar` | ❌ | ✅ | ❌ | ❌ |
| `restringidos_locales.ver` | ✅ (solo lectura) | ✅ | ❌ | ❌ |
| `restringidos_locales.gestionar` | ❌ | ✅ | ❌ | ❌ |

> Las **nueve altas del 22 nov 2026 quedaron aprobadas el 23 nov 2026** (§4): ya no son
> pendientes ni llevan †. Las **21 filas anteriores no cambian**: ninguna celda vigente se
> mueve, las altas solo añaden. La matriz queda en **30 acciones**.

## 2 · Reglas que acompañan a la matriz

- **Cuenta dual (ADMIN_BARBERIA + BARBERO en la misma sede):** tiene la unión de permisos de ambos roles. La agenda completa prevalece sobre la columna propia.
- **Sin sede activa:** ninguna acción de sede está permitida; ADMIN_BARBERIA y BARBERO reciben 422 `SEDE_REQUERIDA`, no 403.
- **Ámbito:** ADMIN_BARBERIA y BARBERO solo actúan sobre la sede a la que están vinculados (fail-closed).
- **Antecedentes (C-5):** un BARBERO solo ve antecedentes de clientes que tienen o tuvieron una cita con él.
- **Eliminación de categorías:** si tiene servicios, responde 409 `CATEGORIA_CON_SERVICIOS` y no la elimina.
- **Cobro (22 nov):** el BARBERO cobra solo sus citas; una reserva sin barbero asignado la
  cobra el ADMIN_BARBERIA (E3-09). El ADMINISTRADOR **no cobra nunca**.
- **Solo lectura del global (22 nov):** el ADMINISTRADOR ve la configuración de sede y los
  clientes restringidos, y no los cambia. El `RolesGuard` lo deja pasar por jerarquía, así
  que las dos rutas de escritura necesitan un guard que lo excluya expresamente.
- **Solicitudes del barbero (22-23 nov):** el barbero no publica servicios. Manda una
  **solicitud** con nombre, categoría, duración, precio, descripción e imagen; el
  ADMIN_BARBERIA la aprueba —y el servicio se crea— o la rechaza con motivo. Estados:
  `PENDIENTE`, `APROBADA`, `RECHAZADA`. El horario base sigue el mismo esquema.
- **Dónde aterriza el alta (23 nov):** el servicio aprobado entra al catálogo de la sede
  (`Servicio`) y habilita al barbero que lo pidió en `ServicioBarbero` con **su** precio. Por
  eso un servicio pedido por el barbero sí puede entrar en un combo. Habilitar a otros
  barberos es `catalogo.servicios.gestionar`, no una solicitud.
- **Desactivar un servicio aprobado (23 nov):** requiere **solicitud**, resuelta por el
  ADMIN_BARBERIA. El barbero no desactiva lo publicado por su cuenta.
- **Pedir servicios no tiene acción propia (23 nov):** las rutas del barbero son
  autoservicio propio y la matriz sigue en 30 acciones.
- **Audiencia por ruta (23 nov):** ninguna ruta lleva dos acciones según el alcance del
  usuario: si la ruta es de sede vale la acción de sede, y si es de plataforma, la de
  plataforma. `GET /shops/overview` es de sede (`caja.ver_y_cerrar`); el consolidado global va
  por `GET /plataforma/overview` (`plataforma.metricas.ver`, ruta nueva).
- **Combos (22 nov):** solo el ADMIN_BARBERIA los crea y edita. No hay solicitudes de combo.

## 3 · Lo que la matriz quita respecto al estado actual

- ADMINISTRADOR pierde: `agenda.sede.ver`, `walkin.crear`, `caja.ver_y_cerrar`, `pagos.anular`, `personal.gestionar`, `solicitudes_cambio.gestionar`.
- ADMINISTRADOR gana: `catalogo.categorias.gestionar`.
- BARBERO pierde la vista de la agenda completa; solo ve `agenda.propia.ver`.
- ADMIN_BARBERIA pierde `catalogo.categorias.gestionar`; conserva `catalogo.categorias.ver`.
- ADMINISTRADOR pierde el cobro que hoy ejerce por jerarquía: `pagos.cobrar` es ❌ para él
  (22 nov).
- ADMINISTRADOR pierde la escritura de la configuración de sede y de los clientes
  restringidos; conserva la lectura (22 nov).
- BARBERO pierde publicar y editar servicios por su cuenta: pasan por solicitud aprobada
  (22 nov).
- BARBERO pierde desactivar un servicio publicado: pide la desactivación al ADMIN_BARBERIA
  (23 nov).

## 4 · Control de cambios

Esta matriz solo cambia por decisión explícita del dueño, registrada en el backlog con fecha.

| Fecha | Cambio | Fuente |
|---|---|---|
| 20 nov 2026 | Versión inicial: 21 acciones. | `docs/PLAN_ROLES_CATALOGO.md` |
| 22 nov 2026 | Nueve altas, ninguna fila vigente modificada: `plataforma.solicitudes_cambio.gestionar`, `plataforma.vinculaciones.gestionar`, `cita.propia.cancelar`, `cita.propia.proponer_horario`, `pagos.cobrar`, `configuracion.sede.ver`, `configuracion.sede.gestionar`, `restringidos_locales.ver`, `restringidos_locales.gestionar`. | Decisiones del dueño del 22 nov; el mapa de rutas que las usa está en el PR #174 (`docs/MATRIZ_RUTAS_ACCIONES.md`). |
| 23 nov 2026 | Las nueve altas pasan de † a definitivas; ninguna celda cambia y la matriz sigue en **30 acciones**. El alta aprobada aterriza en `Servicio` + `ServicioBarbero` del solicitante; la desactivación del servicio publicado es solicitud; pedir servicios no lleva acción propia; la audiencia se fija por la ruta. | Decisiones cerradas del dueño del 23 nov; rutas en el PR #174. |

## 5 · Rutas de las solicitudes

Las altas del 22 nov se aplican sobre estas rutas. Las marcadas **nueva** no existen todavía:
las crea T-12 junto con los estados.

| Ruta | Quién | Qué hace | Acción |
|---|---|---|---|
| `POST /shops/:shopId/mis-servicios` | BARBERO | Crea la solicitud `PENDIENTE` de **alta** o de **desactivación** de un servicio publicado (tipo en el cuerpo). Hoy publica el servicio directamente. | autoservicio propio (sin acción) |
| `GET /shops/:shopId/mis-servicios` | BARBERO | Sus solicitudes y servicios aprobados, con estado y motivo. | autoservicio propio (sin acción) |
| `PATCH /shops/:shopId/mis-servicios/:id` | BARBERO | Edita la solicitud mientras está `PENDIENTE`; 409 si ya está resuelta. | autoservicio propio (sin acción) |
| `GET /shops/:shopId/solicitudes-servicio` (**nueva**) | ADMIN_BARBERIA | Bandeja de solicitudes `PENDIENTE` de la sede, de alta y de desactivación. | `catalogo.servicios.gestionar` |
| `PATCH /shops/:shopId/solicitudes-servicio/:id` (**nueva**) | ADMIN_BARBERIA | Alta: `{aprobar:true}` crea el servicio en `Servicio` y habilita al solicitante en `ServicioBarbero` con su precio; desactivación: `{aprobar:true}` desactiva el servicio publicado. `{aprobar:false,motivoRechazo}` deja la solicitud `RECHAZADA` (422 `MOTIVO_RECHAZO_REQUERIDO`). | `catalogo.servicios.gestionar` |
| `PUT /shops/:shopId/mi-horario/base` | BARBERO | Crea la propuesta `PENDIENTE` de esa sede (F4-03); ya no escribe la plantilla vigente. | `excepciones.propias.registrar` |
| `GET /shops/:shopId/hours/` | ADMIN_BARBERIA | Es donde se leen las propuestas de horario pendientes, sin bandeja aparte: desde F4-05 devuelve `{ horarios, propuestasBasePendientes }`. | `agenda.sede.ver` |
| `PATCH /shops/:shopId/hours/barbers/:barberoId/base` (**F4-04**) | ADMIN_BARBERIA | Aprueba o rechaza la propuesta; el rechazo exige motivo (422 `MOTIVO_RECHAZO_REQUERIDO`). | `horario.base.aprobar` |

- El barbero no edita un servicio publicado: para un cambio manda una solicitud nueva; para
  desactivarlo, una solicitud de desactivación.
- Las dos solicitudes comparten estados (`PENDIENTE`, `APROBADA`, `RECHAZADA` con motivo).
  La de servicio añade descripción e imagen, que hoy no existen en ninguna de las dos tablas
  del catálogo, y la imagen necesita definir dónde se guarda.
- **Decidido (23 nov):** el alta aprobada aterriza en `Servicio` (sede y combos) y crea la
  fila `ServicioBarbero` del barbero solicitante con su precio. Desactivar un servicio
  publicado también es una solicitud. Y el consolidado global tiene su propia ruta,
  `GET /plataforma/overview`, porque la audiencia se fija por la ruta.
