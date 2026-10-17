> Plantilla 8.4 de `docs/BACKLOG_BARBERIAS_V1.md`. Rama `fix/h74-purga-tenant-cache` desde `main`
> (`1a2afbc`). **Push sin merge**, a la espera de aprobación.

# H74 · La sede activa del frontend ya no sobrevive a su propio vínculo

**TAREA:** H74 — el cliente quedaba anclado a una sede fantasma tras desvincularse (o cuando la sede se
suspendía), porque `TenantService` solo fijaba la sede activa al ENCONTRAR una, nunca al no encontrar
ninguna.
**RAMA:** `fix/h74-purga-tenant-cache`
**HALLAZGO:** `AUDITORIA_HALLAZGOS.md` → `H74 · … — **RESUELTO**`

---

## 1. QUÉ HICE

1. **La regla, en el servicio:** la sede activa tiene que ESTAR en la lista (`sincronizarSedeActiva`). Si la
   fijada —o la que dejó la caché— ya no aparece, se purga en el acto: señal, `active_barberia_id` y
   `active_barberia_data`.
2. **Salida inmediata:** `purgarBarberia(barberiaId)` saca la sede de la sesión sin esperar a la recarga; el
   flujo de desvinculación lo llama en el `next`, antes de volver a pedir la lista.
3. **Purga absoluta con 0 sedes:** `MiEstadoService.limpiar()` y redirección al dashboard raíz `/`.
4. **`Router` inyectado** en `barberias.component.ts`, retirando el acceso `authService['router']`.
5. **8 casos nuevos** en `tenant.service.spec.ts` que fijan la regla (incluido el arranque en frío desde la caché).

## 2. ARCHIVOS TOCADOS (`git diff --stat`, literal)

```
 AUDITORIA_HALLAZGOS.md                             |  24 +++
 .../src/app/core/services/tenant.service.spec.ts   | 172 +++++++++++++++++++++
 .../src/app/core/services/tenant.service.ts        |  66 ++++++--
 .../app/features/barberias/barberias.component.ts  |  27 +++-
 reporte-h74-purga-tenant-cache.md                  | 138 +++++++++++++++++
 5 files changed, 411 insertions(+), 16 deletions(-)
```

## 3. TEST ROJO (antes del fix, salida literal)

Con la regla vieja restaurada en `sincronizarSedeActiva` (solo fijaba la activa al encontrar una sede):

```
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯⎯
 FAIL   frontend-barberias  src/app/core/services/tenant.service.spec.ts > TenantService · la sede activa sigue a los vínculos (H74) > purga la sede activa (señal y caché) cuando la lista vuelve VACÍA
AssertionError: expected { id: 'b1', nombre: 'Sede b1', …(4) } to be null
 FAIL   frontend-barberias  src/app/core/services/tenant.service.spec.ts > TenantService · la sede activa sigue a los vínculos (H74) > no revive una sede fantasma desde la caché cuando la lista viene vacía
AssertionError: expected { id: 'b-fantasma', …(5) } to be null
 Test Files  1 failed | 5 passed (6)
      Tests  2 failed | 36 passed (38)
```

Los dos rojos son los dos síntomas del hallazgo: la sede desvinculada seguía activa y la caché revivía la
sede cerrada en el arranque en frío.

## 4. TEST VERDE (después, salida literal)

```
 Test Files  6 passed (6)
      Tests  38 passed (38)
TEST_VERDE_EXIT=0
```

## 5. SUITE COMPLETA

- **Frontend, pruebas:** `Test Files 6 passed (6)` · `Tests 38 passed (38)` · `EXIT=0`
  (eran 30 en 5 archivos; el archivo nuevo aporta 8).
- **Frontend, lint:** `Found 0 warnings and 0 errors.` (`LINT_EXIT=0`).
- **Frontend, build:** `Application bundle generation complete. [10.774 seconds]` (`BUILD_EXIT=0`).
- **Backend:** sin cambios. No se ejecuta su suite porque esta tarea no toca ni una línea del backend
  (`git diff --stat` lo confirma: todo el diff está en `frontend-barberias/` y en la documentación).

## 6. CRITERIOS DE ACEPTACIÓN

- [x] **Fase 1 · rama desde `main`.** `fix/h74-purga-tenant-cache` sobre `1a2afbc`, con `main` local y
      `origin/main` en el mismo commit y el árbol limpio.
- [x] **Fase 2 · si la barbería desvinculada era la activa, se purga al instante.** `purgarBarberia()` en el
      `next` de la desvinculación, antes de la recarga. Evidencia: casos «purgarBarberia saca la sede de la
      lista y limpia la activa si era esa» y «purgarBarberia de otra sede NO toca la activa».
