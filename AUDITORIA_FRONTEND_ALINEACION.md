# AUDITORÍA DE ALINEACIÓN FRONTEND ↔ BACKEND
**Proyecto:** Plataforma de Gestión de Barberías  
**Fecha:** 2026-10-19  
**Scope:** Auth, Reservas, Guards, Interceptores, Contratos de DTOs

---

## 1. RESUMEN DE INTEGRIDAD GENERAL

| Área | Estado | Observación |
|------|--------|-------------|
| Contrato Auth Login/Register | ✅ Alineado | Backend devuelve `{ accessToken, usuario }` en ambos flujos |
| Interfaz `UsuarioResponseDto` | ⚠️ Parcial | Frontend omite campo `creadoAt` expuesto por backend |
| Validación de contraseña | ❌ Desajuste | Regex y longitud mínima difieren entre componentes |
| Roles del sistema | ❌ Crítico | Frontend usa `ADMIN` y `ADMIN_BARBERIA` que no existen en backend |
| Tabla `token_recuperacion` | ❌ Crítico | `AuthService` la usa pero NO está en el DDL/schema de Prisma |
| Campo `tokenVersion` en BD | ❌ Crítico | `JwtStrategy` lo lee pero la tabla `usuarios` no lo tiene en el DDL |
| Canal `EMAIL` en notificaciones | ❌ Crítico | Viola el CHECK constraint del DDL (`APP`,`WHATSAPP`,`SMS` únicamente) |
| `CreateReservaDto.tipo` | ❌ Desajuste | Mezcla `tipo_reserva` con `modoConfirmacion` en el mismo campo |
| Manejo de 401 en interceptor | ✅ Correcto | Auto-logout implementado |
| Manejo de 403/409/422 | ❌ Ausente | Interceptor no diferencia 403, 409 ni 422 |
| Campo `cedula` en registro | ⚠️ Ausente | Backend soporta cédula opcional, formulario de registro no la incluye |
| Ruta `/auth/me` | ⚠️ No confirmado | Frontend la llama en `checkSession()` — necesita verificar `AuthController` |

**Nivel de riesgo global:** 🔴 **ALTO** — 4 errores críticos de tiempo de ejecución detectados.

---

## 2. TABLA DE DESAJUSTES DE CONTRATOS

### 2.1 Backend `UsuarioResponseDto` vs Frontend `auth.interface.ts`

| Campo | Backend (`@Expose()`) | Frontend interface | Estado |
|-------|----------------------|-------------------|--------|
| `id` | `string` | `string` | ✅ OK |
| `nombreCompleto` | `string` | `string` | ✅ OK |
| `correo` | `string` | `string` | ✅ OK |
| `telefono` | `string` | `string` | ✅ OK |
| `cedula` | `string \| null \| undefined` | `string \| undefined` | ⚠️ Parcial — backend puede devolver `null` |
| `estadoCuenta` | `string` | `string` | ✅ OK |
| `roles` | `string[]` | `string[]` | ✅ OK |
| **`creadoAt`** | `Date \| null` (**`@Expose()`**) | ❌ **AUSENTE** | ❌ Campo expuesto por backend no mapeado en frontend |
| `passwordHash` | excluido por `@Exclude()` | no declarado | ✅ OK |

**Archivo a corregir:** `src/app/auth/interfaces/auth.interface.ts`  
**Corrección:** Agregar `creadoAt?: Date | string | null;` a `UsuarioResponseDto`.

---

### 2.2 Backend `RegisterDto` vs Frontend `RegisterDto` interface + `registerForm`

| Campo | Backend DTO | Frontend interface | Formulario Angular | Estado |
|-------|-------------|-------------------|--------------------|--------|
| `nombreCompleto` | Requerido, max 150 | Requerido | Requerido, minLength(3) | ✅ OK |
| `correo` | Email válido, max 150 | Requerido | Validators.email | ✅ OK |
| `telefono` | Requerido, max 30 | Requerido | Requerido | ✅ OK |
| `password` | Requerido, min 8, regex letra+número | Requerido | min 8, **regex diferente** | ❌ Ver 3.1 |
| `cedula` | Opcional, solo dígitos | Opcional | **❌ NO EXISTE en el form** | ❌ Usuario no puede ingresar cédula |

---

### 2.3 Backend `CreateReservaDto` vs tipado frontend esperado

