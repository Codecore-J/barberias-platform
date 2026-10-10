import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { JOBS, QUEUES, jobIdExpiracionReserva } from './queue.constants.js';
import { ReservaProcessor } from '../../reserva/application/reserva.processor.js';

/**
 * E3-05 · Contrato con BullMQ (HALLAZGO-E305-01).
 *
 * Estas constantes declaraban `queue:reservas` / `job:expirar-reserva`, valores
 * que BullMQ NO acepta: rechaza cualquier nombre de cola con ':' y cualquier
 * `jobId` propio con ':'. Este fichero fija el contrato para que la deuda no
 * vuelva: los valores tienen que ser nombres utilizables y tienen que coincidir
 * con los que usan de verdad el productor, el consumidor y el módulo.
 */
describe('E3-05 · constantes de colas y jobs', () => {
  const PROCESSOR_METADATA = 'bullmq:processor_metadata';

  it('ningún nombre de cola contiene ":" (BullMQ lanza "Queue name cannot contain :")', () => {
    for (const [clave, nombre] of Object.entries(QUEUES)) {
      expect(`${nombre.includes(':') ? `QUEUES.${clave}=${nombre} contiene ':'` : ''}`).toBe('');
    }
  });

  it('ningún nombre de job ni jobId determinista contiene ":"', () => {
    for (const [clave, nombre] of Object.entries(JOBS)) {
      expect(`${nombre.includes(':') ? `JOBS.${clave}=${nombre} contiene ':'` : ''}`).toBe('');
    }

    expect(jobIdExpiracionReserva('1111').includes(':')).toBe(false);
  });

  it('los valores son los nombres REALES que viajan por Redis (renombrarlos huérfana jobs)', () => {
    expect(QUEUES.RESERVAS).toBe('reservas-pendientes');
    expect(QUEUES.NOTIFICACIONES).toBe('notificaciones');
    expect(QUEUES.AUDITORIA).toBe('auditoria-purga');
    expect(QUEUES.BLOQUEOS).toBe('agenda-bloqueos');
    expect(JOBS.EXPIRAR_RESERVA).toBe('expirar-reserva');
  });

  it('el consumidor declara exactamente la misma cola que la constante', () => {
    // @Processor(QUEUES.RESERVAS) guarda `{ name }` como metadata del worker.
    const metadata = Reflect.getMetadata(PROCESSOR_METADATA, ReservaProcessor);

    expect(metadata?.name).toBe(QUEUES.RESERVAS);
  });

  it('el jobId de expiración es determinista, estable y derivado del nombre real del job', () => {
    const id = 'b3b1b2a2-0000-4000-8000-000000000001';

    expect(jobIdExpiracionReserva(id)).toBe(`${JOBS.EXPIRAR_RESERVA}-${id}`);
    expect(jobIdExpiracionReserva(id)).toBe(jobIdExpiracionReserva(id));
    expect(jobIdExpiracionReserva(id)).toContain(id);
  });
});
