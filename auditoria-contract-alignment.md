# AUDITORÍA TÉCNICA EXHAUSTIVA: Alineación Frontend-Backend
**Proyecto:** Barberias Platform  
**Frontend:** Angular (TypeScript)  
**Backend:** NestJS + TypeScript + Prisma  
**Fecha de Auditoría:** 2025-10-19  

---

## 1. RESUMEN EJECUTIVO

El análisis revela una alineación general aceptable en la mayoría de endpoints de lectura y operaciones CRUD, pero existen **desalineamientos críticos** que bloquearían flujos de negocio en producción, principalmente en la creación de reservas y el contrato de respuesta del registro de usuarios.

**Nivel de Riesgo General:** **ALTO (25% de desalineación crítica)**  
**Grado de Coincidencia Estimado:** **75%**  

**Hallazgos críticos (Bloqueantes):**
1. **[CRÍTICO]** Contrato de registro (`POST /auth/register`): Backend retorna solo `UsuarioResponseDto`, Frontend espera `AuthResponseDto` con `accessToken`.
2. **[CRÍTICO]** DTO de creación de reserva: Backend requiere campo obligatorio `tipo`, Frontend no lo envía.
3. **[ALTO]** Tipos de `password` en DTOs de Auth: marcado como opcional en interfaces del frontend vs obligatorio en backend.

**Hallazgos menores/observaciones:** Manejo de errores consistente, interceptores bien configurados (auth + tenant), CORS y headers alineados.

---

## 2. MATRIZ DE DISCREPANCIAS / HALLAZGOS CRÍTICOS

