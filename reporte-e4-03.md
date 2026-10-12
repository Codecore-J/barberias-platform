# E4-03 · Fidelización: restricción por inasistencias y reactivación

> Plantilla 8.4 de `docs/BACKLOG_BARBERIAS_V1.md`. **Sin `push` ni `merge`.**
> Rama de trabajo: `feat/oportunidades-espacio` (el backlog sugiere `feat/fidelizacion-restricciones`;
> los cambios siguen sin commitear, así que se pueden mover a esa rama antes del PR).

## 1. ¿Qué hice?

**Fase 1 · Preparación**

- Leí E4-03 del backlog, las decisiones que la gobiernan (**D48**: la penalización es LOCAL; **D20/D21**:
  la restricción y el contador sobreviven a desvincular/revincular) y lo ya entregado por E3-10.
- Comprobé qué existía y qué no antes de tocar nada:
  - **Ya existía:** el contador `contadorNoPresentado`, la bandera `esta_restringido`, `motivo_restriccion`,
    su incremento en `ReservaService.marcarInasistencia` (con el literal `5`) y el bloqueo 403
    `CLIENTE_RESTRINGIDO` en `ReservaService.crearReserva`, que es **el mismo método** para individuales y
    grupales (el walk-in también entra por ahí).
  - **Faltaba:** la regla como dominio explícito, la auditoría del cambio, la bandeja local de restringidos,
    el perdón del ADMIN_BARBERIA y toda la cobertura de pruebas.

**Fase 2 · Implementación**

1. **Dominio puro** — [`src/reserva/domain/fidelizacion.ts`](backend-barberias/src/reserva/domain/fidelizacion.ts):
   `evaluarInasistencia(contador, estado, limiteDeLaSede)`. Fija el §5.8 en un solo lugar: advertencia a las
   3, restricción al llegar al **límite de la sede** (5 por defecto), motivo autogenerado y conservación de
   una restricción vigente (D20). Es pura: sin Prisma, sin reloj y sin tocar `usuarios.estado_cuenta` (D48).
2. **[`ReservaService.marcarInasistencia`](backend-barberias/src/reserva/application/reserva.service.ts)**
   consume esa regla en lugar del literal y **audita** el nacimiento de la restricción
   (`CLIENTE_RESTRINGIDO`, con `barberiaId`, contador y límite) dentro de la misma transacción (D28).
   El respuesta añade `motivoRestriccion` y `advertencia` sin romper el contrato previo.
3. **Bloqueo de la reserva** (individual y grupal): se mantiene en `crearReserva` —403
   `CLIENTE_RESTRINGIDO` con el motivo guardado, **antes** de leer configuración, disponibilidad o
   participantes— y ahora está cubierto por pruebas de servicio y por el E2E.
4. **Bandeja local (E4-03)** — nuevos
   [`ClientesRestringidosController`](backend-barberias/src/barberia/infrastructure/clientes-restringidos.controller.ts)
   y [`ClientesRestringidosService`](backend-barberias/src/barberia/application/clientes-restringidos.service.ts):
   - `GET /barberias/:id/clientes-restringidos` → solo las filas restringidas **de esa sede**, con contador
     y motivo.
   - `POST /barberias/:id/clientes/:clienteId/reactivar` → el perdón: `esta_restringido = false`,
     `motivo_restriccion = null` y **contador a 0**, auditado como `RESTRICCION_LEVANTADA` con el valor
     anterior y el nuevo. 404 sin vinculación, 422 `SIN_RESTRICCION` si no estaba restringido.
   - Ambas rutas declaran `@Roles(ADMIN_BARBERIA, ADMINISTRADOR)` (fail-closed) y usan `:id`, así que la
     pertenencia real a la sede la exige el servicio (403), como en E3-13.
5. **Matriz y documentación**: dos filas nuevas (60 y 61) en
   [`docs/MATRIZ_RUTAS.md`](docs/MATRIZ_RUTAS.md), `POLITICA_DECLARADA` de
   [`test/permisos-matriz.spec.ts`](backend-barberias/test/permisos-matriz.spec.ts) (69 → **71 rutas**,
   276 → **284** decisiones) y dos casos en
   [`test/permisos-matriz.e2e-spec.ts`](backend-barberias/test/permisos-matriz.e2e-spec.ts).

**Fase 3 · Verificación**

