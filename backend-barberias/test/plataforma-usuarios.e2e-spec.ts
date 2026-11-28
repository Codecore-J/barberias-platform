import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/shared/prisma/prisma.service.js';
import { cedulaFixture, telefonoFixture } from './utils/identidad-fixtures.js';

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

  // F7 / T-75: teléfono dominicano (prefijo 809/829/849) y cédula con verificador.
  const telefonoAdmin = telefonoFixture(digitos, '809');
  const telefonoNuevo = telefonoFixture(digitos, '829');
  const cedulaNueva = cedulaFixture(digitos);
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
        telefono: `809${String(1).padStart(7, '0')}`,
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
    // La suite suspende su propia cuenta (caso 5) y dejaba la sede huérfana hasta
    // la corrida siguiente; `regularizar-administradores-sede.ts` la reportaba
    // entre medias. Se limpia también al terminar (mejor esfuerzo: el fallo de
    // la limpieza no debe ocultar el resultado de las pruebas).
    if (prisma) {
      try {
        await limpiarCorridasAnteriores(prisma);
      } catch (error) {
        console.warn(`No se pudo limpiar la base al terminar: ${(error as Error).message}`);
      }
    }
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

  it('3 · GET lista paginada y devuelve la creada con el DTO', async () => {
    const res = await request(app.getHttpServer())
      .get(`${api}/plataforma/usuarios`)
      .set(auth());

    expect(res.status).toBe(200);
    // T-81 · sobre paginado exacto: `{ datos, total, pagina, porPagina }`. El
    // KPI no viaja aquí: tiene su propia ruta (`/resumen`) para no pagar los
    // agregados de la plataforma en cada página ni en cada tecla del buscador.
    expect(res.body).toMatchObject({ pagina: 1, porPagina: 25 });
    expect(Array.isArray(res.body.datos)).toBe(true);
    expect(res.body.total).toBeGreaterThanOrEqual(1);
    expect(Object.keys(res.body).sort()).toEqual(
      ['datos', 'pagina', 'porPagina', 'total'].sort(),
    );

    const creada = res.body.datos.find(
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

  /**
   * T-81 · paginación real: `skip`/`take` en la base y `total` del conjunto
   * filtrado. El contrato anterior devolvía las 68 cuentas de staging en cada
   * visita a `/admin/usuarios`.
   */
  it('3b · page/pageSize recortan en la base y los filtros mueven el total', async () => {
    const primera = await request(app.getHttpServer())
      .get(`${api}/plataforma/usuarios?page=1&pageSize=1`)
      .set(auth());
    const segunda = await request(app.getHttpServer())
      .get(`${api}/plataforma/usuarios?page=2&pageSize=1`)
      .set(auth());

    expect(primera.status).toBe(200);
    expect(segunda.status).toBe(200);
    expect(primera.body).toMatchObject({ pagina: 1, porPagina: 1 });
    expect(segunda.body).toMatchObject({ pagina: 2, porPagina: 1 });
    expect(primera.body.datos).toHaveLength(1);
    expect(segunda.body.datos).toHaveLength(1);
    // Páginas distintas = filas distintas: el `skip` se aplica, no se recorta en
    // memoria después de traerlo todo.
    expect(segunda.body.datos[0].id).not.toBe(primera.body.datos[0].id);
    expect(primera.body.total).toBe(segunda.body.total);
    expect(primera.body.total).toBeGreaterThanOrEqual(2);
    expect(primera.body.datos.length).toBeLessThan(primera.body.total);

    // Filtros de servidor: el estado y el rol acotan el `total`, no solo la fila.
    const suspendidos = await request(app.getHttpServer())
      .get(`${api}/plataforma/usuarios?estado=SUSPENDIDO&pageSize=100`)
      .set(auth());
    expect(suspendidos.status).toBe(200);
    expect(
      suspendidos.body.datos.every((u: { estadoCuenta: string }) => u.estadoCuenta === 'SUSPENDIDO'),
    ).toBe(true);

    const porRol = await request(app.getHttpServer())
      .get(`${api}/plataforma/usuarios?rol=ADMIN_BARBERIA&pageSize=100`)
      .set(auth());
    expect(porRol.status).toBe(200);
    expect(
      porRol.body.datos.every((u: { roles: string[] }) => u.roles.includes('ADMIN_BARBERIA')),
    ).toBe(true);

    // El buscador es de servidor y no distingue mayúsculas.
    const buscado = await request(app.getHttpServer())
      .get(`${api}/plataforma/usuarios?busqueda=${encodeURIComponent(correos.nuevo.toUpperCase())}`)
      .set(auth());
    expect(buscado.status).toBe(200);
    expect(buscado.body.total).toBe(1);
    expect(buscado.body.datos[0].correo).toBe(correos.nuevo);

    // Un `pageSize` fuera del tope se rechaza (400), no se sirve la tabla entera.
    const excesivo = await request(app.getHttpServer())
      .get(`${api}/plataforma/usuarios?pageSize=1000`)
      .set(auth());
    expect(excesivo.status).toBe(400);
  }, 60_000);

  /**
   * T-81 · el KPI vive en su propia ruta: mide TODA la plataforma (no la página
   * ni el filtro vigente) y es la fuente de las tarjetas de la pantalla.
   */
  it('3c · GET /resumen devuelve los KPI de la plataforma, ajenos a los filtros', async () => {
    const res = await request(app.getHttpServer())
      .get(`${api}/plataforma/usuarios/resumen`)
      .set(auth());

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      total: expect.any(Number),
      activos: expect.any(Number),
      suspendidos: expect.any(Number),
      porRol: expect.any(Object),
    });
    // La cuenta ACTIVA creada en esta corrida entra en el total y en activos.
    expect(res.body.total).toBeGreaterThanOrEqual(1);
    expect(res.body.activos).toBeGreaterThanOrEqual(1);
    expect(res.body.total).toBe(res.body.activos + res.body.suspendidos);
    // `porRol` trae las cuatro claves del catálogo, con 0 cuando no hay cuentas.
    expect(Object.keys(res.body.porRol).sort()).toEqual(
      ['ADMINISTRADOR', 'ADMIN_BARBERIA', 'BARBERO', 'CLIENTE'].sort(),
    );
    expect(res.body.porRol.ADMIN_BARBERIA).toBeGreaterThanOrEqual(1);

    // Un filtro del listado no puede mover el KPI: son dos recursos distintos.
    const filtrado = await request(app.getHttpServer())
      .get(`${api}/plataforma/usuarios/resumen?estado=SUSPENDIDO&page=3`)
      .set(auth());
    expect(filtrado.status).toBe(200);
    expect(filtrado.body).toEqual(res.body);
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

  /**
   * T-20 · una cuenta que se dio de alta por el registro público también tiene
   * historial. Antes, `POST /auth/register` no escribía ningún evento y el modal
   * de auditoría mostraba «Sin eventos» en cuentas recién creadas.
   */
  it('7 · una cuenta registrada por el público trae su alta en la auditoría', async () => {
    const correo = `p20.publico.${Date.now()}@plataforma-test.com`;
    // Teléfono único por corrida: la 2.ª ejecución chocaba con el 409 de
    // `TELEFONO_YA_REGISTRADO` de la 1.ª (la cuenta pública no se limpia, porque
    // vive fuera del dominio de fixtures de esta suite).
    const alta = await request(app.getHttpServer())
      .post(`${api}/auth/register`)
      .send({
        nombreCompleto: 'T-20 Registro Público',
        correo,
        telefono: telefonoFixture(digitos, '849'),
        password: 'Password1!',
      });
    expect([200, 201], JSON.stringify(alta.body)).toContain(alta.status);
    const nuevoId = alta.body.usuario?.id as string;
    expect(nuevoId).toBeTruthy();

    const res = await request(app.getHttpServer())
      .get(`${api}/plataforma/usuarios/${nuevoId}/auditoria`)
      .set(auth());

    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(res.body[0]).toMatchObject({ accion: 'USUARIO_CREADO', entidadId: nuevoId });
    expect(res.body[0].contexto).toMatchObject({ origen: 'REGISTRO_PUBLICO', correo });
  }, 60_000);
});
