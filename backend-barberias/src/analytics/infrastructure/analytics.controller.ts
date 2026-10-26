import {
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
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
    this.verificarAcceso(user, shopId);
    return this.analyticsService.getShopAnalytics(shopId, query.desde, query.hasta);
  }

  /**
   * Paso 13 · descarga del reporte. El `RolesGuard` ya deja fuera a BARBERO y
   * CLIENTE; esta comprobación evita que el ADMIN_BARBERIA de otra sede
   * descargue el balance ajeno pasando un `shopId` que no es el suyo.
   */
  @Get('export')
  async exportCsv(
    @Param('shopId', ParseUUIDPipe) shopId: string,
    @Query() query: AnalyticsQueryDto,
    @CurrentUser() user: UsuarioAutenticado,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    this.verificarAcceso(user, shopId);
    const csv = await this.analyticsService.getShopAnalyticsCsv(
      shopId,
      query.desde,
      query.hasta,
    );

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="reporte-barberia-${shopId}.csv"`,
    );
    return csv;
  }

  private verificarAcceso(user: UsuarioAutenticado, shopId: string): void {
    const esGlobal = user?.roles?.includes(ROL_ADMINISTRADOR) ?? false;
    if (esGlobal) return;

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
}
