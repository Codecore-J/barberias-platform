# TAREA: E2-08 — Matriz de cumplimiento reconciliada

**RAMA:** `docs/e2-08-matriz-cumplimiento` (desde `main` = `12d7ffe`, el merge del PR #63)

> Plantilla 8.4 de `docs/BACKLOG_BARBERIAS_V1.md`. **Push sin merge**, a la espera de aprobación.
>
> Cierra el último punto del plan de soft-delete (**P-SD-8**) y con él la lista de pendientes del Sprint de
> Estabilización.

## 1. QUÉ HICE

1. **Rama nueva desde `main`** y comprobación de que el documento pedido no existía (`docs/MATRIZ_CUMPLIMIENTO.md`) mientras el que había que sustituir sí (`COMPARACION_DISENO_VS_REAL.md`, con veredictos de septiembre y `RolesGuard` ya corregido en `72531e9`).
2. **Reconstruí las secciones del PDF 01 por las citas del repositorio** (el PDF no está versionado): §1.2, §2, §3.1, §4, §5.1-§5.9, §7.1, §7.5, §8.3, §9 y §10, más las transversales de operación. La **sección 6 no aparece citada en ninguna parte**, así que su fila queda `NO-VERIFICADO` en vez de inventarla.
3. **Escribí `docs/MATRIZ_CUMPLIMIENTO.md`: 72 filas** (regla · estado · evidencia `archivo:línea` · test que la certifica · tarea del backlog), con el vocabulario de estados del backlog: `OK-PROBADO` 61, `OK-SIN-TEST` 3, `PARCIAL` 2, `NO-EXISTE` 5, `NO-VERIFICADO` 1.
4. **Resolví la evidencia contra el código con una puerta de validación**: cada fila declara su evidencia como (archivo, marca) o como ausencia verificable, y un script temporal —borrado después— resolvía la línea real y abortaba si la marca no estaba, si el test citado no mencionaba la regla o si el estado no era uno de los cinco. Ninguna fila entró sin pasar esa puerta.
5. **Retiré el documento antiguo**, actualicé las menciones de E2-08 en los documentos vivos (`PLAN_MIGRACION_SOFT_DELETE.md`, `docs/PLAN_SPRINT_ESTABILIZACION.md`, `AUDITORIA_HALLAZGOS.md`) y **registré los cuatro hallazgos nuevos** que la matriz dejó a la vista (H67 a H70).

## 2. ARCHIVOS TOCADOS

```
$ git diff --cached --stat
 AUDITORIA_HALLAZGOS.md             |  50 +++++++-
 COMPARACION_DISENO_VS_REAL.md      |  73 +++--------
 PLAN_MIGRACION_SOFT_DELETE.md      |   8 +-
 docs/MATRIZ_CUMPLIMIENTO.md        | 245 +++++++++++++++++++++++++++++++++++++
 docs/PLAN_SPRINT_ESTABILIZACION.md |   4 +-
 5 files changed, 314 insertions(+), 66 deletions(-)
```

El informe que estás leyendo no aparece en ese `--stat` porque se escribió después: `reporte-e2-08-matriz-cumplimiento.md` (133 líneas).

## 3. TEST ROJO

Una tarea de documentación no tiene test que se ponga rojo, así que usé el equivalente: **la puerta que resuelve la evidencia contra el código**. Escribí las 72 filas con lo que creía saber y la puerta rechazó tres afirmaciones que no cuadraban con el repositorio. Salida literal del primer intento:

```text
$ node .tmp-matriz.mjs
LA MATRIZ NO CUADRA CON EL CÓDIGO (3 problemas):
  - 1 · Cuentas, sesión y vinculación · 1.10: sin test y sin nota que lo explique
  - 3 · Seguridad de acceso · 3.5: no encuentro «404» en backend-barberias/test/hallazgo14-idor-reserva.e2e-spec.ts
  - 10 · Flujo maestro del backend · 10.3: el test backend-barberias/src/pago/application/pago.service.spec.ts no contiene «withSerializableTransaction»
```

Los tres eran errores míos y los tres se corrigieron contra la fuente: 1.10 no tiene test porque **no existe la funcionalidad** (nota añadida y estado `NO-EXISTE`); el test de IDOR afirma **403**, no 404; y el spec de pagos no nombra el helper de transacción, así que la fila cita el caso que sí existe (`registrarPagoEnPersona`). Sin esa puerta, la matriz habría nacido con tres `archivo:línea` falsos.

## 4. TEST VERDE

```text
$ node .tmp-matriz.mjs
docs/MATRIZ_CUMPLIMIENTO.md escrito: 72 filas · OK-PROBADO=61 OK-SIN-TEST=3 PARCIAL=2 NO-EXISTE=5 NO-VERIFICADO=1
```

Comprobaciones estructurales del documento generado:

```text
$ wc -l docs/MATRIZ_CUMPLIMIENTO.md
245 docs/MATRIZ_CUMPLIMIENTO.md
$ grep -c "^| " docs/MATRIZ_CUMPLIMIENTO.md
102      # 72 filas + 11 cabeceras de sección (22 líneas) + el resumen (8)
$ grep -n "Total" docs/MATRIZ_CUMPLIMIENTO.md
206:| **Total** | **72** |
```

## 5. SUITE COMPLETA

`npm run test` (backend) con el árbol de la tarea, literal:

```text
 Test Files  48 passed (48)
      Tests  547 passed (547)
   Duration  18.19s
EXIT=0
```

No hay código de producción ni tests tocados: el diff es documentación. La suite se corrió igualmente porque es el DoD de la sección 8.3 y porque una matriz de cumplimiento que se apoya en tests citados no debería entregarse con la suite sin comprobar.

## 6. CRITERIOS DE ACEPTACIÓN

- [x] **«Cubre todas las secciones del PDF 01 con evidencia.»** Cubre las diez secciones con 72 filas y evidencia `archivo:línea` verificada. La sección 6 se declara `NO-VERIFICADO` con el motivo medido (`grep "Spec 01 §6"` = 0 coincidencias; el PDF 01 no está en el repositorio): se cubre diciendo la verdad sobre lo que no se puede comprobar, no rellenando el hueco con una hipótesis.
- [x] Cada fila lleva **estado del vocabulario del backlog** (`OK-PROBADO`, `OK-SIN-TEST`, `PARCIAL`, `NO-EXISTE`, `NO-VERIFICADO`), **evidencia** `archivo:línea`, **test** que la certifica y **tarea** que la cierra.
- [x] **Sustituye al documento antiguo.** `COMPARACION_DISENO_VS_REAL.md` queda como aviso de sustitución y su contenido sigue recuperable en `git show 72531e9:COMPARACION_DISENO_VS_REAL.md`.
- [x] **E2-08 resuelto en los documentos vivos:** `PLAN_MIGRACION_SOFT_DELETE.md` (P-SD-8 a `[EJECUTADO]`, cabecera «P-SD-1 a P-SD-8», §4.1 y §6), `docs/PLAN_SPRINT_ESTABILIZACION.md` (las dos filas) y `AUDITORIA_HALLAZGOS.md`.
- [x] **Hallazgos documentados** (DoD 8.3): H67 a H70 en `AUDITORIA_HALLAZGOS.md` (§F2.7) y resumidos en la propia matriz.
- [x] Suite unitaria completa en verde (547/547, `EXIT=0`).

## 7. DECISIONES O DESVIACIONES

1. **La matriz se generó con una puerta de validación en lugar de escribirse a mano.** El backlog no lo pide, pero el patrón que este repositorio ya encontró dos veces —una afirmación que nadie comprueba (P-SD-5) y un documento que miente con `[EJECUTADO]`— se aplica igual aquí: 72 `archivo:línea` escritos a mano son 72 oportunidades de inventar una línea. El script era temporal y **no se ha dejado en el repositorio**; lo que queda es el documento y la constancia de cómo se resolvió. El coste de no dejarlo: los números de línea caducan y hay que refrescarlos a mano (está escrito en «Cómo se mantiene»).
2. **La sección 6 se marca `NO-VERIFICADO`.** Es la única fila del documento que no acredita nada, y es deliberado: el PDF 01 no está en el repositorio. Si el dueño consigue el PDF, la fila se rellena.
3. **El documento antiguo se sustituye por un aviso, no se borra.** El contenido histórico no se pierde (queda en git) y la cabecera del nuevo documento explica qué decía y por qué dejó de ser cierto.
4. **Los informes anteriores no se han reescrito.** `reporte-final-p-sd-1-p-sd-2.md` decía «P-SD-8 no existe» y era verdad cuando se escribió; cambiar ese texto sería falsificar el registro. Se actualizan los documentos **vivos** (backlog, planes, auditoría) y los informes quedan como lo que son: fotos de su momento.
5. **La numeración de tareas sigue al backlog, no a los informes.** Hay repartos distintos (el informe de E3-06/E3-07 cubre la reprogramación y el de E3-08 la cancelación especial con la propuesta de horario); cada fila cita la tarea del backlog y el test real, y la discrepancia está anotada en el propio documento.
6. **Hallazgos nuevos con ID `H67` a `H70`.** `H65` y `H66` ya estaban abiertos (sondas de salud), así que la numeración continúa desde ahí.

## 8. HALLAZGOS NUEVOS

| ID | Severidad | Hallazgo | Evidencia |
| :--- | :--- | :--- | :--- |
| **H67** | Media | **E3-12 nunca se cerró:** la 6.ª vinculación se asigna `PENDIENTE_APROBACION` y bloquea el acceso, pero **no existe el flujo que la aprueba**, ni desvinculación, ni enlace único/QR. Un cliente que llega al límite de 5 queda pendiente para siempre y sin salida | `grep -ri "plataforma/vinculaciones" backend-barberias/src` = 0 · `grep -ri "desvincular"` = 0 · `grep -ri "por-enlace"` = 0; el estado sí se asigna (`barberia.service.ts:521`) |
| **H68** | Baja-Media | **§7.1: un pago se registra, no se corrige.** El diseño permite corregir un pago auditando el cambio; el controlador solo expone alta en persona y consulta de auditoría. Una corrección a mano en la base queda sin rastro | `grep -ri "corregir" backend-barberias/src/pago` = 0 · `pago.controller.ts` solo `@Post(['en-persona',''])` y `@Get('auditoria')` |
| **H69** | Baja | **Tres reglas se cumplen sin test que las vigile:** recuperación de contraseña (`forgot-password`/`reset-password`), `ESTADO_NO_EDITABLE` y la prioridad de una excepción `CERRADA`/`HORARIO_ESPECIAL` sobre la rejilla | `grep -rl "reset-password" test/*.e2e-spec.ts` = 0 · `grep -rl "ESTADO_NO_EDITABLE"` en specs = 0 · sin test de prioridad de excepciones |
| **H70** | Baja (documental) | **La sección 6 del PDF 01 no es localizable:** ninguna cita del repositorio la menciona, así que su cumplimiento no se puede acreditar | `grep -rn "Spec 01 §6"` = 0 coincidencias (sí hay citas de §1.2, §2, §3.1, §4, §5.1-§5.9, §7.1, §7.5, §8.3, §9 y §10) |

Lo que la reconciliación deja escrito y conviene leer junto: **61 de 72 reglas están probadas**; E4-05 no es un defecto sino alcance (módulo desactivado a propósito, H22); y T.4 (`dev`/`staging`/producción) es `PARCIAL` porque el despliegue no aplica migraciones, que es la causa raíz de las divergencias que ya cazó H50.

## 9. PENDIENTE O NO VERIFICADO

- **Fila 6.1** de la matriz: la sección 6 del PDF 01, hasta que el PDF esté disponible (H70).
- **H67, H68, H69**: documentados y no corregidos. Corregirlos es otro encargo; la matriz y esta tabla dicen dónde está cada uno.
- **Los `archivo:línea` caducan**: cualquier edición de los archivos citados desplaza los números. No hay guarda automática que lo detecte (a diferencia de la de vocabulario); la matriz explica cómo refrescarlos y deja la marca que identifica cada regla.
- **La suite E2E no se ha re-ejecutado** en esta rama: no se tocó ni código ni tests y el contenedor local de Postgres + Redis está apagado. Lo que sí se corrió es la suite unitaria completa (547/547).
- **Verificación de este informe:** no incluye el hash del commit porque el commit es el paso siguiente de la rama (sección 10).

## 10. ESTADO GIT

```text
$ git status --short
M  AUDITORIA_HALLAZGOS.md
M  COMPARACION_DISENO_VS_REAL.md
M  PLAN_MIGRACION_SOFT_DELETE.md
A  docs/MATRIZ_CUMPLIMIENTO.md
M  docs/PLAN_SPRINT_ESTABILIZACION.md
A  reporte-e2-08-matriz-cumplimiento.md

$ git log --oneline -5
12d7ffe Merge pull request #63 from Codecore-J/chore/psd5-guarda-vocabulario
04e48d6 test(psd5): la guarda de vocabulario vigila datos y frontend
569f354 Merge pull request #61 from Codecore-J/fix/soft-delete-gaps
a85176f chore(merge): resuelve el conflicto del plan de soft-delete con origin/main
33f2690 Merge pull request #62 from Codecore-J/fix/soft-delete-frontend-wiring
```

No hago merge: la rama se sube y espera aprobación.
