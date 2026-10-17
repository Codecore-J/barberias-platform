# Matriz de cumplimiento · reglas del diseño contra el código que las garantiza

**Tarea:** E2-08 · Matriz de cumplimiento reconciliada (`docs/BACKLOG_BARBERIAS_V1.md`).
**Sustituye a:** [`COMPARACION_DISENO_VS_REAL.md`](../COMPARACION_DISENO_VS_REAL.md), que comparaba el diseño con el sistema de septiembre de 2026 y quedó desactualizado (daba por no global el `RolesGuard`, entre otros puntos).
**Fecha:** 2026-10-15 (**1.8** y **1.9** pasaron a `OK-PROBADO` el mismo día al cerrarse E3-12 y su desvinculación). **Filas:** 72.

> **Qué es este documento.** La fuente de verdad técnica que une cada regla del diseño con el código que la garantiza y con el test que la certifica. No es un resumen de intenciones: cada `archivo:línea` de la columna *Evidencia* se resolvió **leyendo el fichero en el momento de escribir esto**, y cada test citado existe y menciona la regla. Si alguno no cuadraba, la matriz no se generaba.
>
> **Cómo se marcó.** Cada fila se comprobó contra `main` (`12d7ffe`) con el vocabulario de estados que fija el backlog:
>
> - **`OK-PROBADO`** · implementado y con test que lo certifica.
> - **`OK-SIN-TEST`** · implementado, sin test que lo demuestre.
> - **`PARCIAL`** · se cumple en parte; el resto está en la nota de la fila.
> - **`NO-EXISTE`** · no está (o está desactivado a propósito).
> - **`NO-VERIFICADO`** · no hay forma de comprobarlo con lo que hay en el repositorio.

## Método y límites

1. **Las secciones del PDF 01 se identificaron por las citas del repositorio**, no por el PDF: el documento original no está versionado aquí. Cada sección de esta matriz declara a qué parte del PDF 01 responde, tomando como fuente las referencias que el backlog, el código y los informes hacen de él (`Spec 01 §1.2`, `§4`, `§5.2`, `§5.4`, `§5.7`, `§5.8`, `§7.1`, `§7.5`, `§8.3`, `§9`, `§10`…). La **sección 6 no aparece citada en ninguna parte del repositorio**, así que su fila queda `NO-VERIFICADO`: inventarla sería lo contrario de lo que pide esta tarea.
2. **La columna *Tarea* cita el identificador del backlog** que cierra la regla. Donde la numeración de los informes y la del backlog no coinciden, manda el backlog y la discrepancia se anota.
3. **La evidencia es el punto de anclaje, no la prueba de la regla**: el test es lo que la certifica. Una fila `OK-PROBADO` sin test sería una contradicción, y por eso el estado y la columna de test tienen que decir lo mismo.
4. **`archivo:línea` caduca**: en cuanto se edite el archivo citado, el número puede desplazarse. Se refresca al cerrar cada épica (ver *Cómo se mantiene*).

## Sección 1 · Cuentas, sesión y vinculación

*PDF 01 §1 (incluido §1.2)*

| # | Regla | Estado | Evidencia | Test que la certifica | Tarea |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 1.1 | La contraseña nunca se guarda en claro (bcrypt, 10 rondas · D31) | OK-PROBADO | `backend-barberias/src/iam/application/auth.service.ts:29` | `backend-barberias/test/auth.e2e-spec.ts:40`<br>`backend-barberias/src/iam/application/auth.service.spec.ts:4` | E1-10 |
| 1.2 | La sesión es un JWT con la versión de token del usuario (`tv`) | OK-PROBADO | `backend-barberias/src/iam/infrastructure/jwt.strategy.ts:55` | `backend-barberias/test/auth.e2e-spec.ts:83`<br>`backend-barberias/src/iam/application/auth.service.spec.ts:138` | E1-10 |
| 1.3 | Revocar sesiones subiendo `token_version` (E4-03) | OK-PROBADO | `backend-barberias/src/iam/application/auth.service.ts:167` | `backend-barberias/src/iam/application/usuarios-plataforma.service.spec.ts:50` | E4-03 |
| 1.4 | Una cuenta `SUSPENDIDO` no entra ni se registra (D09) | OK-PROBADO | `backend-barberias/src/iam/application/auth.service.ts:138` | `backend-barberias/test/e4-03-suspension-cuenta.e2e-spec.ts:165`<br>`backend-barberias/test/estado-cuenta-guard.spec.ts:63` | E4-03 |
| 1.5 | El secreto de firma del JWT está validado (CONF-01) | OK-PROBADO | `backend-barberias/src/iam/iam.config.ts:16` | `backend-barberias/test/conf01-security.spec.ts:2` | E0-01 |
| 1.6 | Recuperación de contraseña: olvido y restablecimiento por correo | OK-SIN-TEST | `backend-barberias/src/iam/infrastructure/auth.controller.ts:75` | — | E1-10 |
| 1.7 | Límite de 5 vinculaciones: la 6.ª queda `PENDIENTE_APROBACION` (D10) | OK-PROBADO | `backend-barberias/src/barberia/application/barberia.service.ts:560` | `backend-barberias/src/barberia/application/barberia.service.spec.ts:714`<br>`backend-barberias/test/barberia.e2e-spec.ts:141`<br>`backend-barberias/test/e3-12-vinculacion.e2e-spec.ts:239` | E3-12 |
| 1.8 | Bandeja de aprobación de la 6.ª vinculación (ADMINISTRADOR) | OK-PROBADO | `backend-barberias/src/barberia/infrastructure/plataforma-vinculaciones.controller.ts:37` | `backend-barberias/test/e3-12-vinculacion.e2e-spec.ts:374`<br>`backend-barberias/src/barberia/application/vinculacion.service.spec.ts:161` | E3-12 |
| 1.9 | Desvinculación por el cliente con el historial intacto (D20/D21) | OK-PROBADO | `backend-barberias/src/barberia/application/mi-estado.service.ts:158` (`desvincular`: `UPDATE` a `DESVINCULADO` que NO toca contador ni restricción) y `:257` (el cupo que vuelve); `vincularCliente` reabre la fila cerrada (`barberia.service.ts:514`, el `UPDATE` de `:569`) y el conteo del límite mira los vivos (`:552`); los estados que anclan el cierre están en `backend-barberias/src/barberia/domain/vinculacion.ts:54` | `backend-barberias/test/e3-12-desvinculacion.e2e-spec.ts:353` (cierre, fila y auditoría), `:297` (422 `RESERVAS_EN_CURSO`), `:431` (cupo recuperado)<br>`backend-barberias/src/barberia/application/mi-estado.service.spec.ts:180`<br>`backend-barberias/test/e3-12-vinculacion.e2e-spec.ts:517` (H71) | E3-12 · H71 |
| 1.10 | Vinculación por enlace único y QR | NO-EXISTE | `grep -ri "por-enlace" backend-barberias/src` → 0 coincidencias | — | E3-12 |
| 1.11 | Cambiar de sede activa: una sola `es_barberia_activa` por usuario | OK-PROBADO | `backend-barberias/src/barberia/infrastructure/barberia.controller.ts:149` | `backend-barberias/src/barberia/application/barberia.service.spec.ts:122`<br>`backend-barberias/test/barberia.e2e-spec.ts:208` | E2-03 |

