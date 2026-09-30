# COMPARACIÓN COMPLETA: DISEÑO ORIGINAL vs. SISTEMA REALMENTE CONSTRUIDO

Este documento confronta, punto por punto, el diseño arquitectónico y de negocio original contra la implementación real actual en el código fuente y el sistema desplegado en producción, siguiendo un rigor probatorio absoluto.

## 1. ARQUITECTURA GENERAL Y DEPLIEGUE

| Componente / Característica | Diseño Original (PLAN_ESTRATEGICO...) | Implementación Real (Código/Producción) | Veredicto | Evidencia / Cita |
| :--- | :--- | :--- | :--- | :--- |
| **Backend** | NestJS | NestJS v11.0 | IGUAL | `backend-barberias/package.json:L22` |
| **Frontend** | Angular | Angular v19.1 | IGUAL | `frontend-barberias/package.json:L18` |
| **Base de Datos** | PostgreSQL (Neon DB) | PostgreSQL (vía Prisma y Neon DB) | IGUAL | `backend-barberias/prisma/schema.prisma:L3` |
| **Región de Despliegue** | Ohio (us-east-2) para ambos (Backend y BD) | Backend en Render (Ohio) | DESVIACIÓN | `render.yaml:L5` indica `region: ohio`. Sin embargo, frontend está en Vercel (`vercel.json`) sin región fijada en código, asumiendo borde global. |
| **Cola de Mensajes / Background** | BullMQ + Redis | BullMQ + Redis implementado | IGUAL | `backend-barberias/src/app.module.ts:L36` (`BullModule.forRoot`) |
| **Caché / Throttling** | Redis / ThrottlerGuard | ThrottlerGuard con IORedis | IGUAL | `backend-barberias/src/app.module.ts:L26` y `L62` |

## 2. ESQUEMA DE BASE DE DATOS Y CONSTRAINTS

| Entidad / Campo | Diseño Original (Reglas) | Implementación Real | Veredicto | Evidencia / Cita |
| :--- | :--- | :--- | :--- | :--- |
| **`Usuario.cedula`** | Opcional, pero UNIQUE si existe. | `cedula String? @unique` | IGUAL | `schema.prisma:L22` |
| **`Usuario.password`** | Hash bcrypt 12 rondas mínimo. | Se usa bcrypt 10 rondas (por rendimiento PERF-01). | DESVIACIÓN | `auth.service.ts:L28` (`private readonly BCRYPT_ROUNDS = 10;`) |
| **Múltiples Roles por Usuario** | Soporte vía tabla intermedia `UsuarioRol`. | Implementado `UsuarioRol`. | IGUAL | `schema.prisma:L39` |
| **`Barberia.estado`** | ENUM ('ACTIVA', 'INACTIVA', 'SUSPENDIDA') | Definido en Prisma (`EstadoBarberia`) | IGUAL | `schema.prisma:L106` |
| **Constraints CHECK (BD)** | CHECK nativos en PostgreSQL (ej. estados válidos) | Ausentes en migraciones SQL. Se manejan a nivel de aplicación (NestJS/Prisma Enums). | DESVIACIÓN | Ausencia de instrucciones `ADD CONSTRAINT ... CHECK` en `prisma/migrations/*/migration.sql` |
| **`Reserva.estado`** | ENUM estricto (PENDIENTE, CONFIRMADA...) | `EstadoReserva` Enum. | IGUAL | `schema.prisma:L359` |
| **Borrado Lógico** | Implementado en entidades principales | Ausente en `Usuario`, pero implementado en otros esquemas. | DESVIACIÓN | `Usuario` no tiene campo `deletedAt` (`schema.prisma:L16-30`). |

## 3. MODELO DE CONCURRENCIA Y PAGOS

