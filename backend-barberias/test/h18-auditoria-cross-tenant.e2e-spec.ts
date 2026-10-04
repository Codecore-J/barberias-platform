import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/shared/prisma/prisma.service.js';
import { PrismaExceptionFilter } from '../src/shared/filters/prisma-exception.filter.js';
import { ValidationPipe } from '@nestjs/common';
import { ClassSerializerInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as bcrypt from 'bcrypt';

/**
 * E1-02 (H18): fuga cross-tenant en la auditoria.
 *
 * La tabla `auditoria` no tiene barberia_id (eso es E3-01): el filtro actual
 * usa el JSON `contexto->>'barberiaId'`. Un ADMIN_BARBERIA que llama a
 * GET /api/v1/auditoria sin barberiaId se quedaba con un `where` vacio y
 * recibia los registros de todas las barberias.
 */

describe('E1-02 · GET /auditoria no cruza barberias (H18)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const correos = [
    'admin.a.h18@test.com',
    'admin.b.h18@test.com',
    'global.h18@test.com',
  ];

  let barberiaA: string;
  let barberiaB: string;
  let tokenAdminA: string;
  let tokenAdminB: string;
  let tokenGlobal: string;

  async function crearAdmin(correo: string, nombre: string, telefono: string) {
    const hash = await bcrypt.hash('Password1!', 10);
    return prisma.usuario.create({
      data: { nombreCompleto: nombre, correo, telefono, passwordHash: hash },
    });
  }

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

    // Idempotencia: si una corrida anterior fallo a mitad, no deja usuarios.
    await prisma.auditoria.deleteMany({ where: { usuario: { correo: { in: correos } } } });
    await prisma.usuarioRol.deleteMany({ where: { usuario: { correo: { in: correos } } } });
    await prisma.usuario.deleteMany({ where: { correo: { in: correos } } });

    const rolAdmin = await prisma.rol.upsert({
      where: { nombre: 'ADMIN_BARBERIA' },
      update: {},
      create: { nombre: 'ADMIN_BARBERIA', ambito: 'BARBERIA' },
    });
    const rolGlobal = await prisma.rol.upsert({
      where: { nombre: 'ADMINISTRADOR' },
      update: {},
      create: { nombre: 'ADMINISTRADOR', ambito: 'GLOBAL' },
    });

    const adminA = await crearAdmin('admin.a.h18@test.com', 'Admin Barberia A', '9990000001');
    const adminB = await crearAdmin('admin.b.h18@test.com', 'Admin Barberia B', '9990000002');
    const global = await crearAdmin('global.h18@test.com', 'Administrador Global', '9990000003');

    barberiaA = (
      await prisma.barberia.create({
        data: { nombre: 'Barberia A H18', telefono: '9991111111', ubicacion: 'A', codigoAcceso: 'H18-AAAA', enlaceUnico: 'https://a.h18.test/x', responsableId: adminA.id },
      })
    ).id;
    barberiaB = (
      await prisma.barberia.create({
        data: { nombre: 'Barberia B H18', telefono: '9992222222', ubicacion: 'B', codigoAcceso: 'H18-BBBB', enlaceUnico: 'https://b.h18.test/x', responsableId: adminB.id },
      })
    ).id;

    await prisma.usuarioRol.createMany({
      data: [
        { usuarioId: adminA.id, rolId: rolAdmin.id, barberiaId: barberiaA },
        { usuarioId: adminB.id, rolId: rolAdmin.id, barberiaId: barberiaB },
        { usuarioId: global.id, rolId: rolGlobal.id, barberiaId: null },
      ],
    });

    // Un registro de auditoria por barberia, con la barberia en el JSON
    // `contexto` (unico dato disponible mientras no exista la columna, E3-01).
    await prisma.auditoria.createMany({
      data: [
        {
          usuarioId: adminA.id,
          accion: 'REGISTRO_PAGO_EN_PERSONA',
          entidad: 'PAGO',
          contexto: { barberiaId: barberiaA, marca: 'registro-de-A' },
        },
        {
          usuarioId: adminB.id,
          accion: 'REGISTRO_PAGO_EN_PERSONA',
          entidad: 'PAGO',
          contexto: { barberiaId: barberiaB, marca: 'registro-de-B' },
        },
      ],
    });

    const login = async (correo: string) => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ correo, password: 'Password1!' });
      expect([200, 201], `login de ${correo}`).toContain(res.status);
      return res.body.accessToken as string;
    };

    tokenAdminA = await login('admin.a.h18@test.com');
    tokenAdminB = await login('admin.b.h18@test.com');
    tokenGlobal = await login('global.h18@test.com');
  }, 60000);

  afterAll(async () => {
    await prisma.auditoria.deleteMany({ where: { usuario: { correo: { in: correos } } } });
    await prisma.usuarioRol.deleteMany({ where: { usuario: { correo: { in: correos } } } });
    const ids = [barberiaA, barberiaB].filter(Boolean) as string[];
    if (ids.length > 0) {
      await prisma.barberia.deleteMany({ where: { id: { in: ids } } });
    }
    await prisma.usuario.deleteMany({ where: { correo: { in: correos } } });
    await app.close();
  }, 30000);

  it('el admin de A sin barberiaId recibe 400 y ningun registro', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/auditoria')
      .set('Authorization', `Bearer ${tokenAdminA}`);

    expect(res.status).toBe(400);
    expect(res.body?.data ?? []).toHaveLength(0);
  });

  it('el admin de A con barberiaId de B recibe 403', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/auditoria?barberiaId=${barberiaB}`)
      .set('Authorization', `Bearer ${tokenAdminA}`);

    expect(res.status).toBe(403);
  });

  it('el admin de A con su propia barberiaId solo ve sus registros', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/auditoria?barberiaId=${barberiaA}`)
      .set('Authorization', `Bearer ${tokenAdminA}`);

    expect(res.status).toBe(200);
    const marcas = (res.body.data ?? res.body.registros).map((r: any) => r.contexto?.marca);
    expect(marcas).toContain('registro-de-A');
    expect(marcas).not.toContain('registro-de-B');
  });

  it('un ADMINISTRADOR sin barberiaId ve las dos barberias', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/auditoria')
      .set('Authorization', `Bearer ${tokenGlobal}`);

    expect(res.status).toBe(200);
    const marcas = (res.body.data ?? res.body.registros).map((r: any) => r.contexto?.marca);
    expect(marcas).toContain('registro-de-A');
    expect(marcas).toContain('registro-de-B');
  });
});