import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AnalyticsService } from '../application/analytics.service.js';
import { MetricasPlataformaHoyDto } from '../dto/metricas-plataforma-hoy.dto.js';
import { Roles } from '../../iam/infrastructure/roles.decorator.js';
import { RolesGuard } from '../../iam/infrastructure/roles.guard.js';
import { JwtAuthGuard } from '../../iam/infrastructure/jwt-auth.guard.js';
import { ROL_ADMINISTRADOR } from '../../iam/domain/roles.js';

/**
 * T-15 · métricas consolidadas de la PLATAFORMA (sin sede).
 *
 * Vive en su propio controlador porque el `AnalyticsController` existente cuelga
 * de `/shops/:shopId/analytics` y pasa por `VinculoBarberiaGuard`: una ruta sin
 * sede no tiene dónde colgarse de ahí sin que el guard la trate como una sede
 * inválida. Aquí no hay `shopId` ni guard de vínculo —no hay nada que acotar por
 * sede— y el alcance lo decide el rol.
 *
 * Solo `ADMINISTRADOR`: son cifras de TODA la red, y un ADMIN_BARBERIA no debe
 * ver la facturación de otras sedes (D05). El `RolesGuard` ya devuelve 403 a los
 * demás roles y `JwtAuthGuard` 401 sin token.
 */
@Controller('analytics')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROL_ADMINISTRADOR)
export class PlataformaAnalyticsController {
  constructor(@Inject(AnalyticsService) private readonly analyticsService: AnalyticsService) {}

  /**
   * `GET /analytics/plataforma/hoy`.
   *
   * Rate Limit (SEC-02): 60 por minuto. Es una lectura agregada que el home
   * pide al entrar y al cambiar de vista; el techo existe para que nadie la use
   * como ariete de agregaciones en bucle. No se cachea: cinco contadores con
   * índice cuestan menos que un estado del que fiarse para cifras de caja.
   */
  @Get('plataforma/hoy')
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  async metricasPlataformaHoy(): Promise<MetricasPlataformaHoyDto> {
    return this.analyticsService.metricasPlataformaHoy();
  }
}
