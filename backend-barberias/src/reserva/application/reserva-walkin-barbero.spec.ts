import { Test, TestingModule } from '@nestjs/testing';
import { ReservaService } from './reserva.service.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { DisponibilidadService } from '../../agenda/application/disponibilidad.service.js';
import { getQueueToken } from '@nestjs/bullmq';
import { AuditoriaService } from '../../auditoria/application/auditoria.service.js';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { TiempoService, ZONA_POR_DEFECTO } from '../../shared/time/tiempo.service.js';

/**
 * F3-03 · el walk-in siempre lleva un barbero ACTIVO de la sede.
 *
 * El modal lo exige en el formulario, pero el contrato del backend dejaba
 * `barberoId` opcional: una petición directa podía abrir un turno sin columna
 * en la agenda, o asignarlo a alguien sin rol BARBERO en esa sede. La regla
 * vive donde se escribe, no solo en la pantalla.
 */
describe('ReservaService · barbero del walk-in (F3-03)', () => {
  const SEDE = 'aaaaaaaa-1111-4111-8111-111111111111';
  const OPERADOR = 'bbbbbbbb-2222-4222-8222-222222222222';
  const BARBERO = 'cccccccc-3333-4333-8333-333333333333';

  let service: ReservaService;

  const tiempoTest = new TiempoService();
  const enSede = (fecha: string, h: number, m = 0): Date =>
    tiempoTest.aInstante(
      fecha,
      `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
      ZONA_POR_DEFECTO,
    );

  const mockDisponibilidad = {
    calcularDisponibilidad: vi.fn(),
    buscarAlternativas: vi.fn(async () => []),
  };

  const mockPrisma = {
    $queryRaw: vi.fn().mockResolvedValue([]),
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
    barberia: { findUnique: vi.fn() },
    usuarioRol: { findFirst: vi.fn(), findMany: vi.fn() },
    antecedente: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    $transaction: vi.fn(async (cb: any) => cb(mockPrisma)),
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    mockPrisma.barberia.findUnique.mockResolvedValue({ estado: 'ACTIVO' });
    mockPrisma.clienteBarberia.findUnique.mockResolvedValue(null);
    mockPrisma.configuracionBarberia.findUnique.mockResolvedValue({
      modoReserva: 'MANUAL',
      nuevasReservasActivas: true,
      aceptaIndividual: true,
      margenGrupalMinutos: 10,
    });
    mockPrisma.servicio.findMany.mockResolvedValue([
      { id: 's1', precio: 15, duracionEstimada: 30, margenOperativo: 5 },
    ]);
    mockDisponibilidad.calcularDisponibilidad.mockResolvedValue([
      { inicio: enSede('2026-10-10', 9), fin: enSede('2026-10-10', 9, 40) },
    ]);
    mockPrisma.reserva.create.mockResolvedValue({ id: 'uuid-reserva' });
    mockPrisma.participanteReserva.create.mockResolvedValue({ id: 'uuid-part' });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReservaService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: DisponibilidadService, useValue: mockDisponibilidad },
        {
          provide: getQueueToken('reservas-pendientes'),
          useValue: { add: vi.fn(), getJob: vi.fn() },
        },
        { provide: getQueueToken('lista-espera'), useValue: { add: vi.fn() } },
        { provide: AuditoriaService, useValue: { registrarEvento: vi.fn() } },
        { provide: EventEmitter2, useValue: { emit: vi.fn() } },
      ],
    }).compile();

    service = module.get<ReservaService>(ReservaService);
  });

  const altaWalkIn = (barberoId?: string) =>
    service.crearReserva(
      OPERADOR,
      SEDE,
      {
        tipo: 'INDIVIDUAL',
        fecha: '2026-10-10',
        horaInicio: '09:00',
        horaFin: '09:30',
        serviciosIds: ['s1'],
        precioTotalEsperado: 15,
        barberoId,
        nombreInvitado: 'Cliente Sin App',
      },
      { operadorDeSede: true },
    );

  it('ROJO: sin barbero responde 422 BARBERO_REQUERIDO y no escribe nada', async () => {
    const error = await altaWalkIn().catch((e) => e);

    expect(error).toMatchObject({ response: { codigo: 'BARBERO_REQUERIDO' } });
    expect(mockPrisma.reserva.create).not.toHaveBeenCalled();
  });

  it('ROJO: un usuario sin rol BARBERO activo en la sede responde 422', async () => {
    mockPrisma.usuarioRol.findFirst.mockResolvedValue(null);

    const error = await altaWalkIn(BARBERO).catch((e) => e);

    expect(error).toMatchObject({
      response: { codigo: 'BARBERO_NO_PERTENECE_A_SEDE' },
    });
    expect(mockPrisma.reserva.create).not.toHaveBeenCalled();
  });

  it('ROJO: una cuenta suspendida responde 422 BARBERO_INACTIVO', async () => {
    mockPrisma.usuarioRol.findFirst.mockResolvedValue({
      usuario: { estadoCuenta: 'SUSPENDIDO' },
    });

    const error = await altaWalkIn(BARBERO).catch((e) => e);

    expect(error).toMatchObject({ response: { codigo: 'BARBERO_INACTIVO' } });
    expect(mockPrisma.reserva.create).not.toHaveBeenCalled();
  });

  it('control: con un barbero activo de la sede el turno se crea con su columna', async () => {
    mockPrisma.usuarioRol.findFirst.mockResolvedValue({
      usuario: { estadoCuenta: 'ACTIVO' },
    });

    await expect(altaWalkIn(BARBERO)).resolves.toMatchObject({ id: 'uuid-reserva' });

    expect(mockPrisma.usuarioRol.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          usuarioId: BARBERO,
          barberiaId: SEDE,
          estado: 'ACTIVO',
          rol: { nombre: 'BARBERO' },
        }),
      }),
    );
    expect(mockPrisma.reserva.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ barberoId: BARBERO }),
      }),
    );
  });

  it('control: el alta del CLIENTE sigue permitiendo una reserva sin barbero', async () => {
    mockPrisma.clienteBarberia.findUnique.mockResolvedValue({ estaRestringido: false });

    await expect(
      service.crearReserva(OPERADOR, SEDE, {
        tipo: 'INDIVIDUAL',
        fecha: '2026-10-10',
        horaInicio: '09:00',
        horaFin: '09:30',
        serviciosIds: ['s1'],
        precioTotalEsperado: 15,
      }),
    ).resolves.toMatchObject({ id: 'uuid-reserva' });

    expect(mockPrisma.usuarioRol.findFirst).not.toHaveBeenCalled();
  });
});
