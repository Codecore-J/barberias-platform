TAREA: E4-01 · Reserva grupal: la capacidad se calcula por participantes
RAMA: feat/reserva-grupal

## 1. QUÉ HICE (5 líneas máximo)

1. Dominio nuevo `src/reserva/domain/reserva-grupal.ts`: tope duro de plataforma `MAX_PARTICIPANTES_POR_GRUPO = 8`, cálculo PURO del bloque (Σ duraciones de TODOS los participantes + UN margen, D42/§5.4) y validación estructural + capacidad (D46) compartida por creación y cotización.
2. `CreateReservaDto`: `tipo: 'GRUPAL'` con `participantes[{nombre, esAdultoResponsable, servicios[]}]`; `serviciosIds` solo se exige en el flujo individual y cada participante se valida en el pipe (nombre, marca y servicios no vacíos).
3. `crearReserva`: forma y capacidad ANTES del lock (422 `CAPACIDAD_EXCEDIDA` con `{campo, limite, solicitado}`), disponibilidad medida contra el bloque CALCULADO, `tipoReserva = 'GRUPAL'`, una fila de `participantes_reserva` por persona, `participante_servicios.margen_historico = 0`, auditoría `RESERVA_CREADA` con el conteo y notificación con el tamaño del grupo.
4. `cotizar` grupal con el MISMO bloque y precio que la creación (D44), `desgloseServicios[].participanteIndex`, y el 409 de creación ahora viaja con `codigo: 'CONFLICTO_HORARIO'` como el resto del flujo.
5. Pruebas: 20 unitarios del dominio nuevo y 10 E2E (ejemplo del diseño 105 min, bordes de topes, 409 sin segundo carril, snapshots y auditoría).

## 2. ARCHIVOS TOCADOS (git diff --stat, literal)

```
 .../src/reserva/application/dto/cotizacion.dto.ts  |   6 +
 .../reserva/application/dto/create-reserva.dto.ts  |  60 +++-
 .../src/reserva/application/reserva.service.ts     | 302 ++++++++++++++++++---
 3 files changed, 327 insertions(+), 41 deletions(-)
```

Nuevos (sin trackear; `wc -l`):

```
 216  backend-barberias/src/reserva/domain/reserva-grupal.ts
 232  backend-barberias/src/reserva/domain/reserva-grupal.spec.ts
 395  backend-barberias/test/e4-01-reserva-grupal.e2e-spec.ts
 843  total
```

Notas de honestidad sobre el diff: las 40 líneas borradas del servicio son casi todas del bloque del participante individual, que pasó a un `else` con una indentación más (mismo comportamiento, código movido). No hay CR/LF fabricado en el diff (comprobado: 0 líneas cambiadas con `\r`).

## 3. TEST ROJO (antes del fix, salida literal)

**3.1 · Unitarios del dominio — el módulo nuevo no existe todavía** (`npx vitest run src/reserva/domain/reserva-grupal.spec.ts`, con `reserva-grupal.ts` apartado; `EXIT=1`):

```
⎯⎯⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  src/reserva/domain/reserva-grupal.spec.ts [ src/reserva/domain/reserva-grupal.spec.ts ]
Error: Cannot find module './reserva-grupal.js' imported from C:/Users/Magnurys J/.gemini/antigravity/scratch/barberias-platform/backend-barberias/src/reserva/domain/reserva-grupal.spec.ts
 ❯ src/reserva/domain/reserva-grupal.spec.ts:2:1

 Test Files  1 failed (1)
      Tests  no tests
VITEST_EXIT=1
```

**3.2 · E2E nuevo contra el código de producción ANTERIOR.** Se guardó el md5 de los tres archivos de producción, se apartaron con `git stash push -m "e4-01 e2e red run" -- <3 archivos>` (solo mis cambios; los ficheros nuevos quedaron en el árbol), se corrió el E2E y se restauró con `git stash pop`; `md5sum -c` verificó los tres archivos byte a byte (`OK` tres veces). Salida literal (`EXIT=1`):

```
 Test Files  1 failed (1)
      Tests  8 failed | 2 passed (10)

 FAIL  test/e4-01-reserva-grupal.e2e-spec.ts > E4-01 · reserva grupal > VERDE: 1 adulto + 2 niños con max_personas_total = 3 y max_ninos = 2 → 201 con bloque 105
AssertionError: expected 422 to be 201 // Object.is equality

- Expected
+ Received

- 201
+ 422

 ❯ test/e4-01-reserva-grupal.e2e-spec.ts:242:24
    242|     expect(res.status).toBe(201);
```

