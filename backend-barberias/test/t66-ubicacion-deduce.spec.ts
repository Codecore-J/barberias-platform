import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { describe, expect, it, vi } from 'vitest';
import { DivisionesService } from '../src/divisiones/application/divisiones.service.js';
import { DivisionesController } from '../src/divisiones/infrastructure/divisiones.controller.js';
import type { PrismaService } from '../src/shared/prisma/prisma.service.js';
import {
  GeocodificacionNoDisponibleException,
  NominatimService,
  PaisNoSoportadoException,
  type UbicacionGeocodificada,
} from '../src/geocodificacion/nominatim.service.js';
import { IS_PUBLIC_KEY } from '../src/iam/infrastructure/public.decorator.js';

/**
 * F6 / T-66 · confirmación de provincia y municipio ANTES de crear la sede.
 *
 * El formulario muestra los dos selects como confirmación de lo que deduce el
 * proveedor: para prellenarlos necesita preguntar por unas coordenadas sin
 * crear nada. `GET /divisiones/ubicacion` es esa consulta —pública, de solo
 * lectura y con los mismos errores del alta—.
 *
 * En rojo: ni el método ni la ruta existen.
 */

const UBICACION: UbicacionGeocodificada = {
  paisCodigo: 'DO',
  divisionNivel1: 'Santiago',
  divisionNivel2: 'Tamboril',
  direccionCompleta: 'Tamboril, Santiago, República Dominicana',
};

async function capturarError(promesa: Promise<unknown>) {
  try {
    await promesa;
  } catch (error: any) {
    const respuesta = typeof error?.getResponse === 'function' ? error.getResponse() : {};
    return { status: error?.getStatus?.() ?? respuesta.statusCode, codigo: respuesta.codigo };
  }
  throw new Error('Se esperaba una excepción y la promesa se resolvió.');
}

function preparar() {
  const nominatim = { ubicacionDe: vi.fn().mockResolvedValue(UBICACION) };
  const servicio = new DivisionesService(
    {} as PrismaService,
    nominatim as unknown as NominatimService,
  );
  return { servicio, nominatim };
}

describe('T-66 · la provincia y el municipio se confirman con las coordenadas', () => {
  it('devuelve lo que deduce Nominatim, sin tocar el catálogo', async () => {
    const { servicio, nominatim } = preparar();

    const res = await servicio.porUbicacion(19.4856, -70.6111);

    expect(nominatim.ubicacionDe).toHaveBeenCalledWith(19.4856, -70.6111);
    expect(res).toEqual(UBICACION);
  });

  it('sin coordenadas responde 422 COORDENADAS_REQUERIDAS y no consulta al proveedor', async () => {
    const { servicio, nominatim } = preparar();

    const error = await capturarError(servicio.porUbicacion(undefined, undefined));

    expect(error.status).toBe(422);
    expect(error.codigo).toBe('COORDENADAS_REQUERIDAS');
    expect(nominatim.ubicacionDe).not.toHaveBeenCalled();
  });

  it('una coordenada imposible también es 422 y no llega a Nominatim', async () => {
    const { servicio, nominatim } = preparar();

    const error = await capturarError(servicio.porUbicacion(19.5, 190));

    expect(error.status).toBe(422);
    expect(error.codigo).toBe('COORDENADAS_REQUERIDAS');
    expect(nominatim.ubicacionDe).not.toHaveBeenCalled();
  });

  it('si el proveedor no está disponible el 503 sube tal cual', async () => {
    const { servicio, nominatim } = preparar();
    nominatim.ubicacionDe.mockRejectedValue(new GeocodificacionNoDisponibleException('HTTP 500'));

    const error = await capturarError(servicio.porUbicacion(19.4856, -70.6111));

    expect(error.status).toBe(503);
    expect(error.codigo).toBe('GEOCODIFICACION_NO_DISPONIBLE');
  });

  it('un país no soportado conserva el 422 PAIS_NO_SOPORTADO', async () => {
    const { servicio, nominatim } = preparar();
    nominatim.ubicacionDe.mockRejectedValue(new PaisNoSoportadoException('US'));

    const error = await capturarError(servicio.porUbicacion(25.76, -80.19));

    expect(error.status).toBe(422);
    expect(error.codigo).toBe('PAIS_NO_SOPORTADO');
  });

  it('declara GET /divisiones/ubicacion como ruta pública, antes del comodín del país', () => {
    const proto = DivisionesController.prototype as unknown as Record<string, unknown>;
    const metodos = Object.getOwnPropertyNames(proto).filter(
      (nombre) => typeof proto[nombre] === 'function',
    );

    const ubicacion = metodos.find(
      (nombre) => Reflect.getMetadata(PATH_METADATA, proto[nombre] as object) === 'ubicacion',
    );

    expect(ubicacion).toBeDefined();
    const handler = proto[ubicacion as string] as object;
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.GET);
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).toBe(true);
    // `GET /divisiones/:paisCodigo` no puede capturar «ubicacion» como país.
    expect(metodos.indexOf(ubicacion as string)).toBeLessThan(metodos.indexOf('listar'));
  });
});
