import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller.js';
import { ROL_ADMIN_BARBERIA, ROL_ADMINISTRADOR, ROL_BARBERO, ROL_CLIENTE } from '../../iam/domain/roles.js';

describe('AnalyticsController', () => {
  let controller: AnalyticsController;
  let service: any;

  beforeEach(() => {
    service = {
      getShopAnalytics: vi.fn().mockResolvedValue({ ok: true }),
      getShopAnalyticsCsv: vi.fn().mockResolvedValue('Reporte de analíticas'),
    };
    controller = new AnalyticsController(service);
  });

  it('permite a ADMIN_BARBERIA de la sede', async () => {
    const user = { roles: [ROL_ADMIN_BARBERIA], rolesDetallados: [{ nombre: ROL_ADMIN_BARBERIA, barberiaId: 'shop-1' }] };
    const result = await controller.getAnalytics('shop-1', {} as any, user as any);
    expect(result).toEqual({ ok: true });
    expect(service.getShopAnalytics).toHaveBeenCalledWith('shop-1', undefined, undefined);
  });

  it('rechaza a BARBERO con 403', async () => {
    const user = { roles: [ROL_BARBERO], rolesDetallados: [{ nombre: ROL_BARBERO, barberiaId: 'shop-1' }] };
    await expect(controller.getAnalytics('shop-1', {} as any, user as any)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rechaza a CLIENTE con 403', async () => {
    const user = { roles: [ROL_CLIENTE], rolesDetallados: [] };
    await expect(controller.getAnalytics('shop-1', {} as any, user as any)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rechaza a ADMIN_BARBERIA de otra sede con 403', async () => {
    const user = { roles: [ROL_ADMIN_BARBERIA], rolesDetallados: [{ nombre: ROL_ADMIN_BARBERIA, barberiaId: 'shop-2' }] };
    await expect(controller.getAnalytics('shop-1', {} as any, user as any)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('permite a ADMINISTRADOR global', async () => {
    const user = { roles: [ROL_ADMINISTRADOR], rolesDetallados: [] };
    const result = await controller.getAnalytics('shop-1', { desde: '2026-10-01', hasta: '2026-10-31' } as any, user as any);
    expect(result).toEqual({ ok: true });
    expect(service.getShopAnalytics).toHaveBeenCalledWith('shop-1', '2026-10-01', '2026-10-31');
  });

  describe('exportCsv', () => {
    const res = () => ({ setHeader: vi.fn() }) as any;

    it('devuelve el CSV con las cabeceras de descarga', async () => {
      const user = { roles: [ROL_ADMIN_BARBERIA], rolesDetallados: [{ nombre: ROL_ADMIN_BARBERIA, barberiaId: 'shop-1' }] };
      const response = res();

      const csv = await controller.exportCsv('shop-1', {} as any, user as any, response);

      expect(csv).toBe('Reporte de analíticas');
      expect(service.getShopAnalyticsCsv).toHaveBeenCalledWith('shop-1', undefined, undefined);
      expect(response.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv; charset=utf-8');
      expect(response.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'attachment; filename="reporte-barberia-shop-1.csv"',
      );
    });

    it('propaga las fechas al servicio', async () => {
      const user = { roles: [ROL_ADMINISTRADOR], rolesDetallados: [] };
      const response = res();

      await controller.exportCsv(
        'shop-1',
        { desde: '2026-10-01', hasta: '2026-10-31' } as any,
        user as any,
        response,
      );

      expect(service.getShopAnalyticsCsv).toHaveBeenCalledWith('shop-1', '2026-10-01', '2026-10-31');
    });

    it('rechaza a BARBERO con 403 y sin cabeceras', async () => {
      const user = { roles: [ROL_BARBERO], rolesDetallados: [{ nombre: ROL_BARBERO, barberiaId: 'shop-1' }] };
      const response = res();

      await expect(controller.exportCsv('shop-1', {} as any, user as any, response)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(response.setHeader).not.toHaveBeenCalled();
      expect(service.getShopAnalyticsCsv).not.toHaveBeenCalled();
    });

    it('rechaza a ADMIN_BARBERIA de otra sede con 403', async () => {
      const user = { roles: [ROL_ADMIN_BARBERIA], rolesDetallados: [{ nombre: ROL_ADMIN_BARBERIA, barberiaId: 'shop-2' }] };
      const response = res();

      await expect(controller.exportCsv('shop-1', {} as any, user as any, response)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(service.getShopAnalyticsCsv).not.toHaveBeenCalled();
    });
  });
});
