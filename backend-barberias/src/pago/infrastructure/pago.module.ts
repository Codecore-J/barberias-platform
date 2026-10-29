import { Module } from '@nestjs/common';
import { PagoService } from '../application/pago.service.js';
import { PagoController } from './pago.controller.js';
import { CobrosController } from './cobros.controller.js';
import { AuditoriaModule } from '../../auditoria/infrastructure/auditoria.module.js';

@Module({
  imports: [AuditoriaModule],
  // V3 fase 6: `CobrosController` es el `POST /pagos/cobrar` del modal de la
  // agenda; comparte `PagoService` para no tener dos reglas de cobro distintas.
  controllers: [PagoController, CobrosController],
  providers: [PagoService],
  exports: [PagoService],
})
export class PagoModule {}
