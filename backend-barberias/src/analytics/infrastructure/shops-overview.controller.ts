import {
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AnalyticsService } from '../application/analytics.service.js';
import { AnalyticsQueryDto } from '../dto/analytics-query.dto.js';
import { CurrentUser } from '../../iam/infrastructure/current-user.decorator.js';
import { Roles } from '../../iam/infrastructure/roles.decorator.js';
import { RolesGuard } from '../../iam/infrastructure/roles.guard.js';
import { JwtAuthGuard } from '../../iam/infrastructure/jwt-auth.guard.js';
import type { UsuarioAutenticado } from '../../iam/domain/jwt.interface.js';
import { ROL_ADMINISTRADOR, ROL_ADMIN_BARBERIA } from '../../iam/domain/roles.js';

@Controller('shops/overview')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROL_ADMINISTRADOR, ROL_ADMIN_BARBERIA)
export class ShopsOverviewController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get()
  async getOverview(
    @Query() query: AnalyticsQueryDto,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    const esGlobal = user?.roles?.includes(ROL_ADMINISTRADOR) ?? false;
    return this.analyticsService.getShopsOverview(user, query.desde, query.hasta, esGlobal);
  }
}
