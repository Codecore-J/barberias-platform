import { Test, TestingModule } from '@nestjs/testing';
import { vi } from 'vitest';
import * as bcrypt from 'bcrypt';
import { BarberiaService } from './barberia.service.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { AuditoriaService } from '../../auditoria/application/auditoria.service.js';
import { NotificacionService } from '../../notificacion/application/notificacion.service.js';
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

/**
 * E3-13 · contrato D40: `{ statusCode, codigo, mensaje }` en el cuerpo de la
 * excepción. Devuelve solo lo que se quiere asertar.
 */
async function capturarError(promesa: Promise<unknown>): Promise<{ status: number; codigo: string }> {
  try {
    await promesa;
  } catch (error: any) {
    const respuesta = typeof error?.getResponse === 'function' ? error.getResponse() : {};
    return { status: error?.getStatus?.() ?? respuesta.statusCode, codigo: respuesta.codigo };
  }
  throw new Error('Se esperaba una excepción y la promesa se resolvió.');
}

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
  let auditoria: AuditoriaService;
  let notificacion: { enviarNotificacion: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    notificacion = { enviarNotificacion: vi.fn().mockResolvedValue({ id: 'uuid-notificacion' }) };

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
            },              clienteBarberia: {
                findUnique: vi.fn(),
                count: vi.fn(),
                create: vi.fn(),
                updateMany: vi.fn(),
                update: vi.fn(),
              },
          },
        },
        {
          // P-SD-4: suspender/reactivar una sede deja rastro en auditoría,
          // así que el servicio lo exige en el módulo y aquí se mockea.
          provide: AuditoriaService,
          useValue: { registrarEvento: vi.fn().mockResolvedValue({ id: 'uuid-auditoria' }) },
        },
        {
          // H71: reabrir un vínculo cerrado avisa a la plataforma.
          provide: NotificacionService,
          useValue: notificacion,
        },
      ],
    }).compile();

    service = module.get<BarberiaService>(BarberiaService);
    prisma = module.get<PrismaService>(PrismaService);
    auditoria = module.get<AuditoriaService>(AuditoriaService);
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
      // `logoUrl` se sumó en E3-13 (edición directa del branding de la sede).
      expect(Object.keys(result).sort()).toEqual(
        [
          'descripcion',
          'estado',
          'id',
          'logoUrl',
          'nombre',
          'responsableId',
          'telefono',
          'ubicacion',
        ].sort(),
      );
    });
  });

  describe('update', () => {
    it('debe arrojar ForbiddenException si no es super admin ni responsable', async () => {
      const mockBarberia = { id: 'uuid-1', nombre: 'Barberia 1', responsableId: 'res-1' };
      (prisma.barberia.findUnique as any).mockResolvedValue(mockBarberia);

      await expect(service.update('uuid-1', 'other-user', {}, false)).rejects.toThrow(ForbiddenException);
    });

    /**
     * E3-13: el nombre de la sede ya no se cambia por la puerta de atrás. El
     * único camino es una solicitud aprobada por el ADMINISTRADOR (D26).
     */
    it('422 NOMBRE_REQUIERE_SOLICITUD al intentar cambiar el nombre y NO toca la base', async () => {
      const mockBarberia = { id: 'uuid-1', nombre: 'Barberia 1', responsableId: 'res-1' };
      (prisma.barberia.findUnique as any).mockResolvedValue(mockBarberia);

      const error = await capturarError(
        service.update('uuid-1', 'res-1', { nombre: 'Nombre por la puerta de atrás' }, false),
      );

      expect(error).toEqual({ status: 422, codigo: 'NOMBRE_REQUIERE_SOLICITUD' });
      expect(prisma.barberia.update).not.toHaveBeenCalled();
    });

    it('el responsable puede actualizar descripcion, ubicacion y logo', async () => {
      const mockBarberia = { id: 'uuid-1', nombre: 'Barberia 1', responsableId: 'res-1' };
      (prisma.barberia.findUnique as any).mockResolvedValue(mockBarberia);
      (prisma.barberia.update as any).mockResolvedValue({
        ...mockBarberia,
        descripcion: 'Nueva descripción',
        ubicacion: 'Nueva ubicación',
        logoUrl: 'https://cdn.test.com/logo.png',
      });

      const result = await service.update(
        'uuid-1',
        'res-1',
        {
          descripcion: 'Nueva descripción',
          ubicacion: 'Nueva ubicación',
          logoUrl: 'https://cdn.test.com/logo.png',
        },
        false,
      );

      expect(prisma.barberia.update).toHaveBeenCalledWith({
        where: { id: 'uuid-1' },
        data: {
          descripcion: 'Nueva descripción',
          ubicacion: 'Nueva ubicación',
          logoUrl: 'https://cdn.test.com/logo.png',
        },
      });
      expect(result.descripcion).toBe('Nueva descripción');
    });

    it('E1-04: el ADMINISTRADOR puede editar una barbería ajena', async () => {
      const mockBarberia = { id: 'uuid-1', nombre: 'Barberia 1', responsableId: 'otro-res' };
      (prisma.barberia.findUnique as any).mockResolvedValue(mockBarberia);
      (prisma.barberia.update as any).mockResolvedValue({
        ...mockBarberia,
        descripcion: 'Editada por el global',
      });

      const result = await service.update(
        'uuid-1',
        'admin-global',
        { descripcion: 'Editada por el global' },
        true,
      );

      expect(prisma.barberia.update).toHaveBeenCalled();
      expect(result.descripcion).toBe('Editada por el global');
    });

    /** D27: el teléfono es un dato de contacto y exige la contraseña actual. */
    it('422 PASSWORD_REQUERIDA al cambiar el teléfono sin contraseña actual', async () => {
      const mockBarberia = {
        id: 'uuid-1',
        nombre: 'Barberia 1',
        responsableId: 'res-1',
        telefono: '8095555555',
      };
      (prisma.barberia.findUnique as any).mockResolvedValue(mockBarberia);

      const error = await capturarError(
        service.update('uuid-1', 'res-1', { telefono: '8096666666' }, false),
      );

      expect(error).toEqual({ status: 422, codigo: 'PASSWORD_REQUERIDA' });
      expect(prisma.barberia.update).not.toHaveBeenCalled();
    });

    it('422 PASSWORD_INCORRECTA cuando la contraseña no coincide', async () => {
      const mockBarberia = {
        id: 'uuid-1',
        nombre: 'Barberia 1',
        responsableId: 'res-1',
        telefono: '8095555555',
      };
      (prisma.barberia.findUnique as any).mockResolvedValue(mockBarberia);
      (prisma.usuario.findUnique as any).mockResolvedValue({
        passwordHash: await bcrypt.hash('ClaveCorrecta123', 10),
      });

      const error = await capturarError(
        service.update('uuid-1', 'res-1', { telefono: '8096666666', passwordActual: 'NoEs' }, false),
      );

      expect(error).toEqual({ status: 422, codigo: 'PASSWORD_INCORRECTA' });
      expect(prisma.barberia.update).not.toHaveBeenCalled();
    });

    it('cambia el teléfono cuando la contraseña actual es correcta', async () => {
      const mockBarberia = {
        id: 'uuid-1',
        nombre: 'Barberia 1',
        responsableId: 'res-1',
        telefono: '8095555555',
      };
      (prisma.barberia.findUnique as any).mockResolvedValue(mockBarberia);
      (prisma.usuario.findUnique as any).mockResolvedValue({
        passwordHash: await bcrypt.hash('ClaveCorrecta123', 10),
      });
      (prisma.barberia.update as any).mockResolvedValue({
        ...mockBarberia,
        telefono: '8096666666',
      });

      const result = await service.update(
        'uuid-1',
        'res-1',
        { telefono: '8096666666', passwordActual: 'ClaveCorrecta123' },
        false,
      );

      expect(result.telefono).toBe('8096666666');
    });
  });

  /**
   * Regla 2.3 · H69. El estado de la sede NO se edita por el `PATCH` general:
   * se fija al crearla y después solo cambia por su endpoint específico
   * (`cambiarEstado`, regla 2.5), que audita el anterior y el nuevo.
   *
   * Antes esta regla se cumplía sin certificado: ningún test nombraba
   * `ESTADO_NO_EDITABLE`, así que una refactorización del `update` podía
   * convertir la edición de la sede en una puerta trasera al estado y el CI no
   * se enteraba.
   */
  describe('update · estado no editable (regla 2.3 · H69)', () => {
    it('422 ESTADO_NO_EDITABLE al intentar suspender por el PATCH general y NO toca la base', async () => {
      (prisma.barberia.findUnique as any).mockResolvedValue({
        id: 'uuid-1',
        nombre: 'Barberia 1',
        responsableId: 'res-1',
        estado: 'ACTIVO',
      });

      const error = await capturarError(
        service.update('uuid-1', 'res-1', { estado: 'INACTIVO' }, false),
      );

      expect(error).toEqual({ status: 422, codigo: 'ESTADO_NO_EDITABLE' });
      expect(prisma.barberia.update).not.toHaveBeenCalled();
    });

    it('el rechazo gana a la autorización: ni el ADMINISTRADOR global escribe el estado por aquí', async () => {
      const error = await capturarError(
        service.update('uuid-1', 'admin-global', { estado: 'INACTIVO' }, true),
      );

      expect(error).toEqual({ status: 422, codigo: 'ESTADO_NO_EDITABLE' });
      expect(prisma.barberia.findUnique).not.toHaveBeenCalled();
      expect(prisma.barberia.update).not.toHaveBeenCalled();
    });

    it('una edición legítima tampoco puede colar el estado en el UPDATE', async () => {
      (prisma.barberia.findUnique as any).mockResolvedValue({
        id: 'uuid-1',
        nombre: 'Barberia 1',
        responsableId: 'res-1',
        estado: 'ACTIVO',
      });
      (prisma.barberia.update as any).mockResolvedValue({
        id: 'uuid-1',
        nombre: 'Barberia 1',
        estado: 'ACTIVO',
        descripcion: 'Solo cambia la descripción',
      });

      await service.update('uuid-1', 'res-1', { descripcion: 'Solo cambia la descripción' }, false);

      const datos = (prisma.barberia.update as any).mock.calls[0][0].data;
      expect(datos).toEqual({ descripcion: 'Solo cambia la descripción' });
      expect(datos).not.toHaveProperty('estado');
    });

    it('el endpoint específico sí cambia el estado y lo audita con anterior y nuevo', async () => {
      (prisma.barberia.findUnique as any).mockResolvedValue({
        id: 'uuid-1',
        nombre: 'Barberia 1',
        responsableId: 'res-1',
        estado: 'ACTIVO',
      });
      (prisma.barberia.update as any).mockResolvedValue({
        id: 'uuid-1',
        nombre: 'Barberia 1',
        responsableId: 'res-1',
        estado: 'INACTIVO',
      });

      await service.cambiarEstado('uuid-1', 'res-1', 'INACTIVO', false);

      expect(prisma.barberia.update).toHaveBeenCalledWith({
        where: { id: 'uuid-1' },
        data: { estado: 'INACTIVO' },
      });
      expect(auditoria.registrarEvento).toHaveBeenCalledWith(
        expect.objectContaining({
          accion: 'BARBERIA_SUSPENDIDA',
          contexto: {
            anterior: { estado: 'ACTIVO' },
            nuevo: { estado: 'INACTIVO' },
          },
        }),
        expect.anything(),
      );
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

  /**
   * E2-07: suspender y reactivar son la MISMA operación (`cambiarEstado`), así
   * que comparten ruta y reglas. Antes solo existía el camino hacia INACTIVO.
   */
  describe('cambiarEstado (E2-07 · D29)', () => {
      it('suspende: actualiza el estado a INACTIVO', async () => {
        const mockBarberia = { id: 'uuid-1', nombre: 'Barberia 1', responsableId: 'res-1', estado: 'ACTIVO' };
        (prisma.barberia.findUnique as any).mockResolvedValue(mockBarberia);
        (prisma.barberia.update as any).mockResolvedValue({ ...mockBarberia, estado: 'INACTIVO' });
  
        await service.cambiarEstado('uuid-1', 'res-1', 'INACTIVO', false);
        expect(prisma.barberia.update).toHaveBeenCalledWith({
            where: { id: 'uuid-1' },
            data: { estado: 'INACTIVO' }
        });
      });

      it('reactiva: la vuelta atrás que el DELETE no ofrecía', async () => {
        const mockBarberia = { id: 'uuid-1', nombre: 'Barberia 1', responsableId: 'res-1', estado: 'INACTIVO' };
        (prisma.barberia.findUnique as any).mockResolvedValue(mockBarberia);
        (prisma.barberia.update as any).mockResolvedValue({ ...mockBarberia, estado: 'ACTIVO' });

        await service.cambiarEstado('uuid-1', 'res-1', 'ACTIVO', false);

        expect(prisma.barberia.update).toHaveBeenCalledWith({
            where: { id: 'uuid-1' },
            data: { estado: 'ACTIVO' }
        });
      });

      it('es idempotente: pedir el estado que ya tiene no escribe', async () => {
        (prisma.barberia.findUnique as any).mockResolvedValue({
          id: 'uuid-1', responsableId: 'res-1', estado: 'INACTIVO',
        });

        await service.cambiarEstado('uuid-1', 'res-1', 'INACTIVO', false);

        expect(prisma.barberia.update).not.toHaveBeenCalled();
      });

      // P-SD-4: antes el único rastro era un `logger.log` en consola. La
      // suspensión de una sede es una decisión de plataforma y tiene que
      // poderse auditar después, con anterior y nuevo.
      it('suspende: deja BARBERIA_SUSPENDIDA en auditoría con el estado anterior y el nuevo', async () => {
        (prisma.barberia.findUnique as any).mockResolvedValue({
          id: 'uuid-1', responsableId: 'res-1', estado: 'ACTIVO',
        });

        await service.cambiarEstado('uuid-1', 'res-1', 'INACTIVO', false);

        expect(auditoria.registrarEvento).toHaveBeenCalledWith(
          expect.objectContaining({
            usuarioId: 'res-1',
            accion: 'BARBERIA_SUSPENDIDA',
            entidad: 'barberias',
            entidadId: 'uuid-1',
            contexto: {
              anterior: { estado: 'ACTIVO' },
              nuevo: { estado: 'INACTIVO' },
            },
          }),
          expect.anything(),
        );
      });

      it('reactiva: el evento es BARBERIA_REACTIVADA', async () => {
        (prisma.barberia.findUnique as any).mockResolvedValue({
          id: 'uuid-1', responsableId: 'res-1', estado: 'INACTIVO',
        });

        await service.cambiarEstado('uuid-1', 'res-1', 'ACTIVO', false);

        expect(auditoria.registrarEvento).toHaveBeenCalledWith(
          expect.objectContaining({
            accion: 'BARBERIA_REACTIVADA',
            contexto: {
              anterior: { estado: 'INACTIVO' },
              nuevo: { estado: 'ACTIVO' },
            },
          }),
          expect.anything(),
        );
      });

      it('el evento y la escritura salen juntos, en la MISMA transacción', async () => {
        (prisma.barberia.findUnique as any).mockResolvedValue({
          id: 'uuid-1', responsableId: 'res-1', estado: 'ACTIVO',
        });

        await service.cambiarEstado('uuid-1', 'res-1', 'INACTIVO', false);

        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        // El segundo argumento es el `tx` de la transacción: si hiciera rollback
        // no puede quedar el evento sin el cambio ni el cambio sin el evento.
        expect((auditoria.registrarEvento as any).mock.calls[0][1]).toBe(prisma);
      });

      it('sin cambio no hay evento: la auditoría no registra nada que no pasó', async () => {
        (prisma.barberia.findUnique as any).mockResolvedValue({
          id: 'uuid-1', responsableId: 'res-1', estado: 'ACTIVO',
        });

        await service.cambiarEstado('uuid-1', 'res-1', 'ACTIVO', false);

        expect(auditoria.registrarEvento).not.toHaveBeenCalled();
      });

      it('un responsable ajeno sigue recibiendo ForbiddenException', async () => {
        (prisma.barberia.findUnique as any).mockResolvedValue({
          id: 'uuid-1', responsableId: 'otro', estado: 'ACTIVO',
        });

        await expect(
          service.cambiarEstado('uuid-1', 'res-1', 'INACTIVO', false),
        ).rejects.toThrow(ForbiddenException);
        expect(prisma.barberia.update).not.toHaveBeenCalled();
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

    // ── H71 · D21: el vínculo CERRADO se reabre, no se devuelve muerto ──────

    it('H71 · reabre un vínculo DESVINCULADO y lo devuelve a la bandeja si el cliente sigue por encima del límite', async () => {
      (prisma.barberia.findUnique as any).mockResolvedValue({
        id: 'barberia-1',
        nombre: 'Barbería Uno',
        codigoAcceso: 'ABC12345',
        estado: 'ACTIVO',
      });
      (prisma.clienteBarberia.findUnique as any).mockResolvedValue({
        id: 'vinculo-1',
        usuarioId: 'user-1',
        barberiaId: 'barberia-1',
        estadoVinculacion: 'DESVINCULADO',
        esBarberiaActiva: false,
      });
      // Cinco vínculos MÁS: el que se reabre no se cuenta a sí mismo.
      (prisma.clienteBarberia.count as any).mockResolvedValue(5);
      (prisma.clienteBarberia.update as any).mockResolvedValue({
        id: 'vinculo-1',
        usuarioId: 'user-1',
        estadoVinculacion: 'PENDIENTE_APROBACION',
      });
      (prisma.usuarioRol.findMany as any).mockResolvedValue([{ usuarioId: 'admin-global' }]);

      const result = await service.vincularCliente('user-1', { codigoAcceso: 'ABC12345' });

      expect(prisma.clienteBarberia.create).not.toHaveBeenCalled();
      // E3-12/3: el conteo mira los vínculos VIVOS. La fila que vuelve sigue
      // `DESVINCULADO` en la base mientras se cuenta, así que el filtro por
      // estado ya la deja fuera sin necesidad de excluirla por `id`.
      expect(prisma.clienteBarberia.count).toHaveBeenCalledWith({
        where: {
          usuarioId: 'user-1',
          estadoVinculacion: { not: 'DESVINCULADO' },
        },
      });
      expect(prisma.clienteBarberia.update).toHaveBeenCalledWith({
        where: { id: 'vinculo-1' },
        data: { estadoVinculacion: 'PENDIENTE_APROBACION' },
      });
      expect(result.estadoVinculacion).toBe('PENDIENTE_APROBACION');

      const [evento] = (auditoria.registrarEvento as any).mock.calls[0];
      expect(evento).toMatchObject({
        usuarioId: 'user-1',
        accion: 'VINCULACION_REACTIVADA',
        entidad: 'cliente_barberias',
        entidadId: 'vinculo-1',
        contexto: {
          anterior: { estadoVinculacion: 'DESVINCULADO' },
          nuevo: { estadoVinculacion: 'PENDIENTE_APROBACION' },
        },
      });
      // El rastro sale con la transacción del cambio, como en el resto del módulo.
      expect((auditoria.registrarEvento as any).mock.calls[0][1]).toBe(prisma);

      // El aviso a la plataforma es en segundo plano: se le da un turno.
      await new Promise((resolve) => setImmediate(resolve));
      expect(notificacion.enviarNotificacion).toHaveBeenCalledWith(
        expect.objectContaining({
          usuarioId: 'admin-global',
          tipo: 'VINCULACION_PENDIENTE_APROBACION',
        }),
      );
    });

    it('H71 · con hueco libre la fila vuelve ACTIVA (D21) y no hay nada que avisar a la plataforma', async () => {
      (prisma.barberia.findUnique as any).mockResolvedValue({
        id: 'barberia-1',
        nombre: 'Barbería Uno',
        codigoAcceso: 'ABC12345',
        estado: 'ACTIVO',
      });
      (prisma.clienteBarberia.findUnique as any).mockResolvedValue({
        id: 'vinculo-1',
        usuarioId: 'user-1',
        estadoVinculacion: 'DESVINCULADO',
      });
      (prisma.clienteBarberia.count as any).mockResolvedValue(1);
      (prisma.clienteBarberia.update as any).mockResolvedValue({
        id: 'vinculo-1',
        estadoVinculacion: 'ACTIVO',
      });

      const result = await service.vincularCliente('user-1', { codigoAcceso: 'ABC12345' });

      expect(prisma.clienteBarberia.update).toHaveBeenCalledWith({
        where: { id: 'vinculo-1' },
        data: { estadoVinculacion: 'ACTIVO' },
      });
      expect(result.estadoVinculacion).toBe('ACTIVO');

      await new Promise((resolve) => setImmediate(resolve));
      expect(notificacion.enviarNotificacion).not.toHaveBeenCalled();
      expect(prisma.usuarioRol.findMany).not.toHaveBeenCalled();
    });

    // E3-12/3 · D10: el límite cuenta VÍNCULOS VIVOS, así que cerrar uno
    // devuelve el cupo. Sin esto, desvincularse condenaría al cliente a la
    // bandeja de aprobación para siempre (que es la otra cara de H71).
    it('el cupo es de los vínculos VIVOS: un DESVINCULADO no ocupa plaza', async () => {
      (prisma.barberia.findUnique as any).mockResolvedValue({
        id: 'barberia-1',
        nombre: 'Barbería Uno',
        codigoAcceso: 'ABC12345',
        estado: 'ACTIVO',
      });
      (prisma.clienteBarberia.findUnique as any).mockResolvedValue(null);
      // Cuatro vínculos vigentes: el quinto que hubo quedó DESVINCULADO.
      (prisma.clienteBarberia.count as any).mockResolvedValue(4);
      (prisma.clienteBarberia.create as any).mockImplementation(async (args: any) => ({
        id: 'vinculo-2',
        ...args.data,
      }));

      const result = await service.vincularCliente('user-1', { codigoAcceso: 'ABC12345' });

      expect(prisma.clienteBarberia.count).toHaveBeenCalledWith({
        where: { usuarioId: 'user-1', estadoVinculacion: { not: 'DESVINCULADO' } },
      });
      expect(prisma.clienteBarberia.create).toHaveBeenCalledWith({
        data: {
          usuarioId: 'user-1',
          barberiaId: 'barberia-1',
          estadoVinculacion: 'ACTIVO',
          esBarberiaActiva: false,
        },
      });
      expect(result.estadoVinculacion).toBe('ACTIVO');
    });

    it.each(['ACTIVO', 'PENDIENTE_APROBACION'])(
      'un vínculo VIVO (%s) se devuelve tal cual: reintroducir el código no reabre ni reaudita',
      async (estadoVinculacion) => {
        (prisma.barberia.findUnique as any).mockResolvedValue({
          id: 'barberia-1',
          nombre: 'Barbería Uno',
          codigoAcceso: 'ABC12345',
          estado: 'ACTIVO',
        });
        const existente = {
          id: 'vinculo-1',
          usuarioId: 'user-1',
          barberiaId: 'barberia-1',
          estadoVinculacion,
          esBarberiaActiva: false,
        };
        (prisma.clienteBarberia.findUnique as any).mockResolvedValue(existente);

        const result = await service.vincularCliente('user-1', { codigoAcceso: 'ABC12345' });

        // Idempotencia intacta: ni un UPDATE de más ni una segunda aprobación.
        expect(result).toBe(existente);
        expect(prisma.clienteBarberia.count).not.toHaveBeenCalled();
        expect(prisma.clienteBarberia.update).not.toHaveBeenCalled();
        expect(prisma.clienteBarberia.create).not.toHaveBeenCalled();
        expect(auditoria.registrarEvento).not.toHaveBeenCalled();
      },
    );
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

  // ── E3-12/2 · la puerta de entrada de la sede (regla 1.10) ────────────────

  describe('obtenerInvitacion (E3-12/2 · regla 1.10)', () => {
    const SEDE = BARBERIA_A;
    const invitacionDeLaSede = {
      id: SEDE,
      nombre: 'Barbería A',
      codigoAcceso: 'ABC12345',
      enlaceUnico: 'enlace-a',
    };

    beforeEach(() => {
      (prisma.barberia.findUnique as any).mockResolvedValue(invitacionDeLaSede);
    });

    it('el ADMIN_BARBERIA de ESA sede recibe su código y su enlace único', async () => {
      const result = await service.obtenerInvitacion(SEDE, ADMIN_A);

      expect(result).toMatchObject({
        barberiaId: SEDE,
        codigoAcceso: 'ABC12345',
        enlaceUnico: 'enlace-a',
      });
    });

    it('el ADMINISTRADOR global la recibe en cualquier sede (E1-04)', async () => {
      const result = await service.obtenerInvitacion(SEDE, ADMINISTRADOR);

      expect(result.codigoAcceso).toBe('ABC12345');
    });

    /**
     * El caso que separa esto de un `findOne`: la ruta usa `:id`, así que el
     * guard NO resuelve la sede del parámetro. Un ADMIN_BARBERIA de otra sede
     * tiene que recibir 403, no un 200 con los datos abiertos de la sede ajena.
     */
    it('el ADMIN_BARBERIA de OTRA sede recibe 403 y no ve ningún dato de la sede ajena', async () => {
      await expect(service.obtenerInvitacion(SEDE, ADMIN_B).then(() => 'sin error')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('un BARBERO de esa misma sede recibe 403: no es quien comparte la entrada', async () => {
      await expect(service.obtenerInvitacion(SEDE, BARBERO_A).then(() => 'sin error')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('un CLIENTE recibe 403 aunque esté vinculado a esa sede', async () => {
      await expect(service.obtenerInvitacion(SEDE, CLIENTE).then(() => 'sin error')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('una sede inexistente responde 404', async () => {
      (prisma.barberia.findUnique as any).mockResolvedValue(null);

      await expect(
        service.obtenerInvitacion('barberia-fantasma', ADMIN_A).then(() => 'sin error'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('vincularCliente · la sede también se nombra por enlace único (E3-12/2)', () => {
    const sede = { id: 'barberia-1', nombre: 'Barbería Uno', estado: 'ACTIVO' };

    beforeEach(() => {
      (prisma.barberia.findUnique as any).mockResolvedValue(sede);
      (prisma.clienteBarberia.findUnique as any).mockResolvedValue(null);
      (prisma.clienteBarberia.count as any).mockResolvedValue(0);
      (prisma.clienteBarberia.create as any).mockResolvedValue({
        usuarioId: 'user-1',
        barberiaId: 'barberia-1',
        estadoVinculacion: 'ACTIVO',
        esBarberiaActiva: true,
      });
    });

    it('resuelve la sede por `enlaceUnico` y aplica el MISMO camino de D10', async () => {
      const result = await service.vincularCliente('user-1', { enlaceUnico: 'ENLACE-UNO' });

      // El enlace viaja impreso: se recorta y se baja a minúsculas antes de
      // buscar, que es como lo guarda `create`.
      expect(prisma.barberia.findUnique).toHaveBeenCalledWith({
        where: { enlaceUnico: 'enlace-uno' },
      });
      expect(result.estadoVinculacion).toBe('ACTIVO');
    });

    it('la 6.ª vinculación por enlace nace PENDIENTE_APROBACION (D10)', async () => {
      (prisma.clienteBarberia.count as any).mockResolvedValue(5);
      (prisma.clienteBarberia.create as any).mockResolvedValue({
        usuarioId: 'user-1',
        barberiaId: 'barberia-1',
        estadoVinculacion: 'PENDIENTE_APROBACION',
        esBarberiaActiva: false,
      });

      const result = await service.vincularCliente('user-1', { enlaceUnico: ' enlace-uno ' });

      expect(result.estadoVinculacion).toBe('PENDIENTE_APROBACION');
    });

    it('el código de acceso solo se recorta: su alfabeto es de mayúsculas', async () => {
      await service.vincularCliente('user-1', { codigoAcceso: ' ABC12345 ' });

      expect(prisma.barberia.findUnique).toHaveBeenCalledWith({
        where: { codigoAcceso: 'ABC12345' },
      });
    });

    it('sin código y sin enlace responden 422 INVITACION_REQUERIDA (contrato D40)', async () => {
      expect(await capturarError(service.vincularCliente('user-1', {}))).toEqual({
        status: 422,
        codigo: 'INVITACION_REQUERIDA',
      });
      // Un campo en blanco no es una puerta: es una falta de puerta.
      expect(await capturarError(service.vincularCliente('user-1', { codigoAcceso: '   ' }))).toEqual({
        status: 422,
        codigo: 'INVITACION_REQUERIDA',
      });
      // Y no se toca la base: la puerta se valida ANTES de abrir la transacción.
      expect(prisma.barberia.findUnique).not.toHaveBeenCalled();
    });

    it('con las dos puertas a la vez responden 422 INVITACION_AMBIGUA', async () => {
      expect(
        await capturarError(
          service.vincularCliente('user-1', { codigoAcceso: 'ABC12345', enlaceUnico: 'enlace-uno' }),
        ),
      ).toEqual({ status: 422, codigo: 'INVITACION_AMBIGUA' });
      expect(prisma.barberia.findUnique).not.toHaveBeenCalled();
    });

    it('un enlace que no existe responde 404 y no crea vínculo', async () => {
      (prisma.barberia.findUnique as any).mockResolvedValue(null);

      await expect(
        service.vincularCliente('user-1', { enlaceUnico: 'enlace-fantasma' }).then(() => 'sin error'),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.clienteBarberia.create).not.toHaveBeenCalled();
    });
  });
});
