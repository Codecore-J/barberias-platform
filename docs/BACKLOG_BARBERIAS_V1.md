# BACKLOG MAESTRO V1 — Plataforma de Gestión de Barberías

**Versión 1.0 · 1 de octubre de 2026**
**Fuentes de verdad del diseño:** `00_Informe_Revision_Coherencia.pdf`, `01_Especificacion_Funcional_Reglas_Negocio.pdf`, `02_Arquitectura_Tecnica_BaseDatos_API.pdf`.
**Precedencia:** donde este documento define una decisión `D##`, esa decisión manda sobre los PDF. Los PDF no se editan; sus actualizaciones van en la tarea E2-01.

---

## 0. Cómo usar este documento

**Dueño del producto:** pasa al agente UNA tarea por vez con este mensaje:
"Ejecuta la tarea `<ID>` de BACKLOG_BARBERIAS_V1.md. Lee antes las secciones 1 a 8. Sigue el protocolo de la sección 8. Entrega el informe con la plantilla de la sección 8.4 y detente."

**Agente:** las secciones 1 a 8 son el contexto común y aplican a todas las tareas. Cada tarea es autocontenida, pero no repite ese contexto. Una tarea = una rama = un pull request. Si algo de la tarea contradice el código real, NO lo resuelvas en silencio: repórtalo y espera instrucciones.

**Prioridad:** P0 = seguridad o bloqueante. P1 = núcleo de la V1. P2 = completa la V1.
**Tamaño:** S = hasta medio día. M = 1 a 2 días. L = 3 a 5 días.
**Estado de las casillas:** `[ ]` pendiente.

---

## 1. El producto en breve

Plataforma multi-barbería. Cada cliente tiene UNA cuenta global y se vincula a hasta 5 barberías (la 6ª requiere aprobación del administrador de la plataforma). Solo una barbería está activa a la vez. Las reservas son INDIVIDUALES o GRUPALES (1 adulto responsable + 1 o más niños). Cada barbería opera en modo MANUAL (el responsable acepta, rechaza o propone otro horario; temporizador de 10 minutos controlado por el servidor) o AUTOMÁTICO (confirmación inmediata). El pago es en persona: la plataforma nunca almacena tarjetas. Los antecedentes de un cliente pueden compartirse entre barberías sin revelar la barbería de origen ni el autor. Toda operación importante se audita (retención de 1 año).

**Alcance V1 (D06):** hay UN responsable por barbería. La gestión de personal (altas y bajas de barberos) y el rol `BARBERO` como staff son de V2. Reportes, WhatsApp, SMS y permisos granulares también quedan fuera de V1.

---

## 2. Entorno y stack

- Monorepo `Codecore-J/barberias-platform`: `backend-barberias/` y `frontend-barberias/`.
- Backend: NestJS 11, TypeScript, Prisma, PostgreSQL en Neon (con pooler), BullMQ + Redis (Upstash), Vitest para tests.
- Frontend: Angular 19, Tailwind, PrimeNG.
- Despliegue: Render (backend, región Ohio), Vercel (frontend), Neon (us-east-2).
- Máquina del desarrollador: Windows con PowerShell. No existen `grep` ni `sed`: usa `git grep`, `Select-String` y comandos de PowerShell. Node 20.
- Rutas del API: se mantienen en español (D34). Las rutas del PDF 02 sección 5 (`/shops`, `/reservations`) son referenciales.

---

## 3. Principios no negociables

1. **El backend es la autoridad.** El frontend solo presenta. Ninguna regla se valida solo en el cliente.
2. **Privacidad entre barberías.** Una barbería nunca lee el historial privado de otra ni sabe quién creó un antecedente compartido.
3. **Protección histórica.** Una reserva confirmada conserva precio, duración y margen del momento de la confirmación (snapshot).
4. **Vocabulario estricto.** DESACTIVAR (deja de usarse, conserva historial, reversible) ≠ CANCELAR (cambia el estado de una reserva) ≠ DESVINCULAR (termina una relación, conserva historial) ≠ ELIMINAR (borrado definitivo según política). Nunca borrado físico para representar un cambio de estado.
5. **La disponibilidad se calcula, nunca se almacena.**
6. **Los temporizadores los controla el servidor.** Empiezan cuando el cliente envía la solicitud, no cuando el barbero la abre.
7. **Fail-closed.** Todo endpoint declara explícitamente `@Public()`, `@Autenticado()` o `@Roles(...)`. Sin decorador, se deniega.
8. **Todo lo importante se audita** (qué, quién, cuándo, contexto) sin guardar datos sensibles.
9. **Flujo maestro del backend** (spec 01 sección 10): autenticación → autorización → validación de datos → reglas de negocio → comprobación de estado → comprobación de concurrencia → persistencia → auditoría y eventos → notificaciones → respuesta. Si un paso falla, la operación no se ejecuta.

---

## 4. Roles V1 y matriz de permisos

Roles existentes en la tabla `roles`: `ADMINISTRADOR` (ámbito GLOBAL, administrador de la plataforma), `ADMIN_BARBERIA` (ámbito BARBERIA, el responsable de una barbería), `BARBERO` (ámbito BARBERIA, acceso limitado en V1, D16) y `CLIENTE` (ámbito GLOBAL). **`SUPER_ADMIN` no existe y se elimina del código (D05).** Un rol de ámbito BARBERIA SIEMPRE lleva `barberia_id`.

| Acción | CLIENTE | BARBERO (V1 limitado) | ADMIN_BARBERIA | ADMINISTRADOR |
|---|---|---|---|---|
| Registro, login, recuperación | público | público | público | público |
| Crear barbería (límite 2, D04) | sí | sí | sí | sí |
| Editar datos directos de su barbería | No | No | sí (su barbería) | sí |
| Solicitar cambio de nombre o responsable | No | No | sí | resuelve |
| Leer catálogo | sí (barbería vinculada) | sí (su barbería) | sí | sí |
| Crear, editar, desactivar servicios y combos | No | No | sí (su barbería) | sí |
| Horarios, excepciones, bloqueos (escribir) | No | solo `mi-horario` | sí | sí |
| Consultar disponibilidad calculada | sí (vinculado) | sí | sí | sí |
| Crear reserva | sí (vinculado activo, no restringido) | No | No | No |
| Aceptar, rechazar, proponer, cancelar como admin | No | No | sí | sí |
| Registrar atención y pago | No | sí (reservas asignadas) | sí | sí |
| Marcar no presentado (D02) | No | No | sí | sí |
| Antecedentes: proponer | No | sí | sí | sí |
| Antecedentes: evaluar (D35) | No | No | sí | sí |
| Antecedentes: declaración propia (D43) | sí | No | No | No |
| Configuración de la barbería | No | No | sí | sí |
| Auditoría de una barbería | No | No | sí (solo la suya) | sí |
| Auditoría global, purga | No | No | No | sí |
| Aprobar 6ª vinculación, suspender barbería, resolver cambios | No | No | No | sí |

---

## 5. Reservas: estados, transiciones y cálculo

### 5.1 Estados (D08, 8 valores)
`PENDIENTE`, `CONFIRMADA`, `RECHAZADA`, `PROPUESTA_PENDIENTE`, `EXPIRADA`, `NO_PRESENTADO`, `CANCELADA`, `COMPLETADA`. Los siete primeros son los del diseño; `COMPLETADA` se agrega (D03). Terminales: `RECHAZADA`, `EXPIRADA`, `NO_PRESENTADO`, `CANCELADA`, `COMPLETADA`.

### 5.2 Transiciones permitidas
Actores: **C** = cliente dueño, **A** = ADMIN_BARBERIA o ADMINISTRADOR, **S** = sistema.

| Desde | Hacia | Actor | Condición |
|---|---|---|---|
| (creación, modo MANUAL) | PENDIENTE | C | `expira_at` = ahora + 10 min |
| (creación, modo AUTOMATICO) | CONFIRMADA | C | revalidación inmediata, sin temporizador |
| PENDIENTE | CONFIRMADA | A | temporizador vigente; revalida disponibilidad |
| PENDIENTE | RECHAZADA | A | motivo estructurado obligatorio |
| PENDIENTE | PROPUESTA_PENDIENTE | A | nuevo horario disponible; 10 min para el cliente |
| PENDIENTE | EXPIRADA | S | pasaron 10 min sin respuesta |
| PENDIENTE | CANCELADA | C | en cualquier momento |
| PROPUESTA_PENDIENTE | CONFIRMADA | C | acepta la propuesta (revalidada) |
| PROPUESTA_PENDIENTE | CANCELADA | C | rechaza la propuesta (D08) |
| PROPUESTA_PENDIENTE | EXPIRADA | S | pasaron 10 min |
| CONFIRMADA | COMPLETADA | A | desde `hora_inicio`, al registrar la atención |
| CONFIRMADA | NO_PRESENTADO | A | ahora ≥ inicio + 15 min (5 de margen + 10 de tolerancia) |
| CONFIRMADA | CANCELADA | C | hasta 30 min antes del inicio |
| CONFIRMADA | CANCELADA | A | motivo obligatorio |
| CONFIRMADA | CANCELADA | A | aprueba una cancelación especial (D17) |

Cualquier otra transición es inválida y responde 409 `ESTADO_INVALIDO`. Al pasar a `CANCELADA`, `RECHAZADA` o `EXPIRADA` se borra de inmediato la información adicional de la reserva.

### 5.3 Qué ocupa espacio en la agenda (D37)
Ocupan: `CONFIRMADA`, `PENDIENTE`, `PROPUESTA_PENDIENTE` y toda propuesta de horario activa (el espacio propuesto se mantiene reservado hasta que expire). Liberan: `RECHAZADA`, `EXPIRADA`, `CANCELADA`, `NO_PRESENTADO`. `COMPLETADA` pertenece al pasado.

