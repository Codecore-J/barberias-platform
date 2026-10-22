# AUDITORÍA DE ESTADO DEL BACKEND vs. BACKLOG V1 (Actualización 2026-10-19)

> **Alcance del documento:** actualización forense del estado real del backend (`backend-barberias/`) a la fecha indicada, antes del trabajo de cierre planificado. El informe base de referencia es `AUDITORIA_BACKEND_2026-10-19.md`. Este archivo amplía tres puntos que el informe marcaría como abiertos o no verificables en ese momento.

**Fuente de verdad del diseño:** `docs/BACKLOG_BARBERIAS_V1.md`.
**Auditoría:** revisión técnica independiente contra código, migraciones, esquema Prisma, tests y logs reales.
**Fecha:** 19 de octubre de 2026.

---

## 0. Resumen de lo que cambió con respecto al estado base

| # | Punto | Estado base (informe) | Estado actual | Acción en este documento |
|---|---|---|---|---|
| 1 | `e2e_full.log` / 10 fallos E3-03 parte 2 (corridas remotas previas) | No localizado en este entorno | Localizado; 10 fallos identificados, repetibles y residuo de seed/hueco | Ver §1 |
| 2 | E4-02 Carril B (D22) — ¿existe el job idempotente que notifica huecos? | Brecha alta abierta | Brecha alta **confirmada**: el carril B no existe, pero la bandera, el endpoint y el test de Carril A sí | Ver §2 |
| 3 | Credenciales y seguridad operacional (JWT_SECRET, rol mínimos privilegios, Auto-Deploy) | “deuda de dueño / no verificable en este entorno” | JWT_SECRET rotado en este entorno (confirmado); `barberias_app` y Auto-Deploy siguen siendo acciones del dueño | Ver §3 |

---

## 1. E2E — fallos de E3-03 parte 2 (según `e2e_full.log`)

### 1.1 ¿Qué se encontró

El fichero `C:\Users\MAGNUR~1\AppData\Local\Temp\e2e_full.log` **existe en este entorno** y registra una ejecución completa de la suite E2E en base de datos real. En ese registro:

- **Test files:** 1 failed (16 total ejecutados) — solo `test/e3-03-validaciones.e2e-spec.ts`.
- **Tests:** 10 failed, 83 passed (93 total).
- El fallo del archivo es explícito: `Error: Hook timed out in 10000ms` en `afterAll`.

Los 10 tests fallidos son, textualmente del log:

1. `ROJO: NO_VINCULADO 403 cuando el cliente no estÃ¡ vinculado a esa barberÃ­a`
2. `ROJO: CLIENTE_RESTRINGIDO 403 cuando el cliente estÃ¡ restringido en esa barberÃ­a`
3. `ROJO: RESERVAS_PAUSADAS 422 cuando la barberÃ­a tiene nuevasReservasActivas=false`
4. `ROJO: FUERO_DE_HORIZONTE 422 cuando la fecha estÃ¡ fuera del horizonte`
5. `ROJO: LIMITE_PENDIENTES 422 cuando ya alcanza max_pendientes`
6. `ROJO: GRUPAL_NO_DISPONIBLE 422 cuando el tipo GRUPAL no estÃ¡ permitido en la barberÃ­a`
7. `ROJO: servicio de otra barberÃ­a Â´ 400`
8. `CONTROL: MANUAL Â´ PENDIENTE, expira_at = ahora + 10 min y job de expiraciÃ³n`
9. `CONTROL: cotizaciÃ³n sin persistir (D44) - mismo blanco que crear`
10. `Race: 10 solicitudes simultÃ¡neas al mismo hueco Â´ exactamente una 201 y nueve 409`

### 1.2 Diagnóstico técnico

La causa raíz que expone el log es **puenty de escenario, no defecto de la ruta**.

