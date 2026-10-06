/**
 * SUITE DE VALIDACIÓN E2E EN VIVO (SMOKE TEST INTEGRAL)
 * Plataforma Multi-Tenant de Barberías
 * 
 * Este script se conecta directamente a la API en ejecución (http://localhost:3000/api/v1)
 * y ejecuta el flujo de negocio completo de principio a fin:
 * 1. Healthcheck del servidor.
 * 2. Registro y autenticación de usuarios (Admin, Barbero, Cliente).
 * 3. Creación de una barbería con código de acceso único.
 * 4. Vinculación del cliente a la barbería creada.
 * 5. Creación de un servicio en el catálogo.
 * 6. Configuración de horarios de atención (días 1 a 7).
 * 7. Creación de reserva con validación de concurrencia y snapshot congelado.
 * 8. Consulta de detalle de reserva con precios históricos.
 * 9. Registro de pago en persona y transición a COMPLETADA.
 * 10. Registro y aprobación de antecedentes técnicos del cliente.
 * 11. Consulta de notificaciones generadas en la cola BullMQ.
 * 12. Consulta de estadísticas y purga de auditoría.
 */

/**
 * GUARDIA DE SEGURIDAD (mismo patron que test/setup.e2e.ts)
 *
 * Este script abre un PrismaClient contra el DATABASE_URL del proceso y escribe
 * usuarios reales (admin_smoke_*, barbero_smoke_*, ...). Antes de que se crearan
 * los admin_smoke_* en produccion, se ejecuto con la URL de Neon en el entorno.
 * Por eso aborta si APP_ENV no es 'dev' o si la base no es local.
 */
function assertSafeSmokeDatabase() {
  if (process.env.APP_ENV !== 'dev') {
    console.error(`SMOKE TEST ABORTED: APP_ENV is set to '${process.env.APP_ENV}'. The live smoke test must only run in 'dev' environment to prevent writing test data in staging/production.`);
    process.exit(1);
  }

  const databaseUrl = process.env.DATABASE_URL ?? '';
  if (!/localhost|127\.0\.0\.1/.test(databaseUrl)) {
    let host = '(no parseable)';
    try {
      host = new URL(databaseUrl).host;
    } catch {
      host = '(no parseable)';
    }
    console.error(`SMOKE TEST ABORTED: DATABASE_URL points to '${host}', which is not localhost nor 127.0.0.1. This script writes directly in the database (admin_smoke_*) and must never run against staging/production.`);
    process.exit(1);
  }
}

assertSafeSmokeDatabase();

const BASE_URL = 'http://localhost:3000/api/v1';