### 5.4 Cálculo del bloque de tiempo
- **Individual (D01):** suma de las duraciones de los servicios elegidos + suma de los márgenes operativos de esos servicios. Un combo aporta su `duracion_propia` + `margen_propio` (no la suma de sus componentes). Ejemplo: 35 + 10 = 45 min.
- **Grupal:** suma de las duraciones de todos los servicios de todos los participantes + UN SOLO margen grupal (D42: el mayor margen operativo entre los servicios incluidos). Ejemplo del diseño: 35 + 30 + 30 + 10 = 105 min. Nunca un margen por participante.
- Cada servicio guarda su snapshot (`precio_historico`, `duracion_historica`, `margen_historico`). En reservas grupales `margen_historico` = 0 y el margen real vive en `reservas.margen_grupal_historico`.

### 5.5 Motivos estructurados (D19)
- Rechazo: `HORARIO_NO_DISPONIBLE`, `SERVICIO_NO_DISPONIBLE`, `RESPONSABLE_AUSENTE`, `CLIENTE_RESTRINGIDO`, `OTRO`.
- Cancelación por el admin: `EMERGENCIA`, `ENFERMEDAD`, `CIERRE_IMPREVISTO`, `FUERZA_MAYOR`, `OTRO`.
- `OTRO` exige un detalle de al menos 5 caracteres. Todos guardan `motivo_codigo` y `motivo_detalle`.

---

## 6. Decisiones de diseño vigentes

Las D01 a D13 son del plan estratégico; las D14 en adelante se agregaron al armar este backlog.

| ID | Decisión |
|---|---|
| D01 | Margen individual con varios servicios: se suma el de cada servicio. |
| D02 | El no presentado lo marca el admin (ADMIN_BARBERIA o ADMINISTRADOR), solo pasados los 15 minutos. |
| D03 | Se añaden el estado `COMPLETADA` y `barberias.zona_horaria`. |
| D04 | Cualquier usuario autenticado puede crear barberías: límite 2 por responsable, sin aprobación previa, con límite de peticiones y auditoría. El ADMINISTRADOR puede dejarlas `INACTIVO`. |
| D05 | El rol global es solo `ADMINISTRADOR`. `SUPER_ADMIN` se elimina. |
| D06 | V1 = un responsable por barbería. Personal y `BARBERO` como staff pasan a V2. |
| D07 | Autorización por roles en V1. Los permisos granulares (`permisos`, `rol_permisos`) se aplazan. |
| D08 | Estados y transiciones de la sección 5. |
| D09 | `usuarios.estado_cuenta` solo `ACTIVO`, `SUSPENDIDO`, `ELIMINADO`. |
| D10 | `cliente_barberias.estado_vinculacion`: `ACTIVO`, `PENDIENTE_APROBACION` (la 6ª), `DESVINCULADO`. |
| D11 | Entornos: `dev` (rama Neon para tu PC y E2E), `staging` (la base actual) y producción nueva y limpia al lanzar. |
| D12 | Notificaciones: canal APP real primero. WhatsApp y SMS cuando se elija proveedor. |
| D13 | Reportes aplazados hasta aclarar si son incidencias o métricas. |
| D14 | Columnas de estado = `VARCHAR` + `CHECK`. Constantes TypeScript en una sola fuente (`src/shared/domain/estados.ts`). Los enums de Prisma sin uso real se eliminan. |
| D15 | Zona horaria con `luxon`. Fecha y hora de cita son locales a la barbería; los instantes (`expira_at`, `creado_at`) son UTC (`TIMESTAMPTZ`). Un servicio central de tiempo con reloj inyectable. |
| D16 | `BARBERO` en V1: lee su agenda, registra atención y pago de reservas asignadas y edita `mi-horario`. Sin catálogo, configuración ni no presentado. |
| D17 | Cancelación especial: bandera `configuracion_barberia.permite_cancelacion_especial` (por defecto falso). La solicitud se guarda en columnas de `reservas`; el admin resuelve. |
| D18 | Tabla `propuestas_horario` para propuestas y reprogramaciones, con retención del espacio (D37). |
| D19 | Catálogo de motivos de la sección 5.5. |
| D20 | La restricción por no presentados persiste al desvincular y revincular (no se evade desvinculándose). |
| D21 | Revincular reactiva la MISMA fila de `cliente_barberias`: historial y contadores intactos. |
| D22 | Oportunidades de espacio: se disparan al cancelarse una reserva CONFIRMADA o liberarse un bloqueo. Elegibles: vinculación ACTIVO y barbería activa, sin restricción, sin reserva confirmada solapada, y que no canceló ese espacio. Máximo 25 destinatarios, sin duplicados. |
| D23 | Bloqueo temporal de cuenta: 5 inicios de sesión fallidos en 15 minutos bloquean 15 minutos. |
| D24 | `usuarios.token_version` en el JWT permite cerrar sesión en todos los dispositivos. |
| D25 | Imágenes en V1: solo URL HTTPS (`logo_url`, `imagen_url`). La subida de archivos se aplaza. |
| D26 | Tabla `solicitudes_cambio_barberia` para cambios de nombre y responsable. |
| D27 | Cambiar contraseña, correo o teléfono exige la contraseña actual. La verificación por código queda pendiente del proveedor SMS o WhatsApp. |
| D28 | `AuditoriaService.registrar()` único, con catálogo de acciones. Sin contraseñas ni textos sensibles en `contexto`. |
| D29 | Los bloqueos de agenda se liberan (`liberado_at`), no se borran. |
| D30 | `ValidationPipe` global con `whitelist` y `forbidNonWhitelisted`. |
| D31 | bcrypt con 10 rondas se mantiene (decisión de rendimiento PERF-01) y se documenta como desviación del diseño (12). |
| D32 | Listados paginados: `{ data, total, page, pageSize }`. |
| D33 | Jobs de BullMQ idempotentes con `jobId` determinístico y reconciliación al arrancar el servidor. |
| D34 | Las rutas actuales en español se mantienen. |
| D35 | Evalúa antecedentes el ADMIN_BARBERIA de la barbería (comportamiento actual). El diseño dice "el administrador" sin precisar. |
| D36 | El primer ADMINISTRADOR se crea con un script seguro (contraseña desde el entorno). Los roles se siembran con un seed idempotente. |
| D37 | Qué ocupa espacio: sección 5.3. |
| D40 | Contrato de errores: `{ statusCode, codigo, mensaje }`. 400 validación, 401 sin sesión, 403 sin permiso, 404 no existe, 409 conflicto (concurrencia o `ESTADO_INVALIDO`), 422 regla de negocio violada. |
| D41 | Los horarios disponibles se ofrecen en pasos de 15 minutos (constante configurable). |
| D42 | Margen grupal = el mayor margen operativo entre los servicios incluidos. |
| D43 | La declaración del cliente (antecedente de origen CLIENTE) es visible solo para barberías donde está vinculado, siempre etiquetada "declaración del cliente, no diagnóstico", y no pasa por aprobación. |
| D44 | Existe un endpoint de cotización (`/reservas/cotizar`) para que el frontend nunca calcule bloques ni precios. |

**Códigos de error de negocio (`codigo`):** `ESTADO_INVALIDO`, `SOLICITUD_EXPIRADA`, `FUERA_DE_VENTANA`, `CONFLICTO_HORARIO`, `CLIENTE_RESTRINGIDO`, `NO_VINCULADO`, `LIMITE_BARBERIAS`, `LIMITE_VINCULACIONES`, `GRUPAL_NO_DISPONIBLE`, `HAY_PENDIENTES`, `RESERVAS_PAUSADAS`, `FUERA_DE_HORIZONTE`.

---

## 7. Estado real del sistema hoy (resumen de la auditoría)

- **Funciona:** autenticación, recuperación de contraseña, límite de peticiones, CORS, health, helper de concurrencia SERIALIZABLE con reintentos (409 en 40001), índice único parcial de una barbería activa, snapshots históricos, detección de ciclos en combos, antecedentes con anonimización, pago en persona con auditoría atómica, `RolesGuard` global (H16, commit 72531e9), 134 pruebas unitarias en verde.
- **Seguridad:** `RolesGuard` deja pasar toda ruta sin `@Roles` (unas 30 de 52 a 54, conteo aproximado por regex). H18 auditoría sin filtro para ADMIN_BARBERIA, H19 `/barberias/:id/personal` abierta, H20 `agenda/bloqueos` sin validar acceso. 3 filas `ADMIN_BARBERIA` con `barberia_id` nulo; el guard trata el nulo como comodín. `SUPER_ADMIN` no existe en la base pero el código lo usa. Cualquier usuario crea barberías sin límite (38 en staging). H17 solo parcialmente resuelto en el frontend.
- **Datos:** sin `CHECK` ni `ENUM` en la base (todo `VARCHAR`). Los enums de Prisma no coinciden con el diseño ni con los datos (`EXPIRADA` existe en datos). Sin zona horaria: `disponibilidad.service` usa `fecha.getDay()` del servidor. Solo 2 migraciones registradas en el repo más una borrador (`fix_missing_tables`); el esquema se aplicó con `db push`.
- **Reglas del diseño ausentes:** reserva grupal, propuesta de horario, cancelación por el cliente, ventana de 15 minutos del no presentado, advertencia a los 3, rechazo con motivo, aprobación de la 6ª vinculación, desvincular, configuración, adelanto y reprogramación, información adicional, oportunidades de espacio, solicitudes de cambio de nombre y responsable, sesiones seguras, recordatorio de 1 hora.
- **Infraestructura:** una sola base Neon sirve para desarrollo, E2E y despliegue. Sin CI. Render y Vercel despliegan solos al hacer push a `main`. Un E2E falla por conflicto de serialización. Sin backups verificados ni alertas. 80 usuarios de prueba en la base, 4 con rol global.
- **Frontend:** 15 rutas, 16 componentes. Los roles administrativos se agrupan bajo `'ADMIN'`. La ficha del cliente llama a una ruta inexistente. Los botones de Personal no hacen nada. 9 pruebas en total.
- **IDs de hallazgo:** H14 y H15 faltan en `AUDITORIA_HALLAZGOS.md` y existen dos "HALLAZGO 09". Los hallazgos nuevos reciben ID provisional al iniciar cada tarea, continuando desde H18.

---

## 8. Protocolo de trabajo (obligatorio)

