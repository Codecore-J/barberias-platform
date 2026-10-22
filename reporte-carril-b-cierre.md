# E4-02 · D22 · Carril B — Cierre de fugas (rechazo y expiración) y sellado

> Plantilla 8.4 de `docs/BACKLOG_BARBERIAS_V1.md`.
> Rama: `chore/integracion-pre-auditoria`.

## 1. QUÉ HICE

- Cerré **HALLAZGO-CB-01**: el rechazo de una reserva y su expiración automática también devuelven el bloque a la agenda, así que ahora emiten `HUECO_LIBERADO` igual que la cancelación y la reprogramación.
- `ReservaService.rechazarReserva` captura el bloque **antes** del cambio de estado y avisa **después del commit**.
- `ExpiracionReservaService` relee la reserva ya expirada (bloque real), compone los instantes con la zona de la sede y encola en la cola `lista-espera`.
- Ambos caminos usan `encolarConLimite` (techo H62 de 2 s): una cola caída se registra como advertencia y **nunca** rompe la operación ya confirmada.
- 4 unitarios nuevos (2 de rechazo, 2 de expiración), incluidos los de degradación de la cola.

## 2. ARCHIVOS TOCADOS

```text
$ git diff --stat
 backend-barberias/src/reserva/application/expiracion-reserva.service.spec.ts | 45 ++++++++++
 backend-barberias/src/reserva/application/expiracion-reserva.service.ts      | 82 +++++++++++++++-
 backend-barberias/src/reserva/application/reserva.service.spec.ts            | 53 ++++++++++
 backend-barberias/src/reserva/application/reserva.service.ts                 | 19 +++-
 ... (más los archivos de las fases 1-3: schema, migración, módulo del Carril B,
      matcher, processor, queue.constants, estados, app.module, reserva.module)
```

## 3. TEST ROJO (mutación controlada)

No se conservó un rojo previo a la implementación, así que se verificó que **cada aserción discrimina** desactivando el envío en el helper (`if (this.listaEsperaQueue) return;`) y restaurando el archivo byte a byte:

```text
       × E4-02 · D22: al rechazar avisa al Carril B del bloque que quedó libre 412ms
AssertionError: expected "vi.fn()" to be called with arguments: [ 'hueco-liberado', { …(5) }, …(1) ]
      Tests  1 failed | 71 skipped (72)
RESTAURADO_OK
```

```text
     × E4-02 · D22: la expiración avisa al Carril B del bloque que quedó libre 428ms
AssertionError: expected "vi.fn()" to be called with arguments: [ 'hueco-liberado', { …(5) }, …(1) ]
 Test Files  1 failed | 1 passed (2)
      Tests  1 failed | 2 passed | 85 skipped (88)
RESTAURADO_OK
```

## 4. TEST VERDE

Especificaciones afectadas (88 tests):

```text
 Test Files  2 passed (2)
      Tests  88 passed (88)
```

Casos nuevos:

- `E4-02 · D22: al rechazar avisa al Carril B del bloque que quedó libre` — payload con `barberiaId`, `fecha`, `inicio`/`fin` en UTC de la sede y `reservaId`, con `attempts: 3`.
- `E4-02 · D22: si la cola del Carril B falla, el rechazo NO se rompe` — la reserva queda `RECHAZADA` aunque Redis rechace el `add`.
- `E4-02 · D22: la expiración avisa al Carril B del bloque que quedó libre` — mismo payload desde `ExpiracionReservaService`.
- `E4-02 · D22: si la cola del Carril B falla, la expiración NO se rompe` — sigue devolviendo `EXPIRADA` y registra la advertencia.

## 5. SUITE COMPLETA · `npm run test`

```text
 Test Files  55 passed (55)
      Tests  669 passed (669)
```

- `npm run build` (`nest build`): `build_exit=0`.
- `npm run lint` (`oxlint --type-aware src/ test/`): `lint_exit=0`, **103 warnings y 0 errores** (los warnings son preexistentes: `unbound-method`, `no-base-to-string`, etc., todos en specs antiguos).

## 6. CRITERIOS DE ACEPTACIÓN

- [x] El rechazo emite el mismo evento que la cancelación, con el bloque anterior al cambio de estado.
- [x] La expiración emite el mismo evento con el bloque real (relectura posterior al `updateMany` condicionado).
- [x] Ambos caminos avisan **después del commit**, nunca dentro de la transacción.
- [x] Techo H62 de 2 s en el encolado; fallo de cola = advertencia, no excepción.
- [x] Tests unitarios de encolado y de degradación para rechazo y expiración.
- [x] Suite completa y build en verde.
- [x] Lint sin errores.

## 7. DECISIONES O DESVIACIONES

1. **Releer la reserva en la expiración** en vez de reutilizar la fila del primer `findUnique`: entre la lectura inicial y el `updateMany` condicionado puede pasar tiempo, y el aviso debe describir el bloque que realmente se liberó.
2. **Se conserva el orden**: primero la notificación al cliente (`RESERVA_EXPIRADA`) y luego el aviso al Carril B. Son colas distintas y ambas best-effort.
3. **El aviso del Carril B no bloquea la reconciliación de arranque**: `avisarHuecoLiberado` relee la fila y encola con techo, y cualquier error se captura en un `try/catch` con `warn`.

## 8. HALLAZGOS NUEVOS

- **HALLAZGO-CB-01 · Media · CERRADO** en esta fase (rechazo y expiración ya emiten `HUECO_LIBERADO`).
- **HALLAZGO-CB-02 · Baja · ABIERTO**: si el worker del matcher muere justo después del test-and-set a `NOTIFICADO`, un reintento del job podría avisar a una segunda candidata del mismo hueco. Cerrarlo exige persistir el hueco avisado en la suscripción o un `jobId` determinístico con política de fallidos.

## 9. PENDIENTE O NO VERIFICADO

- E2E del circuito completo (rechazo/expiración → job → matcher → `notificaciones`) sigue fuera de alcance.
- No se levantó Redis ni la base para un smoke manual: la evidencia es unitaria y de build.
- Cierre (`CERRADO`) y vencimiento de suscripciones de lista de espera: flujo posterior, no implementado aquí.

## 10. ESTADO GIT

Commit de sellado de las fases 1-3 + cierre de fugas:

```text
feat(backend): implementar Carril B (Lista de Espera) completo con BullMQ y parche de fugas de agenda
Branches: chore/integracion-pre-auditoria
```

Sin push y sin merge: la rama queda lista para revisión.
