import { plainToInstance } from 'class-transformer';
import { IsOptional, validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { BooleanoEstricto } from './booleano-estricto.decorator.js';

// Los DTOs reales del catálogo declaran `@IsOptional()` junto al decorador;
// se replica aquí para que el caso `undefined` represente el uso verdadero.
class DtoPrueba {
  @IsOptional()
  @BooleanoEstricto()
  destacado?: boolean;
}

const validar = async (valor: unknown) =>
  validate(plainToInstance(DtoPrueba, { destacado: valor }), { whitelist: true });

describe('BooleanoEstricto', () => {
  it.each([true, false, 'true', 'false', 1, 0, '1', '0', undefined])(
    'acepta el booleano inequívoco %s',
    async (valor) => {
      expect(await validar(valor)).toHaveLength(0);
    },
  );

  it.each(['si', 'no', 'verdadero', 2, {}, []])('rechaza %s', async (valor) => {
    const errores = await validar(valor);
    expect(errores).toHaveLength(1);
    expect(errores[0].constraints?.isBoolean).toBeDefined();
  });

  // El motivo de existir del decorador: `@IsBoolean` a secas acepta "si" cuando
  // el pipe convierte con `enableImplicitConversion`. Aquí la cadena no se
  // convierte, así que la regla queda escrita de forma que no dependa del pipe.
  it('no convierte una cadena arbitraria en true', async () => {
    const errores = await validar('si');
    expect(errores).not.toHaveLength(0);
  });
});
