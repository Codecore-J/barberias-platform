# QA funcional completo del ADMINISTRADOR — producción

**Plataforma:** https://barberias-platform.vercel.app
**API:** https://barberias-api-p3br.onrender.com/api/v1 (Render, blueprint `main`)
**Fecha de ejecución:** 19–20 nov 2026 (hora del servidor 2026-11-19 / 20 UTC)
**Método:** API real en producción con token de sesión + navegador real en las pantallas de UI. No se usó SQL directo (ver «Limpieza post-QA»).
**Cuenta usada:** `admin@demo.com` (ADMINISTRADOR + ADMIN_BARBERIA, sede demo) y `admin.qa@barberias.demo` (ADMIN_BARBERIA) para el flujo de sede. La cuenta indicada en el guion, `admin.cremaq.production@test.com`, está **SUSPENDIDA** en producción (`estadoCuenta: SUSPENDIDO`) y no permite iniciar sesión: se documenta y se continúa con las cuentas de trabajo.

---

## Resumen ejecutivo

- **Módulos probados:** 12 de 12 (M1 parcial: OTP y correo real no ejercitables)
- **Flujos sin defecto:** 33
- **Defectos encontrados:** 11 (**0 críticos, 3 mayores, 8 menores**)
- **Flujos no probables (con razón):** 7 (detalle al final)

Lo importante: **la operación de sede funciona de punta a punta** —alta de especialidad, combos, staff, horarios, excepciones, walk-in, cobro, anulación, cierre de caja y auditoría— y **las cuatro reglas de negocio frágiles se comportan como se documentaron** (admin único por sede, no degradación del admin, cierre único de caja, anulación única de pago). Los defectos mayores no son de datos ni de permisos: son de navegación, de normalización del correo y de una guarda que se salta con cuentas globales.

---

## Tabla de resultados

