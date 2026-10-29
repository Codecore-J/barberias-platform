-- V3 fase 4 · reservas creadas con el catálogo híbrido.
--
-- Hasta ahora `participante_servicios` apuntaba SIEMPRE al `Servicio` heredado
-- (`servicio_id NOT NULL`). Con el catálogo híbrido, un barbero publica sus
-- propios servicios (`servicios_barbero`) y el cliente reserva esos: la fila del
-- snapshot tiene que poder apuntar a ellos.
--
-- La migración es ADITIVA y no reescribe histórico: las reservas ya creadas
-- conservan `servicio_id` y `servicio_barbero_id` queda NULL. Las nuevas usan
-- una columna u otra, nunca las dos.

-- AlterTable · el vínculo heredado deja de ser obligatorio
ALTER TABLE "participante_servicios" ALTER COLUMN "servicio_id" DROP NOT NULL;

-- AlterTable · vínculo opcional al servicio propio del barbero
ALTER TABLE "participante_servicios" ADD COLUMN "servicio_barbero_id" UUID;

-- AddForeignKey
ALTER TABLE "participante_servicios" ADD CONSTRAINT "participante_servicios_servicio_barbero_id_fkey" FOREIGN KEY ("servicio_barbero_id") REFERENCES "servicios_barbero"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "idx_participante_servicios_servicio" ON "participante_servicios"("servicio_id");

-- CreateIndex
CREATE INDEX "idx_participante_servicios_barbero" ON "participante_servicios"("servicio_barbero_id");

-- Regla del dominio que Prisma no sabe expresar con `NOT NULL`: exactamente
-- UNO de los dos vínculos. Una fila sin servicio dejaría la reserva sin
-- desglose y con un total imposible de auditar; una fila con los dos mezclaría
-- dos precios históricos distintos para el mismo turno.
-- El sufijo `_check` lo exige `scripts/check-integridad.cjs`, que compara los
-- CHECK del repo con los de la base.
ALTER TABLE "participante_servicios" ADD CONSTRAINT "participante_servicios_un_solo_servicio_check" CHECK (("servicio_id" IS NOT NULL) <> ("servicio_barbero_id" IS NOT NULL));
