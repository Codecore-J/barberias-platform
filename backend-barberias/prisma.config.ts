/**
 * Configuración de Prisma — STUB TEMPORAL (Prisma 5.22).
 *
 * `prisma/config` y `definePrismaConfig()` no existen antes de Prisma 6.x: en la
 * línea 5 no se publica ese módulo, así que cualquier `import` desde
 * `prisma/config` rompe `tsc` con TS2307 y deja el proyecto sin compilar.
 *
 * Para no afirmar una API que la versión instalada no ofrece, el archivo se deja
 * como objeto declarativo: Prisma 5 ignora este archivo y la intención de la
 * configuración (`skills.agents`) queda registrada para cuando se migre.
 *
 * TODO: Restaurar importación 'prisma/config' al migrar oficialmente a Prisma 6.x
 */
const configuracionPrisma = {
  skills: {
    agents: ['claude', 'cursor', 'agents', 'devin'],
  },
} as const;

export default configuracionPrisma;