### 8.1 Reglas
1. **Una tarea, una rama, un PR pequeño.** Nombre de rama indicado en la tarea. Nunca push a `main`.
2. **Cada hallazgo recibe un ID antes de corregirse** en `AUDITORIA_HALLAZGOS.md` (formato `HALLAZGO NN`).
3. **Fix de seguridad o de regla de negocio = test ROJO antes y VERDE después**, con la salida de terminal pegada literal.
4. **Nada contra una base de datos sin aprobación explícita.** Prohibido contra staging o producción: `prisma migrate dev`, `migrate reset`, `db push`, y `DELETE`, `UPDATE`, `DROP` o `TRUNCATE` manuales. Las pruebas destructivas solo corren con `APP_ENV=dev`.
5. **Nunca imprimas ni escribas credenciales, cadenas de conexión, hosts ni contraseñas.** Usa solo variables de entorno.
6. **Salida literal.** Nada de resúmenes de resultados de terminal. Si no pudiste verificar algo, dilo.
7. **No amplíes el alcance.** Si una tarea pide X no entregues además Y. Si ves un problema fuera de alcance, repórtalo como hallazgo nuevo.
8. **No marques `[x]` sin evidencia.** No declares "100 % verde" sin pegar el resumen del test.
9. Mensajes de commit: `tipo(ámbito): descripción` (ej. `fix(sec): RolesGuard falla cerrado`).

### 8.2 Definition of Ready (para empezar una tarea)
Dependencias cerradas, rama creada desde `main` actualizado y `git status --short` limpio.

### 8.3 Definition of Done (para entregarla)
Criterios de aceptación cumplidos con evidencia, tests nuevos en verde, suite unitaria completa en verde, CI en verde, diff completo mostrado, hallazgo documentado y matriz de cumplimiento actualizada si aplica.

### 8.4 Plantilla del informe (obligatoria)

```
TAREA: <ID> — <título>
RAMA: <nombre>
1. QUÉ HICE (5 líneas máximo)
2. ARCHIVOS TOCADOS (git diff --stat, literal)
3. TEST ROJO (antes del fix, salida literal)
4. TEST VERDE (después, salida literal)
5. SUITE COMPLETA: npm run test (resumen literal)
6. CRITERIOS DE ACEPTACIÓN: lista con [x] y la evidencia de cada uno
7. DECISIONES O DESVIACIONES (si las hay, con motivo)
8. HALLAZGOS NUEVOS (ID provisional, severidad, evidencia)
9. PENDIENTE O NO VERIFICADO
10. git status --short / git log -1 --oneline / git log --oneline -5
No hagas merge. Espera aprobación.
```

---

## ÉPICA E0 — CIMIENTOS Y CONTENCIÓN

### E0-01 · Rotar credenciales y limpiar secretos del disco
`P0 · S · Depende: — · Rama: chore/rotar-credenciales`
**Contexto:** la cadena de conexión de Neon (rol `neondb_owner`, con contraseña) estuvo escrita en scripts de scratch del agente y en los logs de la herramienta. Se considera comprometida.
**Estado actual:** el dueño rota la contraseña. Hay seis `.cjs` sin trackear en `backend-barberias/` (`check_roles`, `get_users`, `reset_passwords`, `test_api_access`, `test_api_roles`, `test_login_roles`). `reset_passwords.cjs` fija una contraseña estática a `admin@demo.com`, `barbero@demo.com` y `cliente@demo.com`. No existe `.env.example`.
**Hacer:**
1. (Dueño) Restablecer la contraseña del rol en Neon y actualizar `DATABASE_URL` en Render y en el `.env` local.
2. Listar SOLO NOMBRES de archivo donde aparece la cadena antigua en disco (scratch, scripts, logs) y ejecutar `git log --all --oneline -S"neondb_owner:"` y `git grep -l "neondb_owner:"`. No imprimas contenidos.
3. Proponer (sin aplicar) eliminar los seis `.cjs`. Con aprobación, eliminarlos.
4. Crear `backend-barberias/.env.example` con SOLO los nombres: `DATABASE_URL`, `JWT_SECRET`, `PORT`, `FRONTEND_URL`, `REDIS_URL`, `REDIS_HOST`, `REDIS_PORT`, `NODE_ENV`, `APP_ENV`, `UV_THREADPOOL_SIZE`, `DEBUG_PRISMA`, con valores de ejemplo falsos y un comentario por variable.
5. Confirmar que `.gitignore` excluye `.env`, `.env.*` (menos `.env.example`) y scripts de scratch.
**No hacer:** imprimir secretos; ejecutar nada contra la base.
**Aceptación:**
- [ ] Búsqueda del paso 2 vacía (disco e historial).
- [ ] `/health` del backend responde bien con la contraseña nueva.
- [ ] `.env.example` existe y `.env` está ignorado.
**Evidencia:** salidas del paso 2 y `git status --short`.

### E0-02 · Entornos separados (dev, staging, producción)
`P0 · S · Depende: E0-01 · Rama: chore/entornos`
**Contexto:** hoy el `.env` local, los E2E y el backend desplegado usan la MISMA base Neon. El diseño (PDF 02, sección 6) exige Staging y Producción separados (D11).
**Hacer:**
1. (Dueño) En Neon crear una rama `dev` y poner su cadena en el `.env` local. La base actual pasa a ser `staging` (Render actual). Producción real se crea en L-01.
2. Introducir la variable `APP_ENV` (`dev`, `staging`, `production`) y validarla al arrancar (falla si falta).
3. Crear `assertSafeTestDatabase()` en el setup de los tests de integración y E2E: aborta salvo que `APP_ENV=dev`.
4. Escribir `docs/ENTORNOS.md`: tabla entorno → base → servicio → variables (solo nombres) y la regla "tests destructivos solo en dev".
**No hacer:** apuntar ningún test a staging.
**Aceptación:**
- [ ] Un E2E con `APP_ENV=staging` aborta con mensaje claro (test que lo prueba).
- [ ] `docs/ENTORNOS.md` existe.
**Evidencia:** salida del test de aborto.

### E0-03 · Cuentas de prueba con privilegios
`P0 · S · Depende: E0-02 · Rama: chore/limpiar-cuentas-prueba`
**Contexto:** staging tiene 80 usuarios, todos de prueba salvo posiblemente uno de `gmail.com` (confirmar con el dueño). 4 tienen el rol global `ADMINISTRADOR` (tres `admin_smoke_*` y `admin@demo.com`) con contraseña conocida. Hay 3 usuarios `@t.com` con `ADMIN_BARBERIA` y `barberia_id` nulo. Los filtros `%smoke%`, `%demo%`, `%test%` no alcanzan las cuentas `@t.com`.
**Hacer:**
1. Solo lectura: listar (correo enmascarado, rol, fecha) las cuentas con rol global y las que tengan rol de ámbito BARBERIA sin barbería.
2. Redactar el SQL de desactivación usando `estado_cuenta='SUSPENDIDO'` (D09, nunca `INACTIVO`), con un `SELECT` previo y un conteo esperado. El dueño decide suspender o eliminar y lo ejecuta él en el editor SQL de Neon.
3. Verificar con un test que el login rechaza cuentas `SUSPENDIDO` con el mensaje descriptivo del HALLAZGO 12.
4. Los usuarios demo para presentaciones se recrean en `dev` con el seed de E0-07.
**No hacer:** ejecutar el SQL tú mismo; tocar usuarios no listados.
**Aceptación:**
- [ ] Ninguna cuenta de prueba con rol global puede iniciar sesión en staging.
- [ ] Test del login de cuenta suspendida en verde.
**Evidencia:** conteos antes y después (los pega el dueño).

### E0-04 · Migración base y CI
`P0 · M · Depende: E0-01 · Rama: fix/db-migration-baseline`
**Contexto:** el esquema se aplicó con `db push`. Las tablas `horarios_barbero`, `excepciones_horario_barbero`, `tokens_recuperacion` y las columnas `reservas.barbero_id` y `bloqueos_agenda.barbero_id` no están en las migraciones del repo. La tabla `_prisma_migrations` de staging ya registra `20261001000000_fix_missing_tables` (aplicada con `migrate resolve`), pero esa carpeta solo está en la rama local `wip/sin-revisar` (commit 8891c52). Esa rama también tiene un borrador `.github/workflows/ci.yml`.
**Hacer:**
1. Crear rama desde `main`. Rescatar SOLO la carpeta de la migración y el `ci.yml`. No incluir `src/cliente/`, `diff.sql` ni `missing.sql`.
2. Verificar sobre una base TEMPORAL VACÍA (nunca staging) que las tres migraciones producen un esquema idéntico a `schema.prisma`: `prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url <TEMPORAL> --exit-code`. Pega la salida.
3. Revisar el CI: confirmar que existen los scripts `lint` y `test` en ambos proyectos, que se ejecuta `prisma generate`, y añadir un paso de escaneo de secretos (gitleaks). Los E2E NO corren en CI hasta E2-06.
4. Abrir el pull request y mostrar el CI en verde.
**No hacer:** ejecutar nada contra staging; incluir cambios de código de la aplicación.
**Aceptación:**
- [x] `migrate diff` devuelve código 0 (sin diferencias).
- [ ] El workflow corre en verde en el PR.
- [x] La carpeta de la migración coincide con el nombre registrado en `_prisma_migrations` de staging.
**Evidencia:** `migrate diff` -> `No difference detected.` Confirmado nombre de migración en BD staging (esperando log del CI).

### E0-05 · Protección de `main` y despliegue condicionado
`P0 · S · Depende: E0-04 · Rama: chore/proteger-main`
**Contexto:** Render (`autoDeploy: true`) y Vercel despliegan automáticamente cada push a `main`. Cuatro commits directos del agente ya salieron así. No hay CI que bloquee.
**Hacer:**
1. (Dueño) En GitHub, activar protección de `main`: pull request obligatorio, check de CI requerido, sin push forzado ni borrado.
2. Proponer (sin aplicar) el cambio de `render.yaml` para que el autodeploy espere a que pasen los checks (confirmar la opción exacta en la documentación de Render).
3. Vercel: producción solo desde `main`; los PR generan previews.
4. Escribir `docs/DESPLIEGUE.md` con el procedimiento de reversión (redeploy del despliegue anterior en Render y Vercel).
**No hacer:** cambiar `render.yaml` sin aprobación.
**Aceptación:**
- [ ] Un push directo a `main` es rechazado por GitHub (el dueño lo prueba).
- [ ] `docs/DESPLIEGUE.md` existe.
**Evidencia:** captura o salida del rechazo.

