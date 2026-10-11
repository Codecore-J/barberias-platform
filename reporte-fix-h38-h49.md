INFORME: mini-sprint de estabilización E2E — H49 (fixtures vs CHECK de BD) y H38 (timeouts)
RAMA: fix/h38-h49-estabilizar-e2e (creada desde `main` @ fff6d54)
FECHA: 2026-10-11
RESULTADO: **los 7 archivos que estaban en rojo pasan a VERDE · 21/21 archivos · 151/151 tests (100 %) · 0 fallos · 0 saltados · exit 0**

1. QUÉ HICE (resumen)
   1. Fase 1: `git pull --ff-only` sobre `main` → «Already up to date», y rama `fix/h38-h49-estabilizar-e2e` creada.
   2. H49 · datos semilla: corregí todas las inserciones fuera de catálogo: `barberias.estado` `'ACTIVA'` → `'ACTIVO'` (3 archivos) y `cliente_barberias.estado_vinculacion` `'SUSPENDIDO'` → `'DESVINCULADO'` (1 archivo).
   3. H49 · código de producción: `vincularCliente` escribía `'PENDIENTE'` (fuera de D10) en la 6.ª vinculación — causa del 500 de `barberia.e2e-spec.ts`; ahora escribe `'PENDIENTE_APROBACION'` (D10 y BACKLOG: «Estado `PENDIENTE_APROBACION` (D10) para la 6ª»). Se actualizó el aserto y los mocks unitarios que fijaban el literal viejo.
   4. H38: `testTimeout: 30_000` global en `vitest.config.e2e.ts`; ninguna corrida necesita ya `--testTimeout`.
   5. Verificación: suite E2E completa 21/21 y 151/151; re-ejecución del archivo tocado después de la corrida; suite unitaria completa 38/393.

2. ARCHIVOS TOCADOS (git diff --stat, literal)
```
 AUDITORIA_HALLAZGOS.md                                         |  6 ++++--
 .../src/barberia/application/barberia.service.spec.ts          | 10 +++++-----
 backend-barberias/src/barberia/application/barberia.service.ts |  3 ++-
 backend-barberias/test/barberia.e2e-spec.ts                    |  6 +++---
 backend-barberias/test/e1-06-cross-tenant-admin.e2e-spec.ts    | 10 +++++-----
 backend-barberias/test/e3-03-validaciones.e2e-spec.ts          |  2 +-
 .../test/hallazgo16-rolesguard-global.e2e-spec.ts              |  2 +-
 backend-barberias/test/permisos-matriz.e2e-spec.ts             |  4 ++--
 backend-barberias/vitest.config.e2e.ts                         |  3 +++
 9 files changed, 26 insertions(+), 20 deletions(-)
```
Además: `AUDITORIA_HALLAZGOS.md` (H38 y H49 marcados como **resueltos**) y este informe (untracked).

Detalle por archivo:
| Archivo | Cambio |
|---|---|
| `vitest.config.e2e.ts` | `testTimeout: 30_000` global (H38) |
| `src/barberia/application/barberia.service.ts` | 6.ª vinculación: `'PENDIENTE'` → `'PENDIENTE_APROBACION'` (D10) |
| `src/barberia/application/barberia.service.spec.ts` | 2 mocks + 1 aserto + 1 nombre de test al literal D10 |
| `test/barberia.e2e-spec.ts` | título/comentario/aserto de la 6.ª vinculación → `PENDIENTE_APROBACION` |
| `test/e1-06-cross-tenant-admin.e2e-spec.ts` | `'SUSPENDIDO'` → `'DESVINCULADO'` (dato, comentarios y etiqueta de la tabla) |
| `test/e3-03-validaciones.e2e-spec.ts` | `estado: 'ACTIVA'` → `'ACTIVO'` |
| `test/hallazgo16-rolesguard-global.e2e-spec.ts` | `estado: 'ACTIVA'` → `'ACTIVO'` |
| `test/permisos-matriz.e2e-spec.ts` | `estado: 'ACTIVA'` → `'ACTIVO'` (×2) |

Causa raíz (constraint literal obtenida de `pg_constraint` de `dev`, solo lectura):
```
barberias_estado_check                  = CHECK (estado IN ('ACTIVO','INACTIVO'))
cliente_barberias_estado_vinculacion_check = CHECK (estado_vinculacion IN ('ACTIVO','PENDIENTE_APROBACION','DESVINCULADO'))
```
Los dos catálogos coinciden con D09/D10 del BACKLOG, así que se ajustaron los datos (no la BD).

