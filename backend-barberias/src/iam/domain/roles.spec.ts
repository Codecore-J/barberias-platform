import { describe, it, expect, vi } from 'vitest';
import { UnprocessableEntityException } from '@nestjs/common';
import {
  esAdministradorGlobal,
  esAdministradorGlobalPorId,
  validarAsignacionRol,
} from './roles.js';
import type { UsuarioAutenticado } from './jwt.interface.js';

/**
 * E1-04 (D05): el rol global es solo ADMINISTRADOR. `SUPER_ADMIN` no existe en
 * la tabla `roles` y el código debe dejar de buscarlo.
 */
describe('roles (E1-04)', () => {
  describe('esAdministradorGlobal', () => {
    const usuario = (roles?: string[] | null): UsuarioAutenticado => ({
      id: 'u-1',
      correo: 'a@b.test',
      roles: roles as string[],
    });

    it('debe reconocer al ADMINISTRADOR', () => {
      expect(esAdministradorGlobal(usuario(['ADMINISTRADOR']))).toBe(true);
    });

    it('debe reconocer al ADMINISTRADOR aunque tenga también otros roles', () => {
      expect(esAdministradorGlobal(usuario(['BARBERO', 'ADMINISTRADOR']))).toBe(true);
    });

    it('no debe reconocer al ADMIN_BARBERIA', () => {
      expect(esAdministradorGlobal(usuario(['ADMIN_BARBERIA']))).toBe(false);
    });

    it('no debe lanzar con un usuario ausente, sin roles o sin session', () => {
      expect(esAdministradorGlobal(null)).toBe(false);
      expect(esAdministradorGlobal(undefined)).toBe(false);
      expect(esAdministradorGlobal(usuario(null))).toBe(false);
      expect(esAdministradorGlobal(usuario([]))).toBe(false);
    });
  });

  describe('esAdministradorGlobalPorId', () => {
    it('debe buscar el rol ADMINISTRADOR y no SUPER_ADMIN', async () => {
      const findFirst = vi.fn().mockResolvedValue({ id: 'ur-1' });
      const prisma = { usuarioRol: { findFirst } } as any;

      const resultado = await esAdministradorGlobalPorId(prisma, 'u-1');

      expect(resultado).toBe(true);
      expect(findFirst).toHaveBeenCalledWith({
        where: { usuarioId: 'u-1', rol: { nombre: 'ADMINISTRADOR' } },
      });
    });

    it('debe devolver false si el usuario no lo tiene', async () => {
      const prisma = { usuarioRol: { findFirst: vi.fn().mockResolvedValue(null) } } as any;

      expect(await esAdministradorGlobalPorId(prisma, 'u-1')).toBe(false);
    });
  });

  describe('validarAsignacionRol', () => {
    it('debe rechazar un rol de ámbito BARBERIA sin barberiaId', () => {
      expect(() => validarAsignacionRol({ nombre: 'ADMIN_BARBERIA', ambito: 'BARBERIA' }, null))
        .toThrow(UnprocessableEntityException);
    });

    it('debe rechazar un rol de ámbito BARBERIA con barberiaId vacío', () => {
      expect(() => validarAsignacionRol({ nombre: 'BARBERO', ambito: 'BARBERIA' }, ''))
        .toThrow(UnprocessableEntityException);
    });

    it('debe aceptar un rol de ámbito BARBERIA con barberiaId', () => {
      expect(() =>
        validarAsignacionRol({ nombre: 'ADMIN_BARBERIA', ambito: 'BARBERIA' }, 'barberia-1'),
      ).not.toThrow();
    });

    it('debe aceptar un rol de ámbito GLOBAL sin barberiaId', () => {
      expect(() =>
        validarAsignacionRol({ nombre: 'ADMINISTRADOR', ambito: 'GLOBAL' }, null),
      ).not.toThrow();
    });

    it('debe nombrar el rol y el ámbito en el mensaje de error', () => {
      expect(() =>
        validarAsignacionRol({ nombre: 'BARBERO', ambito: 'BARBERIA' }, null),
      ).toThrow(/BARBERO/);
    });
  });
});
