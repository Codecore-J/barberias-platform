/**
 * F7 / T-75 · fixtures de identidad con formato dominicano válido.
 *
 * Las suites E2E generaban teléfonos «de 10 dígitos» con prefijos inventados
 * (`80…`, `81…`, `82…`) y cédulas sin dígito verificador. Con el contrato nuevo
 * esos valores rebotan en el DTO con 400, así que las fixtures se construyen
 * aquí: prefijo real + serie, y cédula con su verificador calculado.
 */

const PREFIJOS = ['809', '829', '849'] as const;

/** 10 dígitos: prefijo dominicano + los últimos 7 dígitos de la serie. */
export function telefonoFixture(serie: string | number, prefijo: (typeof PREFIJOS)[number] = '809'): string {
  const digitos = String(serie).replace(/\D/g, '').padStart(7, '0').slice(-7);
  return `${prefijo}${digitos}`;
}

/** 11 dígitos: 10 de base + el verificador de Luhn adaptado a RD. */
export function cedulaFixture(serie: string | number): string {
  const base = String(serie).replace(/\D/g, '').padStart(10, '0').slice(-10);

  const suma = base
    .split('')
    .map(Number)
    .reduce((total, digito, indice) => {
      const producto = digito * (indice % 2 === 0 ? 1 : 2);
      return total + (producto > 9 ? producto - 9 : producto);
    }, 0);

  return `${base}${(10 - (suma % 10)) % 10}`;
}
