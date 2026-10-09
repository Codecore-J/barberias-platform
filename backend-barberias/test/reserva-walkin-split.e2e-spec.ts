import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, ClassSerializerInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/shared/prisma/prisma.service.js';
import { PrismaExceptionFilter } from '../src/shared/filters/prisma-exception.filter.js';

/**
 * E3-03 · parte 1: el alias `POST /reservas` deja de ser de cuatro roles.
 *
 * `POST /reservas` lo usaban DOS pantallas a la vez, por eso tenía los cuatro
 * roles con un TODO:
 *
 *  - `reserva-wizard.component.ts` (cliente): manda `barberoId` OPCIONAL
 *    (hoy siempre ausente) y sin `nombreInvitado`.
 *  - `walk-in-modal.component.ts` (agenda): manda `barberoId` OBLIGATORIO y
 *    `nombreInvitado`.
 *
 * E3-03 parte la ruta: `POST /reservas` queda para CLIENTE (el wizard) y el
 * walk-in pasa a `POST /reservas/walk-in` con los tres roles de agenda. La
 * comprobación es de GUARD (el decorador), así que se ve en el status HTTP.
 *
 * Los controles 3-5 existen para que un 403 general —una app que deniega
 * todo— no haga pasar este test por el motivo equivocado.
 */
