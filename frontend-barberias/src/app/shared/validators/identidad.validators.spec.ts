import { FormControl } from '@angular/forms';
import { describe, expect, it } from 'vitest';
import {
  cedulaDominicana,
  cedulaDominicanaValida,
  normalizarTelefonoRD,
  telefonoDominicano,
  telefonoDominicanoValido,
} from './identidad.validators';

/**
 * F7 / T-75 · el formulario rechaza lo mismo que el DTO: si estas reglas se
 * separan de `src/shared/identidad.validator.ts` del backend, el usuario recibe
 * un 400 después de escribir todo.
 */
describe('validadores de identidad (frontend)', () => {
  it('acepta los tres prefijos dominicanos', () => {
    expect(telefonoDominicanoValido('8094728320')).toBe(true);
    expect(telefonoDominicanoValido('8294728320')).toBe(true);
    expect(telefonoDominicanoValido('8494728320')).toBe(true);
  });

  it('normaliza +1, espacios y guiones a 10 dígitos', () => {
    expect(normalizarTelefonoRD('+1 (809) 472-8320')).toBe('8094728320');
    expect(normalizarTelefonoRD('18094728320')).toBe('8094728320');
    expect(telefonoDominicanoValido('+18094728320')).toBe(true);
  });

  it('rechaza prefijos ajenos, longitudes raras y todo ceros', () => {
    expect(telefonoDominicanoValido('3054728320')).toBe(false);
    expect(telefonoDominicanoValido('7874728320')).toBe(false);
    expect(telefonoDominicanoValido('809472832')).toBe(false);
    expect(telefonoDominicanoValido('0000000000')).toBe(false);
  });

  it('el control de teléfono deja pasar el vacío y marca el prefijo ajeno', () => {
    const control = new FormControl('', [telefonoDominicano()]);
    expect(control.errors).toBeNull();
    control.setValue('3054728320');
    expect(control.hasError('telefonoDominicano')).toBe(true);
  });

  it('valida la cédula con su dígito verificador', () => {
    expect(cedulaDominicanaValida('00100000009')).toBe(true);
    expect(cedulaDominicanaValida('00100000000')).toBe(false);
    expect(cedulaDominicanaValida('0010000000')).toBe(false);

    const control = new FormControl('', [cedulaDominicana()]);
    expect(control.errors).toBeNull();
    control.setValue('00100000000');
    expect(control.hasError('cedulaDominicana')).toBe(true);
  });
});
