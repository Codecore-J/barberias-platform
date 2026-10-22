import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import {
  JOBS,
  QUEUES,
  type HuecoLiberadoJobPayload,
} from '../../shared/queues/queue.constants.js';
import { ListaEsperaMatcherService } from './lista-espera.matcher.service.js';

/**
 * E4-02 · D22 · Carril B: consumidor de `HuecoLiberadoJobPayload`.
 *
 * La cola y el nombre del job salen de `queue.constants.ts`, igual que en
 * `ReservaProcessor` (HALLAZGO-E305-01: nada de literales duplicados entre el
 * productor, el consumidor y el `registerQueue` del módulo).
 *
 * El processor no decide NADA: valida el payload y delega en el matcher, que es
 * el único sitio que conoce la regla del FIFO y del margen.
 */
@Processor(QUEUES.LISTA_ESPERA)
export class ListaEsperaProcessor extends WorkerHost {
  private readonly logger = new Logger(ListaEsperaProcessor.name);

  constructor(private readonly matcher: ListaEsperaMatcherService) {
    super();
  }

  async process(job: Job<HuecoLiberadoJobPayload>) {
    this.logger.log(`Procesando job ${job.id} de tipo ${job.name}`);

    if (job.name !== JOBS.HUECO_LIBERADO) {
      this.logger.warn(
        `Job ${job.name} no reconocido por ${ListaEsperaProcessor.name}: se ignora sin reintento.`,
      );
      return 'JOB_DESCONOCIDO';
    }

    const data = job.data ?? ({} as HuecoLiberadoJobPayload);

    if (!data.barberiaId || !data.fecha || !data.inicio || !data.fin) {
      this.logger.warn(
        `Job ${job.id} de ${JOBS.HUECO_LIBERADO} sin barberiaId/fecha/inicio/fin: se ignora.`,
      );
      return 'PAYLOAD_INVALIDO';
    }

    return this.matcher.procesarHuecoLiberado(data);
  }
}
