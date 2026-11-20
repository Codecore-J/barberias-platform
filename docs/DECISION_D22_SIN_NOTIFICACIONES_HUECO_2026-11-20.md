# Decisión D22-rev · Sin notificaciones a clientes por huecos liberados

**Fecha:** 2026-11-20 · **Rama:** `docs/decision-d22-sin-notificaciones-hueco` · **Base:** `main`
**Origen:** decisión del dueño (punto C del encargo del 20 nov 2026) · **Sin cambios de código**

## Decisión

> **D22-rev · Decisión del dueño (20 nov 2026): no se envían notificaciones a clientes por huecos
> liberados. Carril B (T-19) descartado. Carril A se mantiene.**

T-19 queda **descartado por decisión**, no pendiente. Esta revisión **confirma** el cierre documental del
2026-11-18 (`docs/CIERRE_T19_2026-11-18.md`) y no añade ni retira comportamiento.

## Estado verificado del código (solo lectura)

| Pieza | Estado |
|---|---|
| Fan-out proactivo a elegibles de D22 (≤ 25, sin duplicados, job idempotente por hueco) | **No existe código.** Cero coincidencias de `elegibles`, `OportunidadEspacio`, `oportunidadEspacio` o `fan-out` en `backend-barberias/src`. Nunca se implementó. |
| Notificación `OPORTUNIDAD_ESPACIO` | **No existe** como tipo ni como constante en el repositorio. |
| Carril A · alternativas en el `409 CONFLICTO_HORARIO` y `GET /barberias/:barberiaId/disponibilidad/huecos` | **Vigente y sin notificaciones.** `DisponibilidadService.huecosDeLaSede` y `buscarAlternativas` son solo lectura; el módulo `agenda` no importa ni referencia notificaciones. |
| Bandera `configuracion_barberia.oportunidades_espacio_activas` | `BOOLEAN NOT NULL DEFAULT TRUE`; en producción **4 de 4** sedes en `TRUE` (consulta con el rol `barberias_app`). No se modifica. |

## Fuera de esta decisión (pendiente de confirmación del dueño)

La **lista de espera con suscripción explícita** (`src/lista-espera/`, opt-in) sí envía un aviso FIFO cuando se
libera un hueco: job `HUECO_LIBERADO` → `ListaEsperaMatcherService` → notificación
`LISTA_ESPERA_HUECO_LIBERADO`. Es una pieza distinta del fan-out de D22 y el cierre del 2026-11-18 la mantuvo
vigente. **No se toca en este PR**: se reporta al dueño para que confirme si la decisión D22-rev también la
alcanza.

Tampoco se toca la notificación `RESERVA_CANCELADA` que recibe el cliente cuando **su propia cita** se cancela.

## Lo que NO cambia

- Sin migraciones ni cambios de esquema.
- Sin cambios en el valor por defecto de `oportunidades_espacio_activas`.
- Sin cambios en el Carril A, en la lista de espera ni en las notificaciones de reserva.
- Sin escrituras en producción.
