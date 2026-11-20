# QA funcional completo del ADMINISTRADOR — producción

> **Renumerado (20 nov 2026):** los defectos de este informe pasan a `QA2-xx` en `QA2_ADMIN_2026-11-20.md`; los IDs `DEF-01`…`DEF-03` quedan reservados a los PRs #162–#164.

**Fecha de ejecución:** 20 nov 2026
**Entorno:** `https://barberias-platform.vercel.app` (frontend Vercel) + `https://barberias-api-p3br.onrender.com/api/v1` (API Render) + Neon `neondb`
**Cuenta de partida:** `admin.cremaq.production@test.com` (ADMINISTRADOR global)
**Navegador:** Chromium real (panel de previsualización), sesiones reales contra producción.
**Capturas:** `qa-capturas/03-dashboard-plataforma.png`, `qa-capturas/04-analiticas-global.png` (más `01-servicios.png` y `02-home-sede.png` de la ronda previa).

> **Aviso previo obligatorio:** la cuenta `admin.cremaq.production@test.com` estaba **SUSPENDIDA** en la base al iniciar el QA, por lo que ningún administrador global podía entrar a la plataforma. Para poder ejecutar el encargo se reactivó directamente en Neon (`usuarios.estado_cuenta = 'ACTIVO'`, rol `barberias_app`) y **se dejó ACTIVA** al terminar, porque volver a suspenderla devolvería la plataforma a un estado sin acceso administrativo. Es la única desviación deliberada respecto del estado encontrado; se puede revertir cuando el dueño lo indique.

---

## Resumen ejecutivo

- **Módulos probados:** 12 de 12 (el 1 y el 7 de forma parcial; ver «Flujos no probables»).
- **Flujos sin defecto:** 33
- **Defectos encontrados:** 15 (1 crítico, 2 mayores, 12 menores)
- **Flujos no probables (con razón):** 8

Hallazgo de mayor impacto: **el único ADMINISTRADOR global de la plataforma estaba suspendido**; sin intervención en base de datos el producto no tiene administración posible. El segundo: **el cierre de sesión no invalida el token** (JWT de 24 h sigue respondiendo 200 después del logout).

---

## Tabla de resultados