describe('E3-03 · partición de POST /reservas: cliente vs walk-in', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;

  const correos = [
    'duenio.split@e303.test',
    'cliente.split@e303.test',
    'barbero.split@e303.test',
    'adminsed.split@e303.test',
    'global.split@e303.test',
  ];

  let barberiaId: string;
  let servicioId: string;
  let barberoRealId: string;

  let tokenCliente: string;
  let tokenBarbero: string;
  let tokenAdminSede: string;

  const api = '/api/v1';

  /** Reserva candidata: cada caso usa una hora distinta para no solapar. */
  function payload(horaInicio: string, extra: Record<string, unknown> = {}) {
    const [h, m] = horaInicio.split(':').map(Number);
    const fin = new Date(2000, 0, 1, h, m + 30);
    const horaFin = `${String(fin.getHours()).padStart(2, '0')}:${String(fin.getMinutes()).padStart(2, '0')}`;
    return {
      fecha: '2099-01-15',
      horaInicio,
      horaFin,
      serviciosIds: [servicioId],
      precioTotalEsperado: 30,
      tipo: 'INDIVIDUAL',
      ...extra,
    };
  }

  /** El walk-in exige barbero (es la regla de la pantalla de agenda). */
  function payloadWalkIn(horaInicio: string) {
    return payload(horaInicio, { barberoId: barberoRealId, nombreInvitado: 'Cliente Walk-In' });
  }

  async function limpiar() {
    const usuarios = await prisma.usuario.findMany({
      where: { correo: { in: correos } },
      select: { id: true },
    });
    const idsUsuario = usuarios.map((u) => u.id);

    const sedes = await prisma.barberia.findMany({
      where: { OR: [{ nombre: { contains: 'SPLIT-E303' } }, { responsableId: { in: idsUsuario } }] },
      select: { id: true },
    });
    const idsSede = sedes.map((s) => s.id);

    const reservas = await prisma.reserva.findMany({
      where: { barberiaId: { in: idsSede } },
      select: { id: true },
    });
    const idsReserva = reservas.map((r) => r.id);

    await prisma.pago.deleteMany({ where: { reservaId: { in: idsReserva } } });
    await prisma.reserva.deleteMany({ where: { id: { in: idsReserva } } });
    await prisma.auditoria.deleteMany({ where: { usuarioId: { in: idsUsuario } } });
    await prisma.servicio.deleteMany({ where: { barberiaId: { in: idsSede } } });
    await prisma.horario.deleteMany({ where: { barberiaId: { in: idsSede } } });
    await prisma.usuarioRol.deleteMany({ where: { usuarioId: { in: idsUsuario } } });
    await prisma.clienteBarberia.deleteMany({ where: { usuarioId: { in: idsUsuario } } });
    // config y reporte: cascade o FK débil, se limpian por seguridad.
    await prisma.reporte.deleteMany({ where: { barberiaId: { in: idsSede } } });
    await prisma.barberia.deleteMany({ where: { id: { in: idsSede } } });
    await prisma.usuario.deleteMany({ where: { id: { in: idsUsuario } } });
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue({
        increment: async () => ({ totalHits: 0, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 }),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new PrismaExceptionFilter());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));
    await app.init();

    prisma = app.get(PrismaService);
    jwtService = app.get(JwtService);

    await limpiar();

    const roles: Record<string, { id: string }> = {};
    for (const [nombre, ambito] of [
      ['ADMINISTRADOR', 'GLOBAL'],
      ['ADMIN_BARBERIA', 'BARBERIA'],
      ['BARBERO', 'BARBERIA'],
      ['CLIENTE', 'GLOBAL'],
    ] as [string, string][]) {
      roles[nombre] = await prisma.rol.upsert({
        where: { nombre },
        update: {},
        create: { nombre, ambito },
        select: { id: true },
      });
    }

    const [duenio, cliente, barbero, adminSede, global] = await Promise.all(
      correos.map((correo, i) =>
        prisma.usuario.create({
          data: {
            nombreCompleto: `Split E303 ${i}`,
            correo,
            telefono: `9998${String(i).padStart(7, '0')}`,
            passwordHash: '$2b$10$HashFalsoSplitE303NoSeUsaParaLogin',
          },
          select: { id: true },
        }),
      ),
    );
    barberoRealId = barbero.id;

    barberiaId = (
      await prisma.barberia.create({
        data: {
          nombre: 'Barberia SPLIT-E303',
          telefono: '9998111111',
          ubicacion: 'Sede split',
          codigoAcceso: 'E303SPLIT',
          enlaceUnico: 'https://split.e303.test',
          responsableId: duenio.id,
        },
        select: { id: true },
      })
    ).id;

    // La config la exige crearReserva; todos los campos tienen default.
    await prisma.configuracionBarberia.create({ data: { barberiaId } });

    await prisma.usuarioRol.createMany({
      data: [
        { usuarioId: adminSede.id, rolId: roles['ADMIN_BARBERIA'].id, barberiaId },
        { usuarioId: barbero.id, rolId: roles['BARBERO'].id, barberiaId },
        { usuarioId: cliente.id, rolId: roles['CLIENTE'].id, barberiaId: null },
        { usuarioId: global.id, rolId: roles['ADMINISTRADOR'].id, barberiaId: null },
      ],
    });

    // La creación de reserva (E3-03/2) exige vínculo ACTIVO entre quien la
    // crea y la sede (`NO_VINCULADO`). Aquí el creador es el propio cliente o
    // el staff de la sede, así que los tres llevan su fila en cliente_barberias.
    await prisma.clienteBarberia.createMany({
      data: [cliente.id, barbero.id, adminSede.id].map((usuarioId) => ({
        usuarioId,
        barberiaId,
        estadoVinculacion: 'ACTIVO',
      })),
    });

    servicioId = (
      await prisma.servicio.create({
        data: { barberiaId, nombre: 'Corte Split', precio: 30, duracionEstimada: 30, margenOperativo: 0 },
        select: { id: true },
      })
    ).id;

    // Horario de sede 00:00-23:59 todos los días: cualquier hora cuadra.
    await prisma.horario.createMany({
      data: Array.from({ length: 7 }, (_, diaSemana) => ({
        barberiaId,
        diaSemana,
        horaInicio: new Date('1970-01-01T00:00:00.000Z'),
        horaFin: new Date('1970-01-01T23:59:00.000Z'),
      })),
    });

    // Tokens firmados directamente (patrón de permisos-matriz.e2e): la
    // JwtStrategy recarga `sub` desde la BD y monta los roles desde
    // usuario_roles, así que el rol que importa es el de la fila, no el payload.
    tokenCliente = await jwtService.signAsync({ sub: cliente.id, correo: correos[1], roles: [] });
    tokenBarbero = await jwtService.signAsync({ sub: barbero.id, correo: correos[2], roles: [] });
    tokenAdminSede = await jwtService.signAsync({ sub: adminSede.id, correo: correos[3], roles: [] });
    // El ADMINISTRADOR global no necesita token propio aquí: lo que valida su
    // acceso a ambas rutas es la matriz (`permisos-matriz.e2e-spec.ts`), donde
    // el guard lo concede por jerarquía (E1-04).
  }, 120_000);

  afterAll(async () => {
    await limpiar();
    await app.close();
  }, 60_000);

  it('ROJO: un CLIENTE no puede crear un walk-in por la ruta de agenda (403)', async () => {
    const res = await request(app.getHttpServer())
      .post(`${api}/barberias/${barberiaId}/reservas/walk-in`)
      .set('Authorization', `Bearer ${tokenCliente}`)
      .send(payloadWalkIn('10:00'));

    expect(res.status).toBe(403);
  });

  it('ROJO: un BARBERO no puede usar el alias de cliente POST /reservas (403)', async () => {
    const res = await request(app.getHttpServer())
      .post(`${api}/barberias/${barberiaId}/reservas`)
      .set('Authorization', `Bearer ${tokenBarbero}`)
      .send(payload('11:00'));

    expect(res.status).toBe(403);
  });

  it('control: el CLIENTE sigue creando su reserva por POST /reservas (201)', async () => {
    const res = await request(app.getHttpServer())
      .post(`${api}/barberias/${barberiaId}/reservas`)
      .set('Authorization', `Bearer ${tokenCliente}`)
      .send(payload('12:00'));

    expect([200, 201], `POST /reservas como CLIENTE → ${res.status} ${JSON.stringify(res.body)}`).toContain(res.status);
  });

  it('control: el BARBERO sí crea el walk-in por la ruta nueva (201)', async () => {
    const res = await request(app.getHttpServer())
      .post(`${api}/barberias/${barberiaId}/reservas/walk-in`)
      .set('Authorization', `Bearer ${tokenBarbero}`)
      .send(payloadWalkIn('13:00'));

    expect([200, 201], `POST /reservas/walk-in como BARBERO → ${res.status} ${JSON.stringify(res.body)}`).toContain(res.status);
  });

  it('control: el ADMIN_BARBERIA de la sede también crea walk-in (201)', async () => {
    const res = await request(app.getHttpServer())
      .post(`${api}/barberias/${barberiaId}/reservas/walk-in`)
      .set('Authorization', `Bearer ${tokenAdminSede}`)
      .send(payloadWalkIn('14:00'));

    expect([200, 201], `POST /reservas/walk-in como ADMIN_BARBERIA → ${res.status} ${JSON.stringify(res.body)}`).toContain(res.status);
  });
});
