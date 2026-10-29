/**
 * V3 fase 6 · métodos de cobro que entiende la caja.
 *
 * `EN_PERSONA` es histórico (lo escribía el cajero antes de esta fase): se sigue
 * leyendo, pero no se acepta en peticiones nuevas. `normalizarMetodo` lo pliega a
 * EFECTIVO para que el arqueo de un día antiguo no pierda ese dinero.
 */
export const METODOS_PAGO = ['EFECTIVO', 'TARJETA', 'TRANSFERENCIA'] as const;

export type MetodoPago = (typeof METODOS_PAGO)[number];

/** Método con el que se guarda un cobro nuevo cuando el cliente no lo indica. */
export const METODO_PAGO_POR_DEFECTO: MetodoPago = 'EFECTIVO';

/**
 * Método de una fila ya guardada, llevado a uno de los tres del arqueo.
 *
 * Un pago histórico `EN_PERSONA` era dinero entregado en mano, así que cae en
 * EFECTIVO; cualquier valor desconocido también, porque perderlo del total sería
 * peor que clasificarlo de más.
 */
export function normalizarMetodo(metodo: string | null | undefined): MetodoPago {
  const valor = (metodo ?? '').toUpperCase();
  if (valor === 'TARJETA') return 'TARJETA';
  if (valor === 'TRANSFERENCIA') return 'TRANSFERENCIA';
  return 'EFECTIVO';
}
