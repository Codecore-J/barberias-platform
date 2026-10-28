import { Test, TestingModule } from '@nestjs/testing';
import { vi } from 'vitest';
import { BarberiaController } from './barberia.controller.js';
import { BarberiaService } from '../application/barberia.service.js';
import { SolicitudCambioService } from '../application/solicitud-cambio.service.js';
import { AnalyticsService } from '../../analytics/application/analytics.service.js';
import { UsuarioAutenticado } from '../../iam/domain/jwt.interface.js';

describe('BarberiaController', () => {
  let controller: BarberiaController;
  let service: BarberiaService;
  let solicitudCambio: SolicitudCambioService;
  let analytics: AnalyticsService;

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
            cambiarEstado: vi.fn(),
            vincularCliente: vi.fn(),
            seleccionarBarberiaActiva: vi.fn(),
            findPersonal: vi.fn(),
          },
        },
        {
          provide: SolicitudCambioService,
          useValue: { crearSolicitud: vi.fn(), listar: vi.fn(), resolver: vi.fn() },
        },
        {
          provide: AnalyticsService,
          useValue: { getShopsOverview: vi.fn().mockResolvedValue({ ok: true }) },
        },
      ],
    }).compile();

    controller = module.get<BarberiaController>(BarberiaController);
    service = module.get<BarberiaService>(BarberiaService);
    solicitudCambio = module.get<SolicitudCambioService>(SolicitudCambioService);
    analytics = module.get<AnalyticsService>(AnalyticsService);
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
        // E1-06: se pasa también la sesión, para que el servicio resuelva el
        // ADMINISTRADOR global sin volver a consultar `usuario_roles`.
        expect(service.seleccionarBarberiaActiva).toHaveBeenCalledWith(user.id, 'uuid-barberia', user);
    });
  });

  describe('findPersonal (E1-03 · H19)', () => {
    it('debe pasar el usuario actual al servicio para validar pertenencia', async () => {
      const user: UsuarioAutenticado = { id: 'uuid-user', correo: 'test@test.com', roles: [] };

      await controller.findPersonal('uuid-barberia', user);

      expect(service.findPersonal).toHaveBeenCalledWith('uuid-barberia', user);
    });
  });

  describe('E3-13 · crearSolicitudCambio', () => {
    it('delega en el servicio con la sede del parámetro y la sesión', async () => {
      const user: UsuarioAutenticado = {
        id: 'uuid-admin',
        correo: 'admin@test.com',
        roles: ['ADMIN_BARBERIA'],
      };
      const dto = { tipo: 'NOMBRE', valorNuevo: 'Barbería Nueva' } as any;

      await controller.crearSolicitudCambio('uuid-barberia', dto, user);

      expect(solicitudCambio.crearSolicitud).toHaveBeenCalledWith('uuid-barberia', user, dto);
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

    it('cambiarEstado debe marcar esGlobal=true a un ADMINISTRADOR (E2-07)', async () => {
      const user: UsuarioAutenticado = {
        id: 'uuid-global',
        correo: 'global@test.com',
        roles: ['ADMINISTRADOR'],
      };

      await controller.cambiarEstado('uuid-barberia', { estado: 'INACTIVO' }, user);

      expect(service.cambiarEstado).toHaveBeenCalledWith('uuid-barberia', user.id, 'INACTIVO', true);
    });

    it('cambiarEstado NO debe marcar esGlobal a un ADMIN_BARBERIA (E2-07)', async () => {
      const user: UsuarioAutenticado = {
        id: 'uuid-admin',
        correo: 'admin@test.com',
        roles: ['ADMIN_BARBERIA'],
      };

      await controller.cambiarEstado('uuid-barberia', { estado: 'ACTIVO' }, user);

      expect(service.cambiarEstado).toHaveBeenCalledWith('uuid-barberia', user.id, 'ACTIVO', false);
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

    it('cambiarEstado debe marcar esGlobal=true a un ADMINISTRADOR (E2-07)', async () => {
      const user: UsuarioAutenticado = {
        id: 'uuid-global',
        correo: 'global@test.com',
        roles: ['ADMINISTRADOR'],
      };

      await controller.cambiarEstado('uuid-barberia', { estado: 'INACTIVO' }, user);

      expect(service.cambiarEstado).toHaveBeenCalledWith('uuid-barberia', user.id, 'INACTIVO', true);
    });

    it('cambiarEstado NO debe marcar esGlobal a un ADMIN_BARBERIA (E2-07)', async () => {
      const user: UsuarioAutenticado = {
        id: 'uuid-admin',
        correo: 'admin@test.com',
        roles: ['ADMIN_BARBERIA'],
      };

      await controller.cambiarEstado('uuid-barberia', { estado: 'ACTIVO' }, user);

      expect(service.cambiarEstado).toHaveBeenCalledWith('uuid-barberia', user.id, 'ACTIVO', false);
    });
  });

  describe('GET /shops/overview (E4-04)', () => {
    /**
     * Regresión del 400 real medido en producción: `overview` entraba por
     * `@Get(':shopId')` porque el handler vivía en un controlador que se
     * registraba después. Express resuelve por orden de declaración, así que la
     * ruta estática tiene que estar ANTES del comodín en el prototipo.
     */
    it('declara la ruta estática antes que el comodín :shopId', () => {
      const metodos = Object.getOwnPropertyNames(BarberiaController.prototype);
      expect(metodos.indexOf('obtenerOverview')).toBeGreaterThanOrEqual(0);
      expect(metodos.indexOf('obtenerOverview')).toBeLessThan(metodos.indexOf('findOne'));
    });

    it('delega en el servicio con el usuario y el rango, sin marcar esGlobal a un ADMIN_BARBERIA', async () => {
      const user: UsuarioAutenticado = {
        id: 'uuid-admin-sede',
        correo: 'sede@test.com',
        roles: ['ADMIN_BARBERIA'],
      };

      const result = await controller.obtenerOverview(
        { desde: '2026-10-01', hasta: '2026-10-31' } as any,
        user,
      );

      expect(result).toEqual({ ok: true });
      expect(analytics.getShopsOverview).toHaveBeenCalledWith(
        user,
        '2026-10-01',
        '2026-10-31',
        false,
      );
    });

    it('marca esGlobal true para ADMINISTRADOR', async () => {
      const user: UsuarioAutenticado = {
        id: 'uuid-global',
        correo: 'global@test.com',
        roles: ['ADMINISTRADOR'],
      };

      await controller.obtenerOverview({} as any, user);

      expect(analytics.getShopsOverview).toHaveBeenCalledWith(user, undefined, undefined, true);
    });
  });
});
