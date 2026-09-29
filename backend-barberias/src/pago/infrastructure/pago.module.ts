import { Module } from '@nestjs/common';
import { PagoService } from '../application/pago.service.js';
import { PagoController } from './pago.controller.js';

@Module({
  controllers: [PagoController],
  providers: [PagoService],
  exports: [PagoService],
})
export class PagoModule {}
