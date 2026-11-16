-- Fase 4 · un solo ADMIN_BARBERIA ACTIVO por sede, garantizado por la base.
--
-- La regla ya vive en el dominio (`asegurarSedeSinAdmin`) y se aplica en las tres
-- puertas de NestJS. Este trigger es la última línea de defensa: cubre seeds,
-- scripts de mantenimiento, consolas SQL y cualquier ruta futura que olvide la
-- comprobación. No sustituye a la regla de dominio, la respalda.

CREATE OR REPLACE FUNCTION fn_admin_barberia_unico_por_sede() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  es_admin_barberia boolean;
  vinculo_ocupante  uuid;
BEGIN
  -- Un vínculo global (sin sede) o inactivo no compite por la sede: el trigger
  -- debe permitir varias filas del mismo rol si solo una está ACTIVA.
  IF NEW."barberia_id" IS NULL OR NEW."estado" <> 'ACTIVO' THEN
    RETURN NEW;
  END IF;

  SELECT (r."nombre" = 'ADMIN_BARBERIA')
    INTO es_admin_barberia
    FROM "roles" r
   WHERE r."id" = NEW."rol_id";

  IF es_admin_barberia IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  -- Candado por sede, liberado al cerrar la transacción: sin él, dos INSERT
  -- simultáneos leerían «libre» a la vez y ambos pasarían el chequeo. Con el
  -- candado, el segundo espera el commit del primero y ya ve la fila nueva.
  PERFORM pg_advisory_xact_lock(
    hashtext('admin_barberia_unico:' || NEW."barberia_id"::text)
  );

  -- La propia fila se excluye, así un UPDATE del mismo vínculo (reactivar, mover
  -- de usuario o tocar el estado) no se bloquea a sí mismo.
  SELECT ur."id"
    INTO vinculo_ocupante
    FROM "usuario_roles" ur
    JOIN "roles" r ON r."id" = ur."rol_id"
   WHERE ur."barberia_id" = NEW."barberia_id"
     AND ur."estado" = 'ACTIVO'
     AND r."nombre" = 'ADMIN_BARBERIA'
     AND ur."id" <> NEW."id"
   LIMIT 1;

  IF vinculo_ocupante IS NOT NULL THEN
    -- 23505 (unique_violation): Prisma lo trata como conflicto de unicidad y el
    -- `PrismaExceptionFilter` lo devuelve como 409, igual que la regla de dominio.
    RAISE EXCEPTION
      'La sede % ya tiene un administrador activo (vínculo %)',
      NEW."barberia_id",
      vinculo_ocupante
      USING ERRCODE = '23505',
            CONSTRAINT = 'uk_admin_barberia_unico_por_sede',
            HINT = 'Desactiva el vínculo actual (estado = INACTIVO) antes de nombrar otro dueño.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_admin_barberia_unico_por_sede ON "usuario_roles";

CREATE TRIGGER trg_admin_barberia_unico_por_sede
BEFORE INSERT OR UPDATE OF "rol_id", "barberia_id", "estado" ON "usuario_roles"
FOR EACH ROW EXECUTE FUNCTION fn_admin_barberia_unico_por_sede();
