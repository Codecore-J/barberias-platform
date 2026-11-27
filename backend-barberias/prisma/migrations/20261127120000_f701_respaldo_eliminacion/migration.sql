-- F7 / T-71 · respaldo de una cuenta antes de su eliminación real.
--
-- POR QUÉ una tabla aparte: el borrado de T-72 destruye la fila de `usuarios` y
-- con ella el nombre, el correo y el teléfono. Sin una copia, la plataforma
-- perdería la única prueba de qué cuenta se eliminó y quién lo ordenó. Esta
-- tabla es de SOLO ESCRITURA para el sistema y de SOLO LECTURA para auditoría:
-- nunca se actualiza ni se borra desde la aplicación.
--
-- POR QUÉ no hay FK a `usuarios`: la fila se escribe cuando el usuario YA no
-- existe (o en la misma transacción que lo borra). Una FK la haría imposible de
-- insertar y, con CASCADE, borraría el propio respaldo.
--
-- `eliminado_por` guarda el ADMINISTRADOR que ordenó el borrado; tampoco lleva
-- FK por el mismo motivo (esa cuenta también podría eliminarse después).
--
-- Idempotente: solo AÑADE estructura, no toca datos existentes.

CREATE TABLE IF NOT EXISTS "respaldo_eliminacion" (
  "id"            UUID        NOT NULL DEFAULT gen_random_uuid(),
  "usuario_id"    UUID        NOT NULL,
  "snapshot"      JSONB       NOT NULL,
  "eliminado_por" UUID        NOT NULL,
  "eliminado_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "respaldo_eliminacion_pkey" PRIMARY KEY ("id")
);

-- La auditoría consulta por cuenta eliminada y por fecha de la eliminación.
CREATE INDEX IF NOT EXISTS "idx_respaldo_eliminacion_usuario"
  ON "respaldo_eliminacion" ("usuario_id");

CREATE INDEX IF NOT EXISTS "idx_respaldo_eliminacion_at"
  ON "respaldo_eliminacion" ("eliminado_at" DESC);
