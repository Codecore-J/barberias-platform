import { Test, TestingModule } from '@nestjs/testing';
import { BarberiaController } from './barberia.controller.js';
import { BarberiaService } from '../application/barberia.service.js';
import { CreateBarberiaDto } from '../application/dto/create-barberia.dto.js';
import { UpdateBarberiaDto } from '../application/dto/update-barberia.dto.js';
import { VincularBarberiaDto } from '../application/dto/vincular-barberia.dto.js';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { vi } from 'vitest';

describe('BarberiaController', () => {
  let controller: BarberiaController;
  let service: typeof BarberiaService;

  const mockService = {
    create: vi.fn(),
    findAllByResponsable: vi.fn(),
    findAll: vi.fn(),
    findPersonal: vi.fn(),
    findOne: vi.fn(),
    vincularCliente: vi.fn(),
    desvincular: vi.fn(),
    seleccionarBarberiaActiva: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BarberiaController],
      providers: [
        {
          provide: BarberiaService,
          useValue: mockService,
        },
      ],
    }).compile();

    controller = module.get<BarberiaController>(BarberiaController);
    service = module.get(BarberiaService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('create', () => {
    it('debe crear una barbería', async () => {
      const dto: CreateBarberiaDto = {
        nombre: 'Nueva Barbería',
        telefono: '123456789',
        ubicacion: 'Ubicación',
      };
      const user = { id: 'user-123', roles: ['CLIENTE'] } as any;
      const expected = { id: 'barberia-1', nombre: dto.nombre };

      mockService.create.mockResolvedValue(expected);

      const result = await controller.create(dto, user);

      expect(service.create).toHaveBeenCalledWith('user-123', dto);
      expect(result).toEqual(expected);
    });
  });

  describe('findMine', () => {
    it('debe retornar las barberías del responsable', async () => {
      const user = { id: 'user-123', roles: ['CLIENTE'] } as any;
      const expected = [{ id: 'barberia-1', nombre: 'Barbería A' }];

      mockService.findAllByResponsable.mockResolvedValue(expected);

      const result = await controller.findMine(user);

      expect(service.findAllByResponsable).toHaveBeenCalledWith('user-123', user);
      expect(result).toEqual(expected);
    });
  });

  describe('findAll', () => {
    it('debe retornar todas las barberías', async () => {
      const expected = [{ id: 'barberia-1', nombre: 'Barbería A' }];

      mockService.findAll.mockResolvedValue(expected);

      const result = await controller.findAll();

      expect(service.findAll).toHaveBeenCalled();
      expect(result).toEqual(expected);
    });
  });

  describe('findPersonal', () => {
    it('debe retornar el personal de una barbería', async () => {
      const id = 'barberia-1';
      const user = { id: 'user-123', roles: ['ADMIN_BARBERIA'] } as any;
      const expected = [{ id: 'person-1', nombreCompleto: 'Persona' }];

      mockService.findPersonal.mockResolvedValue(expected);

      const result = await controller.findPersonal(id, user);

      expect(service.findPersonal).toHaveBeenCalledWith(id, user);
      expect(result).toEqual(expected);
    });

    it('debe lanzar ForbiddenException si el usuario no tiene acceso', async () => {
      const id = 'barberia-1';
      const user = { id: 'user-123', roles: ['CLIENTE'] } as any;

      mockService.findPersonal.mockRejectedValue(
        new ForbiddenException('No posees el rol ADMIN_BARBERIA ni BARBERO en esa barbería.'),
      );

      await expect(controller.findPersonal(id, user)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('findOne', () => {
    it('debe retornar una barbería por ID', async () => {
      const id = 'barberia-1';
      const user = { id: 'user-123', roles: ['CLIENTE'] } as any;
      const expected = { id, nombre: 'Barbería A' };

      mockService.findOne.mockResolvedValue(expected);

      const result = await controller.findOne(id, user);

      expect(service.findOne).toHaveBeenCalledWith(id, user);
      expect(result).toEqual(expected);
    });

    it('debe lanzar NotFoundException si no existe', async () => {
      const id = 'barberia-invalida';
      const user = { id: 'user-123', roles: ['CLIENTE'] } as any;

      mockService.findOne.mockRejectedValue(new NotFoundException(`Barbería ${id} no encontrada.`));

      await expect(controller.findOne(id, user)).rejects.toThrow(NotFoundException);
    });
  });

  describe('vincular', () => {
    it('debe vincular un cliente a una barbería', async () => {
      const dto: VincularBarberiaDto = { codigoAcceso: 'ABC123' };
      const user = { id: 'user-123', roles: ['CLIENTE'] } as any;
      const expected = { id: 'vinculo-1', estadoVinculacion: 'ACTIVO' };

      mockService.vincularCliente.mockResolvedValue(expected);

      const result = await controller.vincular(dto, user);

      expect(service.vincularCliente).toHaveBeenCalledWith('user-123', dto);
      expect(result).toEqual(expected);
    });
  });

  describe('desvincular', () => {
    it('debe desvincular un cliente de una barbería', async () => {
      const id = 'barberia-1';
      const user = { id: 'user-123', roles: ['CLIENTE'] } as any;
      const expected = { id, estadoVinculacion: 'DESVINCULADO' };

      mockService.desvincular.mockResolvedValue(expected);

      const result = await controller.desvincular(id, user);

      expect(service.desvincular).toHaveBeenCalledWith('user-123', id);
      expect(result).toEqual(expected);
    });

    it('debe lanzar NotFoundException si no hay vínculo', async () => {
      const id = 'barberia-1';
      const user = { id: 'user-123', roles: ['CLIENTE'] } as any;

      mockService.desvincular.mockRejectedValue(new NotFoundException('No tienes vínculo con esta barbería.'));

      await expect(controller.desvincular(id, user)).rejects.toThrow(NotFoundException);
    });
  });

  describe('seleccionarActiva', () => {
    it('debe seleccionar una barbería como activa', async () => {
      const id = 'barberia-1';
      const user = { id: 'user-123', roles: ['CLIENTE'] } as any;
      const expected = { usuarioId: 'user-123', barberiaId: id, esBarberiaActiva: true };

      mockService.seleccionarBarberiaActiva.mockResolvedValue(expected);

      const result = await controller.seleccionarActiva(id, user);

      expect(service.seleccionarBarberiaActiva).toHaveBeenCalledWith('user-123', id, user);
      expect(result).toEqual(expected);
    });
  });

  describe('update', () => {
    it('debe actualizar una barbería', async () => {
      const id = 'barberia-1';
      const dto: UpdateBarberiaDto = { nombre: 'Nombre Actualizado' };
      const user = { id: 'user-123', roles: ['ADMINISTRADOR'] } as any;
      const expected = { id, nombre: 'Nombre Actualizado' };

      mockService.update.mockResolvedValue(expected);

      const result = await controller.update(id, dto, user);

      expect(service.update).toHaveBeenCalledWith(id, 'user-123', dto, true);
      expect(result).toEqual(expected);
    });
  });

  describe('remove', () => {
    it('debe eliminar (soft-delete) una barbería', async () => {
      const id = 'barberia-1';
      const user = { id: 'user-123', roles: ['ADMINISTRADOR'] } as any;

      mockService.remove.mockResolvedValue(undefined);

      const result = await controller.remove(id, user);

      expect(service.remove).toHaveBeenCalledWith(id, 'user-123', true);
      expect(result).toBeUndefined();
    });
  });
});