### E0-06 · Triage de la rama `wip/sin-revisar` y registro de hallazgos
`P1 · S · Depende: E0-04 · Rama: docs/triage-wip`
**Contexto:** la rama local `wip/sin-revisar` (commit 8891c52) guarda trabajo no revisado. Decisiones: `src/cliente/` se rechaza (7 defectos, se rehace en E4-05); el cambio de inasistencia para `BARBERO` se rechaza (D02); los botones de Personal con `alert()` se descartan (D06); el duplicado de `return` en `role.guard.ts` se rescata (E1-09); `.github` y la migración van a E0-04.
**Hacer:**
1. Crear `docs/TRIAGE_WIP.md` con una tabla archivo → decisión → tarea destino.
2. Documentar en `AUDITORIA_HALLAZGOS.md`: HALLAZGO 14 (IDOR de reservas, versión completa) y HALLAZGO 15 (notificaciones `ENVIADO` pasa a `SIMULADO`), buscando los commits reales con `git log --all --oneline --grep=`. Si no encuentras un hash escribe "no localizado". Documentar también la colisión de los dos "HALLAZGO 09" sin renumerar nada.
3. Registrar los hallazgos H17 (parcial), H18 a H21 y los de la sección 7 con ID provisional.
**No hacer:** cambiar IDs existentes; borrar la rama sin aprobación.
**Aceptación:**
- [ ] `TRIAGE_WIP.md` cubre todos los archivos de la rama.
- [ ] H14, H15 y la colisión 09 documentados.
**Evidencia:** diff del PR.

### E0-07 · Seed idempotente y primer ADMINISTRADOR
`P1 · M · Depende: E0-04 · Rama: feat/seed-roles-admin`
**Contexto:** una base nueva no tiene roles. En staging existen 4 (`ADMINISTRADOR` GLOBAL, `ADMIN_BARBERIA` BARBERIA, `BARBERO` BARBERIA, `CLIENTE` GLOBAL). Producción empezará limpia (L-01) y no puede depender de scripts con contraseñas fijas (D36).
**Hacer:**
1. `prisma/seed.ts`: `upsert` idempotente de los 4 roles con su `ambito`. Registrarlo en `package.json` (`prisma.seed`).
2. Script `npm run admin:create`: lee `ADMIN_EMAIL` y `ADMIN_PASSWORD` del entorno (mínimo 12 caracteres), crea el usuario con rol `ADMINISTRADOR` global (`barberia_id` nulo), hashea con bcrypt (D31) y NO imprime la contraseña. Si `APP_ENV=production`, exige además `CONFIRM_CREATE_ADMIN=yes`.
3. Seed de demostración solo con `APP_ENV=dev`: usuarios demo con la contraseña tomada de `DEMO_PASSWORD` (variable de entorno).
4. Tests: ejecutar el seed dos veces no duplica roles; el script falla sin variables.
**No hacer:** contraseñas escritas en el código.
**Aceptación:**
- [ ] BD vacía + `migrate deploy` + seed deja 4 roles.
- [ ] El script de admin falla de forma segura sin variables.
**Evidencia:** salida de los tests.

---

## ÉPICA E1 — SEGURIDAD

### E1-01 · RolesGuard que falla cerrado (H21)
`P0 · L · Depende: E0-04 · Rama: fix/h21-guard-fail-closed`
**Contexto:** `backend-barberias/src/iam/infrastructure/roles.guard.ts` devuelve `true` cuando una ruta no tiene `@Roles` (líneas ~21 a 24). Con tres guards globales en `app.module.ts` (Throttler, JwtAuthGuard, RolesGuard), cualquier usuario con sesión accede a todas las rutas sin decorador: unas 30 de 52 a 54 (conteo por regex, impreciso). Principio 7: toda ruta declara explícitamente su política.
**Hacer:**
1. Crear el decorador `@Autenticado()` (metadata propia, junto a `roles.decorator.ts`) para rutas legítimas de "cualquier usuario con sesión" (`/auth/me`, `mis-reservas`, `mis-notificaciones`).
2. Modificar el guard: `@Public` pasa (lo resuelve `JwtAuthGuard`), `@Autenticado` pasa, `@Roles` aplica la lógica actual, SIN ninguno → `ForbiddenException` y un log de advertencia con la ruta.
3. Anotar TODAS las rutas existentes sin decorador con `@Autenticado()` y un comentario `// TODO(E1-05)` para que nada se rompa; E1-05 los reemplaza.
4. Test `route-security.spec.ts`: construir el módulo de la app, recorrer todos los controladores con `DiscoveryService` y `MetadataScanner`, y fallar si algún handler no tiene `@Public`, `@Autenticado` o `@Roles`. Imprimir la tabla exacta de rutas (reemplaza los conteos por regex).
5. Tests unitarios del guard (4 casos: sin decorador, con `@Autenticado`, con `@Roles` válido, con `@Roles` inválido).
**No hacer:** cambiar la lógica de tenant del guard (E1-04) ni los roles de las rutas (E1-05).
**Aceptación:**
- [ ] Test rojo (rutas sin decorador) y luego verde.
- [ ] Una ruta nueva sin decorador hace fallar la suite.
**Evidencia:** conteo exacto de rutas por tipo de decorador.

### E1-02 · Fuga cross-tenant en la auditoría (H18)
`P0 · M · Depende: E1-01 · Rama: fix/h18-auditoria-cross-tenant`
**Contexto:** `GET /auditoria` permite `ADMINISTRADOR`, `SUPER_ADMIN` (inexistente) y `ADMIN_BARBERIA`. `barberiaId` es un parámetro opcional (query o header). Si un `ADMIN_BARBERIA` lo omite, `RolesGuard` cae en la validación global por rol y `auditoria.service` consulta con `where` vacío: devuelve los registros de todas las barberías.
**Hacer:**
1. Antes de corregir, revisar cómo filtra hoy `consultarAuditorias` por barbería (la tabla `auditoria` no tiene `barberia_id`; ver E3-01). Reportarlo.
2. Test E2E ROJO con dos barberías A y B: el admin de A llama sin `barberiaId` y no debe recibir registros de B.
3. Fix: si el usuario NO es `ADMINISTRADOR`, `barberiaId` es obligatorio y debe estar en sus `rolesDetallados` con `ADMIN_BARBERIA`; si no, 403. Nunca un `where` vacío para un no global. El `ADMINISTRADOR` puede omitirlo (vista global).
4. Aplicar el mismo criterio a `GET /barberias/:barberiaId/pagos/auditoria`.
5. Paginación `{ data, total, page, pageSize }` (D32).
**No hacer:** agregar columnas (eso es E3-01).
**Aceptación:**
- [ ] Rojo → verde.
- [ ] Admin de A con `barberiaId=B` recibe 403.
**Evidencia:** salida del test.

### E1-03 · Lecturas abiertas: `personal` y `bloqueos` (H19 y H20)
`P0 · M · Depende: E1-01 · Rama: fix/h19-h20-lecturas-abiertas`
**Contexto:** `GET /barberias/:id/personal` (`barberia.controller.ts`, con el comentario "Ideally check if user has access ... for MVP it's okay") no tiene roles ni validación: cualquier usuario autenticado lista el personal de cualquier barbería. `GET /barberias/:barberiaId/agenda/bloqueos` no llama a `validateAccess` en `agenda.service.obtenerBloqueos`: se leen bloqueos y motivos de barberías ajenas.
**Hacer:**
1. Tests ROJOS por rol (CLIENTE, ADMIN de otra barbería, ADMIN propio).
2. `personal`: `@Roles('ADMIN_BARBERIA')` + validación de pertenencia; el `ADMINISTRADOR` pasa por la regla global. Respuesta sin correo ni teléfono salvo para el admin.
3. `bloqueos`: `@Roles('ADMIN_BARBERIA','BARBERO')` + `validateAccess`; un CLIENTE NUNCA ve bloqueos ni motivos (consulta `disponibilidad`).
4. Quitar el comentario "for MVP".
**No hacer:** tocar otras rutas.
**Aceptación:**
- [ ] Cliente y admin ajeno reciben 403 en ambas rutas.
- [ ] Rojo → verde.
**Evidencia:** salida del test.

### E1-04 · Limpieza de roles: `SUPER_ADMIN` y roles de barbería sin barbería
`P0 · M · Depende: E1-01 · Rama: fix/roles-superadmin-ambito`
**Contexto:** la tabla `roles` tiene 4 roles y NO existe `SUPER_ADMIN`, pero el código lo busca: `@Roles('SUPER_ADMIN')` en `/barberias/all`, `reserva.service.marcarInasistencia` (`isSuperAdmin`), `barberia.service` (PATCH y DELETE: responsable o `SUPER_ADMIN`) y el frontend. Resultado: el `ADMINISTRADOR` real pasa el guard por su bypass y luego lo rechaza el servicio. Además hay 3 filas `usuario_roles` con `ADMIN_BARBERIA` y `barberia_id` nulo, y el guard trata `rd.barberiaId === null` como comodín para cualquier barbería.
**Hacer:**
1. `git grep -n "SUPER_ADMIN"` en backend y frontend, y reemplazar por `ADMINISTRADOR` (D05). Un único helper `esAdministradorGlobal(user)`.
2. Incluir el `ambito` del rol en `rolesDetallados` (`JwtStrategy`). El comodín nulo del guard solo aplica a roles de ámbito GLOBAL.
3. En todo sitio que cree `usuarioRol`: un rol de ámbito BARBERIA exige `barberiaId`; si falta, error de dominio. Revisar cada `usuarioRol.create` y `createMany`.
4. Tests: `ADMINISTRADOR` puede editar una barbería ajena y marcar no presentado; `ADMIN_BARBERIA` con `barberiaId` nulo ya no es comodín.
5. Proponer el SQL para corregir las 3 filas (el dueño decide y ejecuta, ver E0-03).
**No hacer:** ejecutar SQL.
**Aceptación:**
- [ ] `git grep SUPER_ADMIN` no devuelve resultados (salvo la documentación histórica).
- [ ] Tests rojo → verde.
**Evidencia:** salida de `git grep` y de los tests.

