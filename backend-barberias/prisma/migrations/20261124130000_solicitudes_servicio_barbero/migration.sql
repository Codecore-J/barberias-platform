-- T-27 · solicitudes de servicio del barbero.
--
-- El barbero pide publicar (`ALTA`) o retirar (`DESACTIVACION`) un servicio y
-- el ADMIN_BARBERIA de la sede resuelve. La tabla es historial: no se borra.
--
-- Idempotente: `IF NOT EXISTS` en tabla e índices. No toca ninguna tabla
-- existente ni borra datos.

CREATE TABLE IF NOT EXISTS "solicitudes_servicio_barbero" (
  "id"                   UUID NOT NULL DEFAULT gen_random_uuid(),
  "barberia_id"          UUID NOT NULL,
  "barbero_id"           UUID NOT NULL,
  "tipo"                 VARCHAR(20) NOT NULL,
  "estado"               VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',
  "categoria_id"         UUID,
  "nombre_personalizado" VARCHAR(100),
  "descripcion"          VARCHAR(500),
  "imagen_url"           VARCHAR(500),
  "imagen_public_id"     VARCHAR(255),
  "precio"               DECIMAL(10, 2),
  "duracion_minutos"     INTEGER,
  "servicio_id"          UUID,
  "motivo_rechazo"       VARCHAR(500),
  "resuelto_por"         UUID,
  "resuelta_at"          TIMESTAMPTZ,
  "creado_at"            TIMESTAMPTZ NOT NULL DEFAULT now(),
  "actualizado_at"       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "solicitudes_servicio_barbero_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "solicitudes_servicio_barbero_sede_fkey"
    FOREIGN KEY ("barberia_id") REFERENCES "barberias"("id") ON DELETE CASCADE,
  CONSTRAINT "solicitudes_servicio_barbero_barbero_fkey"
    FOREIGN KEY ("barbero_id") REFERENCES "usuarios"("id") ON DELETE CASCADE,
  CONSTRAINT "solicitudes_servicio_barbero_resolutor_fkey"
    FOREIGN KEY ("resuelto_por") REFERENCES "usuarios"("id") ON DELETE SET NULL,
  CONSTRAINT "solicitudes_servicio_barbero_servicio_fkey"
    FOREIGN KEY ("servicio_id") REFERENCES "servicios_barbero"("id") ON DELETE SET NULL,
  CONSTRAINT "solicitudes_servicio_barbero_tipo_check"
    CHECK ("tipo" IN ('ALTA', 'DESACTIVACION')),
  CONSTRAINT "solicitudes_servicio_barbero_estado_check"
    CHECK ("estado" IN ('PENDIENTE', 'APROBADA', 'RECHAZADA')),
  -- Una RECHAZADA exige motivo con texto; una PENDIENTE no puede tenerlo.
  CONSTRAINT "solicitudes_servicio_barbero_motivo_check"
    CHECK (
      ("estado" = 'RECHAZADA' AND "motivo_rechazo" IS NOT NULL AND btrim("motivo_rechazo") <> '')
      OR ("estado" <> 'RECHAZADA' AND "motivo_rechazo" IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS "idx_solicitudes_servicio_sede_estado"
  ON "solicitudes_servicio_barbero"("barberia_id", "estado");

CREATE INDEX IF NOT EXISTS "idx_solicitudes_servicio_barbero"
  ON "solicitudes_servicio_barbero"("barbero_id", "estado");
