# TAREA: E3-08 · Cancelación especial (D17) y propuesta de horario (D18 / §5.4)

**RAMA:** `feat/e3-08-cancelacion-especial-propuesta` (desde `main` = `2265241`, merge del PR #44 de E3-06/E3-07)

---

## 1. QUÉ HICE (5 líneas máximo)

1. **Migración D17:** `configuracion_barberia.permite_cancelacion_especial` (FALSE por defecto) y, en
   `reservas`, `cancelado_por_id` (FK a `usuarios`), `cancelacion_especial_estado/motivo/detalle` con sus
   `CHECK` de catálogo §5.5.
2. **Migración D18:** tabla `propuestas_horario` con `tipo`/`estado`/`expira_at`, FK en cascada a la
   reserva y dos índices (uno parcial para «la propuesta viva»).
3. **Cancelación especial:** `POST /barberias/:barberiaId/reservas/:id/cancelacion-especial`
   (`ADMIN_BARBERIA`, `ADMINISTRADOR`) con motivo obligatorio: registra quién la ejecutó, libera el
   horario, cancela el job de expiración y audita.
4. **Propuesta de horario:** `POST .../proponer-horario` (CLIENTE dueño) crea una propuesta `PENDIENTE` de
   10 minutos **sin ocupar agenda**; `POST .../propuesta-horario/aceptar|rechazar` (staff) la resuelve, y
   la aceptación **revalida el hueco bajo el `FOR UPDATE` de la sede** antes de mover la cita.
5. Tests: **+16 unitarios** (307 → 323) y un **E2E nuevo de 15 casos** contra BD/Redis reales, los dos
   medidos ROJO → VERDE. Sin `push` ni `merge`.

---

## 2. ARCHIVOS TOCADOS (`git diff --stat`, literal)

```
 AUDITORIA_HALLAZGOS.md                             |  52 +-
 backend-barberias/prisma/schema.prisma             |  49 +-
 .../src/reserva/application/reserva.service.ts     | 528 +++++++++++++++++++++
 .../reserva/infrastructure/reserva.controller.ts   |  63 +++
 backend-barberias/test/permisos-matriz.spec.ts     |  21 +-
 docs/MATRIZ_RUTAS.md                               |  23 +
 6 files changed, 724 insertions(+), 12 deletions(-)
```

Cuatro archivos **nuevos** (no aparecen en `git diff --stat` porque siguen sin trackear):

| Archivo | Líneas | Qué es |
|---|---|---|
| `backend-barberias/prisma/migrations/20261010000000_e308_cancelacion_especial_propuestas/migration.sql` | 88 | La migración D17 + D18 |
| `backend-barberias/src/reserva/application/dto/cancelacion-especial.dto.ts` | 47 | DTO y catálogo §5.5 de cancelación (`EMERGENCIA`, `ENFERMEDAD`, `CIERRE_IMPREVISTO`, `FUERZA_MAYOR`, `OTRO`) |
| `backend-barberias/src/reserva/application/reserva-e308.spec.ts` | 446 | Los 16 unitarios de E3-08 (arnés aislado con sus propios mocks) |
| `backend-barberias/test/e3-08-cancelacion-especial-propuesta.e2e-spec.ts` | 635 | Los 15 casos E2E |

---

## 3. TEST ROJO (antes del fix, salida literal)

Medido **con los tests finales** y el código de producción en `HEAD`, sacando la implementación con un
`git stash` temporal de solo dos archivos (`reserva.service.ts` y `reserva.controller.ts`). El stash NO
incluye los tests ni la migración: eso es lo que hace válida la medición.

```
$ git stash push -m "E308 ROJO temporal" -- \
    backend-barberias/src/reserva/application/reserva.service.ts \
    backend-barberias/src/reserva/infrastructure/reserva.controller.ts
Saved working directory and index state On feat/e3-08-cancelacion-especial-propuesta: E308 ROJO temporal
```

### 3.1 Suite unitaria

```
$ APP_ENV=dev npx vitest run --config ./vitest.config.ts
EXIT=1
 Test Files  2 failed | 32 passed (34)
      Tests  18 failed | 305 passed (323)
```

Los 18 fallos = **16 nuevos + 2 de la matriz de permisos**:

```
× VERDE: registra quién y el motivo, deja la reserva CANCELADA/APROBADA y audita
× ROJO: sin la bandera D17 → 422 CANCELACION_ESPECIAL_NO_HABILITADA y no se toca nada
× ROJO: OTRO sin detalle suficiente → 400 MOTIVO_INVALIDO
× ROJO: un motivo fuera del catálogo de cancelación → 400 MOTIVO_INVALIDO
× ROJO: una reserva terminal → 409 ESTADO_INVALIDO
× ROJO: una reserva inexistente en esa sede → 404
× VERDE: el cliente dueño propone: PENDIENTE con 10 minutos y sin mover la cita
× ROJO: un cliente ajeno no puede proponer → 403 RESERVA_AJENA
× ROJO: ya hay una propuesta viva → 409 PROPUESTA_PENDIENTE
× ROJO: proponer sobre una reserva terminal → 409 ESTADO_INVALIDO
× VERDE: aceptar mueve la cita, cierra la propuesta y audita el origen
× ROJO: aceptar sin propuesta viva → 409 SIN_PROPUESTA
× ROJO: una propuesta vencida → 409 PROPUESTA_EXPIRADA, se marca EXPIRADA y no se mueve
× ROJO: el hueco se ocupó antes de aceptar → 409 CONFLICTO_HORARIO
× VERDE: rechazar cierra la propuesta sin mover la cita
× ROJO: rechazar sin propuesta viva → 409 SIN_PROPUESTA
× descubrir las 64 rutas del servidor y todas tienen decision
× RolesGuard concede a cada rol exactamente lo que dice la matriz
```

### 3.2 E2E (`test/e3-08-cancelacion-especial-propuesta.e2e-spec.ts`)

```
$ APP_ENV=dev npx vitest run --config ./vitest.config.e2e.ts --testTimeout=40000 \
    test/e3-08-cancelacion-especial-propuesta.e2e-spec.ts
EXIT=1
 Test Files  1 failed (1)
      Tests  15 failed (15)
```

Causa literal de la primera:

```
AssertionError: {"message":"Cannot POST /api/v1/barberias/…/reservas/…/cancelacion-especial",
"error":"Not Found","statusCode":404}: expected 404 to be 422
AssertionError: {"message":"Cannot POST /api/v1/barberias/…/reservas/…/cancelacion-especial",
"error":"Not Found","statusCode":404}: expected 404 to be 201
```

Es decir: ninguna de las cuatro rutas existía (404) y las dos reglas nuevas estaban ausentes.

---

## 4. TEST VERDE (después, salida literal)

```
$ git stash pop
Dropped refs/stash@{0} (d4ff0ef8217f65c7b1f66db7776d717deff9f83a)
$ git stash list      # vacía
```

### 4.1 Suite unitaria

```
$ APP_ENV=dev npx vitest run --config ./vitest.config.ts
EXIT=0
 Test Files  34 passed (34)
      Tests  323 passed (323)
```

**307 → 323 (+16).** Reparto: 6 de cancelación especial y 10 de propuesta de horario.

Dos controles de comportamiento, con su aserción literal:

- La ventana es de **10 minutos exactos** con reloj falso: la propuesta se crea con
  `expiraAt: new Date(2026, 9, 10, 9, 10, 0)` cuando el reloj marca `09:00:00`, y proponer
  **no** llama a `reserva.update` (la cita no se mueve).
- La cancelación especial escribe **todo junto**:
  `expect(reserva.update).toHaveBeenCalledWith({ where: { id: 'uuid-reserva' }, data: {
  estado: 'CANCELADA', canceladoPorId: 'uuid-admin', cancelacionEspecialEstado: 'APROBADA',
  cancelacionEspecialMotivo: 'EMERGENCIA', cancelacionEspecialDetalle: null } })`, y la auditoría guarda
  `canceladoPor: 'STAFF'` y el motivo.

### 4.2 E2E

```
$ APP_ENV=dev npx vitest run --config ./vitest.config.e2e.ts --testTimeout=40000 \
    test/e3-08-cancelacion-especial-propuesta.e2e-spec.ts
EXIT=0
 ✓ test/e3-08-cancelacion-especial-propuesta.e2e-spec.ts (15 tests) 74826ms
     ✓ ROJO: sin la bandera D17 → 422 CANCELACION_ESPECIAL_NO_HABILITADA y la reserva no se toca  5232ms
     ✓ VERDE: con la bandera, la sede cancela con motivo: registra quién, libera el hueco y audita  5552ms
     ✓ ROJO: motivo OTRO sin detalle → 400 y la reserva sigue viva  2977ms
     ✓ ROJO: un CLIENTE no puede ejecutar la cancelación especial (403 del guard)  2769ms
     ✓ ROJO: un admin de otra sede recibe 403  2719ms
     ✓ ROJO: cancelación especial de una reserva ya cancelada → 409 ESTADO_INVALIDO  3960ms
     ✓ ROJO: el CLIENTE dueño propone un horario: ventana de 10 min, sin mover la cita ni ocupar el hueco  5443ms
     ✓ ROJO: la sede acepta la propuesta y la cita se mueve, con auditoría  5464ms
     ✓ ROJO: aceptar sin propuesta viva → 409 SIN_PROPUESTA  3209ms
     ✓ ROJO: si el hueco se ocupa antes de aceptar → 409 CONFLICTO_HORARIO y la cita no se mueve  7488ms
     ✓ ROJO: no se puede proponer dos veces mientras hay una viva → 409 PROPUESTA_PENDIENTE  4373ms
     ✓ ROJO: una propuesta vencida no se puede aceptar → 409 PROPUESTA_EXPIRADA  4765ms
     ✓ ROJO: un CLIENTE ajeno no puede proponer sobre la reserva de otro → 403 RESERVA_AJENA  2998ms
     ✓ ROJO: la sede rechaza la propuesta sin mover la cita  4893ms
     ✓ ROJO: proponer un horario para una reserva terminal → 409 ESTADO_INVALIDO  3908ms
 Test Files  1 passed (1)
      Tests  15 passed (15)
```

> **Nota de entorno (H38):** `--testTimeout` sigue siendo obligatorio. Con el default de 5 s esta MISMA
> ejecución falla por timeouts contra la BD remota, no por reglas de negocio.

### 4.3 Estado de la BD y del esquema

```
$ npx prisma migrate status
6 migrations found in prisma/migrations
Database schema is up to date!

$ npx prisma migrate diff --from-schema-datasource prisma/schema.prisma \
    --to-schema-datamodel prisma/schema.prisma --script
-- This is an empty migration.
```

---

## 5. SUITE COMPLETA: `npm run test` (resumen literal)

```
$ npm run test
 Test Files  34 passed (34)
      Tests  323 passed (323)
EXIT=0
```

Complementarios:

| Comando | Salida literal | ¿Bloquea? |
|---|---|---|
| `npm run lint` (oxlint) | `Found 46 warnings and 0 errors.` / `Finished in 2.3s on 158 files with 111 rules using 16 threads.` | No: **mismo recuento que la base** (46 en E3-06/07) |
| `npx tsc --noEmit -p tsconfig.json` | `22` errores, **idénticos a los preexistentes**; `grep` por `e308`, `cancelacion-especial`, `reserva.service.ts` y `reserva.controller.ts` → **sin coincidencias** | No: el repo ya venía con 22 |
| `test/permisos-matriz.spec.ts` | `=== MATRIZ ROL × RUTA (64 rutas × 4 roles = 256 decisiones) ===` | Sí: pasa |
| `test/route-security.spec.ts` | `=== CONTEO === Public: 6 | Autenticado: 5 | Roles: 53 | ninguno: 0` | Sí: pasa (0 rutas sin decorador) |

---

## 6. CRITERIOS DE ACEPTACIÓN

### Lo pedido en el encargo

- [x] **Migración D17** con `cancelado_por_id` (FK a `usuarios`), `cancelacion_especial_motivo` y
      `cancelacion_especial_detalle` — más `cancelacion_especial_estado` y
      `permite_cancelacion_especial`, que el backlog exige en el mismo punto. Aplicada y verificada contra
      la BD (`migrate status` y `migrate diff` limpios).
- [x] **`POST /barberias/:barberiaId/reservas/:id/cancelacion-especial`** exclusivo de `ADMINISTRADOR` y
      `ADMIN_BARBERIA`: registra quién la ejecutó (`canceladoPorId` + auditoría), el motivo, **libera el
      horario** (E2E: otro cliente reserva el hueco liberado → 201) y **cancela el job de expiración**
      (`cancelarJobExpiracion` con el `jobId` determinista).
- [x] **Propuesta de horario del CLIENTE**: `POST .../proponer-horario` (CLIENTE dueño) **sin afectar la
      disponibilidad actual** — el E2E demuestra que el hueco propuesto sigue siendo reservable por otro
      cliente (201) y que la cita no se mueve.
- [x] **Aceptación por el staff:** `POST .../propuesta-horario/aceptar` revalida el hueco bajo el lock de la
      sede, mueve la cita y audita; `.../rechazar` cierra la propuesta sin tocar la cita.
- [x] **Tests E2E en ROJO** para ambos flujos (15/15 fallando con 404) y en **VERDE** (15/15).
- [x] **Suite unitaria completa desde la base de 307:** 323 en verde con `EXIT=0`.
- [x] **Reporte con la plantilla 8.4** (este documento).
- [x] **Sin `push` ni `merge`** (sección 10).

### Del backlog (§5.4 / D17 / D18)

- [x] Tabla `propuestas_horario` con `id`, `reserva_id`, `fecha_cita`, `hora_inicio`, `hora_fin`, `tipo`,
      `estado`, `expira_at`, `creado_por`, `creado_at` + `CHECK` e índice.
- [x] Ventana de **10 minutos** (medida con reloj falso en el unitario).
- [x] Una sola propuesta viva por reserva: 409 `PROPUESTA_PENDIENTE`; una vencida ya no bloquea.
- [x] `OTRO` exige detalle de al menos 5 caracteres (400 `MOTIVO_INVALIDO` si no).
- [x] Catálogo cerrado de cancelación replicado en SQL (`CHECK`), además del `@IsIn` del DTO.
- [ ] **«El hueco propuesto se mantiene reservado hasta que expire» (D37/§5.3)** — no implementado a
      propósito (el encargo pedía lo contrario): ver RDE-2 y H41.
- [ ] **La solicitud de cancelación especial del CLIENTE resuelta por el admin (D17)** — no implementada:
      se implementó la variante exclusiva del staff que pidió el encargo. Ver RDE-1 y H43.

---

## 7. DECISIONES O DESVIACIONES

- **RDE-1 · La cancelación especial la ejecuta el staff, no la solicita el cliente.** El §E3-07 punto 3 de
  D17 modela una *solicitud* del CLIENTE (`SOLICITADA`) que el admin resuelve. El encargo pidió lo
  contrario: una ruta **exclusiva de `ADMINISTRADOR` y `ADMIN_BARBERIA`** que «registre quién la canceló,
  el motivo especial, libere el horario, cancele el job y audite». Se implementó la versión del encargo y
  se dejó `SOLICITADA`/`RECHAZADA` admitidos en el `CHECK` para el flujo futuro (H43).
- **RDE-2 · La propuesta NO ocupa agenda.** El §5.3/D37 dice que «toda propuesta de horario activa» ocupa,
  pero el encargo fue explícito: «sin afectar directamente la disponibilidad actual hasta que el staff la
  acepte». Se prioriza el encargo. Consecuencia real y medida: si otro cliente toma el hueco entre
  proponer y aceptar, la aceptación responde 409 `CONFLICTO_HORARIO` (hay caso E2E). Queda como H41.
- **RDE-3 · La bandera D17 sí es fail-closed.** `permite_cancelacion_especial` es FALSE por defecto y la
  ruta responde 422 `CANCELACION_ESPECIAL_NO_HABILITADA` cuando la sede no la activa. El guard no puede
  leerla (solo mira rol y `barberiaId`), así que la comprobación vive en el servicio, dentro de la
  transacción. Consecuencia: por defecto **ninguna** sede acepta cancelaciones especiales hasta activarla.
  Si el dueño prefiere que el staff pueda cancelar con motivo sin depender de la bandera, es un cambio de
  una línea (H44).
- **RDE-4 · La caducidad de la propuesta es en diferido, sin job.** No hay tabla/proceso que expiro las
  propuestas: se comprueba al aceptar (409 `PROPUESTA_EXPIRADA`, y la fila se marca `EXPIRADA`) y al
  proponer (`expiraAt > now`). El §E3-06 punto 5 delega en E3-05, cuyo processor solo vigila
  `reservas.estado` y `expira_at`, no la tabla nueva. Queda como H42.
- **RDE-5 · `PROPUESTA_PENDIENTE` no se usa como estado de la reserva.** La propuesta vive en su propia
  tabla y la reserva conserva su estado (`CONFIRMADA`/`PENDIENTE`) hasta que se acepta. Evita introducir
  un estado que el resto del servicio (`pago`, `notificacion.processor`, agenda) no reconoce; el hueco
  reservado por una `PROPUESTA_PENDIENTE` sigue ocupando (§5.3) pero ese estado sigue sin productor (H42).
- **RDE-6 · La reprogramación directa del staff no se refactorizó.** Para no arriesgar los 7 unitarios y 5
  casos E2E de E3-06, `reprogramarReserva` conserva su validación inline y la nueva
  `validarBloqueNuevo` (pausa → horizonte → duración congelada → disponibilidad autoexcluida) se usa solo
  en la propuesta y en su aceptación. Es una duplicación consciente, no un descuido.
- **RDE-7 · Un CLIENTE ajeno recibe 403 `RESERVA_AJENA` de la propuesta, y un `ADMINISTRADOR` que no sea
  el dueño también.** La ruta declara `@Roles('CLIENTE')` y el `RolesGuard` deja pasar al ADMINISTRADOR
  por jerarquía; la pertenencia la resuelve el servicio, con el mismo criterio que la cancelación (fila 14
  de la matriz). El staff mueve citas por `PATCH .../reprogramar`, que ya existe.
- **RDE-8 · Escribí una migración que ya estaba aplicada.** Ver H40: corregir los FK recién aplicados no
  tiene camino en Prisma y hubo que editar el ledger a mano. La BD quedó sin drift y el `migration.sql`
  versionado es el correcto.

---

## 8. HALLAZGOS NUEVOS

Registrados en [AUDITORIA_HALLAZGOS.md](AUDITORIA_HALLAZGOS.md) con su evidencia, junto a la resolución
parcial de **H33** y **H35**:

| ID | Qué | Severidad | Estado |
|---|---|---|---|
| **H40** | Corregir una migración ya aplicada no tiene camino en Prisma (`migrate resolve --rolled-back` la rechaza si no está en estado fallido): hubo que `DROP` + borrar la fila del ledger a mano | Informativa | Nota de operación |
| **H41** | La propuesta de horario **no retiene el hueco** que D37/§5.3 manda retener: otro cliente puede tomarlo y la aceptación da 409 `CONFLICTO_HORARIO` | Media | Abierto (D37) |
| **H42** | `reservas.PROPUESTA_PENDIENTE` sigue sin productor y las propuestas caducan en diferido (una vencida queda `PENDIENTE` en la BD hasta que alguien la resuelva) | Baja | Abierto |
| **H43** | `cancelacion_especial_estado` admite `SOLICITADA`/`RECHAZADA` pero nadie los escribe: falta el flujo de solicitud del CLIENTE de D17 | Baja | Abierto |
| **H44** | La cancelación especial del staff no exige estar a menos de 30 minutos: sirve como vía ordinaria de cancelación con motivo | Informativa | A decisión del dueño |

Siguen abiertos y sin tocar aquí: **H32** (`informacion_adicional` no existe), **H34** (comentarios
corruptos en `roles.ts`), **H36** (la ventana de 30 min no usa la zona de la barbería), **H38**
(`testTimeout` de los E2E) y **H39** (el recordatorio no se puede borrar).

---

## 9. PENDIENTE O NO VERIFICADO

Como hechos, no como deseos:

1. **La solicitud de cancelación especial del cliente (D17 §3) no está implementada** (H43). La única ruta
   es la del staff.
2. **La propuesta no ocupa agenda** (H41): es una divergencia explícita de D37 pedida en el encargo.
3. **`PROPUESTA_PENDIENTE` no se escribe** y las propuestas no tienen expiración con job (H42).
4. **La zona horaria de la sede (H36/E2-04)** sigue sin existir: el horizonte de la propuesta se compara
   por día de calendario del SERVIDOR, igual que `crearReserva`.
5. **La cancelación especial no dispara la oportunidad de espacio (E4-04)**, que no existe.
6. **Solo se ejecutó MI archivo E2E**, no la suite E2E completa.
7. **El E2E necesita `--testTimeout=40000`** (H38). Sin ese flag los fallos por timeout son
   indistinguibles de los de negocio.
8. **Los 22 errores de `tsc` son preexistentes** y ninguno cae en los archivos de esta rama; no se
   corrigieron aquí.
9. **No hice `push` ni `merge`**, así que CI todavía no ha ejecutado nada de esta rama.

---

## 10. GIT

```
$ git status --short
 M AUDITORIA_HALLAZGOS.md
 M backend-barberias/prisma/schema.prisma
 M backend-barberias/src/reserva/application/reserva.service.ts
 M backend-barberias/src/reserva/infrastructure/reserva.controller.ts
 M backend-barberias/test/permisos-matriz.spec.ts
 M docs/MATRIZ_RUTAS.md
?? backend-barberias/prisma/migrations/20261010000000_e308_cancelacion_especial_propuestas/
?? backend-barberias/src/reserva/application/dto/cancelacion-especial.dto.ts
?? backend-barberias/src/reserva/application/reserva-e308.spec.ts
?? backend-barberias/test/e3-08-cancelacion-especial-propuesta.e2e-spec.ts

$ git log -1 --oneline
2265241 Merge pull request #44 from Codecore-J/feat/e3-06-07-reprogramacion-reglas

$ git log --oneline -5
2265241 Merge pull request #44 from Codecore-J/feat/e3-06-07-reprogramacion-reglas
65b844a feat(reservas): reprogramacion de citas (E3-06) y limites de cancelacion (E3-07)
c90b55a Merge pull request #43 from Codecore-J/feat/e3-05-expiracion-cancelacion
0402fb0 feat(reservas): worker de expiracion, cancelacion manual y fix BullMQ (E3-05)
96469ef Merge pull request #42 from Codecore-J/feat/e3-04-aceptar-rechazar
```

La rama está **sin commits propios**: todo el trabajo está en el árbol de trabajo, a la espera de tu
aprobación. **No hice merge.**
