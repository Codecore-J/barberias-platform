-- CreateIndex: Índice único parcial para garantizar una sola barbería activa por cliente a nivel de motor PostgreSQL (Hallazgo 11 / DATA-01)
CREATE UNIQUE INDEX "idx_cliente_barberia_activa" ON "cliente_barberias"("usuario_id") WHERE "es_barberia_activa" = true;
