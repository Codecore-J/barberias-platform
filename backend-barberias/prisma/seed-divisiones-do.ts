/**
 * F6 / T-65 · seed del catálogo de divisiones administrativas de República
 * Dominicana: las 32 provincias y sus municipios principales.
 *
 * Los datos viven aquí y no en la migración a propósito: una migración describe
 * estructura y se aplica una vez; un catálogo se corrige, se amplía y se vuelve
 * a sembrar. El `upsert` por (país, nivel, nombre) —la misma clave del índice
 * único `uk_divisiones_pais_nivel_nombre`— hace que correrlo dos veces no
 * duplique nada.
 *
 * `nombreNominatim` solo se rellena cuando el proveedor escribe la división de
 * otra forma que el nombre oficial; sirve para emparejar lo que devuelve
 * Nominatim con el catálogo sin renombrar la fila.
 *
 * Se ejecuta desde `prisma/seed.ts` (es decir, con `prisma db seed`) y también
 * suelto con `npm run seed:divisiones`.
 */

export interface ProvinciaDO {
  nombre: string;
  /** Nombre alternativo que usa Nominatim, si difiere del oficial. */
  nombreNominatim?: string;
  /** Cabecera primero; el resto de municipios principales. */
  municipios: string[];
}

/** Las 32 provincias de la República Dominicana, en orden alfabético. */
export const PROVINCIAS_DO: ProvinciaDO[] = [
  {
    nombre: 'Azua',
    municipios: ['Azua de Compostela', 'Las Charcas', 'Estebanía', 'Sabana Yegua'],
  },
  {
    nombre: 'Baoruco',
    municipios: ['Neiba', 'Galván', 'Tamayo', 'Villa Jaragua'],
  },
  {
    nombre: 'Barahona',
    nombreNominatim: 'Barahona',
    municipios: ['Santa Cruz de Barahona', 'Cabral', 'Enriquillo', 'Paraíso'],
  },
  {
    nombre: 'Dajabón',
    municipios: ['Dajabón', 'El Pino', 'Loma de Cabrera', 'Restauración'],
  },
  {
    nombre: 'Distrito Nacional',
    municipios: ['Santo Domingo de Guzmán', 'Santo Domingo'],
  },
  {
    nombre: 'Duarte',
    municipios: ['San Francisco de Macorís', 'Castillo', 'Pimentel', 'Villa Riva'],
  },
  {
    nombre: 'Elías Piña',
    municipios: ['Comendador', 'Bánica', 'El Llano', 'Pedro Santana'],
  },
  {
    nombre: 'El Seibo',
    nombreNominatim: 'El Seibo',
    municipios: ['Santa Cruz del Seibo', 'Miches'],
  },
  {
    nombre: 'Espaillat',
    municipios: ['Moca', 'Cayetano Germosén', 'Gaspar Hernández', 'San Víctor'],
  },
  {
    nombre: 'Hato Mayor',
    municipios: ['Hato Mayor del Rey', 'El Valle', 'Sabana de la Mar'],
  },
  {
    nombre: 'Hermanas Mirabal',
    municipios: ['Salcedo', 'Tenares', 'Villa Tapia'],
  },
  {
    nombre: 'Independencia',
    municipios: ['Jimaní', 'Cristóbal', 'Duvergé', 'La Descubierta'],
  },
  {
    nombre: 'La Altagracia',
    municipios: ['Higüey', 'San Rafael del Yuma', 'Verón Punta Cana'],
  },
  {
    nombre: 'La Romana',
    municipios: ['La Romana', 'Villa Hermosa'],
  },
  {
    nombre: 'La Vega',
    municipios: ['Concepción de La Vega', 'Constanza', 'Jarabacoa', 'Jima Abajo'],
  },
  {
    nombre: 'María Trinidad Sánchez',
    municipios: ['Nagua', 'Cabrera', 'Río San Juan'],
  },
  {
    nombre: 'Monseñor Nouel',
    municipios: ['Bonao', 'Maimón', 'Piedra Blanca'],
  },
  {
    nombre: 'Monte Cristi',
    nombreNominatim: 'Monte Cristi',
    municipios: ['San Fernando de Monte Cristi', 'Castañuelas', 'Guayubín', 'Villa Vásquez'],
  },
  {
    nombre: 'Monte Plata',
    municipios: ['Monte Plata', 'Bayaguana', 'Sabana Grande de Boyá', 'Yamasá'],
  },
  {
    nombre: 'Pedernales',
    municipios: ['Pedernales', 'Oviedo'],
  },
  {
    nombre: 'Peravia',
    municipios: ['Baní', 'Nizao', 'Matanzas'],
  },
  {
    nombre: 'Puerto Plata',
    nombreNominatim: 'Puerto Plata',
    municipios: [
      'San Felipe de Puerto Plata',
      'Altamira',
      'Imbert',
      'Luperón',
      'Sosúa',
      'Villa Isabela',
    ],
  },
  {
    nombre: 'Samaná',
    nombreNominatim: 'Samaná',
    municipios: ['Santa Bárbara de Samaná', 'Las Terrenas', 'Sánchez'],
  },
  {
    nombre: 'San Cristóbal',
    municipios: ['San Cristóbal', 'Bajos de Haina', 'Cambita Garabitos', 'Villa Altagracia'],
  },
  {
    nombre: 'San José de Ocoa',
    municipios: ['San José de Ocoa', 'Rancho Arriba', 'Sabana Larga'],
  },
  {
    nombre: 'San Juan',
    nombreNominatim: 'San Juan',
    municipios: ['San Juan de la Maguana', 'Bohechío', 'El Cercado', 'Las Matas de Farfán'],
  },
  {
    nombre: 'San Pedro de Macorís',
    municipios: ['San Pedro de Macorís', 'Consuelo', 'Quisqueya', 'Ramón Santana'],
  },
  {
    nombre: 'Sánchez Ramírez',
    municipios: ['Cotuí', 'Cevicos', 'Fantino', 'La Mata'],
  },
  {
    nombre: 'Santiago',
    municipios: [
      'Santiago de los Caballeros',
      'Bisonó',
      'Licey al Medio',
      'San José de las Matas',
      'Tamboril',
      'Villa González',
    ],
  },
  {
    nombre: 'Santiago Rodríguez',
    nombreNominatim: 'Santiago Rodríguez',
    municipios: ['San Ignacio de Sabaneta', 'Los Almácigos', 'Monción'],
  },
  {
    nombre: 'Santo Domingo',
    municipios: [
      'Santo Domingo Este',
      'Boca Chica',
      'Los Alcarrizos',
      'Pedro Brand',
      'San Antonio de Guerra',
    ],
  },
  {
    nombre: 'Valverde',
    municipios: ['Santa Cruz de Mao', 'Esperanza', 'Laguna Salada'],
  },
];

