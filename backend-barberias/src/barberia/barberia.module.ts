import { Module } from '@nestjs/common';
import { BarberiaService } from './application/barberia.service.js';
import { BarberiaController } from './infrastructure/barberia.controller.js';
import { PlataformaVinculacionesController } from './infrastructure/plataforma-vinculaciones.controller.js';
import { SharedModule } from '../shared/shared.module.js';
// E3-12: la aprobación/rechazo de la 6ª vinculación notifican al cliente y
// auditan (VINCULACION_*), y `desvincular` decide con la zona de la sede.
import { AuditoriaModule } from '../auditoria/infrastructure/auditoria.module.js';
import { NotificacionModule } from '../notificacion/infrastructure/notificacion.module.js';

@Module({
  imports: [SharedModule, AuditoriaModule, NotificacionModule],
  controllers: [BarberiaController, PlataformaVinculacionesController],
  providers: [BarberiaService],
  exports: [BarberiaService],
})
export class BarberiaModule {}
