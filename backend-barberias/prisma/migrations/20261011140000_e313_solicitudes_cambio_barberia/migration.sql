-- E3-13 · D26: solicitudes de cambio de nombre y responsable.
--
-- El nombre de la sede y el responsable dejan de editarse directo (PATCH
-- /barberias/:id): el ADMIN_BARBERIA crea una solicitud y el ADMINISTRADOR la
-- resuelve. El catálogo de `tipo` y `estado` se cierra con CHECK, igual que el
-- resto de catálogos del esquema (D26).

-- ─────────────────────────────────────────────────────────────────────────────
-- D26 · Logo editable directo (junto a descripción y ubicación)
-- ─────────────────────────────────────────────────────────────────────────────
-- La tarea E3-13 mantiene `descripcion`, `ubicacion`, `logo_url` y `telefono`
-- como edición directa, pero `barberias` no declaraba columna de logo en el
-- ledger. La base `dev` YA la tiene (como `text`, sin migración que la
-- registre: deriva de H37/H49), así que la sentencia es idempotente para que
-- `migrate deploy` funcione tanto sobre `dev` como sobre una base nueva.
-- Ver hallazgo H50 en AUDITORIA_HALLAZGOS.md.
ALTER TABLE "barberias"
  ADD COLUMN IF NOT EXISTS "logo_url" TEXT;

-- ─────────────────────────────────────────────────────────────────────────────
-- D26 · Solicitudes de cambio
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE "solicitudes_cambio_barberia" (
  "id"             UUID        NOT NULL DEFAULT gen_random_uuid(),
  "barberia_id"    UUID        NOT NULL,
  "tipo"           VARCHAR(20) NOT NULL,
  "valor_nuevo"    VARCHAR(150) NOT NULL,
  "estado"         VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',
  "solicitado_por" UUID        NOT NULL,
  "resuelto_por"   UUID,
  "motivo_rechazo" TEXT,
  "creado_at"      TIMESTAMPTZ DEFAULT now(),
  "resuelto_at"    TIMESTAMPTZ,

  CONSTRAINT "solicitudes_cambio_barberia_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "solicitudes_cambio_barberia_barberia_id_fkey"
    FOREIGN KEY ("barberia_id") REFERENCES "barberias"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "solicitudes_cambio_barberia_solicitado_por_fkey"
    FOREIGN KEY ("solicitado_por") REFERENCES "usuarios"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "solicitudes_cambio_barberia_resuelto_por_fkey"
    FOREIGN KEY ("resuelto_por") REFERENCES "usuarios"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "solicitudes_cambio_barberia_tipo_check"
    CHECK ("tipo" IN ('NOMBRE', 'RESPONSABLE')),
  CONSTRAINT "solicitudes_cambio_barberia_estado_check"
    CHECK ("estado" IN ('PENDIENTE', 'APROBADA', 'RECHAZADA')),
  -- Una solicitud RECHAZADA exige motivo; una PENDIENTE no puede tenerlo.
  CONSTRAINT "solicitudes_cambio_barberia_motivo_check"
    CHECK ("estado" <> 'RECHAZADA' OR char_length(coalesce("motivo_rechazo", '')) >= 5),
  -- `resuelto_por` y `resuelto_at` viajan juntos: o está resuelta, o no lo está.
  CONSTRAINT "solicitudes_cambio_barberia_resolucion_check"
    CHECK (("resuelto_por" IS NULL) = ("resuelto_at" IS NULL))
);

-- La consulta caliente del panel es «las pendientes de esta sede».
CREATE INDEX "idx_solicitudes_cambio_sede_estado"
  ON "solicitudes_cambio_barberia"("barberia_id", "estado");
