import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ShopsOverviewController } from './shops-overview.controller.js';
import { ROL_ADMIN_BARBERIA, ROL_ADMINISTRADOR } from '../../iam/domain/roles.js';

describe('ShopsOverviewController', () => {
  let controller: ShopsOverviewController;
  let service: any;

  beforeEach(() => {
    service = { getShopsOverview: vi.fn().mockResolvedValue({ ok: true }) };
    controller = new ShopsOverviewController(service);
  });

  it('llama al servicio con usuario y fechas para ADMIN_BARBERIA', async () => {
    const user = { id: 'u1', roles: [ROL_ADMIN_BARBERIA], rolesDetallados: [] };
    const result = await controller.getOverview({ desde: '2026-10-01', hasta: '2026-10-31' } as any, user as any);
    expect(result).toEqual({ ok: true });
    expect(service.getShopsOverview).toHaveBeenCalledWith(user, '2026-10-01', '2026-10-31', false);
  });

  it('marca esGlobal true para ADMINISTRADOR', async () => {
    const user = { id: 'admin', roles: [ROL_ADMINISTRADOR] };
    await controller.getOverview({} as any, user as any);
    expect(service.getShopsOverview).toHaveBeenCalledWith(user, undefined, undefined, true);
  });
});
