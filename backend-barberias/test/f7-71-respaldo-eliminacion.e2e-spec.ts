import { PrismaClient } from '@prisma/client';

/**
 * T-71 · tabla de respaldo antes del borrado real de una cuenta.
 *
 * `respaldo_eliminacion` es el único rastro que sobrevive a la eliminación: el
 * usuario ya no existe cuando la fila se escribe, así que `usuario_id` NO lleva
 * clave foránea (una FK la haría imposible de insertar). El snapshot es JSONB y
 * `eliminado_at` se rellena solo.
 *
 * En rojo falla porque la tabla no existe (42P01).
 */
const prisma = new PrismaClient();

const COLUMNAS = [
  { column_name: 'id', is_nullable: 'NO' },
  { column_name: 'usuario_id', is_nullable: 'NO' },
  { column_name: 'snapshot', is_nullable: 'NO' },
  { column_name: 'eliminado_por', is_nullable: 'NO' },
  { column_name: 'eliminado_at', is_nullable: 'NO' },
];

describe('T-71 · respaldo de eliminación', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('la tabla respaldo_eliminacion existe con sus cinco columnas', async () => {
    const filas = await prisma.$queryRaw<
      { column_name: string; is_nullable: string; column_default: string | null }[]
    >`
      SELECT column_name, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'respaldo_eliminacion'
      ORDER BY ordinal_position
    `;

    expect(filas.map(({ column_name, is_nullable }) => ({ column_name, is_nullable }))).toEqual(
      COLUMNAS,
    );
  });

  it('no declara ninguna FK: el usuario se borra antes de escribir el respaldo', async () => {
    const claves = await prisma.$queryRaw<{ conname: string }[]>`
      SELECT conname
      FROM pg_constraint
      WHERE conrelid = 'respaldo_eliminacion'::regclass
        AND contype = 'f'
    `;

    expect(claves).toEqual([]);
  });

  it('el snapshot es JSONB y eliminado_at tiene valor por defecto', async () => {
    const filas = await prisma.$queryRaw<
      { column_name: string; data_type: string; column_default: string | null }[]
    >`
      SELECT column_name, data_type, column_default
      FROM information_schema.columns
      WHERE table_name = 'respaldo_eliminacion'
        AND column_name IN ('snapshot', 'eliminado_at')
      ORDER BY column_name
    `;

    expect(filas).toEqual([
      expect.objectContaining({ column_name: 'eliminado_at', column_default: expect.stringContaining('now') }),
      expect.objectContaining({ column_name: 'snapshot', data_type: 'jsonb' }),
    ]);
  });
});
