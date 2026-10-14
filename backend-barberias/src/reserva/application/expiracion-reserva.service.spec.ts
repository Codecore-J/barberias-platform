import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { describe, it, expect, beforeEach, beforeAll, vi, type MockInstance } from 'vitest';
import { getQueueToken } from '@nestjs/bullmq';
import {
  ESTADOS_EXPIRABLES,
  ExpiracionReservaService,
} from './expiracion-reserva.service.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { AuditoriaService } from '../../auditoria/application/auditoria.service.js';
import { NotificacionService } from '../../notificacion/application/notificacion.service.js';
import { QUEUES } from '../../shared/queues/queue.constants.js';
// H63: techo real del encolado best-effort que usa el servicio.
import { ENCOLADO_TIMEOUT_MS } from '../../shared/queues/encolado-seguro.js';

/** Reloj fijo: la expiración se mide contra `ahora`, nunca contra el reloj real. */
const AHORA = new Date('2026-10-10T12:00:00.000Z');
const UUID_RESERVA = 'b3b1b2a2-0000-4000-8000-000000000001';
const UUID_BARBERIA = 'a1a1a1a1-0000-4000-8000-000000000002';

function reserva(extra: Record<string, unknown> = {}) {
  return {
    id: UUID_RESERVA,
    barberiaId: UUID_BARBERIA,
    clienteId: 'uuid-cliente',
    estado: 'PENDIENTE',
    fechaCita: new Date('2026-10-11'),
    horaInicio: new Date('1970-01-01T10:00:00.000Z'),
    expiraAt: new Date('2026-10-10T11:59:00.000Z'), // un minuto antes de AHORA
    ...extra,
  };
}

