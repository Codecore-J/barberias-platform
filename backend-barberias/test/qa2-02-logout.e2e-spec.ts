import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/shared/prisma/prisma.service.js';

/**
 * QA2-02 · `POST /auth/logout` cierra la sesión de verdad.
 *
 * El síntoma del QA: un JWT copiado de `localStorage` antes de pulsar «Cerrar
 * sesión» seguía respondiendo 200 durante 24 h, porque no existía endpoint de
 * logout y `token_version` solo subía al suspender la cuenta o retirar roles.
 *
 * El mecanismo (decisión del dueño): `POST /auth/logout` incrementa
 * `token_version` de la cuenta, igual que la suspensión. El `JwtStrategy` ya
 * compara `payload.tv` contra la versión vigente, así que no hay un segundo
 * mecanismo de revocación: el token que acaba de cerrar sesión —y cualquier
 * otro dispositivo de la misma cuenta— queda fuera en la siguiente petición.
 * El trade-off (cerrar en uno cierra en todos) está aceptado por el dueño.
 *
 * Solo con APP_ENV=dev: la suite e2e corre contra el Postgres local.
 */

describe('QA2-02 · POST /auth/logout invalida el token (D24)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const api = '/api/v1';
  const sufijo = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const correo = `qa2.logout-${sufijo}@test.com`;
  const serie = String(Math.floor(Math.random() * 9000) + 1000);
  const password = 'Password1!';

  let usuarioId: string;
  /** Token del «dispositivo A»: el que se cierra. */
  let tokenA: string;
  /** Token del «dispositivo B»: la misma cuenta, otra sesión. */
  let tokenB: string;

  const login = async (): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post(`${api}/auth/login`)
      .send({ correo, password });

    expect(res.status).toBe(200);
    return res.body.accessToken as string;
  };

  const me = (token?: string) => {
    const peticion = request(app.getHttpServer()).get(`${api}/auth/me`);
    return token ? peticion.set({ Authorization: `Bearer ${token}` }) : peticion;
  };

  const logout = (token?: string) => {
    const peticion = request(app.getHttpServer()).post(`${api}/auth/logout`);
    return token ? peticion.set({ Authorization: `Bearer ${token}` }) : peticion;
  };

  const versionVigente = async (): Promise<number> => {
    const usuario = await prisma.usuario.findUniqueOrThrow({
      where: { id: usuarioId },
      select: { tokenVersion: true },
    });
    return usuario.tokenVersion;
  };

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

    const registro = await request(app.getHttpServer())
      .post(`${api}/auth/register`)
      .send({
        nombreCompleto: 'QA2 Logout',
        correo,
        telefono: `809${serie}${String(1).padStart(3, '0')}`,
        password,
      });
    expect([200, 201, 409]).toContain(registro.status);

    const usuario = await prisma.usuario.findUniqueOrThrow({
      where: { correo },
      select: { id: true },
    });
    usuarioId = usuario.id;

    tokenA = await login();
    tokenB = await login();
  }, 180_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('VERDE: el token deja de valer tras el logout y el cierre queda auditado', async () => {
    // 0. Con la sesión viva el token responde.
    await me(tokenA).expect(200);

    const versionAntes = await versionVigente();

    // 1. El logout es un endpoint protegido y responde sin cuerpo.
    const cierre = await logout(tokenA);
    expect(cierre.status).toBe(204);

    // 2. El token con el que se cerró sesión ya no sirve.
    const conTokenCerrado = await me(tokenA);
    expect(conTokenCerrado.status).toBe(401);

    // 3. La cuenta subió de versión: ese es el mecanismo, el mismo de la
    //    suspensión (no hay lista de revocación aparte).
    expect(await versionVigente()).toBe(versionAntes + 1);

    // 4. El evento existe, es del propio usuario y no lleva datos sensibles.
    const evento = await prisma.auditoria.findFirst({
      where: { accion: 'SESION_CERRADA', entidad: 'usuarios', entidadId: usuarioId },
      orderBy: { creadoAt: 'desc' },
    });

    expect(evento).not.toBeNull();
    expect(evento?.usuarioId).toBe(usuarioId);
    const contexto = evento?.contexto as Record<string, unknown> | null;
    expect(contexto).toMatchObject({ sesionesCerradas: true });
    expect(JSON.stringify(contexto)).not.toContain(password);
  }, 120_000);

  it('VERDE: la otra sesión de la misma cuenta también recibe 401 (trade-off aceptado)', async () => {
    await me(tokenB).expect(401);
  }, 60_000);

  it('ROJO: sin token → 401 y la versión de la cuenta no cambia', async () => {
    const versionAntes = await versionVigente();

    await logout().expect(401);

    expect(await versionVigente()).toBe(versionAntes);
  }, 60_000);

  it('VERDE: después del logout se puede volver a entrar y el token nuevo vale', async () => {
    const tokenNuevo = await login();

    await me(tokenNuevo).expect(200);

    // Y ese token nuevo también se puede cerrar.
    await logout(tokenNuevo).expect(204);
    await me(tokenNuevo).expect(401);

    // La sesión de las pruebas anteriores sigue cerrada.
    await me(tokenA).expect(401);
  }, 120_000);
});
