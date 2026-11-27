import { Injectable } from '@nestjs/common';
import {
  NominatimService,
  PAISES_SOPORTADOS,
  PaisNoSoportadoException,
  type UbicacionGeocodificada,
} from '../../geocodificacion/nominatim.service.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { reglaDeNegocio } from '../../shared/errors/d40.errors.js';

/** Un municipio tal como lo consume el select: id y nombre, nada más. */
export interface MunicipioDeCatalogo {
  id: string;
  nombre: string;
}

/** Una provincia con sus municipios ya agrupados y ordenados. */
export interface ProvinciaDeCatalogo {
  id: string;
  nombre: string;
  municipios: MunicipioDeCatalogo[];
}

export interface CatalogoDeDivisiones {
  paisCodigo: string;
  provincias: ProvinciaDeCatalogo[];
}

interface FilaDeDivision {
  id: string;
  nombre: string;
  nivel: number;
  padreId: string | null;
}

/**
 * F6 / T-66 · catálogo de divisiones administrativas para los select del alta.
 *
 * Se agrupa aquí y no en el navegador a propósito: el formulario solo tiene que
 * pintar dos listas, y una sola consulta trae el catálogo completo del país
 * (32 provincias y ~115 municipios), que es un payload pequeño y cambia poco.
 *
 * La lista de países es la MISMA del alta (`PAISES_SOPORTADOS` de T-61): si el
 * alta rechaza un país con 422, el catálogo no puede ofrecerlo.
 */
@Injectable()
export class DivisionesService {
  constructor(
    private readonly prisma: PrismaService,
    // F6 / T-66 · la confirmación del formulario pregunta por las coordenadas
    // antes de crear nada, con el MISMO proveedor que usa el alta.
    private readonly nominatim: NominatimService,
  ) {}

  /**
   * F6 / T-66 · qué provincia y qué municipio corresponden a unas coordenadas.
   *
   * Es una consulta de solo lectura para que el formulario pueda pintar los dos
   * selects como confirmación. No escribe nada y no exige sesión: responde
   * exactamente lo que el alta va a guardar, con los mismos errores del alta
   * (422 si faltan las coordenadas o el país no está soportado, 503 si el
   * proveedor no responde). Lo que el usuario escriba en esos selects NO se
   * guarda: la fuente de verdad es esta respuesta.
   */
  async porUbicacion(latitud?: number, longitud?: number): Promise<UbicacionGeocodificada> {
    if (
      typeof latitud !== 'number' ||
      typeof longitud !== 'number' ||
      !Number.isFinite(latitud) ||
      !Number.isFinite(longitud) ||
      Math.abs(latitud) > 90 ||
      Math.abs(longitud) > 180
    ) {
      throw reglaDeNegocio(
        'COORDENADAS_REQUERIDAS',
        'Confirma la ubicación de la sede antes de continuar: faltan las coordenadas.',
      );
    }

    return this.nominatim.ubicacionDe(latitud, longitud);
  }

  async listar(paisCodigo: string): Promise<CatalogoDeDivisiones> {
    const pais = (paisCodigo ?? '').trim().toUpperCase();

    if (!PAISES_SOPORTADOS.includes(pais)) {
      throw new PaisNoSoportadoException(pais);
    }

    const filas = (await this.prisma.divisionAdministrativa.findMany({
      where: { paisCodigo: pais },
      select: { id: true, nombre: true, nivel: true, padreId: true },
      orderBy: { nombre: 'asc' },
    })) as FilaDeDivision[];

    // El orden se fija aquí y no solo en el `orderBy`: el contrato del select es
    // "alfabético", y así no depende de la collation de cada base.
    const porNombre = (a: { nombre: string }, b: { nombre: string }) =>
      a.nombre.localeCompare(b.nombre, 'es');

    const provincias = filas
      .filter((fila) => fila.nivel === 1)
      .sort(porNombre)
      .map((provincia) => ({
        id: provincia.id,
        nombre: provincia.nombre,
        municipios: filas
          .filter((fila) => fila.nivel === 2 && fila.padreId === provincia.id)
          .map((municipio) => ({ id: municipio.id, nombre: municipio.nombre }))
          .sort(porNombre),
      }));

    return { paisCodigo: pais, provincias };
  }
}
