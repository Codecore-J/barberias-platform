import { Module } from '@nestjs/common';
import { AuditoriaModule } from '../../auditoria/infrastructure/auditoria.module.js';
import { AntecedenteService } from '../application/antecedente.service.js';
import { SolicitudAntecedenteService } from '../application/solicitud-antecedente.service.js';
import { AntecedenteController } from './antecedente.controller.js';
import {
  SolicitudAntecedenteClientesController,
  SolicitudAntecedenteGlobalController,
  SolicitudAntecedenteSedeController,
} from './solicitud-antecedente.controller.js';

@Module({
  imports: [AuditoriaModule],
  controllers: [
    AntecedenteController,
    SolicitudAntecedenteSedeController,
    SolicitudAntecedenteClientesController,
    SolicitudAntecedenteGlobalController,
  ],
  providers: [AntecedenteService, SolicitudAntecedenteService],
  exports: [AntecedenteService, SolicitudAntecedenteService],
})
export class AntecedenteModule {}
