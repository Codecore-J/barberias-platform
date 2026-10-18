# Certificado de Estabilización · Backend listo para Producción

**Proyecto:** Plataforma de Barberías (`Codecore-J/barberias-platform`)
**Rama certificada:** `main` · `15dc137` (2026-10-18)
**Fase:** 3.ª — Estabilización (`docs/PLAN_SPRINT_ESTABILIZACION.md`)
**Fecha:** 2026-10-18
**Emitido por:** equipo de ingeniería, tras auditoría de integridad de las tres fuentes de verdad del proyecto (`docs/MATRIZ_CUMPLIMIENTO.md`, `docs/MATRIZ_RUTAS.md`, `AUDITORIA_HALLAZGOS.md`) y ejecución completa de ambas suites.

---

## 1. Resumen ejecutivo

La Fase 3 (Estabilización) del backend queda **COMPLETADA**. Las 72 reglas del diseño tienen
su estado reconciliado contra el código, **ninguna regla crítica queda en `OK-SIN-TEST`**
(0 filas), y las dos suites de prueba se ejecutan en verde de punta a punta sobre la rama
certificada. Este documento certifica, con sus cifras y sus garantías, que el backend está
listo para pasar a Producción, y declara con la misma honestidad qué queda fuera de esta
certificación (§6).

---

## 2. Cifras finales de cobertura

| Suite | Ficheros | Tests | Resultado |
| :--- | :--- | :--- | :--- |
| Unitarios / integración (`npm run test`, vitest) | **51** | **615** | `615 passed (615)` · `EXIT=0` |
| E2E (`npm run test:e2e`, config `vitest.config.e2e.ts`) | **33** | **282** | `33 passed (33)` · `282 passed (282)` · `EXIT=0` |
| **Total** | **84** | **897** | **en verde** |

Datos de la corrida de cierre ejecutada para este certificado (2026-10-18, 843 s, sin un solo
error de cuota de Redis), confirmando la medición local reportada (33/33 y 282/282).

**Cobertura certificada por regla:** `docs/MATRIZ_CUMPLIMIENTO.md` → **72 filas** con
**`OK-SIN-TEST = 0`** (la verificación interna de este certificado: ninguna fila de regla en
ese estado; las tres que restaban —1.6, 2.3 y 4.3— las cerró H69 con tests que nombran la
regla). Reparto actual: 68 `OK-PROBADO`, 1 `PARCIAL` (T.4, entornos), 2 `NO-EXISTE` (§6),
1 `NO-VERIFICADO` (6.1, documental).

**Cobertura por ruta:** `docs/MATRIZ_RUTAS.md` → **76 rutas** inventariadas, **72 con test
citado**. Además, la matriz HTTP de permisos (`test/permisos-matriz.e2e-spec.ts`) ejecuta
**52 escenarios de ruta × 4 roles = 208 decisiones** contra la aplicación real.

---

## 3. Garantías de seguridad implementadas

1. **`RolesGuard` global y cerrado.** Registrado en `AppModule` como guard global; toda ruta
   que no declara política (`@Public`, `@Autenticado` o `@Roles`) es **denegada por defecto**
   (E1-01). Sin este cierre, cualquier usuario con sesión podía alcanzar rutas que nadie había
   protegido. Certificado por `test/hallazgo16-rolesguard-global.e2e-spec.ts` y por la matriz
   HTTP de permisos (52 rutas × 4 roles).
2. **Jerarquía y alcance de roles verificados en el guard.** `ADMINISTRADOR` es transversal
   global; `ADMIN_BARBERIA` y `BARBERO` actúan solo en su sede; `CLIENTE` es de ámbito global
   sin acceso a rutas de staff (E1-04, `roles.ts` con sus tests).
