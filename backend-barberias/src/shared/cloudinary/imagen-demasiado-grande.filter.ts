import { ArgumentsHost, Catch, ExceptionFilter, PayloadTooLargeException } from '@nestjs/common';
import { MulterError } from 'multer';
import { TAMANO_MAXIMO_IMAGEN } from './cloudinary.service.js';

/** Mensaje único para las dos vías que pueden rechazar un archivo grande. */
export const MENSAJE_IMAGEN_DEMASIADO_GRANDE = `La imagen no puede superar los ${Math.round(
  TAMANO_MAXIMO_IMAGEN / (1024 * 1024),
)} MB.`;

/**
 * Contrato D40 para «archivo demasiado grande».
 *
 * El límite de 2 MB se aplica dos veces: Multer corta el flujo antes de que el
 * archivo llegue al controlador y `ServiciosBarberoService.actualizarImagen`
 * vuelve a comprobarlo. El corte de Multer salía como 413 con el formato de
 * Nest (`{ statusCode, message }`); la validación del servicio, como 400 con
 * `{ statusCode, codigo, mensaje }`. El mismo hecho tenía dos respuestas y el
 * cliente no podía tratarlas igual.
 *
 * Este filtro —declarado solo en la ruta de la imagen— traduce las dos
 * excepciones del límite al 400 `IMAGEN_DEMASIADO_GRANDE`. No toca ninguna otra
 * ruta ni captura errores que no sean del tamaño del archivo.
 */
@Catch(PayloadTooLargeException, MulterError)
export class ImagenDemasiadoGrandeFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const esLimite =
      exception instanceof PayloadTooLargeException ||
      (exception instanceof MulterError && exception.code === 'LIMIT_FILE_SIZE');

    // `@Catch` ya acota los tipos; esta guarda evita traducir un `MulterError`
    // de otra clase (campo inesperado, archivos de más) a un mensaje de tamaño.
    if (!esLimite) {
      throw exception;
    }

    const respuesta = host.switchToHttp().getResponse<{
      status(codigo: number): { json(cuerpo: unknown): void };
    }>();

    respuesta.status(400).json({
      statusCode: 400,
      codigo: 'IMAGEN_DEMASIADO_GRANDE',
      mensaje: MENSAJE_IMAGEN_DEMASIADO_GRANDE,
    });
  }
}