### E1-05 · Matriz de permisos aplicada a todos los controladores
`P0 · L · Depende: E1-01, E1-04 · Rama: fix/matriz-permisos`
**Contexto:** la sección 4 define quién puede qué. Hoy, por ejemplo, `BARBERO` puede crear, editar y borrar servicios y combos; `POST .../reservas`, `horarios`, `pagos` y `antecedentes` no tienen `@Roles` y dependen de validaciones internas.
**Hacer:**
1. Reemplazar cada `@Autenticado() // TODO(E1-05)` por la política definitiva de la matriz de la sección 4.
2. Quitar `BARBERO` de crear, editar y desactivar servicios y combos (D16). Reservas: crear solo `CLIENTE`. `PATCH :id/estado` queda restringido a ADMIN_BARBERIA y ADMINISTRADOR hasta que E3 lo reemplace.
3. Generar `docs/MATRIZ_RUTAS.md`: método, ruta, decorador, roles, validación de tenant, validación de ownership y test que la cubre.
4. Test parametrizado `permisos-matriz.e2e-spec.ts` (rol × ruta → estado HTTP esperado), con 4 usuarios sembrados y 2 barberías, solo en `dev`.
**No hacer:** cambiar la lógica de negocio de las rutas.
**Aceptación:**
- [ ] 0 marcadores `TODO(E1-05)`.
- [ ] La matriz de tests cubre las 4 roles en todas las rutas.
**Evidencia:** `docs/MATRIZ_RUTAS.md` y la salida del test.

### E1-06 · Tests cross-tenant de administradores
`P0 · M · Depende: E1-05 · Rama: test/cross-tenant-admin`
**Contexto:** el guard compara el `barberiaId` de los parámetros, el header `x-barberia-id` o la query; `@CurrentBarberiaId` lo toma de otra fuente en servicios y combos. Riesgo clásico de Prisma: `where: { barberiaId: undefined }` ignora el filtro y devuelve datos de todas las barberías. `GET /catalogo/servicios` tiene tenant "opcional".
**Hacer:**
1. Pegar y revisar `current-barberia.decorator.ts` y todos los `where` de servicios y combos. Si `barberiaId` falta o no es UUID, error 400 (nunca `undefined` hacia Prisma).
2. Test E2E con barberías A y B: el `ADMIN_BARBERIA` de A intenta, sobre recursos de B: editar, desactivar y leer servicios y combos; leer agenda, bloqueos, pagos, horarios, auditoría y antecedentes; y un CLIENTE no vinculado intenta leer su catálogo.
3. Casos de manipulación: header distinto al parámetro de la ruta, `barberiaId` en la query.
**Aceptación:**
- [ ] Todo intento ajeno devuelve 403 o 404, ninguno 2xx.
- [ ] `where` con `undefined` imposible (test).
**Evidencia:** salida del test.

### E1-07 · Crear barbería con límite y respuestas públicas seguras
`P1 · M · Depende: E1-05 · Rama: feat/crear-barberia-limite`
**Contexto:** `POST /barberias` no tiene roles; cualquier usuario crea barberías sin límite (38 en staging) y recibe `ADMIN_BARBERIA`. `GET /barberias/:id` puede devolver campos internos (verificar si incluye `codigoAcceso` o `enlaceUnico` a quien no es responsable).
**Hacer:**
1. Límite de 2 barberías activas por `responsable_id` (constante `MAX_BARBERIAS_POR_RESPONSABLE`), error 422 `LIMITE_BARBERIAS`. Límite de peticiones propio (3 por hora). Auditoría `BARBERIA_CREADA`.
2. Crear la barbería, su `configuracion_barberia` y el rol `ADMIN_BARBERIA` (con `barberia_id`) en UNA transacción.
3. DTO de salida público (`id`, `nombre`, `descripcion`, `ubicacion`, `logo_url`) y DTO privado para el responsable (con `codigoAcceso` y `enlaceUnico`).
4. `PATCH /barberias/:id/estado` solo `ADMINISTRADOR` (`ACTIVO` o `INACTIVO`).
**Aceptación:**
- [ ] Tercera barbería → 422.
- [ ] Un no responsable nunca recibe `codigoAcceso` (test).
**Evidencia:** salida de los tests.

### E1-08 · Rol de base de datos de mínimos privilegios
`P1 · S · Depende: E0-04 · Rama: chore/rol-bd-app`
**Contexto:** el backend se conecta como `neondb_owner` (dueño de la base).
**Hacer:** (Dueño) crear en Neon un rol `barberias_app` sin permisos de dueño, con `SELECT, INSERT, UPDATE, DELETE` en las tablas y `USAGE` en secuencias. Las migraciones corren solo con el rol dueño (CI o despliegue). Render usa `barberias_app`. Documentar en `docs/ENTORNOS.md`.
**Aceptación:**
- [ ] La app funciona con el rol limitado en staging.
- [ ] El rol de la app no puede ejecutar `DROP TABLE`.
**Evidencia:** prueba del dueño.

### E1-09 · Guards de rutas del frontend (cierre del H17)
`P1 · M · Depende: E1-04 · Rama: fix/h17-guards-frontend`
**Contexto:** `frontend-barberias/src/app/core/guards/role.guard.ts` agrupa `ADMINISTRADOR`, `ADMIN_BARBERIA` y `SUPER_ADMIN` bajo el alias `'ADMIN'`. Rutas como `/barberias/nueva`, `/admin/servicios`, `/admin/horarios`, `/admin/personal`, `/admin/antecedentes` y `/admin/tickets` usan `roleGuard(['ADMIN'])`. `auth.service.ts` redirige a `/` a todos los roles con barberías. El commit `ee5e009` solo separó bloques visuales.
**Hacer:**
1. Eliminar el alias `'ADMIN'`. Cada ruta declara roles explícitos (`ADMIN_BARBERIA`, `ADMINISTRADOR`, `CLIENTE`, `BARBERO`).
2. Rutas globales de plataforma bajo `/plataforma/*` solo para `ADMINISTRADOR`.
3. `/barberias/nueva` para cualquier autenticado (D04).
4. Eliminar el `return` duplicado del guard.
5. Tests unitarios del guard (tabla rol × ruta).
**No hacer:** crear pantallas nuevas.
**Aceptación:**
- [ ] No existe `'ADMIN'` como valor de rol en el frontend.
- [ ] Un `ADMIN_BARBERIA` no accede a `/plataforma/*`.
**Evidencia:** salida de los tests.

### E1-10 · Validación global y registro seguro
`P1 · M · Depende: E1-01 · Rama: fix/validacion-global`
**Contexto:** hay controladores con `@Body('campo')` sin DTO (por ejemplo notas de clientes en el trabajo descartado). El DTO de `POST /auth/register` no se ha verificado frente a campos de rol.
**Hacer:**
1. `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })` global (D30).
2. Auditar todos los `@Body` y `@Query` sin DTO y crearlos.
3. Test: `POST /auth/register` con `roles: ['ADMINISTRADOR']` → 400.
4. Límite de tamaño del cuerpo (100 kb), `helmet` y filtro de excepciones con el contrato D40 (`codigo` en errores de negocio).
**Aceptación:**
- [ ] Campos extra → 400.
- [ ] El registro nunca asigna roles distintos de `CLIENTE`.
**Evidencia:** salida de los tests.

---


## ÉPICA E2 — INTEGRIDAD DE DATOS Y REGLAS BASE

### E2-01 · Actualizar el diseño a la versión 2
`P1 · M · Depende: E1-10 · Rama: docs/diseno-v2`
**Contexto:** los PDF 01 y 02 no recogen las decisiones D01 a D44, y el PDF 02 afirma que ya existen `CHECK` y estados que el sistema real no tiene.
**Hacer:** crear `docs/diseno/01_Especificacion_v2.md` y `docs/diseno/02_Arquitectura_v2.md` (los PDF originales no se tocan) incorporando: estado `COMPLETADA`, `zona_horaria`, `PENDIENTE_APROBACION`, margen sumado (D01), tabla de transiciones (sección 5), roles V1 (matriz), V2 (personal, reportes, permisos, WhatsApp y SMS), contrato de errores, rutas reales en español, tablas nuevas (`propuestas_horario`, `solicitudes_cambio_barberia`) y columnas nuevas de las tareas siguientes. Marcar "Reportes" como pendiente de aclarar (el PDF 02 define estados PENDIENTE, EN_REVISION y RESUELTO, que sugieren incidencias y no métricas). Indicar la desviación D31 (bcrypt 10).
**No hacer:** cambiar código.
**Aceptación:**
- [ ] Cada decisión D## aparece reflejada en alguno de los dos documentos.
**Evidencia:** diff del PR.

### E2-02 · Módulo de estados y máquina de transiciones
`P0 · L · Depende: E2-01 · Rama: feat/maquina-estados-reserva`
**Contexto:** `Reserva.estado` es texto libre. `cambiarEstado` (`reserva.service.ts`, ~líneas 511 a 532) asigna cualquier valor sin validar transiciones. El enum de `schema.prisma` (`EN_PROCESO`, `CANCELADA_A_TIEMPO`, `CANCELADA_TARDE`, `NO_ASISTIO`...) no coincide con el diseño ni con los datos reales (`CONFIRMADA`, `COMPLETADA`, `EXPIRADA`).
**Hacer:**
1. `src/shared/domain/estados.ts`: constantes `as const` de los 8 estados (D14) y la tabla `TRANSICIONES` de la sección 5.2 con el actor permitido.
2. `ReservaStateMachine.assertTransition(desde, hacia, actor)` → 409 `ESTADO_INVALIDO`. Un hook central `onEnter(estado)` para efectos comunes (borrar información adicional, cancelar jobs).
3. Refactorizar `cambiarEstado` para usarla. El endpoint genérico queda restringido a admin hasta que E3 lo reemplace.
4. Reemplazar todos los literales de estado: `git grep -nE "'(PENDIENTE|CONFIRMADA|COMPLETADA|EXPIRADA|NO_ASISTIO|CANCELADA[A-Z_]*|NO_PRESENTADO)'" -- backend-barberias/src`.
5. Test de tabla: las 64 combinaciones 8×8 contra la matriz esperada, por actor.
**No hacer:** nuevas reglas de negocio (son de E3).
**Aceptación:**
- [ ] Ningún literal de estado fuera de `estados.ts`.
- [ ] Rojo → verde (hoy `CANCELADA → CONFIRMADA` es posible).
**Evidencia:** salida del test de tabla y del `git grep`.