**1.6 · OK-SIN-TEST** — Los dos endpoints existen, pero ningún test los ejecuta: la única comprobación es el guion manual `backend-barberias/test/manual/sec01-recovery.ts`. `test/auth.e2e-spec.ts` cubre registro, login y `/me`.

**1.7 · OK-PROBADO** — El límite y el estado se asignan en `vincularCliente` con las constantes del dominio de la vinculación (`LIMITE_VINCULACIONES` = 5, `ESTADOS_VINCULACION`), el vínculo pendiente NO autoriza la sede y, desde el 2026-10-15, existe el flujo que lo resuelve (1.8).

**1.8 · OK-PROBADO** (cerrado por E3-12 el 2026-10-15) — `GET /plataforma/vinculaciones/pendientes` y `POST /plataforma/vinculaciones/:id/aprobar|rechazar { motivo }`, los tres solo para el `ADMINISTRADOR` global: el límite de D10 se cuenta por USUARIO, no por sede, así que la sede es parte interesada y no decide. El E2E cubre el ciclo completo (pendiente → aprobado → el cliente ya opera) y el rechazo con motivo.

**1.9 · OK-PROBADO** (cerrada por E3-12/3 el 2026-10-15; la mitad de D21 había llegado con E3-12/2 · H71 el mismo día) — La regla tiene dos mitades y las dos están. (a) La REVINCULACIÓN de D21: al volver a introducir el código de la sede, la fila cerrada se reabre en el sitio —`UPDATE`, no una fila nueva— y queda en el estado que le toca hoy (`PENDIENTE_APROBACION` si el cliente sigue por encima del límite, `ACTIVO` si ya tiene hueco), conservando `contador_no_presentado`, `esta_restringido` y `motivo_restriccion` (D20) y dejando el cambio en la auditoría (`VINCULACION_REACTIVADA`, con anterior y nuevo). (b) La DESVINCULACIÓN a petición del cliente: `POST /barberias/:barberiaId/mi-estado/desvincular` (`@Roles('CLIENTE')`, `MiEstadoService.desvincular`) cierra SU propia fila con un `UPDATE` a `DESVINCULADO` —nunca un borrado (D20/D21)—, apaga `es_barberia_activa`, bloquea con 422 `RESERVAS_EN_CURSO` (y el conteo) mientras haya reservas `PENDIENTE`, `PROPUESTA_PENDIENTE` o `CONFIRMADA` de hoy en adelante, responde 409 `ESTADO_INVALIDO` si ya estaba cerrada y audita `CLIENTE_DESVINCULADO_VOLUNTARIAMENTE` con el anterior y el nuevo dentro de la transacción. El conteo de D10 (1.7) pasa a mirar los vínculos VIVOS, así que cerrar uno devuelve el cupo: la siguiente sede ya no nace pendiente y el cliente no queda preso de la bandeja de aprobación. **Límites honestos:** el cierre no levanta la restricción ni reinicia el contador (D20, con test que lo declara y otro que comprueba que un vínculo cerrado no puede volver a leer el catálogo de esa sede); no toca la sede activa DE LAS DEMÁS filas; y la tarjeta del cliente de la que cuelga el botón solo aparecía donde `GET /barberias` devolvía algo, porque **no existía ninguna ruta que liste las barberías de un `CLIENTE`** (hallazgo 5 de `docs/MATRIZ_RUTAS.md`). **H72 lo cerró el 2026-10-16:** `GET /mi-estado/barberias` (fila 69 de la matriz de rutas) sirve las sedes del vínculo propio ya filtradas por el backend y la tarjeta compartida «sede-card» las pinta en «Tus Barberías» y en el home del cliente, así que el botón de salir ya es alcanzable en un recorrido real.

