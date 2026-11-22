# Matriz de permisos objetivo
## Fuente de verdad · decisiones del dueño del 20-22 nov 2026
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

## 2 · Reglas que acompañan a la matriz

- **Cuenta dual (ADMIN_BARBERIA + BARBERO en la misma sede):** tiene la unión de permisos de ambos roles. La agenda completa prevalece sobre la columna propia.
- **Sin sede activa:** ninguna acción de sede está permitida; ADMIN_BARBERIA y BARBERO reciben 422 `SEDE_REQUERIDA`, no 403.
- **Ámbito:** ADMIN_BARBERIA y BARBERO solo actúan sobre la sede a la que están vinculados (fail-closed).
- **Antecedentes (C-5):** un BARBERO solo ve antecedentes de clientes que tienen o tuvieron una cita con él.
- **Eliminación de categorías:** si tiene servicios, responde 409 `CATEGORIA_CON_SERVICIOS` y no la elimina.

## 3 · Lo que la matriz quita respecto al estado actual

- ADMINISTRADOR pierde: `agenda.sede.ver`, `walkin.crear`, `caja.ver_y_cerrar`, `pagos.anular`, `personal.gestionar`, `solicitudes_cambio.gestionar`.
- ADMINISTRADOR gana: `catalogo.categorias.gestionar`.
- BARBERO pierde la vista de la agenda completa; solo ve `agenda.propia.ver`.
- ADMIN_BARBERIA pierde `catalogo.categorias.gestionar`; conserva `catalogo.categorias.ver`.

## 4 · Control de cambios

Esta matriz solo cambia por decisión explícita del dueño, registrada en el backlog con fecha.