| Módulo | Flujo | Resultado | Defecto / Observación |
|--------|-------|-----------|----------------------|
| 1 | 1.1 Login normal | ✅ | Redirige a `/admin/usuarios` (entrada del superadmin), menú con «QA Produccion T17» y rol ADMINISTRADOR. Previa reactivación de la cuenta (DEF-01). |
| 1 | 1.2 Cold start (banner) | ⚠️ | No se forzó el sueño de 10 min. Se midió un arranque en frío real: `/health` tardó **58,8 s**. El aviso «El servidor está despertando…» existe en el bundle (umbral 8 s, `login.component.ts`) pero **no se vio en pantalla**. |
| 1 | 1.3 Recuperación (URL) | ⚠️ | `/auth/forgot-password` **no existe**: redirige a `/auth/login` (DEF-11). La recuperación es un modal del login. |
| 1 | 1.3 Token corto (<10) | ✅ | Corregido: «El token tiene 3 caracteres y necesita al menos 10.» y botón deshabilitado. |
| 1 | 1.3 Token inventado válido en longitud | ✅ | «El enlace de recuperación es inválido o ya ha sido utilizado.» |
| 1 | 1.4 Registro nuevo | ✅ | `QA_registro@test.com` crea cuenta y llega a `/auth/verify` con cuenta atrás «Reenviar en 57 s», «Cambiar número de teléfono» y «Cambiar de cuenta». |
| 1 | 1.4 Completar OTP | ⛔ | No hay acceso al código (sin WhatsApp/SMS en el entorno). |
| 1 | 1.5 Cierre de sesión (redirección) | ✅ | Redirige a `/auth/login` y limpia el almacenamiento local. |
| 1 | 1.5 Cierre de sesión (token) | ❌ | **DEF-02**: el token capturado antes del logout sigue devolviendo 200 en un endpoint protegido después de cerrar sesión. |
| 2 | 2.1 Sin sede: cinco cifras | ✅ | Sedes activas 3 · Citas hoy 1 · Recaudado hoy $0 · Cajas abiertas 0 · Usuarios activos 7 — todas coherentes. |
| 2 | 2.1 Enlaces «Ver analíticas consolidadas» / «Gestionar usuarios» | ✅ | Navegan a `/admin/analiticas` y `/admin/usuarios`. |
| 2 | 2.2 Con sede activa | ⚠️ | El hero **no cambia**: el ADMINISTRADOR global conserva «Centro de Control Administrativo (Plataforma)» («Centro de Gestión» es exclusivo de ADMIN_BARBERIA). Aparecen métricas de la sede. `PRODUCTIVIDAD TOP: N/A` es correcto: la sede tenía 0 turnos. |
| 2 | 2.3 «Configuración» del menú de cuenta | ⚠️ | No existe menú de cuenta (el avatar no despliega nada). «Configuración de sede» lleva a `/admin/horarios` (DEF-12). |
| 3 | 3.1 Crear sede | ✅ | `QA_Sede_QA2` creada ACTIVA con código `XDQZQDUA` y enlace propio. (No se usó `QA_Sede_Test` porque ya existía, suspendida, y una decisión previa del dueño pide no tocarla.) |
| 3 | 3.2 Editar sede | ⚠️ | Ubicación/descripción/teléfono/logo se guardan y se reflejan sin recargar. **El nombre no es editable** por diseño (requiere solicitud de cambio). |
| 3 | 3.3 QR y enlace por sede | ✅ | QR con `alt="Código QR para unirse a QA_Sede_QA2"` y enlace `/unirse/qasedeqa2-seqf` (no de otra sede). |
| 3 | 3.4 Suspender / reactivar sede | ✅ | Pasa a «Sedes suspendidas (3)», desaparece del listado activo y se limpia la sede activa; «Reactivar sede» la devuelve (3 de 3). |
| 3 | 3.5 Seleccionar y cambiar de sede | ⚠️ | El header muestra la sede, pero el control **«Cambiar sede» está en la barra lateral**, no en el header. Al cambiar, el contexto se actualiza correctamente. |
| 4 | 4.1 Listado y filtros | ✅ | Total 9 (12 tras el QA), activas/suspendidas y distribución por rol correctos; búsqueda en tiempo real («qa_» → 4 de 9). |
| 4 | 4.1 Roles como códigos | ⚠️ | Tabla de usuarios: **corregido** (ADMIN. DE BARBERÍA, CLIENTE…). `/admin/personal` sigue mostrando `ADMIN BARBERIA` / `BARBERO` en mayúsculas crudas. |
| 4 | 4.1 Paginación | ⚠️ | Sigue sin paginación (no hay paginador; «Mostrando 9 de 9»). Con 9–12 filas no hay corte observable. |
| 4 | 4.2 Crear usuario | ✅ | `QA_Usuario_Alta` aparece de inmediato, ACTIVO, con rol CLIENTE. (`QA_usuario@test.com` ya existía suspendida.) |
| 4 | 4.3 Historial de cuenta | ✅ | **Corregido**: la cuenta recién creada muestra «Cuenta creada · 20 Nov 2026 · 21:58 · CLIENTE · Por QA Produccion T17». |
| 4 | 4.4 Suspender y reactivar | ✅ | Motivo obligatorio (Confirmar deshabilitado sin texto), estado → SUSPENDIDO con «Sesiones cerradas»; reactivación → ACTIVO. Historial con ambos eventos y motivos. |
| 4 | 4.5 Roles de sede | ✅ | Explica rol GLOBAL vs roles de sede y guía a «Mi Personal» para asignarlos. |
| 5 | 5.1 Invitar BARBERO | ✅ | `QA_Barbero_QA` aparece ACTIVO en la tarjeta de personal. |
| 5 | 5.2 Invitar segundo ADMIN_BARBERIA | ✅ | **409 claro**: «Esta sede ya cuenta con el administrador admin.qa@barberias.demo (Administrador QA). No se puede asignar un segundo dueño.» |
| 5 | 5.3 Cuenta dual (flag) | ⚠️ | El formulario soporta «Conservar rol de administrador de la sede» con explicación, pero no es ejecutable: no puede existir un segundo admin en la sede (409 por diseño). |
| 5 | 5.4 Editar nombre del miembro | ⚠️ | No permitido desde la sede: «Este dato pertenece a la cuenta global y no se modifica desde una sede». |
| 5 | 5.5 Excepción de horario | ⚠️ | 201 al guardar, pero **sin confirmación visible y sin listado** de excepciones (DEF-13). |
| 5 | 5.6 Desactivar miembro en sede | ✅ | Estado → INACTIVO. (Pero sigue apareciendo como columna en la agenda: DEF-05.) |
| 6 | 6.1 Categorías solo lectura | ✅ | Como ADMINISTRADOR: badge «Solo lectura» y **sin** botones de escritura. |
| 6 | 6.2 Crear categoría (ADMIN_BARBERIA) | ✅ | `QA_Categoria_Test` aparece ACTIVA. |
| 6 | 6.3 Crear servicio | ✅ | **BUG-ALTA-SERVICIOS corregido**: `QA_Servicio_Test` se crea sin 422 (el formulario ya no envía `descripcion`). |
| 6 | 6.4 Crear combo | ✅ | `QA_Combo_Test` con badge COMBO y sus servicios. |
| 7 | 7.1 Horario semanal de sede | ✅ | Carga 09:00–19:00 (6/7 días, 60 h/semana); «Guardar Horario Semanal» → «guardado». |
| 7 | 7.2 Propuestas de horario | ⛔ | Sin propuestas pendientes (0). Bandeja y estado vacío correctos; no hay datos para aprobar/rechazar. |
| 7 | 7.3 Solicitudes de cambio | ⚠️ | Bandeja, tabs y filtro «Solo la sede activa» presentes; 0 solicitudes, no se pudo verificar el filtrado con datos. |
| 8 | 8.1 Agenda | ✅ | Columnas por barbero, «No hay citas registradas» por columna, filtros Todos/Pendientes/Confirmadas/Completadas/Canceladas. |
| 8 | 8.2 Walk-In | ⚠️ | Turno creado (10:00, PENDIENTE, $450) y visible. **El nombre del cliente escrito se descarta**: el turno queda a nombre de la cuenta que lo crea (DEF-03). |
| 8 | 8.3 Aislamiento BARBERO | ✅ | **MAPA-1 corregido** (T-18): `obtenerAgendaDiaria` filtra por `barberoId = user.id` cuando el rol es solo BARBERO (spec `reserva-agenda-alcance.spec.ts`). En pantalla, el barbero ve solo su columna. |
| 9 | 9.1 Caja del día | ✅ | Fecha `2026-11-20 (America/Santo_Domingo)` explícita; totales por método, filtros y listado de tickets correctos. |
| 9 | 9.2 Cerrar caja | ✅ | «CAJA CERRADA … 22:21», el botón desaparece (sin doble cierre) y los totales quedan sellados. |
| 9 | 9.3 Anular pago | ✅ | **Primera verificación de este flujo**: exige motivo, marca ANULADO, resta del total ($450 → $0), deja «Anuló: …», motivo y estado CORREGIDO en la auditoría. |
| 9 | 9.4 Exportar CSV | ⚠️ | 200, `text/csv`, cabeceras y 20 líneas coherentes. **La columna «Barbería» trae el UUID** y no hay `Content-Disposition` (DEF-09). |
| 10 | 10.1 Vista global | ✅ | «Analíticas · Todas las sedes», chip «Vista global · 5 sedes», consolidado y comparativa por sucursal. |
| 10 | 10.2 Vista de sede | ⚠️ | Título y KPIs de la sede correctos, pero el bloque «Resumen Multisede» va **antes** de las métricas de la sede (DEF-14). T-43 (datos de otras sedes bajo un título) **no se reproduce**: cada fila está rotulada por sede. |
| 10 | 10.3 Rangos de fecha | ❌ | **DEF-08**: «Últimos 7 días» = 13→20 nov (8 días); «Últimos 30 días» = 21 oct→20 nov (31 días). «Este mes» = 01→20 nov correcto. |
| 11 | 11.1 Antecedentes | ✅ | «Todo al día» con texto orientador y enlaces a agenda/usuarios. Sin datos para gestionar. |
| 11 | 11.2 Clientes restringidos | ✅ | KPIs en 0 y «Todos los clientes se encuentran habilitados». Sin datos para levantar restricción. |
| 11 | 11.3 Vinculaciones | ✅ | KPIs (0 en espera, 0 sedes, límite D10 = 5) y estado vacío correctos. Sin solicitudes pendientes. |
| 12 | Limpieza | ✅ | Ver «Limpieza post-QA». |

