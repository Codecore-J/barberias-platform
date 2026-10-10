> Plantilla 8.4 de `docs/BACKLOG_BARBERIAS_V1.md`. Sin `push` ni `merge`: la rama espera aprobación.

```
TAREA: E2-02 — Módulo de estados y máquina de transiciones
RAMA: fix/maquina-estados-reserva (desde main = d6f4875)
```

## 1. QUÉ HICE

Creé el catálogo único de estados (`src/shared/domain/estados.ts`) con los 8 valores de §5.1/D08, los actores y la matriz de §5.2 fila por fila, y la `ReservaStateMachine` con `assertTransition` (409 `ESTADO_INVALIDO`) y el hook `onEnter` + `despuesDeConfirmar` para los efectos al entrar en un estado. `ReservaService.cambiarEstado` es ahora el ÚNICO punto de escritura de `reservas.estado` (privado, con la máquina delante y los efectos aplicados en dos etapas: limpieza dentro de la transacción, jobs de BullMQ después). Eliminé el endpoint genérico `PATCH /reservas/:id/estado` —el «pon el estado que quieras»— y migré su único llamador del frontend a `POST /reservas/:id/inasistencia`. Cableé la máquina en creación, aceptar, rechazar, cancelar, cancelación especial, no presentado y expiración, y reemplacé los literales de estado del dominio de reservas por constantes tipadas. Documenté H45–H48.

## 2. ARCHIVOS TOCADOS (`git diff --stat`, literal)

```
 AUDITORIA_HALLAZGOS.md                             |  39 +++
 .../agenda/application/disponibilidad.service.ts   |   6 +-
 .../src/catalogo/application/servicios.service.ts  |   3 +-
 .../application/notificacion.processor.ts          |  12 +-
 .../src/pago/application/pago.service.ts           |  17 +-
 .../application/expiracion-reserva.service.ts      |  21 +-
 .../reserva/application/reserva.service.spec.ts    | 109 +++++++-
 .../src/reserva/application/reserva.service.ts     | 285 +++++++++++++--------
 .../reserva/infrastructure/reserva.controller.ts   |  23 +-
 backend-barberias/test/permisos-matriz.e2e-spec.ts |   4 +-
 backend-barberias/test/permisos-matriz.spec.ts     |  27 +-
 docs/MATRIZ_RUTAS.md                               |  15 +-
 .../src/app/core/services/reservas.service.ts      |  11 +-
 .../app/features/agenda/admin-agenda.component.ts  |  25 +-
 14 files changed, 441 insertions(+), 156 deletions(-)
```

**Nuevos (sin seguimiento todavía):** `src/shared/domain/estados.ts` (198 líneas), `reserva-state-machine.ts` (196), `reserva-state-machine.spec.ts` (283).

## 3. TEST ROJO (antes del fix, salida literal)

**ROJO A · el test de tabla, contra el código que no existía** (`src/shared/domain/reserva-state-machine.spec.ts` sin sus módulos):

```
=== ROJO 1: tabla de transiciones (módulo inexistente) ===
       | ^
      3|   ACTORES,
      4|   ESTADOS,
⎯⎯⎯⎯⎯⎯[1/1]⎯

 Test Files  1 failed (1)
      Tests  no tests
   Start at  14:19:27
   Duration  406ms (transform 27ms, setup 0ms, import 0ms, tests 0ms, environment 0ms)

EXIT=1
```

**ROJO B · comportamiento real sobre `reserva.service.ts` en `main`** (los 4 casos nuevos + la expectativa de E1-04 renombrada):

```
 Test Files  1 failed (1)
      Tests  5 failed | 39 passed (44)
   Start at  14:20:02
   Duration  1.33s (transform 156ms, setup 0ms, import 903ms, tests 251ms, environment 0ms)

EXIT=1
```

Una de las cinco, literal (la quinta es el orden de la aserción, el hallazgo de fondo):

```
  [
    {
      "data": {
-       "estado": "NO_PRESENTADO",
+       "estado": "NO_ASISTIO",
      },
      "where": {
        "id": "uuid-reserva",
      },
    },
Number of calls: 1
```

Los cuatro casos nuevos y por qué son rojos en `main`:

| Caso | En `main` |
|---|---|
| `marcar inasistencia sobre una CANCELADA → 409` | escribía `NO_ASISTIO` y devolvía 200 |
| `marcar inasistencia dos veces → 409` | solo bloqueaba si el estado era literalmente `NO_ASISTIO` |
| `el staff no cancela una PENDIENTE → 409` | `ESTADOS_CANCELABLES` incluye PENDIENTE, así que cancelaba |
| `la inasistencia escribe NO_PRESENTADO y cierra el temporizador` | escribía `NO_ASISTIO` y no tocaba el job |

