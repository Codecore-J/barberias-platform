-- E3-04 (D19, BACKLOG §5.5): motivo estructurado del rechazo.
--
-- `motivo_codigo` guarda el código del catálogo de RECHAZO y `motivo_detalle`
-- el texto libre, que solo es obligatorio cuando el código es `OTRO`.
-- Ambas son opcionales: solo las reservas RECHAZADA llevan motivo.
ALTER TABLE "reservas" ADD COLUMN "motivo_codigo" VARCHAR(40);
ALTER TABLE "reservas" ADD COLUMN "motivo_detalle" TEXT;

-- Catálogo cerrado de §5.5 para el rechazo. Se replica en SQL para que un
-- código fuera del catálogo no pueda entrar ni por una escritura directa.
-- El catálogo de cancelación del admin (EMERGENCIA, ENFERMEDAD, ...) llega en
-- E3-06 junto con su propia ruta, así que aquí no se admite todavía.
ALTER TABLE "reservas"
  ADD CONSTRAINT "reservas_motivo_codigo_check"
  CHECK (
    "motivo_codigo" IS NULL
    OR "motivo_codigo" IN (
      'HORARIO_NO_DISPONIBLE',
      'SERVICIO_NO_DISPONIBLE',
      'RESPONSABLE_AUSENTE',
      'CLIENTE_RESTRINGIDO',
      'OTRO'
    )
  );

-- §5.5: `OTRO` exige un detalle de al menos 5 caracteres. La condición se
-- escribe como "no es OTRO OR tiene detalle suficiente" para que un código
-- distinto de OTRO pase con o sin detalle.
ALTER TABLE "reservas"
  ADD CONSTRAINT "reservas_motivo_otro_detalle_check"
  CHECK (
    "motivo_codigo" IS DISTINCT FROM 'OTRO'
    OR char_length(coalesce("motivo_detalle", '')) >= 5
  );
