import { Test, TestingModule } from '@nestjs/testing';
import { vi } from 'vitest';
import { SolicitudCambioService } from './solicitud-cambio.service.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { AuditoriaService } from '../../auditoria/application/auditoria.service.js';
import type { UsuarioAutenticado } from '../../iam/domain/jwt.interface.js';

const BARBERIA_A = '11111111-1111-4111-8111-111111111111';
const BARBERIA_B = '22222222-2222-4222-8222-222222222222';
const SOLICITUD_ID = '33333333-3333-4333-8333-333333333333';
const NUEVO_RESPONSABLE = '44444444-4444-4444-8444-444444444444';
const ROL_ADMIN_BARBERIA_ID = '55555555-5555-4555-8555-555555555555';

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

/** Contrato D40: `{ statusCode, codigo, mensaje }` dentro del cuerpo de la excepción. */
async function capturarError(promesa: Promise<unknown>): Promise<{ status: number; codigo: string }> {
  try {
    await promesa;
  } catch (error: any) {
    const respuesta = typeof error?.getResponse === 'function' ? error.getResponse() : {};
    return { status: error?.getStatus?.() ?? respuesta.statusCode, codigo: respuesta.codigo };
  }
  throw new Error('Se esperaba una excepción y la promesa se resolvió.');
}

function filaSolicitud(overrides: Record<string, unknown> = {}) {
  return {
    id: SOLICITUD_ID,
    barberiaId: BARBERIA_A,
    tipo: 'NOMBRE',
    valorNuevo: 'Barbería Renombrada',
    estado: 'PENDIENTE',
    solicitadoPor: ADMIN_A.id,
    resueltoPor: null,
    motivoRechazo: null,
    creadoAt: new Date('2026-10-11T10:00:00.000Z'),
    resueltoAt: null,
    ...overrides,
  };
}

