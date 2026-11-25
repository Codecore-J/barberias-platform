import { PayloadTooLargeException, RequestMethod } from '@nestjs/common';
import { EXCEPTION_FILTERS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { MulterError } from 'multer';
import { describe, expect, it, vi } from 'vitest';
import { ImagenDemasiadoGrandeFilter } from '../src/shared/cloudinary/imagen-demasiado-grande.filter.js';
import { ServiciosBarberoController } from '../src/catalogo/infrastructure/servicios-barbero.controller.js';

/**
 * Contrato único para «archivo demasiado grande».
 *
 * Multer corta el archivo por encima de 2 MB con su propio error, y hasta ahora
 * ese error salía como 413 con el formato de Nest (`{ statusCode, message }`),
 * distinto del D40 (`{ statusCode, codigo, mensaje }`) que devuelve la validación
 * del servicio. Esta prueba fija que los dos caminos —el corte de Multer y la
 * validación propia— responden 400 `IMAGEN_DEMASIADO_GRANDE` con el mismo
 * mensaje, y que la ruta de la imagen declara el filtro.
 *
 * En rojo falla porque ni el filtro ni la declaración existen.
 */
const MENSAJE = 'La imagen no puede superar los 2 MB.';

function respuestaFalsa() {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  return { response: { status, json }, status, json };
}

function hostFalso(respuesta: ReturnType<typeof respuestaFalsa>) {
  return {
    switchToHttp: () => ({ getResponse: () => respuesta.response }),
  } as any;
}

describe('imagen demasiado grande · un solo contrato D40', () => {
  it('el corte de Multer (LIMIT_FILE_SIZE) responde 400 IMAGEN_DEMASIADO_GRANDE', () => {
    const respuesta = respuestaFalsa();
    const filtro = new ImagenDemasiadoGrandeFilter();

    filtro.catch(new MulterError('LIMIT_FILE_SIZE'), hostFalso(respuesta));

    expect(respuesta.status).toHaveBeenCalledWith(400);
    expect(respuesta.json).toHaveBeenCalledWith({
      statusCode: 400,
      codigo: 'IMAGEN_DEMASIADO_GRANDE',
      mensaje: MENSAJE,
    });
  });

  it('un PayloadTooLargeException también responde el mismo 400', () => {
    const respuesta = respuestaFalsa();
    const filtro = new ImagenDemasiadoGrandeFilter();

    filtro.catch(new PayloadTooLargeException(), hostFalso(respuesta));

    expect(respuesta.status).toHaveBeenCalledWith(400);
    expect(respuesta.json).toHaveBeenCalledWith({
      statusCode: 400,
      codigo: 'IMAGEN_DEMASIADO_GRANDE',
      mensaje: MENSAJE,
    });
  });

  it('la ruta PATCH mis-servicios/:id/imagen declara el filtro', () => {
    const proto = ServiciosBarberoController.prototype as unknown as Record<string, unknown>;
    const metodo = Object.getOwnPropertyNames(proto)
      .map((nombre) => proto[nombre])
      .find(
        (candidato) =>
          typeof candidato === 'function' &&
          Reflect.getMetadata(PATH_METADATA, candidato) === 'mis-servicios/:id/imagen' &&
          Reflect.getMetadata(METHOD_METADATA, candidato) === RequestMethod.PATCH,
      );

    expect(metodo).toBeDefined();
    const filtros = Reflect.getMetadata(EXCEPTION_FILTERS_METADATA, metodo as object) ?? [];
    expect(filtros).toContain(ImagenDemasiadoGrandeFilter);
  });
});
