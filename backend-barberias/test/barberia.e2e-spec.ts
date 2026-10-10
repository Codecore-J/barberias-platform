import { Test, TestingModule } from '@nestjs/testing';
import {
  ClassSerializerInterceptor,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';
import { PrismaExceptionFilter } from './../src/shared/filters/prisma-exception.filter.js';
import { PrismaService } from './../src/shared/prisma/prisma.service.js';

describe('Barberias Endpoints (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let ownerToken: string;
  let ownerId: string;
  let clientToken: string;
  let clientId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new PrismaExceptionFilter());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));

    await app.init();
    prisma = app.get(PrismaService);

    // Clean up if previous tests failed
    const usersToClean = await prisma.usuario.findMany({
      where: { correo: { in: ['owner.e2e@test.com', 'client.e2e@test.com'] } },
    });
    if (usersToClean.length > 0) {
      const ids = usersToClean.map(u => u.id);
      await prisma.barberia.deleteMany({ where: { responsableId: { in: ids } } });
      await prisma.usuario.deleteMany({ where: { id: { in: ids } } });
    }

    // Asegurar que exista el rol ADMIN_BARBERIA
    await prisma.rol.upsert({
      where: { nombre: 'ADMIN_BARBERIA' },
      update: {},
      create: { nombre: 'ADMIN_BARBERIA', ambito: 'BARBERIA' },
    });

    // Register Owner
    await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      nombreCompleto: 'Owner Barberia',
      correo: 'owner.e2e@test.com',
      telefono: '1231231234',
      password: 'Password1!',
    });
    const ownerRes = await request(app.getHttpServer()).post('/api/v1/auth/login').send({
      correo: 'owner.e2e@test.com',
      password: 'Password1!',
    });
    ownerToken = ownerRes.body.accessToken;
    ownerId = ownerRes.body.usuario.id;

    // Register Client
    await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      nombreCompleto: 'Cliente Prueba',
      correo: 'client.e2e@test.com',
      telefono: '9879879876',
      password: 'Password1!',
    });
    const clientRes = await request(app.getHttpServer()).post('/api/v1/auth/login').send({
      correo: 'client.e2e@test.com',
      password: 'Password1!',
    });
    clientToken = clientRes.body.accessToken;
    clientId = clientRes.body.usuario.id;
  });

  afterAll(async () => {
    // Cleanup cascade
    await prisma.barberia.deleteMany({
      where: { responsableId: { in: [ownerId, clientId].filter(Boolean) } },
    });
    await prisma.usuario.deleteMany({
      where: { id: { in: [ownerId, clientId].filter(Boolean) } },
    });
    await app.close();
  });

  let createdBarberiaId: string;
  let createdCodigoAcceso: string;

  describe('T2.1 Creación y configuración de barberías', () => {
    it('debe crear una barbería, generar código único y asignar ADMIN_BARBERIA', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/barberias')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          nombre: 'Barberia E2E Test',
          descripcion: 'Barberia de prueba',
          telefono: '111222333',
          ubicacion: 'Centro',
        });

      if (response.status !== 201) {
        console.error('ERROR BODY:', response.body);
      }

      expect(response.status).toBe(201);
      expect(response.body.id).toBeDefined();
      expect(response.body.codigoAcceso).toBeDefined();
      expect(response.body.enlaceUnico).toBeDefined();

      createdBarberiaId = response.body.id;
      createdCodigoAcceso = response.body.codigoAcceso;

      // Verificar en BD que la Configuración existe
      const config = await prisma.configuracionBarberia.findUnique({
        where: { barberiaId: createdBarberiaId },
      });
      expect(config).toBeDefined();

      // Verificar en BD que tiene el rol ADMIN_BARBERIA
      const rolAdmin = await prisma.rol.findFirst({ where: { nombre: 'ADMIN_BARBERIA' } });
      const usuarioRol = await prisma.usuarioRol.findFirst({
        where: { usuarioId: ownerId, rolId: rolAdmin!.id, barberiaId: createdBarberiaId },
      });
      expect(usuarioRol).toBeDefined();
    });
  });

  describe('T2.2 Vinculación de clientes (Límite 5)', () => {
    it('debe vincular al cliente y asignarle estado ACTIVO si es su primera', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/barberias/vincular')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ codigoAcceso: createdCodigoAcceso })
        .expect(201);

      expect(response.body.estadoVinculacion).toBe('ACTIVO');
      expect(response.body.esBarberiaActiva).toBe(true);
    });

    it('debe generar PENDIENTE_APROBACION a partir de la 6ta vinculación', async () => {
      // Creamos 5 barberías más (ya tenemos 1 vinculada)
      const barberiasExtra = [];
      for (let i = 1; i <= 5; i++) {
        const res = await request(app.getHttpServer())
          .post('/api/v1/barberias')
          .set('Authorization', `Bearer ${ownerToken}`)
          .send({
            nombre: `Barberia Extra ${i}`,
            telefono: `00000${i}`,
            ubicacion: 'Sur',
          });
        barberiasExtra.push(res.body);
      }

      // Nos vinculamos a 4 barberías más para llegar a 5 vinculaciones totales
      for (let i = 0; i < 4; i++) {
        const res = await request(app.getHttpServer())
          .post('/api/v1/barberias/vincular')
          .set('Authorization', `Bearer ${clientToken}`)
          .send({ codigoAcceso: barberiasExtra[i].codigoAcceso })
          .expect(201);
          
        expect(res.body.estadoVinculacion).toBe('ACTIVO');
      }

      // La vinculación #6 debe devolver PENDIENTE
      const res6 = await request(app.getHttpServer())
        .post('/api/v1/barberias/vincular')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ codigoAcceso: barberiasExtra[4].codigoAcceso })
        .expect(201);

      expect(res6.body.estadoVinculacion).toBe('PENDIENTE_APROBACION');
      expect(res6.body.esBarberiaActiva).toBe(false);
    }, 30000); // 30 seconds timeout
  });

  describe('T2.3 Garantía de una sola barbería activa', () => {
    it('debe apagar las demás barberías al activar una nueva', async () => {
      // Obtenemos las barberías del cliente desde la base de datos
      const vinculaciones = await prisma.clienteBarberia.findMany({
        where: { usuarioId: clientId },
      });

      expect(vinculaciones.length).toBe(6);

      const activaAnterior = vinculaciones.find(v => v.esBarberiaActiva);
      const nuevaAActivar = vinculaciones.find(v => !v.esBarberiaActiva && v.estadoVinculacion === 'ACTIVO');

      expect(activaAnterior).toBeDefined();
      expect(nuevaAActivar).toBeDefined();

      // Mandamos a activar `nuevaAActivar`
      await request(app.getHttpServer())
        .patch(`/api/v1/barberias/${nuevaAActivar!.barberiaId}/seleccionar`)
        .set('Authorization', `Bearer ${clientToken}`)
        .expect(200);

      // Verificamos en BD
      const estadoActual = await prisma.clienteBarberia.findMany({
        where: { usuarioId: clientId },
      });

      const anteriorDespues = estadoActual.find(v => v.barberiaId === activaAnterior!.barberiaId);
      const nuevaDespues = estadoActual.find(v => v.barberiaId === nuevaAActivar!.barberiaId);

      expect(anteriorDespues!.esBarberiaActiva).toBe(false); // Se desactivó atómicamente
      expect(nuevaDespues!.esBarberiaActiva).toBe(true);     // Quedó como la única activa
    });
  });
});