**1.10 · NO-EXISTE** — E3-12 punto 2: hoy solo se vincula por código en `POST /barberias/vincular`; no hay enlace único ni QR que codificar.

## Sección 2 · Barberías

*PDF 01 §2 y §5.9*

| # | Regla | Estado | Evidencia | Test que la certifica | Tarea |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 2.1 | El nombre solo cambia por solicitud aprobada por plataforma | OK-PROBADO | `backend-barberias/src/barberia/application/barberia.service.ts:356` | `backend-barberias/test/e3-13-solicitudes-cambio.e2e-spec.ts:215`<br>`backend-barberias/src/barberia/application/solicitud-cambio.service.spec.ts:182` | E3-13 |
| 2.2 | Cambiar el teléfono exige la contraseña actual | OK-PROBADO | `backend-barberias/src/barberia/application/barberia.service.ts:405` | `backend-barberias/test/e3-13-solicitudes-cambio.e2e-spec.ts:257`<br>`backend-barberias/src/barberia/application/barberia.service.spec.ts:397` | E3-13 |
| 2.3 | El estado de la sede no se edita por el `PATCH` general | OK-SIN-TEST | `backend-barberias/src/barberia/application/barberia.service.ts:363` | — | E3-13 |
| 2.4 | Descripción, ubicación y logo sí se editan directo (ADMIN_BARBERIA) | OK-PROBADO | `backend-barberias/src/barberia/application/dto/update-barberia.dto.ts:6` | `backend-barberias/test/e3-13-solicitudes-cambio.e2e-spec.ts:239`<br>`backend-barberias/src/barberia/application/barberia.service.spec.ts:229` | E3-13 |
| 2.5 | Suspender y reactivar la sede es un cambio de estado auditado (E2-07 · D29) | OK-PROBADO | `backend-barberias/src/barberia/application/barberia.service.ts:468` | `backend-barberias/src/barberia/application/barberia.service.spec.ts:637`<br>`backend-barberias/test/e2-07-vocabulario.e2e-spec.ts:387` | E2-07 |
| 2.6 | Cada sede tiene su zona horaria IANA (E2-04) | OK-PROBADO | `backend-barberias/prisma/migrations/20261011120000_e204_zona_horaria/migration.sql:13` | `backend-barberias/src/agenda/application/disponibilidad-zona.spec.ts:3`<br>`backend-barberias/src/shared/time/tiempo.service.spec.ts:4` | E2-04 |
| 2.7 | Los estados del catálogo están fijados por CHECK en la base | OK-PROBADO | `backend-barberias/prisma/migrations/20261014000000_e207_catalogo_estado_check/migration.sql:21` | `backend-barberias/test/e2-07-sede-inactiva.e2e-spec.ts:25` | E2-07 |

**2.3 · OK-SIN-TEST** — La regla se aplica (422 con su código), pero ningún test cita `ESTADO_NO_EDITABLE`: se cumple sin certificado.

**2.7 · OK-PROBADO** — La guardia de integridad del CI (`npm run check:integridad`) compara además los CHECK de las migraciones con la base real.

## Sección 3 · Seguridad de acceso

*PDF 01 §3.1 y matriz de permisos (sección 4 del backlog)*

