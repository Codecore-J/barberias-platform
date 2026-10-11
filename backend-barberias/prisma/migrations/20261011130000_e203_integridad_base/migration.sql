-- E2-03 · Migración de esquema y de datos (integridad base).
--
-- D14: las columnas de estado son VARCHAR + CHECK. Los catálogos que hasta
-- ahora solo vivían en TypeScript (§5.1/D08, §5.5, D09, D10, D12, D15) se
-- replican como CHECK en la base para que ni una escritura SQL directa —ni una
-- restauración de producción— pueda meter un valor fuera de catálogo.
--
-- Nada de esto toca reglas de negocio: solo cierra la puerta del esquema.

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. Corrección de datos previa (hallazgo de esta tarea, ver informe)
-- ─────────────────────────────────────────────────────────────────────────────
-- `barberias.estado` tenía 6 filas con 'ACTIVA' (38 con 'ACTIVO'). 'ACTIVA' NO
-- pertenece al catálogo ('ACTIVO','INACTIVO'): era una variante ortográfica, no
-- un estado distinto (las 6 filas operaban como activas). Se normaliza ANTES de
-- crear el CHECK; sin esto la migración abortaría.
UPDATE "barberias" SET "estado" = 'ACTIVO' WHERE "estado" = 'ACTIVA';

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. barberias: creado_at, logo_url y CHECKs
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "barberias"
  ADD COLUMN "creado_at" TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN "logo_url"  TEXT;

ALTER TABLE "barberias"
  ADD CONSTRAINT "barberias_estado_check"
  CHECK ("estado" IN ('ACTIVO', 'INACTIVO'));

-- D15: catálogo de zonas vigente en V1. E2-04 difirió este CHECK aquí (su
-- migración solo añadió la columna con el DEFAULT del catálogo).
ALTER TABLE "barberias"
  ADD CONSTRAINT "barberias_zona_horaria_check"
  CHECK ("zona_horaria" IN ('America/Santo_Domingo'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. reservas: completada_at y CHECKs del §5.1 / §5.2
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "reservas" ADD COLUMN "completada_at" TIMESTAMPTZ;

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

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. usuarios (D09) y cliente_barberias (D10)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "usuarios"
  ADD CONSTRAINT "usuarios_estado_cuenta_check"
  CHECK ("estado_cuenta" IN ('ACTIVO', 'SUSPENDIDO', 'ELIMINADO'));

ALTER TABLE "cliente_barberias"
  ADD CONSTRAINT "cliente_barberias_estado_vinculacion_check"
  CHECK ("estado_vinculacion" IN ('ACTIVO', 'PENDIENTE_APROBACION', 'DESVINCULADO'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. pagos
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "pagos"
  ADD CONSTRAINT "pagos_estado_pago_check"
  CHECK ("estado_pago" IN ('PENDIENTE_DE_PAGO', 'PAGADA'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. antecedentes
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "antecedentes"
  ADD CONSTRAINT "antecedentes_origen_check"
  CHECK ("origen" IN ('ADMIN', 'BARBERO', 'CLIENTE'));

ALTER TABLE "antecedentes"
  ADD CONSTRAINT "antecedentes_estado_validacion_check"
  CHECK ("estado_validacion" IN ('PENDIENTE', 'APROBADO', 'RECHAZADO'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. notificaciones (D12: APP es el canal objetivo; EMAIL sigue en uso)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "notificaciones"
  ADD CONSTRAINT "notificaciones_canal_check"
  CHECK ("canal" IN ('EMAIL', 'APP', 'WHATSAPP', 'SMS'));

ALTER TABLE "notificaciones"
  ADD CONSTRAINT "notificaciones_estado_check"
  CHECK ("estado" IN ('PENDIENTE', 'ENVIADO', 'FALLIDO'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. roles
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "roles"
  ADD CONSTRAINT "roles_ambito_check"
  CHECK ("ambito" IN ('GLOBAL', 'BARBERIA'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. excepciones de horario (ambas tablas comparten el catálogo TipoExcepcionHorario)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "excepciones_horario"
  ADD CONSTRAINT "excepciones_horario_tipo_check"
  CHECK ("tipo" IN ('CERRADA', 'HORARIO_ESPECIAL'));

ALTER TABLE "excepciones_horario_barbero"
  ADD CONSTRAINT "excepciones_horario_barbero_tipo_check"
  CHECK ("tipo" IN ('CERRADA', 'HORARIO_ESPECIAL'));
