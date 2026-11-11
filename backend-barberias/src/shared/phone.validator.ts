import { registerDecorator, ValidationOptions } from 'class-validator';

/**
 * Rechaza teléfonos formados por el mismo dígito repetido diez veces
 * (`0000000000`, `1111111111`, …).
 *
 * Existe porque el CHECK de la base sólo mira la forma: diez ceros cumplen
 * `^[0-9]{10}$` y entran sin objeción. Así se llenaron las sedes fantasma con
 * `0000000000` que parecían tener un contacto válido.
 *
 * Nota histórica: la firma original era `(target, propertyKey, _parameterIndex)`,
 * la de un decorador de parámetro. Por eso TypeScript la rechazaba con TS1240 al
 * usarla sobre una propiedad —«Unable to resolve signature of property decorator
 * when called as an expression»— y nadie pudo conectarla: el validador existía,
 * compilaba y no protegía nada. Esta versión usa la firma correcta.
 */
export function PhoneNotRepetitive(validationOptions?: ValidationOptions): PropertyDecorator {
  return function (target: object, propertyKey: string | symbol): void {
    registerDecorator({
      name: 'PhoneNotRepetitive',
      target: target.constructor,
      propertyName: String(propertyKey),
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          if (!value) return true;
          const telefono = value.toString().trim();
          return !/^(\d)\1{9}$/.test(telefono);
        },
        defaultMessage(): string {
          return 'El teléfono no puede ser una secuencia repetitiva (ej. 0000000000).';
        },
      },
    });
  };
}
