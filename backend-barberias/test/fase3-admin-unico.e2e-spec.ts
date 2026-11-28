import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerStorage } from '@nestjs/throttler';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/shared/prisma/prisma.service.js';

/**
 * Fase 3 · E2E de las reglas de dueño único y cuenta dual.
 *
 * Cubre, contra la API real, las TRES puertas que asignan `ADMIN_BARBERIA` y el
 * flujo del dueño que corta pelo:
 *
 *  1. `POST /plataforma/usuarios` → 409 `SEDE_YA_TIENE_ADMIN` + `adminActual`.
 *  2. `POST /shops/:id/staff`     → mismo 409 (no hay puerta trasera).
 *  3. `PATCH /shops/:id/staff/:userId` al promover → mismo 409.
 *  4. Invitar al dueño como BARBERO sin flag → 409 `ADMIN_NO_SE_DEGRADA` y el
 *     vínculo de administrador queda intacto.
 *  5. Con `conservarRolAdministrador: true` → se AÑADE el vínculo de barbero y
 *     el de administrador sigue ACTIVO (cuenta dual). Repetirlo es idempotente.
 *
 * La suite crea sus propias fixtures con un sufijo único y solo borra lo suyo
 * (dominio de correo y prefijo de `codigo_acceso` de este archivo).
 */

const DOMINIO = 'fase3-admin-unico.e2e.test';
const PREFIJO_SEDE = 'E2E-F3-';