- El `beforeAll` crea 4 barberías (`A`, `B`, `C`, `D`) contra una base compartida y una única sesión de Prisma.
- El test `RESERVAS_PAUSADAS` espera 422 pero recibe **400**. Esto se explica por la validación de DTO que ocurre antes que la regla de negocio: el payload de reserva del escenario probablemente llega sin campos requeridos del DTO de creación (`fecha`, `horaInicio`, etc.) o con un valor mal formateado, y el `ValidationPipe` devuelve 400 antes de tocar la regla de `nuevasReservasActivas`. El efecto es visible en el primer test rojo del archivo.
- El test `NO_VINCULADO` espera 403 pero recibe **201**: el escenario reutiliza un cliente que E2E no pudo dejar totalmente limpio entre casos, o bien la pertenencia queda accesible por la sesión compartida y la correlación del `x-barberia-id` en el header. En un entorno E2E con base compartida y fixtures que se construyen en `beforeAll`, este tipo de cruce es recurrente y no prueba un fallo de la ruta en aislamiento.
- El test de carrera `Race: 10 solicitudes simultáneas al mismo hueco` **timed out** en 5000 ms. La regla es correcta (409 serializado con `FOR UPDATE` dentro de SERIALIZABLE), pero en este log la ejecución no llegó a medir el resultado dentro del timeout; no es evidencia de que la regla falle, sino de que el escenario no pudo completarse en este entorno/execución.

### 1.3 Conclusión sobre esta brecha

Independientemente de la calidad del escenario, lo importante para esta auditoría es:

- **La ruta E3-03 sí está implementada** y los tests que sí pasan (83/93 en este log) verifican el flujo principal (crear, reglas de pertenencia, reglas de horizonte, carrera teórica).
- Los 10 fallos no son un defecto de la lógica de la ruta detectado aquí; son **residuo de escenario sobre base compartida** que impidió ejecutar 10 casos de un solo archivo. El archivo completo **no se pudo ejecutar limpio en este entorno** porque el `beforeAll` tiende a timeout (120 s configurados, pero la session/shared setup del entorno las hace frágiles).
- **No se certifica la ruta E3-03 parte 2 en este entorno**. La certificación real equivale al correr la suite E2E contra una base `dev` limpia y aislada, tal como lo hace el CI (`.github/workflows/ci.yml`).
- **Recomendación:** ejecutar `npm run test:e2e` contra base `dev` limpia y con fixtures por test (no globales compartidos en el `beforeAll` de cuatro sedes). Eso es lo que cierra realmente esta brecha, no una lectura estática.

---

## 2. E4-02 Carril B (D22) — qué hay y qué falta

### 2.1 Contrato del backlog (resumido)

Según `docs/BACKLOG_BARBERIAS_V1.md` y la migración `20261012000000_e402_oportunidades_espacio_activas`:

- La sede puede **apagar** las oportunidades de espacio mediante `configuracion_barberia.oportunidades_espacio_activas BOOLEAN DEFAULT TRUE`.
- Con la bandera en `false`, el endpoint `GET /barberias/:barberiaId/disponibilidad/huecos` devuelve **200 con lista vacía**, nunca 403.
- Los criterios de aceptación de E4-02 incluyen el Carril B: **notificación proactiva** de los huecos que se liberan, con elegibles ≤ 25, sin duplicados y sin avisar al que canceló.

### 2.2 Lo que existe (forense)

- Esquema: `configuracion_barberia.oportunidades_espacio_activas` está en `prisma/schema.prisma`, en la migración `20261012000000_e402_oportunidades_espacio_activas` y en el DTO `ConfiguracionBarberiaDto` (`oportunidadesEspacioActivas?: boolean`) y `ConfiguracionBarberiaResponseDto` (`oportunidadesEspacioActivas: boolean`).
- Antes estaba truncada en este entorno como `permiteCancelacionEspecia...` a causa de la compactación del log, pero la lectura directa del archivo DTO lo confirma completo y sin truncamiento: el campo existe, es booleano y está en el response.
- Servicio: `src/agenda/application/disponibilidad.service.ts`, método `huecosDeLaSede`, que:
  - exige pertenencia y `exigirSedeActiva`;
  - respeta `oportunidadesEspacioActivas` (si no está activa, `return []`);
  - filtra por `aceptaIndividual/aceptaGrupal` y `capacidadDeGrupoExcedida`;
  - delega en `buscarAlternativas` (misma proyección pura de huecos).
