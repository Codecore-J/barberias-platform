import { registerDecorator, ValidationOptions } from 'class-validator';

export function PhoneNotRepetitive(validationOptions?: ValidationOptions) {
  return function (target: Object, propertyKey: string, _parameterIndex: number) {
    registerDecorator({
      name: 'PhoneNotRepetitive',
      target: target.constructor,
      propertyName: String(propertyKey),
      options: validationOptions,
      validator: {
        validate(value: any) {
          if (!value) return true;
          const phone = String(value).trim();
          // Rechaza 10 dígitos iguales seguidos (0000000000, 1111111111, ..., 9999999999)
          return !/^(\d)\1{9}$/.test(phone);
        },
        defaultMessage: 'El teléfono no puede ser una secuencia repetitiva (ej. 0000000000).',
      },
    } as any);
  };
}