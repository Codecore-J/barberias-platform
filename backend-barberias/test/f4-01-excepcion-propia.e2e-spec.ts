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
 * F4-01 · el barbero registra SU excepción de horario.
 *
 * La matriz objetivo da `excepciones.propias.registrar` al BARBERO y al
 * ADMIN_BARBERIA. El servicio ya sabe decidir el origen del cambio
 * (`resolverOrigenDeModificacion`: el propio barbero → `BARBERO`, un operador de
 * la sede → `ADMIN_SEDE`) y ya rechaza que un barbero toque la agenda de un
 * compañero. Lo que faltaba era la PUERTA: el decorador de la ruta solo
 * declaraba al ADMIN_BARBERIA, así que el barbero recibía 403 del guard antes de
 * llegar a la regla de negocio.
 *
 * Estos cuatro casos fijan las dos mitades de la tarea:
 *  1. el barbero registra la suya (hoy 403),
 *  2. el barbero NO registra la de un compañero (403 del servicio, no del guard),
 *  3. el ADMIN_BARBERIA sigue pudiendo registrar la de un barbero de su sede,
 *  4. el CLIENTE sigue fuera.
 *
 * Solo corre contra el Postgres local de `docker-compose` (`.env.test`).
 */
describe('F4-01 · excepción propia del barbero', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;

  const correos = {
    ADMIN_BARBERIA: 'f401_admin@f401.test',
    BARBERO: 'f401_barbero@f401.test',
    COMPANERO: 'f401_companero@f401.test',
    CLIENTE: 'f401_cliente@f401.test',
  };

  let barberiaId = '';
  const usuarios = {
    admin: '',
    barbero: '',
    companero: '',
    cliente: '',
  };
  const tokens: Record<keyof typeof correos, string> = {
    ADMIN_BARBERIA: '',
    BARBERO: '',
    COMPANERO: '',
    CLIENTE: '',
  };

  let secuenciaTelefono = 0;

  async function crearUsuario(correo: string, rolId: string | null, barberia: string | null) {
    secuenciaTelefono += 1;
    const usuario = await prisma.usuario.create({
      data: {
        telefonoVerificado: true,
        nombreCompleto: `F401 ${correo}`,
        correo,
        telefono: `7${String(secuenciaTelefono).padStart(9, '0')}`,
        passwordHash: '$2b$10$HashFalsoF401NoSeUsaParaLogin',
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

    // El ADMIN_BARBERIA se crea sin vínculo: la sede aún no existe y el trigger
    // de F1 rechaza un rol de sede con `barberia_id` nulo.
    usuarios.admin = await crearUsuario(correos.ADMIN_BARBERIA, null, null);
    barberiaId = (
      await prisma.barberia.create({
        data: {
          nombre: 'Barbería F4-01',
          telefono: '7100000001',
          ubicacion: 'Sede de la fase 4',
          estado: 'ACTIVO',
          codigoAcceso: 'TESTF401',
          enlaceUnico: 'f401-excepciones',
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

    expect(barberiaId).toBeTruthy();
  }, 120_000);

  afterAll(async () => {
    await limpiar();
    await app.close();
  }, 120_000);

  function excepcion(autor: keyof typeof correos, barberoId: string) {
    return request(app.getHttpServer())
      .post(`/shops/${barberiaId}/hours/barbers/${barberoId}/exceptions`)
      .set('Authorization', `Bearer ${tokens[autor]}`);
  }

  it('el barbero registra SU excepción: 201 y origen BARBERO', async () => {
    const res = await excepcion('BARBERO', usuarios.barbero)
      .send({ fecha: '2099-03-10', tipo: 'CERRADA', motivo: 'Cita médica' })
      .expect(201);

    expect(res.body.tipo).toBe('CERRADA');
    expect(res.body.barberoId).toBe(usuarios.barbero);
    expect(res.body.modificadoPor).toBe('BARBERO');

    const fila = await prisma.excepcionHorarioBarbero.findFirst({
      where: { barberiaId, barberoId: usuarios.barbero },
    });
    expect(fila?.modificadoPorId).toBe(usuarios.barbero);
  });

  it('el barbero NO registra la excepción de un compañero', async () => {
    const res = await excepcion('BARBERO', usuarios.companero)
      .send({ fecha: '2099-03-11', tipo: 'CERRADA' })
      .expect(403);

    expect(res.body.message).toContain('tu propia agenda');

    const fila = await prisma.excepcionHorarioBarbero.findFirst({
      where: { barberiaId, barberoId: usuarios.companero },
    });
    expect(fila).toBeNull();
  });

  it('el ADMIN_BARBERIA sigue registrando la de un barbero de su sede', async () => {
    const res = await excepcion('ADMIN_BARBERIA', usuarios.companero)
      .send({ fecha: '2099-03-12', tipo: 'HORARIO_ESPECIAL', horaInicio: '09:00', horaFin: '13:00' })
      .expect(201);

    expect(res.body.modificadoPor).toBe('ADMIN_SEDE');
    expect(res.body.horaInicio).toBeTruthy();
  });

  it('el CLIENTE no registra excepciones de nadie', async () => {
    await excepcion('CLIENTE', usuarios.barbero)
      .send({ fecha: '2099-03-13', tipo: 'CERRADA' })
      .expect(403);
  });
});