3. TEST ROJO (antes del fix, salida literal de la corrida E3-11, `e2e_full_e311.log`)
```
 ❯ test/barberia.e2e-spec.ts (4 tests | 2 failed) 16214ms
 ...
 FAIL  test/e1-06-cross-tenant-admin.e2e-spec.ts > E1-06 · cross-tenant: el admin de A no alcanza los recursos de B
 FAIL  test/e3-03-validaciones.e2e-spec.ts > E3-03 · parte 2 — reglas de creación de reserva
 FAIL  test/hallazgo16-rolesguard-global.e2e-spec.ts > Hallazgo 16 - RolesGuard Global (e2e)
 FAIL  test/permisos-matriz.e2e-spec.ts > Matriz de permisos rol × ruta sobre HTTP (E1-05)
 FAIL  test/barberia.e2e-spec.ts > ... > debe generar PENDIENTE a partir de la 6ta vinculación
 FAIL  test/barberia.e2e-spec.ts > ... > debe apagar las demás barberías al activar una nueva
 FAIL  test/e3-06-07-reprogramacion-reglas.e2e-spec.ts > ... (6 tests, timeout)
 FAIL  test/e3-08-cancelacion-especial-propuesta.e2e-spec.ts > ... (8 tests, timeout)

 Test Files  7 failed | 14 passed (21)
      Tests  16 failed | 117 passed | 18 skipped (151)
```
Evidencia de H49 (CHECK, literal):
```
new row for relation "barberias" violates check constraint "barberias_estado_check"
detail: Failing row contains (…, Sede A E303, …, ACTIVA, America/Santo_Domingo, …)

new row for relation "cliente_barberias" violates check constraint "cliente_barberias_estado_vinculacion_check"
detail: Failing row contains (…, SUSPENDIDO, f, 0, f, null, …)

new row for relation "cliente_barberias" violates check constraint "cliente_barberias_estado_vinculacion_check"
detail: Failing row contains (…, PENDIENTE, f, 0, f, null, …)   ← 6.ª vinculación de barberia.e2e-spec
```
Evidencia de H38 (timeout, literal):
```
 FAIL  test/e3-08-cancelacion-especial-propuesta.e2e-spec.ts > … > ROJO: una propuesta vencida no se puede aceptar → 409 PROPUESTA_EXPIRADA
Error: Test timed out in 5000ms.
If this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout".
```

4. TEST VERDE (hoy, salida literal de `e2e_fix_h38_h49.log`)

Los 7 archivos antes en rojo:
```
 ✓ test/e3-08-cancelacion-especial-propuesta.e2e-spec.ts (15 tests) 78557ms
 ✓ test/e3-06-07-reprogramacion-reglas.e2e-spec.ts (9 tests) 47318ms
 ✓ test/barberia.e2e-spec.ts (4 tests) 15709ms
 ✓ test/e3-03-validaciones.e2e-spec.ts (11 tests) 45767ms
 ✓ test/permisos-matriz.e2e-spec.ts (3 tests) 90321ms
 ✓ test/e1-06-cross-tenant-admin.e2e-spec.ts (1 test) 17720ms
 ✓ test/hallazgo16-rolesguard-global.e2e-spec.ts (3 tests) 5009ms
```
Nota: los casos de los dos archivos por timeout tardan 2,7–8,2 s cada uno (antes morían a los 5 s); p. ej. `e3-08` ⇒ `✓ ROJO: no se puede proponer dos veces mientras hay una viva → 409 PROPUESTA_PENDIENTE 4554ms`.

5. SUITE COMPLETA (salida literal)
```
 Test Files  21 passed (21)
      Tests  151 passed (151)
   Start at  13:46:48
   Duration  560.20s (transform 1.27s, setup 249ms, import 50.20s, tests 502.11s, environment 4ms)

E2E_EXIT=0
```
Comando literal: `APP_ENV=dev npm run test:e2e` (= `vitest run --config ./vitest.config.e2e.ts`), sin flags de timeout.

Re-ejecución del archivo editado después de esa corrida (etiqueta cosmética de `e1-06`), salida literal:
```
 Test Files  1 passed (1)
      Tests  1 passed (1)
   Duration  20.91s
```
Suite unitaria completa (el código de producción cambió), salida literal:
```
 Test Files  38 passed (38)
      Tests  393 passed (393)
   Duration  10.41s
```
(`barberia.service.spec.ts`: 40/40.)

6. CRITERIOS DE ACEPTACIÓN
- [x] Los 7 archivos E2E que estaban en rojo pasan a VERDE (listado literal arriba).
- [x] El recuento de E2E exitosas sube al 100 %: **151/151**, 0 fallos, 0 saltados (antes: 117/151 con 16 fallos y 18 saltados).
- [x] `testTimeout` global de 30 s en la configuración central de los E2E (no por archivo).
- [x] Datos semilla ajustados estrictamente a los CHECK de la BD (D09/D10).
- [x] Sin push ni merge (worktree sin commit, ver §10).

