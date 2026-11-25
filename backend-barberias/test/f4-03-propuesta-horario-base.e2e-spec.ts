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
 * F4-03 · la plantilla base del barbero se PROPONE, no se impone.
 *
 * La decisión 9 del dueño (22 nov 2026) convierte `PUT …/mi-horario/base` en una
 * propuesta `PENDIENTE` que el ADMIN_BARBERIA resuelve. Hasta hoy el `PUT`
 * escribía directamente `horarios_base_barbero`, así que no había nada que
 * aprobar y `horario.base.aprobar` no tenía sobre qué actuar.
 *
 * Lo que se fija aquí:
 *  1. el `PUT` NO toca la plantilla vigente y deja UNA propuesta `PENDIENTE`;
 *  2. un segundo `PUT` reemplaza esa propuesta pendiente (sigue habiendo una);
 *  3. el `GET` devuelve la vigente y la propuesta por separado, y la propuesta
 *     guarda la semana COMPLETA (los días no enviados conservan lo vigente),
 *     porque aprobar es aplicar la propuesta entera;
 *  4. la propuesta es del barbero del token: un compañero no la ve.
 *
 * Solo corre contra el Postgres local de `docker-compose` (`.env.test`).
 */
describe('F4-03 · propuesta de plantilla base', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;

  const correos = {
    ADMIN_BARBERIA: 'f403_admin@f403.test',
    BARBERO: 'f403_barbero@f403.test',
    COMPANERO: 'f403_companero@f403.test',
  };

  let barberiaId = '';
  const usuarios = { admin: '', barbero: '', companero: '' };
  const tokens: Record<keyof typeof correos, string> = {
    ADMIN_BARBERIA: '',
    BARBERO: '',
    COMPANERO: '',
  };

  let secuenciaTelefono = 0;

  async function crearUsuario(correo: string, rolId: string | null, barberia: string | null) {
    secuenciaTelefono += 1;
    const usuario = await prisma.usuario.create({
      data: {
        telefonoVerificado: true,
        nombreCompleto: `F403 ${correo}`,
        correo,
        telefono: `7${String(secuenciaTelefono).padStart(9, '0')}`,
        passwordHash: '$2b$10$HashFalsoF403NoSeUsaParaLogin',
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

    await prisma.propuestaHorarioBase.deleteMany({ where: { barberoId: { in: idsUsuario } } });
    await prisma.horarioBaseBarbero.deleteMany({ where: { barberoId: { in: idsUsuario } } });
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
          nombre: 'Barbería F4-03',
          telefono: '7200000002',
          ubicacion: 'Sede de la fase 4',
          estado: 'ACTIVO',
          codigoAcceso: 'TESTF403',
          enlaceUnico: 'f403-propuesta-base',
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

    // Plantilla VIGENTE: la que hoy lee el motor. La propuesta no debe tocarla.
    await prisma.horarioBaseBarbero.create({
      data: { barberoId: usuarios.barbero, diaSemana: 1, horaInicio: '09:00', horaFin: '17:00' },
    });

    for (const [rol, correo] of [
      ['ADMIN_BARBERIA', correos.ADMIN_BARBERIA],
      ['BARBERO', correos.BARBERO],
      ['COMPANERO', correos.COMPANERO],
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

  function proponer(autor: keyof typeof correos, dias: unknown[]) {
    return request(app.getHttpServer())
      .put(`/shops/${barberiaId}/mi-horario/base`)
      .set('Authorization', `Bearer ${tokens[autor]}`)
      .send({ dias });
  }

  function leer(autor: keyof typeof correos) {
    return request(app.getHttpServer())
      .get(`/shops/${barberiaId}/mi-horario/base`)
      .set('Authorization', `Bearer ${tokens[autor]}`);
  }

  const lunesAMartes = [
    { diaSemana: 1, activo: true, horaInicio: '10:00', horaFin: '18:00' },
    { diaSemana: 2, activo: true, horaInicio: '10:00', horaFin: '18:00' },
  ];

  it('el PUT deja una propuesta PENDIENTE y NO escribe la plantilla vigente', async () => {
    await proponer('BARBERO', lunesAMartes).expect(200);

    const vigente = await prisma.horarioBaseBarbero.findMany({
      where: { barberoId: usuarios.barbero },
      orderBy: { diaSemana: 'asc' },
    });
    expect(vigente).toHaveLength(1);
    expect(vigente[0]).toMatchObject({ diaSemana: 1, horaInicio: '09:00', horaFin: '17:00' });

    const pendientes = await prisma.propuestaHorarioBase.findMany({
      where: { barberoId: usuarios.barbero, barberiaId },
    });
    expect(pendientes).toHaveLength(1);
    expect(pendientes[0].estado).toBe('PENDIENTE');
    // La propuesta guarda la SEMANA COMPLETA: aprobar la aplica entera.
    expect(pendientes[0].dias).toHaveLength(7);
  });

  it('un segundo envío reemplaza la propuesta pendiente, no la duplica', async () => {
    await proponer('BARBERO', [
      { diaSemana: 3, activo: true, horaInicio: '12:00', horaFin: '20:00' },
    ]).expect(200);

    const pendientes = await prisma.propuestaHorarioBase.findMany({
      where: { barberoId: usuarios.barbero, barberiaId, estado: 'PENDIENTE' },
    });
    expect(pendientes).toHaveLength(1);

    const dias = pendientes[0].dias as { diaSemana: number; horaInicio: string | null }[];
    expect(dias).toHaveLength(7);
    // La propuesta se arma sobre la VIGENTE, no sobre la pendiente anterior: cada
    // envío es «lo aprobado + lo que pido ahora». El día 3 llega nuevo, el 1
    // conserva lo aprobado y el 2 —que no viaja en este envío— vuelve a la
    // vigente en vez de arrastrar la petición que ya no se está pidiendo.
    expect(dias.find((d) => d.diaSemana === 3)?.horaInicio).toBe('12:00');
    expect(dias.find((d) => d.diaSemana === 1)?.horaInicio).toBe('09:00');
    expect(dias.find((d) => d.diaSemana === 2)?.horaInicio).toBeNull();
  });

  it('el GET devuelve la vigente y la propuesta pendiente por separado', async () => {
    const res = await leer('BARBERO').expect(200);

    expect(res.body.sinPlantilla).toBe(false);
    expect(res.body.dias.find((d: { diaSemana: number }) => d.diaSemana === 1)).toMatchObject({
      horaInicio: '09:00',
      horaFin: '17:00',
      activo: true,
    });

    expect(res.body.propuestaPendiente).toBeTruthy();
    expect(res.body.propuestaPendiente.estado).toBe('PENDIENTE');
    expect(res.body.propuestaPendiente.dias).toHaveLength(7);
  });

  it('la propuesta es del barbero del token: un compañero no la ve', async () => {
    const res = await leer('COMPANERO').expect(200);

    expect(res.body.propuestaPendiente).toBeNull();
    expect(res.body.sinPlantilla).toBe(true);
  });

  it('sin propuesta pendiente, el GET devuelve propuestaPendiente en null', async () => {
    await prisma.propuestaHorarioBase.updateMany({
      where: { barberoId: usuarios.barbero, barberiaId },
      data: { estado: 'APROBADA', resueltaAt: new Date() },
    });

    const res = await leer('BARBERO').expect(200);

    expect(res.body.propuestaPendiente).toBeNull();
  });
});