describe('ExpiracionReservaService (E3-05)', () => {
  let service: ExpiracionReservaService;

  /**
   * H63 · La degradación de la cola se comunica por log; se captura aquí para no
   * ensuciar la salida y para poder afirmar que la advertencia se emite de
   * verdad (silenciar sin comprobar sería esconder la degradación).
   */
  let warnEspia: MockInstance;
  let errorEspia: MockInstance;

  beforeAll(() => {
    warnEspia = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    errorEspia = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  const mockPrisma = {
    reserva: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(async (cb: any) => cb(mockPrisma)),
  };

  const mockAuditoria = { registrarEvento: vi.fn() };
  const mockQueue = { getJob: vi.fn(), add: vi.fn() };
  const mockNotificacion = { enviarNotificacion: vi.fn() };

  beforeEach(async () => {
    vi.clearAllMocks();
    mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(mockPrisma));
    mockPrisma.reserva.updateMany.mockResolvedValue({ count: 1 });
    mockAuditoria.registrarEvento.mockResolvedValue({ id: 'uuid-auditoria' });
    mockQueue.getJob.mockResolvedValue(null);
    mockNotificacion.enviarNotificacion.mockResolvedValue({ id: 'uuid-notif' });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExpiracionReservaService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditoriaService, useValue: mockAuditoria },
        { provide: getQueueToken(QUEUES.RESERVAS), useValue: mockQueue },
        { provide: NotificacionService, useValue: mockNotificacion },
      ],
    }).compile();

    service = module.get<ExpiracionReservaService>(ExpiracionReservaService);
  });

  it('ROJO: una PENDIENTE con expira_at vencido pasa a EXPIRADA, libera el espacio y audita', async () => {
    mockPrisma.reserva.findUnique.mockResolvedValue(reserva());

    const resultado = await service.expirarSiCorresponde(UUID_RESERVA, AHORA);

    expect(resultado).toBe('EXPIRADA');
    expect(mockPrisma.reserva.updateMany).toHaveBeenCalledWith({
      where: {
        id: UUID_RESERVA,
        estado: { in: ['PENDIENTE', 'PROPUESTA_PENDIENTE'] },
        expiraAt: { lte: AHORA },
      },
      data: { estado: 'EXPIRADA' },
    });
    expect(mockAuditoria.registrarEvento).toHaveBeenCalledWith(
      expect.objectContaining({
        accion: 'RESERVA_EXPIRADA',
        entidad: 'Reserva',
        entidadId: UUID_RESERVA,
      }),
      expect.anything(),
    );
    expect(mockNotificacion.enviarNotificacion).toHaveBeenCalledWith(
      expect.objectContaining({ usuarioId: 'uuid-cliente', tipo: 'RESERVA_EXPIRADA' }),
    );
  });

  it('VERDE: ejecutar la expiración dos veces no cambia nada (idempotencia)', async () => {
    mockPrisma.reserva.findUnique.mockResolvedValueOnce(reserva());
    mockPrisma.reserva.findUnique.mockResolvedValue(reserva({ estado: 'EXPIRADA' }));

    expect(await service.expirarSiCorresponde(UUID_RESERVA, AHORA)).toBe('EXPIRADA');
    expect(await service.expirarSiCorresponde(UUID_RESERVA, AHORA)).toBe('NO_APLICA');

    expect(mockPrisma.reserva.updateMany).toHaveBeenCalledTimes(1);
    expect(mockAuditoria.registrarEvento).toHaveBeenCalledTimes(1);
    expect(mockNotificacion.enviarNotificacion).toHaveBeenCalledTimes(1);
  });

  it('ROJO: una reserva todavía vigente NO expira', async () => {
    mockPrisma.reserva.findUnique.mockResolvedValue(
      reserva({ expiraAt: new Date('2026-10-10T12:00:01.000Z') }),
    );

    expect(await service.expirarSiCorresponde(UUID_RESERVA, AHORA)).toBe('AUN_VIGENTE');
    expect(mockPrisma.reserva.updateMany).not.toHaveBeenCalled();
    expect(mockAuditoria.registrarEvento).not.toHaveBeenCalled();
  });

  it('ROJO: una CONFIRMADA no expira aunque su expira_at haya vencido', async () => {
    mockPrisma.reserva.findUnique.mockResolvedValue(reserva({ estado: 'CONFIRMADA' }));

    expect(await service.expirarSiCorresponde(UUID_RESERVA, AHORA)).toBe('NO_APLICA');
    expect(mockPrisma.reserva.updateMany).not.toHaveBeenCalled();
  });

  it('VERDE: una PROPUESTA_PENDIENTE vencida también expira', async () => {
    mockPrisma.reserva.findUnique.mockResolvedValue(
      reserva({ estado: 'PROPUESTA_PENDIENTE' }),
    );

    expect(await service.expirarSiCorresponde(UUID_RESERVA, AHORA)).toBe('EXPIRADA');
    expect(ESTADOS_EXPIRABLES).toContain('PROPUESTA_PENDIENTE');
  });

  it('ROJO: una reserva inexistente no rompe el job', async () => {
    mockPrisma.reserva.findUnique.mockResolvedValue(null);

    expect(await service.expirarSiCorresponde('uuid-inexistente', AHORA)).toBe('NO_EXISTE');
    expect(mockPrisma.reserva.updateMany).not.toHaveBeenCalled();
  });

  it('ROJO: si la reserva cambió de estado antes de expirar, no se audita nada', async () => {
    mockPrisma.reserva.findUnique.mockResolvedValue(reserva());
    // Aceptar/rechazar ganaron la carrera: el update condicionado no toca filas.
    mockPrisma.reserva.updateMany.mockResolvedValue({ count: 0 });

    expect(await service.expirarSiCorresponde(UUID_RESERVA, AHORA)).toBe('NO_APLICA');
    expect(mockAuditoria.registrarEvento).not.toHaveBeenCalled();
    expect(mockNotificacion.enviarNotificacion).not.toHaveBeenCalled();
  });

  describe('reconciliar (arranque)', () => {
    it('VERDE: expira las vencidas y reencola las vigentes SIN job, con el delay restante', async () => {
      const idVencida = 'uuid-vencida';
      const idVigente = 'uuid-vigente';

      // 1) Vencidas: solo la que vence antes de `ahora`.
      mockPrisma.reserva.findMany.mockImplementation(async (args: any) => {
        if (args.where.expiraAt.lte) {
          return [{ id: idVencida }];
        }
        return [
          {
            id: idVigente,
            barberiaId: UUID_BARBERIA,
            expiraAt: new Date('2026-10-10T12:05:00.000Z'),
          },
        ];
      });

      mockPrisma.reserva.findUnique.mockImplementation(async (args: any) =>
        args.where.id === idVencida
          ? reserva({ id: idVencida })
          : reserva({ id: idVigente, expiraAt: new Date('2026-10-10T12:05:00.000Z') }),
      );

      const resultado = await service.reconciliar(AHORA);

      expect(resultado).toEqual({ expiradas: 1, reencoladas: 1 });
      expect(mockQueue.add).toHaveBeenCalledWith(
        'expirar-reserva',
        { reservaId: idVigente, barberiaId: UUID_BARBERIA },
        { jobId: `expirar-reserva-${idVigente}`, delay: 5 * 60000 },
      );
    });

    it('ROJO: una vigente que ya tiene su job no se reencola', async () => {
      mockPrisma.reserva.findMany.mockImplementation(async (args: any) =>
        args.where.expiraAt.lte
          ? []
          : [
              {
                id: UUID_RESERVA,
                barberiaId: UUID_BARBERIA,
                expiraAt: new Date('2026-10-10T12:30:00.000Z'),
              },
            ],
      );
      mockQueue.getJob.mockResolvedValue({ id: `expirar-reserva-${UUID_RESERVA}` });

      const resultado = await service.reconciliar(AHORA);

      expect(resultado).toEqual({ expiradas: 0, reencoladas: 0 });
      expect(mockQueue.add).not.toHaveBeenCalled();
    });

    it('VERDE: el arranque no propaga errores de Redis (la app debe levantar igual)', async () => {
      mockPrisma.reserva.findMany.mockRejectedValue(new Error('Redis no disponible'));

      await expect(service.reconciliarEnArranque()).resolves.toBeUndefined();
    });

    it('H63: el hook de arranque NO espera a la reconciliación (no retrasa el listen)', () => {
      // Ni la BD ni Redis responden: antes, Nest esperaba a `onApplicationBootstrap`
      // —que corre dentro de `app.init()`, antes de `listen`— y la API no llegaba a
      // escuchar en absoluto.
      mockPrisma.reserva.findMany.mockImplementation(() => new Promise(() => {}));

      const inicio = Date.now();
      const devuelto: unknown = service.onApplicationBootstrap();

      expect(devuelto).toBeUndefined(); // hook síncrono: no hay promesa que Nest pueda esperar
      expect(Date.now() - inicio).toBeLessThan(500);
    });

    it('H63: una expiración no se cuelga si la notificación no puede encolarse', async () => {
      mockPrisma.reserva.findUnique.mockResolvedValue(reserva());
      mockNotificacion.enviarNotificacion.mockImplementation(() => new Promise(() => {}));
      vi.useFakeTimers();

      try {
        const promesa = service.expirarSiCorresponde(UUID_RESERVA, AHORA);
        await vi.advanceTimersByTimeAsync(ENCOLADO_TIMEOUT_MS + 1);

        // La reserva YA quedó EXPIRADA y el espacio liberado: la notificación es
        // secundaria y su cola muerta no puede reabrir la transacción.
        await expect(promesa).resolves.toBe('EXPIRADA');
        expect(mockNotificacion.enviarNotificacion).toHaveBeenCalledTimes(1);
        expect(warnEspia).toHaveBeenCalledWith(
          expect.stringContaining('No se pudo notificar la expiración'),
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it('H62: una reserva que no se puede reencolar no impide reencolar las siguientes', async () => {
      const idSinCola = 'uuid-sin-cola';
      const idConCola = 'uuid-con-cola';

      mockPrisma.reserva.findMany.mockImplementation(async (args: any) =>
        args.where.expiraAt.lte
          ? []
          : [
              {
                id: idSinCola,
                barberiaId: UUID_BARBERIA,
                expiraAt: new Date('2026-10-10T12:05:00.000Z'),
              },
              {
                id: idConCola,
                barberiaId: UUID_BARBERIA,
                expiraAt: new Date('2026-10-10T12:06:00.000Z'),
              },
            ],
      );
      mockQueue.getJob.mockResolvedValue(null);
      mockQueue.add
        .mockRejectedValueOnce(
          new Error('ERR max requests limit exceeded. Limit: 500000, Usage: 500001'),
        )
        .mockResolvedValueOnce({ id: `expirar-reserva-${idConCola}` });

      const resultado = await service.reconciliar(AHORA);

      // La segunda SÍ se reencola: antes, el fallo de la primera abortaba la
      // reconciliación entera y ninguna de las siguientes recibía su job.
      expect(resultado).toEqual({ expiradas: 0, reencoladas: 1 });
      expect(mockQueue.add).toHaveBeenCalledTimes(2);
    });
  });

  it('H63: `reconciliarEnArranque` registra la degradación sin lanzar', async () => {
    mockPrisma.reserva.findMany.mockRejectedValue(new Error('la base no está lista'));

    await service.reconciliarEnArranque();

    expect(warnEspia).toHaveBeenCalledWith(
      expect.stringContaining('No se pudo reconciliar las expiraciones al arrancar'),
    );
    expect(errorEspia).not.toHaveBeenCalled();
  });
});
