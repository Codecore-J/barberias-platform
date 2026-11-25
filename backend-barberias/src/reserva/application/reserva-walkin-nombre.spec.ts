import { Test, TestingModule } from '@nestjs/testing';
import { ReservaService } from './reserva.service.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { DisponibilidadService } from '../../agenda/application/disponibilidad.service.js';
import { getQueueToken } from '@nestjs/bullmq';
import { AuditoriaService } from '../../auditoria/application/auditoria.service.js';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { UsuarioAutenticado } from '../../iam/domain/jwt.interface.js';
import { TiempoService, ZONA_POR_DEFECTO } from '../../shared/time/tiempo.service.js';

/**
 * F3-01 · el walk-in conserva el nombre del cliente.
 *
 * QA2-03: el operador teclea «Cliente Sin App» en el modal, pero la agenda
 * pinta el nombre de la CUENTA del operador porque `reservas.cliente_id` es el
 * staff (T-05). El nombre viaja a `participante_reserva`, pero no a la reserva,
 * así que la pantalla no tiene de dónde leerlo.
 *
 * La prueba fija el contrato en los dos extremos:
 *  - el alta del mostrador persiste `nombreInvitado` (recortado, vacío → null);
 *  - la agenda diaria lo prefiere sobre el nombre de la cuenta y marca el turno
 *    como walk-in, para que la UI no abra la ficha del operador.
 */
describe('ReservaService · nombre del walk-in (F3-01)', () => {
  const SEDE = 'aaaaaaaa-1111-4111-8111-111111111111';
  const OPERADOR = 'bbbbbbbb-2222-4222-8222-222222222222';

  let service: ReservaService;

  const hora = (h: number, m: number): Date => {
    const d = new Date('1970-01-01T00:00:00Z');
    d.setUTCHours(h, m, 0, 0);
    return d;
  };

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
    barberia: { findUnique: vi.fn() },
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

  describe('el alta del mostrador', () => {
    function prepararAltaWalkIn() {
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
      mockPrisma.$queryRaw.mockResolvedValue([]);
      // F3-03 · el walk-in exige un barbero activo de la sede.
      mockPrisma.usuarioRol.findFirst.mockResolvedValue({
        usuario: { estadoCuenta: 'ACTIVO' },
      });
      // El bloque individual = ventana pedida (30) + margen de la sede (10).
      mockDisponibilidad.calcularDisponibilidad.mockResolvedValue([
        { inicio: enSede('2026-10-10', 9), fin: enSede('2026-10-10', 9, 40) },
      ]);
      mockPrisma.reserva.create.mockResolvedValue({ id: 'uuid-reserva' });
      mockPrisma.participanteReserva.create.mockResolvedValue({ id: 'uuid-part' });
    }

    const alta = (nombreInvitado?: string) =>
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
          barberoId: 'cccccccc-3333-4333-8333-333333333333',
          nombreInvitado,
        },
        { operadorDeSede: true },
      );

    it('ROJO: persiste el nombre tecleado en reservas.nombre_invitado', async () => {
      prepararAltaWalkIn();

      await expect(alta('Cliente Sin App')).resolves.toMatchObject({ id: 'uuid-reserva' });

      expect(mockPrisma.reserva.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ nombreInvitado: 'Cliente Sin App' }),
        }),
      );
    });

    it('ROJO: recorta espacios y guarda null cuando el nombre llega vacío', async () => {
      prepararAltaWalkIn();

      await alta('   ');

      expect(mockPrisma.reserva.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ nombreInvitado: null }),
        }),
      );
    });

    it('control: el alta del cliente (sin operadorDeSede) nunca escribe nombreInvitado', async () => {
      prepararAltaWalkIn();
      mockPrisma.clienteBarberia.findUnique.mockResolvedValue({ estaRestringido: false });

      await service.crearReserva(OPERADOR, SEDE, {
        tipo: 'INDIVIDUAL',
        fecha: '2026-10-10',
        horaInicio: '09:00',
        horaFin: '09:30',
        serviciosIds: ['s1'],
        precioTotalEsperado: 15,
        nombreInvitado: 'No debería guardarse',
      });

      expect(mockPrisma.reserva.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ nombreInvitado: null }),
        }),
      );
    });
  });

  describe('la agenda diaria', () => {
    const reservaBase = {
      id: 'uuid-reserva',
      estado: 'CONFIRMADA',
      fechaCita: new Date('2026-11-20T00:00:00.000Z'),
      horaInicio: hora(10, 0),
      totalPagar: 15,
      nombreInvitado: 'Cliente Sin App',
      cliente: {
        id: OPERADOR,
        nombreCompleto: 'Operador del Mostrador',
        correo: 'operador@test.com',
        telefono: '8090000000',
        clienteBarberias: [],
      },
      barbero: { id: 'barbero-1', nombreCompleto: 'Barbero Uno' },
      participantes: [],
    };

    it('ROJO: prefiere el nombre del walk-in y marca el turno como tal', async () => {
      mockPrisma.barberia.findUnique.mockResolvedValue({ zonaHoraria: ZONA_POR_DEFECTO });
      mockPrisma.reserva.findMany.mockResolvedValue([reservaBase]);

      const turnos = await service.obtenerAgendaDiaria(
        SEDE,
        '2026-11-20',
        usuario(['ADMIN_BARBERIA'], OPERADOR),
      );

      expect(turnos[0].cliente.nombre).toBe('Cliente Sin App');
      expect(turnos[0].esWalkIn).toBe(true);
    });

    it('control: una reserva normal conserva el nombre de la cuenta y no es walk-in', async () => {
      mockPrisma.barberia.findUnique.mockResolvedValue({ zonaHoraria: ZONA_POR_DEFECTO });
      mockPrisma.reserva.findMany.mockResolvedValue([
        { ...reservaBase, nombreInvitado: null },
      ]);

      const turnos = await service.obtenerAgendaDiaria(
        SEDE,
        '2026-11-20',
        usuario(['ADMIN_BARBERIA'], OPERADOR),
      );

      expect(turnos[0].cliente.nombre).toBe('Operador del Mostrador');
      expect(turnos[0].esWalkIn).toBe(false);
    });
  });
});