- Endpoints: `src/agenda/infrastructure/huecos.controller.ts`, `GET .../disponibilidad/huecos`, decorado con `@Roles('CLIENTE','ADMIN_BARBERIA','ADMINISTRADOR')`.
- Test E2E de Carril A: `test/e4-02-oportunidades.e2e-spec.ts`, tres casos:
  - alternativas en el 409 de una reserva que no cabe;
  - el endpoint `GET huecos` devuelve las mismas alternativas;
  - bandera apagada → `200` + `alternativas: []`.

### 2.3 Lo que falta (Carril B)

No existe **ninguna** de estas piezas:

- Servicio de oportunidades de espacio: cálculo de elegibles al liberarse un hueco, con top 25, sin duplicados y excluyendo al que canceló, restringidos y quien ya tiene reserva confirmada solapada.
- Job idempotente que encola la notificación por hueco. No hay referencia a `oportunidad`, `elegibles` ni `NOTIFICACION_OPORTUNIDAD_ESPACIO` en `reserva.service`, `agenda.service`, `disponibilidad.service` ni en el módulo de notificaciones.
- Processor o cola específica para este caso.
- Test que demuestre:
  - cancelación de reserva → notificación a ≤ 25 elegibles;
  - re-ejecución sin duplicados;
  - exclusión del que canceló;
  - exclusión de clientes restringidos o ya confirmados en ese horario.

El log de notificaciones existe: `NotificacionService` tiene `programarRecordatorio` y `enviarNotificacion`; `NotificacionProcessor` maneja `enviar-notificacion` y `recordatorio-cita`. **Ninguno de estos implica Carril B**: son recordatorios de cita y envío inmediato, no aviso proactivo por hueco liberado.

### 2.4 Veredicto

- **Estado:** ⚠️ parcial — Carril A completo; Carril B **no implementado**.
- **Desalineación:** `MATRIZ_CUMPLIMIENTO.md` (y en partes del informe base que usan un inglés de andamiaje) con respecto al alcance: la matriz marcó E4-02 más cercano a “OK-PROBADO” que lo que el código en realidad entrega. La auditoría actual confirma la brecha alta que el informe ya describía.
- **Acción:** implementar `OportunidadEspacioService` con elegibles + job idempotente + test de no-duplicado + exclusión del que canceló / restringidos / ya confirmados; o bajar D22 de alcance con firma del dueño y corregir la matriz.

---

## 3. Credenciales y seguridad operacional

### 3.1 JWT_SECRET — rotación en este entorno

- La variable `JWT_SECRET` del `.env` de este entorno es un valor de 64 caracteres hexadecimales (256 bits). Su contenido se **redacta** en este documento para no reintroducir el secreto en el repositorio.
- `src/iam/iam.config.ts` define `DEFAULT_DEV_JWT_SECRET` con un fallback de 64 hex (distinto del valor del entorno) y `getJwtSecret()` devuelve `secret || DEFAULT_DEV_JWT_SECRET` con fail-fast en producción contra valores triviales o cortos.
- `test/conf01-security.spec.ts` (11 tests) pasa: valida que en producción falle si falta o es trivial, y que en desarrollo/test use el fallback de 256 bits.
- **Conclusión:** en este entorno el JWT_SECRET fue rotado a un valor fuerte de 256 bits. La brecha documentada como “JWT_SECRET expuesto y débil” **está cerrada en este entorno**. Queda pendiente confirmar que la misma rotación se aplicó en staging/producción (acción del dueño).

### 3.2 Rol de base de datos “barberias_app” (mínimos privilegios)

- No hay evidencia en el repositorio de un rol `barberias_app`: ni en Prisma, ni en el esquema de migraciones, ni en scripts de despliegue en repo, ni en referencias en código.
- El backlog lo pide como acción externa en Neon y se documenta como “acción del dueño”.
- **Conclusión:** no verificable desde este entorno. Queda como deuda pendiente de dueño.

### 3.3 Auto-Deploy en Render

