-- AlterTable
ALTER TABLE "bloqueos_agenda" ADD COLUMN     "barbero_id" UUID;

-- AlterTable
ALTER TABLE "reservas" ADD COLUMN     "barbero_id" UUID;

-- CreateTable
CREATE TABLE "horarios_barbero" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "barberia_id" UUID NOT NULL,
    "barbero_id" UUID NOT NULL,
    "dia_semana" SMALLINT NOT NULL,
    "hora_inicio" TIME NOT NULL,
    "hora_fin" TIME NOT NULL,

    CONSTRAINT "horarios_barbero_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "excepciones_horario_barbero" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "barberia_id" UUID NOT NULL,
    "barbero_id" UUID NOT NULL,
    "fecha" DATE NOT NULL,
    "tipo" VARCHAR(20) NOT NULL,
    "hora_inicio" TIME,
    "hora_fin" TIME,
    "motivo" TEXT,

    CONSTRAINT "excepciones_horario_barbero_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tokens_recuperacion" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "usuario_id" UUID NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "usado" BOOLEAN NOT NULL DEFAULT false,
    "expira_at" TIMESTAMPTZ NOT NULL,
    "creado_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tokens_recuperacion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "excepciones_horario_barbero_barbero_id_barberia_id_fecha_key" ON "excepciones_horario_barbero"("barbero_id", "barberia_id", "fecha");

-- CreateIndex
CREATE UNIQUE INDEX "tokens_recuperacion_token_hash_key" ON "tokens_recuperacion"("token_hash");

-- CreateIndex
CREATE INDEX "idx_tokens_recuperacion_hash" ON "tokens_recuperacion"("token_hash");

-- AddForeignKey
ALTER TABLE "horarios_barbero" ADD CONSTRAINT "horarios_barbero_barberia_id_fkey" FOREIGN KEY ("barberia_id") REFERENCES "barberias"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "horarios_barbero" ADD CONSTRAINT "horarios_barbero_barbero_id_fkey" FOREIGN KEY ("barbero_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "excepciones_horario_barbero" ADD CONSTRAINT "excepciones_horario_barbero_barberia_id_fkey" FOREIGN KEY ("barberia_id") REFERENCES "barberias"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "excepciones_horario_barbero" ADD CONSTRAINT "excepciones_horario_barbero_barbero_id_fkey" FOREIGN KEY ("barbero_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bloqueos_agenda" ADD CONSTRAINT "bloqueos_agenda_barbero_id_fkey" FOREIGN KEY ("barbero_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservas" ADD CONSTRAINT "reservas_barbero_id_fkey" FOREIGN KEY ("barbero_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tokens_recuperacion" ADD CONSTRAINT "tokens_recuperacion_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