## 4. TEST VERDE (después, salida literal)

**VERDE del test de tabla** (8×8×3 = 192 decisiones + creación + los 8 planes de efectos):

```
 ✓ src/shared/domain/reserva-state-machine.spec.ts (30 tests) 19ms

 Test Files  1 passed (1)
      Tests  30 passed (30)
   Start at  14:21:41
   Duration  481ms (transform 50ms, setup 0ms, import 286ms, tests 19ms, environment 0ms)

EXIT=0
```

**E2E completo** (contra la base `dev`, con `--testTimeout=30000` por H38):

```
 Test Files  20 passed (20)
      Tests  139 passed (139)
   Start at  14:57:40
   Duration  567.07s (transform 1.76s, setup 272ms, import 52.09s, tests 506.87s, environment 4ms)

EXIT=0
```

De ese E2E, el efecto directo de la tarea:

```
 ✓ test/permisos-matriz.e2e-spec.ts (3 tests) 94070ms
     ✓ denegar o permitir cada ruta segun el rol (40 rutas × 4 roles)  81571ms
```

(era `41 rutas × 4 roles`; la fila que desaparece es `PATCH /reservas/:id/estado`).

## 5. SUITE COMPLETA: `npm run test` (resumen literal)

Comando del encargo: `npx vitest run --config ./vitest.config.ts`.

```
 Test Files  35 passed (35)
      Tests  357 passed (357)
EXIT=0
```

**323 → 357.** El delta no es una suite ampliada a la ligera: `+30` son el test de tabla de la máquina (fichero nuevo) y `+4` los casos de servicio de E2-02; los 40 del `reserva.service.spec.ts` que ya existían siguen ahí, con la única expectativa de E1-04 reescrita (`NO_ASISTIO` → `NO_PRESENTADO`). Ninguno se borró, se saltó ni se debilitó.

**`tsc --noEmit`:** `22` errores, **el mismo recuento que la base**, y **ninguno** en los archivos de esta rama (`grep` sobre `shared/domain|reserva.controller|expiracion-reserva|notificacion.processor|pago.service|reserva.service.ts\(|permisos-matriz.spec` → 0 líneas). El primer intento sí introdujo uno (`canceladoPorId` no existe en `ReservaUpdateInput`); se corrigió el tipo a `Prisma.ReservaUncheckedUpdateInput` y el recuento volvió a 22.

**`npm run lint` (backend):** `Found 46 warnings and 0 errors.` — idéntico a la base.
**`npm run lint` (frontend):** `Found 0 warnings and 0 errors.` sobre 43 ficheros.

## 6. CRITERIOS DE ACEPTACIÓN

