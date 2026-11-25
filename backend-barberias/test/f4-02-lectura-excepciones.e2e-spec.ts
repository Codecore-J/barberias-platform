import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/shared/prisma/prisma.service.js';
import { JwtAuthGuard } from '../src/iam/infrastructure/jwt-auth.guard.js';

/**
 * F4-02 · el barbero LEE sus excepciones.
 *
 * La matriz objetivo dice que `GET /shops/:shopId/hours/exceptions` es la
 * lectura de la sede y que «el barbero ve además las propias». El decorador
 * solo declaraba al ADMIN_BARBERIA, así que el barbero ni siquiera podía
 * consultar su propio calendario de excepciones.
 *
 * Lo que se fija aquí:
 *  1. el barbero recibe 200 con las de la SEDE y las SUYAS, nunca las de un
 *     compañero;
 *  2. el ADMIN_BARBERIA sigue viendo las de la sede (no gana las ajenas);
 *  3. el CLIENTE sigue fuera.
 *
 * Solo corre contra el Postgres local de `docker-compose` (`.env.test`).
 */
describe('F4-02 · lectura propia de excepciones', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;

  const correos = {
    ADMIN_BARBERIA: 'f402_admin@f402.test',
    BARBERO: 'f402_barbero@f402.test',
    COMPANERO: 'f402_companero@f402.test',
    CLIENTE: 'f402_cliente@f402.test',
  };

  let barberiaId = '';
  const usuarios = { admin: '', barbero: '', companero: '', cliente: '' };
  const tokens: Record<keyof typeof correos, string> = {
    ADMIN_BARBERIA: '',
    BARBERO: '',
    COMPANERO: '',
    CLIENTE: '',
  };

  const sede = new Date('2099-04-01T00:00:00.000Z');
  const propia = new Date('2099-04-02T00:00:00.000Z');
  const ajena = new Date('2099-04-03T00:00:00.000Z');

  let secuenciaTelefono = 0;

  async function crearUsuario(correo: string, rolId: string | null, barberia: string | null) {
    secuenciaTelefono += 1;
    const usuario = await prisma.usuario.create({
      data: {
        telefonoVerificado: true,
        nombreCompleto: `F402 ${correo}`,
        correo,
        telefono: `8${String(secuenciaTelefono).padStart(9, '0')}`,
        passwordHash: '$2b$10$HashFalsoF402NoSeUsaParaLogin',
        estadoCuenta: 'ACTIVO',
        usuarioRoles: rolId ? { create: [{ rolId, barberiaId: barberia }] } : undefined,
      },
      select: { id: true },
    });
    return usuario.id;
  }

  async function limpiar() {
    const usuariosPrueba = await prisma.usuario.findMany({
      where: { correo: { in: Object.values(correos) } },
      select: { id: true },
    });
    const idsUsuario = usuariosPrueba.map((u) => u.id);
    const sedes = await prisma.barberia.findMany({
      where: { responsableId: { in: idsUsuario } },
      select: { id: true },
    });
    const idsSede = sedes.map((s) => s.id);

    await prisma.excepcionHorarioBarbero.deleteMany({ where: { barberiaId: { in: idsSede } } });
    await prisma.excepcionHorario.deleteMany({ where: { barberiaId: { in: idsSede } } });
    await prisma.usuarioRol.deleteMany({ where: { usuarioId: { in: idsUsuario } } });
    await prisma.barberia.deleteMany({ where: { id: { in: idsSede } } });
    await prisma.usuario.deleteMany({ where: { id: { in: idsUsuario } } });
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
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
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    app.useGlobalGuards(new JwtAuthGuard(moduleFixture.get('Reflector')));

    await app.init();

    prisma = app.get<PrismaService>(PrismaService);
    jwtService = app.get(JwtService);

    await limpiar();

    const roles: Record<string, { id: string }> = {};
    for (const [nombre, ambito] of [
      ['ADMIN_BARBERIA', 'BARBERIA'],
      ['BARBERO', 'BARBERIA'],
      ['CLIENTE', 'GLOBAL'],
    ] as [string, string][]) {
      roles[nombre] = await prisma.rol.upsert({
        where: { nombre },
        update: { ambito },
        create: { nombre, ambito },
        select: { id: true },
      });
    }

    usuarios.admin = await crearUsuario(correos.ADMIN_BARBERIA, null, null);
    barberiaId = (
      await prisma.barberia.create({
        data: {
          nombre: 'Barbería F4-02',
          telefono: '7200000001',
          ubicacion: 'Sede de la fase 4',
          estado: 'ACTIVO',
          codigoAcceso: 'TESTF402',
          enlaceUnico: 'f402-excepciones',
          responsableId: usuarios.admin,
        },
        select: { id: true },
      })
    ).id;
    await prisma.usuarioRol.create({
      data: { usuarioId: usuarios.admin, rolId: roles['ADMIN_BARBERIA'].id, barberiaId },
    });

    usuarios.barbero = await crearUsuario(correos.BARBERO, roles['BARBERO'].id, barberiaId);
    usuarios.companero = await crearUsuario(correos.COMPANERO, roles['BARBERO'].id, barberiaId);
    usuarios.cliente = await crearUsuario(correos.CLIENTE, roles['CLIENTE'].id, null);

    // Tres excepciones del mismo mes: una de la sede, una del barbero del test
    // y otra de un compañero. La lectura del barbero no debe mezclar la última.
    await prisma.excepcionHorario.create({
      data: { barberiaId, fecha: sede, tipo: 'CERRADA', motivo: 'Inventario' },
    });
    await prisma.excepcionHorarioBarbero.createMany({
      data: [
        { barberiaId, barberoId: usuarios.barbero, fecha: propia, tipo: 'CERRADA', motivo: 'Médico' },
        { barberiaId, barberoId: usuarios.companero, fecha: ajena, tipo: 'CERRADA', motivo: 'Vacaciones' },
      ],
    });

    for (const [rol, correo] of [
      ['ADMIN_BARBERIA', correos.ADMIN_BARBERIA],
      ['BARBERO', correos.BARBERO],
      ['COMPANERO', correos.COMPANERO],
      ['CLIENTE', correos.CLIENTE],
    ] as [keyof typeof correos, string][]) {
      const usuario = await prisma.usuario.findUniqueOrThrow({ where: { correo } });
      tokens[rol] = await jwtService.signAsync({
        sub: usuario.id,
        correo: usuario.correo,
        roles: rol === 'COMPANERO' ? ['BARBERO'] : [rol],
      });
    }
  }, 120_000);

  afterAll(async () => {
    await limpiar();
    await app.close();
  }, 120_000);

  function leer(autor: keyof typeof correos) {
    return request(app.getHttpServer())
      .get(`/shops/${barberiaId}/hours/exceptions?from=2099-04-01&to=2099-04-30`)
      .set('Authorization', `Bearer ${tokens[autor]}`);
  }

  /** Las fechas vuelven como ISO completo; el día es lo que importa. */
  function dias(cuerpo: { fecha: string }[]): string[] {
    return cuerpo.map((e) => e.fecha.slice(0, 10)).sort();
  }

  it('el barbero lee las de la sede y las suyas, nunca las de un compañero', async () => {
    const res = await leer('BARBERO').expect(200);

    expect(dias(res.body)).toEqual(['2099-04-01', '2099-04-02']);
  });

  it('el ADMIN_BARBERIA sigue leyendo las de la sede', async () => {
    const res = await leer('ADMIN_BARBERIA').expect(200);

    expect(dias(res.body)).toEqual(['2099-04-01']);
  });

  it('el CLIENTE no lee excepciones', async () => {
    await leer('CLIENTE').expect(403);
  });
});