| # | Regla | Estado | Evidencia | Test que la certifica | Tarea |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 3.1 | Fail-closed: toda ruta declara su nivel de acceso (H21) | OK-PROBADO | `backend-barberias/src/iam/infrastructure/roles.guard.ts:2` | `backend-barberias/test/route-security.spec.ts:8`<br>`backend-barberias/test/hallazgo16-rolesguard-global.e2e-spec.ts:104` | E1-01 |
| 3.2 | La matriz rol × ruta se comprueba contra el guard (76 rutas × 4 roles) | OK-PROBADO | `backend-barberias/test/permisos-matriz.spec.ts:33` | `backend-barberias/test/permisos-matriz.spec.ts:435`<br>`backend-barberias/test/permisos-matriz.e2e-spec.ts:129` | E1-05 |
| 3.3 | `ADMINISTRADOR` es transversal y `ADMIN_BARBERIA` no sale de su sede | OK-PROBADO | `backend-barberias/src/iam/domain/roles.ts:8` | `backend-barberias/src/iam/infrastructure/roles.guard.spec.ts:69`<br>`backend-barberias/test/e1-06-cross-tenant-admin.e2e-spec.ts:12` | E1-04 |
| 3.4 | La sede sale del vínculo del usuario, nunca del parámetro (H19/H20) | OK-PROBADO | `backend-barberias/src/iam/infrastructure/vinculo-barberia.guard.ts:2` | `backend-barberias/src/iam/infrastructure/vinculo-barberia.guard.spec.ts:54`<br>`backend-barberias/test/e1-06-sede-del-tenant.e2e-spec.ts:12`<br>`backend-barberias/test/h19-h20-lecturas-abiertas.e2e-spec.ts:12` | E1-03 |
| 3.5 | Ninguna lectura cruza datos de otra sede (IDOR · H14/H18) | OK-PROBADO | `backend-barberias/test/hallazgo14-idor-reserva.e2e-spec.ts:13` | `backend-barberias/test/hallazgo14-idor-reserva.e2e-spec.ts:264`<br>`backend-barberias/test/h18-auditoria-cross-tenant.e2e-spec.ts:14` | E1-02 |
| 3.6 | Validación global de entrada: nada fuera del DTO llega al servicio | OK-PROBADO | `backend-barberias/src/main.ts:107` | `backend-barberias/test/e3-03-validaciones.e2e-spec.ts:2`<br>`backend-barberias/test/auth.e2e-spec.ts:40` | E1-10 |
| 3.7 | Limitación de tasa en los endpoints públicos | OK-PROBADO | `backend-barberias/src/app.module.ts:22` | `backend-barberias/test/throttler-rate-limit.e2e-spec.ts:28` | E1-10 |
| 3.8 | El frontend no deja entrar a una ruta que el rol no permite (H17) | OK-PROBADO | `frontend-barberias/src/app/core/guards/role.guard.ts:9` | `frontend-barberias/src/app/core/guards/role.guard.spec.ts:3` | E1-09 |

## Sección 4 · Disponibilidad de la agenda

*PDF 01 §4 (y §5.3)*

| # | Regla | Estado | Evidencia | Test que la certifica | Tarea |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 4.1 | La disponibilidad se calcula en cada petición; nunca se almacena | OK-PROBADO | `backend-barberias/src/agenda/application/disponibilidad.service.ts:103` | `backend-barberias/src/agenda/application/disponibilidad.service.spec.ts:3`<br>`backend-barberias/test/e1-06-sede-del-tenant.e2e-spec.ts:436` | E3-02 |
| 4.2 | El cálculo suma horario, excepciones, reservas, duraciones, márgenes y bloqueos | OK-PROBADO | `backend-barberias/src/agenda/domain/huecos.ts:47` | `backend-barberias/src/agenda/domain/huecos.spec.ts:7`<br>`backend-barberias/src/agenda/application/disponibilidad.service.spec.ts:38` | E3-02 |
| 4.3 | Las excepciones `CERRADA` y `HORARIO_ESPECIAL` mandan sobre el horario habitual | OK-SIN-TEST | `backend-barberias/src/horario/application/dto/create-excepcion-horario.dto.ts:3` | — | E3-02 |
| 4.4 | Una sede `INACTIVO` no vende ni expone agenda (422 `SEDE_INACTIVA`) | OK-PROBADO | `backend-barberias/src/shared/domain/sede.ts:32` | `backend-barberias/test/e2-07-sede-inactiva.e2e-spec.ts:18`<br>`backend-barberias/src/agenda/application/disponibilidad.service.spec.ts:96`<br>`backend-barberias/src/reserva/application/reserva.service.spec.ts:269` | E2-07 |
| 4.5 | Un bloqueo se libera (`liberado_at`) y deja de ocupar la agenda | OK-PROBADO | `backend-barberias/src/agenda/application/agenda.service.ts:117` | `backend-barberias/src/agenda/application/agenda.service.spec.ts:97`<br>`backend-barberias/test/e2-07-vocabulario.e2e-spec.ts:10` | E2-07 |
| 4.6 | Qué ocupa espacio (D37) y qué alternativas se ofrecen al cliente | OK-PROBADO | `backend-barberias/src/agenda/domain/huecos.ts:30` | `backend-barberias/test/e4-02-oportunidades.e2e-spec.ts:20` | E4-02 |

**4.3 · OK-SIN-TEST** — El tipo está tipado y el servicio exige horas para `HORARIO_ESPECIAL`, pero no hay test que demuestre la prioridad de la excepción sobre la rejilla.

## Sección 5 · Reservas: estados, cálculo y reglas

*PDF 01 §5.1 a §5.9*