Los dos casos que sí pasaron en rojo son las dos únicas negativas cuyo ESTADO coincide por casualidad con el anterior (la sede que no acepta grupales ya respondía 422 `GRUPAL_NO_DISPONIBLE` porque la comprobación previa existía, y «un participante sin servicios» ya fallaba con 422 en el pipe por el `forbidNonWhitelisted` del DTO viejo, que no declaraba `participantes`). No son una validación del código nuevo.

## 4. TEST VERDE (después, salida literal)

**4.1 · Unitarios del dominio** (`npx vitest run src/reserva/domain/reserva-grupal.spec.ts`, `EXIT=0`):

```
 ✓ src/reserva/domain/reserva-grupal.spec.ts (20 tests) 6ms

 Test Files  1 passed (1)
      Tests  20 passed (20)
```

**4.2 · E2E E4-01** (`APP_ENV=dev npx vitest run --config ./vitest.config.e2e.ts test/e4-01-reserva-grupal.e2e-spec.ts`, `EXIT=0`):

```
 ✓ test/e4-01-reserva-grupal.e2e-spec.ts (10 tests) 25596ms
     ✓ VERDE: 1 adulto + 2 niños con max_personas_total = 3 y max_ninos = 2 → 201 con bloque 105  3420ms
     ✓ VERDE: la cotización grupal devuelve el MISMO bloque y precio sin persistir (D44)  557ms
     ✓ ROJO: 1 adulto + 3 niños con max_ninos = 2 → 422 CAPACIDAD_EXCEDIDA sin escribir nada  760ms
     ✓ ROJO: 4 personas con max_personas_total = 3 → 422 CAPACIDAD_EXCEDIDA sobre maxPersonasTotal  610ms
     ✓ ROJO: la sede sin límites propios sigue acotada por el tope duro de plataforma (8)  631ms
     ✓ ROJO: sede con acepta_grupal = false → 422 GRUPAL_NO_DISPONIBLE  625ms
     ✓ ROJO: dos adultos responsables → 400 PARTICIPANTES_INVALIDOS  630ms
     ✓ ROJO: grupo sin participantes → 400 PARTICIPANTES_INVALIDOS (no se inventa un grupo)  633ms
     ✓ ROJO: dos reservas grupales solapadas → 409: la capacidad no abre un segundo carril (D45)  3088ms

 Test Files  1 passed (1)
      Tests  10 passed (10)
```

## 5. SUITE COMPLETA: `npm run test` (resumen literal)

```
 Test Files  40 passed (40)
      Tests  429 passed (429)
   Duration  5.46s (transform 4.06s, setup 0ms, import 44.23s, tests 13.18s, environment 8ms)
```

(429 = los 20 unitarios nuevos del dominio + los preexistentes. `EXIT=0`.)

Añadido, porque `npm run test` NO ejecuta los e2e (su glob es `**/*.spec.ts`):

- **E3-03, sin regresión del flujo individual** (`test/e3-03-validaciones.e2e-spec.ts`, `EXIT=0`), incluido su caso `ROJO: GRUPAL_NO_DISPONIBLE 422 cuando el tipo GRUPAL no está permitido`:

```
 Test Files  1 passed (1)
      Tests  11 passed (11)
```

- **Suite E2E COMPLETA** (`APP_ENV=dev npx vitest run --config ./vitest.config.e2e.ts`, `EXIT=0`), sobre el código final:

```
 Test Files  23 passed (23)
      Tests  181 passed (181)
   Duration  603.60s (transform 1.02s, setup 156ms, import 44.98s, tests 553.25s, environment 2ms)
```

- `npm run build` (`EXIT=0`) y `npm run lint` = `Found 52 warnings and 0 errors.` (`EXIT=0`; los warnings son preexistentes).

## 6. CRITERIOS DE ACEPTACIÓN

