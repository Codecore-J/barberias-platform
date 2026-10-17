# Reporte · La sede activa la autoriza y la registra el backend (hallazgo 2)

- **Rama:** `feat/sincronizar-sede-activa-backend`, sobre `main` `4d34c50` (sin merge).
- **Fecha:** 2026-10-17.
- **Alcance:** solo frontend (`frontend-barberias/`) y documentación. El backend NO cambia: `PATCH /barberias/:id/seleccionar` ya existía, ya autoriza el vínculo (fila 14 de `docs/MATRIZ_RUTAS.md`) y ya registra la marca `es_barberia_activa` en la misma transacción que apaga las demás.

## Qué constaba

Hallazgo 2 de `docs/MATRIZ_RUTAS.md`: *la sede activa del frontend no pasa por `/seleccionar`*. El matiz, comprobado en el código: el botón «Seleccionar» YA llamaba a la ruta antes de tocar el estado local —ese camino estaba bien—, pero `sincronizarSedeActiva` elegía la sustituta en LOCAL (caché → `esBarberiaActiva` → la primera) y la guardaba en `localStorage` sin preguntarle a nadie. Consecuencias: `es_barberia_activa` en la base podía no coincidir con la sede que operaba el navegador, y una sede podía volverse «activa» en la sesión con solo aparecer en la lista, sin que el backend validara el momento del cambio.

## Qué se hizo

1. **Una sola puerta:** `pedirSeleccion()` concentra el único `PATCH /barberias/:id/seleccionar` del servicio. Lo comparten el botón (`seleccionarBarberia`) y el auto-pick (`sincronizarSedeActiva`).
2. **Regla de fijación:** el estado local —señal `barberiaActiva`, `active_barberia_id` y `active_barberia_data`— solo se toca en el `tap`, tras el 200. Si el backend falla (403 de un vínculo `PENDIENTE_APROBACION`, 404 de una sede sin vínculo, o caída de red) la sede anterior sigue siendo la activa, el mensaje del contrato D40 queda en `error()` y el error se propaga al llamador.
3. **Auto-pick autorizado:** `sincronizarSedeActiva` distingue dos ramas. La misma sede que ya era activa y sigue en la lista solo refresca su objeto cacheado (no hubo cambio de manos: la eligió el usuario y el backend la registró al fijarla), sin petición. Toda sede que PASA a ser activa pide el cambio al backend y no se fija hasta el 200. Cubre los tres caminos de sustitución: la de una sede purgada por H74, la que el backend marcó `esBarberiaActiva` y la primera de un dispositivo nuevo.
4. **Pantalla:** `barberias.component.ts` muestra el error del tenant en un banner propio (antes solo se pintaba `miEstado.error()`), y `seleccionar()` deja de dejar el fallo como error no manejado: no navega y el banner explica por qué. `crearBarberia` hace lo mismo con su selección encadenada.

## Evidencia

- **ROJO** (servicio viejo restaurado desde HEAD, vuelto a poner después): `Test Files 1 failed | 5 passed (6)` · `Tests 5 failed | 38 passed (43)`, `EXIT=1`. Los cinco fallos son los del contrato nuevo: el auto-pick ya no emitía la petición (`Expected one matching request for criteria "Match URL: .../barberias/b9/seleccionar", found none`), la sustituta se fijaba sin esperar al backend y el error del intento anterior no se borraba.
- **VERDE:** `npm run test -- --watch=false` → `Test Files 6 passed (6)` · `Tests 43 passed (43)`, `EXIT=0` (13 casos en `src/app/core/services/tenant.service.spec.ts`, 5 de ellos nuevos); `npm run lint` (oxlint) → `Found 0 warnings and 0 errors.`, `EXIT=0`; `npx ng build` → `Application bundle generation complete`, `EXIT=0`.
- **Backend intacto:** `git diff --stat` no toca ningún fichero de `backend-barberias/`.
- **Documentación:** hallazgo 2 marcado como arreglado en `docs/MATRIZ_RUTAS.md`, y el límite (c) de H74 (el único que apuntaba a este hueco) queda cerrado en `AUDITORIA_HALLAZGOS.md`.

## Límites conocidos

- (a) El staff (BARBERO, ADMIN_BARBERIA, ADMINISTRADOR) no tiene dónde registrar la sede activa en el backend: la marca vive en `cliente_barberias`, tabla de cliente. Su sesión sigue reconstruyéndose desde `localStorage`, igual que antes; lo nuevo es que esa reconstrucción local ya no fija nada sin la autorización del backend.
- (b) Al arrancar en un dispositivo nuevo (sin caché) hay una ventana —la ida y vuelta del PATCH— en la que no hay sede activa y `tenantGuard` manda al hub de sedes. Es el mismo comportamiento que ya existía en ese escenario, ahora con una petición de por medio.
- (c) `/seleccionar` no deja rastro en la tabla de auditoría: `seleccionarBarberiaActiva` escribe la marca y un `logger.log`, nada más. Si se quiere trazabilidad de quién cambió de sede y cuándo, es tarea de backend.
- (d) El banner de error y los `error: () => undefined` de los componentes no tienen prueba unitaria (el proyecto no tiene pruebas de componente): esa pantalla se verifica con lint y build, igual que en H74.