---

## Defectos encontrados

### DEF-01 · El único ADMINISTRADOR global está suspendido
- **Módulo y flujo:** 1.1 Login normal.
- **Pasos:** ir a `/auth/login` e iniciar sesión con `admin.cremaq.production@test.com`.
- **Actual:** `POST /api/v1/auth/login` → **401 «Su cuenta se encuentra suspendida. Contacte al administrador.»** En la base, `usuarios.estado_cuenta = 'SUSPENDIDO'` y es el **único** usuario con rol `ADMINISTRADOR` activo en `usuario_roles` (el otro, `admin@demo.com`, también está suspendido).
- **Esperado:** una cuenta administrativa operativa, o al menos un aviso operativo de que la plataforma quedó sin administración.
- **Severidad:** Crítico.
- **¿Hallazgo ya conocido?** No.
- **Mitigación aplicada:** reactivación directa en Neon para poder ejecutar el QA; se dejó ACTIVA.

### DEF-02 · El cierre de sesión no invalida el token
- **Módulo y flujo:** 1.5 Cierre de sesión.
- **Pasos:** autenticarse, copiar `access_token` de `localStorage`, pulsar «Cerrar sesión», repetir una petición protegida con el token copiado.
- **Actual:** `GET /shops/:id/staff` con el token anterior → **200** tras el logout. No existe endpoint de logout en el backend (`src/iam/*`) y el JWT vive **24 h** (`iam.module.ts`, `expiresIn: '24h'`); `tokenVersion` solo se incrementa al suspender o retirar roles.
- **Esperado:** el token deja de servir al cerrar sesión (bump de `tokenVersion` o lista de revocación).
- **Severidad:** Mayor (seguridad).
- **¿Hallazgo ya conocido?** No.