7. DECISIONES O DESVIACIONES
   - Se corrigió el lado de los datos/fixtures y el código que escribía fuera de catálogo; NO se tocó la BD ni se relajó ningún CHECK.
   - H49 no era solo fixtures: la 6.ª vinculación fallaba en `vincularCliente` (producción). D10 es explícito («`PENDIENTE_APROBACION` (la 6ª)»), así que el literal canónico es `PENDIENTE_APROBACION`; se alinearon servicio, unit spec y E2E. Si no, `barberia.e2e-spec.ts` seguiría en 500.
   - Se eligió `DESVINCULADO` (no `PENDIENTE_APROBACION`) para el caso del vínculo no activo de `e1-06`: el test mide el rechazo de un vínculo que ya no está ACTIVO.
   - `testTimeout` solo en la config central, como se pidió. No se añadió `hookTimeout`: los `beforeAll` de los archivos pesados ya declaran 60–120 s y ninguno falló; H38 solo documenta timeouts de test.
   - Ninguna corrida de verificación usó `--testTimeout`.

8. HALLAZGOS NUEVOS
   - Ninguno nuevo con severidad. Dos notas de deuda relacionadas:
     - El repositorio NO declara en `prisma/migrations` los CHECK que la BD `dev` sí aplica (`barberias_estado_check`, `cliente_barberias_estado_vinculacion_check`): una BD creada desde las migraciones (p. ej. la del CI) no los impone. Conviene una migración de reconciliación con aprobación del dueño (continúa la recomendación de H37/H49).
     - `frontend-barberias/src/app/core/services/tenant.service.ts:16` tipa `estadoVinculacion?: 'ACTIVO' | 'PENDIENTE'`, fuera del catálogo D10. No tiene usos comparativos en el frontend y no afecta a los E2E; se deja anotado.

9. PENDIENTE / NO VERIFICADO
   - La 6.ª vinculación queda ahora correctamente en `PENDIENTE_APROBACION` (D10), pero el flujo de aprobación del ADMINISTRADOR que la resuelve sigue sin implementarse: una búsqueda en `src/` muestra que `PENDIENTE_APROBACION` solo aparece en `barberia.service.ts` (escritura) — no hay `GET /plataforma/vinculaciones/pendientes` ni aprobar/rechazar en `main`. Queda como pendiente del backlog («la 6ª queda `PENDIENTE_APROBACION` hasta que el ADMINISTRADOR aprueba»).
   - E2-06 no se cierra con este sprint: su aceptación pide 3 corridas consecutivas de la suite completa en verde (hoy: 1) y factorías de datos reutilizables.
   - CI no ejecutado (sin push): la verificación es local contra la BD `dev` (Neon), el Redis y el entorno del proyecto.
   - `npx tsc --noEmit` sigue con **25 errores preexistentes** en el repo (`TS2339`/`TS2531`/`TS2322`, en líneas no modificadas de specs/E2E y `prisma/*.ts`); los cambios de este sprint son literales/etiquetas y no añaden errores de tipo nuevos.
   - No se hizo commit: todo queda en el worktree de `fix/h38-h49-estabilizar-e2e` para revisión.

10. git status --short / git diff --stat / git log --oneline -3
```
 M AUDITORIA_HALLAZGOS.md
 M backend-barberias/src/barberia/application/barberia.service.spec.ts
 M backend-barberias/src/barberia/application/barberia.service.ts
 M backend-barberias/test/barberia.e2e-spec.ts
 M backend-barberias/test/e1-06-cross-tenant-admin.e2e-spec.ts
 M backend-barberias/test/e3-03-validaciones.e2e-spec.ts
 M backend-barberias/test/hallazgo16-rolesguard-global.e2e-spec.ts
 M backend-barberias/test/permisos-matriz.e2e-spec.ts
 M backend-barberias/vitest.config.e2e.ts
?? reporte-fix-h38-h49.md

=== diff --stat ===
 AUDITORIA_HALLAZGOS.md                                         |  6 ++++--
 .../src/barberia/application/barberia.service.spec.ts          | 10 +++++-----
 backend-barberias/src/barberia/application/barberia.service.ts |  3 ++-
 backend-barberias/test/barberia.e2e-spec.ts                    |  6 +++---
 backend-barberias/test/e1-06-cross-tenant-admin.e2e-spec.ts    | 10 +++++-----
 backend-barberias/test/e3-03-validaciones.e2e-spec.ts          |  2 +-
 .../test/hallazgo16-rolesguard-global.e2e-spec.ts              |  2 +-
 backend-barberias/test/permisos-matriz.e2e-spec.ts             |  4 ++--
 backend-barberias/vitest.config.e2e.ts                         |  3 +++
 9 files changed, 26 insertions(+), 20 deletions(-)

=== log ===
fff6d54 Merge pull request #50 from Codecore-J/feat/configuracion-barberia
d8593be feat(configuracion): modulo de configuracion y limites de reservas (E3-11)
cec0528 Merge pull request #48 from Codecore-J/fix/e204-ventana-cancelacion-zona-sede
```
