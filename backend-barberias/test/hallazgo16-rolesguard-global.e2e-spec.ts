import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/shared/prisma/prisma.service.js';
import { JwtAuthGuard } from '../src/iam/infrastructure/jwt-auth.guard.js';

describe('Hallazgo 16 - RolesGuard Global (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let clienteToken: string;
  let barberiaId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    // Necesario para que JwtAuthGuard funcione en tests E2E
    const reflector = app.get('Reflector');
    app.useGlobalGuards(new JwtAuthGuard(reflector));
    
    // NOTA: No inyectamos RolesGuard aquí manualmente porque el test 
    // debe probar que AppModule lo registra correctamente de forma global.

    await app.init();
    prisma = app.get<PrismaService>(PrismaService);

    // 1. Limpiar datos de prueba anteriores
    await prisma.usuarioRol.deleteMany({ where: { usuario: { correo: 'test_hallazgo16@demo.com' } } });
    await prisma.usuario.deleteMany({ where: { correo: 'test_hallazgo16@demo.com' } });
    await prisma.barberia.deleteMany({ where: { nombre: 'Barberia Hallazgo 16' } });

    // 2. Datos de prueba PROPIOS del test (aislamiento): no asume usuarios ni roles
    // preexistentes en la BD — el rol CLIENTE y el dueño de la barbería se crean aquí.
    const rolCliente = await prisma.rol.upsert({
      where: { nombre: 'CLIENTE' },
      update: {},
      create: { nombre: 'CLIENTE', ambito: 'GLOBAL' },
    });
    const adminTemporal = await prisma.usuario.upsert({
      where: { correo: 'test_hallazgo16_owner@demo.com' },
      update: {},
      create: {
        nombreCompleto: 'Owner Hallazgo 16',
        correo: 'test_hallazgo16_owner@demo.com',
        telefono: '999888777161',
        passwordHash: '$2b$10$HashFalsoOwnerNoSeUsaEnLoginTest16',
        estadoCuenta: 'ACTIVO',
      },
    });
    const barberia = await prisma.barberia.create({
      data: {
        nombre: 'Barberia Hallazgo 16',
        telefono: '12345678',
        estado: 'ACTIVO',
        ubicacion: 'Lat, Long',
        codigoAcceso: 'TEST16',
        enlaceUnico: 'hallazgo16',
        responsableId: adminTemporal!.id
      }
    });
    barberiaId = barberia.id;

    // 3. Crear usuario con rol CLIENTE exclusivamente (usa el rol creado arriba)
    const cliente = await prisma.usuario.create({
      data: {
        nombreCompleto: 'Cliente Hallazgo 16',
        correo: 'test_hallazgo16@demo.com',
        telefono: '99988877716',
        passwordHash: '$2b$10$EpicHashFalsoParaTest...',
        estadoCuenta: 'ACTIVO',
        usuarioRoles: {
          create: {
            rolId: rolCliente!.id
          }
        }
      }
    });

    // 4. Iniciar sesión para obtener token
    // Como no podemos loguear directamente con el hash falso, usaremos el endpoint de login
    // Wait, mejor generamos el token usando JwtService para no depender de la ruta auth real con pass
    const jwtService = app.get(JwtService);
    clienteToken = await jwtService.signAsync({
      sub: cliente.id,
      correo: cliente.correo,
      roles: ['CLIENTE']
    });
  });

  afterAll(async () => {
    await prisma.usuarioRol.deleteMany({ where: { usuario: { correo: 'test_hallazgo16@demo.com' } } });
    await prisma.usuario.deleteMany({ where: { correo: 'test_hallazgo16@demo.com' } });
    await prisma.barberia.deleteMany({ where: { nombre: 'Barberia Hallazgo 16' } });
    // El dueño se borra después: barberias.responsable_id tiene FK a usuarios.
    await prisma.usuario.deleteMany({ where: { correo: 'test_hallazgo16_owner@demo.com' } });
    await app.close();
  });

  it('debe rechazar a un CLIENTE al intentar POST /catalogo/servicios con 403', async () => {
    const response = await request(app.getHttpServer())
      .post('/catalogo/servicios')
      .set('Authorization', `Bearer ${clienteToken}`)
      .set('x-barberia-id', barberiaId)
      .send({
        nombre: 'Corte Prueba',
        precio: 15,
        duracionMinutos: 30,
        categoria: 'Corte'
      });
      
    // En código vulnerable (sin RolesGuard global), esto devolverá 201 (si se inserta) 
    // o 400 (si falla la validación del body), pero NO 403.
    // El test DEBE exigir 403.
    expect(response.status).toBe(403);
  });

  it('debe rechazar a un CLIENTE al intentar PATCH /barberias/:id con 403', async () => {
    const response = await request(app.getHttpServer())
      .patch(`/barberias/${barberiaId}`)
      .set('Authorization', `Bearer ${clienteToken}`)
      .send({ nombre: 'Nombre Hackeado' });
      
    expect(response.status).toBe(403);
  });

  it('debe rechazar a un CLIENTE al intentar GET /reservas/agenda con 403', async () => {
    const response = await request(app.getHttpServer())
      .get('/reservas/agenda')
      .set('Authorization', `Bearer ${clienteToken}`)
      .set('x-barberia-id', barberiaId)
      .query({ fecha: '2026-09-30' });
      
    expect(response.status).toBe(403);
  });
});
