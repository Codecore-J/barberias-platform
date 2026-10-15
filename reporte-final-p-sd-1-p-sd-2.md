# Reporte 8.4 · P-SD-1 / P-SD-2 / P-SD-7 — Cableado del frontend para el soft-delete

**Rama:** `fix/soft-delete-frontend-wiring` (desde `main` = `ac9cc78`)
**Fecha:** 2026-10-15 · **Estado:** Completo · **Merge:** no (según solicitud)

## 1 · Objetivo

Cerrar E2-07 por el lado de la UI: que el catálogo de administración muestre el
estado de cada servicio y combo y permita el toggle Desactivar/Reactivar, de modo
que `reactivar` (P-SD-1) y `desactivarCombo` (P-SD-2) sean alcanzables desde la app.

## 2 · Lo primero: dos cosas que la UI necesitaba y no estaban

El encargo daba por hecho que «el backend envía los servicios inactivos». Al
comprobarlo contra la rama, no era así, y las dos piezas que faltaban para que el
toggle tuviera sentido viajan en esta rama:

1. **`GET /servicios` y `GET /catalogo/combos` filtraban `estado: 'ACTIVO'` para
   todo el mundo.** Con esa regla, desactivar un ítem lo hacía desaparecer de la
   lista y «Reactivar» quedaba inalcanzable: el hallazgo P-SD-1 no se arregla
   pintando un botón, se arregla dejando que el ADMIN de la sede vea también los
   inactivos. Es el cambio de visibilidad por rol de P-SD-5/P-SD-6, que vive en la
   rama **sin fusionar** `fix/soft-delete-endpoints` (`332f7f8`,
   `git branch -a --contains 332f7f8` → solo esa rama; `refs/heads/main` sigue en
   `ac9cc78`). Se incorpora aquí **idéntico** para que la UI funcione: si ese PR se
   fusiona antes, los hunks son los mismos y no hay conflicto.
2. **El frontend nunca pedía `/catalogo/combos`.** La pestaña «Combos» estaba
   siempre vacía y `desactivarCombo` no tenía a quién llamar, que es justo la
   acción que libera a un servicio del 422 `SERVICIO_EN_COMBO_ACTIVO`: P-SD-2 no
   estaba resuelto, solo estaba escrito el método.

## 3 · Componentes modificados

### Backend

| Fichero | Cambio |
| :--- | :--- |
| `backend-barberias/src/catalogo/application/servicios.service.ts` | `findAll(barberiaId, usuario?)`: el ADMIN_BARBERIA de la sede y el ADMINISTRADOR global reciben también los INACTIVOS; el CLIENTE sigue viendo solo ACTIVOS |
| `backend-barberias/src/catalogo/application/combos.service.ts` | Igual para los combos |
| `backend-barberias/src/catalogo/infrastructure/servicios.controller.ts` | `GET` pasa `@CurrentUser()` al servicio |
| `backend-barberias/src/catalogo/infrastructure/combos.controller.ts` | Igual |
| `backend-barberias/src/catalogo/application/servicios.service.spec.ts` | 3 casos nuevos de visibilidad por rol |
| `backend-barberias/src/catalogo/application/combos.service.spec.ts` | 3 casos nuevos de visibilidad por rol |
| `backend-barberias/test/e2-07-vocabulario.e2e-spec.ts` | 2 E2E nuevos (servicios y combos) + la aserción de catálogo pasa a distinguir cliente y admin |

### Frontend

| Fichero | Cambio |
| :--- | :--- |
| `frontend-barberias/src/app/core/services/servicios.service.ts` | `cargarServicios(incluirCombos)` compone servicios + combos (`forkJoin`), normaliza el combo a la forma de la tabla (`esCombo: true`, `precioEspecial` → `precio`, `duracionPropia` → `duracionMinutos`, `estado`), ordena por nombre y degrada a solo servicios si la lectura de combos falla. Las seis escrituras recargan el catálogo completo. |
| `frontend-barberias/src/app/features/admin/admin-servicios.component.ts` | Badge `ACTIVO`/`INACTIVO` + tarjeta atenuada, botón toggle «Desactivar»/«Reactivar» en un solo camino (`toggleEstado`), y el `mensaje` del 422 visible en la lista (antes solo se pintaba dentro del formulario, así que la regla de negocio se perdía). `confirmDelete` eliminado: ya no tenía botón ni decía la verdad de E2-07. |
| `frontend-barberias/src/app/core/services/servicios.service.spec.ts` | **Nuevo.** 8 casos: la vista de cliente no pide combos, el catálogo del admin suma el combo y conserva el INACTIVO, orden por nombre, degradación si los combos fallan, el 422 deja su mensaje en `error()` sin recargar, y los endpoints de combo/servicio usados por el toggle. |

