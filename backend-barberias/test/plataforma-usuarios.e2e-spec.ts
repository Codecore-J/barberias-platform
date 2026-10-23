import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/shared/prisma/prisma.service.js';

/**
 * Bandeja de usuarios de la PLATAFORMA · flujo completo contra la API real.
 *
 * Recorre, en orden, lo que la pantalla `/admin/usuarios` hace de punta a punta:
 *
 *   alta de un ADMIN_BARBERIA → el listado lo devuelve con el contrato del
 *   `UsuarioListResponseDto` → suspenderlo SIN motivo es 422 → con motivo es
 *   200 (y cierra la sesión) → el historial trae, de lo más reciente a lo más
 *   antiguo, la suspensión con su motivo y el alta.
 *
 * Solo con `APP_ENV=dev` (igual que el resto de la suite E2E), contra los
 * contenedores locales de `docker-compose.yml`. Cada corrida usa un sufijo
 * único, así que no depende de que la base esté limpia; aun así, antes de
 * empezar borra los restos de corridas ANTERIORES de este mismo archivo (los
 * que llevan el dominio y el prefijo de sede de aquí abajo). No toca ninguna
 * otra fila de la base.
 */

const DOMINIO = 'plataforma-usuarios.e2e.test';
const PREFIJO_SEDE = 'E2E-PU-';

/**
 * Restos de corridas anteriores de ESTE archivo, en orden de FK:
 * auditoría (referencia usuario y sede) → usuario_roles → sedes → usuarios.
 *
 * Se acota por dominio de correo y por prefijo de `codigo_acceso`: una prueba
 * E2E no puede hacer `TRUNCATE` de la base de desarrollo.
 */
async function limpiarCorridasAnteriores(prisma: PrismaService): Promise<void> {
  const previos = await prisma.usuario.findMany({
    where: { correo: { endsWith: `@${DOMINIO}` } },
    select: { id: true },
  });

  const sedes = await prisma.barberia.findMany({
    where: { codigoAcceso: { startsWith: PREFIJO_SEDE } },
    select: { id: true },
  });

  if (previos.length === 0 && sedes.length === 0) return;

  const usuarioIds = previos.map((usuario) => usuario.id);
  const sedeIds = sedes.map((sede) => sede.id);

  await prisma.auditoria.deleteMany({
    where: {
      OR: [
        ...(usuarioIds.length > 0 ? [{ usuarioId: { in: usuarioIds } }] : []),
        ...(usuarioIds.length > 0 ? [{ entidadId: { in: usuarioIds } }] : []),
        ...(sedeIds.length > 0 ? [{ barberiaId: { in: sedeIds } }] : []),
      ],
    },
  });

  if (usuarioIds.length > 0) {
    await prisma.usuarioRol.deleteMany({ where: { usuarioId: { in: usuarioIds } } });
  }
  if (sedeIds.length > 0) {
    await prisma.usuarioRol.deleteMany({ where: { barberiaId: { in: sedeIds } } });
    await prisma.barberia.deleteMany({ where: { id: { in: sedeIds } } });
  }
  if (usuarioIds.length > 0) {
    await prisma.usuario.deleteMany({ where: { id: { in: usuarioIds } } });
  }
}

