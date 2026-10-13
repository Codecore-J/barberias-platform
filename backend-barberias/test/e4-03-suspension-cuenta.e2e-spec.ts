import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/shared/prisma/prisma.service.js';

/**
 * E4-03/5 · D09/D24 · suspensión y reactivación MANUAL de una cuenta.
 *
 * Recorre el ciclo completo contra la API real:
 *   el ADMINISTRADOR suspende con motivo → el token que ya existía muere →
 *   el login explica por qué → se reactiva → **el token viejo sigue muerto**
 *   (`token_version`) → un login nuevo vuelve a funcionar.
 *
 * Además: el motivo es obligatorio, la sede no puede suspender (D48), el rol
 * equivocado recibe 403 y todo queda auditado con el valor anterior y el nuevo.
 *
 * Solo con APP_ENV=dev (igual que el resto de la suite E2E).
 */

describe('E4-03/5 · suspensión manual de cuenta (D09/D24)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const api = '/api/v1';
  const sufijo = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const correos = {
    global: `global.e403s-${sufijo}@test.com`,
    adminSede: `admin.sede.e403s-${sufijo}@test.com`,
    cliente: `cliente.e403s-${sufijo}@test.com`,
  };

  const tokens: Record<string, string> = {};
  const usuarios: Record<string, string> = {};

  const telefono = (n: number) =>
    `701${sufijo.slice(-4).padEnd(4, '0')}${String(n).padStart(2, '0')}`;

  const password = 'Password1!';

  const registrar = async (correo: string, n: number) => {
    const res = await request(app.getHttpServer())
      .post(`${api}/auth/register`)
      .send({ nombreCompleto: correo, correo, telefono: telefono(n), password });
    expect([200, 201, 409]).toContain(res.status);
  };

  const login = async (correo: string): Promise<number> => {
    const res = await request(app.getHttpServer())
      .post(`${api}/auth/login`)
      .send({ correo, password });

    if (res.status === 200) tokens[correo] = res.body.accessToken;
    return res.status;
  };

  const headers = (correo: string) => ({ Authorization: `Bearer ${tokens[correo]}` });

  const cambiarEstado = (usuarioId: string, cuerpo: Record<string, unknown>) =>
    request(app.getHttpServer())
      .patch(`${api}/plataforma/usuarios/${usuarioId}/estado`)
      .set(headers(correos.global))
      .send(cuerpo);

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
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    prisma = app.get(PrismaService);

    await registrar(correos.global, 1);
    await registrar(correos.adminSede, 2);
    await registrar(correos.cliente, 3);

    for (const correo of Object.values(correos)) {
      const usuario = await prisma.usuario.findUniqueOrThrow({
        where: { correo },
        select: { id: true },
      });
      usuarios[correo] = usuario.id;
    }

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

    // Una sede real para que el ADMIN_BARBERIA tenga ámbito donde mandar.
    const barberia = await prisma.barberia.upsert({
      where: { codigoAcceso: `E403S-${sufijo}`.slice(0, 20) },
      update: { responsableId: usuarios[correos.adminSede], estado: 'ACTIVO' },
      create: {
        nombre: `Sede E403S-${sufijo}`,
        telefono: telefono(11),
        ubicacion: 'Zona S',
        estado: 'ACTIVO',
        codigoAcceso: `E403S-${sufijo}`.slice(0, 20),
        enlaceUnico: `https://e403s-${sufijo}.test`,
        responsableId: usuarios[correos.adminSede],
      },
    });

    await prisma.usuarioRol.createMany({
      data: [
        { usuarioId: usuarios[correos.global], rolId: rolAdministrador.id, barberiaId: null },
        { usuarioId: usuarios[correos.adminSede], rolId: rolAdminBarberia.id, barberiaId: barberia.id },
        { usuarioId: usuarios[correos.cliente], rolId: rolCliente.id, barberiaId: null },
      ],
      skipDuplicates: true,
    });

    for (const correo of Object.values(correos)) {
      expect(await login(correo)).toBe(200);
    }
  }, 180_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('VERDE: el ciclo completo — suspender cierra las sesiones y reactivar no las reabre', async () => {
    const clienteId = usuarios[correos.cliente];
    const tokenOriginal = tokens[correos.cliente];

    // 0. Con la cuenta ACTIVA el token funciona.
    await request(app.getHttpServer())
      .get(`${api}/auth/me`)
      .set({ Authorization: `Bearer ${tokenOriginal}` })
      .expect(200);

    // 1. El ADMINISTRADOR de la plataforma suspende, con motivo.
    const suspension = await cambiarEstado(clienteId, {
      estadoCuenta: 'SUSPENDIDO',
      motivo: 'Suplantación de identidad en tres reservas',
    });

    expect(suspension.status).toBe(200);
    expect(suspension.body).toMatchObject({
      id: clienteId,
      estadoCuenta: 'SUSPENDIDO',
      tokenVersion: 1,
      sesionesCerradas: true,
    });

    // 2. El token que ya existía deja de valer (sesión cerrada en todos los
    //    dispositivos, D24).
    const conTokenViejo = await request(app.getHttpServer())
      .get(`${api}/auth/me`)
      .set({ Authorization: `Bearer ${tokenOriginal}` });
    expect(conTokenViejo.status).toBe(401);

    // 3. El login conserva el mensaje descriptivo (HALLAZGO 12) y NO entrega token.
    const loginSuspendido = await request(app.getHttpServer())
      .post(`${api}/auth/login`)
      .send({ correo: correos.cliente, password });
    expect(loginSuspendido.status).toBe(401);
    expect(loginSuspendido.body.message).toBe(
      'Su cuenta se encuentra suspendida. Contacte al administrador.',
    );
    expect(loginSuspendido.body.accessToken).toBeUndefined();

    // 4. La suspensión quedó auditada con anterior, nuevo y motivo (D28).
    const auditoria = await prisma.auditoria.findFirst({
      where: { accion: 'CUENTA_SUSPENDIDA', entidad: 'usuarios', entidadId: clienteId },
      orderBy: { creadoAt: 'desc' },
    });

    expect(auditoria).not.toBeNull();
    expect(auditoria?.usuarioId).toBe(usuarios[correos.global]);
    expect(auditoria?.contexto).toMatchObject({
      motivo: 'Suplantación de identidad en tres reservas',
      anterior: { estadoCuenta: 'ACTIVO', tokenVersion: 0 },
      nuevo: { estadoCuenta: 'SUSPENDIDO', tokenVersion: 1 },
    });

    // 5. Reactivar devuelve la cuenta a ACTIVO sin tocar la versión.
    const reactivacion = await cambiarEstado(clienteId, {
      estadoCuenta: 'ACTIVO',
      motivo: 'Se verificó el caso: fue un error del mostrador',
    });

    expect(reactivacion.status).toBe(200);
    expect(reactivacion.body).toMatchObject({
      estadoCuenta: 'ACTIVO',
      tokenVersion: 1,
      sesionesCerradas: false,
    });

    // 6. El token anterior SIGUE inválido: reactivar no reabre las sesiones.
    const conTokenViejoTrasReactivar = await request(app.getHttpServer())
      .get(`${api}/auth/me`)
      .set({ Authorization: `Bearer ${tokenOriginal}` });
    expect(conTokenViejoTrasReactivar.status).toBe(401);

    // 7. Y un login nuevo entra sin problema.
    expect(await login(correos.cliente)).toBe(200);
    await request(app.getHttpServer())
      .get(`${api}/auth/me`)
      .set(headers(correos.cliente))
      .expect(200);

    const cuenta = await prisma.usuario.findUniqueOrThrow({
      where: { id: clienteId },
      select: { estadoCuenta: true, tokenVersion: true },
    });
    expect(cuenta).toEqual({ estadoCuenta: 'ACTIVO', tokenVersion: 1 });
  }, 120_000);

  it('ROJO: sin motivo → 422 MOTIVO_REQUERIDO y la cuenta no cambia', async () => {
    const clienteId = usuarios[correos.cliente];

    const res = await cambiarEstado(clienteId, { estadoCuenta: 'SUSPENDIDO' });

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ statusCode: 422, codigo: 'MOTIVO_REQUERIDO' });

    const cuenta = await prisma.usuario.findUniqueOrThrow({
      where: { id: clienteId },
      select: { estadoCuenta: true },
    });
    expect(cuenta.estadoCuenta).toBe('ACTIVO');
  }, 60_000);

  it('ROJO: repetir el estado vigente → 409 ESTADO_INVALIDO', async () => {
    const res = await cambiarEstado(usuarios[correos.cliente], {
      estadoCuenta: 'ACTIVO',
      motivo: 'Intento de reactivar lo que ya está activo',
    });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ statusCode: 409, codigo: 'ESTADO_INVALIDO' });
  }, 60_000);

  it('ROJO: un estado fuera del catálogo → 400 de validación', async () => {
    const res = await cambiarEstado(usuarios[correos.cliente], {
      estadoCuenta: 'ELIMINADO',
      motivo: 'Baja definitiva pedida por la vía equivocada',
    });

    expect(res.status).toBe(400);
  }, 60_000);

  it('ROJO: usuario inexistente → 404', async () => {
    const res = await cambiarEstado('11111111-1111-4111-8111-111111111111', {
      estadoCuenta: 'SUSPENDIDO',
      motivo: 'Cuenta que no existe',
    });

    expect(res.status).toBe(404);
  }, 60_000);

  it('ROJO: la SEDE no suspende cuentas (D48) y el CLIENTE tampoco', async () => {
    const objetivo = usuarios[correos.cliente];

    const comoAdminSede = await request(app.getHttpServer())
      .patch(`${api}/plataforma/usuarios/${objetivo}/estado`)
      .set(headers(correos.adminSede))
      .send({ estadoCuenta: 'SUSPENDIDO', motivo: 'La sede no manda en la cuenta global' });
    expect(comoAdminSede.status).toBe(403);

    const comoCliente = await request(app.getHttpServer())
      .patch(`${api}/plataforma/usuarios/${usuarios[correos.adminSede]}/estado`)
      .set(headers(correos.cliente))
      .send({ estadoCuenta: 'SUSPENDIDO', motivo: 'Un cliente no suspende a nadie' });
    expect(comoCliente.status).toBe(403);

    const cuenta = await prisma.usuario.findUniqueOrThrow({
      where: { id: objetivo },
      select: { estadoCuenta: true, tokenVersion: true },
    });
    expect(cuenta).toEqual({ estadoCuenta: 'ACTIVO', tokenVersion: 1 });
  }, 60_000);
});