- Unitarios: dominio (5), servicio de la bandeja (11) y describe E4-03 de `ReservaService` (6).
- E2E propio del ciclo completo: [`test/e4-03-fidelizacion.e2e-spec.ts`](backend-barberias/test/e4-03-fidelizacion.e2e-spec.ts) (4 casos).
- Suite completa unitaria y suite E2E completa (§5).

## 2. Archivos tocados

**Nuevos**

| Archivo | Qué aporta |
|---|---|
| [`src/reserva/domain/fidelizacion.ts`](backend-barberias/src/reserva/domain/fidelizacion.ts) | Regla pura de inasistencias (límite de la sede, advertencia, motivo) |
| [`src/reserva/domain/fidelizacion.spec.ts`](backend-barberias/src/reserva/domain/fidelizacion.spec.ts) | 5 casos del dominio |
| [`src/barberia/application/clientes-restringidos.service.ts`](backend-barberias/src/barberia/application/clientes-restringidos.service.ts) | Listar restringidos de la sede + perdón auditado |
| [`src/barberia/application/clientes-restringidos.service.spec.ts`](backend-barberias/src/barberia/application/clientes-restringidos.service.spec.ts) | 11 casos (permisos por sede, 422/404, auditoría, D48) |
| [`src/barberia/application/dto/reactivar-cliente.dto.ts`](backend-barberias/src/barberia/application/dto/reactivar-cliente.dto.ts) | Cuerpo opcional `{ motivo }` |
| [`src/barberia/infrastructure/clientes-restringidos.controller.ts`](backend-barberias/src/barberia/infrastructure/clientes-restringidos.controller.ts) | Las dos rutas de la bandeja |
| [`test/e4-03-fidelizacion.e2e-spec.ts`](backend-barberias/test/e4-03-fidelizacion.e2e-spec.ts) | E2E del ciclo completo + aislamiento por sede + D48 |

**Modificados**

| Archivo | Cambio |
|---|---|
| [`src/reserva/application/reserva.service.ts`](backend-barberias/src/reserva/application/reserva.service.ts) | `marcarInasistencia` usa la regla pura y audita la restricción |
| [`src/reserva/application/reserva.service.spec.ts`](backend-barberias/src/reserva/application/reserva.service.spec.ts) | Describe E4-03: 403 individual/grupal, 5ª y 3ª inasistencia, D20, permiso ajeno |
| [`src/barberia/barberia.module.ts`](backend-barberias/src/barberia/barberia.module.ts) | Registra el controlador y el servicio nuevos |
| [`test/permisos-matriz.spec.ts`](backend-barberias/test/permisos-matriz.spec.ts) | +2 rutas y conteos 71/284 |
| [`test/permisos-matriz.e2e-spec.ts`](backend-barberias/test/permisos-matriz.e2e-spec.ts) | +2 casos HTTP de la bandeja |
| [`docs/MATRIZ_RUTAS.md`](docs/MATRIZ_RUTAS.md) | Filas 60 y 61 + estado real tras E4-03 |
| [`src/agenda/domain/huecos.spec.ts`](backend-barberias/src/agenda/domain/huecos.spec.ts) | Arregla 2 asertos dependientes del TZ del runner (hallazgo H51, no es de E4-03) |

## 3. Test Rojo (salida literal)

El E2E se escribió primero y se ejecutó contra el árbol **sin la implementación** (`git stash push -- backend-barberias/src`,
conservando el spec): los cuatro casos fallan.

```text
 ❯ test/e4-03-fidelizacion.e2e-spec.ts:277:35
    275|     expect(enA.contadorNoPresentado).toBe(5);
    276|     expect(enA.estaRestringido).toBe(true);
    277|     expect(enA.motivoRestriccion).toContain('5 inasistencias');
       |                                   ^

⎯⎯⎯⎯⎯⎯⎯⎯[2/4]⎯
 FAIL  test/e4-03-fidelizacion.e2e-spec.ts > ROJO/VERDE: la bandeja es de la sede — el staff ajeno y el cliente reciben 403
AssertionError: expected 404 to be 403 // Object.is equality
 ❯ test/e4-03-fidelizacion.e2e-spec.ts:389:32
    389|     expect(comoBarbero.status).toBe(403);

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/4]⎯
 FAIL  ... > sin restricción vigente el perdón responde 422 SIN_RESTRICCION
AssertionError: expected 404 to be 422 // Object.is equality
 ❯ test/e4-03-fidelizacion.e2e-spec.ts:423:24

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[4/4]⎯
 FAIL  ... > un cliente sin vinculación con la sede responde 404 (nunca 500)
AssertionError: expected 'Cannot POST /api/v1/barberias/dea009f5-…/clientes/11111111-…/reactivar'
                        to be 'El cliente no está vinculado a esta barbería.'
 ❯ test/e4-03-fidelizacion.e2e-spec.ts:436:30

 Test Files  1 failed (1)
      Tests  4 failed (4)
   Duration  18.71s
```