- [x] **1 adulto + 2 niños con `max_personas_total = 3` y `max_ninos = 2` → 201, bloque = Σ duraciones + un margen (35 + 30 + 30 + 10 = 105).** Evidencia: E2E «VERDE: 1 adulto + 2 niños… → 201 con bloque 105» (horaFin persistido `11:35` = 10:00 + 95, `margenGrupalHistorico = 10`, bloque 105) y unitarios «2 servicios de 30 min + 10 min de margen = 70 min totales» y «ejemplo del diseño… 105».
- [x] **1 adulto + 3 niños con `max_ninos = 2` → 422 `CAPACIDAD_EXCEDIDA` sin escribir nada.** Evidencia: E2E, con `{campo: 'maxNinos', limite: 2, solicitado: 3}` y `count` de reservas de la sede idéntico antes y después.
- [x] **`margen_grupal_historico` se aplica UNA vez y `participante_servicios.margen_historico` es 0.** Evidencia: E2E (3 snapshots con `duracionHistorica` 30/30/35, todos con `margenHistorico === 0`, `totalPagar` 90) y unitario «aplica el margen UNA sola vez, nunca un margen por participante ni por servicio».
- [x] **Dos reservas solapadas siguen dando 409: la capacidad no abre un segundo carril.** Evidencia: E2E «dos reservas grupales solapadas → 409 `CONFLICTO_HORARIO`» (primera 201, segunda 409).
- [x] **Rojo → verde.** Evidencia: §3.1, §3.2 (rojo literal) y §4.1, §4.2 (verde literal).
- [x] **(Hacer 3) Capacidad evaluada ANTES del lock y con los valores efectivos; límite nulo = sin límite propio de la sede, nunca sin validación.** Evidencia: unitario «un límite nulo de la sede NO desactiva el tope duro de plataforma (8)» y E2E «la sede sin límites propios sigue acotada por el tope duro de plataforma (8)» → `{campo: 'MAX_PARTICIPANTES_POR_GRUPO', limite: 8, solicitado: 9}`.
- [x] **(Hacer 6) `/reservas/cotizar` y `POST …/reservas` devuelven el MISMO bloque y precio para el mismo grupo.** Evidencia: E2E «la cotización grupal devuelve el MISMO bloque y precio sin persistir» (`duracionTotal` 105, `margenTotal` 10, `precioTotal` 90, `horaFin` `11:35`, 3 desgloses) + `count` sin cambios.
- [x] **(Hacer 8) Auditoría `RESERVA_CREADA` con el conteo de participantes y nunca con los nombres de los niños.** Evidencia: E2E, `auditoria.contexto` = `{barberiaId, tipoReserva: 'GRUPAL', participantes: 3}` y `JSON.stringify(contexto)` sin contener `Niño E401`.
- [x] **(Hacer 9) E2E de los bordes: `personas = max_personas_total`, `ninos = max_ninos`, un niño de más, dos adultos y grupo sin servicios.** Evidencia: el caso de 201 cubre los dos bordes exactos simultáneamente (3 = máximo de personas y 2 = máximo de niños); el resto son los E2E «4 personas con max_personas_total = 3», «1 adulto + 3 niños con max_ninos = 2», «dos adultos responsables → 400» y «un participante sin servicios → 422».
- [x] **Nada del flujo individual (E3-03) se rompió.** Evidencia: E3-03 11/11 y la suite E2E completa 181/181.

## 7. DECISIONES O DESVIACIONES

