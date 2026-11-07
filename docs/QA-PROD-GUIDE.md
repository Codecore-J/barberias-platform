# Guía de QA en producción — Tenant Sandbox aislado

Esta guía define el **tenant/sede de prueba aislado** (sandbox) para auditar en vivo, en **producción**, los módulos que requieren privilegios de sede (gestión de sucursales, administración de usuarios/roles de la sede, bandeja de propuestas de horarios y supervisión de citas) **sin comprometer ni alterar datos reales**.

- Frontend (producción): `https://barberias-platform.vercel.app`
- Login: `https://barberias-platform.vercel.app/auth/login`
- Backend canónico: `https://barberias-api-p3br.onrender.com/api/v1`
- Script (idempotente, `upsert`): `backend-barberias/prisma/seed-qa.ts` → `npm run seed:qa`

> **Regla de oro:** toda prueba en producción debe ejecutarse **únicamente dentro del tenant QA (`Sede Sandbox QA`, `QA2026`)** y con las cuentas sintéticas listadas abajo. Prohibido operar sobre sedes/usuarios reales.

## 1) Definición del tenant de QA (aislado)

| Campo | Valor |
|---|---|
| Nombre | `Sede Sandbox QA` |
| `codigoAcceso` | `QA2026` |
| `enlaceUnico` | `sede-sandbox-qa` |
| Estado | `ACTIVO` |
| Descripción | Sede de prueba aislada para QA en vivo. No usar para operaciones reales. |
| Ubicación | Entorno QA / Sandbox (no es una sede real) |
| Responsable | `admin.qa@barberias.demo` |

Datos **aislados** creados para esta sede (no se comparten con sedes reales):
- `ConfiguracionBarberia` propia (reservas activas, modo `MANUAL`, oportunidades activas).
- Horario de sede: todos los días `09:00–18:00` (ISO 1=lun…7=dom), gestionado solo para `QA2026`.
- Horario del barbero QA: lun–sáb `09:00–18:00`, dom libre (`HorarioBarbero`, `uk_horario_barbero_dia`).
- Catálogo propio: `Servicio` legacy `Corte QA (Sandbox)` (30 min) + `CategoriaServicio` `Cortes QA (Sandbox)` + `ServicioBarbero` `Corte QA Barbero` (30 min) del barbero QA.

El seed es **idempotente**: usa `upsert` por claves naturales (`codigoAcceso`, `correo`, `uk_cliente_barberia`, `uk_categoria_sede_nombre`, `uk_servicio_barbero_categoria_nombre`, `uk_horario_barbero_dia`) y, donde no hay `@@unique` (`Horario` de sede, `Servicio` legacy), hace `find/create-update` o `deleteMany`/`createMany` **acotado exclusivamente a la `barberiaId` de QA**. Re-ejecutarlo no duplica ni altera sedes/usuarios reales.

## 2) Cuentas sintéticas (credenciales de prueba aprobadas)

| Cuenta | Correo | Rol efectivo (alcance) | Uso previsto |
|---|---|---|---|
| Administrador de sede QA | `admin.qa@barberias.demo` | `CLIENTE` (global) + **`ADMIN_BARBERIA` @ Sede Sandbox QA** | Gestión de sucursal, admin de usuarios/roles **de la sede QA**, supervisión operativa de la sede QA |
| Barbero de prueba | `barbero.qa@barberias.demo` | `CLIENTE` (global) + **`BARBERO` @ Sede Sandbox QA** | Bandeja/propuestas de horarios, agenda y supervisión de sus citas |
| Cliente de prueba | `cliente.qa@barberias.demo` | `CLIENTE` (global) + `ClienteBarberia` **ACTIVO** en QA | Flujo de cliente (catálogo, reserva) dentro de la sede QA |

- **Contraseña por defecto (convención demo):** `Password123!`.
- La contraseña real es la definida en la variable `QA_USERS_PASSWORD` **al momento de ejecutar el seed** (el script nunca la imprime). Si el operador la cambió al sembrar producción, usar ese valor; de lo contrario, la de convención anterior.
- Las cuentas se crean con `telefonoVerificado: true` y `estadoCuenta: ACTIVO` para permitir login directo.

## 3) Pasos para iniciar sesión en producción (panel)

1. Abrir `https://barberias-platform.vercel.app/auth/login`.
2. Ingresar el **correo** de la cuenta sintética y la **contraseña QA** (ver §2).
3. Iniciar sesión. Si el flujo solicita seleccionar/confirmar sede, elegir **`Sede Sandbox QA`** (`QA2026`). El admin y el barbero operan en el ámbito de esa sede; el cliente está vinculado a ella.
4. Validar módulos objetivo (siempre dentro de QA):
   - **Admin sede QA:** gestión de la sucursal QA, usuarios/roles de la sede QA, supervisión de citas de la sede QA.
   - **Barbero QA:** bandeja de propuestas de horarios, supervisión/gestión de sus citas.
   - **Cliente QA:** creación/consulta de reservas y flujo de cliente sobre la sede QA.
5. Al terminar, cerrar sesión. No reutilizar estas cuentas para operar sedes reales.

## 4) Ejecución del seed en producción (Neon) — procedimiento seguro

