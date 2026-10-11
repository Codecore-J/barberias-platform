import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { BarberiaService } from '../application/barberia.service.js';
import { AprobarVinculacionDto } from '../application/dto/resolver-vinculacion.dto.js';
import { RechazarVinculacionDto } from '../application/dto/resolver-vinculacion.dto.js';
import { Roles } from '../../iam/infrastructure/roles.decorator.js';
import { CurrentUser } from '../../iam/infrastructure/current-user.decorator.js';
import type { UsuarioAutenticado } from '../../iam/domain/jwt.interface.js';

/**
 * E3-12 (§1.2) · resolución de la 6ª vinculación.
 *
 * Es rutas de PLATAFORMA, no de una sede: el tope de 5 barberías es global del
 * cliente y quien lo autoriza es el ADMINISTRADOR (D10). Por eso vive en su
 * propio controlador con `@Roles('ADMINISTRADOR')` en las tres rutas —el guard
 * es fail-closed, pero aquí además queda escrito explícitamente (E2-01).
 */
@Controller('plataforma/vinculaciones')
export class PlataformaVinculacionesController {
  constructor(private readonly barberiaService: BarberiaService) {}

  /**
   * GET /plataforma/vinculaciones/pendientes
   * Cola de espera: todas las vinculaciones en `PENDIENTE_APROBACION`, con el
   * cliente y la sede resueltos para no hacer N+1 en el panel.
   */
  @Roles('ADMINISTRADOR')
  @Get('pendientes')
  pendientes() {
    return this.barberiaService.listarVinculacionesPendientes();
  }

  /**
   * POST /plataforma/vinculaciones/:id/aprobar
   * El motivo es opcional; la vinculación pasa a `ACTIVO` y el cliente recibe
   * notificación. Se audita `VINCULACION_APROBADA`.
   */
  @Roles('ADMINISTRADOR')
  @Post(':id/aprobar')
  @HttpCode(HttpStatus.OK)
  aprobar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AprobarVinculacionDto,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.barberiaService.resolverVinculacion(id, 'APROBAR', user, dto.motivo);
  }

  /**
   * POST /plataforma/vinculaciones/:id/rechazar
   * El motivo es OBLIGATORIO (§5.5): sin él el cliente no sabe qué corregir.
   * La vinculación pasa a `DESVINCULADO` y se audita `VINCULACION_RECHAZADA`.
   */
  @Roles('ADMINISTRADOR')
  @Post(':id/rechazar')
  @HttpCode(HttpStatus.OK)
  rechazar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RechazarVinculacionDto,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.barberiaService.resolverVinculacion(id, 'RECHAZAR', user, dto.motivo);
  }
}
