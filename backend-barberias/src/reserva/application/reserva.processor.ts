import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { ExpiracionReservaService } from './expiracion-reserva.service.js';
import {
  JOBS,
  QUEUES,
  type ExpirarReservaJobPayload,
} from '../../shared/queues/queue.constants.js';

/**
 * E3-05 · Consumidor del job de expiración.
 *
 * La cola y el nombre del job salen de `queue.constants.ts`: antes eran dos
 * literales sueltos ('reservas-pendientes' / 'expirar-reserva') que había que
 * mantener sincronizados a mano con el productor (`ReservaService`) y con el
 * `registerQueue` del módulo. Ver HALLAZGO-E305-01.
 *
 * El processor no decide nada: delega en `ExpiracionReservaService`, que sí es
 * idempotente y comprueba estado y `expira_at` bajo la misma transacción.
 */
@Processor(QUEUES.RESERVAS)
export class ReservaProcessor extends WorkerHost {
  private readonly logger = new Logger(ReservaProcessor.name);

  constructor(private readonly expiracionService: ExpiracionReservaService) {
    super();
  }

  async process(job: Job<ExpirarReservaJobPayload>): Promise<string> {
    this.logger.log(`Procesando job ${job.id} de tipo ${job.name}`);

    if (job.name !== JOBS.EXPIRAR_RESERVA) {
      this.logger.warn(
        `Job ${job.name} no reconocido por ${ReservaProcessor.name}: se ignora sin reintento.`,
      );
      return 'JOB_DESCONOCIDO';
    }

    const reservaId = job.data?.reservaId;

    if (!reservaId) {
      this.logger.warn(
        `Job ${job.id} de ${JOBS.EXPIRAR_RESERVA} sin reservaId en el payload: se ignora.`,
      );
      return 'PAYLOAD_INVALIDO';
    }

    return this.expiracionService.expirarSiCorresponde(reservaId);
  }
}