| Módulo/Archivo Frontend | Controlador/DTO Backend | Desajuste Exacto | Impacto Potencial |
|---|---|---|---|
| `frontend-barberias/src/app/auth/interfaces/auth.interface.ts` (RegisterDto, líneas 11-16) | `backend-barberias/src/iam/application/dto/register.dto.ts` (RegisterDto) | Frontend define `password?: string` (opcional), Backend requiere `password: string` con validaciones estrictas (@IsNotEmpty, @MinLength(8), patrón letra+número) | Confusión de tipos TypeScript. No bloquea runtime si siempre se envía, pero genera falsa seguridad de tipos y dificulta detección temprana de errores. |
| `frontend-barberias/src/app/auth/interfaces/auth.interface.ts` (LoginDto, líneas 18-21) | `backend-barberias/src/iam/application/dto/login.dto.ts` (LoginDto) | Frontend define `password?: string` (opcional), Backend define `password: string` (@IsNotEmpty, @MaxLength(72)) | Mismo caso anterior. Discrepancia de contrato de tipos. |
| `frontend-barberias/src/app/auth/auth.service.ts:60-90` (método `register`) | `backend-barberias/src/iam/infrastructure/auth.controller.ts:52-63` (POST `/auth/register`) + `auth.service.ts:92-167` | **CRÍTICO.** Backend retorna `Promise<UsuarioResponseDto>` (solo usuario, sin token). Frontend espera `AuthResponseDto` y hace `this.setToken(response.accessToken)`, lo cual será `undefined`. Además el componente navega asumiendo sesión activa. | **Bloqueante.** Tras registrarse, el token no se guarda, el usuario queda en estado inconsistente (authState marcado como autenticado false/true incorrectamente), redirecciones fallidas o el usuario aparecerá como no autenticado. Flujo de registro completamente roto. |
| `frontend-barberias/src/app/auth/auth.service.ts:103-151` (método `login`) | `backend-barberias/src/iam/infrastructure/auth.controller.ts:75-89` (POST `/auth/login`) | **ALINEADO.** Frontend espera `{ accessToken, usuario }` y backend retorna exactamente eso. Correcto. | N/A |
| `frontend-barberias/src/app/core/services/reservas.service.ts:15-31` (CrearReservaDto) | `backend-barberias/src/reserva/application/dto/create-reserva.dto.ts` (CreateReservaDto, líneas 65-140) | **CRÍTICO.** Backend requiere `tipo: string` (@IsNotEmpty, @IsIn(['INDIVIDUAL','GRUPAL','AUTOMATICO','MANUAL'])). Frontend no incluye este campo en `CrearReservaDto`. Validación global (whitelist + forbidNonWhitelisted) rechazará el payload con 400 Bad Request. | **Bloqueante.** Creación de reservas (tanto individual como walk-in) fallará sistemáticamente en producción. El frontend no cumple con el contrato estricto de validación del backend. |
| `frontend-barberias/src/app/core/services/reservas.service.ts:55-91` (crearReserva/crearReservaWalkIn) | `backend-barberias/src/reserva/infrastructure/reserva.controller.ts` (rutas POST `/reservas`, POST `/reservas/walk-in`) | **ALINEADO EN RUTA/MÉTODO.** Rutas y verbos HTTP coinciden (`POST /reservas`, `POST /reservas/walk-in`). Solo falla el payload (campo `tipo` faltante). | Depende de corrección del DTO. |
| `frontend-barberias/src/app/core/services/pagos.service.ts:35-89` (obtenerHistorial, anularPago) | `backend-barberias/src/pago/infrastructure/pago.controller.ts` (GET `/cobros/historial`, POST `/cobros/:id/anular`) | **ALINEADO.** Endpoints, params, query (`page`, `pageSize`) y payloads coinciden. El frontend lee `res.data` del wrapper (map res => res.data) lo cual asume estructura paginada - verificar respuesta backend. Backend retorna objeto con data/total/page/pageSize (según implementación en service). | OK. |
| `frontend-barberias/src/app/core/services/tenant.service.ts` | `backend-barberias/src/iam/infrastructure/current-barberia.decorator.ts` | **ALINEADO.** Frontend envía `x-barberia-id` vía interceptor (auth.interceptor.ts:19-33), backend lee cabecera `x-barberia-id` (case-insensitive, acepta array). Coincidencia perfecta. | OK. |
| `frontend-barberias/src/app/auth/auth.interceptor.ts:1-47` | Backend (JWT Strategy, Guards) | **ALINEADO.** Agrega `Authorization: Bearer ${token}` consistentemente. Manejo de 401 para logout automático correcto. | OK. |
| `frontend-barberias/src/app/core/services/mi-estado.service.ts`, tenant.service.ts (listados de barberías cliente) | `backend-barberias/src/barberia/infrastructure/mi-estado-barberias.controller.ts` (GET `/mi-estado/barberias`) + cambios H72 en GET `/barberias` | **ALINEADO.** Frontend consulta `/mi-estado/barberias` para cliente (según tenant.service.ts:64-90 en lógica de fallback). Backend expone correctamente esa ruta con guard CLIENTE. | OK. |

---

## 3. PLAN DE REMEDIACIÓN CONCRETO

### 3.1 [CRÍTICO] Corregir contrato de respuesta en registro

**Decisión:** Determinar si el registro debe auto-loguear al usuario (retornar token) o requerir login posterior. Revisando el flujo del frontend (`register` navega tras recibir respuesta y guarda token), el diseño esperado es **auto-login tras registro**.

**Opción A: Backend retorna token + usuario (recomendado para UX)**  
Modificar `AuthService.register()` para generar y retornar accessToken.

**Antes (Backend - auth.service.ts:92-167):**
```typescript
async register(dto: RegisterDto): Promise<UsuarioResponseDto> {
  // ... creación de usuario ...
  return plainToInstance(UsuarioResponseDto, {
    ...usuario,
    roles: ['CLIENTE'],
  });
}
```

**Después (Backend):**
```typescript
async register(dto: RegisterDto): Promise<{ accessToken: string; usuario: UsuarioResponseDto }> {
  // ... creación de usuario (transacción) ...
  
  const usuarioConRoles = plainToInstance(UsuarioResponseDto, {
    ...usuario,
    roles: ['CLIENTE'],
  });
  
  const payload: JwtPayload = {
    sub: usuario.id,
    correo: usuario.correo,
    roles: ['CLIENTE'],
  };
  const accessToken = this.jwtService.sign(payload);
  
  return { accessToken, usuario: usuarioConRoles };
}
```