- [x] **`src/shared/domain/estados.ts` con las constantes `as const` de los 8 estados (D14) y la tabla de §5.2 con el actor permitido.** Los 8 de §5.1, `ESTADOS_TERMINALES` (5) y `TRANSICIONES` con las 14 filas, cada una con su condición textual. Evidencia: `reserva-state-machine.spec.ts` («son exactamente los 8 de §5.1, sin duplicados»; «cada fila esperada existe en la tabla y no hay filas de más»), escrito con literales independientes de la tabla del código.
- [x] **`ReservaStateMachine.assertTransition(desde, hacia, actor)` → 409 `ESTADO_INVALIDO`.** Evidencia: caso «una transición inválida responde 409 con el contrato D40» (`getStatus() === 409` y `codigo: 'ESTADO_INVALIDO'`) y el barrido exhaustivo, que además comprueba que las 12 transiciones de estado-a-estado de §5.2 son exactamente las que pasan (192 decisiones: 12 permitidas, 180 rechazadas).
- [x] **Hook central `onEnter(estado)`.** Efectos declarados por estado en `PLANES_DE_ENTRADA`; `onEnter` ejecuta lo que va DENTRO de la transacción (borrar la información adicional en `CANCELADA`/`RECHAZADA`/`EXPIRADA`) y `despuesDeConfirmar` lo que no puede ir dentro (cancelar el job de expiración: BullMQ no participa de la transacción de Postgres). Evidencia: 5 casos de efectos en el spec + el caso VERDE de servicio que comprueba que marcar el no presentado ahora SÍ cierra el temporizador (`getJob('expirar-reserva-uuid-reserva')`).
- [x] **`cambiarEstado` depende exclusivamente de la máquina.** Ahora es privado, recibe `(tx, reserva, hacia, actor, datos?)`, su primera línea es `assertTransition` y aplica `onEnter`; los siete flujos de E3-03…E3-08 escriben por ahí. Evidencia: `git grep "async cambiarEstado"` → solo la firma privada; el E2E completo en verde.
- [x] **Endpoint genérico `PATCH :id/estado` eliminado.** Evidencia: `git grep "@Patch(':id/estado')"` vacío; la matriz de permisos pasa de **64 rutas × 4 = 256** a **63 × 4 = 252** decisiones y el E2E HTTP de **41 a 40 rutas**; el botón «No Asistió» apunta a `POST /reservas/:id/inasistencia` y solo aparece en `CONFIRMADA`.
- [x] **Ningún literal de estado de reserva fuera de `estados.ts`.** `git grep -nE "'(PENDIENTE|CONFIRMADA|COMPLETADA|EXPIRADA|NO_ASISTIO|CANCELADA[A-Z_]*|NO_PRESENTADO|RECHAZADA|PROPUESTA_PENDIENTE)'" -- src` (sin `*.spec.ts`) devuelve 12 líneas y **ninguna es un estado de reserva escrito a mano**: 6 son de OTROS dominios (`antecedente.estadoValidacion` ×3, `barberia.estadoVinculacion`, `auth` y `notificacion` con su propio `estado`), 3 el `ResultadoExpiracion` del servicio de expiración (etiqueta de resultado, no estado), 1 el `codigo` D40 `PROPUESTA_PENDIENTE` (H46, nota) y 2 del módulo `src/cliente/` contenido por H22 (`NO_ASISTIO`/`CANCELADA_TARDE`). En `agenda/disponibilidad.service.ts` y `catalogo/servicios.service.ts`, los dos que sí eran estados de reserva, ya usan las constantes.
- [x] **Test de las 64 combinaciones 8×8 por actor.** Un `it` recorre las 8×8×3 = 192 decisiones y exige que `permite()` coincida con la matriz esperada y que `assertTransition` lance justo en las que no: `permitidas === 12`, `rechazadas === 180`, `total === 192`.
- [x] **Rojo → verde («hoy CANCELADA → CONFIRMADA es posible»).** Es uno de los casos del spec (409 en `permite`/`assertTransition`) y había rojo real de comportamiento en el servicio (sección 3).
- [x] **La suite base sigue verde.** 357/357 con `EXIT=0`, más 139/139 de E2E.

## 7. DECISIONES O DESVIACIONES

1. **El endpoint se ELIMINÓ, no se restringió.** El encargo permitía «elimina o restringe estrictamente». Eliminarlo era lo defendible: el grafo se puede vigilar dentro de `cambiarEstado`, pero las CONDICIONES de §5.2 (ventana de 30 min, motivo obligatorio, bandera D17, revalidación del hueco) viven en cada flujo, y una ruta genérica no puede aplicarlas. Su único llamador era el botón «No Asistió», migrado a la ruta dedicada.
2. **El no presentado se escribe como `NO_PRESENTADO`.** `NO_ASISTIO` no está en §5.1 y no hay constante que lo represente: o se renombraba o se mentía sobre el catálogo. Se renombró (H45). Medición de impacto en la base `dev`, solo lectura: `reservas` por estado → `[{"EXPIRADA":3},{"CONFIRMADA":1}]`, así que **hoy no hay ninguna fila que migrar**.
3. **La matriz se aplica VERBATIM, y eso estrecha dos caminos del staff.** §5.2 no tiene fila para `PENDIENTE → CANCELADA` con actor distinto del CLIENTE, ni para `PROPUESTA_PENDIENTE → CANCELADA` por el staff. Consecuencia: la cancelación de la sede solo funciona desde `CONFIRMADA`; para una solicitud pendiente la herramienta es `POST :id/rechazar` (§5.2 fila 4). Queda como decisión de diseño: si el producto quiere que la sede retire una solicitud pendiente, hay que AÑADIR la fila a §5.2, no rodear la matriz en el código.
4. **El rechazo del doble marcado pasa de 400 a 409.** Antes era `BadRequestException('La reserva ya está marcada como inasistencia')`; ahora es el 409 `ESTADO_INVALIDO` que D40 asigna a un conflicto de estado. Ningún test lo cubría.
5. **La comprobación de estado va antes de la de ventana** en cancelar y aceptar: una reserva terminal no es «fuera de ventana» ni «conflicto de horario», es una transición inválida. Sin ese orden, el primer intento de esta rama devolvía `CONFLICTO_HORARIO` en lugar de `ESTADO_INVALIDO` (lo cazó la suite, no una revisión).
6. **Dos catálogos más entran en `estados.ts`:** `ESTADOS_PROPUESTA`/`TIPOS_PROPUESTA` (D18) y `ESTADOS_CANCELACION_ESPECIAL` (D17). No son estados de reserva, pero estaban como literales en `reserva.service.ts` y el criterio de aceptación del backlog es de literales: juntos son 30 líneas y evitan que `'PENDIENTE'` de la propuesta se confunda con el de la reserva.
7. **Los `.spec.ts` conservan los literales a propósito.** El test de tabla se escribió con cadenas crudas justamente para que sea un oráculo independiente de las constantes; el `grep` de aceptación del backlog se cumple sobre el código de producción.
8. **`pago.service` solo cambia literales.** Su transición a `COMPLETADA` sigue sin pasar por la máquina: es exactamente lo que E3-09 viene a hacer (H47). Ampliarlo aquí habría cambiado quién puede cobrar y desde cuándo, que no es E2-02.

