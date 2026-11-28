import { registerDecorator, ValidationOptions } from 'class-validator';

/**
 * F7 / T-75 · formatos de identidad de República Dominicana.
 *
 * El backend es la única fuente de verdad: estos validadores viven aquí y los
 * DTO los aplican, de modo que un cliente que llame a la API directamente no
 * pueda guardar un teléfono de otro país ni una cédula con el dígito verificador
 * equivocado. El frontend replica las mismas reglas solo para avisar antes.
 */

/** Prefijos móviles/fijos válidos de RD. */
export const PREFIJOS_TELEFONO_RD = ['809', '829', '849'] as const;

/**
 * Deja el teléfono en el formato local de 10 dígitos.
 *
 * Acepta `+18094728320`, `18094728320`, `809-472-8320` y `8094728320`: el
 * `+1` internacional se descarta y todo lo que no sea dígito se ignora. Al
 * guardar SIEMPRE queda la misma forma, que es la clave única de la cuenta.
 */
export function normalizarTelefonoRD(valor: string): string {
  const digitos = (valor ?? '').replace(/\D/g, '');

  if (digitos.length === 11 && digitos.startsWith('1')) {
    return digitos.slice(1);
  }

  return digitos;
}

/** 10 dígitos, prefijo 809/829/849 y no puede ser todo el mismo dígito. */
export function esTelefonoDominicanoValido(valor: string): boolean {
  const telefono = normalizarTelefonoRD(valor);

  if (!/^\d{10}$/.test(telefono)) return false;
  if (/^(\d)\1{9}$/.test(telefono)) return false;

  return (PREFIJOS_TELEFONO_RD as readonly string[]).includes(telefono.slice(0, 3));
}

/**
 * Cédula dominicana: 11 dígitos con dígito verificador.
 *
 * Algoritmo de Luhn adaptado a RD: desde la izquierda, los dígitos se multiplican
 * alternando 1 y 2; si el producto supera 9 se le restan 9; la suma se completa
 * a la decena siguiente y esa diferencia es el verificador.
 *
 * Se ignoran guiones y espacios (`001-0000000-9` es válida), pero se exige que
 * queden exactamente 11 dígitos y que no sea todo ceros.
 */
export function esCedulaDominicanaValida(valor: string): boolean {
  const cedula = (valor ?? '').replace(/\D/g, '');

  if (!/^\d{11}$/.test(cedula)) return false;
  if (/^0{11}$/.test(cedula)) return false;

  const digitos = cedula.split('').map(Number);
  const verificador = digitos.pop() as number;

  const suma = digitos.reduce((total, digito, indice) => {
    const producto = digito * (indice % 2 === 0 ? 1 : 2);
    return total + (producto > 9 ? producto - 9 : producto);
  }, 0);

  return (10 - (suma % 10)) % 10 === verificador;
}

/** Decorador de propiedad para `telefono` en los DTO. */
export function TelefonoDominicano(validationOptions?: ValidationOptions): PropertyDecorator {
  return function (target: object, propertyKey: string | symbol): void {
    registerDecorator({
      name: 'TelefonoDominicano',
      target: target.constructor,
      propertyName: String(propertyKey),
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          if (typeof value !== 'string' || value.length === 0) return true;
          return esTelefonoDominicanoValido(value);
        },
        defaultMessage(): string {
          return 'El teléfono debe ser dominicano: 10 dígitos con prefijo 809, 829 o 849 (o +1 seguido de esos 10).';
        },
      },
    });
  };
}

/** Decorador de propiedad para `cedula` en los DTO. */
export function CedulaDominicana(validationOptions?: ValidationOptions): PropertyDecorator {
  return function (target: object, propertyKey: string | symbol): void {
    registerDecorator({
      name: 'CedulaDominicana',
      target: target.constructor,
      propertyName: String(propertyKey),
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          if (typeof value !== 'string' || value.length === 0) return true;
          return esCedulaDominicanaValida(value);
        },
        defaultMessage(): string {
          return 'La cédula no es válida: 11 dígitos con un dígito verificador correcto.';
        },
      },
    });
  };
}
