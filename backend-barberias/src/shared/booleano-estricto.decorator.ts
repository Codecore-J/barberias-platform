// `@Type` de class-transformer lee metadatos por `Reflect.getMetadata`, que sólo
// existe si `reflect-metadata` está cargado. Se importa aquí para que el
// decorador funcione también en pruebas sueltas y no dependa de que otro módulo
// lo haya cargado antes.
import 'reflect-metadata';
import { Transform, Type } from 'class-transformer';
import { IsBoolean } from 'class-validator';

/**
 * Booleano que no acepta cualquier cosa.
 *
 * `@IsBoolean()` a secas no basta con `enableImplicitConversion: true` en el
 * `ValidationPipe` global: el pipe pasa cualquier cadena por `Boolean(...)`, de
 * modo que `"si"` o `"no"` se convierten en `true` y pasan la validación.
 *
 * Medido en vivo (nov-2026) sobre el alta de servicio del tenant QA: enviar
 * `{"destacado": "si"}` devolvía **201** y creaba el servicio. `"no"` habría
 * creado uno no destacado, con la misma apariencia que un booleano legítimo.
 *
 * Este decorador normaliza solo lo que no tiene ambigüedad —`true`/`false`,
 * las cadenas `"true"`/`"false"` y `1`/`0`, que es lo que manda un formulario
 * HTML— y deja intacto el resto para que `@IsBoolean` lo rechace con 400.
 */
export function BooleanoEstricto(): PropertyDecorator {
  // `@Type(() => String)` es imprescindible y no es decorativo: sin un tipo
  // explícito, `enableImplicitConversion` convierte con `Boolean(valor)` ANTES
  // de que corra cualquier `@Transform`, así que el decorador nunca llega a ver
  // el `"si"` original y lo recibe ya como `true`. Declarar el tipo intermedio
  // como texto desactiva esa conversión y deja el valor crudo a la vista.
  const tipoIntermedio = Type(() => String);

  const normalizar = Transform(({ value }: { value: unknown }) => {
    if (typeof value === 'boolean') return value;
    if (value === 'true' || value === 1 || value === '1') return true;
    if (value === 'false' || value === 0 || value === '0') return false;
    return value;
  });

  const validar = IsBoolean();

  return (target: object, propertyKey: string | symbol): void => {
    tipoIntermedio(target, propertyKey);
    normalizar(target, propertyKey);
    validar(target, propertyKey);
  };
}