| Campo | Backend DTO | Estado |
|-------|-------------|--------|
| `tipo` | `@IsIn(['INDIVIDUAL', 'GRUPAL', 'AUTOMATICO', 'MANUAL'])` | ❌ Mezcla de concerns — schema BD solo acepta `INDIVIDUAL \| GRUPAL` para `tipo_reserva`; `AUTOMATICO` y `MANUAL` son valores de `modoConfirmacion` |
| `horaInicio/horaFin` | Regex `HH:mm` | ✅ OK |
| `precioTotalEsperado` | `@IsNumber @Min(0)` | ⚠️ El frontend debe enviar número, no string |
| `serviciosIds` | Solo requerido si `tipo !== 'GRUPAL'` | ✅ Validación condicional correcta |
| `participantes` | Array con `ValidateNested` | ✅ OK |

---

## 3. BRECHAS DE UX Y MANEJO DE ERRORES HTTP

### 3.1 Interceptor (`auth.interceptor.ts`)

```
Códigos manejados actualmente: 401 → auto logout
Códigos SIN manejo: 403, 409, 422, 500
```

| Código | Escenario | Comportamiento actual | Comportamiento esperado |
|--------|-----------|----------------------|------------------------|
| **401** | Token expirado o inválido | ✅ Auto-logout | ✅ Correcto |
| **403** | Usuario sin permiso para la acción | ❌ Silencioso — el componente recibe el error sin contexto | Mostrar mensaje "No tienes permiso para esta acción" |
| **409** | Conflicto de concurrencia en reservas | ❌ Silencioso | Mostrar "El horario fue tomado simultáneamente. Intenta de nuevo." |
| **409** | Correo/cédula/teléfono duplicado | ❌ Mostrado solo si el componente maneja `catchError` | ✅ Los componentes de auth ya lo manejan con `catchError` — pero inconsistentemente |
| **422** | Validación de negocio rechazada | ❌ Silencioso | Mostrar el `message` del error al usuario |
| **500** | Error interno del servidor | ❌ Silencioso | Mostrar "Error del servidor. Intenta más tarde." |

**Archivo a corregir:** `src/app/auth/auth.interceptor.ts`

---

### 3.2 Login component — MinLength de contraseña

- Frontend `loginForm.password`: `Validators.minLength(6)`
- Backend `LoginDto`: NO tiene `@MinLength` — acepta cualquier longitud.
- **Consecuencia:** Un usuario con contraseña de 7 caracteres verá el formulario bloqueado en Angular aunque el backend la acepte perfectamente. Esto crea un **false positive de validación** que impide el login.

**Archivo a corregir:** `src/app/auth/login/login.component.ts`  
**Corrección:** Cambiar `minLength(6)` → `minLength(8)` para ser consistente con el `RegisterDto` del backend, o eliminar la restricción del `loginForm` (ya que el backend no la valida en login).

---

## 4. INCONSISTENCIAS DE VALIDACIÓN

### 4.1 Regex de contraseña (CRÍTICO para UX)

| Contexto | Regex / Regla |
|----------|--------------|
| **Backend** `RegisterDto` | `/^(?=.*[A-Za-z])(?=.*\d).+$/` → letra + dígito (sin distinción mayúscula/minúscula) |
| **Frontend** `register.component.ts` | `/((?=.*\d)\|(?=.*\W+))(?![.\n])(?=.*[A-Z])(?=.*[a-z]).*$/` → upper + lower + (dígito **O** especial) |

**Caso de fallo:** El usuario escribe `Hola1234` → **backend lo acepta**, **frontend lo rechaza** (porque la regex del frontend exige upper + lower + dígito pero la interpreta diferente). Esto genera un registro imposible: el formulario nunca se envía aunque la contraseña sea válida según las reglas del negocio.

**Corrección:** Unificar ambas reglas. La del backend es la fuente de verdad. Reemplazar en el componente:
```typescript
// Incorrecto (frontend)
Validators.pattern(/((?=.*\d)|(?=.*\W+))(?![.\n])(?=.*[A-Z])(?=.*[a-z]).*$/)
// Correcto (alineado con backend)
Validators.pattern(/^(?=.*[A-Za-z])(?=.*\d).+$/)
```
**Archivo:** `src/app/auth/register/register.component.ts`

---

### 4.2 Roles — Nombres inconsistentes