- [x] **Fase 2 · la purga alcanza la sesión Y el almacenamiento persistente.** `setBarberiaActiva(null)`
      limpia señal + `active_barberia_id` + `active_barberia_data`. Evidencia: los dos primeros casos afirman
      `barberiaActiva() === null` **y** las dos claves de `localStorage` en `null`.
- [x] **Fase 2 · la regla no depende de un solo camino.** Aunque nadie llame a `purgarBarberia`, la carga de
      la lista purga lo que ya no está (por eso también cubre la sede suspendida y el arranque en frío desde
      la caché).
- [x] **Fase 2 · con 0 sedes, purga absoluta y redirección a `/`.** `miEstado.limpiar()` + `router.navigate(['/'])`
      en `confirmarDesvinculacion` cuando `barberiasVinculadas().length === 0`.
- [x] **Fase 3 · test unitario que demuestra la limpieza.** `tenant.service.spec.ts` (nuevo), 8 casos: purga
      total con lista vacía, conservación cuando la sede sigue, sede fantasma de la caché, purga de una sola
      sede (la activa y la que no lo es), un fallo de RED que no purga nada y el respaldo de H72 (las sedes
      del vínculo cuando el listado por responsabilidad viene vacío).
- [x] **Fase 3 · suite del frontend y build en verde.** §5, con el rojo de §3 medido antes y el rojo revertido.
- [x] **Fase 3 · `AUDITORIA_HALLAZGOS.md` marca H74 como RESUELTO**, con qué se hizo, evidencia roja/verde y
      límites. Se añadió también H73 (cuota de Redis del entorno) como **ABIERTO (entorno)**, para que el ID
      que quedó provisional en el informe de H72 no quede huérfano.
- [x] **Entrega:** este informe 8.4 y `push` de la rama. **Sin merge.**

## 7. DECISIONES O DESVIACIONES

1. **La purga vive en `TenantService`, no en el flujo de desvinculación.** `mi-estado.service.ts` sigue siendo
   solo el transporte del vínculo (ya olvida el estado de ESA sede al cerrarla, y tiene su prueba). Si la
   purga dependiera de que la pantalla la llame, cualquier otro consumidor de `desvincular()` dejaría el
   estado sucio; por eso la regla está en el servicio que posee la sede activa.
2. **La regla es «la activa está en la lista», no «si la lista está vacía, limpia».** Cubre el mismo caso con
   menos código y, de paso, la sede que se suspende o cuyo vínculo se queda `PENDIENTE_APROBACION` (que no
   aparece en el listado del cliente): en todos esos casos la sede deja de ser operativa.
3. **Se añadió `purgarBarberia()` además de la regla automática**, porque la automática solo actúa al llegar
   la respuesta y el usuario no debe seguir viendo la tarjeta de una sede ya cerrada mientras viaja la
   petición.
4. **Un fallo de red NO purga** (el `tap` está antes del `catchError`), y una respuesta vacía SÍ. Es la
   distinción que hacía falta: la caída de la red no es información sobre los vínculos, una lista vacía sí.
   El caso está fijado con una prueba para que nadie lo confunda al reordenar operadores.
5. **La redirección se decidió por la LISTA, no por `vinculacionesVigentes` del backend.** Ese contador
   incluye vínculos `PENDIENTE_APROBACION`, que sí son sedes visibles; lo que importa es si al usuario le
   queda algo que pintar.

## 8. HALLAZGOS NUEVOS

Ninguno nuevo. Se documentan como límites de H74: (a) la purga inmediata y la redirección viven en el
componente y no tienen prueba unitaria (el proyecto no tiene pruebas de componente), y (b) la sede activa que
se elige sola sigue sin pasar por `PATCH /barberias/:id/seleccionar`, que es el hallazgo 2 de
`docs/MATRIZ_RUTAS.md` y no se toca aquí.

## 9. PENDIENTE O NO VERIFICADO

- **Recorrido real en navegador:** no ejecutado. La verificación es la suite (38/38), el lint y el build.
- **Suite E2E del backend:** no ejecutada (esta tarea no toca backend). Sigue en pie el límite de H73: el
  Redis de esta máquina está por encima de su cuota.
- **`TenantService` sigue sin llamar a `/seleccionar`** al elegir sede: el navegador puede quedar con una sede
  activa distinta de la que dice `es_barberia_activa` en la base. Es el hallazgo 2 de la matriz de rutas.

## 10. GIT

`git status --short` limpio tras el commit; `git log --oneline -2` (antes del commit de esta rama):

```
1a2afbc Merge pull request #67 from Codecore-J/feat/h72-listado-sedes-cliente
5301158 feat(h72): el cliente ya puede listar sus sedes (GET /mi-estado/barberias)
```

**No se hace merge. La rama se deja empujada, a la espera de aprobación.**