| # | Regla | Estado | Evidencia | Test que la certifica | Tarea |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 5.1 | Ocho estados y sus estados terminales (D08, D14) | OK-PROBADO | `backend-barberias/src/shared/domain/estados.ts:51` | `backend-barberias/src/shared/domain/reserva-state-machine.spec.ts:4` | E2-02 |
| 5.2 | Solo se permiten las transiciones de la tabla, con el actor autorizado | OK-PROBADO | `backend-barberias/src/shared/domain/estados.ts:2` | `backend-barberias/src/shared/domain/reserva-state-machine.spec.ts:99`<br>`backend-barberias/src/reserva/application/reserva.service.spec.ts:1339` | E2-02 |
| 5.3 | No existe «pon el estado que quieras»: el escritor pasa por la máquina | OK-PROBADO | `backend-barberias/src/shared/domain/reserva-state-machine.ts:114` | `backend-barberias/test/permisos-matriz.spec.ts:185` | E2-02 |
| 5.4 | Cotizar no persiste nada (D44) | OK-PROBADO | `backend-barberias/src/reserva/application/reserva.service.ts:218` | `backend-barberias/test/e3-03-validaciones.e2e-spec.ts:317` | E3-03 |
| 5.5 | Alta de reserva: vínculo, reglas de negocio y cupo, en ese orden | OK-PROBADO | `backend-barberias/src/reserva/application/reserva.service.ts:498` | `backend-barberias/src/reserva/application/reserva.service.spec.ts:89`<br>`backend-barberias/test/e3-03-validaciones.e2e-spec.ts:6` | E3-03 |
| 5.6 | El walk-in solo lo crea el staff, con barbero obligatorio (E3-03) | OK-PROBADO | `backend-barberias/src/reserva/infrastructure/reserva.controller.ts:58` | `backend-barberias/test/reserva-walkin-split.e2e-spec.ts:20` | E3-03 |
| 5.7 | Aceptar y rechazar solicitudes, con motivo del catálogo (D19) | OK-PROBADO | `backend-barberias/src/reserva/application/dto/rechazar-reserva.dto.ts:13` | `backend-barberias/test/e3-04-aceptar-rechazar.e2e-spec.ts:2`<br>`backend-barberias/src/reserva/application/reserva.service.spec.ts:437` | E3-04 |
| 5.8 | Las solicitudes caducan solas: expiración automática con job idempotente | OK-PROBADO | `backend-barberias/src/reserva/application/expiracion-reserva.service.ts:10` | `backend-barberias/src/reserva/application/expiracion-reserva.service.spec.ts:7`<br>`backend-barberias/test/e3-05-expiracion-cancelacion.e2e-spec.ts:2` | E3-05 |
| 5.9 | El cliente cancela hasta 30 minutos antes del inicio | OK-PROBADO | `backend-barberias/src/reserva/application/reserva.service.ts:111` | `backend-barberias/test/e3-05-expiracion-cancelacion.e2e-spec.ts:60`<br>`backend-barberias/src/reserva/application/reserva.service.spec.ts:885` | E3-07 |
| 5.10 | La cancelación especial solo si la sede la habilita (D17) | OK-PROBADO | `backend-barberias/src/reserva/application/reserva.service.ts:8` | `backend-barberias/test/e3-08-cancelacion-especial-propuesta.e2e-spec.ts:2`<br>`backend-barberias/src/reserva/application/reserva-e308.spec.ts:59` | E3-08 |
| 5.11 | Propuesta de horario con ventana y sin reenvío inmediato (D18 · §5.4) | OK-PROBADO | `backend-barberias/src/reserva/application/reserva.service.ts:2149` | `backend-barberias/test/e3-08-cancelacion-especial-propuesta.e2e-spec.ts:2`<br>`backend-barberias/src/reserva/application/reserva-e308.spec.ts:29` | E3-06 |
| 5.12 | Reprogramar una reserva vigente es decisión de la sede | OK-PROBADO | `backend-barberias/src/reserva/application/reserva.service.ts:1776` | `backend-barberias/test/e3-06-07-reprogramacion-reglas.e2e-spec.ts:2` | E3-06 |
| 5.13 | Los precios y duraciones de la reserva quedan congelados como snapshot (T6.2) | OK-PROBADO | `backend-barberias/src/reserva/application/reserva.service.ts:797` | `backend-barberias/src/reserva/application/reserva.service.spec.ts:90` | E3-03 |
| 5.14 | Reserva grupal: la suma de participantes y UN SOLO margen (D42) | OK-PROBADO | `backend-barberias/src/reserva/domain/reserva-grupal.ts:26` | `backend-barberias/src/reserva/domain/reserva-grupal.spec.ts:5`<br>`backend-barberias/test/e4-01-reserva-grupal.e2e-spec.ts:2` | E4-01 |
| 5.15 | El no presentado se marca pasados 15 minutos (5 de puntualidad + 10 de tolerancia) | OK-PROBADO | `backend-barberias/src/reserva/domain/fidelizacion.ts:29` | `backend-barberias/src/reserva/domain/fidelizacion.spec.ts:7`<br>`backend-barberias/src/reserva/application/reserva.service.spec.ts:764` | E3-10 |
| 5.16 | 3 inasistencias = advertencia; 5 = restricción en ESA sede, nunca global | OK-PROBADO | `backend-barberias/src/reserva/domain/fidelizacion.ts:17` | `backend-barberias/src/reserva/domain/fidelizacion.spec.ts:6`<br>`backend-barberias/test/e4-03-fidelizacion.e2e-spec.ts:10` | E3-10 |
| 5.17 | El cliente ve su estado y la sede levanta la restricción (D48) | OK-PROBADO | `backend-barberias/src/barberia/application/mi-estado.service.ts:32` | `backend-barberias/src/barberia/application/mi-estado.service.spec.ts:42`<br>`backend-barberias/src/barberia/application/clientes-restringidos.service.spec.ts:101`<br>`backend-barberias/test/e4-03-fidelizacion.e2e-spec.ts:13` | E4-03 |
| 5.18 | La sede puede pausar nuevas reservas y el cambio se audita | OK-PROBADO | `backend-barberias/src/barberia/application/configuracion-barberia.service.ts:116` | `backend-barberias/test/e3-11-configuracion.e2e-spec.ts:13`<br>`backend-barberias/test/e3-11-configuracion.spec.ts:38` | E3-11 |