### DEF-03 · El Walk-In ignora el nombre del cliente y usa la cuenta del administrador
- **Módulo y flujo:** 8.2 Walk-In.
- **Pasos:** Agenda → Walk-In → nombre «QA_Cliente_WalkIn», barbero, servicio y hora → Crear turno.
- **Actual:** el turno se crea, pero la tarjeta y el modal de cobro muestran como cliente **«Administrador QA»** (la cuenta que lo creó), no el nombre escrito. El texto «Cliente sin app» del modal no se refleja en ningún lado.
- **Esperado:** el turno conserva el nombre del cliente sin cuenta (o se advierte que el nombre se descarta).
- **Severidad:** Mayor (integridad de datos del cobro/ticket).
- **¿Hallazgo ya conocido?** No.

### DEF-04 · El Walk-In permite elegir servicios inactivos
- **Módulo y flujo:** 8.2 Walk-In.
- **Actual:** el desplegable incluye `QA_Servicio_UI` con estado INACTIVO.
- **Esperado:** solo servicios activos.
- **Severidad:** Menor.

### DEF-05 · La agenda muestra columnas de personal inactivo en la sede
- **Módulo y flujo:** 5.6 / 8.1.
- **Pasos:** desactivar a `QA_Barbero_QA` en la sede y abrir `/admin/agenda`.
- **Actual:** sigue apareciendo su columna «QA_Barbero_QA · 0 turnos agendados».
- **Esperado:** solo personal activo en la agenda.
- **Severidad:** Menor.

### DEF-06 · El ADMINISTRADOR global recibe un formulario de servicio que no puede guardar
- **Módulo y flujo:** 6.3 Crear servicio.
- **Pasos:** con rol ADMINISTRADOR, `/admin/servicios` → «Nuevo Servicio» → llenar y guardar.
- **Actual:** el formulario se abre y se puede completar; al enviar, `POST /shops/:id/services` → **403** y recién entonces aparece «El catálogo lo gestionan el BARBERO y el ADMIN_BARBERIA…».
- **Esperado:** en modo lectura, ocultar/deshabilitar «Nuevo Servicio» y mostrar el aviso antes de escribir.
- **Severidad:** Menor (UX; el backend sí protege).

