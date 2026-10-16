import { Test, TestingModule } from '@nestjs/testing';
import { ClassSerializerInterceptor, INestApplication, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerStorage } from '@nestjs/throttler';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/shared/prisma/prisma.service.js';
import { PrismaExceptionFilter } from '../src/shared/filters/prisma-exception.filter.js';
import { fechaCalendarioISO } from '../src/shared/time/tiempo.service.js';

const API = '/api/v1';

/**
 * E3-12 · punto 3 · la desvinculación a petición del cliente.
 *
 * Es la otra mitad de la regla 1.9 (D20/D21) y la que le devuelve el control del
 * ciclo de vida: hasta aquí el cliente podía ENTRAR a una sede y, desde H71,
 * volver a entrar tras un rechazo, pero no podía SALIR por su cuenta —la única
 * vía era que la plataforma le rechazara la sexta vinculación—.
 *
 * El caso comprueba el ciclo completo y sus límites:
 *
 *   1. solo el CLIENTE dueño del vínculo: el staff recibe 403 y sin sesión, 401
 *   2. con reservas futuras vivas NO se sale (422 `RESERVAS_EN_CURSO`)
 *   3. sin reservas, la fila pasa a `DESVINCULADO` EN EL SITIO y queda auditada
 *   4. cerrar dos veces es 409, no un no-op silencioso
 *   5. D20: la restricción y el contador de la sede sobreviven al cierre (y a la
 *      reapertura de D21), así que desvincularse no es una forma de escapar
 *   6. D10: el vínculo cerrado deja de ocupar cupo —la siguiente sede ya no nace
 *      `PENDIENTE_APROBACION`—, que es lo que evita el callejón sin salida
 *
 * Las reservas se siembran por Prisma: lo que se mide aquí es la SALIDA, no el
 * alta de reserva (que tiene sus propias suites).
 */
