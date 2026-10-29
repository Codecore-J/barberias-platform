-- V3 · Catálogo híbrido: categorías de la sede + servicios propios del barbero.
--
-- Migración ADITIVA: no toca ninguna tabla existente, así que las reservas ya
-- confirmadas y el catálogo actual (`servicios`) siguen funcionando igual. La
-- nomenclatura coincide con `prisma/schema.prisma` para que `prisma migrate dev`
-- no detecte deriva en la próxima ejecución.

-- CreateTable
CREATE TABLE "categorias_servicio" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "barberia_id" UUID NOT NULL,
    "nombre" VARCHAR(100) NOT NULL,
    "descripcion" TEXT,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "creado_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "categorias_servicio_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uk_categoria_sede_nombre" ON "categorias_servicio"("barberia_id", "nombre");

-- AddForeignKey
ALTER TABLE "categorias_servicio" ADD CONSTRAINT "categorias_servicio_barberia_id_fkey" FOREIGN KEY ("barberia_id") REFERENCES "barberias"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "servicios_barbero" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "categoria_id" UUID NOT NULL,
    "barbero_id" UUID NOT NULL,
    "nombre_personalizado" VARCHAR(100) NOT NULL,
    "precio" DECIMAL(10,2) NOT NULL,
    "duracion_minutos" INTEGER NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "servicios_barbero_pkey" PRIMARY KEY ("id"),

    -- Reglas de integridad del dominio: un precio negativo o una duración nula
    -- no son «datos raros», son precios y turnos imposibles que la agenda no
    -- sabe bloquear. La guarda va en la base además del DTO. El nombre termina
    -- en `_check` porque `scripts/check-integridad.cjs` compara los CHECK del
    -- repo con los de la base por ese sufijo.
    CONSTRAINT "servicios_barbero_precio_check" CHECK ("precio" >= 0),
    CONSTRAINT "servicios_barbero_duracion_check" CHECK ("duracion_minutos" > 0)
);

-- CreateIndex
CREATE UNIQUE INDEX "uk_servicio_barbero_categoria_nombre" ON "servicios_barbero"("barbero_id", "categoria_id", "nombre_personalizado");

-- CreateIndex
CREATE INDEX "idx_servicios_barbero_categoria" ON "servicios_barbero"("categoria_id", "activo");

-- CreateIndex
CREATE INDEX "idx_servicios_barbero_barbero" ON "servicios_barbero"("barbero_id", "activo");

-- AddForeignKey
ALTER TABLE "servicios_barbero" ADD CONSTRAINT "servicios_barbero_categoria_id_fkey" FOREIGN KEY ("categoria_id") REFERENCES "categorias_servicio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "servicios_barbero" ADD CONSTRAINT "servicios_barbero_barbero_id_fkey" FOREIGN KEY ("barbero_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
