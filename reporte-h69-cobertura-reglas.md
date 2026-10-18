> Plantilla 8.4 de `docs/BACKLOG_BARBERIAS_V1.md`. Rama `chore/h69-cobertura-reglas` desde
> `main` (`3a43202`, con el PR #72 ya fusionado). **Push sin merge**, a la espera de aprobación.

# H69 · Tres reglas que se cumplían sin test ya tienen quien las vigile

**TAREA:** H69 — la matriz de cumplimiento marcaba tres reglas `OK-SIN-TEST`: recuperación de contraseña
(1.6), estado de la sede no editable por el `PATCH` general (2.3) y prioridad de las excepciones de
horario (4.3). Las tres funcionaban; ninguna tenía un test que las nombrara, así que una regresión podía
pasar el CI sin que nadie se enterara.
**RAMA:** `chore/h69-cobertura-reglas`
**HALLAZGO:** `AUDITORIA_HALLAZGOS.md` → `H69 · … — **RESUELTO**`

---

## 1. QUÉ HICE

1. **1.6 · Recuperación de contraseña** (`src/iam/application/auth.service.spec.ts`, 9 casos):
   - `forgotPassword` normaliza el correo, quema los tokens pendientes anteriores, guarda SOLO el
     SHA-256 de un token de 32 bytes con 15 minutos de vida y encola la notificación
     `EMAIL`/`RECUPERACION_PASSWORD` con el token en claro —el «envío simulado»—.
   - Un correo desconocido y una cuenta `SUSPENDIDO` reciben la MISMA respuesta exacta y no generan
     token ni notificación: la anti-enumeración queda fijada, no solo comentada.
   - `resetPassword` busca por hash, cambia la contraseña hasheada, marca el token `usado`, audita
     `RECUPERACION_PASSWORD_EXITOSA` y lo hace todo en una transacción.
   - Rechaza el token desconocido, el ya usado, el vencido y el de una cuenta no `ACTIVA`, sin escribir
     nada en ninguno de los cuatro casos.
   - Un caso de punta a punta recorre olvidé → token «enviado» → reseteo → **login con la contraseña
     nueva**, que es lo que el usuario percibe como «funciona».

2. **2.3 · El estado de la sede no se edita por el `PATCH` general**
   (`src/barberia/application/barberia.service.spec.ts`, 4 casos):
   - 422 `ESTADO_NO_EDITABLE` y `prisma.barberia.update` sin llamar.
   - El rechazo gana a la autorización: ni el `ADMINISTRADOR` global escribe el estado por esa puerta
     (ni siquiera se busca la sede).
   - Una edición legítima de `descripcion` no arrastra `estado` al `UPDATE`: la regla no depende de que
     el DTO llegue limpio.
   - El endpoint específico (`cambiarEstado`) sí lo cambia y audita el anterior y el nuevo, que es el
     camino que la regla exige.

3. **4.3 · La excepción manda sobre el horario regular**
   (`src/agenda/application/disponibilidad.service.spec.ts`, 5 casos):
   - Control: sin excepción, el turno regular 09:00–18:00 produce sus 18 huecos.
   - `CERRADA` deja la jornada en `null` (cero huecos) aunque el horario diga que se abre.
   - `HORARIO_ESPECIAL` 10:00–12:00 sustituye la rejilla: cuatro huecos, ninguno a las 09:00 ni a las
     12:00, comprobados también como instantes reales en la zona de la sede.
   - La excepción es de SU fecha: al consultar el día siguiente vuelve el horario habitual.

4. **Cierre documental:** `docs/MATRIZ_CUMPLIMIENTO.md` pasa las filas 1.6, 2.3 y 4.3 a `OK-PROBADO` con
   el test y la línea como evidencia, y el resumen queda en **68 `OK-PROBADO` y 0 `OK-SIN-TEST`**.
   `AUDITORIA_HALLAZGOS.md` marca H69 como **RESUELTO** en el marcador y en su ficha.

## 2. ARCHIVOS TOCADOS (`git diff --stat`, literal)

```
 AUDITORIA_HALLAZGOS.md                             |  16 +-
 .../application/disponibilidad.service.spec.ts     | 122 ++++++++++
 .../barberia/application/barberia.service.spec.ts  |  91 ++++++++
 .../src/iam/application/auth.service.spec.ts       | 261 +++++++++++++++++++++
 docs/MATRIZ_CUMPLIMIENTO.md                        |  25 +-
 5 files changed, 495 insertions(+), 20 deletions(-)
```

Ningún archivo de producción se tocó: las tres reglas ya estaban implementadas y el encargo era
certificarlas. El único cambio fuera de los tests es documental.

## 3. EVIDENCIA

- **Suite completa del backend:** `npm test` → `Test Files 51 passed (51)` / `Tests 615 passed (615)`
  (`EXIT=0`), con los 18 casos nuevos dentro.
- **Dirigido, para ver los nombres:** `npx vitest run … --reporter=verbose` → los 9 casos de
  recuperación, los 4 de `ESTADO_NO_EDITABLE` y los 5 de prioridad de excepciones en verde.
- **Tipos:** `tsc --noEmit` no reporta nada en las líneas nuevas. El proyecto ya arrastra errores de
  tipos en otros specs (`reserva.service.spec.ts`, `prisma-exception.filter.spec.ts`, varios de `test/`)
  y en `barberia.service.spec.ts:1137`/`:1153`, que son anteriores a este cambio (sección de
  `obtenerInvitacion`), no de los bloques añadidos.
- **Lint:** `oxlint --type-aware` sobre los tres specs → `Found 47 warnings and 0 errors`; los avisos son
  del estilo preexistente del archivo (`unbound-method` al espiar métodos de Prisma), no de los casos
  nuevos.
- **Nota honesta sobre el rojo:** los tests se escribieron contra una implementación que ya existía, así
  que no hubo un rojo de producción que enseñar. El único fallo durante el trabajo fue del propio
  andamiaje del test (`mockPrisma.usuario.update` no existía en el mock de `AuthService`), corregido en
  el mock —no en el código de producción— antes de dar nada por bueno.

## 4. UNA NOTA DE NUMERACIÓN

El encargo llamaba a las reglas **T.3**, **2.4** y **3.4**. En `docs/MATRIZ_CUMPLIMIENTO.md` esos tres
identificadores son OTRAS reglas y ya estaban `OK-PROBADO` desde antes (T.3 es la guarda mata-datos del
E2E, 2.4 es la edición directa de descripción/ubicación/logo y 3.4 es «la sede sale del vínculo»). Las
tres filas `OK-SIN-TEST` —las únicas que quedaban en ese estado, y las que coinciden exactamente con las
descripciones del encargo— son **1.6**, **2.3** y **4.3**, y son las que se han cerrado. Se deja escrito
aquí porque la matriz exige que el estado y el test digan lo mismo, y citar la fila equivocada sería
justo lo que la sección «Cómo se mantiene» prohíbe.

## 5. LÍMITES CONOCIDOS

- **Son tests unitarios, no E2E por HTTP.** Cubren el servicio y su contrato con Prisma, que es donde
  viven las tres reglas; no vuelven a probar el `ValidationPipe` ni el guard, que ya tienen sus propias
  suites (`test/e3-03-validaciones.e2e-spec.ts`, `test/permisos-matriz.spec.ts`).
- **El «envío» es la fila de `notificacion`, no un correo real.** Es el mismo punto de integración que
  usa el worker; un proveedor de email no está en el alcance de H69.
- **`debugToken` solo se aserta fuera de `production`.** El test depende de que `NODE_ENV` no sea
  `production` en la suite, que es la condición que el propio código exige para devolverlo.

## 6. LO QUE QUEDA

- **La rama no se fusiona:** queda subida para revisión.
- El resto de hallazgos abiertos (H65, H66, H68, H70, H73) no se tocan en esta ejecución.
