import { Injectable } from '@nestjs/common';
import {
  PAISES_SOPORTADOS,
  PaisNoSoportadoException,
} from '../../geocodificacion/nominatim.service.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';

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
  constructor(private readonly prisma: PrismaService) {}

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