describe('SolicitudCambioService (E3-13)', () => {
  let service: SolicitudCambioService;
  let prisma: any;
  let auditoria: { registrarEvento: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    prisma = {
      $transaction: vi.fn().mockImplementation(async (cb: any) => cb(prisma)),
      barberia: { findUnique: vi.fn(), update: vi.fn() },
      usuario: { findUnique: vi.fn() },
      rol: { findUnique: vi.fn() },
      usuarioRol: { deleteMany: vi.fn(), upsert: vi.fn() },
      solicitudCambioBarberia: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
      },
    };
    auditoria = { registrarEvento: vi.fn().mockResolvedValue({}) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SolicitudCambioService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditoriaService, useValue: auditoria },
      ],
    }).compile();

    service = module.get<SolicitudCambioService>(SolicitudCambioService);
  });

  describe('crearSolicitud', () => {
    it('el ADMIN_BARBERIA de la sede crea una solicitud de NOMBRE en PENDIENTE y la audita', async () => {
      prisma.barberia.findUnique.mockResolvedValue({
        id: BARBERIA_A,
        nombre: 'Barbería Original',
        responsableId: ADMIN_A.id,
      });
      prisma.solicitudCambioBarberia.findFirst.mockResolvedValue(null);
      prisma.solicitudCambioBarberia.create.mockResolvedValue(filaSolicitud());

      const result = await service.crearSolicitud(
        BARBERIA_A,
        ADMIN_A,
        { tipo: 'NOMBRE', valorNuevo: 'Barbería Renombrada' } as any,
      );

      expect(prisma.solicitudCambioBarberia.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          barberiaId: BARBERIA_A,
          tipo: 'NOMBRE',
          valorNuevo: 'Barbería Renombrada',
          estado: 'PENDIENTE',
          solicitadoPor: ADMIN_A.id,
        }),
      });
      expect(result.estado).toBe('PENDIENTE');
      expect(auditoria.registrarEvento).toHaveBeenCalledWith(
        expect.objectContaining({
          usuarioId: ADMIN_A.id,
          accion: 'SOLICITUD_CAMBIO_CREADA',
          entidad: 'solicitud_cambio_barberia',
          entidadId: SOLICITUD_ID,
        }),
        expect.anything(),
      );
    });

    it('un ADMIN_BARBERIA de OTRA sede recibe 403 (fail-closed)', async () => {
      prisma.barberia.findUnique.mockResolvedValue({
        id: BARBERIA_A,
        nombre: 'Barbería Original',
        responsableId: ADMIN_A.id,
      });

      const error = await capturarError(
        service.crearSolicitud(BARBERIA_A, ADMIN_B, { tipo: 'NOMBRE', valorNuevo: 'X Sede' } as any),
      );

      expect(error).toEqual({ status: 403, codigo: 'SOLO_ADMIN_BARBERIA' });
      expect(prisma.solicitudCambioBarberia.create).not.toHaveBeenCalled();
    });

    it('409 SOLICITUD_PENDIENTE si ya hay una solicitud PENDIENTE del mismo tipo', async () => {
      prisma.barberia.findUnique.mockResolvedValue({
        id: BARBERIA_A,
        nombre: 'Barbería Original',
        responsableId: ADMIN_A.id,
      });
      prisma.solicitudCambioBarberia.findFirst.mockResolvedValue(filaSolicitud());

      const error = await capturarError(
        service.crearSolicitud(BARBERIA_A, ADMIN_A, { tipo: 'NOMBRE', valorNuevo: 'Otra' } as any),
      );

      expect(error).toEqual({ status: 409, codigo: 'SOLICITUD_PENDIENTE' });
    });

    it('422 RESPONSABLE_INEXISTENTE si el nuevo responsable no existe', async () => {
      prisma.barberia.findUnique.mockResolvedValue({
        id: BARBERIA_A,
        nombre: 'Barbería Original',
        responsableId: ADMIN_A.id,
      });
      prisma.usuario.findUnique.mockResolvedValue(null);

      const error = await capturarError(
        service.crearSolicitud(BARBERIA_A, ADMIN_A, {
          tipo: 'RESPONSABLE',
          valorNuevo: NUEVO_RESPONSABLE,
        } as any),
      );

      expect(error).toEqual({ status: 422, codigo: 'RESPONSABLE_INEXISTENTE' });
    });
  });

  describe('resolver · cambio de RESPONSABLE', () => {
    it('al aprobar mueve el rol ADMIN_BARBERIA al nuevo responsable y audita la transacción', async () => {
      prisma.solicitudCambioBarberia.findUnique.mockResolvedValue(
        filaSolicitud({ tipo: 'RESPONSABLE', valorNuevo: NUEVO_RESPONSABLE }),
      );
      prisma.barberia.findUnique.mockResolvedValue({
        id: BARBERIA_A,
        nombre: 'Barbería Original',
        responsableId: ADMIN_A.id,
      });
      prisma.usuario.findUnique.mockResolvedValue({ id: NUEVO_RESPONSABLE });
      prisma.rol.findUnique.mockResolvedValue({
        id: ROL_ADMIN_BARBERIA_ID,
        nombre: 'ADMIN_BARBERIA',
        ambito: 'BARBERIA',
      });
      prisma.barberia.update.mockResolvedValue({
        id: BARBERIA_A,
        nombre: 'Barbería Original',
        responsableId: NUEVO_RESPONSABLE,
      });
      prisma.solicitudCambioBarberia.update.mockResolvedValue(
        filaSolicitud({
          tipo: 'RESPONSABLE',
          valorNuevo: NUEVO_RESPONSABLE,
          estado: 'APROBADA',
          resueltoPor: ADMINISTRADOR.id,
          resueltoAt: new Date('2026-10-11T12:00:00.000Z'),
        }),
      );

      const result = await service.resolver(SOLICITUD_ID, ADMINISTRADOR, { aprobar: true } as any);

      // 1. el responsable de la sede cambia
      expect(prisma.barberia.update).toHaveBeenCalledWith({
        where: { id: BARBERIA_A },
        data: { responsableId: NUEVO_RESPONSABLE },
      });
      // 2. el rol ADMIN_BARBERIA se retira del anterior y se asigna al nuevo
      expect(prisma.usuarioRol.deleteMany).toHaveBeenCalledWith({
        where: {
          rolId: ROL_ADMIN_BARBERIA_ID,
          barberiaId: BARBERIA_A,
          usuarioId: { not: NUEVO_RESPONSABLE },
        },
      });
      expect(prisma.usuarioRol.upsert).toHaveBeenCalledWith({
        where: {
          uk_usuario_rol_barberia: {
            usuarioId: NUEVO_RESPONSABLE,
            rolId: ROL_ADMIN_BARBERIA_ID,
            barberiaId: BARBERIA_A,
          },
        },
        create: {
          usuarioId: NUEVO_RESPONSABLE,
          rolId: ROL_ADMIN_BARBERIA_ID,
          barberiaId: BARBERIA_A,
        },
        update: {},
      });
      // 3. la solicitud queda resuelta
      expect(prisma.solicitudCambioBarberia.update).toHaveBeenCalledWith({
        where: { id: SOLICITUD_ID },
        data: expect.objectContaining({
          estado: 'APROBADA',
          resueltoPor: ADMINISTRADOR.id,
        }),
      });
      // 4. se audita dentro de la misma transacción
      expect(auditoria.registrarEvento).toHaveBeenCalledWith(
        expect.objectContaining({
          usuarioId: ADMINISTRADOR.id,
          accion: 'SOLICITUD_CAMBIO_RESPONSABLE_APROBADA',
          entidad: 'barberia',
          entidadId: BARBERIA_A,
        }),
        expect.anything(),
      );
      expect(result.estado).toBe('APROBADA');
    });

    it('al aprobar un NOMBRE actualiza la sede sin tocar roles', async () => {
      prisma.solicitudCambioBarberia.findUnique.mockResolvedValue(
        filaSolicitud({ valorNuevo: 'Barbería Renombrada' }),
      );
      prisma.barberia.findUnique.mockResolvedValue({
        id: BARBERIA_A,
        nombre: 'Barbería Original',
        responsableId: ADMIN_A.id,
      });
      prisma.barberia.update.mockResolvedValue({ id: BARBERIA_A, nombre: 'Barbería Renombrada' });
      prisma.solicitudCambioBarberia.update.mockResolvedValue(
        filaSolicitud({ valorNuevo: 'Barbería Renombrada', estado: 'APROBADA' }),
      );

      const result = await service.resolver(SOLICITUD_ID, ADMINISTRADOR, { aprobar: true } as any);

      expect(prisma.barberia.update).toHaveBeenCalledWith({
        where: { id: BARBERIA_A },
        data: { nombre: 'Barbería Renombrada' },
      });
      expect(prisma.usuarioRol.upsert).not.toHaveBeenCalled();
      expect(auditoria.registrarEvento).toHaveBeenCalledWith(
        expect.objectContaining({ accion: 'SOLICITUD_CAMBIO_NOMBRE_APROBADA' }),
        expect.anything(),
      );
      expect(result.estado).toBe('APROBADA');
    });
  });

  describe('resolver · rechazo y estado', () => {
    it('422 MOTIVO_REQUERIDO al rechazar sin motivo', async () => {
      prisma.solicitudCambioBarberia.findUnique.mockResolvedValue(filaSolicitud());

      const error = await capturarError(
        service.resolver(SOLICITUD_ID, ADMINISTRADOR, { aprobar: false } as any),
      );

      expect(error).toEqual({ status: 422, codigo: 'MOTIVO_REQUERIDO' });
      expect(prisma.solicitudCambioBarberia.update).not.toHaveBeenCalled();
    });

    it('al rechazar guarda el motivo y NO toca la sede', async () => {
      prisma.solicitudCambioBarberia.findUnique.mockResolvedValue(filaSolicitud());
      prisma.solicitudCambioBarberia.update.mockResolvedValue(
        filaSolicitud({
          estado: 'RECHAZADA',
          motivoRechazo: 'El nombre propuesto ya está en uso',
          resueltoPor: ADMINISTRADOR.id,
        }),
      );

      const result = await service.resolver(SOLICITUD_ID, ADMINISTRADOR, {
        aprobar: false,
        motivoRechazo: 'El nombre propuesto ya está en uso',
      } as any);

      expect(prisma.barberia.update).not.toHaveBeenCalled();
      expect(prisma.solicitudCambioBarberia.update).toHaveBeenCalledWith({
        where: { id: SOLICITUD_ID },
        data: expect.objectContaining({
          estado: 'RECHAZADA',
          motivoRechazo: 'El nombre propuesto ya está en uso',
          resueltoPor: ADMINISTRADOR.id,
        }),
      });
      expect(result.estado).toBe('RECHAZADA');
    });

    it('409 ESTADO_INVALIDO si la solicitud ya no está PENDIENTE', async () => {
      prisma.solicitudCambioBarberia.findUnique.mockResolvedValue(
        filaSolicitud({ estado: 'APROBADA' }),
      );

      const error = await capturarError(
        service.resolver(SOLICITUD_ID, ADMINISTRADOR, { aprobar: true } as any),
      );

      expect(error).toEqual({ status: 409, codigo: 'ESTADO_INVALIDO' });
    });

    it('404 si la solicitud no existe', async () => {
      prisma.solicitudCambioBarberia.findUnique.mockResolvedValue(null);

      await expect(
        service.resolver(SOLICITUD_ID, ADMINISTRADOR, { aprobar: true } as any),
      ).rejects.toThrow(/no encontrada/i);
    });
  });

  describe('listar', () => {
    it('devuelve la página D32 con el filtro de estado y la sede', async () => {
      prisma.solicitudCambioBarberia.count.mockResolvedValue(1);
      prisma.solicitudCambioBarberia.findMany.mockResolvedValue([
        { ...filaSolicitud(), barberia: { id: BARBERIA_A, nombre: 'Barbería Original' } },
      ]);

      const pagina = await service.listar({ estado: 'PENDIENTE' } as any);

      expect(prisma.solicitudCambioBarberia.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { estado: 'PENDIENTE' },
          skip: 0,
          take: 50,
        }),
      );
      expect(pagina).toMatchObject({ total: 1, page: 1, pageSize: 50 });
      expect(pagina.data[0].barberia?.nombre).toBe('Barbería Original');
    });
  });
});
