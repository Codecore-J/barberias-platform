import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { SolicitudCambioService } from '../application/solicitud-cambio.service.js';
import { ListarSolicitudesCambioDto } from '../application/dto/listar-solicitudes-cambio.dto.js';
import { ResolverSolicitudCambioDto } from '../application/dto/resolver-solicitud-cambio.dto.js';
import { Roles } from '../../iam/infrastructure/roles.decorator.js';
import { CurrentUser } from '../../iam/infrastructure/current-user.decorator.js';
import type { UsuarioAutenticado } from '../../iam/domain/jwt.interface.js';

/**
 * E3-13 · bandeja de plataforma de las solicitudes de cambio (D26).
 *
 * Rutas globales bajo `/plataforma/*` solo para el ADMINISTRADOR (D05): ni la
 * sede ni el cliente pueden listar o resolver solicitudes de otras sedes. El
 * `RolesGuard` concede el paso al ADMINISTRADOR global y deniega al resto
 * (fail-closed): ninguna de las dos rutas declara `@Public` ni `@Autenticado`.
 */
@Controller('plataforma/solicitudes-cambio')
export class PlataformaSolicitudesCambioController {
  constructor(private readonly solicitudCambioService: SolicitudCambioService) {}

  /** GET /plataforma/solicitudes-cambio · listado paginado (D32). */
  @Roles('ADMINISTRADOR')
  @Get()
  listar(@Query() dto: ListarSolicitudesCambioDto) {
    return this.solicitudCambioService.listar(dto);
  }

  /**
   * POST /plataforma/solicitudes-cambio/:id/resolver
   * `{ aprobar: boolean, motivoRechazo?: string }`. Al aprobar un cambio de
   * responsable, el servicio mueve responsable_id, el rol ADMIN_BARBERIA y la
   * auditoría en una sola transacción.
   */
  @Roles('ADMINISTRADOR')
  @Post(':id/resolver')
  resolver(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolverSolicitudCambioDto,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.solicitudCambioService.resolver(id, user, dto);
  }
}
