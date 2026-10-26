import {
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AnalyticsService } from '../application/analytics.service.js';
import { AnalyticsQueryDto } from '../dto/analytics-query.dto.js';
import { CurrentUser } from '../../iam/infrastructure/current-user.decorator.js';
import { Roles } from '../../iam/infrastructure/roles.decorator.js';
import { RolesGuard } from '../../iam/infrastructure/roles.guard.js';
import { JwtAuthGuard } from '../../iam/infrastructure/jwt-auth.guard.js';
import { VinculoBarberiaGuard } from '../../iam/infrastructure/vinculo-barberia.guard.js';
import type { UsuarioAutenticado } from '../../iam/domain/jwt.interface.js';
import { ROL_ADMINISTRADOR, ROL_ADMIN_BARBERIA } from '../../iam/domain/roles.js';

@Controller('shops/:shopId/analytics')
@UseGuards(JwtAuthGuard, RolesGuard, VinculoBarberiaGuard)
@Roles(ROL_ADMINISTRADOR, ROL_ADMIN_BARBERIA)
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get()
  async getAnalytics(
    @Param('shopId', ParseUUIDPipe) shopId: string,
    @Query() query: AnalyticsQueryDto,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    const esGlobal = user?.roles?.includes(ROL_ADMINISTRADOR) ?? false;

    if (!esGlobal) {
      const esAdminDeEsta =
        user?.rolesDetallados?.some(
          (rol: any) =>
            rol.nombre === ROL_ADMIN_BARBERIA &&
            (rol.barberiaId === shopId || !rol.barberiaId),
        ) ?? false;

      if (!esAdminDeEsta) {
        throw new ForbiddenException(
          'No tienes permisos para ver las analíticas de esta barbería.',
        );
      }
    }

    return this.analyticsService.getShopAnalytics(shopId, query.desde, query.hasta);
  }
}
