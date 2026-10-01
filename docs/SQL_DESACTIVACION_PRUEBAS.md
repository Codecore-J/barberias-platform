# SQL para Desactivación de Cuentas de Prueba

Este script debe ejecutarse directamente en el editor SQL de Neon sobre la base de datos de `staging`.

### 1. SELECT previo (Verificación)
```sql
SELECT u.email, r.nombre as rol, ur.barberia_id, u.estado_cuenta
FROM usuarios u
JOIN usuario_roles ur ON u.id = ur.usuario_id
JOIN roles r ON ur.rol_id = r.id
WHERE 
  r.nombre = 'ADMINISTRADOR' 
  OR r.nombre = 'SUPER_ADMIN' 
  OR (r.nombre IN ('ADMIN_BARBERIA', 'BARBERO') AND ur.barberia_id IS NULL);
```
**Conteo esperado:** Deberías ver aproximadamente 7 cuentas (4 administradores globales, incluyendo `admin@demo.com` y los `admin_smoke_*`, y 3 usuarios con correos `@t.com` con `ADMIN_BARBERIA` y `barberia_id` nulo).

### 2. UPDATE de Desactivación (Suspender)
Ejecuta el siguiente comando para suspender las cuentas. Es crítico usar `SUSPENDIDO` (Decisión de diseño D09), nunca `INACTIVO` u otros estados.

```sql
UPDATE usuarios
SET estado_cuenta = 'SUSPENDIDO'
WHERE id IN (
    SELECT u.id
    FROM usuarios u
    JOIN usuario_roles ur ON u.id = ur.usuario_id
    JOIN roles r ON ur.rol_id = r.id
    WHERE 
      r.nombre = 'ADMINISTRADOR' 
      OR r.nombre = 'SUPER_ADMIN' 
      OR (r.nombre IN ('ADMIN_BARBERIA', 'BARBERO') AND ur.barberia_id IS NULL)
);
```

### Opcional: Eliminación (Solo si decides no conservar el historial)
```sql
DELETE FROM usuarios
WHERE id IN (
    SELECT u.id
    FROM usuarios u
    JOIN usuario_roles ur ON u.id = ur.usuario_id
    JOIN roles r ON ur.rol_id = r.id
    WHERE 
      r.nombre = 'ADMINISTRADOR' 
      OR r.nombre = 'SUPER_ADMIN' 
      OR (r.nombre IN ('ADMIN_BARBERIA', 'BARBERO') AND ur.barberia_id IS NULL)
);
```