> Requiere **autorización explícita**. El seed es idempotente y acotado al tenant QA, pero **escribe en la base de datos objetivo**. Nunca pegues `DATABASE_URL` ni secretos en el chat ni los guardes en archivos versionados.

**Prerrequisito:** los roles/permisos base deben existir (`npm run seed` ya aplicado). El seed QA aborta con un error claro si falta un rol.

Ejecutar desde un entorno seguro del operador (máquina local autorizada o shell controlado) con la `DATABASE_URL` de producción (Neon) inyectada **solo en esa sesión** y, si deseas fijar la contraseña QA, `QA_USERS_PASSWORD` (no se registra):

```bash
# En backend-barberias, con DATABASE_URL de PRODUCCIÓN (Neon) exportada en tu terminal segura:
CONFIRM_QA_SEED=YES APP_ENV=production QA_USERS_PASSWORD='<contraseña-QA-elegida>' npm run seed:qa
```

- `CONFIRM_QA_SEED=YES` es **obligatorio** cuando `APP_ENV`/`NODE_ENV` es `production` (salvaguarda anti-ejecución accidental).
- Re-ejecutable: actualiza/asegura solo el tenant QA y sus 3 cuentas; no toca otras sedes.
- Verificación embebida: el script **falla** si `admin.qa` tuviera rol global `ADMINISTRADOR` o si no quedaran asignados `ADMIN_BARBERIA`/`BARBERO` con `barberiaId` de QA.

> Nota operativa (Render plan free): no hay Shell en el dashboard. La opción controlada es ejecutar el comando anterior desde una máquina autorizada apuntando a la `DATABASE_URL` de Neon (secreto de `sync:false` en Render) en una sesión efímera. No crear archivos `.env` con esa URL en el repo; si usas un `.env` local temporal, mantenlo fuera de git y elimínalo tras el seed.

## 5) Restricciones de uso (obligatorias)
- **Solo** operar dentro de `Sede Sandbox QA` (`QA2026`) y con las 3 cuentas sintéticas. **Prohibido** realizar pruebas (y especialmente acciones destructivas/irreversibles) fuera de este tenant.
- No otorgar `ADMINISTRADOR` (global) a cuentas QA ni ampliar su alcance a otras sedes.
- No reutilizar correos/teléfonos de usuarios reales; no modificar usuarios, sedes, reservas, pagos ni configuración de producción fuera de QA.
- Los datos creados en QA (reservas/citas de prueba) son descartables pero **permanecen en la BD**; no ejecutar limpiezas masivas (`deleteMany` sin filtro de `barberiaId` QA).
- No exponer `DATABASE_URL`, `JWT_SECRET`, tokens ni contraseñas reales en capturas, logs compartidos o commits.

## 6) Verificación de seguridad y aislamiento (Tenant Isolation)

Aislamiento garantizado por diseño del código y reforzado por el seed:

1. **Sin privilegio global de plataforma (código + aserción del seed):** `admin.qa` **no** recibe `ADMINISTRADOR`. El seed verifica y aborta si existe `UsuarioRol` de `admin.qa` con rol `ADMINISTRADOR` y `barberiaId = null`. El admin QA solo tiene `ADMIN_BARBERIA` con `barberiaId` = sede QA.
2. **Scoping por rol a la sede (`RolesGuard` / `alcance`):** los permisos de sede se resuelven contra `UsuarioRol` por `barberiaId`. `ADMIN_BARBERIA`/`BARBERO` del tenant QA están ligados a `QA2026`; no satisfacen el alcance de ninguna otra sede.
3. **Pertenencia/vínculo obligatorio (`VinculoBarberiaGuard`):** para una `barberiaId` dada, el staff accede solo si existe `UsuarioRol` **ACTIVO** `(usuarioId, barberiaId)`; el cliente solo si existe `ClienteBarberia` **ACTIVA** `(usuarioId, barberiaId)` y la barbería está `ACTIVO`. `cliente.qa` solo está vinculado a QA; admin/barbero QA solo tienen rol en QA. El bypass de `ADMINISTRADOR` global no aplica porque **ninguna cuenta QA lo posee**.
4. **Datos de dominio acotados:** `Horario`, `ConfiguracionBarberia`, `Servicio`, `CategoriaServicio`/`ServicioBarbero` y `HorarioBarberia` del seed se crean/actualizan **solo** bajo la `barberiaId` de `QA2026`. Ninguna operación del seed lee ni modifica otras sedes.
5. **Comprobación recomendada en vivo (no destructiva):** con `admin.qa` autenticado, intentar leer/operar un recurso enviando el `x-barberia-id` (o contexto equivalente) de una sede real → debe responder **403** (sin vínculo/alcance) o denegado por rol; nunca exponer datos ajenos.

## 7) Referencias de implementación
- Seed QA (idempotente): `backend-barberias/prisma/seed-qa.ts` (`npm run seed:qa`).
- Roles/permisos base: `backend-barberias/prisma/seed.ts` (`npm run seed`).
- Guards de aislamiento: `backend-barberias/src/iam/infrastructure/vinculo-barberia.guard.ts`, `roles.guard.ts`, decorador `current-barberia`.
- Esquema: `backend-barberias/prisma/schema.prisma` (`UsuarioRol`, `ClienteBarberia`, `Barberia`, `Horario*`, `Servicio*`, `ConfiguracionBarberia`).