## 4 · Verificación ejecutada

| Comprobación | Comando | Resultado |
| :--- | :--- | :--- |
| Build Angular | `cd frontend-barberias && npx ng build` | **exit 0** — «Application bundle generation complete» |
| Tests frontend | `cd frontend-barberias && npx ng test --watch=false` | **exit 0** — 17/17 (3 ficheros; 8 son los nuevos) |
| Lint frontend | `npx oxlint src` | **exit 0** — 0 warnings, 0 errores (44 ficheros) |
| Tests unitarios backend | `cd backend-barberias && npx vitest run src` | **exit 0** — 493/493, 41 ficheros |
| E2E de E2-07 (contra la BD de dev) | `APP_ENV=dev npx vitest run --config ./vitest.config.e2e.ts test/e2-07-vocabulario.e2e-spec.ts` | **exit 0** — 7/7, incluidos `visibilidad por rol: inactivos ocultos al cliente, visibles al admin` y `visibilidad de combos por rol y endpoints de transición` |
| Typecheck backend | `npx tsc -p tsconfig.build.json --noEmit` | **exit 0** |
| Lint backend | `npx oxlint --type-aware src/catalogo test/e2-07-vocabulario.e2e-spec.ts` | **exit 0** |

El E2E es el que prueba el contrato que consume la UI: el admin recibe el INACTIVO
por `GET`, el cliente no. El spec del servicio prueba la composición y el mensaje.

## 5 · Documentación

- `PLAN_MIGRACION_SOFT_DELETE.md`: **P-SD-1, P-SD-2 y P-SD-7** en `[EJECUTADO]`, con
  el apartado 5 explicando cómo se cerró cada uno.
- `docs/PLAN_SPRINT_ESTABILIZACION.md`: la fila de E2-07 y P3.8 ya no dicen «siguen
  4 `@Delete`» / «`grep @Delete` = 4 rutas» — son **0** rutas (P-SD-7).
- `docs/MATRIZ_RUTAS.md`: las rutas 49 y 54 declaran por fin sus llamadores reales
  del frontend (`desactivarServicio`/`reactivarServicio`, `desactivarCombo`/`reactivarCombo`
  y el toggle del panel).

## 6 · Commits

1. `fix(catalogo): findAll deja ver los inactivos al admin de la sede (P-SD-1)` — backend + specs + E2E.
2. `feat(frontend): cablea el toggle de estado del catálogo (P-SD-1/P-SD-2/P-SD-7)` — UI, spec nuevo y documentación.

La rama arrastra además `a16b991`, el primer intento de este mismo cableado
(ya estaba pusheado): añadió el botón y la interfaz, pero sin combos que listar ni
inactivos que mostrar, así que ni P-SD-1 ni P-SD-2 quedaban resueltos. Estos dos
commits lo completan; el diff de la rama contra `main` es lo que hay que revisar.
Se dejó la historia sin reescribir para no forzar el push.

Push a `origin/fix/soft-delete-frontend-wiring`. **Sin merge.**

## 7 · Lo que queda (no tocado en esta rama)

- **P-SD-3** (suspender una sede no se audita ni propaga) y **P-SD-4** (`estado` sin
  CHECK en la base): siguen en la rama `fix/soft-delete-gaps`, sin fusionar.
- **P-SD-8**: `docs/MATRIZ_CUMPLIMIENTO.md` (E2-08) no existe. No es de este encargo.
- **Hallazgo adyacente, sin arreglar:** el formulario del panel envía `descripcion`,
  `esCombo` y `serviciosComboIds`, pero `CreateServicioDto` no declara ninguno de los
  tres y el `ValidationPipe` global corre con `forbidNonWhitelisted: true`, así que
  **crear o editar un servicio desde ese formulario responde 400** y la casilla «Es un
  Combo» no crea combos (los combos se crean por `/catalogo/combos`). Comprobado
  ejecutando el `ValidationPipe` con esa configuración sobre el payload exacto del
  formulario: lanza `BadRequestException`. Es anterior a esta rama y toca el contrato
  del formulario, no el soft-delete: queda como hallazgo para decidir aparte.
- **Observación de producto:** los combos solo se ven en el panel de administración.
  El catálogo público y el wizard siguen leyendo `/servicios`, así que un cliente no
  puede ver ni reservar un combo. Si E2-07 pretende venderlos, hace falta decidir la
  semántica de reservar un combo (hoy la reserva se arma con `servicioId`s).
