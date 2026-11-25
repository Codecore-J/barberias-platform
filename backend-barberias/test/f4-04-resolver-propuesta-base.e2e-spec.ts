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
 * F4-04 · el ADMIN_BARBERIA resuelve la propuesta de horario base.
 *
 * `PATCH /shops/:shopId/hours/barbers/:barberoId/base` es la única ruta nueva
 * de la fase 4 (§8 de `docs/MATRIZ_RUTAS_ACCIONES.md`): una sola ruta resuelve
 * aprobar y rechazar, porque la matriz tiene UNA acción para la decisión
 * (`horario.base.aprobar`).
 *
 * Lo que se fija aquí:
 *  1. aprobar APLICA la propuesta a la plantilla vigente y la deja `APROBADA`;
 *  2. rechazar sin motivo responde 422 `MOTIVO_RECHAZO_REQUERIDO` y no toca nada;
 *  3. rechazar con motivo deja `RECHAZADA` y la plantilla vigente intacta;
 *  4. el BARBERO no resuelve su propia propuesta, y sin propuesta pendiente la
 *     ruta responde 404 en vez de inventar una decisión.
 *
 * Solo corre contra el Postgres local de `docker-compose` (`.env.test`).
 */
describe('F4-04 · resolución de la propuesta de horario base', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;

  const correos = {
    ADMIN_BARBERIA: 'f404_admin@f404.test',
    BARBERO: 'f404_barbero@f404.test',
  };

  let barberiaId = '';
  const usuarios = { admin: '', barbero: '' };
  const tokens: Record<keyof typeof correos, string> = { ADMIN_BARBERIA: '', BARBERO: '' };

  let secuenciaTelefono = 0;

  async function crearUsuario(correo: string, rolId: string | null, barberia: string | null) {
    secuenciaTelefono += 1;
    const usuario = await prisma.usuario.create({
      data: {
        telefonoVerificado: true,
        nombreCompleto: `F404 ${correo}`,
        correo,
        telefono: `6${String(secuenciaTelefono).padStart(9, '0')}`,
        passwordHash: '$2b$10$HashFalsoF404NoSeUsaParaLogin',
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
          nombre: 'Barbería F4-04',
          telefono: '7200000003',
          ubicacion: 'Sede de la fase 4',
          estado: 'ACTIVO',
          codigoAcceso: 'TESTF404',
          enlaceUnico: 'f404-resolver-base',
          responsableId: usuarios.admin,
        },
        select: { id: true },
      })
    ).id;
    await prisma.usuarioRol.create({
      data: { usuarioId: usuarios.admin, rolId: roles['ADMIN_BARBERIA'].id, barberiaId },
    });

    usuarios.barbero = await crearUsuario(correos.BARBERO, roles['BARBERO'].id, barberiaId);

    for (const [rol, correo] of [
      ['ADMIN_BARBERIA', correos.ADMIN_BARBERIA],
      ['BARBERO', correos.BARBERO],
    ] as [keyof typeof correos, string][]) {
      const usuario = await prisma.usuario.findUniqueOrThrow({ where: { correo } });
      tokens[rol] = await jwtService.signAsync({
        sub: usuario.id,
        correo: usuario.correo,
        roles: [rol],
      });
    }
  }, 120_000);

  afterAll(async () => {
    await limpiar();
    await app.close();
  }, 120_000);

  /**
   * Deja la plantilla vigente en lunes 09:00–17:00 y miércoles 09:00–13:00, sin
   * propuesta pendiente. El miércoles existe para comprobar que aprobar un día
   * libre APAGA el bloque vigente en vez de borrarlo.
   */
  async function reiniciarEstado() {
    await prisma.propuestaHorarioBase.deleteMany({ where: { barberoId: usuarios.barbero } });
    await prisma.horarioBaseBarbero.deleteMany({ where: { barberoId: usuarios.barbero } });
    await prisma.horarioBaseBarbero.createMany({
      data: [
        { barberoId: usuarios.barbero, diaSemana: 1, horaInicio: '09:00', horaFin: '17:00' },
        { barberoId: usuarios.barbero, diaSemana: 3, horaInicio: '09:00', horaFin: '13:00' },
      ],
    });
  }

  /** El barbero propone lunes, martes y miércoles libre. */
  function proponer() {
    return request(app.getHttpServer())
      .put(`/shops/${barberiaId}/mi-horario/base`)
      .set('Authorization', `Bearer ${tokens.BARBERO}`)
      .send({
        dias: [
          { diaSemana: 1, activo: true, horaInicio: '10:00', horaFin: '18:00' },
          { diaSemana: 2, activo: true, horaInicio: '11:00', horaFin: '19:00' },
          { diaSemana: 3, activo: false },
        ],
      });
  }

  /** El rechazo no aplica nada: los dos bloques vigentes siguen como estaban. */
  async function expectVigenteIntacta() {
    const vigente = await prisma.horarioBaseBarbero.findMany({
      where: { barberoId: usuarios.barbero },
      orderBy: { diaSemana: 'asc' },
    });
    expect(vigente).toHaveLength(2);
    expect(vigente[0]).toMatchObject({ diaSemana: 1, horaInicio: '09:00', horaFin: '17:00', activo: true });
    expect(vigente[1]).toMatchObject({ diaSemana: 3, horaInicio: '09:00', horaFin: '13:00', activo: true });
  }

  function resolver(autor: keyof typeof correos, cuerpo: Record<string, unknown>) {
    return request(app.getHttpServer())
      .patch(`/shops/${barberiaId}/hours/barbers/${usuarios.barbero}/base`)
      .set('Authorization', `Bearer ${tokens[autor]}`)
      .send(cuerpo);
  }

  it('aprobar aplica la propuesta a la plantilla vigente y la marca APROBADA', async () => {
    await reiniciarEstado();
    await proponer().expect(200);

    const res = await resolver('ADMIN_BARBERIA', { aprobar: true }).expect(200);
    expect(res.body.estado).toBe('APROBADA');

    const vigente = await prisma.horarioBaseBarbero.findMany({
      where: { barberoId: usuarios.barbero },
      orderBy: { diaSemana: 'asc' },
    });

    expect(vigente).toHaveLength(3);
    expect(vigente[0]).toMatchObject({ diaSemana: 1, horaInicio: '10:00', horaFin: '18:00', activo: true });
    expect(vigente[1]).toMatchObject({ diaSemana: 2, horaInicio: '11:00', horaFin: '19:00', activo: true });
    // Un día apagado sin horas no pierde el bloque: se apaga con `activo: false`
    // y conserva las horas que tenía.
    expect(vigente[2]).toMatchObject({
      diaSemana: 3,
      horaInicio: '09:00',
      horaFin: '13:00',
      activo: false,
    });

    const propuesta = await prisma.propuestaHorarioBase.findFirstOrThrow({
      where: { barberoId: usuarios.barbero, barberiaId },
    });
    expect(propuesta.estado).toBe('APROBADA');
    expect(propuesta.resueltoPor).toBe(usuarios.admin);
    expect(propuesta.resueltaAt).toBeTruthy();

    // Ya no queda nada pendiente: la pantalla del barbero deja de avisar.
    const lectura = await request(app.getHttpServer())
      .get(`/shops/${barberiaId}/mi-horario/base`)
      .set('Authorization', `Bearer ${tokens.BARBERO}`)
      .expect(200);
    expect(lectura.body.propuestaPendiente).toBeNull();
  });

  it('rechazar sin motivo responde 422 MOTIVO_RECHAZO_REQUERIDO y no toca nada', async () => {
    await reiniciarEstado();
    await proponer().expect(200);

    const res = await resolver('ADMIN_BARBERIA', { aprobar: false }).expect(422);
    expect(res.body.codigo).toBe('MOTIVO_RECHAZO_REQUERIDO');

    const propuesta = await prisma.propuestaHorarioBase.findFirstOrThrow({
      where: { barberoId: usuarios.barbero, barberiaId },
    });
    expect(propuesta.estado).toBe('PENDIENTE');

    await expectVigenteIntacta();
  });

  it('rechazar con motivo deja RECHAZADA y la plantilla vigente intacta', async () => {
    await reiniciarEstado();
    await proponer().expect(200);

    const res = await resolver('ADMIN_BARBERIA', {
      aprobar: false,
      motivoRechazo: 'La sede abre a las 10:00: ajusta el martes.',
    }).expect(200);
    expect(res.body).toMatchObject({
      estado: 'RECHAZADA',
      motivoRechazo: 'La sede abre a las 10:00: ajusta el martes.',
    });

    await expectVigenteIntacta();
  });

  it('el BARBERO no resuelve su propia propuesta', async () => {
    await reiniciarEstado();
    await proponer().expect(200);

    await resolver('BARBERO', { aprobar: true }).expect(403);
  });

  it('sin propuesta pendiente responde 404 y no inventa una decisión', async () => {
    await reiniciarEstado();

    await resolver('ADMIN_BARBERIA', { aprobar: true }).expect(404);
  });
});