0. **`main` local estaba 6 commits por detrás de `origin/main`.** Antes de crear la rama hice `git fetch` y `git merge --ff-only origin/main`, porque el commit de las especificaciones de E4 (`4440c91`) no estaba en mi `main` local y sí en `origin/main` (PR #53). La rama `feat/reserva-grupal` sale de `33fe3a3` (el merge del PR #52 sobre el #53). Fue un fast-forward: sin commit de merge, sin rebase, sin push y sin tocar nada más del árbol.
1. **La forma del GRUPO se valida en el servicio, no en el `ValidationPipe` (desviación de §E4-01/2).** El backlog pedía el DTO «exactamente UN adulto responsable». Si el pipe exigiera `participantes`, la petición `tipo: 'GRUPAL'` sin participantes contra una sede con `acepta_grupal = false` moriría en el pipe con un 422 SIN `codigo`, y el E2E de E3-03 (que exige `GRUPAL_NO_DISPONIBLE`) se rompería —además de invertir la precedencia correcta config → forma del grupo—. Por eso el DTO garantiza la forma de CADA participante y el servicio (que ya corre después de la configuración) decide ≥2 participantes, exactamente un adulto y servicios no vacíos. Motivo: no romper E3-03 y dejar el motivo real al cliente.
2. **Código nuevo de 400: `PARTICIPANTES_INVALIDOS`.** Es la familia de 400 de dominio que ya usan `SERVICIO_FUERA_DE_BARBERIA` y `MOTIVO_INVALIDO` (ninguno de los dos está en la lista de `codigo` de §6, que es de 422), así que no toqué el contrato aprobado. Si prefieres que esté en §6, es una línea de doc.
3. **En grupales el `horaFin` del DTO es solo la ventana del cliente.** El fin persistido se DERIVA de Σ duraciones y el margen va aparte, y la disponibilidad se mide contra Σ (+ un margen). Es lo que hace cierto «el frontend nunca calcula el bloque» (D44) y evita que un cliente pueda estirar el bloque con un `horaFin` largo.
4. **`acepta_individual` ahora gobierna solo los individuales.** Antes se aplicaba a cualquier tipo, así que una sede con grupales activos e individuales apagados no podía recibir grupos. `acepta_grupal = false` sigue respondiendo 422 `GRUPAL_NO_DISPONIBLE`.
5. **El 409 de creación ahora lleva `codigo: 'CONFLICTO_HORARIO'`** (era un `ConflictException` con solo `message`). Es un cambio de una línea en un camino compartido con el individual: verificamos que ningún test ni el frontend dependen del `message` anterior (`auth.interceptor.ts` solo mira el 401), y es lo que permite verificar el criterio «sin segundo carril» por código en vez de por estado. Al quedar `ConflictException` sin uso, se quitó del import.
6. **El cálculo grupal es una función pura NUEVA del dominio, no una rama de `calcularBloque`.** `calcularBloque` sigue leyendo la ventana del cliente para el individual (no se toca: E3-03 depende de ello). Hay UN solo cálculo grupal y lo consumen creación y cotización; la disponibilidad recibe el resultado, no recalcula nada.
7. **La auditoría `RESERVA_CREADA` se añadió solo en el camino grupal.** El flujo individual no auditaba en creación y no es alcance de esta tarea; si quieres la simetría, es una línea y lo dices.

## 8. HALLAZGOS NUEVOS

- **H-N1 · Baja · `CreateReservaDto` DUPLICADO y muerto.** `src/reserva/application/dto/cotizacion.dto.ts` declara otra clase `CreateReservaDto` (el controlador importa la de `create-reserva.dto.ts`; del archivo de cotización solo se usan los tipos). Trampa latente: un cambio futuro del DTO de reserva puede editarse en el archivo equivocado. No se tocó para no ampliar el alcance.
- **H-N2 · Baja · (corregido en esta tarea) El 409 de `crearReserva` viajaba sin `codigo`.** El cliente no podía distinguir «el hueco se ocupó» de otro 409. Ahora lleva `CONFLICTO_HORARIO`, como aceptar (E3-04) y reprogramar (E3-06).

## 9. PENDIENTE O NO VERIFICADO

- **Frontend sin tocar y sin verificación HTTP real de un flujo grupal de punta a punta.** E4-01 es backend: el wizard del cliente sigue enviando `tipo: 'INDIVIDUAL'` y no existe pantalla de participantes; la única verificación es contra la API (supertest).
- **La notificación del grupo no se asserta** (depende de BullMQ/Redis). El mensaje incluye el tamaño («para N participantes») por lectura del código, no por aserción de test.
- **`docs/MATRIZ_RUTAS.md` no se modificó:** E4-01 no añade ni cambia rutas (GRUPAL viaja por `POST /barberias/:id/reservas` y `.../reservas/cotizar`, ya declaradas). El conteo de la matriz sigue en 43 rutas × 4 roles y su E2E pasó.
- **El backlog no se marcó con `[x]`:** los criterios quedan con su evidencia en este informe para que los cierres tú.
- **gitleaks no se ejecutó localmente** (lo corre el CI); los archivos nuevos no contienen credenciales ni cadenas de conexión.
- Fuera de alcance, siguen pendientes: E4-02 (huecos/alternativas), E4-03 (fidelización), E4-04 (`informacion_adicional`, H32) y E4-05 (`src/cliente/`, H22).

## 10. git status --short / git log -1 --oneline / git log --oneline -5

```
 M backend-barberias/src/reserva/application/dto/cotizacion.dto.ts
 M backend-barberias/src/reserva/application/dto/create-reserva.dto.ts
 M backend-barberias/src/reserva/application/reserva.service.ts
?? backend-barberias/src/reserva/domain/
?? backend-barberias/test/e4-01-reserva-grupal.e2e-spec.ts
```

```
33fe3a3 Merge pull request #52 from Codecore-J/feat/solicitudes-cambio-barberia
```

```
33fe3a3 Merge pull request #52 from Codecore-J/feat/solicitudes-cambio-barberia
e7eeb13 Merge pull request #53 from Codecore-J/docs/epica-4-especificaciones
4440c91 docs(backlog): especificaciones formales y criterios para Epica 4
5bb049d chore(sec): añade huella de e3-13 a .gitleaksignore para falso positivo
387ec90 chore(test): exime contraseña de prueba en e2e del escaneo de gitleaks
```

No hice commit, push ni merge: el árbol queda con los tres archivos modificados y los tres nuevos para que lo revises en frío. Espera aprobación.
