/**
 * Prisma 5 no expone el módulo `prisma/config` (llegó en la v6), así que este
 * archivo no puede importar `definePrismaConfig`. Se deja la configuración como
 * objeto declarativo para no romper `tsc` mientras el proyecto siga en la v5.
 */
const configuracionPrisma = {
  skills: {
    agents: ['claude', 'cursor', 'agents', 'devin'],
  },
} as const;

export default configuracionPrisma;
