import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  CADA_15_MINUTOS,
  RecordatoriosCronService,
} from './recordatorios-cron.service.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { TiempoService } from '../../shared/time/tiempo.service.js';
import { EVENTOS_RESERVA } from '../domain/eventos-reserva.js';

/**
 * Fase 7 · Barrido de recordatorios.
 *
 * El reloj se fija (2026-10-25T15:00Z) para que la ventana de 2 horas sea
 * determinista: en `America/Santo_Domingo` (UTC-4) son las 11:00 locales, así
 * que una cita a las 12:30 locales entra y una a las 15:30 no.
 */
const AHORA = new Date('2026-10-25T15:00:00Z');

/** Hora de reloj, como la escribe `parseTime` en una columna `TIME`. */
function hora(h: number, m: number): Date {
  const d = new Date('1970-01-01T00:00:00Z');
  d.setUTCHours(h, m, 0, 0);
  return d;
}

/** `DATE` tal como lo entrega Prisma: medianoche UTC de la etiqueta. */
const DIA = new Date('2026-10-25T00:00:00Z');

function fila(extra: Record<string, unknown> = {}) {
  return {
    id: 'reserva-1',
    barberiaId: 'barberia-1',
    clienteId: 'cliente-1',
    estado: 'CONFIRMADA',
    fechaCita: DIA,
    horaInicio: hora(12, 30),
    cliente: {
      nombreCompleto: 'Ana Pérez',
      correo: 'ana@test.com',
      telefono: '+18095550000',
    },
    barberia: {
      nombre: 'Sede Centro',
      telefono: '+18095551111',
      zonaHoraria: 'America/Santo_Domingo',
    },
    ...extra,
  };
}

describe('RecordatoriosCronService (Fase 7)', () => {
  let service: RecordatoriosCronService;

  const mockPrisma = {
    reserva: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
  };

  const mockEventEmitter = { emit: vi.fn() };

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecordatoriosCronService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventEmitter2, useValue: mockEventEmitter },
        { provide: TiempoService, useValue: new TiempoService(() => AHORA) },
      ],
    }).compile();

    service = module.get<RecordatoriosCronService>(RecordatoriosCronService);
  });

  it('corre cada 15 minutos (constante local: el enum de Nest 12 no la trae)', () => {
    expect(CADA_15_MINUTOS).toBe('0 */15 * * * *');
  });

  it('solo avisa de las citas que caen dentro de la ventana de 2 horas', async () => {
    mockPrisma.reserva.findMany.mockResolvedValue([
      fila({ id: 'en-ventana' }), // 12:30 SD = 16:30Z → +1 h 30 min
      fila({ id: 'demasiado-lejos', horaInicio: hora(15, 30) }), // 19:30Z → +4 h 30 min
      fila({ id: 'ya-pasada', horaInicio: hora(10, 0) }), // 14:00Z → −1 h
    ]);
    mockPrisma.reserva.updateMany.mockResolvedValue({ count: 1 });

    await expect(service.enviarRecordatorios()).resolves.toBe(1);

    expect(mockEventEmitter.emit).toHaveBeenCalledTimes(1);
    expect(mockEventEmitter.emit).toHaveBeenCalledWith(
      EVENTOS_RESERVA.RECORDATORIO,
      expect.objectContaining({
        tipo: EVENTOS_RESERVA.RECORDATORIO,
        reservaId: 'en-ventana',
        fechaCita: '2026-10-25',
        horaInicio: '12:30',
        nombreCliente: 'Ana Pérez',
        correoCliente: 'ana@test.com',
        telefonoCliente: '+18095550000',
        nombreBarberia: 'Sede Centro',
        horasAntelacion: 2,
      }),
    );

    // Solo se marca la que se avisó, y con el flag en el WHERE: esa condición
    // es la que impide el doble envío entre instancias.
    expect(mockPrisma.reserva.updateMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.reserva.updateMany).toHaveBeenCalledWith({
      where: { id: 'en-ventana', recordatorioEnviado: false },
      data: { recordatorioEnviado: true },
    });
  });

  it('consulta solo reservas vivas sin recordatorio (PENDIENTE/CONFIRMADA)', async () => {
    mockPrisma.reserva.findMany.mockResolvedValue([]);

    await service.enviarRecordatorios();

    expect(mockPrisma.reserva.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          estado: { in: ['PENDIENTE', 'CONFIRMADA'] },
          recordatorioEnviado: false,
        }),
      }),
    );
  });

  it('no repite el aviso si otra ejecución ya marcó la reserva (count = 0)', async () => {
    mockPrisma.reserva.findMany.mockResolvedValue([fila()]);
    mockPrisma.reserva.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.enviarRecordatorios()).resolves.toBe(0);
    expect(mockEventEmitter.emit).not.toHaveBeenCalled();
  });

  it('mide la ventana con la zona de la SEDE, no con la del servidor', async () => {
    // Misma etiqueta 12:30: en UTC ya pasó (−2 h 30 min), en Santo Domingo
    // todavía entra (+1 h 30 min). El aviso tiene que salir solo para la sede
    // cuya zona lo convierte en una cita próxima (E2-04/H36).
    mockPrisma.reserva.findMany.mockResolvedValue([
      fila({
        id: 'sede-utc',
        barberia: {
          nombre: 'Sede UTC',
          telefono: '+18095552222',
          zonaHoraria: 'UTC',
        },
      }),
      fila({ id: 'sede-sd' }),
    ]);
    mockPrisma.reserva.updateMany.mockResolvedValue({ count: 1 });

    await expect(service.enviarRecordatorios()).resolves.toBe(1);

    expect(mockEventEmitter.emit).toHaveBeenCalledTimes(1);
    expect(mockEventEmitter.emit).toHaveBeenCalledWith(
      EVENTOS_RESERVA.RECORDATORIO,
      expect.objectContaining({ reservaId: 'sede-sd' }),
    );
    expect(mockPrisma.reserva.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'sede-sd', recordatorioEnviado: false } }),
    );
  });

  it('un fallo en una reserva no deja sin aviso al resto del lote', async () => {
    mockPrisma.reserva.findMany.mockResolvedValue([
      fila({ id: 'falla' }),
      fila({ id: 'sigue' }),
    ]);
    mockPrisma.reserva.updateMany
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce({ count: 1 });

    await expect(service.enviarRecordatorios()).resolves.toBe(1);
    expect(mockEventEmitter.emit).toHaveBeenCalledTimes(1);
    expect(mockEventEmitter.emit).toHaveBeenCalledWith(
      EVENTOS_RESERVA.RECORDATORIO,
      expect.objectContaining({ reservaId: 'sigue' }),
    );
  });

  it('si la base falla, el barrido no lanza y devuelve 0', async () => {
    mockPrisma.reserva.findMany.mockRejectedValue(new Error('sin conexión'));

    await expect(service.enviarRecordatorios()).resolves.toBe(0);
    expect(mockEventEmitter.emit).not.toHaveBeenCalled();
  });
});
