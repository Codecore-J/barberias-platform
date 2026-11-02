/**
 * Redondea un importe en base 10, evitando los residuos habituales de IEEE 754.
 * Los valores que no se pueden convertir a un número finito se normalizan a 0.
 */
export function redondearMoneda(value: number | string, decimals = 2): number {
  const numero = typeof value === 'number' ? value : Number(value);
  const decimalesSeguros = Math.trunc(decimals);

  if (!Number.isFinite(numero) || !Number.isFinite(decimalesSeguros) || decimalesSeguros < 0) {
    return 0;
  }

  const factor = 10 ** decimalesSeguros;
  if (!Number.isFinite(factor)) return 0;

  return Math.round((numero + Number.EPSILON) * factor) / factor;
}

/** Suma importes numéricos o textuales y redondea el total una sola vez. */
export function sumarSeguro(valores: (number | string)[]): number {
  const total = valores.reduce<number>((acumulado, valor) => {
    const numero = typeof valor === 'number' ? valor : Number(valor);
    return acumulado + (Number.isFinite(numero) ? numero : 0);
  }, 0);

  return redondearMoneda(total);
}