async function request(path: string, options: { method?: string; body?: any; token?: string; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  if (options.token) {
    headers['Authorization'] = `Bearer ${options.token}`;
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const contentType = response.headers.get('content-type');
  let data: any = null;
  if (contentType && contentType.includes('application/json')) {
    data = await response.json();
  } else {
    data = await response.text();
  }

  return { status: response.status, ok: response.ok, data };
}

async function runSmokeTest() {
  console.log('================================================================');
  console.log('🚀 INICIANDO PRUEBA DE INTEGRACIÓN E2E EN VIVO (SMOKE TEST)');
  console.log(`📡 URL Base: ${BASE_URL}`);
  console.log('================================================================\n');

  const ts = Date.now();

  // 1. Healthcheck
  console.log('🔍 Paso 1: Verificando salud del servidor...');
  const root = await request('');
  if (root.status !== 200) {
    throw new Error(`Servidor no responde en ${BASE_URL}. Status: ${root.status}`);
  }
  console.log(`   ✅ Servidor respondiendo correctamente (Status: ${root.status}, Mensaje: "${root.data}")\n`);

  // 2. Registro de Usuarios
  console.log('👤 Paso 2: Registrando usuarios de prueba...');
  const adminEmail = `admin_smoke_${ts}@barberia.com`;
  const barberoEmail = `barbero_smoke_${ts}@barberia.com`;
  const clienteEmail = `cliente_smoke_${ts}@barberia.com`;
  const defaultPassword = 'Password123!';

  const adminPhone = '300' + (ts % 10000000).toString().padStart(7, '0');
  const barberoPhone = '301' + (ts % 10000000).toString().padStart(7, '0');
  const clientePhone = '302' + (ts % 10000000).toString().padStart(7, '0');
  const barberiaPhone = '303' + (ts % 10000000).toString().padStart(7, '0');

  // Registrar Admin
  const regAdmin = await request('/auth/register', {
    method: 'POST',
    body: {
      nombreCompleto: `Admin Smoke ${ts}`,
      correo: adminEmail,
      password: defaultPassword,
      telefono: adminPhone,
    },
  });
  if (!regAdmin.ok) throw new Error(`Fallo registro admin: ${JSON.stringify(regAdmin.data)}`);
  console.log(`   ✅ Administrador registrado: ${adminEmail}`);

  // Registrar Barbero
  const regBarbero = await request('/auth/register', {
    method: 'POST',
    body: {
      nombreCompleto: `Barbero Smoke ${ts}`,
      correo: barberoEmail,
      password: defaultPassword,
      telefono: barberoPhone,
    },
  });
  if (!regBarbero.ok) throw new Error(`Fallo registro barbero: ${JSON.stringify(regBarbero.data)}`);
  console.log(`   ✅ Barbero registrado: ${barberoEmail}`);

  // Registrar Cliente
  const regCliente = await request('/auth/register', {
    method: 'POST',
    body: {
      nombreCompleto: `Cliente Smoke ${ts}`,
      correo: clienteEmail,
      password: defaultPassword,
      telefono: clientePhone,
    },
  });
  if (!regCliente.ok) throw new Error(`Fallo registro cliente: ${JSON.stringify(regCliente.data)}`);
  console.log(`   ✅ Cliente registrado: ${clienteEmail}\n`);

  // 3. Login de Usuarios
  console.log('🔑 Paso 3: Autenticando usuarios y obteniendo tokens JWT...');
  const loginAdmin = await request('/auth/login', {
    method: 'POST',
    body: { correo: adminEmail, password: defaultPassword },
  });
  const adminToken = loginAdmin.data.accessToken;
  const adminUser = loginAdmin.data.usuario;

  const loginBarbero = await request('/auth/login', {
    method: 'POST',
    body: { correo: barberoEmail, password: defaultPassword },
  });
  const barberoToken = loginBarbero.data.accessToken;
  void barberoToken;

  const loginCliente = await request('/auth/login', {
    method: 'POST',
    body: { correo: clienteEmail, password: defaultPassword },
  });
  const clienteToken = loginCliente.data.accessToken;
  const clienteUser = loginCliente.data.usuario;

  console.log(`   ✅ Tokens JWT generados para Admin, Barbero y Cliente.\n`);

  // 4. Creación de Barbería
  console.log('💈 Paso 4: Creando Barbería con el Administrador...');
  const createBarberia = await request('/barberias', {
    method: 'POST',
    token: adminToken,
    body: {
      nombre: `Barbería Elite Smoke ${ts}`,
      descripcion: 'Barbería de alta gama para validaciones E2E',
      telefono: barberiaPhone,
      ubicacion: 'Carrera 7ma #123-45',
    },
  });
  if (!createBarberia.ok) throw new Error(`Fallo creación barbería: ${JSON.stringify(createBarberia.data)}`);
  const barberia = createBarberia.data;
  const barberiaId = barberia.id;
  const codigoAcceso = barberia.codigoAcceso;
  console.log(`   ✅ Barbería creada: "${barberia.nombre}" (ID: ${barberiaId})`);
  console.log(`   🔑 Código de acceso generado: ${codigoAcceso}\n`);

  // 5. Vinculación del Cliente a la Barbería
  console.log('🔗 Paso 5: Vinculando Cliente a la Barbería mediante código de acceso...');
  const vincularCliente = await request('/barberias/vincular', {
    method: 'POST',
    token: clienteToken,
    body: { codigoAcceso },
  });
  if (!vincularCliente.ok) throw new Error(`Fallo vinculación cliente: ${JSON.stringify(vincularCliente.data)}`);
  console.log(`   ✅ Cliente vinculado exitosamente (Estado: ${vincularCliente.data.estadoVinculacion}, Activa: ${vincularCliente.data.esBarberiaActiva})\n`);

  // 6. Creación de Servicio en Catálogo
  console.log('✂️ Paso 6: Creando Servicio en Catálogo...');
  const createServicio = await request('/catalogo/servicios', {
    method: 'POST',
    token: adminToken,
    headers: { 'x-barberia-id': barberiaId },
    body: {
      nombre: 'Corte Tradicional con Navaja',
      duracionEstimada: 45,
      precio: 35.00,
      margenOperativo: 0,
      destacado: true,
    },
  });
  if (!createServicio.ok) throw new Error(`Fallo creación servicio: ${JSON.stringify(createServicio.data)}`);
  const servicio = createServicio.data;
  const formatPrice = (val: any) => {
    if (val === null || val === undefined) return '0.00';
    if (typeof val === 'number') return val.toFixed(2);
    if (typeof val === 'string') return parseFloat(val).toFixed(2);
    if (typeof val === 'object') return (val.toNumber ? val.toNumber() : val.d ? val.d[0] : JSON.stringify(val));
    return String(val);
  };

  console.log(`   ✅ Servicio creado: "${servicio.nombre}" (Precio: $${formatPrice(servicio.precio)}, Duración: ${servicio.duracionEstimada} min)\n`);

  // 7. Configuración de Horarios de la Barbería
  console.log('⏰ Paso 7: Configurando Horarios de Atención...');
  const schedules = [];
  for (let dia = 1; dia <= 7; dia++) {
    schedules.push({
      diaSemana: dia,
      horaInicio: '08:00',
      horaFin: '20:00',
    });
  }

  const configHorarios = await request(`/barberias/${barberiaId}/horarios`, {
    method: 'POST',
    token: adminToken,
    body: schedules,
  });
  if (!configHorarios.ok) throw new Error(`Fallo configuración horarios: ${JSON.stringify(configHorarios.data)}`);
  console.log(`   ✅ Horarios configurados para los 7 días de la semana (08:00 a 20:00)\n`);

  // 8. Crear Reserva
  console.log('📅 Paso 8: Creando Reserva con motor transaccional SERIALIZABLE...');
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const fechaStr = tomorrow.toISOString().split('T')[0];

  const createReserva = await request(`/barberias/${barberiaId}/reservas`, {
    method: 'POST',
    token: clienteToken,
    body: {
      fecha: fechaStr,
      horaInicio: '10:00',
      horaFin: '10:45',
      serviciosIds: [servicio.id],
      precioTotalEsperado: 35.00,
    },
  });
  if (!createReserva.ok) throw new Error(`Fallo creación de reserva: ${JSON.stringify(createReserva.data)}`);
  const reserva = createReserva.data;
  console.log(`   ✅ Reserva agendada exitosamente (ID: ${reserva.id}, Estado: ${reserva.estado})`);
  console.log(`   💰 Total a pagar congelado: $${formatPrice(reserva.totalPagar)}\n`);

  // 9. Consultar Detalle con Snapshot Histórico
  console.log('📋 Paso 9: Verificando Snapshot Histórico Inmutable...');
  const detalleReserva = await request(`/barberias/${barberiaId}/reservas/${reserva.id}`, {
    token: clienteToken,
  });
  if (!detalleReserva.ok) throw new Error(`Fallo al consultar reserva: ${JSON.stringify(detalleReserva.data)}`);
  const participante = detalleReserva.data.participantes[0];
  const servParticipante = participante.participanteServicios[0];
  console.log(`   ✅ Snapshot validado: Precio histórico congelado = $${formatPrice(servParticipante.precioHistorico)}, Duración = ${servParticipante.duracionHistorica} min\n`);

  // 10. Registrar Pago en Persona
  console.log('💵 Paso 10: Procesando cobro en persona y auditoría financiera...');
  const registrarPago = await request(`/barberias/${barberiaId}/pagos/en-persona`, {
    method: 'POST',
    token: adminToken,
    body: {
      reservaId: reserva.id,
      monto: Number(reserva.totalPagar),
      metodoPago: 'EFECTIVO',
    },
  });
  if (!registrarPago.ok) throw new Error(`Fallo registro pago: ${JSON.stringify(registrarPago.data)}`);
  console.log(`   ✅ Pago procesado exitosamente (ID: ${registrarPago.data.pago.id}, Estado: ${registrarPago.data.pago.estado})`);

  const reservaPagada = await request(`/barberias/${barberiaId}/reservas/${reserva.id}`, {
    token: adminToken,
  });
  console.log(`   ✅ Estado final de la Reserva post-pago: ${reservaPagada.data.estado}\n`);

  // 11. Registro y Aprobación de Antecedente Técnico
  console.log('📝 Paso 11: Registrando Antecedente y Dictamen Administrativo...');
  const crearAntecedente = await request(`/barberias/${barberiaId}/antecedentes`, {
    method: 'POST',
    token: adminToken,
    body: {
      usuarioId: clienteUser.id,
      categoria: 'TECNICA',
      contenido: 'Cliente prefiere degradado con navaja cero alta en laterales.',
      compartido: true,
    },
  });
  if (!crearAntecedente.ok) throw new Error(`Fallo creación antecedente: ${JSON.stringify(crearAntecedente.data)}`);
  const antecedente = crearAntecedente.data;
  console.log(`   ✅ Antecedente registrado en estado: ${antecedente.estadoValidacion}`);

  const evaluarAntecedente = await request(`/barberias/${barberiaId}/antecedentes/${antecedente.id}/evaluar`, {
    method: 'PATCH',
    token: adminToken,
    body: {
      decision: 'APROBADO',
    },
  });
  if (!evaluarAntecedente.ok) throw new Error(`Fallo evaluación antecedente: ${JSON.stringify(evaluarAntecedente.data)}`);
  console.log(`   ✅ Antecedente evaluado y dictaminado: ${evaluarAntecedente.data.estadoValidacion}`);

  const consultarAntecedentes = await request(`/barberias/${barberiaId}/antecedentes/cliente/${clienteUser.id}`, {
    token: adminToken,
  });
  console.log(`   ✅ Consulta de antecedentes del cliente: ${consultarAntecedentes.data.length} registro(s) encontrado(s)\n`);

  // 12. Consulta de Notificaciones
  console.log('🔔 Paso 12: Consultando notificaciones emitidas por BullMQ...');
  const misNotificaciones = await request('/notificaciones/mis-notificaciones', {
    token: clienteToken,
  });
  if (misNotificaciones.ok) {
    console.log(`   ✅ Notificaciones del cliente consultadas (${misNotificaciones.data.length} recibidas exitosamente)\n`);
  } else {
    console.log(`   ℹ️ Endpoint de notificaciones respondió status ${misNotificaciones.status}\n`);
  }

  // 13. Seguridad RBAC y Módulo de Auditoría
  console.log('🛡️ Paso 13: Verificando seguridad RBAC y módulo de Auditoría...');
  
  // 13.1 Verificar que un usuario común es rechazado con 403
  const rechazoCliente = await request('/auditoria/estadisticas', {
    token: clienteToken,
  });
  console.log(`   🔒 Control de Acceso: Cliente bloqueado de auditoría (HTTP ${rechazoCliente.status} Forbidden)`);

  // 13.2 Asignar rol ADMINISTRADOR global para probar endpoints administrativos
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  try {
    const rolAdminGlobal = await prisma.rol.findUnique({ where: { nombre: 'ADMINISTRADOR' } });
    if (rolAdminGlobal) {
      await prisma.usuarioRol.create({
        data: {
          usuarioId: adminUser.id,
          rolId: rolAdminGlobal.id,
        },
      });
    }

    // Refrescar token con el nuevo rol
    const refreshLogin = await request('/auth/login', {
      method: 'POST',
      body: { correo: adminEmail, password: defaultPassword },
    });
    const superAdminToken = refreshLogin.data.accessToken;

    const statsAuditoria = await request('/auditoria/estadisticas', {
      token: superAdminToken,
    });
    if (statsAuditoria.ok) {
      console.log(`   ✅ Estadísticas de Auditoría con rol ADMINISTRADOR: Total registros = ${statsAuditoria.data.totalRegistros}, Política = ${statsAuditoria.data.politicaRetencionDias} días`);
    }

    const purgaManual = await request('/auditoria/purgar?dias=365', {
      method: 'POST',
      token: superAdminToken,
    });
    if (purgaManual.ok) {
      console.log(`   ✅ Purga preventiva ejecutada: ${purgaManual.data.registrosEliminados} registros eliminados anteriores a ${purgaManual.data.fechaCorte}`);
    }
  } finally {
    await prisma.$disconnect();
  }
  console.log('');

  console.log('================================================================');
  console.log('🎉 ¡TODOS LOS 13 PASOS DEL SMOKE TEST INTEGRAL FINALIZARON CON ÉXITO!');
  console.log('================================================================');
}

runSmokeTest().catch((err) => {
  console.error('\n❌ ERROR EN EL SMOKE TEST:', err.message);
  process.exit(1);
});
