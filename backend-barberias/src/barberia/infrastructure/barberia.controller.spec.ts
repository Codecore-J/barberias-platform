import { Test, TestingModule } from '@nestjs/testing';
import { vi } from 'vitest';
import { BarberiaController } from './barberia.controller.js';
import { BarberiaService } from '../application/barberia.service.js';
import { UsuarioAutenticado } from '../../iam/domain/jwt.interface.js';

describe('BarberiaController', () => {
  let controller: BarberiaController;
  let service: BarberiaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BarberiaController],
      providers: [
        {
          provide: BarberiaService,
          useValue: {
            create: vi.fn(),
            findAllByResponsable: vi.fn(),
            findAll: vi.fn(),
            findOne: vi.fn(),
            update: vi.fn(),
            remove: vi.fn(),
            vincularCliente: vi.fn(),
            seleccionarBarberiaActiva: vi.fn(),
            findPersonal: vi.fn(),
            update: vi.fn(),
            remove: vi.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<BarberiaController>(BarberiaController);
    service = module.get<BarberiaService>(BarberiaService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('create', () => {
    it('debe llamar a service.create con el ID del usuario actual', async () => {
      const user: UsuarioAutenticado = { id: 'uuid-user', correo: 'test@test.com', roles: [] };
      const dto = { nombre: 'Barber Test', telefono: '123', ubicacion: 'Calle 1' };
      
      (service.create as any).mockResolvedValue({ id: 'uuid-barberia', ...dto });

      const result = await controller.create(dto as any, user);
      
      expect(service.create).toHaveBeenCalledWith(user.id, dto);
      expect(result.id).toBeDefined();
    });
  });

  describe('findMine', () => {
    it('debe llamar a findAllByResponsable con el id y la sesion (E1-07)', async () => {
        const user: UsuarioAutenticado = { id: 'uuid-user', correo: 'test@test.com', roles: [] };
        await controller.findMine(user);
        expect(service.findAllByResponsable).toHaveBeenCalledWith(user.id, user);
    });
  });

  describe('vincular', () => {
    it('debe llamar a vincularCliente del servicio', async () => {
        const user: UsuarioAutenticado = { id: 'uuid-user', correo: 'test@test.com', roles: [] };
        const dto = { codigoAcceso: 'ABC12345' };
        await controller.vincular(dto, user);
        expect(service.vincularCliente).toHaveBeenCalledWith(user.id, dto);
    });
  });

  describe('seleccionarActiva', () => {
    it('debe llamar a seleccionarBarberiaActiva del servicio', async () => {
        const user: UsuarioAutenticado = { id: 'uuid-user', correo: 'test@test.com', roles: [] };
        await controller.seleccionarActiva('uuid-barberia', user);
        expect(service.seleccionarBarberiaActiva).toHaveBeenCalledWith(user.id, 'uuid-barberia');
    });
  });

  describe('findPersonal (E1-03 · H19)', () => {
    it('debe pasar el usuario actual al servicio para validar pertenencia', async () => {
      const user: UsuarioAutenticado = { id: 'uuid-user', correo: 'test@test.com', roles: [] };

      await controller.findPersonal('uuid-barberia', user);

      expect(service.findPersonal).toHaveBeenCalledWith('uuid-barberia', user);
    });
  });

  describe('E1-04: ADMINISTRADOR frente al rol global inexistente', () => {
    it('update debe marcar esGlobal=true a un ADMINISTRADOR', async () => {
      const user: UsuarioAutenticado = {
        id: 'uuid-global',
        correo: 'global@test.com',
        roles: ['ADMINISTRADOR'],
      };

      await controller.update('uuid-barberia', { nombre: 'Nuevo' } as any, user);

      expect(service.update).toHaveBeenCalledWith('uuid-barberia', user.id, { nombre: 'Nuevo' }, true);
    });

    it('update NO debe marcar esGlobal a un ADMIN_BARBERIA', async () => {
      const user: UsuarioAutenticado = {
        id: 'uuid-admin',
        correo: 'admin@test.com',
        roles: ['ADMIN_BARBERIA'],
      };

      await controller.update('uuid-barberia', { nombre: 'Nuevo' } as any, user);

      expect(service.update).toHaveBeenCalledWith('uuid-barberia', user.id, { nombre: 'Nuevo' }, false);
    });

    it('remove debe marcar esGlobal=true a un ADMINISTRADOR', async () => {
      const user: UsuarioAutenticado = {
        id: 'uuid-global',
        correo: 'global@test.com',
        roles: ['ADMINISTRADOR'],
      };

      await controller.remove('uuid-barberia', user);

      expect(service.remove).toHaveBeenCalledWith('uuid-barberia', user.id, true);
    });
  });
});
