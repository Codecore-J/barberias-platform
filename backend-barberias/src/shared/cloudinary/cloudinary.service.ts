import { Injectable, Logger } from '@nestjs/common';
import { v2 as cloudinary } from 'cloudinary';

/**
 * T-24 · subida de imágenes a Cloudinary.
 *
 * La configuración sale de `CLOUDINARY_URL` (`cloudinary://api_key:api_secret@cloud_name`),
 * que el SDK lee del entorno. Si la variable no está, `configurado()` es false y
 * el llamador responde 503 en lugar de fallar en silencio.
 */
export interface ArchivoSubido {
  buffer: Buffer;
  mimetype: string;
  size: number;
  originalname?: string;
}

export interface ImagenSubida {
  url: string;
  publicId: string;
}

/** Formatos aceptados: el navegador los puede mostrar y Cloudinary los procesa. */
export const TIPOS_IMAGEN_PERMITIDOS = ['image/jpeg', 'image/png', 'image/webp'] as const;

/** 2 MB: suficiente para una foto de servicio y barato de subir desde el móvil. */
export const TAMANO_MAXIMO_IMAGEN = 2 * 1024 * 1024;

@Injectable()
export class CloudinaryService {
  private readonly logger = new Logger(CloudinaryService.name);

  /** Sin `CLOUDINARY_URL` no hay subida posible: el llamador responde 503. */
  configurado(): boolean {
    const url = process.env.CLOUDINARY_URL;
    return typeof url === 'string' && url.trim() !== '';
  }

  async subir(buffer: Buffer, carpeta: string): Promise<ImagenSubida> {
    return new Promise<ImagenSubida>((resolver, rechazar) => {
      const flujo = cloudinary.uploader.upload_stream(
        { folder: carpeta, resource_type: 'image', overwrite: false },
        (error, resultado) => {
          if (error || !resultado) {
            this.logger.error(`Cloudinary rechazó la subida: ${error?.message ?? 'sin resultado'}`);
            rechazar(new Error('No se pudo subir la imagen a Cloudinary.'));
            return;
          }
          resolver({ url: resultado.secure_url, publicId: resultado.public_id });
        },
      );
      flujo.end(buffer);
    });
  }

  /**
   * Borra una imagen previa. Un fallo se registra pero no aborta la sustitución:
   * dejar al barbero sin poder cambiar su foto por un borrado fallido sería peor
   * que dejar un huérfano en Cloudinary, y el huérfano queda en el log.
   */
  async borrar(publicId: string): Promise<void> {
    try {
      await cloudinary.uploader.destroy(publicId, { resource_type: 'image', invalidate: true });
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : String(error);
      this.logger.warn(`No se pudo borrar la imagen ${publicId} de Cloudinary: ${mensaje}`);
    }
  }

  /**
   * `public_id` a partir de la URL guardada. Se necesita para borrar la imagen
   * anterior: `imagen_url` es lo único que persiste el servicio.
   *
   * Acepta URLs con versión (`.../upload/v1700000000/carpeta/foto.webp`) y sin
   * ella, y devuelve `null` para URLs que no son de Cloudinary: nunca se manda a
   * `destroy` algo que no se pudo identificar.
   */
  static publicIdDe(url: string | null | undefined): string | null {
    if (!url) return null;

    const encontrada = url.match(
      /^https?:\/\/res\.cloudinary\.com\/[^/]+\/(?:image|video|raw)\/upload\/(.+)$/i,
    );
    if (!encontrada) return null;

    const sinConsulta = encontrada[1].split('?')[0];
    const partes = sinConsulta.split('/').filter((parte) => parte !== '');
    const version = partes.findIndex((parte) => /^v\d+$/.test(parte));
    const resto = (version >= 0 ? partes.slice(version + 1) : partes).join('/');

    if (resto === '') return null;
    return resto.replace(/\.[a-z0-9]+$/i, '');
  }
}