## Sección 6 · Sección no localizable del PDF 01

*PDF 01 §6 (por identificar)*

| # | Regla | Estado | Evidencia | Test que la certifica | Tarea |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 6.1 | Contenido de la sección 6 del PDF 01 | NO-VERIFICADO | — | — | E2-08 |

**6.1 · NO-VERIFICADO** — El PDF 01 no está en el repositorio y ninguna cita del código o de los documentos apunta a su sección 6 (`Spec 01 §6` = 0 coincidencias). No se puede afirmar ni negar cumplimiento: hay que conseguir el PDF y rellenar esta fila. Si la sección 6 fuese «antecedentes y privacidad» —la Épica 7 del plan estratégico—, su evidencia sería `backend-barberias/src/antecedente/**`, que hoy existe y tiene tests, pero eso es una hipótesis, no una cita.

## Sección 7 · Pagos y vinculación

*PDF 01 §7.1 y §7.5*

| # | Regla | Estado | Evidencia | Test que la certifica | Tarea |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 7.1 | El pago en persona completa la reserva por la máquina de estados y audita en la misma transacción | OK-PROBADO | `backend-barberias/src/pago/application/pago.service.ts:214` | `backend-barberias/src/pago/application/pago.service.spec.ts:136` | E3-09 |
| 7.2 | Cobrar es de la sede; el barbero solo cobra lo que tiene asignado | OK-PROBADO | `backend-barberias/src/pago/application/pago.service.ts:41` | `backend-barberias/test/pago-barbero-asignado.e2e-spec.ts:13`<br>`backend-barberias/src/pago/application/pago.service.spec.ts:308` | E3-09 |
| 7.3 | Un pago puede corregirse después, y cada corrección se audita | NO-EXISTE | `grep -ri "corregir" backend-barberias/src/pago` → 0 coincidencias | — | E3-09 |
| 7.4 | Un pago pendiente nunca equivale a ingreso | OK-PROBADO | `backend-barberias/src/pago/application/pago.service.ts:162` | `backend-barberias/src/pago/application/pago.service.spec.ts:213` | E3-09 |

**7.3 · NO-EXISTE** — El controlador de pagos solo expone `POST /pagos` (en persona) y `GET /pagos/auditoria`: no hay operación de corrección ni de anulación. La parte que sí se cumple es la de auditoría del alta (7.1).

## Sección 8 · Auditoría y notificaciones

*PDF 01 §8.3*

| # | Regla | Estado | Evidencia | Test que la certifica | Tarea |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 8.1 | Toda operación importante deja registro: quién, qué, cuándo y contexto | OK-PROBADO | `backend-barberias/src/auditoria/application/auditoria.service.ts:110` | `backend-barberias/src/auditoria/application/auditoria.service.spec.ts:86`<br>`backend-barberias/src/auditoria/infrastructure/auditoria.controller.spec.ts:3` | E3-01 |
| 8.2 | La auditoría se conserva un año y se purga por retención (T8.2) | OK-PROBADO | `backend-barberias/src/auditoria/application/auditoria.service.ts:257` | `backend-barberias/src/auditoria/application/auditoria.service.spec.ts:214` | E3-01 |
| 8.3 | La auditoría respeta el aislamiento por sede (H18) | OK-PROBADO | `backend-barberias/src/auditoria/application/auditoria.service.ts:135` | `backend-barberias/test/h18-auditoria-cross-tenant.e2e-spec.ts:14`<br>`backend-barberias/test/permisos-matriz.e2e-spec.ts:94` | E1-02 |
| 8.4 | Las notificaciones se encolan sin poder tumbar la operación de negocio | OK-PROBADO | `backend-barberias/src/shared/queues/encolado-seguro.ts:48` | `backend-barberias/src/shared/queues/encolado-seguro.spec.ts:2`<br>`backend-barberias/src/notificacion/application/notificacion.service.spec.ts:5` | E3-01 |
| 8.5 | Liberar un bloqueo también se audita (D29) | OK-PROBADO | `backend-barberias/src/agenda/application/agenda.service.ts:145` | `backend-barberias/src/agenda/application/agenda.service.spec.ts:117` | E2-07 |

## Sección 9 · Vocabulario del diseño

*PDF 01 §9*

| # | Regla | Estado | Evidencia | Test que la certifica | Tarea |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 9.1 | Ningún cambio de estado se representa con una eliminación física (`@Delete` = 0) | OK-PROBADO | `backend-barberias/test/vocabulario-sin-delete.spec.ts:144` | `backend-barberias/test/vocabulario-sin-delete.spec.ts:315`<br>`backend-barberias/test/e2-07-vocabulario.e2e-spec.ts:10` | E2-07 |
| 9.2 | La guarda cubre también los borrados de datos y el frontend, con allowlist documentada | OK-PROBADO | `backend-barberias/test/vocabulario-sin-delete.spec.ts:73` | `backend-barberias/test/vocabulario-sin-delete.spec.ts:344`<br>`backend-barberias/test/vocabulario-sin-delete.spec.ts:374` | E2-07 |

