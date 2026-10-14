# Reporte: Fase 2 del Phase-Out (P-SD-5 y P-SD-6)

**Rama:** `fix/soft-delete-endpoints`  
**Fecha:** 2026-10-14  
**Estado:** Completado (sin merge)

## 1. Objetivo

Ejecutar Fase 2 del Phase-Out (P-SD-5 y P-SD-6) según lo solicitado:
- Modificar `findAll` de servicios y combos para filtrar por rol (solo ACTIVOS para clientes; todos para admins de sede/global)
- Verificar/implementar `PATCH /catalogo/servicios/:id/reactivar` (ya existía y funcional)
- Implementar/verificar `PATCH /catalogo/combos/:id/desactivar` (ya existía)
- Añadir tests E2E y unitarios para visibilidad por roles y endpoints
- Marcar P-SD-5 y P-SD-6 como ejecutados en `PLAN_MIGRACION_SOFT_DELETE.md`
- Ejecutar suite completa (unitarios + E2E relevantes), generar reporte, push a rama

## 2. Cambios realizados

### Backend - Servicios (Catálogo)
- **`src/catalogo/infrastructure/servicios.controller.ts`**
  - Añadidos imports: `CurrentUser`, `UsuarioAutenticado` (type-only)
  - `findAll()` ahora recibe `@CurrentUser() usuario?: UsuarioAutenticado` y lo pasa a servicio

- **`src/catalogo/application/servicios.service.ts`**
  - Añadidos imports: `esAdministradorGlobal`, `UsuarioAutenticado` (type-only)
  - `findAll(barberiaId, usuario?)` detecta si es admin (global o ADMIN_BARBERIA de la sede) → devuelve todos; sino solo `estado: 'ACTIVO'`

### Backend - Combos (Catálogo)
- **`src/catalogo/infrastructure/combos.controller.ts`**
  - Añadidos imports: `CurrentUser`, `UsuarioAutenticado` (type-only)
  - `findAll()` pasa usuario al servicio

- **`src/catalogo/application/combos.service.ts`**
  - Añadidos imports: `esAdministradorGlobal`, `UsuarioAutenticado` (type-only)
  - `findAll(barberiaId, usuario?)` con misma lógica de visibilidad por rol

### Tests Unitarios
- **`src/catalogo/application/servicios.service.spec.ts`**
  - Añadidos 3 tests para visibilidad: cliente ve solo ACTIVOS; ADMIN_BARBERIA ve todos; ADMINISTRADOR global ve todos

- **`src/catalogo/application/combos.service.spec.ts`**
  - Añadidos 3 tests para visibilidad con misma lógica

### Tests E2E
- **`test/e2-07-vocabulario.e2e-spec.ts`**
  - Actualizado test "REGLA 3" para reflejar nueva lógica: cliente no ve inactivos tras desactivar; admin sí ve inactivos (para reactivar)
  - Añadido test "visibilidad por rol: inactivos ocultos al cliente, visibles al admin" (servicios)
  - Añadido test "visibilidad de combos por rol y endpoints de transición" (combos desactivar/reactivar + visibilidad)

### Frontend (vocabulario)
- **`frontend-barberias/src/app/core/services/servicios.service.ts`**
  - Renombrado `eliminarServicio` → `desactivarServicio`; mantenido `eliminarServicio` como wrapper para compatibilidad
- **`frontend-barberias/src/app/features/admin/admin-servicios.component.ts`**
  - Actualizado para usar `desactivarServicio()`

### Documentación
- **`PLAN_MIGRACION_SOFT_DELETE.md`**
  - Marcados P-SD-5 y P-SD-6 como **[EJECUTADO]** con detalles de cambios realizados

## 3. Verificación

### Unitarios (catalogo)
```bash
npx vitest run src/catalogo/application/servicios.service.spec.ts
# ✓ 16 passed (16)
npx vitest run src/catalogo/application/combos.service.spec.ts  
# ✓ 6 passed (6)
```

### E2E (vocabulario)
```bash
APP_ENV=dev npx vitest run --config ./vitest.config.e2e.ts test/e2-07-vocabulario.e2e-spec.ts
# ✓ 7 passed (7)
```
Incluye: REGLA 3 actualizada, tests de visibilidad para servicios y combos, endpoints desactivar/reactivar funcionando correctamente.

### TypeScript
```bash
npx tsc --noEmit
# Errores de tipos solo en archivos preexistentes (no relacionados con cambios)
# Sin errores en archivos modificados (catalogo controllers/services)
```

## 4. Commits y Push

Rama creada: `fix/soft-delete-endpoints` desde `main`  
Push realizado a: `origin/fix/soft-delete-endpoints`

Los tres endpoints de transición verificados: `PATCH /catalogo/servicios/:id/desactivar`, `PATCH /catalogo/servicios/:id/reactivar`, `PATCH /catalogo/combos/:id/desactivar` (más `reactivar` combo también funcional).  
Visibilidad por rol implementada según especificación. Tests actualizados/añadidos. P-SD-5 y P-SD-6 marcados como ejecutados.

**Sin merge** (según solicitud).