describe('Plataforma · usuarios (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const api = '/api/v1';
  const sufijo = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const digitos = String(Date.now()).slice(-7);

  const correos = {
    admin: `admin.pu-${sufijo}@${DOMINIO}`,
    nuevo: `nuevo.pu-${sufijo}@${DOMINIO}`,
  };

  const telefonoAdmin = `809${digitos}0`;
  const telefonoNuevo = `809${digitos}1`;
  const cedulaNueva = `9${digitos}${sufijo.length}`;
  const password = 'Password1!';

  let tokenAdmin = '';
  let adminId = '';
  let sedeId = '';
  let usuarioCreadoId = '';

  const auth = () => ({ Authorization: `Bearer ${tokenAdmin}` });

  const payloadCreacion = () => ({
    nombreCompleto: 'Sede E2E',
    correo: correos.nuevo,
    password,
    telefono: telefonoNuevo,
    cedula: cedulaNueva,
    rolNombre: 'ADMIN_BARBERIA',
    barberiaId: sedeId,
  });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      // El throttler global cortaría la ráfaga de peticiones de la suite.
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

    await limpiarCorridasAnteriores(prisma);

    // Los roles del catálogo van ANTES del registro: `/auth/register` exige
    // CLIENTE y el alta administrativa exige ADMIN_BARBERIA.
    const rolAdministrador = await prisma.rol.upsert({
      where: { nombre: 'ADMINISTRADOR' },
      update: {},
      create: { nombre: 'ADMINISTRADOR', ambito: 'GLOBAL' },
    });
    await prisma.rol.upsert({
      where: { nombre: 'ADMIN_BARBERIA' },
      update: {},
      create: { nombre: 'ADMIN_BARBERIA', ambito: 'BARBERIA' },
    });
    await prisma.rol.upsert({
      where: { nombre: 'CLIENTE' },
      update: {},
      create: { nombre: 'CLIENTE', ambito: 'GLOBAL' },
    });

    // El ADMINISTRADOR global nace por el registro público (CLIENTE) y se
    // asciende desde la base: no existe ruta para autoasignarse el rol global.
    const registro = await request(app.getHttpServer())
      .post(`${api}/auth/register`)
      .send({
        nombreCompleto: 'Admin Plataforma E2E',
        correo: correos.admin,
        telefono: telefonoAdmin,
        password,
      });
    expect([200, 201]).toContain(registro.status);

    const admin = await prisma.usuario.findUniqueOrThrow({
      where: { correo: correos.admin },
      select: { id: true },
    });
    adminId = admin.id;

    await prisma.usuarioRol.create({
      data: { usuarioId: adminId, rolId: rolAdministrador.id, barberiaId: null },
    });

    // Una sede real: el ADMIN_BARBERIA que crea la prueba necesita ámbito.
    const sede = await prisma.barberia.create({
      data: {
        nombre: `Sede PU-${sufijo}`,
        telefono: `809${digitos}2`,
        ubicacion: 'Plataforma usuarios E2E',
        estado: 'ACTIVO',
        codigoAcceso: `${PREFIJO_SEDE}${sufijo}`,
        enlaceUnico: `https://pu-${sufijo}.test`,
        responsableId: adminId,
      },
      select: { id: true },
    });
    sedeId = sede.id;

    // El token se firma DESPUÉS de asignar el rol: el del registro solo lleva
    // CLIENTE y el guard denegaría la bandeja.
    const login = await request(app.getHttpServer())
      .post(`${api}/auth/login`)
      .send({ correo: correos.admin, password });
    expect(login.status).toBe(200);
    tokenAdmin = login.body.accessToken;
    expect(tokenAdmin).toBeTruthy();
  }, 180_000);

  afterAll(async () => {
    // Si el `beforeAll` falló antes de arrancar (por ejemplo, sin base de
    // datos), no hay nada que cerrar: el fallo original es el que debe verse.
    if (app) await app.close();
    if (prisma) await prisma.$disconnect();
  });

  it('1 · POST crea un ADMIN_BARBERIA (201) y no expone datos sensibles', async () => {
    const res = await request(app.getHttpServer())
      .post(`${api}/plataforma/usuarios`)
      .set(auth())
      .send(payloadCreacion());

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      nombreCompleto: 'Sede E2E',
      correo: correos.nuevo,
      telefono: telefonoNuevo,
      estadoCuenta: 'ACTIVO',
      roles: ['ADMIN_BARBERIA'],
    });
    expect(res.body.id).toBeTruthy();
    expect(res.body.fechaRegistro).toBeTruthy();

    // El contrato es exactamente el del `UsuarioListResponseDto`: ni
    // `passwordHash` ni `cedula` (esta última ni se selecciona).
    expect(Object.keys(res.body).sort()).toEqual(
      ['correo', 'estadoCuenta', 'fechaRegistro', 'id', 'nombreCompleto', 'roles', 'telefono'].sort(),
    );
    expect(res.body).not.toHaveProperty('passwordHash');
    expect(res.body).not.toHaveProperty('cedula');

    usuarioCreadoId = res.body.id;

    // En la base: la cuenta nació ACTIVA y con el rol ligado a la sede.
    const fila = await prisma.usuarioRol.findFirst({
      where: {
        usuarioId: usuarioCreadoId,
        barberiaId: sedeId,
        rol: { nombre: 'ADMIN_BARBERIA' },
      },
      select: { id: true },
    });
    expect(fila).not.toBeNull();

    const cuenta = await prisma.usuario.findUniqueOrThrow({
      where: { id: usuarioCreadoId },
      select: { estadoCuenta: true, passwordHash: true },
    });
    expect(cuenta.estadoCuenta).toBe('ACTIVO');
    // La contraseña se guarda con bcrypt: nunca en claro.
    expect(cuenta.passwordHash).not.toBe(password);
    expect(cuenta.passwordHash.startsWith('$2')).toBe(true);
  }, 60_000);

  it('2 · repetir el alta con el mismo correo → 409 CORREO_YA_REGISTRADO', async () => {
    const res = await request(app.getHttpServer())
      .post(`${api}/plataforma/usuarios`)
      .set(auth())
      .send(payloadCreacion());

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ statusCode: 409, codigo: 'CORREO_YA_REGISTRADO' });

    // No se creó una segunda cuenta.
    const cuentas = await prisma.usuario.count({ where: { correo: correos.nuevo } });
    expect(cuentas).toBe(1);
  }, 60_000);

  it('3 · GET lista todas las cuentas y devuelve la creada con el DTO', async () => {
    const res = await request(app.getHttpServer())
      .get(`${api}/plataforma/usuarios`)
      .set(auth());

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);

    const creada = res.body.find(
      (usuario: { id: string }) => usuario.id === usuarioCreadoId,
    );

    expect(creada).toBeDefined();
    expect(creada).toMatchObject({
      id: usuarioCreadoId,
      nombreCompleto: 'Sede E2E',
      correo: correos.nuevo,
      telefono: telefonoNuevo,
      estadoCuenta: 'ACTIVO',
      roles: ['ADMIN_BARBERIA'],
      fechaRegistro: expect.any(String),
    });
    expect(creada).not.toHaveProperty('passwordHash');
    expect(creada).not.toHaveProperty('cedula');
  }, 60_000);

  it('4 · suspender SIN motivo → 422 MOTIVO_REQUERIDO y la cuenta no cambia', async () => {
    const res = await request(app.getHttpServer())
      .patch(`${api}/plataforma/usuarios/${usuarioCreadoId}/estado`)
      .set(auth())
      .send({ estadoCuenta: 'SUSPENDIDO' });

    // El `motivo` es opcional en el DTO a propósito: la regla responde 422 del
    // contrato D40, no el 400 del ValidationPipe.
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ statusCode: 422, codigo: 'MOTIVO_REQUERIDO' });

    const cuenta = await prisma.usuario.findUniqueOrThrow({
      where: { id: usuarioCreadoId },
      select: { estadoCuenta: true },
    });
    expect(cuenta.estadoCuenta).toBe('ACTIVO');
  }, 60_000);

  it('5 · suspender con motivo → 200 y el estado queda persistido', async () => {
    const res = await request(app.getHttpServer())
      .patch(`${api}/plataforma/usuarios/${usuarioCreadoId}/estado`)
      .set(auth())
      .send({ estadoCuenta: 'SUSPENDIDO', motivo: 'Prueba E2E' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: usuarioCreadoId,
      estadoCuenta: 'SUSPENDIDO',
      tokenVersion: 1,
      sesionesCerradas: true,
    });

    const cuenta = await prisma.usuario.findUniqueOrThrow({
      where: { id: usuarioCreadoId },
      select: { estadoCuenta: true, tokenVersion: true },
    });
    expect(cuenta).toEqual({ estadoCuenta: 'SUSPENDIDO', tokenVersion: 1 });
  }, 60_000);

  it('6 · GET auditoría trae la suspensión (con motivo) y el alta, en orden descendente', async () => {
    const res = await request(app.getHttpServer())
      .get(`${api}/plataforma/usuarios/${usuarioCreadoId}/auditoria`)
      .set(auth());

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(2);

    const acciones: string[] = res.body.map((evento: { accion: string }) => evento.accion);
    const indiceSuspension = acciones.indexOf('CUENTA_SUSPENDIDA');
    const indiceAlta = acciones.indexOf('USUARIO_CREADO');

    expect(indiceSuspension).toBeGreaterThanOrEqual(0);
    expect(indiceAlta).toBeGreaterThanOrEqual(0);
    // Lo más reciente, arriba: la suspensión se registró después del alta.
    expect(indiceSuspension).toBeLessThan(indiceAlta);

    const suspension = res.body[indiceSuspension];
    expect(suspension.motivo).toBe('Prueba E2E');
    expect(suspension.actor).toMatchObject({ correo: correos.admin });
    expect(suspension.contexto).toMatchObject({
      motivo: 'Prueba E2E',
      sesionesCerradas: true,
      nuevo: { estadoCuenta: 'SUSPENDIDO' },
      anterior: { estadoCuenta: 'ACTIVO' },
    });

    const alta = res.body[indiceAlta];
    expect(alta.contexto).toMatchObject({
      rol: 'ADMIN_BARBERIA',
      barberiaId: sedeId,
    });
    expect(alta.actor).toMatchObject({ id: adminId });

    // Orden descendente por fecha, comprobado sobre la respuesta completa.
    const fechas: number[] = res.body.map((evento: { creadoAt: string }) =>
      new Date(evento.creadoAt).getTime(),
    );
    expect([...fechas].sort((a, b) => b - a)).toEqual(fechas);

    // Y el historial de la cuenta no mezcla eventos de otras cuentas.
    for (const evento of res.body) {
      expect(evento.entidadId).toBe(usuarioCreadoId);
    }
  }, 60_000);
});
