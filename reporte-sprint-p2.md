INFORME: Sprint de Estabilización — OLA 2 · P2 «Brechas de Negocio»
RAMA: fix/sprint-estabilizacion-p2 (creada desde `main` @ 02e6697)
BASE: el plan quedó en `main`; la rama arranca del cierre de la Ola 1 (commit `02e6697 fix(estabilizacion): alinea
      el esquema con dev y cierra H47 y los minutos fantasma`).
FECHA: 2026-10-12 / 2026-10-13
RESULTADO: **VERDE — unitarios 46/46 archivos y 500/500 tests · E2E 27/27 archivos y 199/199 tests ·
lint 0 errores · build OK · `check:integridad` OK (11 migraciones y 27 CHECK).**

ALCANCE PEDIDO (Fase 2): ventana de 15 min del no presentado (H52), estado visible del cliente (H54),
suspensión manual de cuenta (D09/D24) y el calificado de esquema en las consultas crudas (H58).
H41/H42 y D22 se REVISARON (Fase 1) pero NO se implementaron: quedan en P2.5, fuera de lo pedido para esta ola.

1. QUÉ HICE (los 4 puntos de la Fase 2)

   1. **H52 · ventana de 15 minutos del NO PRESENTADO (§5.2 fila 12).**
      `PUNTUALIDAD_MARGEN_MIN = 5` + `TOLERANCIA_MIN = 10` (→ `VENTANA_NO_PRESENTADO_MIN = 15`) se declararon
      en `src/reserva/domain/fidelizacion.ts`, junto a la regla. `ReservaService.marcarInasistencia` ahora exige
      que hayan pasado los 15 minutos desde `hora_inicio`, medidos con la **zona de la SEDE** (`barberia.zonaHoraria`),
      y responde **422 `FUERA_DE_VENTANA`** si se intenta antes. La comprobación va ANTES de escribir nada: un
      intento temprano no deja rastro ni en la reserva ni en el contador. La transición de estado se afirma
      explícitamente con `ReservaStateMachine.assertTransition(..., NO_PRESENTADO, STAFF)`, así el orden
      «máquina primero, reloj después» queda fijo.

   2. **H54 · el cliente VE su estado.**
      Endpoint nuevo `GET /barberias/:barberiaId/mi-estado` (`MiEstadoController` + `MiEstadoService`, registrados
      en `BarberiaModule`). Devuelve `estadoVinculacion`, `contadorNoPresentado`, `estaRestringido`,
      `motivoRestriccion`, `advertencia`, `inasistenciasParaRestriccion`, `limiteInasistencias` y `mensaje`.
      El mensaje lo proyecta la regla PURA `describirEstadoFidelizacion` (vive con la regla, no en el servicio):
      «Estás a 1 inasistencia de ser suspendido en esta barbería.» (singular), el plural para 2+, el motivo de la
      sede si está restringido y `null` por debajo del umbral. La lectura se acota por el usuario del **token** y
      la sede de la **ruta**; sin fila en `cliente_barberias` → **403 `NO_VINCULADO`** (sin filtrar dato alguno).

   3. **Suspensión manual global (E4-03/5 · D09/D24).**
      Ruta nueva `PATCH /plataforma/usuarios/:id/estado {estadoCuenta, motivo}` solo `@Roles('ADMINISTRADOR')`
      (`PlataformaUsuariosController` + `UsuariosPlataformaService`). Motivo obligatorio → **422 `MOTIVO_REQUERIDO`**
      (contrato D40 de regla de negocio, no el 400 del `ValidationPipe`); repetir el estado vigente → 409
      `ESTADO_INVALIDO`; cuenta inexistente → 404. Al **suspender** sube `usuarios.token_version`, que es lo que
      cierra TODAS las sesiones: el `JwtStrategy` compara `payload.tv` con `token_version` en cada petición, así
      que los JWT ya firmados quedan inválidos —y NO vuelven a valer al reactivar (reactivar no baja la versión).
      Todo ocurre en UNA transacción con la auditoría dentro (D28): evento `CUENTA_SUSPENDIDA`/`CUENTA_REACTIVADA`
      con `motivo`, valor **anterior** y **nuevo** y `sesionesCerradas`.

   4. **H58 · esquema calificado en las 9 consultas crudas del bloqueo pesimista.**
      Nuevo `src/shared/db/esquema.ts`: resuelve el esquema desde el `?schema=` de `DATABASE_URL` (o `public`) y
      expone `tablaCalificada('barberias')` → `"public"."barberias"`, validando el identificador con lista blanca
      y sin concatenarlo nunca a mano (se inyecta con `Prisma.raw`). Las **9** apariciones del `SELECT id FROM
      "barberias" ... FOR UPDATE` en `reserva.service.ts` pasan por el helper `bloquearSedeParaEscritura`. Con el
      pooler de Neon reutilizando sesiones, la consulta ya no depende del `search_path` de la sesión (era la causa
      de los `42P01` que tiñeron de rojo dos corridas E2E de la Ola 1).

   **Hallazgo nuevo detectado y corregido dentro de la misma ola — H59.** Al implementar la suspensión se importó
   `AuditoriaModule` en `IamModule`; como la auditoría trae `registerQueue` y un `@Processor`, el grafo mínimo que
   compone `test/cliente-ficha-roles.e2e-spec.ts` (sin `BullModule.forRoot`) falló con `Worker requires a
   connection`. Se sacó la bandeja a su propio `PlataformaUsuariosModule` (que sí importa la auditoría) y se
   registró en `AppModule`; `IamModule` recupera su grafo sin colas.

   **Hallazgo nuevo abierto — H60.** `cambiarEstado` no impide que un ADMINISTRADOR suspenda SU PROPIA cuenta (y
   con ella sus tokens) ni protege al último administrador. Queda documentado a decisión del dueño; fuera del
   alcance de lo pedido.

