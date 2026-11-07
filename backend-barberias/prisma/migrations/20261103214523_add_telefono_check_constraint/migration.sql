-- H-02 · Integridad del teléfono a nivel de motor.
--
-- Objetivo: que PostgreSQL rechace cualquier teléfono que no sean exactamente
-- 10 dígitos, en vez de confiar solo en la validación del DTO. El precedente es
-- `600NaN2222`: valores que llegaron por una concatenación numérica fallida y
-- que la base aceptó sin objeción.
--
-- Dos precisiones sobre la sentencia originalmente planteada:
--
--  1. La tabla es `"usuarios"`, no `"Usuario"`: el modelo `Usuario` declara
--     `@@map("usuarios")` y PostgreSQL distingue mayúsculas en identificadores
--     entrecomillados, así que `ALTER TABLE "Usuario"` daba «relation does not
--     exist».
--  2. `telefono` es NOT NULL, de modo que la rama `telefono IS NULL` no puede
--     cumplirse hoy. Se mantiene igualmente para que la regla siga siendo
--     correcta si la columna se vuelve opcional en el futuro; no cuesta nada y
--     evita que el constraint prohíba nulos por accidente.
--
-- `NOT VALID` es deliberado: hay 3 filas heredadas que incumplen el formato
-- (`818355496` de 9 dígitos y dos de 11). Marcarlo así aplica la restricción a
-- todo INSERT/UPDATE nuevo —que es el objetivo— sin inventar números para
-- arreglar las antiguas. Cuando esos registros se resuelvan, la validación
-- completa se activa con:
--
--   ALTER TABLE "usuarios" VALIDATE CONSTRAINT "chk_usuario_telefono_10_digitos";
--
-- Se usa `[0-9]{10}` y no `\d{10}` por consistencia con el resto de consultas
-- del proyecto; ambas formas son equivalentes en el motor ARE de PostgreSQL.
ALTER TABLE "usuarios"
  ADD CONSTRAINT "chk_usuario_telefono_10_digitos"
  CHECK ("telefono" IS NULL OR "telefono" ~ '^[0-9]{10}$')
  NOT VALID;