async function limpiarCorridasAnteriores(prisma: PrismaService): Promise<void> {
  const usuarios = await prisma.usuario.findMany({
    where: { correo: { endsWith: `@${DOMINIO}` } },
    select: { id: true },
  });
  const sedes = await prisma.barberia.findMany({
    where: { codigoAcceso: { startsWith: PREFIJO_SEDE } },
    select: { id: true },
  });

  if (usuarios.length === 0 && sedes.length === 0) return;

  const usuarioIds = usuarios.map((usuario) => usuario.id);
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

describe('Fase 3 · administrador único por sede y cuenta dual (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;

  const api = '/api/v1';
  const sufijo = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const digitos = String(Date.now()).slice(-7);

  const correos = {
    global: `global.f3-${sufijo}@${DOMINIO}`,
    dueno: `dueno.f3-${sufijo}@${DOMINIO}`,
    segundo: `segundo.f3-${sufijo}@${DOMINIO}`,
    tercero: `tercero.f3-${sufijo}@${DOMINIO}`,
    barbero: `barbero.f3-${sufijo}@${DOMINIO}`,
  };

  // F7 / T-75: el alta administrativa exige prefijo dominicano real.
  const telefono = (posicion: number) => `809${digitos.slice(0, 6)}${posicion}`;
  const password = 'Password1!';

  let tokenGlobal = '';
  /**
   * T-11 · las rutas de personal (`/shops/:shopId/staff`) son del ADMIN_BARBERIA
   * de la sede, no del ADMINISTRADOR global. Antes esta suite las llamaba con el
   * token global y el guard lo dejaba pasar por jerarquía; ahora se firma un
   * token del dueño de la sede (mismo usuario que crea el test 1).
   */
  let tokenDueno = '';
  let sedeId = '';
  let duenoId = '';
  let barberoId = '';

  const auth = () => ({ Authorization: `Bearer ${tokenGlobal}` });
  const authSede = () => ({ Authorization: `Bearer ${tokenDueno}` });

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
    jwtService = app.get(JwtService);

    await limpiarCorridasAnteriores(prisma);

    const rolAdministrador = await prisma.rol.upsert({
      where: { nombre: 'ADMINISTRADOR' },
      update: {},
      create: { nombre: 'ADMINISTRADOR', ambito: 'GLOBAL' },
    });
    for (const rol of [
      { nombre: 'ADMIN_BARBERIA', ambito: 'BARBERIA' },
      { nombre: 'BARBERO', ambito: 'BARBERIA' },
      { nombre: 'CLIENTE', ambito: 'GLOBAL' },
    ]) {
      await prisma.rol.upsert({ where: { nombre: rol.nombre }, update: {}, create: rol });
    }

    // Administrador global: se registra como CLIENTE y se asciende en la base
    // (no existe ruta para autoasignarse el rol global).
    const registro = await request(app.getHttpServer())
      .post(`${api}/auth/register`)
      .send({
        nombreCompleto: 'Global Fase 3',
        correo: correos.global,
        telefono: telefono(0),
        password,
      });
    expect([200, 201], JSON.stringify(registro.body)).toContain(registro.status);

    const global = await prisma.usuario.findUniqueOrThrow({
      where: { correo: correos.global },
      select: { id: true },
    });
    await prisma.usuarioRol.create({
      data: { usuarioId: global.id, rolId: rolAdministrador.id, barberiaId: null },
    });

    // Sede sin administrador: es el escenario que el alta debe poblar.
    const sede = await prisma.barberia.create({
      data: {
        nombre: `Sede F3-${sufijo}`,
        telefono: `849${digitos}`,
        ubicacion: 'Sede Fase 3 E2E',
        estado: 'ACTIVO',
        codigoAcceso: `${PREFIJO_SEDE}${sufijo}`,
        enlaceUnico: `https://f3-${sufijo}.test`,
        responsableId: global.id,
      },
      select: { id: true },
    });
    sedeId = sede.id;

    const login = await request(app.getHttpServer())
      .post(`${api}/auth/login`)
      .send({ correo: correos.global, password });
    expect(login.status).toBe(200);
    tokenGlobal = login.body.accessToken;
    expect(tokenGlobal).toBeTruthy();
  }, 240_000);

  afterAll(async () => {
    if (app) await app.close();
    if (prisma) await prisma.$disconnect();
  });

  it('1 · el alta del primer ADMIN_BARBERIA en una sede libre devuelve 201', async () => {
    const res = await request(app.getHttpServer())
      .post(`${api}/plataforma/usuarios`)
      .set(auth())
      .send({
        nombreCompleto: 'Dueño Fase 3',
        correo: correos.dueno,
        telefono: telefono(1),
        password,
        rolNombre: 'ADMIN_BARBERIA',
        barberiaId: sedeId,
      });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.roles).toEqual(['ADMIN_BARBERIA']);
    duenoId = res.body.id;

    tokenDueno = await jwtService.signAsync({
      sub: duenoId,
      correo: correos.dueno,
      roles: ['ADMIN_BARBERIA'],
    });

    const vinculo = await prisma.usuarioRol.findFirst({
      where: { usuarioId: duenoId, barberiaId: sedeId, rol: { nombre: 'ADMIN_BARBERIA' } },
      select: { estado: true },
    });
    expect(vinculo?.estado).toBe('ACTIVO');
  }, 60_000);

  it('2 · un segundo ADMIN_BARBERIA en la misma sede → 409 con adminActual y sin cuenta nueva', async () => {
    const res = await request(app.getHttpServer())
      .post(`${api}/plataforma/usuarios`)
      .set(auth())
      .send({
        nombreCompleto: 'Segundo Dueño',
        correo: correos.segundo,
        telefono: telefono(2),
        password,
        rolNombre: 'ADMIN_BARBERIA',
        barberiaId: sedeId,
      });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      statusCode: 409,
      codigo: 'SEDE_YA_TIENE_ADMIN',
      mensaje: 'La sede ya tiene un administrador activo.',
      adminActual: {
        id: duenoId,
        correo: correos.dueno,
        nombreCompleto: 'Dueño Fase 3',
      },
    });

    // Nada se escribió: ni la cuenta ni un vínculo huérfano.
    expect(await prisma.usuario.count({ where: { correo: correos.segundo } })).toBe(0);
    const admins = await prisma.usuarioRol.count({
      where: { barberiaId: sedeId, estado: 'ACTIVO', rol: { nombre: 'ADMIN_BARBERIA' } },
    });
    expect(admins).toBe(1);
  }, 60_000);

  it('3 · la invitación de personal tampoco admite un segundo dueño (misma regla, otra puerta)', async () => {
    const res = await request(app.getHttpServer())
      .post(`${api}/shops/${sedeId}/staff`)
      .set(authSede())
      .send({
        nombreCompleto: 'Tercer Dueño',
        correo: correos.tercero,
        telefono: telefono(3),
        password,
        rolNombre: 'ADMIN_BARBERIA',
      });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      codigo: 'SEDE_YA_TIENE_ADMIN',
      adminActual: { id: duenoId, correo: correos.dueno },
    });
    expect(await prisma.usuario.count({ where: { correo: correos.tercero } })).toBe(0);
  }, 60_000);

  it('4 · invitar al dueño como BARBERO sin el flag → 409 ADMIN_NO_SE_DEGRADA y el rol intacto', async () => {
    const res = await request(app.getHttpServer())
      .post(`${api}/shops/${sedeId}/staff`)
      .set(authSede())
      .send({
        nombreCompleto: 'Dueño Fase 3',
        correo: correos.dueno,
        telefono: telefono(1),
        password,
        rolNombre: 'BARBERO',
      });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ statusCode: 409, codigo: 'ADMIN_NO_SE_DEGRADA' });

    // El vínculo sigue siendo de administrador y no hay fila de barbero.
    const vinculos = await prisma.usuarioRol.findMany({
      where: { usuarioId: duenoId, barberiaId: sedeId },
      select: { estado: true, rol: { select: { nombre: true } } },
    });
    expect(vinculos).toHaveLength(1);
    expect(vinculos[0]).toMatchObject({
      estado: 'ACTIVO',
      rol: { nombre: 'ADMIN_BARBERIA' },
    });
  }, 60_000);

  it('5 · con conservarRolAdministrador:true se crea la cuenta dual sin perder el rol de dueño', async () => {
    const res = await request(app.getHttpServer())
      .post(`${api}/shops/${sedeId}/staff`)
      .set(authSede())
      .send({
        nombreCompleto: 'Dueño Fase 3',
        correo: correos.dueno,
        telefono: telefono(1),
        password,
        rolNombre: 'BARBERO',
        conservarRolAdministrador: true,
      });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.reutilizado).toBe(true);
    expect([...res.body.roles].sort((a, b) => a.localeCompare(b))).toEqual([
      'ADMIN_BARBERIA',
      'BARBERO',
    ]);

    const vinculos = await prisma.usuarioRol.findMany({
      where: { usuarioId: duenoId, barberiaId: sedeId },
      select: { estado: true, rol: { select: { nombre: true } } },
    });
    expect(vinculos).toHaveLength(2);
    const porRol = Object.fromEntries(
      vinculos.map((fila) => [fila.rol.nombre, fila.estado]),
    ) as Record<string, string>;
    expect(porRol).toEqual({ ADMIN_BARBERIA: 'ACTIVO', BARBERO: 'ACTIVO' });
  }, 60_000);

  it('6 · repetir la invitación con el flag es idempotente (no duplica vínculos)', async () => {
    const res = await request(app.getHttpServer())
      .post(`${api}/shops/${sedeId}/staff`)
      .set(authSede())
      .send({
        nombreCompleto: 'Dueño Fase 3',
        correo: correos.dueno,
        telefono: telefono(1),
        password,
        rolNombre: 'BARBERO',
        conservarRolAdministrador: true,
      });

    expect(res.status).toBe(201);

    const vinculos = await prisma.usuarioRol.count({
      where: { usuarioId: duenoId, barberiaId: sedeId },
    });
    expect(vinculos).toBe(2);
  }, 60_000);

  it('7 · el listado de personal muestra al dueño con sus dos roles', async () => {
    const res = await request(app.getHttpServer())
      .get(`${api}/shops/${sedeId}/staff`)
      .set(authSede());

    expect(res.status).toBe(200);
    const dueno = (res.body as { id: string; roles: string[] }[]).find(
      (miembro) => miembro.id === duenoId,
    );
    expect(dueno).toBeDefined();
    expect([...(dueno?.roles ?? [])].sort((a, b) => a.localeCompare(b))).toEqual([
      'ADMIN_BARBERIA',
      'BARBERO',
    ]);
  }, 60_000);

  it('8 · promover a ADMIN_BARBERIA a un miembro de la sede ocupada → 409', async () => {
    // Un barbero nuevo: la promoción es la tercera puerta del mismo conflicto.
    const alta = await request(app.getHttpServer())
      .post(`${api}/shops/${sedeId}/staff`)
      .set(authSede())
      .send({
        nombreCompleto: 'Barbero Fase 3',
        correo: correos.barbero,
        telefono: telefono(4),
        password,
        rolNombre: 'BARBERO',
      });
    expect(alta.status, JSON.stringify(alta.body)).toBe(201);
    barberoId = alta.body.id;

    const res = await request(app.getHttpServer())
      .patch(`${api}/shops/${sedeId}/staff/${barberoId}`)
      .set(authSede())
      .send({ rolNombre: 'ADMIN_BARBERIA' });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      codigo: 'SEDE_YA_TIENE_ADMIN',
      adminActual: { id: duenoId, correo: correos.dueno },
    });

    const vinculo = await prisma.usuarioRol.findFirstOrThrow({
      where: { usuarioId: barberoId, barberiaId: sedeId },
      select: { rol: { select: { nombre: true } } },
    });
    expect(vinculo.rol.nombre).toBe('BARBERO');
  }, 90_000);

  /**
   * Fase 4 · la regla también vive en PostgreSQL.
   *
   * Estos casos escriben con Prisma directamente, sin pasar por
   * `asegurarSedeSinAdmin`, para comprobar que el trigger
   * `trg_admin_barberia_unico_por_sede` es la última línea de defensa (seeds,
   * scripts, consolas SQL y rutas futuras).
   */
  describe('la base de datos también impide el segundo dueño (trigger)', () => {
    let rolAdminSedeId = '';
    let vinculoDuenoId = '';

    beforeAll(async () => {
      const rol = await prisma.rol.findUniqueOrThrow({
        where: { nombre: 'ADMIN_BARBERIA' },
        select: { id: true },
      });
      rolAdminSedeId = rol.id;

      const vinculo = await prisma.usuarioRol.findFirstOrThrow({
        where: { usuarioId: duenoId, barberiaId: sedeId, rolId: rol.id },
        select: { id: true },
      });
      vinculoDuenoId = vinculo.id;
    }, 60_000);

    it('9 · un INSERT directo (saltándose el servicio) de un segundo dueño activo es rechazado', async () => {
      let error: unknown;
      try {
        await prisma.usuarioRol.create({
          data: {
            usuarioId: barberoId,
            rolId: rolAdminSedeId,
            barberiaId: sedeId,
            estado: 'ACTIVO',
          },
        });
      } catch (capturado) {
        error = capturado;
      }

      // El trigger usa SQLSTATE 23505 para que Prisma lo trate como conflicto de
      // unicidad (P2002 → 409 en `PrismaExceptionFilter`), y Prisma reemplaza el
      // mensaje del RAISE por el suyo: se comprueba el código, no el texto.
      expect(error).toBeDefined();
      expect((error as { code?: string }).code).toBe('P2002');
      expect((error as Error).message).toMatch(/unique constraint|administrador/i);

      const adminsActivos = await prisma.usuarioRol.count({
        where: { barberiaId: sedeId, estado: 'ACTIVO', rolId: rolAdminSedeId },
      });
      expect(adminsActivos).toBe(1);
    }, 60_000);

    it('10 · desactivar al dueño actual permite nombrar otro, y reactivar el anterior se rechaza', async () => {
      await prisma.usuarioRol.update({
        where: { id: vinculoDuenoId },
        data: { estado: 'INACTIVO' },
      });

      const nuevoDueno = await prisma.usuarioRol.create({
        data: {
          usuarioId: barberoId,
          rolId: rolAdminSedeId,
          barberiaId: sedeId,
          estado: 'ACTIVO',
        },
      });
      expect(nuevoDueno.estado).toBe('ACTIVO');

      let error: unknown;
      try {
        await prisma.usuarioRol.update({
          where: { id: vinculoDuenoId },
          data: { estado: 'ACTIVO' },
        });
      } catch (capturado) {
        error = capturado;
      }
      expect(error).toBeDefined();

      const adminsActivos = await prisma.usuarioRol.count({
        where: { barberiaId: sedeId, estado: 'ACTIVO', rolId: rolAdminSedeId },
      });
      expect(adminsActivos).toBe(1);

      // Se deja la sede como estaba para no alterar el resto de la suite.
      await prisma.usuarioRol.delete({ where: { id: nuevoDueno.id } });
      await prisma.usuarioRol.update({
        where: { id: vinculoDuenoId },
        data: { estado: 'ACTIVO' },
      });
    }, 60_000);

    it('11 · actualizar el mismo vínculo no se bloquea a sí mismo', async () => {
      const actualizado = await prisma.usuarioRol.update({
        where: { id: vinculoDuenoId },
        data: { estado: 'ACTIVO' },
      });
      expect(actualizado.estado).toBe('ACTIVO');
    }, 60_000);
  });
});