### E2-03 · Migración de esquema y de datos (integridad base)
`P0 · M · Depende: E2-02 · Rama: fix/db-integridad-base`
**Contexto:** la base no tiene `ENUM` ni `CHECK` (todo `VARCHAR`). `barberias` no tiene fecha de creación ni zona horaria. `pagos` ya usa `registrado_at` (correcto según el diseño).
**Hacer** (cada tarea posterior agrega sus propias columnas con migraciones pequeñas; aquí solo lo base):
1. `barberias`: `zona_horaria VARCHAR(50) NOT NULL DEFAULT 'America/Santo_Domingo'`, `creado_at TIMESTAMPTZ DEFAULT now()`, `logo_url TEXT`, `CHECK (estado IN ('ACTIVO','INACTIVO'))` (verificar antes los valores reales existentes).
2. `CHECK` en `reservas.estado` (8 valores), `reservas.tipo_reserva`, `reservas.modo_confirmacion`, `usuarios.estado_cuenta` (D09), `cliente_barberias.estado_vinculacion` (D10), `pagos.estado_pago`, `antecedentes.origen` y `estado_validacion`, `notificaciones.canal` y `estado`, `roles.ambito`, `excepciones_horario.tipo`.
3. `reservas.completada_at TIMESTAMPTZ NULL`.
4. ANTES de aplicar cada `CHECK`, consulta de solo lectura con `SELECT DISTINCT` para detectar valores inválidos; si hay, reportarlos y esperar instrucciones.
5. `schema.prisma`: columnas como `String` donde corresponda y eliminar los enums sin uso real (D14), verificando con `git grep` que nadie los importe.
6. Aplicar con `migrate deploy` primero en `dev`; staging solo con aprobación del dueño.
**No hacer:** `db push`; `migrate dev` contra staging.
**Aceptación:**
- [ ] Insertar un estado inválido por SQL directo falla (test de integración en dev).
- [ ] `prisma migrate diff` sin diferencias.
**Evidencia:** SQL de la migración y salida de los tests.

### E2-04 · Zona horaria de la barbería
`P0 · M · Depende: E2-03 · Rama: fix/h22-zona-horaria`
**Contexto:** `disponibilidad.service` calcula el día de la semana con `fecha.getDay()` del servidor; una fecha `YYYY-MM-DD` se interpreta en UTC. Render corre en UTC y República Dominicana está en UTC-4 sin horario de verano: una reserva a las 9 PM locales (01:00 UTC del día siguiente) puede validarse contra el día equivocado. El test intermitente del IDOR (commit `1aa9516`) se "arregló" creando horarios para los 7 días, lo que tapa el síntoma.
**Hacer:**
1. Instalar `luxon` (D15). `src/shared/time/tiempo.service.ts`: `ahora()` inyectable (reloj falso en tests), `diaSemana(fechaIso, tz)`, `aInstante(fecha, hora, tz)`, `desdeInstante(instante, tz)`.
2. Usarlo en `disponibilidad.service`, `horario.service`, `reserva.service` (cálculo de `expira_at` y ventanas de 30 y 15 minutos) y `agenda.service`. La zona sale de `barberias.zona_horaria`.
3. Tests de borde: reserva a las 21:00 locales, 23:59 y 00:00, y cierre a medianoche. Correr toda la suite con `TZ=UTC` y con `TZ=America/Santo_Domingo` (dos scripts npm); ambas deben pasar.
4. Revertir el parche del test `1aa9516` (horarios para los 7 días) una vez que los tests de borde pasen.
**Aceptación:**
- [ ] Test ROJO que reproduce el bug con `TZ=UTC`, luego verde.
- [ ] Ningún `getDay()`, `new Date('YYYY-MM-DD')` ni `toISOString().slice` sobre fechas de cita en `src/`.
**Evidencia:** salida de ambas ejecuciones y de `git grep`.

### E2-05 · Margen sumado en reservas individuales (D01)
`P1 · S · Depende: E2-02 · Rama: fix/margen-suma`
**Contexto:** los informes de auditoría se contradicen: uno dice que `reserva.service` suma los márgenes de los servicios y otro que usa el del último. El diseño recomienda sumar (D01).
**Hacer:** leer `reserva.service.ts` y `disponibilidad.service.ts`, documentar cómo calculan hoy el bloque y unificar: bloque = Σ duraciones + Σ márgenes de los servicios elegidos; combo = `duracion_propia` + `margen_propio`. El cálculo vive en UNA función pura reutilizada por disponibilidad, creación y cotización.
**Aceptación:**
- [ ] Tests con 1, 2 y 3 servicios, un combo y mezcla de servicio más combo.
- [ ] Snapshot `margen_historico` por servicio.
**Evidencia:** salida de los tests y descripción del comportamiento anterior.

### E2-06 · Estabilizar las pruebas E2E
`P1 · M · Depende: E0-02 · Rama: test/estabilizar-e2e`
**Contexto:** el E2E `hallazgo14-idor-reserva.e2e-spec.ts:271` falla con `Transaction failed due to a write conflict or a deadlock` (P2034) en `clienteBarberia.create`, a veces por timeout de 5 s. Siete archivos corren en paralelo contra una misma base. No existe una prueba real de carrera entre dos reservas simultáneas. `test-sec01-recovery.ts` no termina en `.spec.ts` y puede quedar fuera de `npm run test`.
**Hacer:**
1. Ejecutar los E2E en serie (`fileParallelism: false`) y con `testTimeout` de 30 s.
2. Datos con prefijo `e2e_` y limpieza en `afterAll`; factorías de datos reutilizables.
3. Revisar `vincularCliente`: ante un conflicto de serialización (40001) debe responder 409, no 500 (test).
4. Test de carrera real: 10 reservas simultáneas (`Promise.all`) para el mismo horario → exactamente 1 con 201 y 9 con 409.
5. Renombrar `test-sec01-recovery.ts` a `.spec.ts` o incluirlo en la configuración, y verificar que corre.
6. Documentar `npm run test:e2e` (solo en `dev`).
**Aceptación:**
- [ ] 3 ejecuciones consecutivas de toda la suite E2E en verde.
- [ ] El test de carrera en verde.
**Evidencia:** resumen literal de las 3 ejecuciones.

### E2-07 · Vocabulario del diseño: desactivar, cancelar, desvincular, eliminar
`P1 · M · Depende: E2-02 · Rama: refactor/vocabulario`
**Contexto:** hoy `@Delete` desactiva servicios y combos, `DELETE /barberias/:id` hace un borrado lógico y `eliminarBloqueo` borra físicamente. Spec 01 sección 9: nunca eliminación física para representar un cambio de estado.
**Hacer:**
1. Servicios y combos: `PATCH :id/desactivar` y `PATCH :id/reactivar`. Desactivar un servicio se bloquea (422) si hay reservas `PENDIENTE` o `PROPUESTA_PENDIENTE` que lo usan; con solo reservas confirmadas se permite. Si pertenece a un combo activo, 422 con la lista de combos (el combo debe resolverse antes). Eliminar `DELETE` sin alias (no hay clientes reales).
2. Barberías: el borrado pasa a `PATCH :id/estado` (E1-07).
3. Bloqueos: `POST :id/liberar` fija `liberado_at` (migración), cancela el job de aviso y audita (D29). Los bloqueos liberados no cuentan para la disponibilidad.
4. Actualizar el contrato del API en `docs/` y avisar de los cambios que rompen el frontend (F-08).
**Aceptación:**
- [ ] Ningún `@Delete` queda en el backend, salvo borrados definitivos justificados.
- [ ] Tests de las tres reglas de desactivación.
**Evidencia:** `git grep "@Delete"` y salida de los tests.

### E2-08 · Matriz de cumplimiento reconciliada
`P2 · S · Depende: E2-01 · Rama: docs/matriz-cumplimiento`
**Contexto:** `COMPARACION_DISENO_VS_REAL.md` está desactualizado (dice que `RolesGuard` no es global) y solo cubre 4 de las 9 secciones pedidas. Los informes de auditoría tienen numeración inconsistente.
**Hacer:** crear `docs/MATRIZ_CUMPLIMIENTO.md` con una fila por regla del PDF 01 (secciones 1 a 10, no solo las 33 reglas anteriores): estado (`OK-PROBADO`, `OK-SIN-TEST`, `PARCIAL`, `NO-EXISTE`, `NO-VERIFICADO`), evidencia `archivo:línea`, test y tarea del backlog que la cierra. Reemplazar el documento antiguo. Actualizarla al cerrar cada épica.
**Aceptación:**
- [ ] Cubre todas las secciones del PDF 01 con evidencia.
**Evidencia:** el documento.

---

## ÉPICA E3 — FLUJO DE RESERVA EN EL BACKEND

