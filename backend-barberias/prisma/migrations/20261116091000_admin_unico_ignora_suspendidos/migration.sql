-- F4 · el trigger de administrador único ignora cuentas suspendidas.
--
-- Antes bastaba `usuario_roles.estado = 'ACTIVO'`: un dueño con la CUENTA
-- suspendida seguía bloqueando su sede, así que al intentar nombrar reemplazo
-- la API respondía 409 y la sede quedaba muerta (nadie podía entrar y nadie
-- podía recibirla). El script `regularizar-administradores-sede.ts` ya lo
-- reportaba como «administrador ACTIVO pero cuenta suspendida».
--
-- La regla de dominio (`asegurarSedeSinAdmin`) aplica el mismo criterio, así
-- que dominio y base coinciden: cuenta ACTIVA + vínculo ACTIVO = dueño real.

CREATE OR REPLACE FUNCTION fn_admin_barberia_unico_por_sede() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  es_admin_barberia boolean;
  vinculo_ocupante  uuid;
BEGIN
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

  PERFORM pg_advisory_xact_lock(
    hashtext('admin_barberia_unico:' || NEW."barberia_id"::text)
  );

  -- Se exige que la CUENTA esté ACTIVA: un vínculo ACTIVO de una cuenta
  -- suspendida no compite por la sede (F4).
  SELECT ur."id"
    INTO vinculo_ocupante
    FROM "usuario_roles" ur
    JOIN "roles" r ON r."id" = ur."rol_id"
    JOIN "usuarios" u ON u."id" = ur."usuario_id"
   WHERE ur."barberia_id" = NEW."barberia_id"
     AND ur."estado" = 'ACTIVO'
     AND r."nombre" = 'ADMIN_BARBERIA'
     AND u."estado_cuenta" = 'ACTIVO'
     AND ur."id" <> NEW."id"
   LIMIT 1;

  IF vinculo_ocupante IS NOT NULL THEN
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
