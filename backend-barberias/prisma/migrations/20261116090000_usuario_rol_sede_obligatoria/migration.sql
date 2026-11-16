-- F1 · un rol de ámbito BARBERIA no puede existir sin sede.
--
-- Un `usuario_roles` con rol `ADMIN_BARBERIA` y `barberia_id = NULL` es una fila
-- corrupta: no concede acceso (`alcanceCumple` exige sede) pero sí engaña a las
-- comprobaciones que tratan el nulo como comodín. Ocurrió en `verificarAcceso`
-- de analíticas (F1/T-37), que aceptaba `!rol.barberiaId` y abría el balance de
-- cualquier sede.
--
-- Se implementa con TRIGGER y no con CHECK porque el ámbito vive en `roles`:
-- un CHECK de PostgreSQL solo puede leer columnas de la propia fila, no hacer
-- JOIN con otra tabla. El trigger valida exactamente la misma condición y falla
-- con 23514 (check_violation), que es el SQLSTATE que un CHECK habría emitido.
--
-- El trigger de administrador único (`trg_admin_barberia_unico_por_sede`) sigue
-- ignorando `barberia_id IS NULL` a propósito: ahora esa fila ya no puede nacer.

CREATE OR REPLACE FUNCTION fn_usuario_rol_sede_obligatoria() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  ambito_del_rol text;
BEGIN
  SELECT r."ambito" INTO ambito_del_rol FROM "roles" r WHERE r."id" = NEW."rol_id";

  IF ambito_del_rol = 'BARBERIA' AND NEW."barberia_id" IS NULL THEN
    RAISE EXCEPTION
      'Un rol de ámbito BARBERIA requiere barberia_id (rol %)',
      NEW."rol_id"
      USING ERRCODE = '23514',
            CONSTRAINT = 'chk_usuario_rol_sede_obligatoria',
            HINT = 'Indica la sede del vínculo o usa un rol de ámbito GLOBAL.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_usuario_rol_sede_obligatoria ON "usuario_roles";

CREATE TRIGGER trg_usuario_rol_sede_obligatoria
BEFORE INSERT OR UPDATE OF "rol_id", "barberia_id" ON "usuario_roles"
FOR EACH ROW EXECUTE FUNCTION fn_usuario_rol_sede_obligatoria();

-- Verificación previa documentada: al escribir esta migración la consulta
--   SELECT COUNT(*) FROM usuario_roles ur JOIN roles r ON r.id = ur.rol_id
--    WHERE r.ambito = 'BARBERIA' AND ur.barberia_id IS NULL;
-- devolvía 0 en local y en producción, así que no hay filas que convalidar
-- antes de crear el trigger.
