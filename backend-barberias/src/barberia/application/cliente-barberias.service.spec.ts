import { Test, TestingModule } from '@nestjs/testing';
import { ClienteBarberiasService } from './cliente-barberias.service.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { ESTADOS_VINCULACION } from '../domain/vinculacion.js';

/**
 * H72 · las sedes PROPIAS del CLIENTE.
 *
 * Lo que se prueba aquí es la CONSULTA: que solo salgan los vínculos que son
 * sede operativa (`ACTIVO`, `PENDIENTE_APROBACION`), que queden fuera las
 * barberías inactivas, y que el filtro por usuario sea del token y no del
 * cliente que llame. El comportamiento contra la base real lo cubre
 * `test/h72-listado-sedes-cliente.e2e-spec.ts`.
 */
describe('ClienteBarberiasService (H72)', () => {
  const CLIENTE_ID = 'uuid-cliente';

  const mockPrisma = {
    clienteBarberia: { findMany: vi.fn() },
  };

  let service: ClienteBarberiasService;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockPrisma.clienteBarberia.findMany.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [ClienteBarberiasService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    service = module.get<ClienteBarberiasService>(ClienteBarberiasService);
  });

  /** Fila de `cliente_barberias` con su sede, tal como la devuelve Prisma. */
  const vinculo = (extra: Record<string, unknown> = {}) => ({
    id: 'vinculo-1',
    estadoVinculacion: ESTADOS_VINCULACION.ACTIVO,
    esBarberiaActiva: false,
    barberia: {
      id: 'sede-1',
      nombre: 'Barbería Uno',
      descripcion: null,
      telefono: '8090000000',
      ubicacion: 'Calle 1',
      logoUrl: null,
      responsableId: 'uuid-dueno',
      estado: 'ACTIVO',
    },
    ...extra,
  });

  it('filtra por el usuario del token, por los estados vivos y por sede activa', async () => {
    await service.listarSedesDelCliente(CLIENTE_ID);

    expect(mockPrisma.clienteBarberia.findMany).toHaveBeenCalledTimes(1);
    const consulta = mockPrisma.clienteBarberia.findMany.mock.calls[0][0];

    // Aislamiento: el acotado es del servicio (la ruta no lleva `:barberiaId`).
    expect(consulta.where.usuarioId).toBe(CLIENTE_ID);
    // Solo vínculos VIVOS: `DESVINCULADO` es historial, no sede donde operar.
    expect(consulta.where.estadoVinculacion.in).toEqual([
      ESTADOS_VINCULACION.ACTIVO,
      ESTADOS_VINCULACION.PENDIENTE_APROBACION,
    ]);
    expect(consulta.where.estadoVinculacion.in).not.toContain(
      ESTADOS_VINCULACION.DESVINCULADO,
    );
    // La sede suspendida (E2-07) se excluye en la misma consulta.
    expect(consulta.where.barberia).toEqual({ estado: 'ACTIVO' });
  });

  it('ordena con la sede activa primero y, dentro, por nombre', async () => {
    await service.listarSedesDelCliente(CLIENTE_ID);

    const consulta = mockPrisma.clienteBarberia.findMany.mock.calls[0][0];
    expect(consulta.orderBy).toEqual([
      { esBarberiaActiva: 'desc' },
      { barberia: { nombre: 'asc' } },
    ]);
  });

  it('mapea a la sede con el id de la BARBERÍA y su estado de vinculación', async () => {
    mockPrisma.clienteBarberia.findMany.mockResolvedValue([
      vinculo({
        id: 'vinculo-interno',
        estadoVinculacion: ESTADOS_VINCULACION.PENDIENTE_APROBACION,
        esBarberiaActiva: true,
      }),
    ]);

    const sedes = await service.listarSedesDelCliente(CLIENTE_ID);

    expect(sedes).toEqual([
      {
        id: 'sede-1',
        nombre: 'Barbería Uno',
        descripcion: null,
        telefono: '8090000000',
        ubicacion: 'Calle 1',
        logoUrl: null,
        responsableId: 'uuid-dueno',
        estado: 'ACTIVO',
        estadoVinculacion: ESTADOS_VINCULACION.PENDIENTE_APROBACION,
        esBarberiaActiva: true,
      },
    ]);
    // El id que viaja es el de la sede: el de la fila de vinculación no se expone.
    expect(sedes[0].id).not.toBe('vinculo-interno');
  });

  it('no expone `codigoAcceso` ni `enlaceUnico` (el cliente ya está dentro)', async () => {
    mockPrisma.clienteBarberia.findMany.mockResolvedValue([vinculo()]);

    const [sede] = await service.listarSedesDelCliente(CLIENTE_ID);

    expect(sede).not.toHaveProperty('codigoAcceso');
    expect(sede).not.toHaveProperty('enlaceUnico');
  });

  it('devuelve una lista vacía si el cliente no tiene filas vivas', async () => {
    mockPrisma.clienteBarberia.findMany.mockResolvedValue([]);

    await expect(service.listarSedesDelCliente(CLIENTE_ID)).resolves.toEqual([]);
  });
});
