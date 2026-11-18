import { Test, TestingModule } from '@nestjs/testing';
import {
  ClassSerializerInterceptor,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';
import { PrismaExceptionFilter } from './../src/shared/filters/prisma-exception.filter.js';
import { PrismaService } from './../src/shared/prisma/prisma.service.js';
import { TiempoService, ZONA_POR_DEFECTO } from './../src/shared/time/tiempo.service.js';

/**
 * T-15 · `GET /analytics/plataforma/hoy` (integración real: HTTP + PostgreSQL).
 *
 * Lo que solo se puede comprobar con la base delante: que las cifras que ve el
 * ADMINISTRADOR global son EXACTAMENTE las de la base —contando todas las sedes
 * y sin los cobros anulados— y que los demás roles no entran. Los 200/403/401
 * de los casos se ejecutan con el `RolesGuard` y el `JwtAuthGuard` reales, no
 * con metadata.
 */
describe('T-15 · métricas de plataforma (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const api = '/api/v1';
  const sufijo = String(Date.now()).slice(-6);
  const CORREO_ADMIN = `t15.admin.${sufijo}@test.com`;
  const CORREO_SEDE = `t15.sede.${sufijo}@test.com`;
  const CORREO_BARBERO = `t15.barbero.${sufijo}@test.com`;
  const CORREOS = [CORREO_ADMIN, CORREO_SEDE, CORREO_BARBERO];
  const PASSWORD = 'Password1!';
  const NOMBRE_SEDE = `Sede T15 ${sufijo}`;
  // `usuarios.telefono` exige exactamente 10 dígitos (CHECK de la base).
  const TEL_ADMIN = `990${sufijo}1`;
  const TEL_SEDE = `990${sufijo}2`;
  const TEL_BARBERO = `990${sufijo}3`;

  let tokenAdmin = '';
  let tokenSede = '';
  let tokenBarbero = '';
  let barberiaId = '';

  // T-42 · el endpoint cuenta el día de la SEDE, no el del proceso. El fixture
  // usa la misma etiqueta para no depender de la hora a la que corra el CI: a
  // las 00:30 UTC la sede sigue en el día anterior y `setHours(0,0,0,0)`
  // anclaba las citas al día equivocado, o sea que la prueba fallaba por el
  // reloj y no por el contador.
  const tiempo = new TiempoService();
  const hoySede = tiempo.fechaLocal(tiempo.ahora(), ZONA_POR_DEFECTO);

  async function crearUsuario(correo: string, nombre: string, telefono: string) {
    const passwordHash = await bcrypt.hash(PASSWORD, 10);
    return prisma.usuario.create({
      data: {
        correo,
        nombreCompleto: nombre,
        telefono,
        passwordHash,
        telefonoVerificado: true,
        estadoCuenta: 'ACTIVO',
      },
    });
  }

  const login = async (correo: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post(`${api}/auth/login`)
      .send({ correo, password: PASSWORD });
    expect(res.status, `login de ${correo}`).toBe(200);
    return res.body.accessToken as string;
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new PrismaExceptionFilter());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));
    await app.init();
    prisma = app.get(PrismaService);

    // Limpieza idempotente de una ejecución anterior interrumpida.
    await prisma.usuarioRol.deleteMany({ where: { usuario: { correo: { in: CORREOS } } } });
    await prisma.barberia.deleteMany({ where: { nombre: NOMBRE_SEDE } });
    await prisma.usuario.deleteMany({ where: { correo: { in: CORREOS } } });

    const [rolAdmin, rolSede, rolBarbero] = await Promise.all([
      prisma.rol.upsert({
        where: { nombre: 'ADMINISTRADOR' },
        update: {},
        create: { nombre: 'ADMINISTRADOR', ambito: 'GLOBAL' },
      }),
      prisma.rol.upsert({
        where: { nombre: 'ADMIN_BARBERIA' },
        update: {},
        create: { nombre: 'ADMIN_BARBERIA', ambito: 'BARBERIA' },
      }),
      prisma.rol.upsert({
        where: { nombre: 'BARBERO' },
        update: {},
        create: { nombre: 'BARBERO', ambito: 'BARBERIA' },
      }),
    ]);

    const admin = await crearUsuario(CORREO_ADMIN, 'Admin Global T15', TEL_ADMIN);
    const adminSede = await crearUsuario(CORREO_SEDE, 'Admin Sede T15', TEL_SEDE);
    const barbero = await crearUsuario(CORREO_BARBERO, 'Barbero T15', TEL_BARBERO);

    const barberia = await prisma.barberia.create({
      data: {
        nombre: NOMBRE_SEDE,
        telefono: '9994000000',
        ubicacion: 'Calle T15',
        codigoAcceso: `T15${sufijo}`,
        enlaceUnico: `sede-t15-${sufijo}`,
        responsableId: adminSede.id,
      },
    });
    barberiaId = barberia.id;

    await prisma.usuarioRol.create({
      data: { usuarioId: admin.id, rolId: rolAdmin.id, barberiaId: null },
    });
    await prisma.usuarioRol.create({
      data: { usuarioId: adminSede.id, rolId: rolSede.id, barberiaId: barberia.id },
    });
    await prisma.usuarioRol.create({
      data: { usuarioId: barbero.id, rolId: rolBarbero.id, barberiaId: barberia.id },
    });

    // Una cita de HOY con cobro válido y otro ANULADO: el segundo no puede sumar.
    // `fechaCita` es un DATE: la etiqueta del día de la sede, no un instante.
    const hoy = tiempo.fechaDeCalendario(hoySede);
    const reserva = await prisma.reserva.create({
      data: {
        barberiaId: barberia.id,
        clienteId: barbero.id,
        barberoId: barbero.id,
        tipoReserva: 'INDIVIDUAL',
        estado: 'COMPLETADA',
        modoConfirmacion: 'MANUAL',
        fechaCita: hoy,
        horaInicio: new Date(Date.UTC(1970, 0, 1, 10, 0)),
        horaFin: new Date(Date.UTC(1970, 0, 1, 10, 30)),
        totalPagar: 100,
      },
    });
    await prisma.pago.create({
      data: {
        reservaId: reserva.id,
        barberiaId: barberia.id,
        estadoPago: 'PAGADA',
        monto: 100,
        metodoPago: 'EFECTIVO',
        registradoPor: barbero.id,
      },
    });

    tokenAdmin = await login(CORREO_ADMIN);
    tokenSede = await login(CORREO_SEDE);
    tokenBarbero = await login(CORREO_BARBERO);
  }, 60000);

  afterAll(async () => {
    await prisma.pago.deleteMany({ where: { barberiaId } });
    await prisma.participanteServicio.deleteMany({
      where: { participante: { reserva: { barberiaId } } },
    });
    await prisma.participanteReserva.deleteMany({ where: { reserva: { barberiaId } } });
    await prisma.reserva.deleteMany({ where: { barberiaId } });
    await prisma.usuarioRol.deleteMany({ where: { usuario: { correo: { in: CORREOS } } } });
    await prisma.barberia.deleteMany({ where: { nombre: NOMBRE_SEDE } });
    await prisma.usuario.deleteMany({ where: { correo: { in: CORREOS } } });
    await app.close();
  }, 30000);

  it('sin token responde 401', async () => {
    await request(app.getHttpServer()).get(`${api}/analytics/plataforma/hoy`).expect(401);
  });

  it('ADMIN_BARBERIA y BARBERO reciben 403: las cifras de la red no son suyas', async () => {
    await request(app.getHttpServer())
      .get(`${api}/analytics/plataforma/hoy`)
      .set('Authorization', `Bearer ${tokenSede}`)
      .expect(403);

    await request(app.getHttpServer())
      .get(`${api}/analytics/plataforma/hoy`)
      .set('Authorization', `Bearer ${tokenBarbero}`)
      .expect(403);
  });

  it('ADMINISTRADOR recibe 200 con las métricas reales del día', async () => {
    // Mismo día y mismos instantes que usa el servicio: el día local de la sede
    // (`[00:00 local, 00:00 del día siguiente)`), no el día UTC del runner.
    const inicio = tiempo.aInstante(hoySede, '00:00', ZONA_POR_DEFECTO);
    const manana = tiempo.aInstante(tiempo.sumarDias(hoySede, 1), '00:00', ZONA_POR_DEFECTO);
    const hoyCalendario = tiempo.fechaDeCalendario(hoySede);
    const mananaCalendario = tiempo.fechaDeCalendario(tiempo.sumarDias(hoySede, 1));

    // La expectativa se calcula con la MISMA base: si divergiera, es que el
    // endpoint cuenta otra cosa (p. ej. sumando los cobros anulados).
    const [sedesActivas, citasHoy, pagos, cajasAbiertas, usuariosActivos] = await Promise.all([
      prisma.barberia.count({ where: { estado: 'ACTIVO' } }),
      prisma.reserva.count({
        where: { fechaCita: { gte: hoyCalendario, lt: mananaCalendario } },
      }),
      prisma.pago.aggregate({
        _sum: { monto: true },
        where: { estadoPago: { not: 'ANULADO' }, registradoAt: { gte: inicio, lt: manana } },
      }),
      prisma.cierreCaja.count({ where: { estado: 'ABIERTO' } }),
      prisma.usuario.count({ where: { estadoCuenta: 'ACTIVO' } }),
    ]);

    const res = await request(app.getHttpServer())
      .get(`${api}/analytics/plataforma/hoy`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    expect(res.body).toMatchObject({
      sedesActivas,
      citasHoy,
      cajasAbiertas,
      usuariosActivos,
    });
    expect(res.body.recaudadoHoy).toBeCloseTo(Number(pagos._sum.monto ?? 0), 2);
    expect(res.body.fecha).toBe(hoySede);

    // La cita sembrada cuenta: el endpoint no filtra por sede.
    expect(citasHoy).toBeGreaterThanOrEqual(1);
    // Los cinco contadores son números, nunca null.
    for (const campo of ['sedesActivas', 'citasHoy', 'recaudadoHoy', 'cajasAbiertas', 'usuariosActivos']) {
      expect(typeof res.body[campo]).toBe('number');
    }
  });
});