## Sección 10 · Flujo maestro del backend

*PDF 01 §10*

| # | Regla | Estado | Evidencia | Test que la certifica | Tarea |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 10.1 | El alta de reserva sigue el orden: autorización → validación → reglas → estado → concurrencia → persistencia → auditoría → notificación | OK-PROBADO | `backend-barberias/src/reserva/application/reserva.service.ts:498` | `backend-barberias/src/reserva/application/reserva.service.spec.ts:89`<br>`backend-barberias/test/e3-03-validaciones.e2e-spec.ts:2` | E3-03 |
| 10.2 | Contrato de errores único: `{ statusCode, codigo, mensaje }` (D40) | OK-PROBADO | `backend-barberias/src/shared/errors/d40.errors.ts:51` | `backend-barberias/test/e3-04-aceptar-rechazar.e2e-spec.ts:10`<br>`backend-barberias/test/e3-11-configuracion.spec.ts:115` | E2-01 |
| 10.3 | Si la operación falla, no se ejecuta nada: la persistencia es transaccional | OK-PROBADO | `backend-barberias/src/shared/concurrency/serializable-transaction.ts:26` | `backend-barberias/src/shared/concurrency/serializable-transaction.spec.ts:2`<br>`backend-barberias/src/pago/application/pago.service.spec.ts:67` | E0-04 |
| 10.4 | Los conflictos de concurrencia se traducen a 409, no a 500 | OK-PROBADO | `backend-barberias/src/shared/filters/prisma-exception.filter.ts:99` | `backend-barberias/src/shared/filters/prisma-exception.filter.spec.ts:37` | E0-04 |

## Sección Transversales (fuera de las 10 secciones del PDF 01)

*Operación, entornos y observabilidad*

| # | Regla | Estado | Evidencia | Test que la certifica | Tarea |
| :--- | :--- | :--- | :--- | :--- | :--- |
| T.1 | La integridad de la base se verifica en cada PR (migraciones + CHECK) | OK-PROBADO | `.github/workflows/ci.yml:95` | `backend-barberias/scripts/check-integridad.cjs:11` | E0-04 |
| T.2 | La suite E2E se ejecuta en el CI, no solo los unitarios | OK-PROBADO | `.github/workflows/ci.yml:119` | `backend-barberias/package.json:24` | E0-04 |
| T.3 | Los tests de integración se niegan a correr fuera de `dev` (mata-datos) | OK-PROBADO | `backend-barberias/test/setup.e2e.ts:2` | `backend-barberias/test/smoke-db-guard.spec.ts:45`<br>`backend-barberias/test/smoke-db-guard.spec.ts:54` | E0-02 |
| T.4 | Entornos separados: dev, staging y producción (D11) | PARCIAL | `docs/ENTORNOS.md:10` | — | E0-02 |
| T.5 | Sondas de vida y de preparación separadas (H64) | OK-PROBADO | `backend-barberias/src/health/health.controller.ts:47` | `backend-barberias/test/h64-sondas-liveness.e2e-spec.ts:2`<br>`backend-barberias/test/health.e2e-spec.ts:7` | H64 |
| T.6 | E4-05 · Módulo `src/cliente/` (ficha y notas del cliente) | NO-EXISTE | `backend-barberias/src/app.module.ts:60` | `backend-barberias/test/cliente-ficha-roles.e2e-spec.ts:25` | E4-05 |

**T.4 · PARCIAL** — La aplicación exige `APP_ENV` y aborta con un valor no permitido, y los datos viven en bases distintas; queda pendiente que el despliegue aplique las migraciones solo (`render.yaml` no corre `prisma migrate deploy`), que es la causa de que `dev` y `staging` puedan divergir.

**T.6 · NO-EXISTE** — Decisión de alcance, no un olvido: el módulo existe pero no está registrado (H22), y su E2E comprueba justamente qué rol entra cuando las rutas no están expuestas.

## Resumen

| Estado | Filas |
| :--- | :--- |
| OK-PROBADO | 64 |
| OK-SIN-TEST | 3 |
| PARCIAL | 1 |
| NO-EXISTE | 3 |
| NO-VERIFICADO | 1 |
| **Total** | **72** |

## Lo que esta reconciliación deja a la vista

Ninguna regla con estado distinto de `OK-PROBADO`, que es lo que la matriz existe para no esconder:

