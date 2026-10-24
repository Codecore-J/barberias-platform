import { Test, TestingModule } from '@nestjs/testing';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { ServiciosService } from './servicios.service.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { NotFoundException, BadRequestException } from '@nestjs/common';

describe('ServiciosService', () => {
  let service: ServiciosService;
  let prisma: {
    servicio: {
      create: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    reserva: {
      findMany: ReturnType<typeof vi.fn>;
    };
    combo: {
      findMany: ReturnType<typeof vi.fn>;
    };
  };

  const mockBarberiaId = 'barberia-uuid-1';
  const mockServicioId = 'servicio-uuid-1';

  beforeEach(async () => {
    prisma = {
      servicio: {
        create: vi.fn(),
        findMany: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
      },
      reserva: {
        findMany: vi.fn(),
      },
      combo: {
        findMany: vi.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ServiciosService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
      ],
    }).compile();

    service = module.get<ServiciosService>(ServiciosService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('debe crear un servicio con estado ACTIVO', async () => {
      const dto = {
        nombre: 'Corte Clásico',
        precio: 25.0,
        duracionEstimada: 30,
        margenOperativo: 10,
        destacado: true,
      };

      const mockCreated = { id: mockServicioId, barberiaId: mockBarberiaId, ...dto, estado: 'ACTIVO' };
      prisma.servicio.create.mockResolvedValue(mockCreated);

      const result = await service.create(mockBarberiaId, dto);

      expect(prisma.servicio.create).toHaveBeenCalledWith({
        data: {
          barberiaId: mockBarberiaId,
          nombre: dto.nombre,
          precio: dto.precio,
          duracionEstimada: dto.duracionEstimada,
          margenOperativo: dto.margenOperativo,
          destacado: dto.destacado,
          estado: 'ACTIVO',
        },
      });
      expect(result).toEqual(mockCreated);
    });
  });

  describe('findAll · el filtro de sede nunca se omite (E1-06)', () => {
    it('acota siempre el where a la sede recibida', async () => {
      prisma.servicio.findMany.mockResolvedValue([]);

      await service.findAll(mockBarberiaId);

      expect(prisma.servicio.findMany).toHaveBeenCalledWith({
        where: { estado: 'ACTIVO', barberiaId: mockBarberiaId },
        orderBy: { nombre: 'asc' },
      });
    });

    it('para cliente devuelve solo ACTIVOS', async () => {
      prisma.servicio.findMany.mockResolvedValue([]);
      const usuario = {
        id: 'u1',
        correo: 'c@test.com',
        roles: ['CLIENTE'],
        rolesDetallados: [],
      } as any;
      await service.findAll(mockBarberiaId, usuario);
      expect(prisma.servicio.findMany).toHaveBeenCalledWith({
        where: { estado: 'ACTIVO', barberiaId: mockBarberiaId },
        orderBy: { nombre: 'asc' },
      });
    });

    it('para ADMIN_BARBERIA de la sede devuelve TODOS (incluye INACTIVOS)', async () => {
      prisma.servicio.findMany.mockResolvedValue([]);
      const usuario = {
        id: 'u2',
        correo: 'a@test.com',
        roles: ['ADMIN_BARBERIA'],
        rolesDetallados: [{
          nombre: 'ADMIN_BARBERIA',
          barberiaId: mockBarberiaId,
          ambito: 'BARBERIA',
        }],
      } as any;
      await service.findAll(mockBarberiaId, usuario);
      expect(prisma.servicio.findMany).toHaveBeenCalledWith({
        where: { barberiaId: mockBarberiaId },
        orderBy: { nombre: 'asc' },
      });
    });

    it('para ADMINISTRADOR global devuelve TODOS', async () => {
      prisma.servicio.findMany.mockResolvedValue([]);
      const usuario = {
        id: 'u3',
        correo: 'g@test.com',
        roles: ['ADMINISTRADOR'],
        rolesDetallados: [],
      } as any;
      await service.findAll(mockBarberiaId, usuario);
      expect(prisma.servicio.findMany).toHaveBeenCalledWith({
        where: { barberiaId: mockBarberiaId },
        orderBy: { nombre: 'asc' },
      });
    });

    it('NO devuelve el catalogo de todas las barberias si la sede llega vacia', async () => {
      prisma.servicio.findMany.mockResolvedValue([]);

      // Antes de E1-06 el filtro se caia a proposito: sin sede devolvia los
      // servicios de TODAS las barberias, que es la fuga que persigue H36.
      await expect(service.findAll(undefined as unknown as string)).rejects.toThrow(
        BadRequestException,
      );

      // Y la garantia que de verdad importa: sin sede no se consulta. Si en
      // algun momento volviera a llamarse a findMany, este test falla.
      expect(prisma.servicio.findMany).not.toHaveBeenCalled();
    });

    it('NO acepta una sede vacia ni solo espacios', async () => {
      prisma.servicio.findMany.mockResolvedValue([]);

      await expect(service.findAll('')).rejects.toThrow(BadRequestException);
      await expect(service.findAll('   ')).rejects.toThrow(BadRequestException);
      expect(prisma.servicio.findMany).not.toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('debe retornar el servicio si existe en la barbería', async () => {
      const mockServicio = { id: mockServicioId, barberiaId: mockBarberiaId, nombre: 'Corte', estado: 'ACTIVO' };
      prisma.servicio.findFirst.mockResolvedValue(mockServicio);

      const result = await service.findOne(mockBarberiaId, mockServicioId);

      expect(result).toEqual(mockServicio);
    });

    it('debe lanzar NotFoundException si el servicio no existe', async () => {
      prisma.servicio.findFirst.mockResolvedValue(null);

      await expect(service.findOne(mockBarberiaId, 'inexistente')).rejects.toThrow(NotFoundException);
    });
  });

  /**
   * E2-07 · D29: las tres reglas de la desactivación y su vuelta atrás. Cada
   * `it` lleva la REGLA que cubre para que el mapa con el backlog sea directo.
   */
  describe('desactivar y reactivar (E2-07 · D29)', () => {
    const activo = { id: mockServicioId, barberiaId: mockBarberiaId, estado: 'ACTIVO' };

    it('REGLA 1 · 409 SERVICIO_EN_USO si hay reservas PENDIENTE o PROPUESTA_PENDIENTE', async () => {
      prisma.servicio.findFirst.mockResolvedValue(activo);
      const mockFecha = new Date('2026-10-15T10:00:00.000Z');
      prisma.reserva.findMany.mockResolvedValue([
        { id: 'reserva-pend-1', fechaCita: mockFecha, horaInicio: mockFecha },
      ]);

      const error = await service.desactivar(mockBarberiaId, mockServicioId).catch((e) => e);

      expect(error.response.statusCode).toBe(409);
      expect(error.response.codigo).toBe('SERVICIO_EN_USO');
      // El filtro pide los DOS estados abiertos del catálogo (E2-02), no un literal.
      expect(prisma.reserva.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            barberiaId: mockBarberiaId,
            estado: { in: ['PENDIENTE', 'PROPUESTA_PENDIENTE'] },
          }),
        }),
      );
      expect(prisma.servicio.update).not.toHaveBeenCalled();
    });

    it('REGLA 2 · 409 SERVICIO_EN_COMBO_ACTIVO con la lista de combos activos', async () => {
      prisma.servicio.findFirst.mockResolvedValue(activo);
      prisma.reserva.findMany.mockResolvedValue([]);
      prisma.combo.findMany.mockResolvedValue([
        { id: 'combo-1', nombre: 'Combo Barba' },
        { id: 'combo-2', nombre: 'Combo VIP' },
      ]);

      const error = await service.desactivar(mockBarberiaId, mockServicioId).catch((e) => e);

      expect(error.response.statusCode).toBe(409);
      expect(error.response.codigo).toBe('SERVICIO_EN_COMBO_ACTIVO');
      expect(error.response.mensaje).toContain('Combo Barba');
      expect(prisma.combo.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ barberiaId: mockBarberiaId, estado: 'ACTIVO' }),
        }),
      );
      expect(prisma.servicio.update).not.toHaveBeenCalled();
    });

    it('REGLA 3 · se permite si no hay reservas abiertas (aunque haya CONFIRMADAS: su snapshot está congelado)', async () => {
      prisma.servicio.findFirst.mockResolvedValue(activo);
      // La consulta solo devuelve PENDIENTE / PROPUESTA_PENDIENTE: las
      // CONFIRMADAS no aparecen y por eso la desactivación es válida.
      prisma.reserva.findMany.mockResolvedValue([]);
      prisma.combo.findMany.mockResolvedValue([]);
      prisma.servicio.update.mockResolvedValue({ ...activo, estado: 'INACTIVO' });

      const result = await service.desactivar(mockBarberiaId, mockServicioId);

      expect(result).toEqual({ ...activo, estado: 'INACTIVO' });
      expect(prisma.servicio.update).toHaveBeenCalledWith({
        where: { id: mockServicioId },
        data: { estado: 'INACTIVO' },
      });
    });

    it('es idempotente: sobre un servicio ya INACTIVO no consulta ni escribe', async () => {
      prisma.servicio.findFirst.mockResolvedValue({ ...activo, estado: 'INACTIVO' });

      const result = await service.desactivar(mockBarberiaId, mockServicioId);

      expect(result.estado).toBe('INACTIVO');
      expect(prisma.reserva.findMany).not.toHaveBeenCalled();
      expect(prisma.combo.findMany).not.toHaveBeenCalled();
      expect(prisma.servicio.update).not.toHaveBeenCalled();
    });

    it('debe propagar NotFoundException si el servicio a desactivar no existe', async () => {
      prisma.servicio.findFirst.mockResolvedValue(null);

      await expect(service.desactivar(mockBarberiaId, 'no-existe')).rejects.toThrow(NotFoundException);
      expect(prisma.reserva.findMany).not.toHaveBeenCalled();
    });

    it('reactivar devuelve el servicio a ACTIVO (y es idempotente si ya lo está)', async () => {
      prisma.servicio.findFirst.mockResolvedValue({ ...activo, estado: 'INACTIVO' });
      prisma.servicio.update.mockResolvedValue(activo);

      const result = await service.reactivar(mockBarberiaId, mockServicioId);

      expect(result).toEqual(activo);
      expect(prisma.servicio.update).toHaveBeenCalledWith({
        where: { id: mockServicioId },
        data: { estado: 'ACTIVO' },
      });

      prisma.servicio.update.mockClear();
      prisma.servicio.findFirst.mockResolvedValue(activo);

      expect(await service.reactivar(mockBarberiaId, mockServicioId)).toEqual(activo);
      expect(prisma.servicio.update).not.toHaveBeenCalled();
    });
  });
});
