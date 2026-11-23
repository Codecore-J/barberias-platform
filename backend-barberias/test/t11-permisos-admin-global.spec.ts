import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../src/iam/infrastructure/roles.guard.js';
import { ROLES_KEY } from '../src/iam/infrastructure/roles.decorator.js';
import {
  AMBITO_BARBERIA,
  AMBITO_GLOBAL,
  ROL_ADMINISTRADOR,
  ROL_ADMIN_BARBERIA,
} from '../src/iam/domain/roles.js';
import type { UsuarioAutenticado } from '../src/iam/domain/jwt.interface.js';

/**
 * T-11 · Opción A: ninguna ruta concede acceso por jerarquía.
 *
 * `RolesGuard` deja pasar al `ADMINISTRADOR` global antes de mirar la lista de
 * roles pedida. Por eso hoy el global alcanza agenda de sede, caja, cobros,
 * personal y solicitudes de cambio aunque la matriz diga ❌ para él. La decisión
 * del dueño es que cada ruta declara quién entra y nadie entra por defecto:
 *
 *  - una ruta con `@Roles('ADMIN_BARBERIA')` niega al global,
 *  - una ruta sin política declarada niega a todos, también al global.
 *
 * El test ejerce el guard con metadatos reales (`ROLES_KEY`, el mismo que pone
 * `@Roles`) sobre manejadores sintéticos: no arranca `AppModule` ni toca la
 * base de datos.
 */

const BARBERIA_ID = '11111111-1111-4111-8111-111111111111';

class RutaSinPolitica {
  handler(this: void): void {}
}

class RutaDeSede {
  handler(this: void): void {}
}

class RutaDelGlobal {
  handler(this: void): void {}
}

// Los mismos metadatos que escriben `@Roles(...)` y los decoradores de acceso.
Reflect.defineMetadata(ROLES_KEY, [ROL_ADMIN_BARBERIA], RutaDeSede.prototype.handler);
Reflect.defineMetadata(ROLES_KEY, [ROL_ADMINISTRADOR], RutaDelGlobal.prototype.handler);

function usuarioGlobal(): UsuarioAutenticado {
  return {
    id: 'global',
    correo: 'global@prueba.local',
    roles: [ROL_ADMINISTRADOR],
    rolesDetallados: [
      { nombre: ROL_ADMINISTRADOR, barberiaId: null, ambito: AMBITO_GLOBAL },
    ],
  };
}

function usuarioAdminDeSede(): UsuarioAutenticado {
  return {
    id: 'admin-sede',
    correo: 'sede@prueba.local',
    roles: [ROL_ADMIN_BARBERIA],
    rolesDetallados: [
      { nombre: ROL_ADMIN_BARBERIA, barberiaId: BARBERIA_ID, ambito: AMBITO_BARBERIA },
    ],
  };
}

function contexto(instancia: object, user: UsuarioAutenticado): ExecutionContext {
  const prototipo = Object.getPrototypeOf(instancia) as object;
  const handler = Object.getOwnPropertyDescriptor(prototipo, 'handler')?.value as (
    ...args: unknown[]
  ) => unknown;

  return {
    getHandler: () => handler,
    getClass: () => prototipo.constructor as object,
    switchToHttp: () => ({
      getRequest: () => ({
        method: 'GET',
        originalUrl: '/ruta-de-prueba',
        params: { shopId: BARBERIA_ID },
        query: {},
        headers: {},
        user,
      }),
    }),
  } as unknown as ExecutionContext;
}

function deniega(guard: RolesGuard, instancia: object, user: UsuarioAutenticado): boolean {
  try {
    return guard.canActivate(contexto(instancia, user)) !== true;
  } catch (error) {
    if (error instanceof ForbiddenException) return true;
    throw error;
  }
}

describe('T-11 · el ADMINISTRADOR global no entra por jerarquía (opción A)', () => {
  const guard = new RolesGuard(new Reflector());

  it('niega al ADMINISTRADOR global en una ruta que solo declara ADMIN_BARBERIA', () => {
    expect(deniega(guard, new RutaDeSede(), usuarioGlobal())).toBe(true);
  });

  it('niega al ADMINISTRADOR global en una ruta sin política declarada', () => {
    expect(deniega(guard, new RutaSinPolitica(), usuarioGlobal())).toBe(true);
  });

  it('niega a un ADMIN_BARBERIA en una ruta sin política declarada', () => {
    expect(deniega(guard, new RutaSinPolitica(), usuarioAdminDeSede())).toBe(true);
  });

  it('permite al ADMIN_BARBERIA de la sede en una ruta que lo declara', () => {
    expect(deniega(guard, new RutaDeSede(), usuarioAdminDeSede())).toBe(false);
  });

  it('permite al ADMINISTRADOR global solo cuando la ruta lo declara', () => {
    expect(deniega(guard, new RutaDelGlobal(), usuarioGlobal())).toBe(false);
  });
});