describe('E3-12/3 · desvinculación por el cliente (D20/D21)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;

  /** Sedes del cliente: S1 restringida, S2 anclada por una reserva, S6 el cupo libre. */
  let sedeS1: string;
  let sedeS2: string;
  let sedeS3: string;
  let sedeS4: string;
  let sedeS5: string;
  let sedeS6: string;
  const codigoS1 = `E312DS1${Date.now().toString().slice(-3)}`;
  const codigoS6 = `E312DS6${Date.now().toString().slice(-3)}`;

  let adminGlobalId: string;
  let adminSedeS1Id: string;
  let clienteAId: string;
  let clienteBId: string;

  let tokenGlobal: string;
  let tokenAdminSedeS1: string;
  let tokenClienteA: string;
  let tokenClienteB: string;

  let vinculoS1: string;
  let reservaAncla: string;

  /** Fecha de la reserva que ancla: mañana, en la etiqueta UTC del `DATE`. */
  const fechaAncla = fechaCalendarioISO(new Date(Date.now() + 24 * 3600 * 1000));
  const sufijo = Date.now();
  const PASSWORD = 'ClaveE312DS';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ThrottlerStorage)
      .useValue({
        increment: async () => ({
          totalHits: 0,
          timeToExpire: 0,
          isBlocked: false,
          timeToBlockExpire: 0,
        }),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix(API);
    app.useGlobalFilters(new PrismaExceptionFilter());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));
    await app.init();

    prisma = app.get(PrismaService);
    jwtService = app.get(JwtService);

    const [rolAdministrador, rolAdminBarberia, rolCliente] = await Promise.all([
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
        where: { nombre: 'CLIENTE' },
        update: {},
        create: { nombre: 'CLIENTE', ambito: 'GLOBAL' },
      }),
    ]);

    const hash = await bcrypt.hash(PASSWORD, 10);

    const crearUsuario = async (etiqueta: string, telefono: string) =>
      (
        await prisma.usuario.create({
          data: {
            nombreCompleto: `${etiqueta} E312DS ${sufijo}`,
            correo: `${etiqueta}.e312ds.${sufijo}@test.com`,
            telefono,
            passwordHash: hash,
          },
          select: { id: true },
        })
      ).id;

    adminGlobalId = await crearUsuario('global', `5${String(sufijo).slice(-9)}`);
    adminSedeS1Id = await crearUsuario('admin.s1', `6${String(sufijo).slice(-9)}`);
    clienteAId = await crearUsuario('cliente.a', `7${String(sufijo).slice(-9)}`);
    clienteBId = await crearUsuario('cliente.b', `8${String(sufijo).slice(-9)}`);

    const crearSede = async (etiqueta: string, codigo: string, enlace: string) =>
      (
        await prisma.barberia.create({
          data: {
            nombre: `Barbería E312DS ${etiqueta} ${sufijo}`,
            telefono: '944444444',
            ubicacion: `Sede ${etiqueta}`,
            codigoAcceso: codigo,
            enlaceUnico: enlace,
            responsableId: adminGlobalId,
          },
          select: { id: true },
        })
      ).id;

    sedeS1 = await crearSede('S1 restringida', codigoS1, `e312ds-s1-${sufijo}`);
    sedeS2 = await crearSede('S2 anclada', `E312DS2${String(sufijo).slice(-3)}`, `e312ds-s2-${sufijo}`);
    sedeS3 = await crearSede('S3', `E312DS3${String(sufijo).slice(-3)}`, `e312ds-s3-${sufijo}`);
    sedeS4 = await crearSede('S4', `E312DS4${String(sufijo).slice(-3)}`, `e312ds-s4-${sufijo}`);
    sedeS5 = await crearSede('S5', `E312DS5${String(sufijo).slice(-3)}`, `e312ds-s5-${sufijo}`);
    sedeS6 = await crearSede('S6', codigoS6, `e312ds-s6-${sufijo}`);

    await prisma.usuarioRol.createMany({
      data: [
        { usuarioId: adminGlobalId, rolId: rolAdministrador.id, barberiaId: null },
        { usuarioId: adminSedeS1Id, rolId: rolAdminBarberia.id, barberiaId: sedeS1 },
        { usuarioId: clienteAId, rolId: rolCliente.id, barberiaId: null },
        { usuarioId: clienteBId, rolId: rolCliente.id, barberiaId: null },
      ],
    });

    // Los CINCO vínculos vivos del cliente (el límite de D10 es estar en cinco).
    // S1 llega restringida con el contador alto: es el caso de D20.
    const crearVinculo = async (barberiaId: string, extra: Record<string, unknown> = {}) =>
      (
        await prisma.clienteBarberia.create({
          data: {
            usuarioId: clienteAId,
            barberiaId,
            estadoVinculacion: 'ACTIVO',
            esBarberiaActiva: false,
            ...extra,
          },
          select: { id: true },
        })
      ).id;

    vinculoS1 = await crearVinculo(sedeS1, {
      contadorNoPresentado: 4,
      estaRestringido: true,
      motivoRestriccion: 'Bloqueo automático: alcanzaste el límite de 5 inasistencias.',
    });
    await crearVinculo(sedeS2);
    await crearVinculo(sedeS3);
    await crearVinculo(sedeS4);
    await crearVinculo(sedeS5, { esBarberiaActiva: true });

    const correos = await prisma.usuario.findMany({
      where: { id: { in: [adminGlobalId, adminSedeS1Id, clienteAId, clienteBId] } },
      select: { id: true, correo: true },
    });
    const correoDe = (id: string) => correos.find((u) => u.id === id)!.correo;

    tokenGlobal = await jwtService.signAsync({
      sub: adminGlobalId,
      correo: correoDe(adminGlobalId),
      roles: ['ADMINISTRADOR'],
    });
    tokenAdminSedeS1 = await jwtService.signAsync({
      sub: adminSedeS1Id,
      correo: correoDe(adminSedeS1Id),
      roles: ['ADMIN_BARBERIA'],
    });
    tokenClienteA = await jwtService.signAsync({
      sub: clienteAId,
      correo: correoDe(clienteAId),
      roles: ['CLIENTE'],
    });
    tokenClienteB = await jwtService.signAsync({
      sub: clienteBId,
      correo: correoDe(clienteBId),
      roles: ['CLIENTE'],
    });

    // La cita que ancla el vínculo con S2: futura y CONFIRMADA (§E3-12/3).
    reservaAncla = (
      await prisma.reserva.create({
        data: {
          barberiaId: sedeS2,
          clienteId: clienteAId,
          tipoReserva: 'INDIVIDUAL',
          estado: 'CONFIRMADA',
          modoConfirmacion: 'MANUAL',
          fechaCita: new Date(`${fechaAncla}T00:00:00.000Z`),
          horaInicio: new Date('1970-01-01T10:00:00.000Z'),
          horaFin: new Date('1970-01-01T10:30:00.000Z'),
          totalPagar: 25,
        },
        select: { id: true },
      })
    ).id;
  }, 120_000);

  afterAll(async () => {
    const idsSede = [sedeS1, sedeS2, sedeS3, sedeS4, sedeS5, sedeS6];
    const idsUsuario = [adminGlobalId, adminSedeS1Id, clienteAId, clienteBId];

    await prisma.reserva.deleteMany({ where: { barberiaId: { in: idsSede } } });
    await prisma.auditoria.deleteMany({ where: { usuarioId: { in: idsUsuario } } });
    await prisma.notificacion.deleteMany({ where: { usuarioId: { in: idsUsuario } } });
    await prisma.usuarioRol.deleteMany({
      where: { OR: [{ usuarioId: { in: idsUsuario } }, { barberiaId: { in: idsSede } }] },
    });
    await prisma.clienteBarberia.deleteMany({ where: { usuarioId: { in: idsUsuario } } });
    await prisma.configuracionBarberia.deleteMany({ where: { barberiaId: { in: idsSede } } });
    await prisma.barberia.deleteMany({ where: { id: { in: idsSede } } });
    await prisma.usuario.deleteMany({ where: { id: { in: idsUsuario } } });

    await app.close();
  }, 60_000);

  const desvincular = (token: string | null, sede = sedeS1) =>
    request(app.getHttpServer())
      .post(`${API}/barberias/${sede}/mi-estado/desvincular`)
      .set(token ? { Authorization: `Bearer ${token}` } : {})
      .send({});

  // ── Fase 1 · quién puede cerrar el vínculo ────────────────────────────────

  describe('autorización', () => {
    it('sin sesión responde 401', async () => {
      await desvincular(null).expect(401);
    });

    it('el ADMIN_BARBERIA de la sede no cierra el vínculo de nadie (403 del guard)', async () => {
      const res = await desvincular(tokenAdminSedeS1).expect(403);

      // Ni siquiera es una decisión de negocio: la ruta es solo del CLIENTE.
      expect(res.body.codigo).not.toBe('NO_VINCULADO');

      const fila = await prisma.clienteBarberia.findUniqueOrThrow({
        where: { id: vinculoS1 },
        select: { estadoVinculacion: true },
      });
      expect(fila.estadoVinculacion).toBe('ACTIVO');
    });

    it('otro cliente sin vínculo en esa sede recibe 403 NO_VINCULADO', async () => {
      const res = await desvincular(tokenClienteB).expect(403);

      expect(res.body).toMatchObject({ statusCode: 403, codigo: 'NO_VINCULADO' });

      const fila = await prisma.clienteBarberia.findUniqueOrThrow({
        where: { id: vinculoS1 },
        select: { estadoVinculacion: true },
      });
      expect(fila.estadoVinculacion).toBe('ACTIVO');
    });
  });

  // ── Fase 2 · con reservas futuras vivas no se sale ────────────────────────

  describe('422 RESERVAS_EN_CURSO', () => {
    it('una reserva CONFIRMADA futura ancla el vínculo y el cierre responde 422 con el conteo', async () => {
      const res = await desvincular(tokenClienteA, sedeS2).expect(422);

      expect(res.body).toMatchObject({
        statusCode: 422,
        codigo: 'RESERVAS_EN_CURSO',
        conteo: 1,
      });
      expect(res.body.reservas[0]).toMatchObject({
        reservaId: reservaAncla,
        estado: 'CONFIRMADA',
        fecha: fechaAncla,
        hora: '10:00',
      });

      const fila = await prisma.clienteBarberia.findUniqueOrThrow({
        where: { uk_cliente_barberia: { usuarioId: clienteAId, barberiaId: sedeS2 } },
        select: { estadoVinculacion: true },
      });
      expect(fila.estadoVinculacion).toBe('ACTIVO');

      // Un 422 de regla de negocio no deja nada en la auditoría. El conteo va
      // acotado a ESTE cliente a propósito: la base es compartida con el resto de
      // la suite y `auditoria.usuario_id` es `ON DELETE SET NULL`, así que las
      // filas que otros specs dejan atrás pierden su autor y cualquier conteo
      // global deja de ser determinista.
      const eventos = await prisma.auditoria.count({
        where: { accion: 'CLIENTE_DESVINCULADO_VOLUNTARIAMENTE', usuarioId: clienteAId },
      });
      expect(eventos).toBe(0);
    });

    it('cancelada la cita, la ventana se cierra y el cierre ya es posible', async () => {
      await prisma.reserva.update({
        where: { id: reservaAncla },
        data: { estado: 'CANCELADA' },
      });

      const res = await desvincular(tokenClienteA, sedeS2).expect(200);
      expect(res.body.estadoVinculacion).toBe('DESVINCULADO');

      // Se devuelve el vínculo para no alterar el resto de la secuencia: el
      // cliente vuelve a estar en cinco sedes vivas.
      const reabierto = await prisma.clienteBarberia.update({
        where: { uk_cliente_barberia: { usuarioId: clienteAId, barberiaId: sedeS2 } },
        data: { estadoVinculacion: 'ACTIVO' },
        select: { id: true },
      });
      expect(reabierto.id).toBeTruthy();
    });
  });

  // ── Fase 3 · el cierre ────────────────────────────────────────────────────

  describe('POST /barberias/:barberiaId/mi-estado/desvincular', () => {
    it('el cliente cierra su vínculo: la fila queda DESVINCULADO en el sitio y auditada', async () => {
      const res = await desvincular(tokenClienteA).expect(200);

      expect(res.body).toMatchObject({
        barberiaId: sedeS1,
        clienteId: clienteAId,
        estadoVinculacion: 'DESVINCULADO',
        esBarberiaActiva: false,
        // Cuatro vivos tras cerrar este: el cupo que D10 le devuelve.
        vinculacionesVigentes: 4,
      });

      const fila = await prisma.clienteBarberia.findUniqueOrThrow({
        where: { id: vinculoS1 },
        select: {
          estadoVinculacion: true,
          esBarberiaActiva: true,
          contadorNoPresentado: true,
          estaRestringido: true,
          motivoRestriccion: true,
        },
      });
      expect(fila.estadoVinculacion).toBe('DESVINCULADO');
      expect(fila.esBarberiaActiva).toBe(false);
      // D20: el cierre NO perdona inasistencias ni levanta la restricción.
      expect(fila.contadorNoPresentado).toBe(4);
      expect(fila.estaRestringido).toBe(true);
      expect(fila.motivoRestriccion).toContain('5 inasistencias');

      const evento = await prisma.auditoria.findFirst({
        where: { accion: 'CLIENTE_DESVINCULADO_VOLUNTARIAMENTE', entidadId: vinculoS1 },
      });
      expect(evento).not.toBeNull();
      expect(evento?.usuarioId).toBe(clienteAId);
      expect(evento?.contexto).toMatchObject({
        barberiaId: sedeS1,
        clienteId: clienteAId,
        anterior: { estadoVinculacion: 'ACTIVO', esBarberiaActiva: false },
        nuevo: { estadoVinculacion: 'DESVINCULADO', esBarberiaActiva: false },
      });
    });

    it('cerrar dos veces no es idempotente: 409 ESTADO_INVALIDO', async () => {
      const res = await desvincular(tokenClienteA).expect(409);

      expect(res.body).toMatchObject({ statusCode: 409, codigo: 'ESTADO_INVALIDO' });

      const eventos = await prisma.auditoria.count({
        where: { accion: 'CLIENTE_DESVINCULADO_VOLUNTARIAMENTE', entidadId: vinculoS1 },
      });
      expect(eventos).toBe(1);
    });

    it('el cliente ve su vínculo cerrado y SIGUE restringido (no se evade la penalización)', async () => {
      const res = await request(app.getHttpServer())
        .get(`${API}/barberias/${sedeS1}/mi-estado`)
        .set('Authorization', `Bearer ${tokenClienteA}`)
        .expect(200);

      expect(res.body).toMatchObject({
        estadoVinculacion: 'DESVINCULADO',
        estaRestringido: true,
        contadorNoPresentado: 4,
      });
    });

    it('cerrado el vínculo, la sede deja de estar a su alcance (403 del guard de vínculo)', async () => {
      await request(app.getHttpServer())
        .get(`${API}/catalogo/servicios`)
        .set('Authorization', `Bearer ${tokenClienteA}`)
        .set('x-barberia-id', sedeS1)
        .expect(403);
    });
  });

  // ── Fase 4 · el cupo de D10 y la vuelta de D21 ────────────────────────────

  describe('D10 · el vínculo cerrado deja de ocupar cupo', () => {
    it('la siguiente sede nace ACTIVA, no PENDIENTE_APROBACION', async () => {
      const res = await request(app.getHttpServer())
        .post(`${API}/barberias/vincular`)
        .set('Authorization', `Bearer ${tokenClienteA}`)
        .send({ codigoAcceso: codigoS6 })
        .expect(201);

      // Con el conteo viejo (que incluía el vínculo cerrado) esta sexta habría
      // nacido pendiente de aprobación: el cliente habría quedado atrapado.
      expect(res.body).toMatchObject({
        usuarioId: clienteAId,
        barberiaId: sedeS6,
        estadoVinculacion: 'ACTIVO',
      });
    });

    it('D21/D20: reintroducir el código REABRE la fila cerrada conservando el contador y la restricción', async () => {
      const res = await request(app.getHttpServer())
        .post(`${API}/barberias/vincular`)
        .set('Authorization', `Bearer ${tokenClienteA}`)
        .send({ codigoAcceso: codigoS1 })
        .expect(201);

      // La MISMA fila (no una nueva) y con el estado que le toca hoy por D10:
      // el cliente vuelve a estar en cinco sedes vivas, así que esta decimosexta
      // pide aprobación otra vez.
      expect(res.body.id).toBe(vinculoS1);
      expect(res.body.estadoVinculacion).toBe('PENDIENTE_APROBACION');

      const fila = await prisma.clienteBarberia.findUniqueOrThrow({
        where: { id: vinculoS1 },
        select: { contadorNoPresentado: true, estaRestringido: true },
      });
      expect(fila.contadorNoPresentado).toBe(4);
      expect(fila.estaRestringido).toBe(true);
    });
  });
});
