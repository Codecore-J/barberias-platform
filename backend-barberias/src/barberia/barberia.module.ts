import { Module } from '@nestjs/common';
import { BarberiaService } from './application/barberia.service.js';
import { BarberiaController } from './infrastructure/barberia.controller.js';
import { ConfiguracionBarberiaController } from './infrastructure/configuracion-barberia.controller.js';
import { ConfiguracionBarberiaService } from './application/configuracion-barberia.service.js';
import { SolicitudCambioService } from './application/solicitud-cambio.service.js';
import { ClientesRestringidosController } from './infrastructure/clientes-restringidos.controller.js';
import { ClientesRestringidosService } from './application/clientes-restringidos.service.js';
import { MiEstadoController } from './infrastructure/mi-estado.controller.js';
import { MiEstadoService } from './application/mi-estado.service.js';
import { PlataformaSolicitudesCambioController } from './infrastructure/plataforma-solicitudes-cambio.controller.js';
import { PlataformaVinculacionesController } from './infrastructure/plataforma-vinculaciones.controller.js';
import { VinculacionService } from './application/vinculacion.service.js';
import { AuditoriaModule } from '../auditoria/infrastructure/auditoria.module.js';
// E3-12: aprobar o rechazar la 6.ª vinculación avisa al cliente. La cola es
// best-effort (`@Optional` en el servicio), pero el módulo tiene que exponerla.
import { NotificacionModule } from '../notificacion/infrastructure/notificacion.module.js';
import { SharedModule } from '../shared/shared.module.js';

@Module({
  imports: [SharedModule, AuditoriaModule, NotificacionModule],
  controllers: [
    BarberiaController,
    ConfiguracionBarberiaController,
    // E4-03: bandeja local de clientes restringidos (listar y reactivar).
    ClientesRestringidosController,
    // H54 (E4-03/2): el cliente ve su propio contador, su advertencia y su
    // restricción sin depender del staff.
    MiEstadoController,
    PlataformaSolicitudesCambioController,
    // E3-12: bandeja de plataforma de la 6.ª vinculación (D10).
    PlataformaVinculacionesController,
  ],
  providers: [
    BarberiaService,
    ConfiguracionBarberiaService,
    SolicitudCambioService,
    ClientesRestringidosService,
    MiEstadoService,
    VinculacionService,
  ],
  exports: [
    BarberiaService,
    ConfiguracionBarberiaService,
    SolicitudCambioService,
    ClientesRestringidosService,
    MiEstadoService,
    VinculacionService,
  ],
})
export class BarberiaModule {}