**También actualizar AuthController.register() (líneas 52-63):**
```typescript
@Post('register')
@HttpCode(HttpStatus.CREATED)
async register(@Body() dto: RegisterDto): Promise<{ accessToken: string; usuario: UsuarioResponseDto }> {
  return this.authService.register(dto);
}
```

**Opción B: Frontend cambia a no esperar token (requiere login tras registro)**
```typescript
// Frontend register() - alternativa
register(data: RegisterDto, returnUrl?: string | null): Observable<any> {
  this.updateState({ isLoading: true, error: null });
  return this.http.post<any>(`${this.apiUrl}/register`, data).pipe(
    tap(() => {
      this.updateState({ isLoading: false });
      // Redirigir a login con returnUrl
      this.router.navigate(['/login'], { queryParams: { returnUrl } });
    }),
    catchError(...)
  );
}
```

**Recomendación:** Opción A. Mantiene UX actual y evita romper flujos existentes.

---

### 3.2 [CRÍTICO] Añadir campo `tipo` a DTO de creación de reserva (Frontend)

**Antes (Frontend - reservas.service.ts:15-31):**
```typescript
export interface CrearReservaDto {
  fecha: string;
  horaInicio: string;
  horaFin: string;
  serviciosIds: string[];
  precioTotalEsperado: number;
  barberoId?: string | null;
  nombreInvitado?: string;
}
```

**Después (Frontend):**
```typescript
export type TipoReserva = 'INDIVIDUAL' | 'GRUPAL' | 'AUTOMATICO' | 'MANUAL';

export interface CrearReservaDto {
  fecha: string;
  horaInicio: string;
  horaFin: string;
  serviciosIds: string[];
  precioTotalEsperado: number;
  barberoId?: string | null;
  nombreInvitado?: string;
  tipo: TipoReserva;
}
```

**Actualizar llamadas:**
- Para reservas individuales (cliente): `tipo: 'INDIVIDUAL'`
- Para walk-in (agenda staff): `tipo: 'MANUAL'` o según lógica de negocio

Verificar en componentes que usan `crearReserva()` y `crearReservaWalkIn()`.

---

### 3.3 [ALTO] Corregir tipos opcionales de password en interfaces Auth

**Antes (Frontend - auth.interface.ts):**
```typescript
export interface RegisterDto {
  correo: string;
  password?: string;
  nombreCompleto: string;
  telefono: string;
}

export interface LoginDto {
  correo: string;
  password?: string;
}
```

**Después (Frontend):**
```typescript
export interface RegisterDto {
  correo: string;
  password: string;
  nombreCompleto: string;
  telefono: string;
  cedula?: string; // Añadir para consistencia con backend
}

export interface LoginDto {
  correo: string;
  password: string;
}
```

Alinear tipos con validaciones del backend mejora seguridad de tipos y evita envíos inválidos.

---

### 3.4 [MEDIO] Verificar estructura de respuesta paginada en historial de pagos

Frontend hace `map(res => res.data || [])` asumiendo wrapper `{ data, total, page, pageSize }`. Backend `listarHistorial` retorna ese formato (visto en service). **Alineado.** Solo verificar que el tipo `PagoHistorial` coincide con lo que retorna backend (revisar DTOs de respuesta si existen). No requiere cambio inmediato.

---

## 4. CONCLUSIONES

1. **Bloqueantes identificados:** 2 (register sin token, falta campo `tipo` en reservas). Requieren corrección **antes de producción**.
2. **Backend más estricto que Frontend:** Uso correcto de ValidationPipe (whitelist/forbidNonWhitelisted) - esto expone desalineamientos temprano (correcto desde seguridad).
3. **Autenticación y RBAC:** Muy bien alineados (JWT, x-barberia-id, guards). Excelente.
4. **Manejo de errores:** Frontend intercepta 401 correctamente, mapea mensajes del backend (`err.error?.message || err.error?.mensaje`). Consistente.
5. **Recomendación general:** Corregir los 3 puntos (3.1, 3.2, 3.3). Tras eso, alineación pasa a **~95%** con riesgo **BAJO**.

**Estado de Salud:** Requiere remediación crítica inmediata en 2 puntos antes de desplegar a producción. El resto del sistema presenta excelente alineación contract-first.