### E3-01 · Servicio de auditoría unificado
`P1 · M · Depende: E2-03 · Rama: feat/auditoria-servicio`
**Contexto:** spec 01 sección 8.3: toda operación importante genera un registro (qué, quién, cuándo, contexto), con retención de 1 año. Hoy solo se audita `REGISTRO_PAGO_EN_PERSONA`. La tabla `auditoria` tiene `usuario_id`, `accion`, `entidad`, `entidad_id`, `contexto` (JSONB) y `creado_at`, pero no `barberia_id`. Existe el processor `auditoria-purga` sin tests.
**Hacer:**
1. Migración: `auditoria.barberia_id UUID NULL` con índice `(barberia_id, creado_at)`.
2. Catálogo `ACCIONES_AUDITORIA` (D28): `CUENTA_CREADA`, `LOGIN_FALLIDO`, `CONTRASENA_CAMBIADA`, `BARBERIA_CREADA`, `VINCULACION_*`, `RESERVA_*`, `PAGO_*`, `ANTECEDENTE_*`, `CONFIG_*`, `SERVICIO_*`, `COMBO_*`, `HORARIO_*`, `BLOQUEO_*`, `RESTRICCION_*`.
3. `AuditoriaService.registrar({ accion, entidad, entidadId, usuarioId, barberiaId, contexto })`, ejecutable dentro de la misma transacción del cambio. El `contexto` nunca lleva contraseñas, tokens ni textos de antecedentes.
4. Adaptar `consultarAuditorias` para filtrar por la nueva columna (complementa E1-02).
5. Test del processor de purga: registros de más de 1 año se eliminan y los demás no.
**No hacer:** integrar todas las acciones (cada tarea de la épica integra la suya).
**Aceptación:**
- [ ] Tests del servicio y de la purga en verde.
**Evidencia:** salida de los tests.

### E3-02 · Cálculo de disponibilidad
`P0 · M · Depende: E2-04, E2-05 · Rama: feat/disponibilidad-v2`
**Contexto:** spec 01 sección 4: disponibilidad = horario + excepciones + reservas + duraciones + márgenes + bloqueos + restricciones, siempre calculada y nunca almacenada. Los horarios admiten uno o más períodos por día y las excepciones (`CERRADA`, `HORARIO_ESPECIAL`) tienen prioridad. `agenda.service.ts:48` contiene `// TODO: Comprobar solapamiento con reservas existentes` al crear bloqueos.
**Hacer:**
1. Refactorizar el cálculo a una función PURA (entradas: períodos, excepciones, ocupaciones, bloqueos, bloque requerido, ahora, zona) con tests unitarios amplios.
2. Ocupaciones según la sección 5.3 (D37), incluidas las propuestas de horario activas.
3. Un bloque debe caber completo, margen incluido, dentro de un período. Pasos de 15 minutos (D41). Sin horarios en el pasado.
4. Aplicar configuración: `nuevas_reservas_activas` (422 `RESERVAS_PAUSADAS`), `horizonte_reserva_dias` (422 `FUERA_DE_HORIZONTE`), `acepta_individual` y `acepta_grupal`.
5. Crear un bloqueo que solape reservas CONFIRMADAS devuelve 409 con la lista de conflictos (resuelve el TODO).
6. Tests: varios períodos, excepción CERRADA, HORARIO_ESPECIAL, bloqueo parcial, margen al final del período y día sin horario.
**Aceptación:**
- [ ] Función pura con cobertura de todos los casos de la lista.
- [ ] El TODO del bloqueo eliminado.
**Evidencia:** salida de los tests.

### E3-03 · Crear reserva y cotización
`P0 · L · Depende: E3-02, E2-02, E3-01 · Rama: feat/crear-reserva-v2`
**Contexto:** hoy `reserva.service.crearReserva` fija `tipoReserva: 'INDIVIDUAL'` con un único participante y encola el job `expirar-reserva` de 10 min en modo MANUAL. `POST .../reservas` no tiene `@Roles`. El helper `withSerializableTransaction` ya existe y mapea 40001 a 409.
**Hacer:**
1. `POST /barberias/:barberiaId/reservas` (`@Roles('CLIENTE')`). Orden de validación (principio 9): sesión → rol → DTO → vinculación `ACTIVO` con esa barbería → no restringido (403 `CLIENTE_RESTRINGIDO`) → configuración (pausa, tipo aceptado, horizonte, `max_pendientes`) → servicios y combos activos de ESA barbería → bloque (E2-05) → disponibilidad bajo SERIALIZABLE y `FOR UPDATE` → persistir con snapshots y `modo_confirmacion`.
2. MANUAL: estado `PENDIENTE`, `expira_at` = ahora + 10 min, job de expiración (E3-05). AUTOMATICO: `CONFIRMADA` inmediata, sin temporizador.
3. El DTO exige `tipo`. `GRUPAL` responde 422 `GRUPAL_NO_DISPONIBLE` hasta E4-01 (no ignorar el tipo en silencio).
4. `POST /barberias/:barberiaId/reservas/cotizar` (D44): devuelve bloque total, hora de fin, margen, precio y desglose, sin persistir.
5. Auditoría `RESERVA_CREADA`. Notificación al responsable (MANUAL) o al cliente (AUTOMATICO) con el tipo correspondiente (el envío real es O-01).
6. Tests: unitarios, E2E y de carrera (E2-06).
**No hacer:** reserva grupal (E4-01).
**Aceptación:**
- [ ] Cliente no vinculado → 403 `NO_VINCULADO`; restringido → 403 `CLIENTE_RESTRINGIDO`.
- [ ] Dos solicitudes simultáneas al mismo espacio: una 201 y otra 409.
**Evidencia:** salida de los tests.

### E3-04 · Aceptar y rechazar solicitudes
`P0 · L · Depende: E3-03 · Rama: feat/aceptar-rechazar`
**Contexto:** spec 01 sección 5.3 y 5.4. Hoy solo existe el `PATCH :id/estado` genérico.
**Hacer:**
1. `POST /barberias/:barberiaId/reservas/:id/aceptar` (ADMIN_BARBERIA, ADMINISTRADOR): `PENDIENTE → CONFIRMADA`. Revalida disponibilidad bajo bloqueo; si `expira_at` ya pasó, 409 `SOLICITUD_EXPIRADA`.
2. `POST .../:id/rechazar` con `motivo_codigo` obligatorio del catálogo 5.5 (`OTRO` exige detalle). `PENDIENTE → RECHAZADA`, libera el espacio, borra la información adicional, notifica al cliente con el motivo.
3. Migración: `reservas.motivo_codigo`, `motivo_detalle`, con `CHECK` del catálogo.
4. Cancelar el job de expiración (E3-05). Auditoría `RESERVA_CONFIRMADA` y `RESERVA_RECHAZADA`.
**Aceptación:**
- [ ] Aceptar una reserva expirada → 409 `SOLICITUD_EXPIRADA`.
- [ ] Rechazar sin motivo → 400.
- [ ] Un admin de otra barbería recibe 403.
**Evidencia:** salida de los tests.

### E3-05 · Expiración automática y jobs idempotentes
`P0 · M · Depende: E3-03 · Rama: fix/expiracion-idempotente`
**Contexto:** existe el job `expirar-reserva` (BullMQ, cola `reservas-pendientes`, delay de 10 minutos) y su processor, sin ningún test. Si Redis o el servidor se reinician, los jobs pendientes pueden perderse.
**Hacer:**
1. `jobId` determinístico `expirar:{reservaId}` (D33).
2. El processor es idempotente: expira solo si la reserva sigue en `PENDIENTE` o `PROPUESTA_PENDIENTE` y `expira_at <= ahora`.
3. Cancelar el job (`remove`) al aceptar, rechazar, cancelar o aceptar una propuesta.
4. Reconciliación al arrancar (`OnApplicationBootstrap`): expirar las vencidas y reencolar las vigentes sin job.
5. Al expirar: estado `EXPIRADA`, libera el espacio, borra la información adicional, notifica al cliente y audita.
6. Tests del processor con reloj simulado y de la reconciliación.
**Aceptación:**
- [ ] Ejecutar el processor dos veces no cambia nada.
- [ ] Una reserva vencida durante una caída se expira al reiniciar.
**Evidencia:** salida de los tests.

### E3-06 · Propuesta de nuevo horario
`P1 · L · Depende: E3-04, E3-05 · Rama: feat/propuesta-horario`
**Contexto:** spec 01 sección 5.4: el responsable puede proponer otro horario; el cliente tiene 10 minutos para aceptar o rechazar; si rechaza o expira no se puede reenviar otra propuesta de inmediato (se inicia un proceso nuevo). No existe nada de esto (regla 13 de la matriz).
**Hacer:**
1. Migración: tabla `propuestas_horario` (D18): `id`, `reserva_id`, `fecha_cita`, `hora_inicio`, `hora_fin`, `tipo` (`PROPUESTA_INICIAL`, `REPROGRAMACION`, `ADELANTO`), `estado` (`PENDIENTE`, `ACEPTADA`, `RECHAZADA`, `EXPIRADA`), `expira_at`, `creado_por`, `creado_at`, con `CHECK` e índice.
2. `POST .../reservas/:id/proponer` (admin): `PENDIENTE → PROPUESTA_PENDIENTE`; valida disponibilidad del nuevo bloque y lo mantiene ocupado (D37) hasta que expire; reinicia `expira_at` a 10 minutos.
3. `POST .../reservas/:id/propuesta/aceptar` (cliente dueño): `→ CONFIRMADA` con el nuevo horario, revalidada bajo bloqueo.
4. `POST .../propuesta/rechazar` (cliente): `→ CANCELADA`, libera.
5. Expiración (E3-05): `→ EXPIRADA`. Como la reserva queda en un estado terminal, "una nueva propuesta" exige una reserva nueva.
6. Notificaciones, auditoría y tests de las tres salidas y de concurrencia.
**Aceptación:**
- [ ] Mientras la propuesta está activa nadie más puede reservar ese espacio (test).
- [ ] Rojo → verde.
**Evidencia:** salida de los tests.

