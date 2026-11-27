import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

/**
 * F7 / T-75 · espejo exacto de `src/shared/identidad.validator.ts` del backend.
 *
 * La UI valida antes para no mandar una petición que el DTO rechazaría, pero la
 * regla que manda es la del backend: si cambia allí, cambia aquí.
 */

export const PREFIJOS_TELEFONO_RD = ['809', '829', '849'];

/** Acepta `+1`, espacios y guiones; devuelve siempre 10 dígitos locales. */
export function normalizarTelefonoRD(valor: string): string {
  const digitos = (valor ?? '').replace(/\D/g, '');
  return digitos.length === 11 && digitos.startsWith('1') ? digitos.slice(1) : digitos;
}

export function telefonoDominicanoValido(valor: string): boolean {
  const telefono = normalizarTelefonoRD(valor);
  if (!/^\d{10}$/.test(telefono)) return false;
  if (/^(\d)\1{9}$/.test(telefono)) return false;
  return PREFIJOS_TELEFONO_RD.includes(telefono.slice(0, 3));
}

/** Luhn adaptado a RD: pesos 1 y 2 alternados desde la izquierda. */
export function cedulaDominicanaValida(valor: string): boolean {
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

/** El vacío lo resuelve `Validators.required`; aquí no se marca error. */
export function telefonoDominicano(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const valor = control.value;
    if (typeof valor !== 'string' || valor.trim() === '') return null;
    return telefonoDominicanoValido(valor) ? null : { telefonoDominicano: true };
  };
}

export function cedulaDominicana(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const valor = control.value;
    if (typeof valor !== 'string' || valor.trim() === '') return null;
    return cedulaDominicanaValida(valor) ? null : { cedulaDominicana: true };
  };
}
