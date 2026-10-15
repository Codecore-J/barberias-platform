# PLAN_MIGRACION_SOFT_DELETE.md

**Tarea:** E2-07 · Transición a soft-deletes («Phase-Out» del borrado físico).
**Fecha:** 2026-10-15 · **Estado:** Cableado del frontend cerrado (P-SD-1, P-SD-2, P-SD-7)

## 4 · Plan de lo que realmente falta

| # | Severidad | Qué | Estado |
| :--- | :--- | :--- | :--- |
| **P-SD-1** | **Alta** | **`reactivar` existe en la API pero no se puede alcanzar desde la app** | [EJECUTADO] |
| **P-SD-2** | **Alta** | **La acción que desbloquea el 422 `SERVICIO_EN_COMBO_ACTIVO` no tiene llamador en el frontend** | [EJECUTADO] |
| **P-SD-3** | Media | **Suspender una sede no se audita ni propaga** | Pendiente |
| **P-SD-4** | Media | **`servicios.estado` y `combos.estado` sin CHECK** | Pendiente |
| **P-SD-5** | Media | **La guarda de E2-07 no cubre el nivel de datos ni el frontend** | [EJECUTADO] |
| **P-SD-6** | Baja | **Vocabulario del frontend** | [EJECUTADO] |
| **P-SD-7** | Baja | Documentación que aún dice que E2-07 está pendiente | [EJECUTADO] |
| **P-SD-8** | Baja | **E2-08** (`docs/MATRIZ_CUMPLIMIENTO.md`) sigue sin existir | Pendiente |

## 5 · Cómo se cerraron P-SD-1, P-SD-2 y P-SD-7

Rama `fix/soft-delete-frontend-wiring` (desde `main`, sin merge).

- **P-SD-1 · «Reactivar» inalcanzable.** El botón existía pero la lista del panel no
  podía mostrar un ítem INACTIVO: `GET /servicios` y `GET /catalogo/combos` filtraban
  `estado: 'ACTIVO'` para todo el mundo. Ahora `findAll` deja ver los inactivos al
  ADMIN_BARBERIA de la sede y al ADMINISTRADOR global (el CLIENTE sigue viendo solo
  ACTIVOS, que es la regla de E2-07), y el panel pinta badge `ACTIVO`/`INACTIVO` con
  la tarjeta atenuada. Desactivar ya no hace desaparecer el ítem: se queda a la vista
  con el botón cambiado a «Reactivar».
- **P-SD-2 · desactivar combos sin llamador.** El frontend nunca pedía
  `/catalogo/combos`, así que la pestaña «Combos» estaba siempre vacía y
  `desactivarCombo` no tenía a quién llamar —justo la acción que libera a un servicio
  del 422 `SERVICIO_EN_COMBO_ACTIVO`—. `ServiciosService.cargarServicios(true)`
  compone servicios + combos (los combos entran con `esCombo: true` y su
  `precioEspecial`/`duracionPropia` normalizados) y el toggle elige el endpoint según
  ese flag. Si la lectura de combos falla, el catálogo del admin se degrada a solo
  servicios en lugar de quedarse en blanco.
- **P-SD-7 · documentación obsoleta.** `docs/PLAN_SPRINT_ESTABILIZACION.md` seguía
  dando E2-07 por pendiente «siguen 4 `@Delete`». `grep @Delete src/` = 0 rutas, así
  que la fila se corrige; y `docs/MATRIZ_RUTAS.md` pasa a declarar los llamadores
  reales del frontend en las rutas 49 y 54.