## 8. HALLAZGOS NUEVOS

Registrados en `AUDITORIA_HALLAZGOS.md`:

- **H45 (Media)** — `NO_ASISTIO`, noveno estado fuera del catálogo, sin `CHECK` que lo detuviera, y `marcarInasistencia` ejecutable desde cualquier estado. Resuelto parcialmente en E2-02.
- **H46 (Media)** — `PATCH /reservas/:id/estado`: el ciclo de vida entero a un `update` sin grafo. Resuelto en E2-02 (ruta eliminada; matriz 64 → 63). Incluye la nota del `codigo` D40 `PROPUESTA_PENDIENTE`, que colisiona con el nombre del estado.
- **H47 (Media)** — `pago.service` marca `COMPLETADA` sin pasar por la máquina ni por `hora_inicio`. Abierto (E3-09).
- **H48 (Baja)** — el recordatorio de 1 h no tiene `jobId` determinístico, así que `onEnter` no puede cancelarlo (D33 a medias): la mitad «cancelar el recordatorio» del §E3-07 punto 4 sigue sin ser implementable. Detectado al implementar el hook.

## 9. PENDIENTE O NO VERIFICADO

- **E2-03 sigue abierta:** `reservas.estado` continúa siendo un `VARCHAR` sin `CHECK` en la base. La máquina cierra la puerta por código, no por esquema; SQL a mano sigue pudiendo escribir un estado inválido. Es la tarea siguiente y la matriz de §5.2 ya está lista para traducirse a `CHECK`.
- **No verifiqué el frontend en ejecución.** Solo `oxlint` (0/0) y la lectura del flujo; no levanté la SPA ni comprobé el botón «No Asistió» contra un backend vivo. El E2E cubre la ruta a la que apunta.
- **El hook de limpieza es un no-op a propósito:** `informacion_adicional` no existe (H32). Queda cableado, no probado contra datos reales.
- **No ejecuté el E2E en CI** (no hay `push`): la corrida es local, contra la base `dev` y con `--testTimeout=30000`. El paso de E2E del workflow existe desde el PR que lo añadió; el default de 5 s sigue sin corregirse (H38).
- **Sin commit.** Todo está en el árbol de trabajo de `fix/maquina-estados-reserva`; el `git status` de abajo es el estado entregado.

## 10. git status --short / git log -1 --oneline / git log --oneline -5

```
 M ../AUDITORIA_HALLAZGOS.md
 M src/agenda/application/disponibilidad.service.ts
 M src/catalogo/application/servicios.service.ts
 M src/notificacion/application/notificacion.processor.ts
 M src/pago/application/pago.service.ts
 M src/reserva/application/expiracion-reserva.service.ts
 M src/reserva/application/reserva.service.spec.ts
 M src/reserva/application/reserva.service.ts
 M src/reserva/infrastructure/reserva.controller.ts
 M test/permisos-matriz.e2e-spec.ts
 M test/permisos-matriz.spec.ts
 M ../docs/MATRIZ_RUTAS.md
 M ../frontend-barberias/src/app/core/services/reservas.service.ts
 M ../frontend-barberias/src/app/features/agenda/admin-agenda.component.ts
?? src/shared/domain/
```

```
d6f4875 Merge pull request #45 from Codecore-J/feat/e3-08-cancelacion-especial-propuesta
```

```
d6f4875 Merge pull request #45 from Codecore-J/feat/e3-08-cancelacion-especial-propuesta
9f4a4a6 feat(reservas): cancelacion especial y propuestas de horario (E3-08)
2265241 Merge pull request #44 from Codecore-J/feat/e3-06-07-reprogramacion-reglas
65b844a feat(reservas): reprogramacion de citas (E3-06) y limites de cancelacion (E3-07)
c90b55a Merge pull request #43 from Codecore-J/feat/e3-05-expiracion-cancelacion
```

No hagas merge. Espera aprobación.
