import 'reflect-metadata';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants.js';
import { describe, expect, it, vi } from 'vitest';
import { IS_PUBLIC_KEY } from '../src/iam/infrastructure/public.decorator.js';
import { PaisNoSoportadoException } from '../src/geocodificacion/nominatim.service.js';

/**
 * F6 / T-66 · `GET /divisiones/:paisCodigo`, público.
 *
 * El formulario de alta necesita el catálogo (provincia → municipio) antes de
 * tener sesión de sede y sin pasar por el formulario completo, así que la ruta
 * es pública y de solo lectura. Lo que fija esta prueba:
 *
 *  1. Devuelve las provincias con sus municipios YA agrupados, en orden
 *     alfabético: el select no debería ordenar ni cruzar ids en el navegador.
 *  2. Un país fuera de `PAISES_SOPORTADOS` responde 422 `PAIS_NO_SOPORTADO`,
 *     igual que el alta (T-61): una sola lista de países en todo el backend.
 *  3. La ruta está marcada `@Public()`: sin eso el guard global la cerraría y el
 *     formulario no podría pedirla antes de autenticarse.
 */

const { DivisionesService } = await import('../src/divisiones/application/divisiones.service.js').catch(
  () => ({ DivisionesService: undefined as any }),
);
const { DivisionesController } = await import(
  '../src/divisiones/infrastructure/divisiones.controller.js'
).catch(() => ({ DivisionesController: undefined as any }));

function prismaFalso(filas: any[]) {
  return {
    divisionAdministrativa: {
      findMany: vi.fn().mockResolvedValue(filas),
    },
  };
}

const FILAS = [
  { id: 'p-santiago', nombre: 'Santiago', nombreNominatim: 'Santiago', padreId: null, nivel: 1 },
  { id: 'p-azua', nombre: 'Azua', nombreNominatim: 'Azua', padreId: null, nivel: 1 },
  { id: 'm-tamboril', nombre: 'Tamboril', nombreNominatim: 'Tamboril', padreId: 'p-santiago', nivel: 2 },
  { id: 'm-azua', nombre: 'Azua de Compostela', nombreNominatim: 'Azua', padreId: 'p-azua', nivel: 2 },
  { id: 'm-santiago', nombre: 'Santiago de los Caballeros', nombreNominatim: 'Santiago', padreId: 'p-santiago', nivel: 2 },
];

describe('T-66 · GET /divisiones/:paisCodigo', () => {
  it('agrupa los municipios bajo su provincia y ordena por nombre', async () => {
    const prisma = prismaFalso(FILAS);
    const servicio = new DivisionesService(prisma as any);

    const resultado = await servicio.listar('DO');

    expect(resultado.paisCodigo).toBe('DO');
    expect(resultado.provincias.map((p: any) => p.nombre)).toEqual(['Azua', 'Santiago']);
    expect(resultado.provincias[1].municipios.map((m: any) => m.nombre)).toEqual([
      'Santiago de los Caballeros',
      'Tamboril',
    ]);
    // Solo viaja lo que el select necesita: nada de `padreId` ni `nivel` sueltos.
    expect(Object.keys(resultado.provincias[0]).sort()).toEqual(['id', 'municipios', 'nombre']);
  });

  it('consulta el catálogo por país, sin traer otros países', async () => {
    const prisma = prismaFalso(FILAS);
    const servicio = new DivisionesService(prisma as any);

    await servicio.listar('DO');

    expect(prisma.divisionAdministrativa.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { paisCodigo: 'DO' } }),
    );
  });

  it('un país no soportado responde 422 PAIS_NO_SOPORTADO sin consultar la base', async () => {
    const prisma = prismaFalso(FILAS);
    const servicio = new DivisionesService(prisma as any);

    await expect(servicio.listar('ES')).rejects.toBeInstanceOf(PaisNoSoportadoException);
    await expect(servicio.listar('ES')).rejects.toMatchObject({ status: 422 });
    expect(prisma.divisionAdministrativa.findMany).not.toHaveBeenCalled();
  });

  it('normaliza el código de país (minúsculas y espacios)', async () => {
    const prisma = prismaFalso(FILAS);
    const servicio = new DivisionesService(prisma as any);

    const resultado = await servicio.listar(' do ');

    expect(resultado.paisCodigo).toBe('DO');
    expect(prisma.divisionAdministrativa.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { paisCodigo: 'DO' } }),
    );
  });

  it('la ruta es pública y está declarada como GET :paisCodigo', () => {
    expect(DivisionesController).toBeDefined();

    const prototipo = DivisionesController.prototype;
    const metodo = Object.getOwnPropertyNames(prototipo)
      .filter((nombre) => nombre !== 'constructor')
      .map((nombre) => (prototipo as any)[nombre])
      .find((fn) => typeof fn === 'function');

    expect(metodo).toBeDefined();
    expect(Reflect.getMetadata(PATH_METADATA, metodo)).toBe(':paisCodigo');
    // METHOD_METADATA 0 = GET
    expect(Reflect.getMetadata(METHOD_METADATA, metodo)).toBe(0);
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, metodo)).toBe(true);
  });
});
