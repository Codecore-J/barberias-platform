-- CreateEnum
CREATE TYPE "TipoOtp" AS ENUM ('TELEFONO', 'CORREO');

-- AlterTable
ALTER TABLE "usuarios" ADD COLUMN     "correo_verificado" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "telefono_verificado" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "otp_confirmaciones" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "usuario_id" UUID NOT NULL,
    "codigo" VARCHAR(6) NOT NULL,
    "tipo" "TipoOtp" NOT NULL,
    "expira_en" TIMESTAMPTZ NOT NULL,
    "usado" BOOLEAN NOT NULL DEFAULT false,
    "creado_en" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_confirmaciones_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_otp_usuario_canal" ON "otp_confirmaciones"("usuario_id", "tipo", "usado", "expira_en");

-- AddForeignKey
ALTER TABLE "otp_confirmaciones" ADD CONSTRAINT "otp_confirmaciones_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
