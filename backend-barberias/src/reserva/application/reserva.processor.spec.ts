import { Test, TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ReservaProcessor } from './reserva.processor.js';
import { ExpiracionReservaService } from './expiracion-reserva.service.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { AuditoriaService } from '../../auditoria/application/auditoria.service.js';

/**
 * E3-05 · El consumidor no decide: delega (E3-05 §2).
 *
 * Se declaran AMBOS proveedores a propósito: así el fichero se puede ejecutar
 * igual contra la versión anterior del processor (que se construía con
 * `PrismaService`) y las aserciones miden lo que de verdad cambia la tarea:
 * que el job se reconozca por su nombre real y que la decisión esté delegada.
 */
describe('ReservaProcessor (E3-05)', () => {
  let processor: ReservaProcessor;

  const mockExpiracionService = {
    expirarSiCorresponde: vi.fn(),
  };

  const mockPrisma = {
    reserva: { findUnique: vi.fn(), update: vi.fn() },
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReservaProcessor,
        { provide: ExpiracionReservaService, useValue: mockExpiracionService },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditoriaService, useValue: { registrarEvento: vi.fn() } },
      ],
    }).compile();

    processor = module.get<ReservaProcessor>(ReservaProcessor);
  });

  it('VERDE: un job de expiración delega en el servicio idempotente y devuelve su resultado', async () => {
    mockExpiracionService.expirarSiCorresponde.mockResolvedValue('EXPIRADA');

    const resultado = await processor.process({
      id: 'job-1',
      name: 'expirar-reserva',
      data: { reservaId: 'uuid-reserva', barberiaId: 'uuid-barberia' },
    } as any);

    expect(resultado).toBe('EXPIRADA');
    expect(mockExpiracionService.expirarSiCorresponde).toHaveBeenCalledWith('uuid-reserva');
    // La decisión NO se duplica en el consumidor.
    expect(mockPrisma.reserva.update).not.toHaveBeenCalled();
  });

  it('ROJO: un job con otro nombre se ignora sin tocar la base', async () => {
    const resultado = await processor.process({
      id: 'job-2',
      name: 'otro-job',
      data: { reservaId: 'uuid-reserva' },
    } as any);

    expect(resultado).toBe('JOB_DESCONOCIDO');
    expect(mockExpiracionService.expirarSiCorresponde).not.toHaveBeenCalled();
  });

  it('ROJO: un job de expiración sin reservaId no expira nada', async () => {
    const resultado = await processor.process({
      id: 'job-3',
      name: 'expirar-reserva',
      data: {} as any,
    } as any);

    expect(resultado).toBe('PAYLOAD_INVALIDO');
    expect(mockExpiracionService.expirarSiCorresponde).not.toHaveBeenCalled();
  });
});