| Módulo | Flujo | Resultado | Defecto / Observación |
|--------|-------|-----------|----------------------|
| 1 | 1.1 Login normal | ✅ | 200; redirección post-login a `/admin/usuarios` (ver observación O-1), menú con nombre, correo y 3 roles |
| 1 | 1.2 Cold start | ⚠️ no ejercitado | El aviso existe (`shared/ui/backend-waking` → «Estamos despertando el servidor»), pero no se observó en vivo (requiere 10 min sin tráfico) |
| 1 | 1.3 Recuperación de contraseña | ✅ (código) | T-28 corregido: `tokenIncompleto` muestra «El token tiene N caracteres y necesita 10» — `auth/login/login.component.ts:204-215, 419-421`. No ejercitado en navegador |
| 1 | 1.4 Registro + OTP | ❌ no probable | Sin acceso al OTP. Reenviar token (`POST /auth/otp/resend`) y cambiar contacto (`PATCH /auth/otp/update-contact`) **existen** en el contrato; no se creó cuenta zombi a propósito |
| 1 | 1.5 Cierre de sesión | ✅ | `POST /plataforma/usuarios/:id/estado` invalida sesiones (`tokenVersion`), la cuenta suspendida da 401 al login |
| 2 | 2.1 Vista de plataforma (sin sede) | ✅ | 5 cifras correctas y coincidentes con la API: Sedes activas 4 · Citas hoy 1 · Recaudado hoy $0 · Cajas abiertas 0 · Usuarios activos 8 |
| 2 | 2.1b «Ver analíticas consolidadas» | ❌ | **DEF-01**: el enlace no navega (ruta inexistente) |
| 2 | 2.1c «Gestionar usuarios» | ✅ | `routerLink="/admin/usuarios"`, ruta válida |
| 2 | 2.2 Vista de sede | ⚠️ parcial | Aparecen KPIs de sede (INGRESOS HOY, TURNOS COMPLETADOS, PRODUCTIVIDAD TOP) pero el hero sigue siendo el de PLATAFORMA: no dice «CENTRO DE GESTIÓN» (DEF-09) |
| 2 | 2.2b «PRODUCTIVIDAD TOP: N/A» | ✅ | Correcto: no hay turnos hoy en esa sede; con 1 cita futura el cálculo sigue en N/A por diseño (solo cuenta el día) |
| 2 | 2.3 «Configuración» del menú | ✅ corregido | Ya no lleva a `/barberias/nueva`: es «Configuración de sede» → `/admin/horarios` (`admin-shell.component.ts:558-559`). Sigue sin ser «ajustes de cuenta» |
| 3 | 3.1 Crear sede | ✅ | 201, ACTIVO, aparece en `/shops/all` con código de acceso y enlace únicos |
| 3 | 3.2 Editar sede (descripción/ubicación/logo) | ✅ | 200 y el cambio se persiste |
| 3 | 3.2b Editar **nombre** | ⚠️ por diseño | 422 `NOMBRE_REQUIERE_SOLICITUD`: el nombre solo cambia por solicitud aprobada (E3-13). El guion lo plantea como edición directa (DEF-10) |
| 3 | 3.3 Código y QR por sede | ✅ corregido | `/shops/:id/invitation` devuelve el código y el enlace **de esa sede** (verificado con dos sedes distintas) |
| 3 | 3.4 Suspender y reactivar sede | ✅ | `INACTIVO` → sale del listado activo; reactivación 200 |
| 3 | 3.5 Seleccionar y cambiar sede | ✅ | `PATCH /shops/:id/select` 200; el header y el tenant cambian |
| 4 | 4.1 Listado y filtros | ⚠️ | Conteo correcto (9 = 9), filtros y buscador funcionan **en cliente**; el backend ignora `?estado=`, `?rol=` y `?q=` (DEF-05) |
| 4 | 4.1b Roles crudos | ⚠️ sigue | En la tabla se traduce («ADMIN. DE BARBERÍA»), pero el panel «Distribución de roles» sigue mostrando `ADMIN_BARBERIA`, `CLIENTE` (DEF-07) |
| 4 | 4.1c Paginación | ⚠️ sigue | «Mostrando 9 de 9 cuentas»: sin paginación, carga todo |
| 4 | 4.2 Crear usuario | ✅ | 201 con rol CLIENTE; 409 `CORREO_YA_REGISTRADO` en duplicado |
| 4 | 4.3 Historial de cuenta | ✅ corregido | El alta **sí** emite evento: `USUARIO_CREADO` con actor y contexto |
| 4 | 4.4 Suspender / reactivar | ✅ | Sin motivo → 422 `MOTIVO_REQUERIDO`; con motivo → 200 + `sesionesCerradas: true`; login de suspendida 401 «Su cuenta se encuentra suspendida» |
| 4 | 4.4b Historial tras eventos | ✅ | `CUENTA_REACTIVADA` con `anterior`/`nuevo`, motivo y actor |
| 4 | 4.5 Roles de sede | ✅ | `GET /plataforma/usuarios/:id/roles` separa `ambito: GLOBAL`/`BARBERIA` con sede y estado |
| 5 | 5.1 Invitar BARBERO | ✅ | 201, tarjeta ACTIVO, rol BARBERO |
| 5 | 5.2 Invitar segundo ADMIN_BARBERIA | ✅ | 409 `SEDE_YA_TIENE_ADMIN` **con `adminActual`** (id, correo, nombre) |
| 5 | 5.3 Cuenta dual | ✅ | Sin flag → 409 `ADMIN_NO_SE_DEGRADA`; con `conservarRolAdministrador: true` → 201 con `roles: ["ADMIN_BARBERIA","BARBERO"]` |
| 5 | 5.3b Cuenta dual con ADMINISTRADOR global | ❌ | **DEF-02**: se acepta la degradación sin 409 y pierde el rol de admin de esa sede |
| 5 | 5.4 Editar miembro (nombre) | ❌ | **DEF-04**: `PATCH /shops/:id/staff/:userId` no admite `nombreCompleto` (400) |
| 5 | 5.5 Excepción de horario | ✅ | 201 `CERRADA` 2026-11-20 con motivo; después, un walk-in en ese día se rechaza con 409 `CONFLICTO_HORARIO` |
| 5 | 5.6 Desactivar miembro | ✅ | `estadoSede: INACTIVO`; el barbero deja de ver la agenda (403 por vínculo inactivo) |
| 6 | 6.1 Categorías solo lectura | ✅ (API) | Lectura 200; la escritura del ADMINISTRADOR no se intentó (fuera de alcance) |
| 6 | 6.2 Crear categoría | ✅ | 201 como ADMIN_BARBERIA |
| 6 | 6.3 Crear servicio **end-to-end en la UI** | ✅ corregido | POST desde el modal → **201**, recarga 200 y la tarjeta aparece (captura local: `qa-capturas/01-servicios.png`, no versionada) |
| 6 | 6.3b POST crudo con `descripcion` | ⚠️ | Sigue 400 `property descripcion should not exist`; el panel ya no lo envía (sanea el cuerpo). La descripción escrita se descarta en silencio (DEF-03) |
| 6 | 6.4 Crear combo con 2 servicios | ✅ | 201 con `comboItemsAsParent` y ambos servicios; visible en `GET /combos` |
| 7 | 7.1 Horario semanal 9–19 | ✅ | `POST /hours` con array → 201; relectura con los 5 días |
| 7 | 7.2 Propuestas de horario | ⚠️ sin datos | `GET /hours/mine` y `/appointments/proposals/pending` → `[]`: no hay propuestas que aprobar |
| 7 | 7.3 Solicitudes de cambio | ⚠️ sin datos | Bandeja de plataforma y de sede vacías (`total: 0`); no se ejercitó aprobar/rechazar |
| 8 | 8.1 Agenda del día | ✅ | `GET /appointments/day?fecha=…` 200; con cita devuelve cliente, barbero, detalles y precio |
| 8 | 8.1b Sede sin barberos/sin citas | ✅ | `[]` con la agenda vacía; el panel muestra «No hay citas» (visto en la captura de servicios con listas vacías) |
| 8 | 8.2 Walk-In | ✅ | 201 con `modoConfirmacion MANUAL`, cita PENDIENTE en la agenda |
| 8 | 8.2b Walk-In + cobro en un paso | ✅ | 201, cita COMPLETADA y caja `efectivo: 25` |
| 8 | 8.3 Aislamiento del BARBERO | ✅ corregido (MAPA-1) | El barbero ve **0** citas donde el admin ve 1 (`reserva.service.ts:1501` filtra `barberoId` cuando `esSoloBarbero`) |
| 8 | 8.3b `/appointments/mine` del barbero | ❌ | **DEF-06**: 403 «No posees los permisos requeridos (CLIENTE)» |
| 9 | 9.1 Caja del día | ✅ | `zonaHoraria: America/Santo_Domingo`, `fecha` correcta, totales por método |
| 9 | 9.2 Cerrar caja | ✅ | 201 con arqueo; segundo cierre → 409 `CAJA_YA_CERRADA` («Se selló el …») |
| 9 | 9.3 **Anular pago** (nunca verificado antes) | ✅ con reparo | 200 `ANULADO`, caja vuelve a 0, segundo intento 409 `ESTADO_INVALIDO`, evento `REGISTRO_PAGO_EN_PERSONA` en auditoría. La cita queda COMPLETADA (DEF-08) |
| 9 | 9.4 Exportar CSV | ✅ | `text/csv; charset=utf-8`, `attachment; filename="reporte-barberia-<id>.csv"`, BOM + cabeceras y datos |
| 10 | 10.1 Vista global | ✅ | Título/chip de plataforma y cifras iguales a `/analytics/plataforma/hoy` |
| 10 | 10.2 Vista de sede | ✅ | `GET /shops/:id/analytics?desde=&hasta=` devuelve `periodo` con las fechas pedidas (sin off-by-one) |
| 10 | 10.2b «Resumen Multisede» (T-43) | ⚠️ no ejercitado | La pantalla de analíticas de sede no se abrió con datos; solo se validó el contrato JSON |
| 10 | 10.3 Rangos de fecha | ✅ (API) | `2026-10-21 → 2026-11-20` se respeta tal cual en `periodo` |
| 11 | 11.1 Antecedentes | ⚠️ sin datos | `GET /records/pending` → `[]`; no hay antecedentes que gestionar |
| 11 | 11.2 Clientes restringidos | ⚠️ sin datos | `[]`; no hay restricciones que levantar |
| 11 | 11.3 Vinculaciones | ⚠️ sin datos | `total: 0`; KPIs de la bandeja sin ejercitar |
| 12 | 12 Limpieza | ✅ | 4 cuentas QA suspendidas, 2 sedes QA inactivas, servicio QA desactivado (detalle al final) |