| Rol en backend (seed) | Usado en frontend | Problema |
|----------------------|-------------------|---------|
| `CLIENTE` | `CLIENTE` | ✅ OK |
| `BARBERO` | `BARBERO` | ✅ OK |
| `ADMINISTRADOR` | `ADMINISTRADOR`, `ADMIN`, `ADMIN_BARBERIA` | ❌ `ADMIN` y `ADMIN_BARBERIA` no existen en el seed |

**Archivos afectados:**
- `src/app/auth/auth.service.ts` (líneas de routing post-login)
- `src/app/core/guards/role.guard.ts` (mapeo de `ADMIN`)

**Riesgo:** Un usuario con rol `ADMINISTRADOR` puede no ser redirigido correctamente si la lógica depende del string exacto, o puede quedar sin acceso si el guard busca `ADMIN` y el JWT solo trae `ADMINISTRADOR`.

---

### 4.3 Campo `cedula` — validación solo de longitud, sin formato dominicano

- Backend: `@Matches(/^\d+$/)` + `@MaxLength(30)` — solo dígitos, máximo 30.
- Frontend: campo no existe en el formulario.
- **Consecuencia:** Imposible registrar cédula desde el UI aunque el backend la soporte.

---

## 5. ERRORES CRÍTICOS DE TIEMPO DE EJECUCIÓN

### 🔴 ERROR 1 — Tabla `token_recuperacion` no existe en el schema de Prisma

**Archivo:** `src/iam/application/auth.service.ts` (métodos `forgotPassword` y `resetPassword`)  
**Código problemático:**
```typescript
await this.prisma.tokenRecuperacion.updateMany(...)
await this.prisma.tokenRecuperacion.create(...)
await this.prisma.tokenRecuperacion.findUnique(...)
```
**Diagnóstico:** La tabla `token_recuperacion` no está definida en el DDL original ni en `schema.prisma`. El cliente de Prisma generado no tendrá esta propiedad — el código fallará con `TypeError: Cannot read properties of undefined`.

**Remediación:** Agregar el modelo a `schema.prisma` y correr una nueva migración:
```prisma
model TokenRecuperacion {
  id         String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  usuarioId  String   @map("usuario_id") @db.Uuid
  tokenHash  String   @unique @map("token_hash") @db.VarChar(64)
  expiraAt   DateTime @map("expira_at") @db.Timestamptz
  usado      Boolean  @default(false)
  creadoAt   DateTime @default(now()) @map("creado_at") @db.Timestamptz
  usuario    Usuario  @relation(fields: [usuarioId], references: [id], onDelete: Cascade)
  @@map("tokens_recuperacion")
}
```
Y agregar la relación inversa en el modelo `Usuario`.

---

### 🔴 ERROR 2 — Campo `tokenVersion` no existe en la tabla `usuarios`

**Archivo:** `src/iam/infrastructure/jwt.strategy.ts`  
**Código problemático:**
```typescript
select: { tokenVersion: true, ... }
// y luego:
if ((payload.tv ?? 0) !== usuario.tokenVersion) { ... }
```
**Diagnóstico:** El DDL de `usuarios` no define un campo `token_version`. El payload del JWT incluye `tv?: number` pero no hay campo en BD para compararlo — la consulta de Prisma fallará.

**Remediación:** Agregar a `schema.prisma` en el modelo `Usuario`:
```prisma
tokenVersion Int @default(0) @map("token_version")
```
Y ejecutar migración: `npx prisma migrate dev --name add_token_version`.

---

### 🔴 ERROR 3 — Canal `EMAIL` viola CHECK constraint de la tabla `notificaciones`

**Archivo:** `src/iam/application/auth.service.ts` (método `forgotPassword`)  
**Código problemático:**
```typescript
await this.prisma.notificacion.create({
  data: { canal: 'EMAIL', ... }
});
```
**Diagnóstico:** El DDL define `canal VARCHAR(20) CHECK (canal IN ('APP','WHATSAPP','SMS'))`. El valor `'EMAIL'` viola el constraint — PostgreSQL rechazará el INSERT con un error 23514 no mapeado.

**Remediación (2 opciones):**
- **Opción A (recomendada):** Cambiar `canal: 'EMAIL'` → `canal: 'APP'` y gestionar el envío del correo fuera de la tabla de notificaciones (cola BullMQ).
- **Opción B:** Modificar el DDL para agregar `'EMAIL'` al CHECK constraint + migración.

