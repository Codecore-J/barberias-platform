import { Test, TestingModule } from '@nestjs/testing';
import { vi } from 'vitest';
import { BarberiaService } from './barberia.service.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import type { UsuarioAutenticado } from '../../iam/domain/jwt.interface.js';

const BARBERIA_A = 'barberia-a';
const BARBERIA_B = 'barberia-b';

const CLIENTE: UsuarioAutenticado = {
  id: 'usuario-cliente',
  correo: 'cliente@test.com',
  roles: ['CLIENTE'],
  rolesDetallados: [{ nombre: 'CLIENTE', barberiaId: BARBERIA_A, ambito: 'BARBERIA' }],
};

const ADMIN_A: UsuarioAutenticado = {
  id: 'usuario-admin-a',
  correo: 'admin.a@test.com',
  roles: ['ADMIN_BARBERIA'],
  rolesDetallados: [{ nombre: 'ADMIN_BARBERIA', barberiaId: BARBERIA_A, ambito: 'BARBERIA' }],
};

const ADMIN_B: UsuarioAutenticado = {
  id: 'usuario-admin-b',
  correo: 'admin.b@test.com',
  roles: ['ADMIN_BARBERIA'],
  rolesDetallados: [{ nombre: 'ADMIN_BARBERIA', barberiaId: BARBERIA_B, ambito: 'BARBERIA' }],
};

const ADMINISTRADOR: UsuarioAutenticado = {
  id: 'usuario-global',
  correo: 'global@test.com',
  roles: ['ADMINISTRADOR'],
  rolesDetallados: [{ nombre: 'ADMINISTRADOR', barberiaId: null, ambito: 'GLOBAL' }],
};

const BARBERO_A: UsuarioAutenticado = {
  id: 'usuario-barbero-a',
  correo: 'barbero.a@test.com',
  roles: ['BARBERO'],
  rolesDetallados: [{ nombre: 'BARBERO', barberiaId: BARBERIA_A, ambito: 'BARBERIA' }],
};

const BARBERO_B: UsuarioAutenticado = {
  id: 'usuario-barbero-b',
  correo: 'barbero.b@test.com',
  roles: ['BARBERO'],
  rolesDetallados: [{ nombre: 'BARBERO', barberiaId: BARBERIA_B, ambito: 'BARBERIA' }],
};

/** ADMIN_BARBERIA con barberia_id nulo: la fila corrupta que E1-04 corrige. */
const ADMIN_BARBERIA_SIN_BARBERIA: UsuarioAutenticado = {
  id: 'usuario-admin-sin-barberia',
  correo: 'admin.sin.barberia@test.com',
  roles: ['ADMIN_BARBERIA'],
  rolesDetallados: [{ nombre: 'ADMIN_BARBERIA', barberiaId: null, ambito: 'BARBERIA' }],
};

/** Fila de usuario_roles tal y como la devuelve Prisma. */
function filaRol(usuarioId: string, nombreRol: string, barberiaId = BARBERIA_B) {
  return {
    barberiaId,
    usuario: {
      id: usuarioId,
      nombreCompleto: 'Persona',
      correo: `${usuarioId}@test.com`,
      telefono: '600000000',
      estadoCuenta: 'ACTIVO',
    },
    rol: { nombre: nombreRol },
  };
}