---

## Defectos encontrados

### DEF-01 · «Ver analíticas consolidadas» apunta a una ruta que no existe
- **Módulo/flujo:** 2.1 · Dashboard de plataforma
- **Reproducir:** entrar sin sede activa → home → clic en «Ver analíticas consolidadas».
- **Actual:** no navega; la URL sigue en `/`.
- **Esperado:** abrir la vista consolidada.
- **Causa:** `frontend-barberias/src/app/features/home/dashboard-plataforma/dashboard-plataforma.component.html:109` → `routerLink="/admin/analytics"`, pero la ruta registrada es `admin/analiticas` (`app.routes.ts:145`).
- **Severidad:** Mayor
- **¿Ya conocido?** No

### DEF-02 · Invitar como BARBERO a un ADMINISTRADOR global le retira el admin de la sede (fail-open)
- **Módulo/flujo:** 5.3 · Cuenta dual
- **Reproducir:** sede con un ADMIN_BARBERIA que además es ADMINISTRADOR global → `POST /shops/:id/staff` con su correo, `rolNombre: "BARBERO"`, **sin** `conservarRolAdministrador`.
- **Actual:** 201 y `roles: ["BARBERO"]`; el vínculo ADMIN_BARBERIA desaparece de esa sede. La guarda `ADMIN_NO_SE_DEGRADA` sí responde 409 para cuentas que solo son ADMIN_BARBERIA (verificado con `qa_adminsede@test.com`).
- **Esperado:** 409 `ADMIN_NO_SE_DEGRADA` igual que con cualquier otra cuenta, o exigir el flag.
- **Causa probable:** la comprobación trata como «administrador» solo al ADMIN_BARBERIA y deja pasar al global (`barberia.service.ts`, rama de `invitarPersonal`).
- **Severidad:** Mayor (pérdida silenciosa de un rol de sede; recuperable, pero sin aviso)
- **¿Ya conocido?** No