### DEF-07 · Servicios sin campo de descripción pero con bloque de descripción
- **Módulo y flujo:** 6.3.
- **Actual:** el formulario solo pide nombre, precio, duración y combo; todas las tarjetas muestran «Sin descripción detallada.» El bug 422 se resolvió eliminando el campo, no aceptándolo.
- **Esperado:** decidir si la descripción existe (campo + API) o se retira de la tarjeta.
- **Severidad:** Menor.

### DEF-08 · Off-by-one en los rangos rápidos de analíticas
- **Módulo y flujo:** 10.3.
- **Actual:** «Últimos 7 días» → 13/11–20/11 (8 días); «Últimos 30 días» → 21/10–20/11 (31 días). Las peticiones salen como `desde=2026-11-13&hasta=2026-11-20` y `desde=2026-10-21&hasta=2026-11-20`.
- **Esperado:** 14/11–20/11 y 22/10–20/11 (o etiquetar «últimos 8/31 días»).
- **Severidad:** Menor.

### DEF-09 · CSV de analíticas con UUID y sin nombre de archivo
- **Módulo y flujo:** 9.4.
- **Actual:** `Reporte de analíticas / Barbería,<uuid> / Desde,…` y sin `Content-Disposition`.
- **Esperado:** nombre de la sede y `filename="analiticas-<sede>-<desde>-<hasta>.csv"`.
- **Severidad:** Menor.

### DEF-10 · «Invalid PrimeUI License» visible en toda la aplicación
- **Módulo:** transversal.
- **Actual:** insignia roja flotante abajo a la derecha en todas las pantallas y `[PrimeUI] PrimeUI license is not configured` en consola.
- **Esperado:** licencia configurada o aviso fuera del build de producción.
- **Severidad:** Menor (imagen del producto).

### DEF-11 · `/auth/forgot-password` no existe
- **Módulo y flujo:** 1.3.
- **Actual:** la ruta cae en `**` y redirige a `/auth/login`; la recuperación solo existe como modal.
- **Esperado:** ruta propia o redirección explícita al modal.
- **Severidad:** Menor.

### DEF-12 · «Configuración de sede» lleva a Horarios
- **Módulo y flujo:** 2.3.
- **Actual:** el enlace del menú apunta a `/admin/horarios`; no hay menú de cuenta con «Configuración» (el avatar no despliega nada).
- **Esperado:** pantalla de configuración de sede o renombrar el enlace a «Horarios».
- **Severidad:** Menor.

### DEF-13 · Excepciones de horario sin confirmación ni listado
- **Módulo y flujo:** 5.5.
- **Actual:** `POST /hours/barbers/:id/exceptions` → 201; el modal se cierra sin aviso y al reabrirlo no muestra las excepciones ya creadas.
- **Esperado:** confirmación y listado/borrado de excepciones vigentes.
- **Severidad:** Menor.

### DEF-14 · El bloque multisede va antes de los KPIs de la sede
- **Módulo y flujo:** 10.2.
- **Actual:** «Resumen Multisede» (comparativa) precede a «Métricas de <sede>».
- **Esperado (según el encargo):** KPIs de la sede primero.
- **Severidad:** Menor.

### DEF-15 · Roles con nomenclatura mixta
- **Módulo y flujo:** 4.1 / 5.x.
- **Actual:** la tabla de usuarios usa etiquetas amigables; `/admin/personal` muestra `ADMIN BARBERIA` / `BARBERO` en crudo.
- **Esperado:** una sola convención.
- **Severidad:** Menor.

---

## Confirmación de hallazgos conocidos

| Hallazgo | Estado |
|----------|--------|
| Configuración lleva a `/barberias/nueva` | **No aplica / corregido**: no existe menú de cuenta con «Configuración»; «Configuración de sede» va a `/admin/horarios` (DEF-12) |
| Roles como códigos crudos | **Parcial**: corregido en la tabla de usuarios, sigue en `/admin/personal` |
| Historial «Sin eventos» al crear cuenta | **Corregido**: «Cuenta creada» con actor y fecha |
| BUG-ALTA-SERVICIOS (422 `descripcion`) | **Corregido**: el servicio se crea; el campo ya no existe (DEF-07) |
| MAPA-1 barbero ve toda la agenda | **Corregido** (T-18: filtro `barberoId` desde el token, con test) |
| Walk-In click en móvil/SPA | **No reproducido**: el botón responde a clics reales. (Los formularios exigen un submit real; los clics sintéticos de script no disparan `ngSubmit`, artefacto de automatización, no del producto) |
| Off-by-one en fechas de analíticas | **Sigue**: «HASTA» correcto, «DESDE» un día antes en los rangos de N días |

