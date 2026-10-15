# PLAN_MIGRACION_SOFT_DELETE.md

**Tarea:** E2-07 · Transición a soft-deletes («Phase-Out» del borrado físico).
**Fecha:** 2026-10-14 · **Estado:** En ejecución

## 4 · Plan de lo que realmente falta

| # | Severidad | Qué | Estado |
| :--- | :--- | :--- | :--- |
| **P-SD-1** | **Alta** | **`reactivar` existe en la API pero no se puede alcanzar desde la app** | [EJECUTADO] |
| **P-SD-2** | **Alta** | **La acción que desbloquea el 422 `SERVICIO_EN_COMBO_ACTIVO` no tiene llamador en el frontend** | [EJECUTADO] |
| **P-SD-3** | Media | **Suspender una sede no se audita ni propaga** | Pendiente |
| **P-SD-4** | Media | **`servicios.estado` y `combos.estado` sin CHECK** | Pendiente |
| **P-SD-5** | Media | **La guarda de E2-07 no cubre el nivel de datos ni el frontend** | [EJECUTADO] |
| **P-SD-6** | Baja | **Vocabulario del frontend** | [EJECUTADO] |
| **P-SD-7** | Baja | Documentación que aún dice que E2-07 está pendiente | Pendiente |
| **P-SD-8** | Baja | **E2-08** (`docs/MATRIZ_CUMPLIMIENTO.md`) sigue sin existir | Pendiente |