- **1.6 · OK-SIN-TEST · E1-10** — Recuperación de contraseña: olvido y restablecimiento por correo Los dos endpoints existen, pero ningún test los ejecuta: la única comprobación es el guion manual `backend-barberias/test/manual/sec01-recovery.ts`. `test/auth.e2e-spec.ts` cubre registro, login y `/me`.
- **1.10 · NO-EXISTE · E3-12** — Vinculación por enlace único y QR E3-12 punto 2: hoy solo se vincula por código en `POST /barberias/vincular`; no hay enlace único ni QR que codificar.
- **2.3 · OK-SIN-TEST · E3-13** — El estado de la sede no se edita por el `PATCH` general La regla se aplica (422 con su código), pero ningún test cita `ESTADO_NO_EDITABLE`: se cumple sin certificado.
- **4.3 · OK-SIN-TEST · E3-02** — Las excepciones `CERRADA` y `HORARIO_ESPECIAL` mandan sobre el horario habitual El tipo está tipado y el servicio exige horas para `HORARIO_ESPECIAL`, pero no hay test que demuestre la prioridad de la excepción sobre la rejilla.
- **6.1 · NO-VERIFICADO · E2-08** — Contenido de la sección 6 del PDF 01 El PDF 01 no está en el repositorio y ninguna cita del código o de los documentos apunta a su sección 6 (`Spec 01 §6` = 0 coincidencias). No se puede afirmar ni negar cumplimiento: hay que conseguir el PDF y rellenar esta fila. Si la sección 6 fuese «antecedentes y privacidad» —la Épica 7 del plan estratégico—, su evidencia sería `backend-barberias/src/antecedente/**`, que hoy existe y tiene tests, pero eso es una hipótesis, no una cita.
- **7.3 · NO-EXISTE · E3-09** — Un pago puede corregirse después, y cada corrección se audita El controlador de pagos solo expone `POST /pagos` (en persona) y `GET /pagos/auditoria`: no hay operación de corrección ni de anulación. La parte que sí se cumple es la de auditoría del alta (7.1).
- **T.4 · PARCIAL · E0-02** — Entornos separados: dev, staging y producción (D11) La aplicación exige `APP_ENV` y aborta con un valor no permitido, y los datos viven en bases distintas; queda pendiente que el despliegue aplique las migraciones solo (`render.yaml` no corre `prisma migrate deploy`), que es la causa de que `dev` y `staging` puedan divergir.
- **T.6 · NO-EXISTE · E4-05** — E4-05 · Módulo `src/cliente/` (ficha y notas del cliente) Decisión de alcance, no un olvido: el módulo existe pero no está registrado (H22), y su E2E comprueba justamente qué rol entra cuando las rutas no están expuestas.

### Lectura de los hallazgos

- **`NO-EXISTE` no siempre es un defecto.** E4-05 está desactivado a propósito (H22) y su fila lo dice; 1.10 (enlace único/QR) y la corrección de pagos (7.3) sí son trabajo pendiente real. De las dos mitades de E3-12, la desvinculación a petición del cliente dejó de faltar el 2026-10-15 (E3-12/3, regla 1.9) y solo queda el enlace único/QR: **el callejón sin salida (1.8), la vuelta del rechazo (H71) y la salida del cliente están cerrados**, y esta matriz lo registra en las filas 1.7, 1.8 y 1.9.
- **`PARCIAL` señala una mitad hecha.** Queda UNA fila en ese estado: T.4, donde los entornos están separados y el despliegue no aplica migraciones. 1.7 estuvo `PARCIAL` mientras el vínculo pendiente bloqueaba sin flujo que lo resolviera, y 1.9 mientras el cliente no podía salir de una sede: las dos llegaron a `OK-PROBADO` cuando se ejecutó E3-12.
- **`OK-SIN-TEST` es la deuda barata de cerrar.** 1.6 (recuperación de contraseña), 2.3 (`ESTADO_NO_EDITABLE`) y 4.3 (prioridad de las excepciones) están implementadas y justificadas en el código, pero nadie las vigila: cualquiera de ellas puede romperse sin que el CI se entere. Es el mismo patrón que P-SD-5, que empezó siendo un `[EJECUTADO]` sin guarda que lo respaldara.
- **`NO-VERIFICADO` (6.1) es una petición, no un veredicto:** hay que conseguir el PDF 01 y rellenar la fila.

## Cómo se mantiene

1. **Al cerrar cada tarea del backlog** (DoD, sección 8.3), añade la fila o cambia su estado, y deja el test en la columna correspondiente. La matriz se actualiza al cerrar la épica, no al final del proyecto.
2. **Al mover una línea citada**, refresca el `archivo:línea`. Para comprobar que no se ha quedado rancia, busca la marca que aparece al final de cada celda de evidencia (la palabra o expresión que identifica la regla en el archivo): si ya no está, la fila está desactualizada.
3. **Lo que no debe pasar:** marcar `OK-PROBADO` una fila cuyo test no cite la regla. Si el test no la nombra, el estado honesto es `OK-SIN-TEST` aunque el comportamiento parezca cubierto por otro test más amplio.

## Nota de numeración y de alcance

- El **PDF 01** y el **PDF 02** son documentos externos (no versionados). Esta matriz cubre las secciones 1 a 10 del PDF 01 según las citas que el repositorio hace de ellas; el PDF 02 (arquitectura) se usa como referencia en las filas de infraestructura.
- Los números de tarea son los del **backlog**. Los informes de trabajo a veces usan otro reparto (por ejemplo, el informe de E3-06/E3-07 cubre la reprogramación y el de E3-08 la cancelación especial más la propuesta de horario): cuando eso pasa, la fila cita la tarea del backlog y el test real, que es lo que se puede comprobar.
- Las filas transversales (T.x) no vienen de las secciones del PDF 01: son condiciones de operación (CI, entornos, observabilidad) que ninguna sección enumera y que el sistema necesita para poder cumplir el resto.

---

**Mantenido por:** quien cierre la tarea. **Fuente de la evidencia:** `main` en la fecha indicada arriba. **Documento sustituido:** `COMPARACION_DISENO_VS_REAL.md`.