| Característica | Diseño Original | Implementación Real | Veredicto | Evidencia / Cita |
| :--- | :--- | :--- | :--- | :--- |
| **Bloqueos de Reservas** | Aislamiento `SERIALIZABLE` para evitar colisiones (40001). | Implementado `withSerializableTransaction`. | IGUAL | `pago.service.ts:L89` y `reserva.service.ts` usan el helper. |
| **Manejo de reintentos 40001** | Backoff exponencial automático. | Implementado en helper de concurrencia. | IGUAL | `shared/concurrency/serializable-transaction.ts` maneja retries automáticos si el código de error es P2034/40001. |
| **Auditoría Inmutable (Pagos)** | Registro atómico de auditoría al confirmar pago. | Implementado. | IGUAL | `pago.service.ts:L165` registra en `Auditoria` dentro de la misma transacción. |
| **Retorno Paginado (Frontend Crash)**| Backend debía retornar `{ data, total }`. | Backend retorna `{ data, total }`, frontend fallaba al no extraer `data`. | DESVIACIÓN | (Corregido en F-4) `pagos.service.ts:L40` (`map(res => res.data || [])`). |

## 4. CONTROL DE ACCESO Y COMPORTAMIENTO POR ROL (CRÍTICO)

### 4.1 Simulación Real contra Sistema Desplegado

Se ejecutó un análisis de respuesta HTTP directa hacia los endpoints de producción (Vercel Frontend y Render Backend) utilizando los perfiles `admin@demo.com`, `barbero@demo.com`, y `cliente@demo.com`.

| Escenario | Comportamiento Esperado | Comportamiento Real Observado | Veredicto |
| :--- | :--- | :--- | :--- |
| **Login Redirect Frontend** | Redirección a dashboard específico por rol (`/admin/agenda`, etc.) | **Todos los roles son redirigidos a `/` (Home/Cliente)** si tienen barberías vinculadas. | DESVIACIÓN CRÍTICA |
| **Acceso a `/catalogo/servicios` (API)** | `403 Forbidden` para CLIENTE. | **`400 Bad Request` para CLIENTE.** El guard de roles es ignorado. | DESVIACIÓN CRÍTICA |
| **Acceso a `/reservas/agenda` (API)** | `403 Forbidden` para CLIENTE. | **`200 OK` para CLIENTE.** El endpoint expone la agenda. | DESVIACIÓN CRÍTICA |
| **Acceso a `/auditoria` (API)** | `403 Forbidden` para CLIENTE/BARBERO. | **`403 Forbidden` para CLIENTE/BARBERO.** (`200 OK` para Admin). | IGUAL |

### 4.2 Diagnóstico de la Causa Raíz

1. **Problema de Redirección Frontend (Falso Positivo en Pruebas Previas)**:
   - **Causa Analizada**: En `frontend-barberias/src/app/auth/auth.service.ts:L101-125`, los bloques lógicos para `isAdmin` e `isBarbero` tienen hardcodeado un redirect a `['/']` si el usuario tiene barberías asignadas (`if (barberias.length > 0) this.router.navigate(['/']);`).
   - **Por qué no funcionaba antes**: Vercel Authentication (SSO) estaba interceptando la ruta `/api/v1/auth/login` (cuando el frontend llamaba a Vercel en vez de Render), devolviendo un HTML de protección (401), lo cual causaba que `response.usuario` fuera `undefined`, evaluando todos los roles a false. Al corregirse la URL de la API a Render, la lógica defectuosa del frontend entró en acción, demostrando que **nunca existió una redirección a dashboards administrativos en el código**.

2. **Vulnerabilidad Backend - Omisión de RolesGuard**:
   - **Evidencia**: Mediante análisis de código transversal, se demostró que el decorador `@Roles(...)` se usa exhaustivamente en controladores (`ServiciosController`, `ReservaController`, etc.), pero el `RolesGuard` **no está registrado de forma global** en `app.module.ts`.
   - **Impacto**: El decorador `@Roles()` actúa como metadatos inertes. A excepción de `AuditoriaController` (el único que incluye explícitamente `@UseGuards(RolesGuard)` en `auditoria.controller.ts:L7`), **todos los demás endpoints del sistema carecen de validación de roles a nivel de controlador**. Por lo tanto, un CLIENTE con JWT válido es autorizado por el `JwtAuthGuard` global y su petición es procesada.
   - **Nota**: Algunos servicios (como `PagoService`) validan el acceso manualmente dentro de su lógica (`this.validateAccess(...)`), mitigando el impacto en flujos transaccionales críticos, pero la exposición de datos de agenda y creación de catálogo permanecen vulnerables.
