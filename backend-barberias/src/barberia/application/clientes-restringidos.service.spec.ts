import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { vi } from 'vitest';
import { ClientesRestringidosService } from './clientes-restringidos.service.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { AuditoriaService } from '../../auditoria/application/auditoria.service.js';
import type { UsuarioAutenticado } from '../../iam/domain/jwt.interface.js';

const SEDE_A = '11111111-1111-4111-8111-111111111111';
const SEDE_B = '22222222-2222-4222-8222-222222222222';
const CLIENTE_ID = '33333333-3333-4333-8333-333333333333';

const ADMIN_A: UsuarioAutenticado = {
  id: 'admin-a',
  correo: 'admin.a@test.com',
  roles: ['ADMIN_BARBERIA'],
  rolesDetallados: [{ nombre: 'ADMIN_BARBERIA', barberiaId: SEDE_A, ambito: 'BARBERIA' }],
};

const ADMIN_B: UsuarioAutenticado = {
  id: 'admin-b',
  correo: 'admin.b@test.com',
  roles: ['ADMIN_BARBERIA'],
  rolesDetallados: [{ nombre: 'ADMIN_BARBERIA', barberiaId: SEDE_B, ambito: 'BARBERIA' }],
};

const ADMINISTRADOR: UsuarioAutenticado = {
  id: 'admin-global',
  correo: 'global@test.com',
  roles: ['ADMINISTRADOR'],
  rolesDetallados: [{ nombre: 'ADMINISTRADOR', barberiaId: null, ambito: 'GLOBAL' }],
};

const BARBERO_A: UsuarioAutenticado = {
  id: 'barbero-a',
  correo: 'barbero.a@test.com',
  roles: ['BARBERO'],
  rolesDetallados: [{ nombre: 'BARBERO', barberiaId: SEDE_A, ambito: 'BARBERIA' }],
};

/** ADMIN_BARBERIA con `barberia_id` nulo: la fila corrupta que E1-04 corrige. */
const ADMIN_SIN_SEDE: UsuarioAutenticado = {
  id: 'admin-sin-sede',
  correo: 'admin.sin.sede@test.com',
  roles: ['ADMIN_BARBERIA'],
  rolesDetallados: [{ nombre: 'ADMIN_BARBERIA', barberiaId: null, ambito: 'BARBERIA' }],
};

async function capturarError(
  promesa: Promise<unknown>,
): Promise<{ status: number; codigo: string }> {
  try {
    await promesa;
  } catch (error: any) {
    const respuesta = typeof error?.getResponse === 'function' ? error.getResponse() : {};
    return { status: error?.getStatus?.() ?? respuesta.statusCode, codigo: respuesta.codigo };
  }
  throw new Error('Se esperaba una excepción y la promesa se resolvió.');
}

