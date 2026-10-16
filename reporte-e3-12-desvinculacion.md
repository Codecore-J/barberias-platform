TAREA: E3-12/3 — La salida del cliente: desvinculación a petición propia (D20/D21 · regla 1.9)
RAMA: feat/e3-12-desvinculacion-cliente (base: `main` = `47ff6df`, con los PR #64 y #65 ya fusionados)
REPORTE ANTERIOR: `reporte-e3-12-cierre-y-h71.md` (E3-12/2), `reporte-e3-12.md` (E3-12/1)

1. QUÉ HICE (5 líneas máximo)

1. Cerré la mitad (b) de la regla 1.9, que era la última regla `PARCIAL` del ciclo de vida del cliente: `POST /barberias/:barberiaId/mi-estado/desvincular` (`@Roles('CLIENTE')`, 200) cierra la PROPIA fila con un `UPDATE` a `DESVINCULADO`, nunca un borrado (D20/D21).
2. El cierre es un `UPDATE` de dos campos: `estadoVinculacion` y `esBarberiaActiva`. El contador de inasistencias, `estaRestringido` y su motivo SOBREVIVEN (D20): desvincularse no es una vía para evadir una penalización, y hay tres tests que lo declaran.
3. No se sale dejando trabajo vivo: con reservas `PENDIENTE`, `PROPUESTA_PENDIENTE` o `CONFIRMADA` de HOY en adelante (zona de la SEDE, E2-04) responde **422 `RESERVAS_EN_CURSO`** con el conteo y el detalle; ya cerrado responde 409 `ESTADO_INVALIDO`; sin fila, 403 `NO_VINCULADO`. Audita `CLIENTE_DESVINCULADO_VOLUNTARIAMENTE` con anterior y nuevo DENTRO de la transacción (D28).
4. **El cupo de D10 se recupera:** el conteo del límite en `vincularCliente` pasa a mirar los vínculos VIVOS (`estadoVinculacion: { not: 'DESVINCULADO' }`). Antes contaba las filas cerradas, así que desvincularse no liberaba plaza y la sede siguiente nacía `PENDIENTE_APROBACION`: el cliente quedaba preso de la bandeja de aprobación.
5. Frontend: la tarjeta de la sede (`features/barberias/barberias.component.ts`) muestra el vínculo y su contador, y para el CLIENTE añade el botón «Desvincularme de esta Barbería» con modal de confirmación que avisa de las consecuencias REALES (se pierde el catálogo, el historial y el contador se conservan, se puede volver con el código).

2. ARCHIVOS TOCADOS (git diff --stat, literal)

```
 AUDITORIA_HALLAZGOS.md                             |  40 ++-
 .../barberia/application/barberia.service.spec.ts  |  42 ++-
 .../src/barberia/application/barberia.service.ts   |  20 +-
 .../barberia/application/mi-estado.service.spec.ts | 328 ++++++++++++++++-----
 .../src/barberia/application/mi-estado.service.ts  | 195 +++++++++++-
 .../src/barberia/domain/vinculacion.ts             |  21 ++
 .../infrastructure/mi-estado.controller.ts         |  25 +-
 backend-barberias/test/permisos-matriz.e2e-spec.ts |   9 +
 backend-barberias/test/permisos-matriz.spec.ts     |  18 +-
 docs/MATRIZ_CUMPLIMIENTO.md                        |  17 +-
 docs/MATRIZ_RUTAS.md                               |  23 +-
 .../app/features/barberias/barberias.component.ts  | 235 ++++++++++++++-
 12 files changed, 847 insertions(+), 126 deletions(-)
```

**Nuevos (sin seguimiento):** `backend-barberias/test/e3-12-desvinculacion.e2e-spec.ts` (468 líneas), `frontend-barberias/src/app/core/services/mi-estado.service.ts` (134), `frontend-barberias/src/app/core/services/mi-estado.service.spec.ts` (140), `reporte-e3-12-desvinculacion.md`.

**Tocados:** `src/barberia/application/mi-estado.service.ts` (nuevo `desvincular` + `MiDesvinculacionDto` + `inicioDeHoy`), `src/barberia/infrastructure/mi-estado.controller.ts` (`@Post('desvincular')` con `@HttpCode(200)`), `src/barberia/domain/vinculacion.ts` (`ESTADOS_RESERVA_QUE_ANCLAN`), `src/barberia/application/barberia.service.ts` (el conteo de D10 mira los vivos), `src/barberia/application/barberia.service.spec.ts` (+2 casos del conteo), `src/barberia/application/mi-estado.service.spec.ts` (+8 casos), `test/permisos-matriz.spec.ts` (79 → 80 rutas; 316 → 320 decisiones), `test/permisos-matriz.e2e-spec.ts` (la ruta nueva al FINAL de los `CASOS`), `frontend-barberias/src/app/features/barberias/barberias.component.ts`, `docs/MATRIZ_RUTAS.md` (fila 68 + cabecera), `docs/MATRIZ_CUMPLIMIENTO.md` (1.9 → `OK-PROBADO`), `AUDITORIA_HALLAZGOS.md` (ficha F2.9 + **H72**).

3. TEST ROJO (antes del arreglo, salida literal)

Con `mi-estado.service.ts`, `mi-estado.controller.ts`, `domain/vinculacion.ts` y `barberia.service.ts` revertidos a `git checkout --` (y restaurados después; `md5sum` idéntico al de antes del experimento). Salida filtrada sobre el resumen:

```
       × NO_VINCULADO: sin vínculo no hay nada que cerrar (403) 3ms
       × ESTADO_INVALIDO: cerrar dos veces es un error del cliente (409) 2ms
       × RESERVAS_EN_CURSO: una cita futura ancla el vínculo (422) 2ms
       × D20: el cierre NO toca el contador ni la restricción 2ms
       × el cierre se audita como CLIENTE_DESVINCULADO_VOLUNTARIAMENTE 2ms
       × el UPDATE escribe solo los dos campos del cierre 1ms
       × D10: el cupo se mide sobre los vínculos VIVOS 1ms
       × la ventana es «hoy en adelante» en la zona de la sede 2ms
 FAIL  src/barberia/application/mi-estado.service.spec.ts > MiEstadoService > desvincular (E3-12/3)
AssertionError: expected "vi.fn()" to be called with arguments: [ { where: { …(2) } } ]
       × T2.2 · el conteo de D10 ignora las filas DESVINCULADO 2ms
       × T2.2 · la fila que se reabre ya no se excluye por id 1ms
 FAIL  src/barberia/application/barberia.service.spec.ts > BarberiaService > vincularCliente (T2.2)
AssertionError: expected "vi.fn()" to be called with arguments: [ { where: { usuarioId: "…", NOT: { id: "…" } } } ]
 Test Files  1 failed (1)
```

Los dos casos de `barberia.service.spec.ts` fallan con el `where` VIEJO del conteo (`NOT: { id }`), que es exactamente lo que el arreglo cambia: sin el filtro por estado, desvincularse no devolvía el cupo.

El mismo experimento en el E2E (`test/e3-12-desvinculacion.e2e-spec.ts`, los 11 casos en rojo porque la ruta no existía):

```
       × el cliente cierra su vínculo: la fila queda DESVINCULADO en el sitio y auditada
       × la siguiente sede nace ACTIVA, no PENDIENTE_APROBACION
 FAIL  test/e3-12-desvinculacion.e2e-spec.ts > E3-12/3 · desvinculación del cliente (regla 1.9)
Error: expected 200 "OK", got 404 "Not Found"
 FAIL  test/e3-12-desvinculacion.e2e-spec.ts > ... > la siguiente sede nace ACTIVA, no PENDIENTE_APROBACION
AssertionError: expected 'ACTIVO' to be 'PENDIENTE_APROBACION'
 Test Files  1 failed (1)  Tests  11 failed (11)
```

4. TEST VERDE (después, salida literal)

E2E dirigido (escrito para esta tarea):

```
 ✓ test/e3-12-desvinculacion.e2e-spec.ts (11 tests) 17849ms
       ✓ el ADMIN_BARBERIA de la sede no cierra el vínculo de nadie (403 del guard)  629ms
       ✓ otro cliente sin vínculo en esa sede recibe 403 NO_VINCULADO  655ms
       ✓ una reserva CONFIRMADA futura ancla el vínculo y el cierre responde 422 con el conteo  1193ms
       ✓ cancelada la cita, la ventana se cierra y el cierre ya es posible  1475ms
       ✓ el cliente cierra su vínculo: la fila queda DESVINCULADO en el sitio y auditada  1900ms
       ✓ cerrar dos veces no es idempotente: 409 ESTADO_INVALIDO  714ms
       ✓ el cliente ve su vínculo cerrado y SIGUE restringido (no se evade la penalización)  399ms
       ✓ cerrado el vínculo, la sede deja de estar a su alcance (403 del guard de vínculo)  518ms
       ✓ la siguiente sede nace ACTIVA, no PENDIENTE_APROBACION  865ms
       ✓ D21/D20: reintroducir el código REABRE la fila cerrada conservando el contador y la restricción  1025ms

 Test Files  1 passed (1)
      Tests  11 passed (11)
```

Matriz de permisos sobre HTTP (la ruta nueva entra al final de los `CASOS`):

```
 Test Files  1 passed (1)
      Tests  3 passed (3)
```

Frontend:

```
 Test Files  5 passed (5)
      Tests  30 passed (30)
```

Build y lint del frontend:

```
Output location: …/frontend-barberias/dist/frontend-barberias
BUILD_EXIT=0
Found 0 warnings and 0 errors.
Finished in 14ms on 49 files with 96 rules using 16 threads.
LINT_EXIT=0
```

5. SUITE COMPLETA (resumen literal)

Unitarios del backend, completos (`npm test`, sin filtros):

```
 Test Files  50 passed (50)
      Tests  576 passed (576)
   Start at  20:45:44
   Duration  8.37s
UNIT_EXIT=0
```

(567 antes de esta rama: **+9**, los 8 casos de `desvincular` y los 2 del conteo, menos uno reescrito.)

Lint del backend: `Found 70 warnings and 0 errors.` (los warnings son de tipos de Prisma y son preexistentes; 0 errores).

Tabla de rutas y matriz de permisos, con el conteo que ahora declara el documento:

```
=== TABLA DE RUTAS (80) ===
/barberias/:barberiaId/mi-estado/desvincular                            | POST    | MiEstadoController          | @Roles(CLIENTE)
POST /barberias/:barberiaId/mi-estado/desvincular          | si  | si  | si  | si
 Test Files  4 passed (4)
      Tests  75 passed (75)
```

**E2E de la épica de vinculación, dirigidos:** `test/e3-12-vinculacion.e2e-spec.ts` (23) y `test/e3-12-desvinculacion.e2e-spec.ts` (11) en verde. **No se ejecutó la suite E2E COMPLETA en esta iteración**: las últimas ejecuciones completas (E3-12/1 y /2) reportaron 3 archivos rojos por cuota de Redis agotada y H65 (`e3-04-aceptar-rechazar`, `e3-05-expiracion-cancelacion`, `health`), ajenos a esta rama y ajenos al alcance de esta tarea; el presupuesto de Redis se habría agotado igual y las suites afectadas no tocan la desvinculación. Se declara como límite en el punto 9.

6. CRITERIOS DE ACEPTACIÓN: lista con [x] y la evidencia de cada uno

- [x] **El endpoint existe bajo el rol CLIENTE y con el `:barberiaId` acotado por el guard.** `POST /barberias/:barberiaId/mi-estado/desvincular` → `MiEstadoController.desvincular` (`@Roles('CLIENTE')` + `@HttpCode(200)`). Evidencia: `=== TABLA DE RUTAS (80) ===` lo lista con `@Roles(CLIENTE)`; el E2E comprueba que el `ADMIN_BARBERIA` de esa sede recibe **403 del guard** y que otro cliente sin vínculo recibe **403 `NO_VINCULADO`** del servicio.
- [x] **El `UPDATE` cambia el estado a `DESVINCULADO` sobre la fila del usuario autenticado.** Evidencia: el E2E lee la fila de la base y comprueba `estado_vinculacion = 'DESVINCULADO'` y `es_barberia_activa = false`; el unitario del `UPDATE` comprueba que el `data` lleva SOLO esos dos campos.
- [x] **La acción audita el cambio.** `CLIENTE_DESVINCULADO_VOLUNTARIAMENTE` con `anterior` y `nuevo`, dentro de la misma transacción. Evidencia: el E2E lo lee de `auditoria` tras el cierre; el unitario lo declara con el `contexto` esperado.
- [x] **El botón existe en la vista del cliente, cableado al endpoint y con advertencia previa.** `features/barberias/barberias.component.ts` → botón «Desvincularme de esta Barbería» visible solo con vínculo vivo (`puedeDesvincularse`) y modal de confirmación; `core/services/mi-estado.service.ts` → `desvincular(barberiaId)`. Evidencia: `frontend-barberias` 30/30 con los casos del servicio (éxito, 422 con el mensaje del contrato, 409 y limpieza del estado).
- [x] **Test E2E de ACTIVO → DESVINCULADO con recuperación de cupo.** Casos 5 y 9 del E2E: el cliente cierra su vínculo y la **siguiente sede nace `ACTIVO`, no `PENDIENTE_APROBACION`** (el cupo volvió). Con el código viejo ese caso fallaba con `expected 'ACTIVO' to be 'PENDIENTE_APROBACION'`.
- [x] **1.9 pasa a OK-PROBADO en la matriz.** `docs/MATRIZ_CUMPLIMIENTO.md`: la fila 1.9 sale de `PARCIAL`, el recuento pasa a **OK-PROBADO 64 / PARCIAL 1** y la prosa deja de hablar de «la mitad que falta».

7. DECISIONES O DESVIACIONES (con motivo)

1. **La ruta va en `MiEstadoController`, no en un `POST /barberias/:id/desvincular` suelto.** Las dos formas existían en el backlog; se eligió `POST /barberias/:barberiaId/mi-estado/desvincular` porque repetir `:barberiaId` deja que el `RolesGuard` acote la sede del PARÁMETRO (y no de una cabecera), que es lo que impide que alguien cierre el vínculo de otro con un UUID ajeno; el servicio, además, acota por el usuario del token. `POST /barberias/:id/...` habría exigido comprobar la pertenencia a mano en el servicio (como la fila 60 y 61 de la matriz) para el mismo resultado.
2. **Responde 200, no 201.** No crea un recurso: cambia el estado de un vínculo existente. Mismo criterio que aprobar/rechazar de E3-12 y que el perdón de E4-03.
3. **409 `ESTADO_INVALIDO` en vez de idempotencia.** Cerrar dos veces no es un no-op silencioso: el segundo intento es un error del cliente (la pantalla ya no ofrece el botón porque el estado se olvida tras el cierre). Mismo criterio que E4-03.
4. **La ventana de reservas ancladas es «hoy en adelante» en la zona de la SEDE**, y `PENDIENTE`, `PROPUESTA_PENDIENTE` y `CONFIRMADA` se declaran UNA vez en `domain/vinculacion.ts` (`ESTADOS_RESERVA_QUE_ANCLAN`), no como lista literal en el servicio. `fecha_cita` es un `DATE` y se compara contra la medianoche UTC de la etiqueta local de la sede (E2-04), que es cómo lo escribe y lo lee Prisma.
5. **Los estados terminales no anclan.** `COMPLETADA`, `CANCELADA`, `RECHAZADA`, `EXPIRADA` y `NO_PRESENTADO` no bloquean el cierre: la cita ya ocurrió o se deshizo. Hay un caso que cancela y comprueba que la ventana se cierra.
6. **D20 es explícito en el `UPDATE`.** Se escriben SOLO `estado_vinculacion` y `es_barberia_activa`; `contador_no_presentado`, `esta_restringido` y `motivo_restriccion` no se tocan ni se reinician. Desvincularse NO levanta una penalización, y también hay un caso que comprueba que el vínculo cerrado ya no puede leer el catálogo de esa sede (403 del guard de vínculo): cerrar el vínculo no puede ser una forma de esquivar el bloqueo de esa sede.
7. **El conteo de D10 se corrige en `vincularCliente`, no solo en el cierre.** Era un defecto latente: el conteo contaba filas `DESVINCULADO`, así que el cupo que el cierre libera no se recuperaba en el alta siguiente y la sede nacía `PENDIENTE_APROBACION` (bandeja para algo que cabía). El filtro por estado cubre además la fila que se reabre —en la base todavía está `DESVINCULADO`— y por eso se retiró la exclusión explícita por `id` que introdujo H71: era un parche para el mismo síntoma.
8. **La auditoría va DENTRO de la transacción.** El cierre y su rastro salen juntos (P-SD-4): no puede quedar el vínculo cerrado sin evento ni el evento sin el cierre.
9. **El frontend no decide quién puede desvincularse.** Pinta lo que responde el contrato D40 y propaga el `mensaje` a `error()`: un 422 `RESERVAS_EN_CURSO` o un 409 se muestran al cliente tal cual, porque son reglas de negocio que debe leer. Un 403 `NO_VINCULADO` en la lectura NO ocupa `error()`: la lista de sedes puede traer sedes sin vínculo y ahí lo correcto es no pintar nada.
10. **En `olvidar()` no se usa `delete`.** El vocabulario del diseño prohíbe nombrar borrados también en el cliente y la guarda de E2-07 lo comprueba; se reconstruye el mapa con `Object.fromEntries`.

8. HALLAZGOS NUEVOS

**H72 · El cliente no tiene ninguna forma de LISTAR sus sedes — ABIERTO (Baja-Media).**
`GET /barberias` (`findAllByResponsable`, `barberia.service.ts:305`) filtra por `responsableId`, así que a un `CLIENTE` le devuelve `[]` aunque tenga vínculos en `cliente_barberias`; no existe ninguna otra ruta que los liste (`cliente_barberias` solo se lee con `findUnique` por `(usuarioId, barberiaId)`). Consecuencia en esta entrega: la tarjeta de mi-estado y su botón de salir existen, están cableados y están probados, pero **solo se pintan donde esa lista trae una sede**. El hallazgo es PREEXISTENTE (ya era el hallazgo 5 de `docs/MATRIZ_RUTAS.md` y el punto «d» de su traza de sede); esta pantalla lo deja a la vista. Remedio propuesto: una ruta de lectura de los vínculos PROPIOS (p. ej. `GET /barberias/mis-vinculaciones`, `@Autenticado` y acotada al token, con `estadoVinculacion` y `esBarberiaActiva`) cableada en `tenant.service.ts`, que además liberaría la sede activa de depender de la caché de `localStorage`. Es tarea propia, no un añadido de E3-12/3.

9. PENDIENTE O NO VERIFICADO

- **La suite E2E COMPLETA no se ejecutó en esta iteración** (ver punto 5): el presupuesto de Redis se agota con las suites que usan colas y las últimas ejecuciones completas ya arrastraban 3 archivos rojos ajenos a esta rama. Verificado en su lugar: E2E dirigido de la épica (34 casos en 2 archivos) verde, matriz de permisos HTTP verde y suite unitaria completa verde.
- **El recorrido completo en navegador NO se hizo**, por H72: sin una ruta que liste las sedes de un cliente, no hay pantalla a la que llegue un cliente puro para pulsar el botón. Lo que sí está probado es el servicio del frontend (30/30, incluidos el éxito, el 422 y el 409), el `ng build` y el lint.
- **No hay ventana temporal ni tope de reintentos** para el ciclo cerrar/reabrir: reintroducir el código reabre la fila de inmediato (D21 no dice cuántas veces). Es la misma pregunta abierta que dejó H71 y no era de esta tarea.
- **`es_barberia_activa` de las OTRAS filas no se toca.** Si el cliente cierra su sede activa y no tiene ninguna otra, queda sin sede seleccionada y la fija con `PATCH /barberias/:id/seleccionar`; elegirla automáticamente no lo pide ninguna regla (mismo límite que anotó H71). No alcanzable por la vía normal en este escenario, porque el cierre exige no tener citas vivas, pero sí por la vía de una fila cerrada con historial.
- **Una cita de HOY ya pasada sigue anclando el vínculo hasta el día siguiente**: la ventana es «hoy en adelante» en la zona de la sede, no «desde ahora». Es la lectura conservadora de «reservas futuras» del punto 3 de E3-12 y está declarada en el test.
- **Sigue ABIERTA la otra mitad de E3-12** (enlace único/QR, fila 1.10 `NO-EXISTE`), que no era de esta ejecución. **H65, H66, H68, H69, H70 y H72 siguen abiertos.**