describe('BarberiaService', () => {
  let service: BarberiaService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BarberiaService,
        {
          provide: PrismaService,
          useValue: {
            $transaction: vi.fn().mockImplementation(async (cb) => {
              return await cb(prisma); // Mocking the transaction execution
            }),
            usuario: {
              findUnique: vi.fn(),
            },
            barberia: {
              create: vi.fn(),
              findMany: vi.fn(),
              findUnique: vi.fn(),
              update: vi.fn(),
            },
            rol: {
              findUnique: vi.fn(),
            },
            usuarioRol: {
              upsert: vi.fn(),
              findMany: vi.fn(),
              // E1-06: `seleccionarBarberiaActiva` admite el vínculo por rol
              findFirst: vi.fn(),
            },
            configuracionBarberia: {
              create: vi.fn(),
            },
            clienteBarberia: {
              findUnique: vi.fn(),
              count: vi.fn(),
              create: vi.fn(),
              updateMany: vi.fn(),
              update: vi.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get<BarberiaService>(BarberiaService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findOne', () => {
    const mockBarberia = {
      id: 'uuid-1',
      nombre: 'Barberia 1',
      responsableId: 'res-1',
      codigoAcceso: 'CODIGO1',
      enlaceUnico: 'enlace-1',
    };

    it('debe retornar la barberia si existe, sin codigo de acceso a un CLIENTE', async () => {
      (prisma.barberia.findUnique as any).mockResolvedValue(mockBarberia);

      const result = await service.findOne('uuid-1', {
        id: 'cli-1',
        correo: 'cli@demo.com',
        roles: ['CLIENTE'],
        rolesDetallados: [{ nombre: 'CLIENTE', barberiaId: null, ambito: 'GLOBAL' }],
      });

      expect(result.id).toBe(mockBarberia.id);
      expect(result.nombre).toBe(mockBarberia.nombre);
      expect((result as any).codigoAcceso).toBeUndefined();
      expect((result as any).enlaceUnico).toBeUndefined();
    });

    it('debe incluir codigoAcceso y enlaceUnico al ADMIN_BARBERIA de esa barberia', async () => {
      (prisma.barberia.findUnique as any).mockResolvedValue(mockBarberia);

      const result = await service.findOne('uuid-1', {
        id: 'adm-1',
        correo: 'adm@demo.com',
        roles: ['ADMIN_BARBERIA'],
        rolesDetallados: [{ nombre: 'ADMIN_BARBERIA', barberiaId: 'uuid-1', ambito: 'BARBERIA' }],
      });

      expect((result as any).codigoAcceso).toBe('CODIGO1');
      expect((result as any).enlaceUnico).toBe('enlace-1');
    });

    it('debe incluir codigoAcceso y enlaceUnico al ADMINISTRADOR global', async () => {
      (prisma.barberia.findUnique as any).mockResolvedValue(mockBarberia);

      const result = await service.findOne('uuid-1', {
        id: 'adm-2',
        correo: 'adm2@demo.com',
        roles: ['ADMINISTRADOR'],
        rolesDetallados: [{ nombre: 'ADMINISTRADOR', barberiaId: null, ambito: 'GLOBAL' }],
      });

      expect((result as any).codigoAcceso).toBe('CODIGO1');
    });

    it('debe arrojar NotFoundException si no existe', async () => {
      (prisma.barberia.findUnique as any).mockResolvedValue(null);
      await expect(service.findOne('uuid-invalid', {
        id: 'cli-1',
        correo: 'cli@demo.com',
        roles: ['CLIENTE'],
      })).rejects.toThrow(NotFoundException);
    });
  });

  /**
   * Casos negativos de `findOne` (E1-05, seguimiento).
   *
   * La regla es una sola: `codigoAcceso` y `enlaceUnico` —la puerta de
   * entrada— solo salen para el ADMIN_BARBERIA de ESA barbería y el
   * ADMINISTRADOR global. Estos casos fijan por escrito los caminos por los que
   * un usuario NO los recibe, para que nadie los abra por refactor.
   */
  describe('findOne · quién NO recibe el código de acceso', () => {
    const SEDE = BARBERIA_B;
    const mockSede = {
      id: SEDE,
      nombre: 'Barberia B',
      descripcion: null,
      telefono: '8095555555',
      ubicacion: 'Santo Domingo',
      responsableId: 'usuario-admin-b',
      codigoAcceso: 'CODIGOB',
      enlaceUnico: 'enlace-b',
      estado: 'ACTIVO',
    };

    /** CLIENTE vinculado a la sede: el vínculo no le da la puerta de entrada. */
    const CLIENTE_VINCULADO: UsuarioAutenticado = {
      id: 'usuario-cliente-vinculado',
      correo: 'cliente.vinculado@test.com',
      roles: ['CLIENTE'],
      rolesDetallados: [{ nombre: 'CLIENTE', barberiaId: SEDE, ambito: 'BARBERIA' }],
    };

    beforeEach(() => {
      (prisma.barberia.findUnique as any).mockResolvedValue(mockSede);
    });

    it('no se lo entrega a un ADMIN_BARBERIA de OTRA barbería', async () => {
      const result = await service.findOne(SEDE, ADMIN_A);

      expect((result as any).codigoAcceso).toBeUndefined();
      expect((result as any).enlaceUnico).toBeUndefined();
      expect(result.id).toBe(SEDE);
      expect(JSON.stringify(result)).not.toContain('CODIGOB');
      expect(JSON.stringify(result)).not.toContain('enlace-b');
    });

    it('no se lo entrega a un ADMIN_BARBERIA sin sede (fila corrupta de E1-04)', async () => {
      const result = await service.findOne(SEDE, ADMIN_BARBERIA_SIN_BARBERIA);

      expect((result as any).codigoAcceso).toBeUndefined();
      expect((result as any).enlaceUnico).toBeUndefined();
    });

    it('no se lo entrega a un BARBERO, ni siquiera el de esa misma barbería', async () => {
      const result = await service.findOne(SEDE, BARBERO_B);

      expect((result as any).codigoAcceso).toBeUndefined();
      expect((result as any).enlaceUnico).toBeUndefined();
      expect(result.nombre).toBe('Barberia B');
    });

    it('no se lo entrega a un BARBERO de otra barbería', async () => {
      const result = await service.findOne(SEDE, BARBERO_A);

      expect((result as any).codigoAcceso).toBeUndefined();
      expect((result as any).enlaceUnico).toBeUndefined();
    });

    it('no se lo entrega a un CLIENTE vinculado a esa barbería', async () => {
      const result = await service.findOne(SEDE, CLIENTE_VINCULADO);

      expect((result as any).codigoAcceso).toBeUndefined();
      expect((result as any).enlaceUnico).toBeUndefined();
    });

    it('no truena ni lo entrega cuando el token viene sin roles detallados', async () => {
      const result = await service.findOne(SEDE, {
        id: 'usuario-sin-detalle',
        correo: 'sin.detalle@test.com',
        roles: ['CLIENTE'],
      });

      expect((result as any).codigoAcceso).toBeUndefined();
      expect(result.id).toBe(SEDE);
    });

    it('la lectura sin código expone exactamente los campos públicos acordados', async () => {
      const result = await service.findOne(SEDE, CLIENTE_VINCULADO);

      // `responsableId` se mantiene porque el frontend lo usa para identificar a
      // la sede: si algún día se quita, este test debe romperse a propósito.
      expect(Object.keys(result).sort()).toEqual(
        ['descripcion', 'estado', 'id', 'nombre', 'responsableId', 'telefono', 'ubicacion'].sort(),
      );
    });
  });

  describe('update', () => {
    it('debe arrojar ForbiddenException si no es super admin ni responsable', async () => {
      const mockBarberia = { id: 'uuid-1', nombre: 'Barberia 1', responsableId: 'res-1' };
      (prisma.barberia.findUnique as any).mockResolvedValue(mockBarberia);

      await expect(service.update('uuid-1', 'other-user', {}, false)).rejects.toThrow(ForbiddenException);
    });    it('debe permitir si es responsable', async () => {
        const mockBarberia = { id: 'uuid-1', nombre: 'Barberia 1', responsableId: 'res-1' };
        (prisma.barberia.findUnique as any).mockResolvedValue(mockBarberia);
        (prisma.barberia.update as any).mockResolvedValue({ ...mockBarberia, nombre: 'Updated' });
  
        const result = await service.update('uuid-1', 'res-1', { nombre: 'Updated' }, false);
        expect(result.nombre).toBe('Updated');
    });

    it('E1-04: el ADMINISTRADOR puede editar una barbería ajena', async () => {
      const mockBarberia = { id: 'uuid-1', nombre: 'Barberia 1', responsableId: 'otro-res' };
      (prisma.barberia.findUnique as any).mockResolvedValue(mockBarberia);
      (prisma.barberia.update as any).mockResolvedValue({ ...mockBarberia, nombre: 'Renombrada' });

      const result = await service.update('uuid-1', 'admin-global', { nombre: 'Renombrada' }, true);

      expect(prisma.barberia.update).toHaveBeenCalled();
      expect(result.nombre).toBe('Renombrada');
    });
  });

  /**
   * E1-07. `GET /barberias` (findMine) devolvía `toResponse` —con `codigoAcceso`
   * y `enlaceUnico`— filtrando solo por `responsableId`, sin mirar el rol, así
   * que la regla de E1-05 solo estaba escrita en `findOne`. Aquí se exige la
   * misma regla que en la lectura por id, sede a sede.
   */
  describe('findAllByResponsable · E1-07', () => {
    const SEDE = 'barberia-z';
    const mockSede = {
      id: SEDE,
      nombre: 'Barberia Z',
      descripcion: null,
      telefono: '8095555555',
      ubicacion: 'Santiago',
      responsableId: 'usuario-z',
      codigoAcceso: 'CODIGOZ',
      enlaceUnico: 'enlace-z',
      estado: 'ACTIVO',
    };

    /** Responsable de la sede con su fila de ADMIN_BARBERIA: el caso normal. */
    const RESPONSABLE_ADMIN: UsuarioAutenticado = {
      id: 'usuario-z',
      correo: 'admin.z@test.com',
      roles: ['ADMIN_BARBERIA'],
      rolesDetallados: [{ nombre: 'ADMIN_BARBERIA', barberiaId: SEDE, ambito: 'BARBERIA' }],
    };

    /**
     * `responsableId` de la sede pero SIN fila `usuario_roles`: la corruption que
     * ya se dio en E1-04. El filtro `where: { responsableId }` lo deja pasar, así
     * que era la única forma de que la lista entregara el código sin ser admin.
     */
    const RESPONSABLE_SIN_ROL: UsuarioAutenticado = {
      id: 'usuario-z',
      correo: 'admin.z@test.com',
      roles: ['CLIENTE'],
      rolesDetallados: [{ nombre: 'CLIENTE', barberiaId: null, ambito: 'GLOBAL' }],
    };

    beforeEach(() => {
      (prisma.barberia.findMany as any).mockResolvedValue([mockSede]);
    });

    it('filtra igual que antes, por responsableId', async () => {
      await service.findAllByResponsable('usuario-z', RESPONSABLE_ADMIN);

      expect(prisma.barberia.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { responsableId: 'usuario-z' } }),
      );
    });

    it('entrega el código al responsable que sí es ADMIN_BARBERIA de esa sede', async () => {
      const result = await service.findAllByResponsable('usuario-z', RESPONSABLE_ADMIN);

      expect(result).toHaveLength(1);
      expect((result[0] as any).codigoAcceso).toBe('CODIGOZ');
      expect((result[0] as any).enlaceUnico).toBe('enlace-z');
    });

    it('NO entrega el código al responsable sin fila de ADMIN_BARBERIA', async () => {
      const result = await service.findAllByResponsable('usuario-z', RESPONSABLE_SIN_ROL);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(SEDE);
      expect((result[0] as any).codigoAcceso).toBeUndefined();
      expect((result[0] as any).enlaceUnico).toBeUndefined();
      expect(JSON.stringify(result)).not.toContain('CODIGOZ');
    });

    it('aplica la regla sede a sede dentro de la misma lista', async () => {
      (prisma.barberia.findMany as any).mockResolvedValue([
        mockSede,
        {
          ...mockSede,
          id: 'barberia-w',
          nombre: 'Barberia W',
          responsableId: 'usuario-z',
          codigoAcceso: 'CODIGOW',
          enlaceUnico: 'enlace-w',
        },
      ]);

      // ADMIN_BARBERIA de una sola de las dos sedes: solo esa entrega el código.
      const result = await service.findAllByResponsable('usuario-z', {
        id: 'usuario-z',
        correo: 'admin.z@test.com',
        roles: ['ADMIN_BARBERIA'],
        rolesDetallados: [{ nombre: 'ADMIN_BARBERIA', barberiaId: SEDE, ambito: 'BARBERIA' }],
      });

      expect(result).toHaveLength(2);
      expect((result[0] as any).codigoAcceso).toBe('CODIGOZ');
      expect((result[1] as any).codigoAcceso).toBeUndefined();
      expect((result[1] as any).enlaceUnico).toBeUndefined();
    });

    it('el ADMINISTRADOR global recibe el código de todas las sedes de la lista', async () => {
      (prisma.barberia.findMany as any).mockResolvedValue([
        mockSede,
        { ...mockSede, id: 'barberia-w', codigoAcceso: 'CODIGOW', enlaceUnico: 'enlace-w' },
      ]);

      const result = await service.findAllByResponsable('usuario-z', ADMINISTRADOR);

      expect(result).toHaveLength(2);
      expect((result[0] as any).codigoAcceso).toBe('CODIGOZ');
      expect((result[1] as any).codigoAcceso).toBe('CODIGOW');
    });
  });

  describe('remove (soft-delete)', () => {
      it('debe actualizar el estado a INACTIVO', async () => {
        const mockBarberia = { id: 'uuid-1', nombre: 'Barberia 1', responsableId: 'res-1' };
        (prisma.barberia.findUnique as any).mockResolvedValue(mockBarberia);
        (prisma.barberia.update as any).mockResolvedValue({ ...mockBarberia, estado: 'INACTIVO' });
  
        await service.remove('uuid-1', 'res-1', false);
        expect(prisma.barberia.update).toHaveBeenCalledWith({
            where: { id: 'uuid-1' },
            data: { estado: 'INACTIVO' }
        });
      });
  });

  describe('vincularCliente (T2.2)', () => {
    it('debe vincular al cliente con estado ACTIVO y esBarberiaActiva true si es la primera', async () => {
      const mockBarberia = { id: 'barberia-1', codigoAcceso: 'ABC12345', estado: 'ACTIVO' };
      (prisma.barberia.findUnique as any).mockResolvedValue(mockBarberia);
      (prisma.clienteBarberia.findUnique as any).mockResolvedValue(null);
      (prisma.clienteBarberia.count as any).mockResolvedValue(0); // 0 previas
      const mockCreated = { usuarioId: 'user-1', barberiaId: 'barberia-1', estadoVinculacion: 'ACTIVO', esBarberiaActiva: true };
      (prisma.clienteBarberia.create as any).mockResolvedValue(mockCreated);

      const result = await service.vincularCliente('user-1', { codigoAcceso: 'ABC12345' });
      expect(result.estadoVinculacion).toBe('ACTIVO');
      expect(result.esBarberiaActiva).toBe(true);
    });

    it('debe vincular al cliente con estado PENDIENTE_APROBACION si ya tiene 5 o más vinculaciones', async () => {
      const mockBarberia = { id: 'barberia-1', codigoAcceso: 'ABC12345', estado: 'ACTIVO' };
      (prisma.barberia.findUnique as any).mockResolvedValue(mockBarberia);
      (prisma.clienteBarberia.findUnique as any).mockResolvedValue(null);
      (prisma.clienteBarberia.count as any).mockResolvedValue(5); // 5 previas
      const mockCreated = { usuarioId: 'user-1', barberiaId: 'barberia-1', estadoVinculacion: 'PENDIENTE_APROBACION', esBarberiaActiva: false };
      (prisma.clienteBarberia.create as any).mockResolvedValue(mockCreated);

      const result = await service.vincularCliente('user-1', { codigoAcceso: 'ABC12345' });
      expect(result.estadoVinculacion).toBe('PENDIENTE_APROBACION');
      expect(result.esBarberiaActiva).toBe(false);
    });
  });

  describe('findPersonal (E1-03 · H19)', () => {
    beforeEach(() => {
      (prisma.usuarioRol.findMany as any).mockResolvedValue([]);
    });

    it('debe rechazar a un CLIENTE antes de leer nada', async () => {
      await expect(service.findPersonal(BARBERIA_B, CLIENTE)).rejects.toThrow(ForbiddenException);
      expect(prisma.usuarioRol.findMany).not.toHaveBeenCalled();
    });

    it('debe rechazar a un ADMIN de otra barbería antes de leer nada', async () => {
      await expect(service.findPersonal(BARBERIA_B, ADMIN_A)).rejects.toThrow(ForbiddenException);
      expect(prisma.usuarioRol.findMany).not.toHaveBeenCalled();
    });

    it('debe listar el personal al ADMIN de esa barbería, con correo y teléfono', async () => {
      (prisma.usuarioRol.findMany as any).mockResolvedValue([
        filaRol('barbero-1', 'BARBERO'),
        filaRol('admin-1', 'ADMIN_BARBERIA'),
      ]);

      const result = await service.findPersonal(BARBERIA_B, ADMIN_B);

      expect(prisma.usuarioRol.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { barberiaId: BARBERIA_B } }),
      );
      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        id: 'barbero-1',
        correo: 'barbero-1@test.com',
        telefono: '600000000',
        roles: ['BARBERO'],
      });
    });

    it('debe dejar pasar al ADMINISTRADOR global (regla global) con correo y teléfono', async () => {
      (prisma.usuarioRol.findMany as any).mockResolvedValue([filaRol('admin-1', 'ADMIN_BARBERIA')]);

      const result = await service.findPersonal(BARBERIA_B, ADMINISTRADOR);

      expect(result).toHaveLength(1);
      expect(result[0].correo).toBe('admin-1@test.com');
      expect(result[0].telefono).toBe('600000000');
    });

    it('debe devolver el personal al BARBERO de esa barbería, sin correo ni teléfono', async () => {
      (prisma.usuarioRol.findMany as any).mockResolvedValue([
        filaRol('barbero-1', 'BARBERO'),
        filaRol('admin-1', 'ADMIN_BARBERIA'),
      ]);

      const result = await service.findPersonal(BARBERIA_B, BARBERO_B);

      expect(prisma.usuarioRol.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { barberiaId: BARBERIA_B } }),
      );
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: 'barbero-1',
        nombreCompleto: 'Persona',
        estado: 'ACTIVO',
        roles: ['BARBERO'],
      });
      expect(result[0]).not.toHaveProperty('correo');
      expect(result[0]).not.toHaveProperty('telefono');
      expect(JSON.stringify(result)).not.toContain('@test.com');
      expect(JSON.stringify(result)).not.toContain('600000000');
    });

    it('debe rechazar a un BARBERO de otra barbería antes de leer nada', async () => {
      (prisma.usuarioRol.findMany as any).mockResolvedValue([filaRol('barbero-1', 'BARBERO')]);

      await expect(service.findPersonal(BARBERIA_B, BARBERO_A)).rejects.toThrow(ForbiddenException);

      expect(prisma.usuarioRol.findMany).not.toHaveBeenCalled();
    });

    it('E1-04: un ADMIN_BARBERIA con barberiaId nulo ya no es comodín', async () => {
      (prisma.usuarioRol.findMany as any).mockResolvedValue([filaRol('admin-1', 'ADMIN_BARBERIA')]);

      await expect(
        service.findPersonal(BARBERIA_B, ADMIN_BARBERIA_SIN_BARBERIA),
      ).rejects.toThrow(ForbiddenException);

      expect(prisma.usuarioRol.findMany).not.toHaveBeenCalled();
    });
  });

  describe('seleccionarBarberiaActiva (T2.3)', () => {
    it('debe desactivar las demás barberías y activar la seleccionada', async () => {
      const mockVinculacion = { usuarioId: 'user-1', barberiaId: 'barberia-1', estadoVinculacion: 'ACTIVO', esBarberiaActiva: false };
      (prisma.clienteBarberia.findUnique as any).mockResolvedValue(mockVinculacion);
      (prisma.clienteBarberia.updateMany as any).mockResolvedValue({ count: 1 });
      (prisma.clienteBarberia.update as any).mockResolvedValue({ ...mockVinculacion, esBarberiaActiva: true });

      const result = await service.seleccionarBarberiaActiva('user-1', 'barberia-1');

      expect(prisma.clienteBarberia.updateMany).toHaveBeenCalledWith({
        where: { usuarioId: 'user-1' },
        data: { esBarberiaActiva: false },
      });
      expect(prisma.clienteBarberia.update).toHaveBeenCalledWith({
        where: { uk_cliente_barberia: { usuarioId: 'user-1', barberiaId: 'barberia-1' } },
        data: { esBarberiaActiva: true },
      });
      expect(result.esBarberiaActiva).toBe(true);
    });

    it('debe arrojar ForbiddenException si la vinculación está en PENDIENTE_APROBACION', async () => {
      const mockVinculacion = { usuarioId: 'user-1', barberiaId: 'barberia-1', estadoVinculacion: 'PENDIENTE_APROBACION', esBarberiaActiva: false };
      (prisma.clienteBarberia.findUnique as any).mockResolvedValue(mockVinculacion);

      await expect(service.seleccionarBarberiaActiva('user-1', 'barberia-1')).rejects.toThrow(ForbiddenException);
    });

    /**
     * E1-06 · parte 3. El decorador admite a los cuatro roles pero el servicio
     * exigía `cliente_barberias`, que un barbero y un responsable no tienen:
     * pasaban el guard y recibían 404 en la ruta que existe para ellos.
     */
    describe('E1-06: el vínculo ya no es solo cliente_barberias', () => {
      beforeEach(() => {
        (prisma.clienteBarberia.findUnique as any).mockResolvedValue(null);
        (prisma.barberia.findUnique as any).mockResolvedValue({
          id: 'barberia-1',
          responsableId: 'otro-usuario',
        });
        (prisma.usuarioRol.findFirst as any).mockResolvedValue({ id: 'rol-1' });
      });

      it('un BARBERO con rol en la sede la puede seleccionar (antes: 404)', async () => {
        const result = await service.seleccionarBarberiaActiva('barbero-1', 'barberia-1');

        expect(result).toEqual({
          usuarioId: 'barbero-1',
          barberiaId: 'barberia-1',
          esBarberiaActiva: true,
          vinculo: 'ROL',
        });
      });

      it('no inventa una fila en cliente_barberias para el barbero', async () => {
        await service.seleccionarBarberiaActiva('barbero-1', 'barberia-1');

        expect(prisma.clienteBarberia.update).not.toHaveBeenCalled();
        expect(prisma.clienteBarberia.updateMany).not.toHaveBeenCalled();
      });

      it('el RESPONSABLE la puede seleccionar sin rol: le basta con ser el dueño', async () => {
        (prisma.usuarioRol.findFirst as any).mockResolvedValue(null);
        (prisma.barberia.findUnique as any).mockResolvedValue({
          id: 'barberia-1',
          responsableId: 'dueno-1',
        });

        const result = await service.seleccionarBarberiaActiva('dueno-1', 'barberia-1');

        expect(result.vinculo).toBe('ROL');
      });

      it('un ADMINISTRADOR global la puede seleccionar sin vínculo ni rol', async () => {
        (prisma.usuarioRol.findFirst as any).mockResolvedValue(null);
        (prisma.barberia.findUnique as any).mockResolvedValue({
          id: 'barberia-1',
          responsableId: 'otro-usuario',
        });

        const result = await service.seleccionarBarberiaActiva(
          'global-1',
          'barberia-1',
          ADMINISTRADOR,
        );

        expect(result.vinculo).toBe('ROL');
      });

      it('sigue dando 404 a quien no tiene rol, no es dueño ni es global', async () => {
        (prisma.usuarioRol.findFirst as any).mockResolvedValue(null);

        await expect(
          service.seleccionarBarberiaActiva('ajeno-1', 'barberia-1'),
        ).rejects.toThrow(NotFoundException);
      });

      it('sigue dando 404 si la sede ni siquiera existe', async () => {
        (prisma.barberia.findUnique as any).mockResolvedValue(null);

        await expect(
          service.seleccionarBarberiaActiva('barbero-1', 'barberia-fantasma'),
        ).rejects.toThrow(NotFoundException);
      });

      it('el ADMINISTRADOR global se resuelve por la sesión si se le pasa', async () => {
        // Con la sesión no se consulta `usuario_roles` por ADMINISTRADOR.
        (prisma.usuarioRol.findFirst as any).mockResolvedValue(null);

        await service.seleccionarBarberiaActiva('global-1', 'barberia-1', ADMINISTRADOR);

        expect(prisma.usuarioRol.findFirst).toHaveBeenCalledWith({
          where: { usuarioId: 'global-1', barberiaId: 'barberia-1' },
          select: { id: true },
        });
      });

      it('el camino del cliente con vínculo ACTIVO no cambia: sigue moviendo la marca', async () => {
        const mockVinculacion = {
          usuarioId: 'cliente-1',
          barberiaId: 'barberia-1',
          estadoVinculacion: 'ACTIVO',
          esBarberiaActiva: false,
        };
        (prisma.clienteBarberia.findUnique as any).mockResolvedValue(mockVinculacion);
        (prisma.clienteBarberia.updateMany as any).mockResolvedValue({ count: 1 });
        (prisma.clienteBarberia.update as any).mockResolvedValue({
          ...mockVinculacion,
          esBarberiaActiva: true,
        });

        const result = await service.seleccionarBarberiaActiva('cliente-1', 'barberia-1');

        expect(result.esBarberiaActiva).toBe(true);
        expect(prisma.clienteBarberia.updateMany).toHaveBeenCalled();
      });
    });
  });
});