2. ARCHIVOS TOCADOS (`git diff --stat`, literal, sin este informe)

```
 AUDITORIA_HALLAZGOS.md                             |  46 +++++-
 backend-barberias/prisma/schema.prisma             |   3 +
 backend-barberias/src/app.module.ts                |   4 +
 backend-barberias/src/barberia/barberia.module.ts  |   7 +
 .../src/iam/application/auth.service.ts            |   3 +
 backend-barberias/src/iam/domain/jwt.interface.ts  |   6 +
 backend-barberias/src/iam/iam.module.ts            |   4 +
 .../src/iam/infrastructure/jwt.strategy.ts         |  10 ++
 .../reserva/application/reserva.service.spec.ts    | 180 +++++++++++++++++++++
 .../src/reserva/application/reserva.service.ts     |  95 +++++++++--
 .../src/reserva/domain/fidelizacion.spec.ts        |  81 ++++++++++
 .../src/reserva/domain/fidelizacion.ts             |  77 ++++++++++
 .../test/e4-03-fidelizacion.e2e-spec.ts            | 118 ++++++++++++++
 backend-barberias/test/permisos-matriz.e2e-spec.ts |   8 +
 backend-barberias/test/permisos-matriz.spec.ts     |  21 ++-
 docs/MATRIZ_RUTAS.md                               |  12 ++
 16 files changed, 659 insertions(+), 16 deletions(-)
```

Archivos NUEVOS (untracked hasta este commit), con su tamaño:

```
 backend-barberias/prisma/migrations/20261012150000_e403_token_version/migration.sql    12 líneas
 backend-barberias/src/shared/db/esquema.ts                                             67 líneas
 backend-barberias/src/barberia/application/mi-estado.service.ts                       101 líneas
 backend-barberias/src/barberia/application/mi-estado.service.spec.ts                  152 líneas
 backend-barberias/src/barberia/infrastructure/mi-estado.controller.ts                  33 líneas
 backend-barberias/src/iam/application/dto/cambiar-estado-cuenta.dto.ts                 23 líneas
 backend-barberias/src/iam/application/usuarios-plataforma.service.ts                  125 líneas
 backend-barberias/src/iam/application/usuarios-plataforma.service.spec.ts             163 líneas
 backend-barberias/src/iam/infrastructure/plataforma-usuarios.controller.ts             37 líneas
 backend-barberias/src/iam/infrastructure/plataforma-usuarios.module.ts                 24 líneas
 backend-barberias/test/e4-03-suspension-cuenta.e2e-spec.ts                            305 líneas
 backend-barberias/test/estado-cuenta-guard.spec.ts                                    122 líneas
```