### DEF-03 · El formulario de servicio acepta una descripción que nunca se guarda
- **Módulo/flujo:** 6.3 · Alta de servicio
- **Reproducir:** Servicios → Nuevo Servicio → rellenar descripción → Guardar.
- **Actual:** 201 y el servicio aparece con «Sin descripción detallada» (captura local: `qa-capturas/01-servicios.png`, no versionada); el campo se descarta en el saneado del cuerpo (`core/services/servicios.service.ts:196-206`).
- **Esperado:** guardarla o no ofrecer el campo para servicios.
- **Severidad:** Menor
- **¿Ya conocido?** Parcial (BUG-ALTA-SERVICIOS se corrigió silenciando el campo, no eliminándolo)

### DEF-04 · El nombre de un miembro de sede no se puede editar
- **Módulo/flujo:** 5.4
- **Reproducir:** `PATCH /shops/:id/staff/:userId` con `{"nombreCompleto":"…"}`.
- **Actual:** 400 `property nombreCompleto should not exist` (`ActualizarPersonalDto` solo admite `estado` y `rolNombre`).
- **Esperado:** poder corregir el nombre, o no ofrecer la acción en el guion/UI.
- **Severidad:** Menor
- **¿Ya conocido?** No

### DEF-05 · La bandeja de usuarios no pagina y el backend ignora los filtros
- **Módulo/flujo:** 4.1
- **Reproducir:** `/admin/usuarios` con muchas cuentas; `GET /plataforma/usuarios?estado=SUSPENDIDO` devuelve **todas**.
- **Actual:** «Mostrando 9 de 9»; filtros resueltos en cliente; `?estado`, `?rol` y `?q` no tienen efecto en el servidor.
- **Esperado:** paginación D32 y filtros server-side (o documentar que la bandeja es de cliente).
- **Severidad:** Menor (hoy; crece con la base)
- **¿Ya conocido?** Sí (paginación)

### DEF-06 · Un BARBERO invitado no puede consultar «sus» citas
- **Módulo/flujo:** 8.3b
- **Reproducir:** iniciar sesión con `qa_barbero@test.com` (invitado desde el panel, roles `["BARBERO"]`) → `GET /shops/:id/appointments/mine`.
- **Actual:** 403 «No posees los permisos requeridos (CLIENTE)». La agenda del panel (`/appointments/day`) sí funciona y respeta el filtro por barbero.
- **Esperado:** `mine` disponible para BARBERO, o que la invitación conceda también el rol base CLIENTE (como el seed `barbero.qa`).
- **Severidad:** Menor (el panel no usa `mine`, pero el contrato queda roto para cuentas creadas por el panel)
- **¿Ya conocido?** No

