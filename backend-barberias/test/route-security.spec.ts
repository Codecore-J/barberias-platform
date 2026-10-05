import 'reflect-metadata';
import { beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { AppModule } from '../src/app.module.js';
import { ROLES_KEY } from '../src/iam/infrastructure/roles.decorator.js';

const IS_PUBLIC_KEY = 'isPublic';
const AUTENTICADO_KEY = 'autenticado';

const VERBO: Record<RequestMethod, string> = {
  [RequestMethod.GET]: 'GET',
  [RequestMethod.POST]: 'POST',
  [RequestMethod.PUT]: 'PUT',
  [RequestMethod.DELETE]: 'DELETE',
  [RequestMethod.PATCH]: 'PATCH',
  [RequestMethod.ALL]: 'ALL',
  [RequestMethod.OPTIONS]: 'OPTIONS',
  [RequestMethod.HEAD]: 'HEAD',
  [RequestMethod.SEARCH]: 'SEARCH',
} as Record<RequestMethod, string>;

interface Fila {
  controlador: string;
  metodo: string;
  verbo: string;
  ruta: string;
  decorador: string;
}

describe('Inventario de seguridad de rutas (E1-01)', () => {
  let filas: Fila[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const discovery = moduleRef.get(DiscoveryService);
    const scanner = new MetadataScanner();
    const reflector = moduleRef.get(Reflector);

    const controladores = discovery
      .getControllers()
      .filter((wrapper) => !!wrapper.instance && !!wrapper.metatype);

    filas = [];

    for (const { instance, metatype } of controladores) {
      const prefijo = Reflect.getMetadata(PATH_METADATA, metatype as object);
      if (!prefijo) continue;

      const prototipo = Object.getPrototypeOf(instance);

      for (const nombre of scanner.getAllMethodNames(prototipo)) {
        if (nombre === 'constructor') continue;

        const descriptor = Object.getOwnPropertyDescriptor(prototipo, nombre);
        const manejador = descriptor?.value;
        if (typeof manejador !== 'function') continue;

        const verbo = Reflect.getMetadata(METHOD_METADATA, manejador);
        if (verbo === undefined) continue;

        const sufijo = Reflect.getMetadata(PATH_METADATA, manejador) ?? '';
        const ruta = `/${[prefijo, sufijo].filter(Boolean).join('/')}`.replace(/\/+/g, '/');

        const objetivos = [manejador, metatype as object];
        const esPublica = reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, objetivos) === true;
        const esAutenticada =
          reflector.getAllAndOverride<boolean>(AUTENTICADO_KEY, objetivos) === true;
        const roles = reflector.getAllAndOverride<string[]>(ROLES_KEY, objetivos);

        const decorador = esPublica
          ? '@Public'
          : roles && roles.length > 0
            ? `@Roles(${roles.join(', ')})`
            : esAutenticada
              ? '@Autenticado'
              : 'NINGUNO';

        filas.push({
          controlador: (metatype as { name: string }).name,
          metodo: nombre,
          verbo: VERBO[verbo as RequestMethod] ?? String(verbo),
          ruta,
          decorador,
        });
      }
    }

    filas.sort((a, b) => a.ruta.localeCompare(b.ruta) || a.verbo.localeCompare(b.verbo));
  }, 60_000);

  it('declarar la politica de todas las rutas', () => {
    const ancho = Math.max(...filas.map((f) => f.ruta.length), 4);
    const cabecera =
      'ruta'.padEnd(ancho) + ' | verbo   | controlador                   | decorador';

    console.log('\n=== TABLA DE RUTAS (' + filas.length + ') ===');
    console.log(cabecera);
    console.log('-'.repeat(cabecera.length));
    for (const f of filas) {
      console.log(
        f.ruta.padEnd(ancho) +
          ' | ' +
          f.verbo.padEnd(7) +
          ' | ' +
          f.controlador.padEnd(27) +
          ' | ' +
          f.decorador,
      );
    }

    const conteo = filas.reduce<Record<string, number>>((acc, f) => {
      const tipo = f.decorador.startsWith('@Roles')
        ? 'Roles'
        : f.decorador === '@Public'
          ? 'Public'
          : f.decorador === '@Autenticado'
            ? 'Autenticado'
            : 'ninguno';
      acc[tipo] = (acc[tipo] ?? 0) + 1;
      return acc;
    }, {});

    console.log(
      '\n=== CONTEO === Public: ' +
        (conteo['Public'] ?? 0) +
        ' | Autenticado: ' +
        (conteo['Autenticado'] ?? 0) +
        ' | Roles: ' +
        (conteo['Roles'] ?? 0) +
        ' | ninguno: ' +
        (conteo['ninguno'] ?? 0) +
        '\n',
    );

    const sinDeclarar = filas.filter((f) => f.decorador === 'NINGUNO');
    expect(
      sinDeclarar.map((f) => `${f.verbo} ${f.ruta} (${f.controlador}.${f.metodo})`).join('\n'),
    ).toBe('');
  }, 60_000);
});