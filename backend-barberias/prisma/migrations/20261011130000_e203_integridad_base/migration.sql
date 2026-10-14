-- E2-03 · Integridad base: catálogo de estados y columnas base.
--
-- Reconstruye en el repositorio la migración que el ledger de `dev` registraba y
-- que nunca llegó al repo (`20261011130000_e203_integridad_base`, H50). Se
-- conserva el NOMBRE EXACTO del ledger a propósito:
--   · en `dev` su fila ya está aplicada, así que `migrate deploy` la salta y no
--     vuelve a crear nada (el `already exists` que rompía el despliegue);
--   · en una base creada desde cero —la del CI incluida— se aplica en su orden
--     cronológico (después de `e204_zona_horaria`, antes de `e313`) y produce los
--     MISMOS objetos que `dev`.
--
-- Qué añade, verificado contra `pg_constraint` e `information_schema` de `dev`:
--   1. Los 15 CHECK de catálogo que `dev` ya tenía y ninguna migración declaraba.
--      (Los otros 12 CHECK de `dev` sí están en `margen_grupal_minutos`, `e304`,
--      `e308` y `e313`.)
--   2. `barberias.creado_at` y `reservas.completada_at`: las dos columnas que solo
--      existían en `dev` y que aparecían como drift en `prisma migrate diff`.
--
-- `migrate diff` NO modela los CHECK, así que la comprobación permanente es
-- `npm run check:integridad` (compara estas migraciones contra `pg_constraint`).
--
-- Auditoría de datos previa (E2-03/4, solo lectura sobre `dev`, 2026-10-12): todos
-- los valores existentes están dentro de catálogo —barberias.estado = ACTIVO (77);
-- cliente_barberias.estado_vinculacion = ACTIVO (73); reservas.estado ∈
-- {EXPIRADA, NO_PRESENTADO, PENDIENTE, CONFIRMADA}; tipo_reserva ∈ {INDIVIDUAL,
-- GRUPAL}; modo_confirmacion ∈ {AUTOMATICA, MANUAL}; usuarios.estado_cuenta ∈
-- {ACTIVO, SUSPENDIDO}; pagos sin filas; roles.ambito ∈ {BARBERIA, GLOBAL};
-- antecedentes.origen ∈ {BARBERO, ADMIN}; notificaciones.canal = EMAIL;
-- excepciones_horario.tipo = CERRADA—, así que ningún CHECK encuentra violaciones.

-- ─────────────────────────────────────────────────────────────────────────────
-- Columnas base
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "barberias" ADD COLUMN "creado_at" TIMESTAMPTZ DEFAULT now();
ALTER TABLE "reservas" ADD COLUMN "completada_at" TIMESTAMPTZ;

-- ─────────────────────────────────────────────────────────────────────────────
-- Catálogo de estados y zonas (D08/D09/D10/D14/D15)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "barberias"
  ADD CONSTRAINT "barberias_estado_check"
  CHECK ("estado" IN ('ACTIVO', 'INACTIVO'));

-- Reconstruido tal cual está en `dev`. OJO (H56): fija la zona a UN solo valor
-- literal, así que una sede en otra zona no podría guardarse. Hoy es inocuo
-- (nadie escribe `zona_horaria`), pero si la plataforma se abre a otra zona hay
-- que sustituirlo por un catálogo. No se cambia aquí para no volver a divergir
-- de `dev` en la misma migración que cierra la divergencia.
ALTER TABLE "barberias"
  ADD CONSTRAINT "barberias_zona_horaria_check"
  CHECK ("zona_horaria" = 'America/Santo_Domingo');

ALTER TABLE "reservas"
  ADD CONSTRAINT "reservas_estado_check"
  CHECK (
    "estado" IN (
      'PENDIENTE',
      'CONFIRMADA',
      'RECHAZADA',
      'PROPUESTA_PENDIENTE',
      'EXPIRADA',
      'NO_PRESENTADO',
      'CANCELADA',
      'COMPLETADA'
    )
  );

ALTER TABLE "reservas"
  ADD CONSTRAINT "reservas_tipo_reserva_check"
  CHECK ("tipo_reserva" IN ('INDIVIDUAL', 'GRUPAL'));

ALTER TABLE "reservas"
  ADD CONSTRAINT "reservas_modo_confirmacion_check"
  CHECK ("modo_confirmacion" IN ('MANUAL', 'AUTOMATICA'));

ALTER TABLE "usuarios"
  ADD CONSTRAINT "usuarios_estado_cuenta_check"
  CHECK ("estado_cuenta" IN ('ACTIVO', 'SUSPENDIDO', 'ELIMINADO'));

-- D10: `PENDIENTE_APROBACION` es la 6.ª vinculación a la espera de resolución
-- (E3-12); `DESVINCULADO` es el estado del cliente que se da de baja de la sede.
ALTER TABLE "cliente_barberias"
  ADD CONSTRAINT "cliente_barberias_estado_vinculacion_check"
  CHECK ("estado_vinculacion" IN ('ACTIVO', 'PENDIENTE_APROBACION', 'DESVINCULADO'));

ALTER TABLE "roles"
  ADD CONSTRAINT "roles_ambito_check"
  CHECK ("ambito" IN ('GLOBAL', 'BARBERIA'));

ALTER TABLE "pagos"
  ADD CONSTRAINT "pagos_estado_pago_check"
  CHECK ("estado_pago" IN ('PENDIENTE_DE_PAGO', 'PAGADA'));

ALTER TABLE "antecedentes"
  ADD CONSTRAINT "antecedentes_origen_check"
  CHECK ("origen" IN ('ADMIN', 'BARBERO', 'CLIENTE'));

ALTER TABLE "antecedentes"
  ADD CONSTRAINT "antecedentes_estado_validacion_check"
  CHECK ("estado_validacion" IN ('PENDIENTE', 'APROBADO', 'RECHAZADO'));

ALTER TABLE "notificaciones"
  ADD CONSTRAINT "notificaciones_canal_check"
  CHECK ("canal" IN ('EMAIL', 'APP', 'WHATSAPP', 'SMS'));

ALTER TABLE "notificaciones"
  ADD CONSTRAINT "notificaciones_estado_check"
  CHECK ("estado" IN ('PENDIENTE', 'ENVIADO', 'FALLIDO'));

-- Excepciones de horario: la de la sede y la del barbero comparten catálogo.
ALTER TABLE "excepciones_horario"
  ADD CONSTRAINT "excepciones_horario_tipo_check"
  CHECK ("tipo" IN ('CERRADA', 'HORARIO_ESPECIAL'));

ALTER TABLE "excepciones_horario_barbero"
  ADD CONSTRAINT "excepciones_horario_barbero_tipo_check"
  CHECK ("tipo" IN ('CERRADA', 'HORARIO_ESPECIAL'));