| Archivo | Cambio |
|---|---|
| `src/reserva/domain/fidelizacion.ts` | `PUNTUALIDAD_MARGEN_MIN`/`TOLERANCIA_MIN`/`VENTANA_NO_PRESENTADO_MIN` y `describirEstadoFidelizacion` (vista pública del contador, H54) |
| `src/reserva/application/reserva.service.ts` | `exigirVentanaNoPresentado` (H52) antes de escribir; `bloquearSedeParaEscritura` con esquema calificado (H58) en las 9 consultas; `marcarInasistencia` incluye la zona de la sede |
| `src/barberia/application/mi-estado.service.ts` (+ spec) | Servicio del estado propio del cliente (H54), acotado por token + sede |
| `src/barberia/infrastructure/mi-estado.controller.ts` | `GET /barberias/:barberiaId/mi-estado`, `@Roles('CLIENTE')` |
| `src/iam/application/usuarios-plataforma.service.ts` (+ spec) | Suspensión/reactivación manual con motivo, `token_version` y auditoría en transacción |
| `src/iam/infrastructure/plataforma-usuarios.controller.ts` (+ module, + DTO) | `PATCH /plataforma/usuarios/:id/estado`, `@Roles('ADMINISTRADOR')` |
| `src/iam/infrastructure/jwt.strategy.ts` + `auth.service.ts` + `domain/jwt.interface.ts` | `tv` en el JWT y comparación con `token_version` en cada petición (D24) |
| `src/shared/db/esquema.ts` | Esquema resuelto desde `DATABASE_URL` y `tablaCalificada` (H58) |
| `prisma/schema.prisma` + migración `20261012150000_e403_token_version` | `usuarios.token_version INT NOT NULL DEFAULT 0` |
| `test/estado-cuenta-guard.spec.ts` | D48 sobre el CÓDIGO FUENTE: solo el alta y esta ruta manual escriben `estado_cuenta` |
| `test/e4-03-suspension-cuenta.e2e-spec.ts` | Ciclo HTTP completo: suspender → token muere → login explica → reactivar → el token viejo SIGUE muerto |
| `test/e4-03-fidelizacion.e2e-spec.ts` | Casos H54 (contador, advertencia en singular/plural, motivo, 403 del staff/ajeno, sede B en 0) y 403 `NO_VINCULADO` |
| `test/permisos-matriz.*` + `docs/MATRIZ_RUTAS.md` | 71 → **73** rutas × 4 roles = **292** decisiones; filas 62 y 63 documentadas |

3. DECISIONES DE DISEÑO (y por qué)

* **La ventana se mide con la zona de la SEDE, no con la del proceso.** Fuera de UTC, «15 minutos desde
  `hora_inicio`» solo tiene sentido en el reloj de la sede; se resuelve con `EDT`/`luxon` y no con la hora local
  del servidor (coherente con E2-04 y con la ventana de cancelación de E3-07).
* **El motivo es 422 y no 400.** Viaja como DTO opcional y la regla lo exige: así el contrato es el mismo código
  D40 (`MOTIVO_REQUERIDO`) que ya usa E3-13, y no el 400 genérico del `ValidationPipe`.
* **`token_version` es lo que cierra sesiones de verdad.** El rechazo por `estadoCuenta = 'SUSPENDIDO'`
  desaparecería al reactivar; la versión no. Un token de antes de la migración (sin `tv`) se lee como 0 y sigue
  valiendo, así que la migración es aditiva y no expulsa a nadie.
* **`mi-estado` usa `:barberiaId`, no `:id`.** Así el `RolesGuard` SÍ resuelve la sede del parámetro y un cliente
  no puede preguntar por la de al lado; el servicio vuelve a acotar por el usuario del token de todas formas.
* **H58: ni concatenación ni `SET search_path`.** El nombre se valida con lista blanca y se inyecta con
  `Prisma.raw`; el esquema sale del `?schema=` de la URL (o `public`), que en prod y CI es el mismo que usa Prisma.
