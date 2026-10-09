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

describe('Hallazgo 14: IDOR Mismo-Tenant en Reserva (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let ownerToken: string;
  let ownerId: string;
  
  let clienteAToken: string;
  let clienteAId: string;

  let clienteBToken: string;
  let clienteBId: string;

  let barberiaId: string;
  let servicioId: string;
  let reservaIdA: string;

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

    // Cleanup previos
    const emails = ['owner.idor@test.com', 'clienta.idor@test.com', 'clientb.idor@test.com', 'usuario.u@test.com'];
    const usersToClean = await prisma.usuario.findMany({
      where: { correo: { in: emails } },
    });
    if (usersToClean.length > 0) {
      const ids = usersToClean.map(u => u.id);
      await prisma.reserva.deleteMany({ where: { clienteId: { in: ids } } });
      await prisma.usuarioRol.deleteMany({ where: { usuarioId: { in: ids } } });
      await prisma.clienteBarberia.deleteMany({ where: { usuarioId: { in: ids } } });
      
      const barberias = await prisma.barberia.findMany({ where: { responsableId: { in: ids } } });
      const barberiaIds = barberias.map(b => b.id);
      
      await prisma.reserva.deleteMany({ where: { barberiaId: { in: barberiaIds } } });
      await prisma.servicio.deleteMany({ where: { barberiaId: { in: barberiaIds } } });
      await prisma.horario.deleteMany({ where: { barberiaId: { in: barberiaIds } } });
      await prisma.usuarioRol.deleteMany({ where: { barberiaId: { in: barberiaIds } } });
      await prisma.clienteBarberia.deleteMany({ where: { barberiaId: { in: barberiaIds } } });
      
      await prisma.barberia.deleteMany({ where: { id: { in: barberiaIds } } });
      await prisma.usuario.deleteMany({ where: { id: { in: ids } } });
    }

    // Asegurar roles
    await prisma.rol.upsert({
      where: { nombre: 'ADMIN_BARBERIA' },
      update: {},
      create: { nombre: 'ADMIN_BARBERIA', ambito: 'BARBERIA' },
    });
    await prisma.rol.upsert({
      where: { nombre: 'CLIENTE' },
      update: {},
      create: { nombre: 'CLIENTE', ambito: 'BARBERIA' },
    });

    // Register Owner
    await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      nombreCompleto: 'Owner IDOR',
      correo: 'owner.idor@test.com',
      telefono: '9990001111',
      password: 'Password1!',
    });
    const ownerRes = await request(app.getHttpServer()).post('/api/v1/auth/login').send({
      correo: 'owner.idor@test.com',
      password: 'Password1!',
    });
    ownerToken = ownerRes.body.accessToken;
    ownerId = ownerRes.body.usuario.id;

    // Crear Barberia
    const bRes = await request(app.getHttpServer())
      .post('/api/v1/barberias')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        nombre: 'Barberia IDOR Test',
        telefono: '9991112222',
        ubicacion: 'Centro',
      });
    barberiaId = bRes.body.id;

    // Crear Servicio
    const s = await prisma.servicio.create({
      data: {
        barberiaId,
        nombre: 'Corte IDOR',
        precio: 10,
        duracionEstimada: 30,
        margenOperativo: 0
      }
    });
    servicioId = s.id;

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Crear Horario para todos los dias de la semana para evitar problemas de UTC
    for (let i = 0; i <= 6; i++) {
      await prisma.horario.create({
        data: {
          barberiaId,
          diaSemana: i,
          horaInicio: new Date('1970-01-01T00:00:00.000Z'),
          horaFin: new Date('1970-01-01T23:59:00.000Z')
        }
      });
    }

    // Register Cliente A
    await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      nombreCompleto: 'Cliente A',
      correo: 'clienta.idor@test.com',
      telefono: '9990001112',
      password: 'Password1!',
    });
    const cARes = await request(app.getHttpServer()).post('/api/v1/auth/login').send({
      correo: 'clienta.idor@test.com',
      password: 'Password1!',
    });
    clienteAToken = cARes.body.accessToken;
    clienteAId = cARes.body.usuario.id;

    // Register Cliente B
    await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      nombreCompleto: 'Cliente B',
      correo: 'clientb.idor@test.com',
      telefono: '9990001113',
      password: 'Password1!',
    });
    const cBRes = await request(app.getHttpServer()).post('/api/v1/auth/login').send({
      correo: 'clientb.idor@test.com',
      password: 'Password1!',
    });
    clienteBToken = cBRes.body.accessToken;
    clienteBId = cBRes.body.usuario.id;

    // Vincular y dar rol CLIENTE a Cliente A y B
    const rolCliente = await prisma.rol.findFirst({ where: { nombre: 'CLIENTE' } });
    
    // Vincular usa vincular() para hacerlo limpiamente en vez de prisma.usuarioRol
    await request(app.getHttpServer()).post('/api/v1/barberias/vincular')
      .set('Authorization', `Bearer ${clienteAToken}`)
      .send({ codigoAcceso: bRes.body.codigoAcceso });

    await request(app.getHttpServer()).post('/api/v1/barberias/vincular')
      .set('Authorization', `Bearer ${clienteBToken}`)
      .send({ codigoAcceso: bRes.body.codigoAcceso });

  }, 30000);

  afterAll(async () => {
    // 1. Borrar primero los recursos que no pueden existir sin la reserva y los pagos
    //    (la tabla pagos tiene FK con reserva), luego los servicios/horarios/vinculos y, por
    //    último, las barberías y los usuarios (para no violar la FK de responsableId).
    await prisma.pago.deleteMany({ where: { reserva: { barberiaId } } });
    await prisma.reserva.deleteMany({ where: { barberiaId } });
    await prisma.servicio.deleteMany({ where: { barberiaId } });
    await prisma.horario.deleteMany({ where: { barberiaId } });
    await prisma.usuarioRol.deleteMany({
      where: {
        OR: [
          { barberiaId },
          { usuario: { correo: { in: ['owner.idor@test.com', 'clienta.idor@test.com', 'clientb.idor@test.com', 'usuario.u@test.com'] } } }
        ]
      },
    });
    await prisma.clienteBarberia.deleteMany({
      where: {
        OR: [
          { barberiaId },
          { usuario: { correo: { in: ['owner.idor@test.com', 'clienta.idor@test.com', 'clientb.idor@test.com', 'usuario.u@test.com'] } } }
        ]
      },
    });

    // 2. Limpiar las barberías creadas por estos usuarios (sin violar la FK de responsableId)
    const users = await prisma.usuario.findMany({
      where: { correo: { in: ['owner.idor@test.com', 'clienta.idor@test.com', 'clientb.idor@test.com', 'usuario.u@test.com'] } },
    });
    const userIds = users.map(u => u.id);
    await prisma.barberia.deleteMany({ where: { responsableId: { in: userIds } } });
    await prisma.barberia.deleteMany({ where: { id: barberiaId } });

    // 3. Borrar los usuarios mismos
    await prisma.usuario.deleteMany({
      where: { id: { in: userIds } },
    });

    await app.close();
  });

  it('Cliente A debe poder crear una reserva', async () => {
    // Para simplificar, la creamos vía endpoint si es posible, o por BD directo.
    // Lo hacemos vía endpoint para validar.
    const date = new Date();
    date.setDate(date.getDate() + 1); // Mañana
    const dateString = date.toISOString().split('T')[0];

    const response = await request(app.getHttpServer())
      .post(`/api/v1/barberias/${barberiaId}/reservas`)
      .set('Authorization', `Bearer ${clienteAToken}`)
      .send({
        serviciosIds: [servicioId],
        fecha: dateString,
        horaInicio: '10:00',
        horaFin: '10:30',
        precioTotalEsperado: 10,
        tipo: 'INDIVIDUAL'
      });
      
    if (response.status !== 201) {
      console.log('Error creating reserva:', response.body);
    }
    
    expect(response.status).toBe(201);
    reservaIdA = response.body.id;
  });

  it('Cliente A debe poder ver su propia reserva', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/barberias/${barberiaId}/reservas/${reservaIdA}`)
      .set('Authorization', `Bearer ${clienteAToken}`);
      
    expect(response.status).toBe(200);
    expect(response.body.clienteId).toBe(clienteAId);
  });

  it('Cliente B NO debe poder ver la reserva del Cliente A (IDOR resuelto)', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/barberias/${barberiaId}/reservas/${reservaIdA}`)
      .set('Authorization', `Bearer ${clienteBToken}`);
      
    expect(response.status).toBe(403);
    expect(response.body.message).toContain('No tienes permisos');
  });

  it('Owner (Admin) DEBE poder ver la reserva del Cliente A', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/barberias/${barberiaId}/reservas/${reservaIdA}`)
      .set('Authorization', `Bearer ${ownerToken}`);
      
    expect(response.status).toBe(200);
    expect(response.body.clienteId).toBe(clienteAId);
  });

  it('Usuario con rol BARBERO en otra barberia pero CLIENTE aqui NO debe poder ver la reserva', async () => {
    // 1. Crear Barberia Y
    const bYRes = await request(app.getHttpServer())
      .post('/api/v1/barberias')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        nombre: 'Barberia Y',
        telefono: '9993334444',
        ubicacion: 'Norte',
      });
    const barberiaIdY = bYRes.body.id;

    // 2. Register Usuario U
    await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      nombreCompleto: 'Usuario U',
      correo: 'usuario.u@test.com',
      telefono: '9990001114',
      password: 'Password1!',
    });
    const uRes = await request(app.getHttpServer()).post('/api/v1/auth/login').send({
      correo: 'usuario.u@test.com',
      password: 'Password1!',
    });
    const usuarioUToken = uRes.body.accessToken;
    const usuarioUId = uRes.body.usuario.id;

    // 3. Vincular U a Barberia Y y asignarle BARBERO
    const rolBarbero = await prisma.rol.findFirst({ where: { nombre: 'BARBERO' } });
    if (!rolBarbero) {
      await prisma.rol.create({ data: { nombre: 'BARBERO', ambito: 'BARBERIA' } });
    }
    const rB = await prisma.rol.findFirst({ where: { nombre: 'BARBERO' } });
    await prisma.usuarioRol.create({
      data: { usuarioId: usuarioUId, rolId: rB!.id, barberiaId: barberiaIdY }
    });

    // 4. Vincular U a Barberia X (barberiaId) y asignarle CLIENTE
    await request(app.getHttpServer()).post('/api/v1/barberias/vincular')
      .set('Authorization', `Bearer ${usuarioUToken}`)
      .send({ codigoAcceso: await prisma.barberia.findUnique({where:{id:barberiaId}}).then(b=>b!.codigoAcceso) });

    // 5. U intenta acceder a la reserva de A en Barberia X
    const response = await request(app.getHttpServer())
      .get(`/api/v1/barberias/${barberiaId}/reservas/${reservaIdA}`)
      .set('Authorization', `Bearer ${usuarioUToken}`);
      
    expect(response.status).toBe(403);
    expect(response.body.message).toContain('No tienes permisos');
    
    // Limpieza
    await prisma.barberia.delete({ where: { id: barberiaIdY } });
    await prisma.usuario.delete({ where: { id: usuarioUId } });
  });
});
