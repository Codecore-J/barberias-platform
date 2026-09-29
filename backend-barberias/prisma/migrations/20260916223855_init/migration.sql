-- CreateTable
CREATE TABLE "usuarios" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nombre_completo" VARCHAR(150) NOT NULL,
    "correo" VARCHAR(150) NOT NULL,
    "telefono" VARCHAR(30) NOT NULL,
    "cedula" VARCHAR(30),
    "password_hash" VARCHAR(255) NOT NULL,
    "estado_cuenta" VARCHAR(20) NOT NULL DEFAULT 'ACTIVO',
    "creado_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nombre" VARCHAR(50) NOT NULL,
    "ambito" VARCHAR(20) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permisos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "codigo" VARCHAR(100) NOT NULL,
    "descripcion" TEXT,

    CONSTRAINT "permisos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rol_permisos" (
    "rol_id" UUID NOT NULL,
    "permiso_id" UUID NOT NULL,

    CONSTRAINT "rol_permisos_pkey" PRIMARY KEY ("rol_id","permiso_id")
);

-- CreateTable
CREATE TABLE "usuario_roles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "usuario_id" UUID NOT NULL,
    "rol_id" UUID NOT NULL,
    "barberia_id" UUID,

    CONSTRAINT "usuario_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "barberias" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nombre" VARCHAR(150) NOT NULL,
    "descripcion" TEXT,
    "telefono" VARCHAR(30) NOT NULL,
    "ubicacion" TEXT NOT NULL,
    "codigo_acceso" VARCHAR(50) NOT NULL,
    "enlace_unico" VARCHAR(100) NOT NULL,
    "responsable_id" UUID NOT NULL,
    "estado" VARCHAR(20) NOT NULL DEFAULT 'ACTIVO',

    CONSTRAINT "barberias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cliente_barberias" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "usuario_id" UUID NOT NULL,
    "barberia_id" UUID NOT NULL,
    "estado_vinculacion" VARCHAR(20) NOT NULL DEFAULT 'ACTIVO',
    "es_barberia_activa" BOOLEAN NOT NULL DEFAULT false,
    "contador_no_presentado" INTEGER NOT NULL DEFAULT 0,
    "esta_restringido" BOOLEAN NOT NULL DEFAULT false,
    "motivo_restriccion" TEXT,
    "creado_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cliente_barberias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "servicios" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "barberia_id" UUID NOT NULL,
    "nombre" VARCHAR(100) NOT NULL,
    "precio" DECIMAL(10,2) NOT NULL,
    "duracion_estimada" INTEGER NOT NULL,
    "margen_operativo" INTEGER NOT NULL DEFAULT 0,
    "destacado" BOOLEAN NOT NULL DEFAULT false,
    "estado" VARCHAR(20) NOT NULL DEFAULT 'ACTIVO',

    CONSTRAINT "servicios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "combos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "barberia_id" UUID NOT NULL,
    "nombre" VARCHAR(100) NOT NULL,
    "descripcion" TEXT,
    "precio_especial" DECIMAL(10,2) NOT NULL,
    "duracion_propia" INTEGER NOT NULL,
    "margen_propio" INTEGER NOT NULL DEFAULT 0,
    "destacado" BOOLEAN NOT NULL DEFAULT false,
    "estado" VARCHAR(20) NOT NULL DEFAULT 'ACTIVO',

    CONSTRAINT "combos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "combo_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "combo_id" UUID NOT NULL,
    "servicio_id" UUID,
    "sub_combo_id" UUID,

    CONSTRAINT "combo_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "horarios" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "barberia_id" UUID NOT NULL,
    "dia_semana" SMALLINT NOT NULL,
    "hora_inicio" TIME NOT NULL,
    "hora_fin" TIME NOT NULL,

    CONSTRAINT "horarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "excepciones_horario" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "barberia_id" UUID NOT NULL,
    "fecha" DATE NOT NULL,
    "tipo" VARCHAR(20) NOT NULL,
    "hora_inicio" TIME,
    "hora_fin" TIME,
    "motivo" TEXT,

    CONSTRAINT "excepciones_horario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bloqueos_agenda" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "barberia_id" UUID NOT NULL,
    "fecha" DATE NOT NULL,
    "hora_inicio" TIME NOT NULL,
    "hora_fin" TIME NOT NULL,
    "motivo" TEXT,
    "job_id" VARCHAR(100),
    "creado_por" UUID,
    "creado_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bloqueos_agenda_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reservas" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "barberia_id" UUID NOT NULL,
    "cliente_id" UUID NOT NULL,
    "tipo_reserva" VARCHAR(20) NOT NULL,
    "estado" VARCHAR(30) NOT NULL DEFAULT 'PENDIENTE',
    "modo_confirmacion" VARCHAR(20) NOT NULL,
    "fecha_cita" DATE NOT NULL,
    "hora_inicio" TIME NOT NULL,
    "hora_fin" TIME NOT NULL,
    "margen_grupal_historico" INTEGER,
    "total_pagar" DECIMAL(10,2) NOT NULL,
    "expira_at" TIMESTAMPTZ,
    "creado_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reservas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "participantes_reserva" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "reserva_id" UUID NOT NULL,
    "es_adulto_responsable" BOOLEAN NOT NULL DEFAULT false,
    "nombre_participante" VARCHAR(150) NOT NULL,

    CONSTRAINT "participantes_reserva_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "participante_servicios" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "participante_id" UUID NOT NULL,
    "servicio_id" UUID NOT NULL,
    "precio_historico" DECIMAL(10,2) NOT NULL,
    "duracion_historica" INTEGER NOT NULL,
    "margen_historico" INTEGER NOT NULL,

    CONSTRAINT "participante_servicios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pagos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "reserva_id" UUID NOT NULL,
    "estado_pago" VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE_DE_PAGO',
    "monto" DECIMAL(10,2) NOT NULL,
    "registrado_por" UUID,
    "registrado_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "actualizado_at" TIMESTAMPTZ,

    CONSTRAINT "pagos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "antecedentes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "usuario_id" UUID NOT NULL,
    "barberia_origen_id" UUID,
    "categoria" VARCHAR(50) NOT NULL,
    "contenido" TEXT NOT NULL,
    "origen" VARCHAR(20) NOT NULL DEFAULT 'BARBERO',
    "estado_validacion" VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',
    "compartido" BOOLEAN NOT NULL DEFAULT false,
    "motivo_rechazo" TEXT,
    "creado_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "antecedentes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notificaciones" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "usuario_id" UUID NOT NULL,
    "canal" VARCHAR(20) NOT NULL,
    "tipo" VARCHAR(50) NOT NULL,
    "contenido" TEXT,
    "estado" VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',
    "enviado_at" TIMESTAMPTZ,

    CONSTRAINT "notificaciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auditoria" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "usuario_id" UUID,
    "accion" VARCHAR(100) NOT NULL,
    "entidad" VARCHAR(50) NOT NULL,
    "entidad_id" UUID,
    "contexto" JSONB,
    "creado_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auditoria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reportes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "barberia_id" UUID,
    "tipo" VARCHAR(50) NOT NULL,
    "estado" VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',
    "referencia_id" UUID,
    "descripcion" TEXT,
    "creado_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reportes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "configuracion_barberia" (
    "barberia_id" UUID NOT NULL,
    "modo_reserva" VARCHAR(20) NOT NULL DEFAULT 'MANUAL',
    "acepta_individual" BOOLEAN NOT NULL DEFAULT true,
    "acepta_grupal" BOOLEAN NOT NULL DEFAULT true,
    "max_pendientes" INTEGER,
    "max_ninos" INTEGER,
    "max_personas_total" INTEGER,
    "horizonte_reserva_dias" INTEGER,
    "nuevas_reservas_activas" BOOLEAN NOT NULL DEFAULT true,
    "motivo_pausa" TEXT,
    "pausa_desde" TIMESTAMPTZ,
    "reactivacion_programada" TIMESTAMPTZ,
    "reactivacion_real" TIMESTAMPTZ,

    CONSTRAINT "configuracion_barberia_pkey" PRIMARY KEY ("barberia_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_correo_key" ON "usuarios"("correo");

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_telefono_key" ON "usuarios"("telefono");

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_cedula_key" ON "usuarios"("cedula");

-- CreateIndex
CREATE UNIQUE INDEX "roles_nombre_key" ON "roles"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "permisos_codigo_key" ON "permisos"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "usuario_roles_usuario_id_rol_id_barberia_id_key" ON "usuario_roles"("usuario_id", "rol_id", "barberia_id");

-- CreateIndex
CREATE UNIQUE INDEX "barberias_codigo_acceso_key" ON "barberias"("codigo_acceso");

-- CreateIndex
CREATE UNIQUE INDEX "barberias_enlace_unico_key" ON "barberias"("enlace_unico");

-- CreateIndex
CREATE UNIQUE INDEX "cliente_barberias_usuario_id_barberia_id_key" ON "cliente_barberias"("usuario_id", "barberia_id");

-- CreateIndex
CREATE UNIQUE INDEX "excepciones_horario_barberia_id_fecha_key" ON "excepciones_horario"("barberia_id", "fecha");

-- CreateIndex
CREATE INDEX "idx_reservas_concurrencia" ON "reservas"("barberia_id", "fecha_cita", "estado", "hora_inicio", "hora_fin");

-- CreateIndex
CREATE UNIQUE INDEX "pagos_reserva_id_key" ON "pagos"("reserva_id");

-- AddForeignKey
ALTER TABLE "rol_permisos" ADD CONSTRAINT "rol_permisos_rol_id_fkey" FOREIGN KEY ("rol_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rol_permisos" ADD CONSTRAINT "rol_permisos_permiso_id_fkey" FOREIGN KEY ("permiso_id") REFERENCES "permisos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuario_roles" ADD CONSTRAINT "usuario_roles_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuario_roles" ADD CONSTRAINT "usuario_roles_rol_id_fkey" FOREIGN KEY ("rol_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuario_roles" ADD CONSTRAINT "usuario_roles_barberia_id_fkey" FOREIGN KEY ("barberia_id") REFERENCES "barberias"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "barberias" ADD CONSTRAINT "barberias_responsable_id_fkey" FOREIGN KEY ("responsable_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cliente_barberias" ADD CONSTRAINT "cliente_barberias_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cliente_barberias" ADD CONSTRAINT "cliente_barberias_barberia_id_fkey" FOREIGN KEY ("barberia_id") REFERENCES "barberias"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "servicios" ADD CONSTRAINT "servicios_barberia_id_fkey" FOREIGN KEY ("barberia_id") REFERENCES "barberias"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "combos" ADD CONSTRAINT "combos_barberia_id_fkey" FOREIGN KEY ("barberia_id") REFERENCES "barberias"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "combo_items" ADD CONSTRAINT "combo_items_combo_id_fkey" FOREIGN KEY ("combo_id") REFERENCES "combos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "combo_items" ADD CONSTRAINT "combo_items_servicio_id_fkey" FOREIGN KEY ("servicio_id") REFERENCES "servicios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "combo_items" ADD CONSTRAINT "combo_items_sub_combo_id_fkey" FOREIGN KEY ("sub_combo_id") REFERENCES "combos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "horarios" ADD CONSTRAINT "horarios_barberia_id_fkey" FOREIGN KEY ("barberia_id") REFERENCES "barberias"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "excepciones_horario" ADD CONSTRAINT "excepciones_horario_barberia_id_fkey" FOREIGN KEY ("barberia_id") REFERENCES "barberias"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bloqueos_agenda" ADD CONSTRAINT "bloqueos_agenda_barberia_id_fkey" FOREIGN KEY ("barberia_id") REFERENCES "barberias"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bloqueos_agenda" ADD CONSTRAINT "bloqueos_agenda_creado_por_fkey" FOREIGN KEY ("creado_por") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservas" ADD CONSTRAINT "reservas_barberia_id_fkey" FOREIGN KEY ("barberia_id") REFERENCES "barberias"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservas" ADD CONSTRAINT "reservas_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participantes_reserva" ADD CONSTRAINT "participantes_reserva_reserva_id_fkey" FOREIGN KEY ("reserva_id") REFERENCES "reservas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participante_servicios" ADD CONSTRAINT "participante_servicios_participante_id_fkey" FOREIGN KEY ("participante_id") REFERENCES "participantes_reserva"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participante_servicios" ADD CONSTRAINT "participante_servicios_servicio_id_fkey" FOREIGN KEY ("servicio_id") REFERENCES "servicios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagos" ADD CONSTRAINT "pagos_reserva_id_fkey" FOREIGN KEY ("reserva_id") REFERENCES "reservas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagos" ADD CONSTRAINT "pagos_registrado_por_fkey" FOREIGN KEY ("registrado_por") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "antecedentes" ADD CONSTRAINT "antecedentes_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "antecedentes" ADD CONSTRAINT "antecedentes_barberia_origen_id_fkey" FOREIGN KEY ("barberia_origen_id") REFERENCES "barberias"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notificaciones" ADD CONSTRAINT "notificaciones_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auditoria" ADD CONSTRAINT "auditoria_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reportes" ADD CONSTRAINT "reportes_barberia_id_fkey" FOREIGN KEY ("barberia_id") REFERENCES "barberias"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "configuracion_barberia" ADD CONSTRAINT "configuracion_barberia_barberia_id_fkey" FOREIGN KEY ("barberia_id") REFERENCES "barberias"("id") ON DELETE CASCADE ON UPDATE CASCADE;