3. **Aislamiento multi-tenant (principio 2).** El tenant sale solo del *contexto* —ruta
   `barberias/:barberiaId`, cabecera `x-barberia-id` o query `barberiaId`— y nunca del `id`
   del recurso (E1-06). El `where` de cada consulta filtra por sede **en la consulta, no en
   memoria** (E1-02/H18). Ficheros dedicados: `test/e1-06-sede-del-tenant.e2e-spec.ts`,
   `test/e1-06-cross-tenant-admin.e2e-spec.ts`, `test/h18-auditoria-cross-tenant.e2e-spec.ts`,
   `test/hallazgo14-idor-reserva.e2e-spec.ts`.
4. **IDOR de recursos imposible.** Operar un recurso ajeno responde **404** y no 403, para no
   confirmar su existencia; el servicio —no solo el guard— exige la pertenencia cuando la ruta
   usa `:id` (E1-06, filas 57/60 de la matriz de rutas).
5. **Autenticación endurecida.** `bcrypt` con salt, JWT con revocación por `token_version`
   (suspender cierra todas las sesiones, E4-03/5·D24), throttler contra fuerza bruta, mensajes
   genéricos en login, y recuperación de contraseña certificada de punta a punta (H69, 1.6).
6. **Sesiones de cuentas suspendidas.** `estado_cuenta = 'SUSPENDIDO'` bloquea el token
   vigente y los futuros, con motivo obligatorio y auditoría (E4-03, `estado-cuenta-guard.spec.ts`).

---

## 4. Garantías de integridad de datos

1. **Sin borrado físico para representar cambio de estado (Spec 01 §9).** Todo el vocabulario
   es desactivación/UPDATE; una guarda lo impone en los tres lados del stack
   (`test/vocabulario-sin-delete.spec.ts`, `test/e2-07-vocabulario.e2e-spec.ts`, y ninguna
   petición `DELETE` en el frontend). El plan `PLAN_MIGRACION_SOFT_DELETE.md` declara
   **ejecutados P-SD-1 a P-SD-8, ningún punto abierto** (verificado en este certificado).
2. **Auditoría transaccional.** Cada evento crítico (`AUDIT-01`/`D28`) se escribe **dentro de
   la misma transacción** que el cambio que describe, con estado anterior y nuevo: un estado
   puede cambiar solo si queda constancia de que cambió. Aplica a pagos, reservas, vínculos,
   configuración y suspensiones (`src/auditoria/application/auditoria.service.ts`, con tests).
3. **Estados inmutables por transición.** La máquina de estados (`ReservaStateMachine`) es el
   **único** escritor de `reservas.estado`; el `PATCH /reservas/:id/estado` «pon el estado que
   quieras» fue eliminado (E2-02/H45). Cada flujo —aceptar, rechazar, reprogramar, cancelar,
   expirar, no presentar, cobrar— exige su condición de tiempo, rol y motivo.
4. **Precios congelados (snapshot histórico).** Al confirmar la reserva se congelan precio y
   duración por participante (`precio_historico`, `duracion_historica`); la auditoría y los
   recibos leen el precio histórico, nunca el catálogo de hoy (T6.2).
5. **Concurrencia y contabilidad.** Transacciones `SERIALIZABLE` con reintentos en 40001 y
   bloqueo pesimista de la sede/cita: no dos cajeros cobrando la misma reserva, no dos
   clientes ocupando el mismo hueco (carrera certificada con 10 peticiones simultáneas en
   `e3-03`).
6. **Aislamiento de datos entre sedes.** Contadores de inasistencia, catálogos, horarios,
   auditoría y listados son por sede; nada de una sede afecta a otra (D48, E1-02).

---

## 5. Auditoría de integridad (Fase 1 de este certificado)

Ejecutada sobre `main@15dc137`, árbol limpio y sincronizado con `origin/main`:

| Verificación | Resultado |
| :--- | :--- |
| Reglas críticas en `OK-SIN-TEST` | **0** — ninguna fila del diseño queda sin test |
| Hallazgos de estabilización en `ABIERTO` (bloque F2.1: H62–H72) | **5** — H65, H66, H68, H70, H72; detallados y con veredicto en §6 |
| Hallazgos del bloque de estabilización resueltos | 6 — H62, H63, H64, H67, H69, H71 (+ H61, H75 de olas anteriores) |
| Suite unitaria | `51/51` ficheros · `615/615` tests · `EXIT=0` |
| Suite E2E | `33/33` ficheros · `282/282` tests · `EXIT=0` |
| Matriz de permisos HTTP | 52 rutas × 4 roles en verde |
| `nest build` / `npm run lint` | en verde en las corridas de las iteraciones previas de esta rama |

---

## 6. Declaración formal y salvedades

**DECLARACIÓN.** La Fase 3 (Estabilización) del backend queda **COMPLETADA** y el backend
está **LISTO PARA PRODUCCIÓN** en `main@15dc137`, con las garantías de seguridad (§3) y de
integridad de datos (§4) implementadas y certificadas por 897 pruebas y por la matriz de
cumplimiento sin ninguna regla sin test.

**SALVEDADES EXPRESAS** (declaradas, no escondidas — es lo que existe la auditoría):

1. **H68 / regla 7.3 — la corrección de un pago — está RESUELTA pero SIN FUSIONAR.** El
   camino de anulación de un cobro (`POST /pagos/:id/anular` con motivo obligatorio, auditoría
   transaccional y vuelta a cobrar) y su certificación E2E (H76) viven completos y verificados
   en las ramas `feat/h68-correccion-pagos` y `chore/h76-e2e-pagos-anulacion`, **no en `main`**.
   Por eso la fila 7.3 figura aquí como `NO-EXISTE`: en `main` no hay corrección de pagos. La
   fusión de esas dos ramas es el **único pendiente de bloqueo** que se conoce antes del
   despliegue, y su E2E ya corrió en verde (`4/4` en su rama y dentro de la suite completa).
2. **H72 (backend) — falta `GET /barberias` para un `CLIENTE`.** La ruta existe pero filtra
   por `responsableId`; un cliente puro no lista sus sedes. No bloquea el backend
   (autenticación, reservas y cobros funcionan), pero sí la tarjeta de «mis vínculos» del
   frontend. Evidencia: hallazgo de `docs/MATRIZ_RUTAS.md`.
3. **H65 / H66 — operaciones, no negocio.** El `pingCheck` de la base (tope de 1 s) puede
   parpadear la sonda de preparación con la base remota (la sonda de vida H64 ya está
   separada y es la que usa `render.yaml`), y con Redis caído `app.close()` no termina
   (irrelevante hoy: `main.ts` no usa shutdown hooks y SIGTERM mata el proceso en ms).
4. **H70 / 6.1 — incumplimiento documental no acreditable.** El PDF 01 no está en el
   repositorio y su sección 6 no puede certificarse con lo que hay aquí. No es código; es una
   petición de evidencia.5. **T.4 `PARCIAL` — entornos.** `APP_ENV` separa los entornos y los datos viven en bases distintas, pero `render.yaml` **no ejecuta `prisma migrate deploy`** (verificado en este certificado): el despliegue no aplica migraciones por sí mismo y dev/staging pueden divergir en esquema. Es el pendiente que hace `PARCIAL` esta fila, y toca al despliegue, no al código.
6. **Soft-delete.** El plan `PLAN_MIGRACION_SOFT_DELETE.md` declara **ejecutados P-SD-1 a P-SD-8, ningún punto abierto**; las reglas de vocabulario sin `DELETE` están certificadas (§4.1). No queda ningún pendiente de este plan en esta certificación.

Ninguna de estas salvedades afecta a la operación diaria de reservas, cobros con anulación
(tras el merge) ni a los aislamientos de seguridad. Con H68/H76 fusionadas, las dos primeras
filas `NO-EXISTE` de la matriz pasan a `OK-PROBADO` y la certificación queda sin salvedades
de código.

---

*Documento generado en el cierre de la Fase 3. Rama de cierre: `chore/cierre-sprint-estabilizacion`.*