---

### 🔴 ERROR 4 — `iam.config.ts` referenciado pero no auditado

**Archivos afectados:** `jwt.strategy.ts` e `iam.module.ts` importan `getJwtSecret()` de `'../iam.config.js'`  
**Diagnóstico:** Este archivo no fue incluido en el análisis. Si no existe o no exporta correctamente `getJwtSecret()`, el módulo fallará al levantar la aplicación.

**Acción requerida:** Verificar existencia y contenido de `src/iam/iam.config.ts`.

---

## 6. PLAN DE REMEDIACIÓN PRIORIZADO

| Prioridad | Error | Archivo(s) a modificar | Tipo de cambio |
|-----------|-------|------------------------|----------------|
| 🔴 P0 | ERROR 1: Tabla `token_recuperacion` inexistente | `prisma/schema.prisma` + migración | Agregar modelo Prisma + migrar |
| 🔴 P0 | ERROR 2: Campo `tokenVersion` inexistente en `usuarios` | `prisma/schema.prisma` + migración | Agregar campo + migrar |
| 🔴 P0 | ERROR 3: `canal: 'EMAIL'` viola CHECK constraint | `src/iam/application/auth.service.ts` | Cambiar a `'APP'` o modificar DDL |
| 🔴 P0 | ERROR 4: Verificar `iam.config.ts` | `src/iam/iam.config.ts` | Crear/verificar archivo |
| 🔴 P1 | Regex contraseña diferente Backend vs Frontend | `src/app/auth/register/register.component.ts` | Cambiar regex a `/^(?=.*[A-Za-z])(?=.*\d).+$/` |
| 🔴 P1 | `minLength(6)` en login vs backend sin mínimo | `src/app/auth/login/login.component.ts` | Cambiar a `minLength(8)` o eliminar |
| 🟡 P2 | Roles `ADMIN` / `ADMIN_BARBERIA` inexistentes | `src/app/auth/auth.service.ts` + `src/app/core/guards/role.guard.ts` | Unificar a `ADMINISTRADOR` |
| 🟡 P2 | Campo `creadoAt` ausente en interfaz frontend | `src/app/auth/interfaces/auth.interface.ts` | Agregar `creadoAt?: Date \| string \| null` |
| 🟡 P2 | `CreateReservaDto.tipo` mezcla concerns | `src/reserva/application/dto/create-reserva.dto.ts` | Separar `tipo` (`INDIVIDUAL\|GRUPAL`) de `modoConfirmacion` |
| 🟢 P3 | Manejo de 403/409/422/500 en interceptor | `src/app/auth/auth.interceptor.ts` | Agregar casos al `catchError` |
| 🟢 P3 | Campo `cedula` ausente en formulario de registro | `src/app/auth/register/register.component.ts` | Agregar campo opcional al formulario |
| 🟢 P3 | `cedula?: string \| null` no tipado correctamente | `src/app/auth/interfaces/auth.interface.ts` | Cambiar a `cedula?: string \| null` |

---

## 7. ARCHIVOS A TOCAR — RESUMEN EJECUTIVO

### Backend
```
prisma/schema.prisma
  → Modelo TokenRecuperacion (P0)
  → Campo tokenVersion en Usuario (P0)

src/iam/application/auth.service.ts
  → canal 'EMAIL' → 'APP' en forgotPassword (P0)

src/iam/iam.config.ts
  → Verificar existencia y exportación de getJwtSecret() (P0)

src/reserva/application/dto/create-reserva.dto.ts
  → Separar tipo_reserva de modoConfirmacion (P2)
```

### Frontend
```
src/app/auth/interfaces/auth.interface.ts
  → Agregar creadoAt (P2)
  → Corregir cedula?: string | null (P3)

src/app/auth/register/register.component.ts
  → Corregir regex de contraseña (P1)
  → Agregar campo cedula (P3)

src/app/auth/login/login.component.ts
  → Corregir minLength contraseña de 6 → 8 (P1)

src/app/auth/auth.service.ts
  → Unificar nombres de roles (P2)

src/app/core/guards/role.guard.ts
  → Eliminar 'ADMIN' y 'ADMIN_BARBERIA', usar solo 'ADMINISTRADOR' (P2)

src/app/auth/auth.interceptor.ts
  → Manejar 403, 409, 422, 500 (P3)
```