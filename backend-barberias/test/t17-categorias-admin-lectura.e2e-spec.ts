import { Test, TestingModule } from '@nestjs/testing';
import {
  ClassSerializerInterceptor,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';
import { PrismaExceptionFilter } from './../src/shared/filters/prisma-exception.filter.js';
import { PrismaService } from './../src/shared/prisma/prisma.service.js';

/**
 * T-17 · `ADMINISTRADOR` global en `/shops/:shopId/categorias` = SOLO LECTURA.
 *
 * El `RolesGuard` deja pasar al admin de plataforma por jerarquía (E1-04), así
 * que un `@Roles('ADMIN_BARBERIA')` a secas NO lo detendría: el 403 de escritura
 * lo pone `OperadorBarberiaGuard`. Esta prueba lo ejecuta contra la base real, con
 * los guards de verdad, porque es exactamente el tipo de regla que se rompe al
 * tocar un decorador.
 */
describe('T-17 · categorías: ADMINISTRADOR lee, no escribe (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const api = '/api/v1';
  const sufijo = String(Date.now()).slice(-6);
  const CORREO_ADMIN = `t17.admin.${sufijo}@test.com`;
  const CORREO_SEDE = `t17.sede.${sufijo}@test.com`;
  const CORREOS = [CORREO_ADMIN, CORREO_SEDE];
  const PASSWORD = 'Password1!';
  const NOMBRE_SEDE = `Sede T17 ${sufijo}`;
  const TEL_ADMIN = `991${sufijo}1`;
  const TEL_SEDE = `991${sufijo}2`;

  let tokenAdmin = '';
  let tokenSede = '';
  let barberiaId = '';
  let categoriaId = '';

  async function crearUsuario(correo: string, nombre: string, telefono: string) {
    const passwordHash = await bcrypt.hash(PASSWORD, 10);
    return prisma.usuario.create({
      data: {
        correo,
        nombreCompleto: nombre,
        telefono,
        passwordHash,
        telefonoVerificado: true,
        estadoCuenta: 'ACTIVO',
      },
    });
  }

  const login = async (correo: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post(`${api}/auth/login`)
      .send({ correo, password: PASSWORD });
    expect(res.status, `login de ${correo}`).toBe(200);
    return res.body.accessToken as string;
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new PrismaExceptionFilter());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));
    await app.init();
    prisma = app.get(PrismaService);

    await prisma.usuarioRol.deleteMany({ where: { usuario: { correo: { in: CORREOS } } } });
    await prisma.categoriaServicio.deleteMany({ where: { barberia: { nombre: NOMBRE_SEDE } } });
    await prisma.barberia.deleteMany({ where: { nombre: NOMBRE_SEDE } });
    await prisma.usuario.deleteMany({ where: { correo: { in: CORREOS } } });

    const [rolAdmin, rolSede] = await Promise.all([
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
    ]);

    const admin = await crearUsuario(CORREO_ADMIN, 'Admin T17', TEL_ADMIN);
    const adminSede = await crearUsuario(CORREO_SEDE, 'Admin Sede T17', TEL_SEDE);

    const barberia = await prisma.barberia.create({
      data: {
        nombre: NOMBRE_SEDE,
        telefono: '9991700000',
        ubicacion: 'Calle T17',
        codigoAcceso: `T17${sufijo}`,
        enlaceUnico: `sede-t17-${sufijo}`,
        responsableId: adminSede.id,
      },
    });
    barberiaId = barberia.id;

    await prisma.usuarioRol.create({
      data: { usuarioId: admin.id, rolId: rolAdmin.id, barberiaId: null },
    });
    await prisma.usuarioRol.create({
      data: { usuarioId: adminSede.id, rolId: rolSede.id, barberiaId: barberia.id },
    });

    tokenAdmin = await login(CORREO_ADMIN);
    tokenSede = await login(CORREO_SEDE);

    // Un ADMIN_BARBERIA de verdad crea la primera categoría: así el listado que
    // lee el admin tiene contenido propio de la sede.
    const creada = await request(app.getHttpServer())
      .post(`${api}/shops/${barberiaId}/categorias`)
      .set('Authorization', `Bearer ${tokenSede}`)
      .send({ nombre: 'Corte', descripcion: 'Clásico' })
      .expect(201);
    categoriaId = creada.body.id;
  }, 60000);

  afterAll(async () => {
    await prisma.categoriaServicio.deleteMany({ where: { barberiaId } });
    await prisma.usuarioRol.deleteMany({ where: { usuario: { correo: { in: CORREOS } } } });
    await prisma.barberia.deleteMany({ where: { nombre: NOMBRE_SEDE } });
    await prisma.usuario.deleteMany({ where: { correo: { in: CORREOS } } });
    await app.close();
  }, 30000);

  it('ADMINISTRADOR lista las categorías de la sede (200)', async () => {
    const res = await request(app.getHttpServer())
      .get(`${api}/shops/${barberiaId}/categorias`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    const nombres = (res.body as { nombre: string }[]).map((c) => c.nombre);
    expect(nombres).toContain('Corte');
  });

  it('ADMINISTRADOR recibe 403 al crear una categoría', async () => {
    await request(app.getHttpServer())
      .post(`${api}/shops/${barberiaId}/categorias`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nombre: 'Categoría del admin', descripcion: 'No debería existir' })
      .expect(403);

    const existe = await prisma.categoriaServicio.findFirst({
      where: { barberiaId, nombre: 'Categoría del admin' },
    });
    expect(existe).toBeNull();
  });

  it('ADMINISTRADOR recibe 403 al editar una categoría', async () => {
    await request(app.getHttpServer())
      .patch(`${api}/shops/${barberiaId}/categorias/${categoriaId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nombre: 'Secuestrada' })
      .expect(403);

    const sigue = await prisma.categoriaServicio.findUnique({ where: { id: categoriaId } });
    expect(sigue?.nombre).toBe('Corte');
  });

  it('ADMIN_BARBERIA conserva lectura y escritura', async () => {
    await request(app.getHttpServer())
      .get(`${api}/shops/${barberiaId}/categorias`)
      .set('Authorization', `Bearer ${tokenSede}`)
      .expect(200);

    const creada = await request(app.getHttpServer())
      .post(`${api}/shops/${barberiaId}/categorias`)
      .set('Authorization', `Bearer ${tokenSede}`)
      .send({ nombre: 'Barba', descripcion: 'Afeitado' })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`${api}/shops/${barberiaId}/categorias/${creada.body.id}`)
      .set('Authorization', `Bearer ${tokenSede}`)
      .send({ nombre: 'Barba y bigote' })
      .expect(200);
  });
});
