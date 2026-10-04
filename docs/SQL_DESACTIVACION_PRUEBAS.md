# SQL para Desactivación de Cuentas de Prueba

Este script debe ejecutarse directamente en el editor SQL de Neon sobre la base de datos de `staging`.

Antes de correr el UPDATE, ejecuta primero el SELECT solo, mira la lista de correos uno por uno, y confirma que ninguno sea tu correo real de Gmail que pueda estar en uso legítimo. Si aparece, sácalo del WHERE antes de correr el UPDATE.

-- 1. SELECT previo (verificación) — ejecutar en staging
```sql
SELECT u.correo, r.nombre AS rol, ur.barberia_id, u.estado_cuenta
FROM usuarios u
JOIN usuario_roles ur ON u.id = ur.usuario_id
JOIN roles r ON ur.rol_id = r.id
WHERE
  r.nombre IN ('ADMINISTRADOR')
  OR (r.nombre = 'ADMIN_BARBERIA' AND ur.barberia_id IS NULL);
```

-- Conteo esperado: ~7 cuentas (4 administradores globales + 3 ADMIN_BARBERIA sin barbería)

-- 2. UPDATE de desactivación (SUSPENDIDO, nunca borrado físico)
```sql
UPDATE usuarios
SET estado_cuenta = 'SUSPENDIDO'
WHERE id IN (
    SELECT u.id
    FROM usuarios u
    JOIN usuario_roles ur ON u.id = ur.usuario_id
    JOIN roles r ON ur.rol_id = r.id
    WHERE
      r.nombre IN ('ADMINISTRADOR')
      OR (r.nombre = 'ADMIN_BARBERIA' AND ur.barberia_id IS NULL)
);
```