### E3-07 · Cancelación por el cliente y cancelación especial
`P0 · L · Depende: E3-04, E2-04 · Rama: feat/cancelar-cliente`
**Contexto:** spec 01 sección 5.7: el cliente cancela hasta 30 minutos antes; después solo puede pedir una cancelación especial si la barbería la tiene habilitada. Hoy no existe ningún endpoint de cancelación para el cliente (regla 16 de la matriz).
**Hacer:**
1. `POST /reservas/:id/cancelar` (CLIENTE dueño). `PENDIENTE` siempre; `CONFIRMADA` si ahora ≤ inicio − 30 min (instante calculado con la zona de la barbería) → `CANCELADA`. Pasado el límite, 422 `FUERA_DE_VENTANA`.
2. Migración (D17): `configuracion_barberia.permite_cancelacion_especial BOOLEAN DEFAULT FALSE`; en `reservas`: `cancelado_por`, `cancelacion_especial_estado` (`SOLICITADA`, `APROBADA`, `RECHAZADA`) y `cancelacion_especial_motivo`.
3. `POST /reservas/:id/cancelacion-especial {motivo}`: solo si la barbería la permite; deja la reserva `CONFIRMADA` con estado `SOLICITADA`. `POST .../cancelacion-especial/resolver {aprobar, motivo?}` (admin): aprobada → `CANCELADA`.
4. Efectos al cancelar: libera el espacio, borra la información adicional, cancela jobs (recordatorio, expiración), notifica y audita. La cancelación del cliente no cuenta como no presentado. Dispara oportunidad de espacio (E4-04).
5. Tests en los límites 29, 30 y 31 minutos y con otra zona horaria.
**Aceptación:**
- [ ] 31 min antes → OK; 29 min → 422 `FUERA_DE_VENTANA`.
- [ ] Un cliente no puede cancelar reservas ajenas.
**Evidencia:** salida de los tests.

### E3-08 · Cancelación por el admin con motivo
`P1 · S · Depende: E3-07 · Rama: feat/cancelar-admin`
**Contexto:** spec 01 sección 5.7: las cancelaciones del barbero requieren motivo obligatorio. Los bloqueos manuales programan un aviso 15 minutos antes de su fin (PDF 02 sección 4.2).
**Hacer:** `POST .../reservas/:id/cancelar-admin {motivo_codigo, motivo_detalle, bloquear_espacio?}`. Estados `PENDIENTE` o `CONFIRMADA` → `CANCELADA`. Con `bloquear_espacio` crea el bloqueo con su job de aviso (extender el bloqueo reprograma el mismo job con `changeDelay`). Notifica al cliente con el motivo y audita.
**Aceptación:**
- [ ] Sin motivo → 400.
- [ ] El bloqueo opcional aparece en la agenda y su job existe.
**Evidencia:** salida de los tests.

### E3-09 · Atención y pago (estado COMPLETADA)
`P1 · S · Depende: E2-02 · Rama: feat/atencion-pago`
**Contexto:** `pago.service` registra el pago en persona, marca la reserva `COMPLETADA` (estado agregado en D03) y audita atómicamente con `withSerializableTransaction`. Spec 01 sección 7.1: el pago puede corregirse después, pero cada cambio debe auditarse. Pendiente de pago nunca equivale a ingreso.
**Hacer:**
1. Validar que `CONFIRMADA → COMPLETADA` solo ocurra desde `hora_inicio` (máquina de estados) y fijar `completada_at`.
2. `PATCH /barberias/:barberiaId/pagos/:id {estado_pago, motivo}` para corregir `PAGADA` ↔ `PENDIENTE_DE_PAGO` con auditoría (valor anterior, nuevo y motivo). El `monto` es el snapshot `total_pagar` y no se edita.
3. Las métricas de ingresos del dashboard cuentan solo `PAGADA`.
4. Registran el pago: ADMIN_BARBERIA, BARBERO asignado y ADMINISTRADOR.
**Aceptación:**
- [ ] Un cobro antes de la hora de inicio → 422.
- [ ] El total de ingresos excluye `PENDIENTE_DE_PAGO` (test).
**Evidencia:** salida de los tests.

### E3-10 · No presentado, advertencia y restricción
`P0 · M · Depende: E2-02, E2-04, E1-04 · Rama: fix/h24-no-presentado`
**Contexto:** spec 01 sección 5.8: 5 minutos de puntualidad + 10 de tolerancia = 15; pasados, `NO_PRESENTADO`. 3 inasistencias acumuladas → advertencia. 5 → restricción impuesta por esa barbería (nunca global). `marcarInasistencia` (`reserva.service.ts`, ~líneas 266 a 340) hoy se puede ejecutar en cualquier momento, incrementa `contadorNoPresentado`, fija `estaRestringido` a los 5, pero no hay advertencia a los 3 y su check de permisos busca `SUPER_ADMIN`.
**Hacer:**
1. Renombrar la ruta a `POST .../reservas/:id/no-presentado` (ADMIN_BARBERIA, ADMINISTRADOR; D02). Constantes `PUNTUALIDAD_MARGEN_MIN=5` y `TOLERANCIA_MIN=10`.
2. Solo desde `CONFIRMADA` y con ahora ≥ inicio + 15 min (con la zona de la barbería); si no, 422 `FUERA_DE_VENTANA`.
3. En una transacción: estado `NO_PRESENTADO`, contador +1 en `cliente_barberias` de ESA barbería, al llegar a 3 notificación de advertencia y auditoría, al llegar a 5 `esta_restringido = true` con `motivo_restriccion`.
4. D20: la restricción persiste al desvincular y revincular. El admin puede levantarla con `POST .../clientes/:clienteId/restriccion/levantar {motivo}` (auditado).
5. Tests: 14, 15 y 16 minutos; contador a 3 y a 5; aislamiento entre dos barberías (restringido en A, libre en B).
**Aceptación:**
- [ ] Marcar a los 14 min → 422.
- [ ] La restricción en A no afecta a B.
**Evidencia:** salida de los tests.

### E3-11 · Configuración de la barbería
`P1 · M · Depende: E3-03, E1-05 · Rama: feat/configuracion-barberia`
**Contexto:** spec 01 sección 5.5 y 5.9; PDF 02 sección 3.7. La fila de `configuracion_barberia` se crea al registrar la barbería y se lee en las reservas, pero no hay endpoint para consultarla ni modificarla.
**Hacer:**
1. `GET` y `PATCH /barberias/:barberiaId/configuracion` (ADMIN_BARBERIA, ADMINISTRADOR). Campos: `modo_reserva`, `acepta_individual`, `acepta_grupal`, `max_pendientes`, `max_ninos`, `max_personas_total`, `horizonte_reserva_dias`, `nuevas_reservas_activas`, `motivo_pausa`, `reactivacion_programada`, `permite_cancelacion_especial`.
2. Regla: `modo_reserva`, `acepta_individual`, `acepta_grupal` y `max_pendientes` NO pueden cambiar mientras haya reservas `PENDIENTE` o `PROPUESTA_PENDIENTE` (422 `HAY_PENDIENTES` con el conteo).
3. Validaciones: límites ≥ 1 y `max_personas_total >= max_ninos + 1` (el total incluye al adulto).
4. Pausa: `nuevas_reservas_activas=false` guarda motivo y `pausa_desde`; la reactivación programada se ejecuta con un job (`reactivacion_real` queda registrada).
5. Auditoría `CONFIG_ACTUALIZADA` (valor anterior y nuevo).
**Aceptación:**
- [ ] Cambiar el modo con una reserva pendiente → 422.
- [ ] La pausa bloquea la creación de reservas (E3-03).
**Evidencia:** salida de los tests.

### E3-12 · Vinculación, sexta aprobación y desvinculación
`P1 · L · Depende: E1-05, E2-03 · Rama: feat/vinculacion-completa`
**Contexto:** spec 01 secciones 1.2 y 7.5. Hoy se puede vincular por código (`POST /barberias/vincular`), con límite de 5 y una 6ª que queda `PENDIENTE` sin ningún flujo de aprobación. Existe el cambio de barbería activa (`PATCH /barberias/:id/seleccionar`) con índice único parcial en la base. No existe desvincular.
**Hacer:**
1. Estado `PENDIENTE_APROBACION` (D10) para la 6ª. `GET /plataforma/vinculaciones/pendientes` y `POST /plataforma/vinculaciones/:id/aprobar|rechazar {motivo}` (ADMINISTRADOR), con notificación al cliente.
2. Vinculación por enlace único y QR: el QR codifica el enlace; `GET /barberias/por-enlace/:enlace` (`@Autenticado`, datos públicos).
3. `POST /barberias/:id/desvincular` (CLIENTE): estado `DESVINCULADO`, `es_barberia_activa = false`, historial intacto. Se bloquea (422) si hay reservas futuras `PENDIENTE`, `PROPUESTA_PENDIENTE` o `CONFIRMADA`.
4. D21: revincular reactiva la misma fila. D20: la restricción y el contador se conservan.
5. Auditoría `VINCULACION_*`. Tests: límite 5 / 6, índice único de una barbería activa, desvincular con reservas, revincular conservando la restricción.
**Aceptación:**
- [ ] La 6ª queda `PENDIENTE_APROBACION` hasta que el ADMINISTRADOR aprueba.
- [ ] Un cliente restringido no evade la restricción desvinculándose.
**Evidencia:** salida de los tests.

### E3-13 · Solicitudes de cambio de nombre y responsable
`P2 · M · Depende: E1-07, E3-01 · Rama: feat/solicitudes-cambio-barberia`
**Contexto:** spec 01 sección 2: el nombre de la barbería y el responsable solo cambian mediante una solicitud aprobada por administración; descripción, ubicación y logo son directos; el teléfono requiere verificación. V1 tiene un único responsable.
**Hacer:**
1. Migración: `solicitudes_cambio_barberia` (D26): `id`, `barberia_id`, `tipo` (`NOMBRE`, `RESPONSABLE`), `valor_nuevo`, `estado` (`PENDIENTE`, `APROBADA`, `RECHAZADA`), `solicitado_por`, `resuelto_por`, `motivo_rechazo`, `creado_at`, `resuelto_at`, con `CHECK`.
2. `PATCH /barberias/:id` limitado a `descripcion`, `ubicacion`, `logo_url` y `telefono` (el teléfono exige la contraseña actual, D27).
3. `POST /barberias/:id/solicitudes-cambio` (ADMIN_BARBERIA). El ADMINISTRADOR lista y resuelve.
4. Al aprobar el cambio de responsable: en una transacción cambia `responsable_id`, mueve el rol `ADMIN_BARBERIA` (con `barberia_id`) del anterior al nuevo (que debe existir) y audita.
**Aceptación:**
- [ ] El nombre no se puede cambiar por `PATCH`.
- [ ] Aprobar el cambio de responsable mueve el rol correctamente.
**Evidencia:** salida de los tests.

---

