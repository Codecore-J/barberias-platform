import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { SolicitudAntecedenteService } from '../application/solicitud-antecedente.service.js';
import {
  CrearSolicitudAntecedenteDto,
  ResolverSolicitudAntecedenteDto,
} from '../application/dto/solicitud-antecedente.dto.js';
import { CurrentUser } from '../../iam/infrastructure/current-user.decorator.js';
import type { UsuarioAutenticado } from '../../iam/domain/jwt.interface.js';
import { Roles } from '../../iam/infrastructure/roles.decorator.js';

/**
 * F5 / T-52 · el personal de la sede pide el antecedente.
 *
 * La sede sale de la ruta y el solicitante del token: un barbero no puede pedir
 * «en nombre de» un compañero. La bandeja la filtra el servicio por rol.
 */
@Controller('shops/:shopId/antecedentes/solicitudes')
export class SolicitudAntecedenteSedeController {
  constructor(private readonly solicitudes: SolicitudAntecedenteService) {}

  @Roles('ADMIN_BARBERIA', 'BARBERO')
  @Post()
  crear(
    @Param('shopId', ParseUUIDPipe) barberiaId: string,
    @Body() dto: CrearSolicitudAntecedenteDto,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.solicitudes.crear(user.id, barberiaId, dto);
  }

  @Roles('ADMIN_BARBERIA', 'BARBERO')
  @Get()
  listar(
    @Param('shopId', ParseUUIDPipe) barberiaId: string,
    @CurrentUser() user: UsuarioAutenticado,
    @Query('estado') estado?: string,
  ) {
    return this.solicitudes.listar(user.id, barberiaId, estado);
  }
}

/**
 * F5 / T-55 · clientes que el formulario puede ofrecer en esta sede.
 */
@Controller('shops/:shopId/antecedentes/clientes')
export class SolicitudAntecedenteClientesController {
  constructor(private readonly solicitudes: SolicitudAntecedenteService) {}

  @Roles('ADMIN_BARBERIA', 'BARBERO')
  @Get()
  listar(
    @Param('shopId', ParseUUIDPipe) barberiaId: string,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.solicitudes.listarClientes(user.id, barberiaId);
  }
}

/**
 * F5 / T-53 · la plataforma resuelve. Ruta global, sin sede: la petición ya
 * lleva su `barberia_id` y el ADMINISTRADOR decide sobre toda la plataforma.
 */
@Controller('antecedentes/solicitudes')
export class SolicitudAntecedenteGlobalController {
  constructor(private readonly solicitudes: SolicitudAntecedenteService) {}

  @Roles('ADMINISTRADOR')
  @Get()
  listarPendientes(@CurrentUser() user: UsuarioAutenticado) {
    return this.solicitudes.listarPendientesGlobal(user.id);
  }

  @Roles('ADMINISTRADOR')
  @Patch(':id')
  resolver(
    @Param('id', ParseUUIDPipe) solicitudId: string,
    @Body() dto: ResolverSolicitudAntecedenteDto,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.solicitudes.resolver(user.id, solicitudId, dto);
  }
}