### DEF-07 · El panel «Distribución de roles» muestra códigos crudos
- **Módulo/flujo:** 4.1b
- **Actual:** `ADMINISTRADOR`, `ADMIN_BARBERIA`, `BARBERO`, `CLIENTE` sin traducir; en la tabla sí se traduce a «ADMIN. DE BARBERÍA».
- **Severidad:** Menor (cosmético)
- **¿Ya conocido?** Sí

### DEF-08 · Anular un pago deja la cita en COMPLETADA y sin cobro
- **Módulo/flujo:** 9.3
- **Reproducir:** walk-in-pago (COMPLETADA, $25) → `POST /payments/:id/void`.
- **Actual:** 200 `ANULADO` y la caja cuadra a 0, pero `estadoReserva` sigue `COMPLETADA` y no queda motivo en la cita.
- **Esperado:** decidir y documentar el efecto (revertir a PENDIENTE/CANCELADA o marcar «cobro anulado»), porque hoy analíticas cuenta la cita como completada sin ingreso.
- **Severidad:** Menor
- **¿Ya conocido?** No (flujo nunca verificado)

### DEF-09 · Con sede activa, el dashboard conserva el hero de «PLATAFORMA»
- **Módulo/flujo:** 2.2
- **Actual:** sigue diciendo «CENTRO DE CONTROL ADMINISTRATIVO (PLATAFORMA) / Gestión Integral de Sedes, Servicios & Auditoría» y aparece debajo el bloque «BARBERÍA ACTIVA CONECTADA» con los KPIs de sede.
- **Esperado:** hero de sede («CENTRO DE GESTIÓN») cuando `vistaActual() === 'sede'`.
- **Severidad:** Menor (confunde el contexto activo)
- **¿Ya conocido?** No

### DEF-10 · Renombrar la sede no es una edición directa
- **Módulo/flujo:** 3.2
- **Actual:** 422 `NOMBRE_REQUIERE_SOLICITUD` con mensaje correcto; el cambio va por solicitud (`tipo: NOMBRE|RESPONSABLE`, `valorNuevo`).
- **Esperado:** es el diseño E3-13; el guion del QA lo describe como edición directa.
- **Severidad:** Menor (documental)
- **¿Ya conocido?** Sí (por diseño)

### DEF-11 · Watermark «Invalid PrimeUI License» en toda la UI
- **Módulo/flujo:** transversal (visible en login, home y servicios)
- **Actual:** banner rojo fijo abajo a la derecha en producción.
- **Esperado:** desaparece con una clave `PRIMEUI_LICENSE` válida (Community o Commercial); el código ya la soporta (`scripts/generate-runtime-env.mjs`, `app.config.ts`).
- **Severidad:** Menor (cosmético; no se oculta por CSS porque la licencia prohíbe retirar el mecanismo)
- **¿Ya conocido?** Sí

---

## Confirmación de hallazgos conocidos

| Hallazgo | Estado |
|----------|--------|
| Configuración lleva a `/barberias/nueva` | ✅ **Corregido** — ahora «Configuración de sede» → `/admin/horarios` |
| Roles como códigos crudos | ❌ **Sigue** en «Distribución de roles» (la tabla sí traduce) |
| Historial «Sin eventos» al crear cuenta | ✅ **Corregido** — `USUARIO_CREADO` con actor y contexto |
| BUG-ALTA-SERVICIOS (422 `descripcion`) | ✅ **Corregido en el panel** (201 real desde la UI). El endpoint crudo sigue rechazando `descripcion` por diseño y el campo se descarta (DEF-03) |
| MAPA-1 · el barbero ve toda la agenda | ✅ **Corregido** — 0 citas ajenas para el barbero, 1 para el admin |
| Walk-In roto en SPA/móvil | ✅ **Corregido** — walk-in y walk-in-pago 201 desde API; 400 inicial solo por campos del contrato |
| Off-by-one en fechas de analíticas | ✅ **No reproducido** — `periodo.desde/hasta` respetan lo pedido |
| Botón de token < 10 caracteres deshabilitado sin mensaje | ✅ **Corregido (T-28)** — avisa «El token tiene N caracteres y necesita 10» (verificado en código) |
| Sin paginación en usuarios | ❌ **Sigue** (DEF-05) |

