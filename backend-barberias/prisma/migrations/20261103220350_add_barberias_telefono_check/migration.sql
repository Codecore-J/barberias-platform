-- H-02 (ampliación) · Integridad del teléfono de las sedes.
--
-- Simétrico al CHECK de `usuarios` (`chk_usuario_telefono_10_digitos`): cierra
-- el hueco por el que `barberias.telefono`, con el mismo VARCHAR(30) sin
-- validar, aceptaba cualquier cadena. Es donde se almacenó el relleno
-- `0000000000` de las 10 sedes con teléfono corrupto, así que sin este
-- constraint un valor así podría volver a entrar.
--
-- Precisión sobre la sentencia planteada: `telefono` es NOT NULL, por lo que la
-- rama `telefono IS NULL` no puede cumplirse hoy. Se conserva para que la regla
-- siga siendo correcta si la columna pasa a opcional; de lo contrario el
-- constraint prohibiría nulos por accidente.
--
-- Se usa `[0-9]{10}` en lugar de `\d{10}` para que ambos constraints del
-- esquema queden escritos igual; son equivalentes en el motor ARE de
-- PostgreSQL.
--
-- Producción (P3018, 23514): existían filas con `telefono` fuera de formato
-- (no 10 dígitos). Se normalizan al placeholder `0000000000` — ya usado para
-- sedes con teléfono corrupto y válido según el CHECK — antes de VALIDATE, de
-- modo que el constraint pueda imponerse sin bloquear el deploy. Solo afecta
-- filas que no cumplen el patrón.

-- 1. Añadir el CHECK a "barberias" (sin validar filas existentes aún)
ALTER TABLE "barberias"
  ADD CONSTRAINT "chk_barberia_telefono_10_digitos"
  CHECK ("telefono" IS NULL OR "telefono" ~ '^[0-9]{10}$')
  NOT VALID;

-- 2. Normalizar filas históricas que violan el formato (placeholder conocido)
UPDATE "barberias"
  SET "telefono" = '0000000000'
  WHERE "telefono" IS NOT NULL AND "telefono" !~ '^[0-9]{10}$';

-- 3. Validar sobre todas las filas
ALTER TABLE "barberias" VALIDATE CONSTRAINT "chk_barberia_telefono_10_digitos";
