ALTER TABLE "usuario_roles"
ADD COLUMN "estado" VARCHAR(20) NOT NULL DEFAULT 'ACTIVO';

ALTER TABLE "usuario_roles"
ADD CONSTRAINT "usuario_roles_estado_check"
CHECK ("estado" IN ('ACTIVO', 'INACTIVO'));
