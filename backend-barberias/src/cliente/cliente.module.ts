import { Module } from '@nestjs/common';
import { ClienteController } from './infrastructure/cliente.controller.js';
import { ClienteService } from './application/cliente.service.js';
import { SharedModule } from '../shared/shared.module.js';

@Module({
  imports: [SharedModule],
  controllers: [ClienteController],
  providers: [ClienteService],
})
export class ClienteModule {}
