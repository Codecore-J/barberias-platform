import { Module } from '@nestjs/common';
import { PagoService } from '../application/pago.service.js';
import { PagoController } from './pago.controller.js';
import { AuditoriaModule } from '../../auditoria/infrastructure/auditoria.module.js';

@Module({
  imports: [AuditoriaModule],
  controllers: [PagoController],
  providers: [PagoService],
  exports: [PagoService],
})
export class PagoModule {}