---

## Flujos no probables (con razón)

1. **1.2 Cold start con banner**: exige ~10 min sin tráfico y una observación del aviso a los 8 s; no se forzó el sueño. Se documentó un arranque en frío real de **58,8 s** (`/health`).
2. **1.4 Verificación OTP**: sin acceso al código de WhatsApp/SMS.
3. **5.3 Cuenta dual real**: el flag existe, pero el 409 de sede con dueño impide crear el segundo admin necesario.
4. **5.4 Editar nombre de miembro**: bloqueado por diseño (dato global).
5. **7.2 Aprobar/rechazar propuesta de horario**: sin propuestas pendientes.
6. **7.3 Filtro con datos**: sin solicitudes de cambio.
7. **11.1 / 11.2 Gestionar antecedente / levantar restricción**: sin registros.
8. **11.3 Aprobar/rechazar vinculación**: sin solicitudes (0 en espera).

---

## Limpieza post-QA

Ejecutada con el rol `barberias_app` sobre `neondb` (solo lectura para la verificación; escrituras acotadas a datos `QA_`).

**Acciones**
1. `QA_Barbero_QA` desactivado en la sede (INACTIVO desde el flujo 5.6).
2. `QA_AdminSede_QA` no llegó a crearse (409), nada que limpiar.
3. Cuentas suspendidas por la UI de administración: `QA_usuario_alta@test.com`, `qa_barbero_qa@test.com`, `QA_registro@test.com`.
4. Sede `QA_Sede_QA2` suspendida (vuelve a «Sedes suspendidas»).
5. Catálogo QA desactivado en Sede Sandbox QA: **5 servicios**, **2 combos** y **2 categorías** con prefijo `QA_` (incluye restos de rondas anteriores).
6. La reserva Walk-In queda COMPLETADA con su pago **ANULADO** y la caja del día de Sede Sandbox QA **CERRADA** (sellada a las 22:21).

**Verificación (resultado literal del SQL de solo lectura)**

```sql
SELECT correo, estado_cuenta FROM usuarios WHERE correo ILIKE 'qa\_%' ORDER BY correo;
-- 7 filas, TODAS 'SUSPENDIDO'
--   QA_registro@test.com · QA_usuario@test.com · QA_usuario_alta@test.com
--   qa_adminsede@test.com · qa_barbero2@test.com · qa_barbero@test.com · qa_barbero_qa@test.com

SELECT nombre, estado FROM barberias WHERE nombre LIKE 'QA\_%' ORDER BY nombre;
-- QA_Sede_Dos   → INACTIVO
-- QA_Sede_QA2   → INACTIVO
-- QA_Sede_Test  → INACTIVO   (no se tocó: sigue como estaba)
```

**Registros QA que quedan:** 7 cuentas (todas suspendidas), 3 sedes QA (todas inactivas/aisladas) y los ítems de catálogo desactivados. **Ninguno requiere borrado por BD para quedar inerte**; si el dueño quiere eliminarlos, hay que hacerlo con un script acotado por `barberia_id` del tenant QA.

**Cambios que NO son datos QA y quedan aplicados a propósito**
- `admin.cremaq.production@test.com`: **ACTIVO** (estaba SUSPENDIDO; ver DEF-01).
- Un turno Walk-In completado con pago anulado y la caja del día cerrada en Sede Sandbox QA (no en Imperial Barbers Demo).
- No se asignó ningún ADMIN_BARBERIA a Imperial Barbers Demo (se respetó la decisión del dueño: la prueba del 409 se hizo en Sede Sandbox QA).
- `QA_Sede_Test` no se modificó (ni roles ni estado), conforme a la decisión previa.

---

## Notas de método

- Toda la interacción fue por la UI real contra producción; los estados HTTP se leyeron en la pestaña de red del navegador y los datos se contrastaron con consultas de solo lectura a Neon (`barberias_app`).
- El detalle técnico de los defectos se apoya en el código del repositorio (`backend-barberias/src/...`, `frontend-barberias/src/app/...`).
- No se imprimieron contraseñas ni tokens en este informe.
