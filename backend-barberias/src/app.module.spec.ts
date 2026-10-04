import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { ClienteController } from './cliente/infrastructure/cliente.controller.js';
import { ClienteModule } from './cliente/cliente.module.js';

/** Lee los metadatos 'imports' de un modulo, tolerando modulos dinamicos. */
const importsDe = (modulo: unknown): unknown[] => {
  const meta = Reflect.getMetadata('imports', modulo as object) as unknown[] | undefined;
  if (meta) return meta;
  return (modulo as { imports?: unknown[] })?.imports ?? [];
};

/** Lee los metadatos 'controllers' de un modulo, tolerando modulos dinamicos. */
const controllersDe = (modulo: unknown): unknown[] => {
  const meta = Reflect.getMetadata('controllers', modulo as object) as unknown[] | undefined;
  if (meta) return meta;
  return (modulo as { controllers?: unknown[] })?.controllers ?? [];
};

/** Recorre en profundidad el grafo de imports que cuelga de un modulo raiz. */
const grafoCompleto = (raiz: unknown): { modulos: unknown[]; controllers: unknown[] } => {
  const modulos: unknown[] = [];
  const controllers: unknown[] = [];
  const vistos = new Set<unknown>();

  const visitar = (modulo: unknown): void => {
    if (!modulo || typeof modulo !== 'function' || vistos.has(modulo)) return;
    vistos.add(modulo);
    modulos.push(modulo);
    controllers.push(...controllersDe(modulo));
    importsDe(modulo).forEach(visitar);
  };

  visitar(raiz);

  return { modulos, controllers };
};

describe('AppModule: el modulo de cliente esta contenido (H22)', () => {
  it('no declara ClienteModule entre sus imports', async () => {
    // Sin REDIS_URL, BullModule.forRoot no abre conexion al importarse.
    delete process.env.REDIS_URL;
    const { AppModule } = await import('./app.module.js');

    const imports = (Reflect.getMetadata('imports', AppModule) ?? []) as unknown[];

    expect(imports).not.toContain(ClienteModule);
  }, 60_000);

  it('no registra ClienteController ni su ruta /clientes en todo el grafo', async () => {
    delete process.env.REDIS_URL;
    const { AppModule } = await import('./app.module.js');

    const { controllers } = grafoCompleto(AppModule);

    expect(controllers).not.toContain(ClienteController);

    const rutas = controllers
      .map((c) => Reflect.getMetadata('path', c as object) as string | undefined)
      .filter((ruta): ruta is string => Boolean(ruta));

    expect(rutas).not.toContain('clientes');
  }, 60_000);
});