describe('ClientesRestringidosService (E4-03)', () => {
  let service: ClientesRestringidosService;
  let prisma: any;
  let auditoria: { registrarEvento: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    auditoria = { registrarEvento: vi.fn().mockResolvedValue({ id: 'auditoria-1' }) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClientesRestringidosService,
        {
          provide: AuditoriaService,
          useValue: auditoria,
        },
        {
          provide: PrismaService,
          useValue: {
            $transaction: vi.fn().mockImplementation(async (cb: any) => cb(prisma)),
            clienteBarberia: {
              findMany: vi.fn(),
              findUnique: vi.fn(),
              update: vi.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get<ClientesRestringidosService>(ClientesRestringidosService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  describe('listar', () => {
    it('el ADMIN_BARBERIA de la sede recibe solo las filas restringidas de ESA sede', async () => {
      prisma.clienteBarberia.findMany.mockResolvedValue([
        {
          id: 'vinculo-1',
          usuarioId: CLIENTE_ID,
          contadorNoPresentado: 5,
          motivoRestriccion: 'Bloqueo automático: alcanzaste el límite de 5 inasistencias en esta barbería.',
          creadoAt: new Date('2026-09-01T10:00:00.000Z'),
          usuario: {
            id: CLIENTE_ID,
            nombreCompleto: 'Cliente Uno',
            correo: 'cliente@test.com',
            telefono: '600000001',
          },
        },
      ]);

      const resultado = await service.listar(SEDE_A, ADMIN_A);

      expect(prisma.clienteBarberia.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { barberiaId: SEDE_A, estaRestringido: true },
        }),
      );
      expect(resultado).toEqual([
        {
          clienteId: CLIENTE_ID,
          nombreCompleto: 'Cliente Uno',
          correo: 'cliente@test.com',
          telefono: '600000001',
          contadorNoPresentado: 5,
          motivoRestriccion:
            'Bloqueo automático: alcanzaste el límite de 5 inasistencias en esta barbería.',
          vinculadoDesde: new Date('2026-09-01T10:00:00.000Z'),
        },
      ]);
      // La lista es de una sola sede: nunca se consulta sin `barberiaId`.
      expect(prisma.clienteBarberia.findMany).not.toHaveBeenCalledWith(
        expect.objectContaining({ where: { estaRestringido: true } }),
      );
    });

    it('el ADMINISTRADOR global puede leerla (jerarquía E1-04)', async () => {
      prisma.clienteBarberia.findMany.mockResolvedValue([]);

      await expect(service.listar(SEDE_B, ADMINISTRADOR)).resolves.toEqual([]);
    });

    it('un ADMIN_BARBERIA de otra sede recibe 403', async () => {
      await expect(service.listar(SEDE_A, ADMIN_B)).rejects.toThrowError(ForbiddenException);
      expect(prisma.clienteBarberia.findMany).not.toHaveBeenCalled();
    });

    it('un BARBERO de la sede recibe 403: la bandeja no es de la agenda', async () => {
      await expect(service.listar(SEDE_A, BARBERO_A)).rejects.toThrowError(ForbiddenException);
      expect(prisma.clienteBarberia.findMany).not.toHaveBeenCalled();
    });

    it('un ADMIN_BARBERIA con barberia_id nulo no es comodín (E1-04)', async () => {
      await expect(service.listar(SEDE_A, ADMIN_SIN_SEDE)).rejects.toThrowError(
        ForbiddenException,
      );
      expect(prisma.clienteBarberia.findMany).not.toHaveBeenCalled();
    });
  });

  describe('reactivar', () => {
    it('VERDE: reinicia el contador, levanta la restricción y audita anterior → nuevo', async () => {
      prisma.clienteBarberia.findUnique.mockResolvedValue({
        id: 'vinculo-1',
        usuarioId: CLIENTE_ID,
        contadorNoPresentado: 5,
        estaRestringido: true,
        motivoRestriccion: 'Bloqueo automático: alcanzaste el límite de 5 inasistencias en esta barbería.',
      });
      prisma.clienteBarberia.update.mockResolvedValue({
        id: 'vinculo-1',
        contadorNoPresentado: 0,
        estaRestringido: false,
        motivoRestriccion: null,
      });

      const resultado = await service.reactivar(SEDE_A, CLIENTE_ID, ADMIN_A, 'Perdón de la sede');

      expect(prisma.clienteBarberia.update).toHaveBeenCalledWith({
        where: { id: 'vinculo-1' },
        data: {
          estaRestringido: false,
          motivoRestriccion: null,
          contadorNoPresentado: 0,
        },
      });
      expect(resultado).toEqual({
        barberiaId: SEDE_A,
        clienteId: CLIENTE_ID,
        estaRestringido: false,
        motivoRestriccion: null,
        contadorNoPresentado: 0,
      });

      expect(auditoria.registrarEvento).toHaveBeenCalledTimes(1);
      const [evento] = auditoria.registrarEvento.mock.calls[0];
      expect(evento.accion).toBe('RESTRICCION_LEVANTADA');
      expect(evento.usuarioId).toBe('admin-a');
      expect(evento.contexto).toEqual(
        expect.objectContaining({
          barberiaId: SEDE_A,
          clienteId: CLIENTE_ID,
          motivo: 'Perdón de la sede',
          anterior: expect.objectContaining({ contadorNoPresentado: 5, estaRestringido: true }),
          nuevo: { estaRestringido: false, motivoRestriccion: null, contadorNoPresentado: 0 },
        }),
      );
    });

    it('D48: no hay ningún camino que escriba estado_cuenta (solo cliente_barberias)', async () => {
      prisma.clienteBarberia.findUnique.mockResolvedValue({
        id: 'vinculo-1',
        usuarioId: CLIENTE_ID,
        contadorNoPresentado: 5,
        estaRestringido: true,
        motivoRestriccion: 'motivo',
      });
      prisma.clienteBarberia.update.mockResolvedValue({ id: 'vinculo-1' });

      await service.reactivar(SEDE_A, CLIENTE_ID, ADMIN_A);

      expect(prisma.usuario).toBeUndefined();
      expect(prisma.clienteBarberia.update.mock.calls[0][0].data).not.toHaveProperty('estadoCuenta');
    });

    it('si el cliente no está restringido responde 422 SIN_RESTRICCION', async () => {
      prisma.clienteBarberia.findUnique.mockResolvedValue({
        id: 'vinculo-1',
        usuarioId: CLIENTE_ID,
        contadorNoPresentado: 1,
        estaRestringido: false,
        motivoRestriccion: null,
      });

      const error = await capturarError(service.reactivar(SEDE_A, CLIENTE_ID, ADMIN_A));

      expect(error).toEqual({ status: 422, codigo: 'SIN_RESTRICCION' });
      expect(prisma.clienteBarberia.update).not.toHaveBeenCalled();
      expect(auditoria.registrarEvento).not.toHaveBeenCalled();
    });

    it('sin vinculación con esa sede responde 404', async () => {
      prisma.clienteBarberia.findUnique.mockResolvedValue(null);

      await expect(service.reactivar(SEDE_A, CLIENTE_ID, ADMIN_A)).rejects.toThrowError(
        NotFoundException,
      );
      expect(prisma.clienteBarberia.update).not.toHaveBeenCalled();
    });

    it('un ADMIN_BARBERIA de otra sede no puede levantar la restricción (403)', async () => {
      await expect(service.reactivar(SEDE_A, CLIENTE_ID, ADMIN_B)).rejects.toThrowError(
        ForbiddenException,
      );
      expect(prisma.clienteBarberia.findUnique).not.toHaveBeenCalled();
      expect(prisma.clienteBarberia.update).not.toHaveBeenCalled();
    });

    it('el ADMINISTRADOR global sí puede levantarla', async () => {
      prisma.clienteBarberia.findUnique.mockResolvedValue({
        id: 'vinculo-1',
        usuarioId: CLIENTE_ID,
        contadorNoPresentado: 5,
        estaRestringido: true,
        motivoRestriccion: 'motivo',
      });
      prisma.clienteBarberia.update.mockResolvedValue({ id: 'vinculo-1' });

      await expect(service.reactivar(SEDE_A, CLIENTE_ID, ADMINISTRADOR)).resolves.toMatchObject({
        estaRestringido: false,
        contadorNoPresentado: 0,
      });
    });
  });
});
