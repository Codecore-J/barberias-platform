import { Module } from '@nestjs/common';
import { CajaService } from '../application/caja.service.js';
import { CajaController } from './caja.controller.js';
import { SharedModule } from '../../shared/shared.module.js';
import { AuditoriaModule } from '../../auditoria/infrastructure/auditoria.module.js';

@Module({
  imports: [SharedModule, AuditoriaModule],
  controllers: [CajaController],
  providers: [CajaService],
  exports: [CajaService],
})
export class CajaModule {}