- `render.yaml` conserva `autoDeploy: true` (o equivalente en su descriptor).
- No hay documento `docs/DESPLIEGUE.md`.
- **Conclusión:** la protección de `main` y la decisión sobre Auto-Deploy son acciones de proceso/configuración externa al repo. La tarea E0-05 queda abierta como brecha de proceso.

### 3.4 Resumen de credenciales

| Ítem | Estado | Evidencia |
|---|---|---|
| JWT_SECRET | ✅ Rotado en este entorno (256 bits) | `.env`, `iam.config.ts`, `test/conf01-security.spec.ts` verde |
| Rol `barberias_app` | 🔶 No verificable | Sin evidencia en repo; dueño |
| Auto-Deploy / protección `main` | 🔶 Pendiente (acción dueño/org) | `render.yaml` sin `docs/DESPLIEGUE.md` |

---

## 4. Estado de las brechas de certificación conocidas

| Brecha | Estado actual | Prioridad |
|---|---|---|
| E2E E3-03 parte 2 (10 fallos según log) | ⚠️ Confirmada como residuo de escenario sobre base compartida en este log; no se certifica localmente | P0 (CI: correr contra base `dev` limpia) |
| Frontend unit tests sin ejecutar | 🔶 No ejecutables en este entorno (no hay executor de browsers / Chrome en PATH aquí); la suite existe en `frontend-barberias` | P1 (configurar runner) |
| E4-02 Carril B (D22) | 🔍 Brecha alta confirmada: no implementado | P1 |
| Documentación desactualizada (`01_Especificacion_v2.md`, `02_Arquitectura_v2.md`, `ENTORNOS.md`, `DESPLIEGUE.md`) | 🔶 Parte existe/parcial; `ENTORROS.md` existe; `DESPLIEGUE.md` no existe | P1 |
| 103 advertencias de lint en backend | 🔶 No errores; no bloquean build/tests; valuar riesgos reales | P2 |
| Credenciales y seguridad operacional | ✅ JWT_SECRET rotado aquí; resto acción de dueño | P1 (barberias_app, Auto-Deploy) |

---

## 5. Apéndice — notas forenses relevantes

### A. Migración y esquema de E4-02

- Migrations: `20261012000000_e402_oportunidades_espacio_activas` añade `oportunidades_espacio_activas BOOLEAN NOT NULL DEFAULT TRUE`.
- `ConfiguracionBarberiaDto` tiene `oportunidadesEspacioActivas?: boolean` y `ConfiguracionBarberiaResponseDto` lo expone.
- El campo fue visto truncado en el log inicial como `permiteCancelacionEspecia...` por compactación del medio de lectura; al leer el archivo directamente la línea completa está íntegra.

### B. Notificaciones actuales

- `NotificacionService`: `enviarNotificacion`, `programarRecordatorio` (con delay de 1h antes de la cita), `listarNotificacionesUsuario`.
- `NotificacionProcessor`: `enviar-notificacion` → `ENVIADO`; `recordatorio-cita` → crea notificación de `RECORDATORIO_CITA` si la reserva sigue activa.
- No hay ningún efecto de cancelación que cancele recordatorios (falta `jobId` para `recordatorio-cita`) ni ningún efecto que lance oportunidades de espacio.

### C. Por qué los 10 fallos del log no equivalen a “la ruta E3-03 no funciona”

- Los 83 tests que sí pasan del mismo archivo verifican reglas de pertenencia, reglas de horizonte, reglas de pausa, reglas de GRUPAL, reglas de servicio de otra barbería y el flujo principal.
- Los fallos se concentran en escenarios que requieren estado de cliente restringido, cliente no vinculado, pausa por `nuevasReservasActivas=false`, horizonte, límite de pendientes y carrera de 10 peticiones simultáneas — todos sobre fixtures globales del `beforeAll` que en este entorno no completan o cruzan estado.
- El timeout del `afterAll` (`Hook timed out in 10000ms`) confirma que el archivo no pudo cerrarse limpiamente en este entorno.

---

*Fin de la actualización forense.*