* **`ELIMINADO` no se ofrece por esta ruta.** Dar de baja una cuenta no es un cambio de estado reversible.

4. PRUEBAS Y EVIDENCIA (salidas literales)

4.1 · Suite unitaria completa — `npm test` (backend)

```
 Test Files  46 passed (46)
      Tests  500 passed (500)
   Duration  31.18s
```

(P1 cerró en 43/474; +3 archivos —`mi-estado.service.spec.ts`, `usuarios-plataforma.service.spec.ts`,
`estado-cuenta-guard.spec.ts`— y +26 casos H52/H54/D24/D48.)

4.2 · Suite E2E completa — `APP_ENV=dev npx vitest run --config ./vitest.config.e2e.ts`

```
 Test Files  27 passed (27)
      Tests  199 passed (199)
   Duration  864.13s
E2E_EXIT=0
```

(P1 cerró en 26/191; +1 archivo —`e4-03-suspension-cuenta.e2e-spec.ts`— y +8 casos. Incluye el ciclo de
suspensión y la regresión de `test/cliente-ficha-roles.e2e-spec.ts`, que era la que destapó H59.)

4.3 · Lint, build e integridad (los pasos que corre el CI)

```
npm run lint            → Found 56 warnings and 0 errors.  (204 archivos)   EXIT=0
npm run build           → nest build                                        EXIT=0
npm run check:integridad → OK — 11 migraciones y 27 CHECK coinciden con el esquema «public».  EXIT=0
npx prisma migrate status → Database schema is up to date!  (11 migraciones)
```

5. LO QUE **NO** SE HIZO EN ESTA OLA (para que no se lea como cerrado)

* **P2.3 · reactivación iniciada por el cliente (H53, D21):** no se tocó. El flujo `solicitudes_reactivacion`
  (POST solicitar / POST resolver conservando el contador) sigue pendiente; el campo `reactivacion` del contrato
  del plan no se expone porque ese flujo aún no existe.
* **P2.5 · D22 + H41 + H42 (oportunidad de espacio):** REVISADO (Fase 1) y NO implementado. D22 proactivo sigue
  sin job ni processor; la expiración de `PROPUESTA_PENDIENTE` sigue en diferido. H41/D37 quedaron cerrados por
  decisión del dueño en la Ola 1 (una alternativa es de solo lectura).
* **E3-10/1 · renombrar la ruta a `POST .../no-presentado`:** la ruta sigue siendo `POST .../:id/inasistencia`.
  Se separó a propósito de la regla para no mezclar el cambio de contrato con la validación.
* **P2.6, P2.7 y P2.8** (`informacion_adicional`, `src/cliente/`/ficha, E2-01/diseno v2): intactas.
* **H60:** decisión abierta del dueño (autosuspensión / último administrador).
* **Frontend:** no se tocó.

6. RIESGOS RESIDUALES QUE VIGILAR

1. **Sesiones y `token_version`:** suspender cierra sesiones en todos los dispositivos y reactivar no las reabre;
   es el comportamiento deseado (D24) pero exige re-login tras una reactivación. Asegurarse de que soporte lo sepa.
2. **H58:** mientras el pooler de Neon sirva sesiones con `search_path` heredado, cualquier cliente que use un
   esquema distinto puede seguir afectando a los demás; el calificado blinda ESTAS consultas, no el resto del pool.
3. **La ventana del no presentado bloquea el flujo del mostrador** si se marca con la cita recién empezada: es
   justo el H52, pero conviene que la UI de la sede muestre el error `FUERA_DE_VENTANA` con claridad.

7. CÓMO REPRODUCIR (comandos literales)

```
npm test                                                      # unitarios (46/500)
APP_ENV=dev npx vitest run --config ./vitest.config.e2e.ts     # E2E (27/199)
npm run lint                                                   # 0 errores
npm run build                                                  # nest build
npm run check:integridad                                       # contra la base de DATABASE_URL
npx prisma migrate status                                      # 11 migraciones · up to date
```

8. ESTADO FINAL

La rama `fix/sprint-estabilizacion-p2` queda **empujada** para tu revisión. **No se hizo merge** y **no se abrió
PR**: el merge a `main` es tuyo.
