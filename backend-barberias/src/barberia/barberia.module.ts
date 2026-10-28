import { Module } from '@nestjs/common';
import { BarberiaService } from './application/barberia.service.js';
import { BarberiaController } from './infrastructure/barberia.controller.js';
import { ConfiguracionBarberiaController } from './infrastructure/configuracion-barberia.controller.js';
import { ConfiguracionBarberiaService } from './application/configuracion-barberia.service.js';
import { SolicitudCambioService } from './application/solicitud-cambio.service.js';
import { ClientesRestringidosController } from './infrastructure/clientes-restringidos.controller.js';
import { ClientesRestringidosService } from './application/clientes-restringidos.service.js';
import { MiEstadoController } from './infrastructure/mi-estado.controller.js';
import { MiEstadoBarberiasController } from './infrastructure/mi-estado-barberias.controller.js';
import { MiEstadoService } from './application/mi-estado.service.js';
import { ClienteBarberiasService } from './application/cliente-barberias.service.js';
import { PlataformaSolicitudesCambioController } from './infrastructure/plataforma-solicitudes-cambio.controller.js';
import { PlataformaVinculacionesController } from './infrastructure/plataforma-vinculaciones.controller.js';
import { VinculacionService } from './application/vinculacion.service.js';
import { AuditoriaModule } from '../auditoria/infrastructure/auditoria.module.js';
// E3-12: aprobar o rechazar la 6.ª vinculación avisa al cliente. La cola es
// best-effort (`@Optional` en el servicio), pero el módulo tiene que exponerla.
import { NotificacionModule } from '../notificacion/infrastructure/notificacion.module.js';
import { SharedModule } from '../shared/shared.module.js';
// E4-04: `GET /shops/overview` se declara en `BarberiaController` para que la
// ruta estática quede registrada antes de `/shops/:shopId`. Solo aporta el
// `AnalyticsService`.
import { AnalyticsModule } from '../analytics/analytics.module.js';

@Module({
  imports: [SharedModule, AuditoriaModule, NotificacionModule, AnalyticsModule],
  controllers: [
    BarberiaController,
    ConfiguracionBarberiaController,
    // E4-03: bandeja local de clientes restringidos (listar y reactivar).
    ClientesRestringidosController,
    // H54 (E4-03/2): el cliente ve su propio contador, su advertencia y su
    // restricción sin depender del staff.
    MiEstadoController,
    // H72: las sedes propias del CLIENTE (`GET /mi-estado/barberias`).
    MiEstadoBarberiasController,
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
    ClienteBarberiasService,
    VinculacionService,
  ],
  exports: [
    BarberiaService,
    ConfiguracionBarberiaService,
    SolicitudCambioService,
    ClientesRestringidosService,
    MiEstadoService,
    ClienteBarberiasService,
    VinculacionService,
  ],
})
export class BarberiaModule {}
