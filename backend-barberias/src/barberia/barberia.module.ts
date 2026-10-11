import { Module } from '@nestjs/common';
import { BarberiaService } from './application/barberia.service.js';
import { BarberiaController } from './infrastructure/barberia.controller.js';
import { ConfiguracionBarberiaController } from './infrastructure/configuracion-barberia.controller.js';
import { ConfiguracionBarberiaService } from './application/configuracion-barberia.service.js';
import { SolicitudCambioService } from './application/solicitud-cambio.service.js';
import { PlataformaSolicitudesCambioController } from './infrastructure/plataforma-solicitudes-cambio.controller.js';
import { AuditoriaModule } from '../auditoria/infrastructure/auditoria.module.js';
import { SharedModule } from '../shared/shared.module.js';

@Module({
  imports: [SharedModule, AuditoriaModule],
  controllers: [
    BarberiaController,
    ConfiguracionBarberiaController,
    PlataformaSolicitudesCambioController,
  ],
  providers: [BarberiaService, ConfiguracionBarberiaService, SolicitudCambioService],
  exports: [BarberiaService, ConfiguracionBarberiaService, SolicitudCambioService],
})
export class BarberiaModule {}
