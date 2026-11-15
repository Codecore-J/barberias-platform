import { Test, TestingModule } from '@nestjs/testing';
import { ReservaService } from './reserva.service.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { DisponibilidadService } from '../../agenda/application/disponibilidad.service.js';
import { getQueueToken } from '@nestjs/bullmq';
import { AuditoriaService } from '../../auditoria/application/auditoria.service.js';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { UsuarioAutenticado } from '../../iam/domain/jwt.interface.js';

/**
 * T-18 · D16: la agenda diaria es una vista con ALCANCE DE ROL.
 *
 * El BARBERO lee su columna y sus turnos; el rol de sede (`ADMIN_BARBERIA`,
 * `ADMINISTRADOR`) sigue viendo la agenda completa. El filtro del barbero sale
 * del token, no de la query: si saliera de la URL, cambiar `?barberoId=` daría
 * acceso a la agenda de un compañero.
 */
describe('ReservaService · alcance de la agenda diaria (T-18)', () => {
  const SEDE = 'aaaaaaaa-1111-4111-8111-111111111111';
  const BARBERO_ID = 'bbbbbbbb-2222-4222-8222-222222222222';

  let service: ReservaService;

  const mockPrisma = {
    $queryRaw: vi.fn(),
    configuracionBarberia: { findUnique: vi.fn() },
    clienteBarberia: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    reserva: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn(),
      count: vi.fn(),
    },
    participanteReserva: { create: vi.fn() },
    participanteServicio: { createMany: vi.fn(), findMany: vi.fn() },
    servicio: { findMany: vi.fn() },
    servicioBarbero: { findMany: vi.fn() },
    barberia: { findUnique: vi.fn().mockResolvedValue({ zonaHoraria: 'America/Santo_Domingo' }) },
    usuarioRol: { findFirst: vi.fn(), findMany: vi.fn() },
    antecedente: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    $transaction: vi.fn(async (cb: any) => cb(mockPrisma)),
  };

  const usuario = (roles: string[], id: string): UsuarioAutenticado =>
    ({
      id,
      correo: `${id}@test.com`,
      roles,
      rolesDetallados: roles.map((nombre) => ({
        nombre,
        barberiaId: nombre === 'ADMINISTRADOR' ? null : SEDE,
        ambito: nombre === 'ADMINISTRADOR' ? 'GLOBAL' : 'BARBERIA',
      })),
    }) as UsuarioAutenticado;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockPrisma.reserva.findMany.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReservaService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: DisponibilidadService, useValue: { calcularDisponibilidad: vi.fn(), buscarAlternativas: vi.fn(async () => []) } },
        { provide: getQueueToken('reservas-pendientes'), useValue: { add: vi.fn(), getJob: vi.fn() } },
        { provide: getQueueToken('lista-espera'), useValue: { add: vi.fn() } },
        { provide: AuditoriaService, useValue: { registrarEvento: vi.fn() } },
        { provide: EventEmitter2, useValue: { emit: vi.fn() } },
      ],
    }).compile();

    service = module.get<ReservaService>(ReservaService);
  });

  it('el BARBERO recibe solo SUS turnos: la consulta viaja filtrada por su id del token', async () => {
    await service.obtenerAgendaDiaria(SEDE, '2026-11-20', usuario(['BARBERO'], BARBERO_ID));

    expect(mockPrisma.reserva.findMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.reserva.findMany.mock.calls[0][0].where).toMatchObject({
      barberiaId: SEDE,
      barberoId: BARBERO_ID,
    });
  });

  it('el ADMIN_BARBERIA sigue viendo toda la sede: la consulta NO lleva barberoId', async () => {
    await service.obtenerAgendaDiaria(SEDE, '2026-11-20', usuario(['ADMIN_BARBERIA'], 'cccccccc-3333-4333-8333-333333333333'));

    expect(mockPrisma.reserva.findMany).toHaveBeenCalledTimes(1);
    const where = mockPrisma.reserva.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ barberiaId: SEDE });
    expect(where).not.toHaveProperty('barberoId');
  });

  it('una cuenta con BARBERO y ADMIN_BARBERIA en la sede conserva la vista completa', async () => {
    await service.obtenerAgendaDiaria(SEDE, '2026-11-20', usuario(['BARBERO', 'ADMIN_BARBERIA'], BARBERO_ID));

    const where = mockPrisma.reserva.findMany.mock.calls[0][0].where;
    expect(where).not.toHaveProperty('barberoId');
  });
});