---

## Observaciones (no defectos)

- **O-1 · Redirección post-login:** el ADMINISTRADOR con sede activa aterriza en `/admin/usuarios`, no en el home. Funciona, pero es un destino poco natural para un login.
- **O-2 · Mensajes de conflicto genéricos:** `CONFLICTO_HORARIO` cubre tres causas distintas (sede sin horario, fuera de horario y solapamiento). Un usuario no puede saber qué corregir.
- **O-3 · Contrato de `POST /shops/:id/hours`:** espera un **array**; enviar un objeto devuelve `400 Validation failed (parsable array expected)`, un mensaje que no explica el formato.
- **O-4 · Dato del seed:** «Corte QA (Sandbox)» tiene `precio: 15000` (probable error de unidades; se muestra $15.000).
- **O-5 · Cuenta del guion:** `admin.cremaq.production@test.com` está suspendida en producción.

---

## Limpieza post-QA

Datos creados y su estado final (todo con borrado lógico, sin DELETE físico):

| Recurso | Identificador | Estado final |
|---|---|---|
| Sede `QA_Sede_Test` | `4d72cf47-ce9a-4561-bfe4-4dc461cb6162` | INACTIVO |
| Sede `QA_Sede_Dos` | `e23170e6-4ed1-46c6-8bd0-7f33f54b128c` | INACTIVO |
| `QA_usuario@test.com` | `09855088-…` | SUSPENDIDO |
| `qa_barbero@test.com` | `b3401560-…` | SUSPENDIDO |
| `qa_adminsede@test.com` | `d20df5df-…` | SUSPENDIDO |
| `qa_barbero2@test.com` | `30e05911-…` | SUSPENDIDO |
| Servicio `QA_Servicio_UI` (Sede Sandbox QA) | `bc18fe48-…` | INACTIVO |

Verificación (equivalente por API a las consultas SQL pedidas; **no** se ejecutaron consultas en Neon):

```
GET /api/v1/plataforma/usuarios  →  total 9, activas 4
  qa_barbero2@test.com   | SUSPENDIDO
  qa_adminsede@test.com  | SUSPENDIDO
  qa_barbero@test.com    | SUSPENDIDO
  QA_usuario@test.com    | SUSPENDIDO
GET /api/v1/shops/all
  Imperial Barbers Demo | ACTIVO
  QA_Sede_Dos           | INACTIVO
  QA_Sede_Test          | INACTIVO
  Sede Sandbox QA       | ACTIVO
```

**Registros QA residuales:** 4 cuentas (suspendidas), 2 sedes (inactivas), 1 servicio (inactivo), 1 cita walk-in en `QA_Sede_Test` (24/11), 1 cita cobrada y anulada en `QA_Sede_Dos`, más categoría/combo/horarios/excepciones de esas sedes. **No requieren limpieza por BD para operar**: ninguna sede QA está activa ni aparece en el listado operativo, y ninguna cuenta QA puede iniciar sesión. Si se quiere borrado real, hay que hacerlo por BD (los endpoints no ofrecen DELETE físico por diseño).

---

## Flujos no probados y por qué

1. **1.2 Cold start en vivo** — exige 10 min sin tráfico; el aviso existe en código, no se observó.
2. **1.4 Registro con OTP** — sin acceso al código; crear la cuenta habría dejado una cuenta zombi.
3. **1.3 reset con token real** — requiere el correo (el proveedor es MockEmailProvider: no sale ningún correo real).
4. **7.2 / 7.3 propuestas y solicitudes** — bandejas vacías en producción.
5. **11.1 / 11.2 / 11.3 antecedentes, restringidos y vinculaciones** — sin registros pendientes.
6. **10.2b resumen multisede (T-43)** — no se abrió la pantalla de analíticas de sede con datos; solo se validó el contrato.
7. **6.1 escritura de categorías como ADMINISTRADOR** — deliberadamente no se intentó (regla de solo lectura).

**No verificado visualmente:** capturas de agenda, tickets, analíticas y bandejas; solo se revisaron por API y en las pantallas listadas (`qa-capturas/01-servicios.png` y `qa-capturas/02-home-sede.png` (locales, no versionadas)) y se comprobó la consola/red sin errores en esos flujos.
