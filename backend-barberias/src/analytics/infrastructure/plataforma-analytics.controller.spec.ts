import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Reflector } from '@nestjs/core';
import { PlataformaAnalyticsController } from './plataforma-analytics.controller.js';
import type { AnalyticsService } from '../application/analytics.service.js';
import { ROLES_KEY } from '../../iam/infrastructure/roles.decorator.js';
import { ROL_ADMINISTRADOR } from '../../iam/domain/roles.js';

/**
 * T-15 · `GET /analytics/plataforma/hoy`.
 *
 * El controlador no tiene lógica: resuelve el alcance y delega. Lo que sí se
 * fija aquí es la POLÍTICA —solo `ADMINISTRADOR`—, porque si esa metadata
 * desapareciera el endpoint seguiría respondiendo 200 a un ADMIN_BARBERIA y
 * nadie lo notaría hasta ver la facturación de otra sede en pantalla.
 * (El 401 sin token y el 403 por rol los ejecuta `permisos-matriz.spec.ts` con
 * el `RolesGuard` real.)
 */
describe('PlataformaAnalyticsController', () => {
  let controller: PlataformaAnalyticsController;
  let analyticsService: { metricasPlataformaHoy: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    analyticsService = { metricasPlataformaHoy: vi.fn() };
    controller = new PlataformaAnalyticsController(
      analyticsService as unknown as AnalyticsService,
    );
  });

  it('delega en el servicio y devuelve sus métricas sin tocarlas', async () => {
    const metricas = {
      fecha: '2026-11-15',
      sedesActivas: 2,
      citasHoy: 7,
      recaudadoHoy: 1400,
      cajasAbiertas: 0,
      usuariosActivos: 31,
    };
    analyticsService.metricasPlataformaHoy.mockResolvedValue(metricas);

    const resultado = await controller.metricasPlataformaHoy();

    expect(analyticsService.metricasPlataformaHoy).toHaveBeenCalledTimes(1);
    expect(resultado).toEqual(metricas);
  });

  it('declara el rol ADMINISTRADOR como único autorizado', () => {
    const roles = new Reflector().get<string[]>(ROLES_KEY, PlataformaAnalyticsController);

    expect(roles).toEqual([ROL_ADMINISTRADOR]);
  });
});