El primer fallo es el del motivo: el código anterior escribía el literal
«Bloqueo automático: Superó el límite de inasistencias (5)», que no contiene el límite que la sede aplica.
Los fallos 2 a 4 son 404: **las dos rutas de la bandeja todavía no existían** (el 404 del último caso se
comprueba por mensaje, para que la prueba no pase por accidente sin implementación).

## 4. Test Verde (salida literal)

```text
 ✓ test/e4-03-fidelizacion.e2e-spec.ts (4 tests) 26124ms
     ✓ VERDE: ciclo completo — límite, bloqueo, perdón y vuelta a reservar  14347ms
     ✓ ROJO/VERDE: la bandeja es de la sede — el staff ajeno y el cliente reciben 403  1060ms
     ✓ sin restricción vigente el perdón responde 422 SIN_RESTRICCION  480ms
     ✓ un cliente sin vinculación con la sede responde 404 (nunca 500)  479ms

 Test Files  1 passed (1)
      Tests  4 passed (4)
```

```text
 ✓ src/reserva/domain/fidelizacion.spec.ts (5 tests) 9ms
 ✓ src/barberia/application/clientes-restringidos.service.spec.ts (11 tests) 401ms
       ✓ el ADMIN_BARBERIA de la sede recibe solo las filas restringidas de ESA sede  347ms

 Test Files  2 passed (2)
      Tests  16 passed (16)
```

```text
 ✓ src/reserva/application/reserva.service.spec.ts (56 tests | 50 skipped) 387ms
       ✓ VERDE: el INDIVIDUAL de un cliente restringido responde 403 CLIENTE_RESTRINGIDO  349ms

 Test Files  1 passed (1)
      Tests  6 passed | 50 skipped (56)
```

## 5. Suite completa

```text
npm test
 Test Files  43 passed (43)
      Tests  470 passed (470)
   Duration  12.08s (transform 7.20s, setup 0ms, import 98.96s, tests 28.89s, environment 14ms)
```

```text
APP_ENV=dev npx vitest run --config ./vitest.config.e2e.ts

 Test Files  26 passed (26)
      Tests  189 passed (189)
   Duration  718.13s (transform 2.35s, setup 350ms, import 70.90s, tests 636.46s, environment 5ms)
EXIT:0
```

En la corrida completa, el spec de esta tarea entra primero y pasa entero:

```text
 ✓ test/e4-03-fidelizacion.e2e-spec.ts (4 tests) 24565ms
```

## 6. Criterios de aceptación

| Criterio | Estado | Evidencia |
|---|---|---|
| Al llegar al límite de la sede el cliente queda restringido con motivo | ✅ | E2E paso 1-2; `fidelizacion.spec.ts` |
| Un cliente restringido en A **sigue reservando en B** (aislamiento, D48) | ✅ | E2E paso 3 y 6 (201 en B con la fila de A restringida) |
| La creación de reservas bloquea al restringido de ESA sede (403) | ✅ | E2E paso 5 (individual **y** grupal); 3 casos unitarios `CLIENTE_RESTRINGIDO` |
| El ADMIN_BARBERIA de la sede lista a sus restringidos | ✅ | E2E paso 4; 5 casos unitarios de permisos |
| `POST …/clientes/:clienteId/reactivar` levanta la restricción y reinicia el contador, auditado | ✅ | E2E pasos 7-8 (BD + `RESTRICCION_LEVANTADA`) |
| Tras el perdón el cliente vuelve a reservar | ✅ | E2E paso 9 (201) |
| Perdonar sin restricción vigente → 422 `SIN_RESTRICCION` | ✅ | E2E y unitario |
| Ningún camino automático escribe `usuarios.estado_cuenta` (D48) | ✅ | E2E pasos 2, 11 (cuenta sigue `ACTIVO`) y unitario que lo declara |
| Rojo → verde | ✅ | §3 y §4 |
| Suite completa sin fallos | ✅ | §5 (unitarios y E2E) |

