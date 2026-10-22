-- E4-02 · D22: compone la lista de espera del Carril B.
--
-- `lista_esperas` es la suscripción de un cliente a un hueco que se libere en
-- ESA barbería y fecha, para uno o varios servicios. No ocupa agenda: es el
-- inverso de `reservas` (el cliente deja dicho qué aceptaría).
--
-- El DDL de tablas, índices y FKs es el que produce `prisma migrate diff`
-- (`--from-schema-datasource` → `--to-schema-datamodel`). Lo único que Prisma no
-- modela es el CHECK de `estado`, que va aquí y lo vigila
-- `npm run check:integridad` contra `pg_constraint`.
--
-- `_ListaEsperaToServicio` es la tabla de unión de la relación implícita
-- `ListaEspera.servicios`: la mantiene Prisma y las dos FK son ON DELETE CASCADE,
-- así que retirar un servicio no deja suscripciones apuntando a la nada.

-- ── Tabla `lista_esperas` ─────────────────────────────────────────────────────
CREATE TABLE "lista_esperas" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "usuario_id" UUID NOT NULL,
    "barberia_id" UUID NOT NULL,
    -- Fecha deseada como ETIQUETA local de la sede (igual que `reservas.fecha_cita`).
    "fecha_objetivo" DATE NOT NULL,
    "estado" VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',
    "creado_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "actualizado_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lista_esperas_pkey" PRIMARY KEY ("id")
);

-- ── Tabla de unión `ListaEspera.servicios` ────────────────────────────────────
CREATE TABLE "_ListaEsperaToServicio" (
    "A" UUID NOT NULL,
    "B" UUID NOT NULL
);

-- ── Índices ──────────────────────────────────────────────────────────────────
-- Búsqueda del matcher: cliente + sede + fecha con el estado en el filtro.
CREATE INDEX "idx_lista_espera_usuario_fecha"
  ON "lista_esperas"("usuario_id", "barberia_id", "fecha_objetivo", "estado");

-- Búsqueda del matcher cuando solo se conoce la sede y la fecha liberada.
CREATE INDEX "idx_lista_espera_barberia_fecha"
  ON "lista_esperas"("barberia_id", "fecha_objetivo", "estado");

-- Un servicio no se puede repetir dentro de la misma suscripción.
CREATE UNIQUE INDEX "_ListaEsperaToServicio_AB_unique"
  ON "_ListaEsperaToServicio"("A", "B");

CREATE INDEX "_ListaEsperaToServicio_B_index"
  ON "_ListaEsperaToServicio"("B");

-- ── Claves foráneas ──────────────────────────────────────────────────────────
-- La suscripción muere con la cuenta del cliente y con la sede: no es
-- histórico de negocio, es una intención viva.
ALTER TABLE "lista_esperas"
  ADD CONSTRAINT "lista_esperas_usuario_id_fkey"
  FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "lista_esperas"
  ADD CONSTRAINT "lista_esperas_barberia_id_fkey"
  FOREIGN KEY ("barberia_id") REFERENCES "barberias"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "_ListaEsperaToServicio"
  ADD CONSTRAINT "_ListaEsperaToServicio_A_fkey"
  FOREIGN KEY ("A") REFERENCES "lista_esperas"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "_ListaEsperaToServicio"
  ADD CONSTRAINT "_ListaEsperaToServicio_B_fkey"
  FOREIGN KEY ("B") REFERENCES "servicios"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ── CHECK del catálogo de estados (D08) ──────────────────────────────────────
-- PENDIENTE → NOTIFICADO → CERRADO. Una suscripción no se BORRA: se CIERRA
-- (D29), y `CERRADO` es el estado terminal que la saca del matcher.
-- `prisma migrate diff` no modela CHECK; el guardián es `check:integridad`.
ALTER TABLE "lista_esperas"
  ADD CONSTRAINT "lista_esperas_estado_check"
  CHECK ("estado" IN ('PENDIENTE', 'NOTIFICADO', 'CERRADO'));
