import { Module } from '@nestjs/common';
import { AuditoriaModule } from '../../auditoria/infrastructure/auditoria.module.js';
import { SolicitudAntecedenteService } from '../application/solicitud-antecedente.service.js';
import {
  SolicitudAntecedenteClientesController,
  SolicitudAntecedenteGlobalController,
  SolicitudAntecedenteSedeController,
} from './solicitud-antecedente.controller.js';

@Module({
  imports: [AuditoriaModule],
  controllers: [
    SolicitudAntecedenteSedeController,
    SolicitudAntecedenteClientesController,
    SolicitudAntecedenteGlobalController,
  ],
  providers: [SolicitudAntecedenteService],
  exports: [SolicitudAntecedenteService],
})
export class AntecedenteModule {}