## 7. Decisiones

1. **«El límite de la sede» = 5 (spec 01 §5.8), parametrizable en la función pura y sin columna nueva.**
   Ninguna decisión del backlog define un umbral editable por sede, así que no inventé un campo de
   `configuracion_barberia`: la regla es local (esa fila de `cliente_barberias`) con el límite del §5.8 y la
   firma ya admite otro valor si el dueño lo pide. Añadirlo sería un cambio de esquema + E3-11.
2. **El perdón del ADMIN_BARBERIA reinicia el contador**, tal como pidió el dueño en esta entrega
   («perdonarlos (reinicia contador y quita restricción)»). Es una **divergencia consciente** con el bullet
   E4-03/3 del backlog, que describe el flujo **cliente-iniciado** (`restriccion/solicitar` →
   `restriccion/reactivacion/resolver`) donde aprobar CONSERVA `contador_no_presentado` (D21). Ese flujo no
   forma parte de esta entrega; este endpoint es una acción directa de la sede. Queda listado como hallazgo.
3. **`motivo` opcional en el DTO** (mínimo 3 caracteres si llega). La autorización la da el rol y el evento
   de auditoría se registra siempre: con motivo, o `null` si no se envía.
4. **Controlador y servicio propios** (`ClientesRestringidos*`) en vez de engordar `BarberiaService`: el
   proyecto ya separa por preocupación (`configuracion-barberia`, `plataforma-vinculaciones`) y así la
   bandeja se prueba aislada.
5. **Auditoría D28** con `CLIENTE_RESTRINGIDO` (automática, dentro de la transacción) y
   `RESTRICCION_LEVANTADA` (perdón, con `anterior` y `nuevo`).
6. **`HttpCode(200)`** en la reactivación: no crea un recurso, resuelve una restricción.
7. **Se arreglaron los 2 asertos de `huecos.spec.ts`** que usaban `getHours()` sobre fixtures compuestas en
   UTC (solo pasaban con `TZ=UTC`). No es código de E4-03: se corrigió porque la suite completa debe quedar
   en 0 en la zona de la sede (hallazgo H51).

## 8. Hallazgos

| # | Hallazgo | Estado |
|---|---|---|
| H51 | [`src/agenda/domain/huecos.spec.ts`](backend-barberias/src/agenda/domain/huecos.spec.ts) aseveraba `getHours()`/`getMinutes()` sobre instantes UTC: **2 fallos en `America/Santo_Domingo`**, verdes en `TZ=UTC`. Se cambia a `getUTCHours()`/`getUTCMinutes()` conservando el valor esperado | **Corregido** |
| H52 | `marcarInasistencia` no comprueba la **ventana de §5.2 fila 12** (solo desde `CONFIRMADA` y con ahora ≥ inicio + 15 min, 422 `FUERA_DE_VENTANA` que pedía E3-10 §2). La máquina de estados cubre el estado de origen, pero no el tiempo: hoy un `NO_PRESENTADO` se puede marcar antes de que la cita empiece | **Abierto** (fuera del alcance de E4-03) |
| H53 | La ruta que pedía E3-10 §4 (`POST …/clientes/:clienteId/restriccion/levantar {motivo}`, auditada) no existía. E4-03 entrega el perdón como `POST /barberias/:id/clientes/:clienteId/reactivar` (mismo efecto + reinicio del contador) | **Cubierto con otro nombre** |
| H54 | La advertencia de las 3 inasistencias sigue **sin llegar al cliente**: `evaluarInasistencia` la calcula, pero no hay `GET /barberias/:barberiaId/mi-estado` (bullet E4-03/2) ni notificación. El dado está en la regla pura, listo para exponerlo | **Abierto** (bullet E4-03/2) |
| H55 | Texto del motivo anterior: «Bloqueo automático: Superó el límite de inasistencias (5)» no nombraba el límite que la sede aplica; ahora es «Bloqueo automático: alcanzaste el límite de N inasistencias en esta barbería». Como el texto vive en la fila, los motivos ya guardados conservan el texto viejo | **Corregido a futuro**, sin migración de textos |

**Sin `push` ni `merge`.** Cambios en el árbol de trabajo, listos para revisión.
