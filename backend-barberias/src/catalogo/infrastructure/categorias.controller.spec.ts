import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { CategoriasController } from './categorias.controller.js';
import { OperadorBarberiaGuard } from './operador-barberia.guard.js';
import { ROL_ADMIN_BARBERIA, ROL_ADMINISTRADOR, ROL_BARBERO } from '../../iam/domain/roles.js';

/**
 * T-17 · el ADMINISTRADOR global LEE las categorías de cualquier sede (lista y
 * detalle), no puede escribir (D16, 403 explícito) y cada lectura suya queda
 * auditada. El personal de la sede no genera eventos de lectura.
 */
describe('CategoriasController · T-17 (solo lectura del ADMINISTRADOR)', () => {
  let controller: CategoriasController;
  let service: any;
  let auditoria: any;

  const CATEGORIA = { id: 'cat-1', nombre: 'Corte', activa: true, serviciosActivos: 2 };

  const adminGlobal = {
    id: 'u-global',
    correo: 'global@test.com',
    roles: [ROL_ADMINISTRADOR],
    rolesDetallados: [{ nombre: ROL_ADMINISTRADOR, barberiaId: null, ambito: 'GLOBAL' }],
  } as any;

  const adminSede = {
    id: 'u-sede',
    correo: 'sede@test.com',
    roles: [ROL_ADMIN_BARBERIA],
    rolesDetallados: [{ nombre: ROL_ADMIN_BARBERIA, barberiaId: 'sede-1', ambito: 'BARBERIA' }],
  } as any;

  beforeEach(() => {
    service = {
      listar: vi.fn().mockResolvedValue([CATEGORIA]),
      obtener: vi.fn().mockResolvedValue(CATEGORIA),
      crear: vi.fn(),
      actualizar: vi.fn(),
    };
    auditoria = { registrarEvento: vi.fn().mockResolvedValue(undefined) };
    controller = new CategoriasController(service, auditoria);
  });

  it('ADMINISTRADOR lista las categorías de una sede ajena y genera el evento de auditoría', async () => {
    const resultado = await controller.listar('sede-ajena', adminGlobal);

    expect(service.listar).toHaveBeenCalledWith('sede-ajena');
    expect(resultado).toEqual([CATEGORIA]);
    expect(auditoria.registrarEvento).toHaveBeenCalledWith(
      expect.objectContaining({
        usuarioId: 'u-global',
        barberiaId: 'sede-ajena',
        accion: 'CATEGORIAS_CONSULTADAS',
        entidad: 'categorias_servicio',
        contexto: expect.objectContaining({ alcance: 'listado', filas: 1 }),
      }),
    );
  });

  it('ADMINISTRADOR lee el detalle de una categoría y también se audita', async () => {
    const resultado = await controller.obtener('sede-ajena', 'cat-1', adminGlobal);

    expect(service.obtener).toHaveBeenCalledWith('sede-ajena', 'cat-1');
    expect(resultado).toEqual(CATEGORIA);
    expect(auditoria.registrarEvento).toHaveBeenCalledWith(
      expect.objectContaining({
        accion: 'CATEGORIAS_CONSULTADAS',
        contexto: expect.objectContaining({ alcance: 'detalle' }),
      }),
    );
  });

  it('el ADMIN_BARBERIA lee sin generar eventos de lectura', async () => {
    await controller.listar('sede-1', adminSede);

    expect(service.listar).toHaveBeenCalledWith('sede-1');
    expect(auditoria.registrarEvento).not.toHaveBeenCalled();
  });

  it('el ADMINISTRADOR NO puede escribir: el guard de operador lo rechaza con 403 explícito', () => {
    const guard = new OperadorBarberiaGuard();
    const contexto = (user: any) =>
      ({
        switchToHttp: () => ({ getRequest: () => ({ user }) }),
      }) as any;

    expect(() => guard.canActivate(contexto(adminGlobal))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(contexto(adminSede))).not.toThrow();
    expect(() =>
      guard.canActivate(contexto({ ...adminSede, roles: [ROL_BARBERO] })),
    ).not.toThrow();
  });
});