export const PAIS_SEMBRADO = 'DO';

/** Lo mínimo que el seed necesita de Prisma; permite probarlo sin base. */
export interface ClienteDivisiones {
  divisionAdministrativa: {
    upsert(args: {
      where: {
        paisCodigo_nivel_nombre: { paisCodigo: string; nivel: number; nombre: string };
      };
      update: { nombreNominatim: string; padreId?: string };
      create: {
        paisCodigo: string;
        nivel: number;
        nombre: string;
        nombreNominatim: string;
        padreId?: string;
      };
      select: { id: true };
    }): Promise<{ id: string }>;
  };
}

export interface ResultadoSeedDivisiones {
  provincias: number;
  municipios: number;
}

/**
 * Siembra (o actualiza) el catálogo. Idempotente por construcción: cada fila se
 * identifica por (país, nivel, nombre) y un segundo pase solo actualiza
 * `nombre_nominatim`/`padre_id`.
 */
export async function sembrarDivisionesDO(
  prisma: ClienteDivisiones,
): Promise<ResultadoSeedDivisiones> {
  let municipios = 0;

  for (const provincia of PROVINCIAS_DO) {
    const filaProvincia = await prisma.divisionAdministrativa.upsert({
      where: {
        paisCodigo_nivel_nombre: {
          paisCodigo: PAIS_SEMBRADO,
          nivel: 1,
          nombre: provincia.nombre,
        },
      },
      update: { nombreNominatim: provincia.nombreNominatim ?? provincia.nombre },
      create: {
        paisCodigo: PAIS_SEMBRADO,
        nivel: 1,
        nombre: provincia.nombre,
        nombreNominatim: provincia.nombreNominatim ?? provincia.nombre,
      },
      select: { id: true },
    });

    for (const municipio of provincia.municipios) {
      await prisma.divisionAdministrativa.upsert({
        where: {
          paisCodigo_nivel_nombre: {
            paisCodigo: PAIS_SEMBRADO,
            nivel: 2,
            nombre: municipio,
          },
        },
        update: { nombreNominatim: municipio, padreId: filaProvincia.id },
        create: {
          paisCodigo: PAIS_SEMBRADO,
          nivel: 2,
          nombre: municipio,
          nombreNominatim: municipio,
          padreId: filaProvincia.id,
        },
        select: { id: true },
      });
      municipios += 1;
    }
  }

  return { provincias: PROVINCIAS_DO.length, municipios };
}

/**
 * Entrada suelta (`npm run seed:divisiones`). `prisma db seed` lo llama a través
 * de `prisma/seed.ts`, junto a roles y permisos.
 */
async function main(): Promise<void> {
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  try {
    const resultado = await sembrarDivisionesDO(prisma as unknown as ClienteDivisiones);
    console.log(
      `✅ Divisiones DO: ${resultado.provincias} provincias y ${resultado.municipios} municipios.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (/seed-divisiones-do/.test(process.argv[1] ?? '')) {
  main().catch((error) => {
    console.error('❌ Error sembrando divisiones:', error.message);
    process.exit(1);
  });
}
