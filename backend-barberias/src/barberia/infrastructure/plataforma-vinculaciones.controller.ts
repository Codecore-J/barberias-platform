import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { VinculacionService } from '../application/vinculacion.service.js';
import { ListarVinculacionesPendientesDto } from '../application/dto/listar-vinculaciones-pendientes.dto.js';
import { RechazarVinculacionDto } from '../application/dto/rechazar-vinculacion.dto.js';
import { Roles } from '../../iam/infrastructure/roles.decorator.js';
import { CurrentUser } from '../../iam/infrastructure/current-user.decorator.js';
import type { UsuarioAutenticado } from '../../iam/domain/jwt.interface.js';

/**
 * E3-12 · bandeja de plataforma de la 6.ª vinculación (D10 · H67).
 *
 * El límite de D10 se cuenta por USUARIO, no por sede: la sexta vinculación de
 * una persona es una decisión de plataforma, y resolverla es del ADMINISTRADOR
 * global (D05), igual que la bandeja de solicitudes de cambio (E3-13) y el
 * estado de las cuentas (E4-03/5). La sede no entra aquí: es parte interesada,
 * y un `ADMIN_BARBERIA` aprobando su propia solicitud convertiría el límite en
 * un trámite.
 *
 * Las tres rutas declaran `@Roles('ADMINISTRADOR')` y el `RolesGuard` deniega a
 * los demás roles por fail-closed (H21): ninguna declara `@Public` ni
 * `@Autenticado`.
 *
 * Responden 200, no 201: no crean recursos, resuelven un estado existente (mismo
 * criterio que `POST /plataforma/solicitudes-cambio/:id/resolver` y
 * `POST /barberias/:id/clientes/:clienteId/reactivar`).
 */
@Controller('plataforma/vinculaciones')
export class PlataformaVinculacionesController {
  constructor(private readonly vinculacionService: VinculacionService) {}

  /**
   * GET /plataforma/vinculaciones/pendientes
   * Listado paginado (D32) de los clientes que esperan aprobación, con su sede
   * y el número de vínculos que ya acumulan. Filtro opcional `barberiaId`.
   */
  @Roles('ADMINISTRADOR')
  @Get('pendientes')
  listar(@Query() dto: ListarVinculacionesPendientesDto) {
    return this.vinculacionService.listarPendientes(dto);
  }

  /**
   * POST /plataforma/vinculaciones/:id/aprobar
   * La vinculación pasa a `ACTIVO`: a partir de ahí el cliente opera con
   * normalidad en esa sede. Auditado (`VINCULACION_APROBADA`).
   */
  @Roles('ADMINISTRADOR')
  @Post(':id/aprobar')
  @HttpCode(HttpStatus.OK)
  aprobar(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.vinculacionService.aprobar(id, user);
  }

  /**
   * POST /plataforma/vinculaciones/:id/rechazar
   * El vínculo queda `DESVINCULADO` con el motivo obligatorio (422
   * `MOTIVO_REQUERIDO`) en la auditoría (`VINCULACION_RECHAZADA`).
   */
  @Roles('ADMINISTRADOR')
  @Post(':id/rechazar')
  @HttpCode(HttpStatus.OK)
  rechazar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RechazarVinculacionDto,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.vinculacionService.rechazar(id, user, dto);
  }
}
