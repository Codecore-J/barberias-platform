/**
 * Fase 7 · comparación de teléfonos para el webhook de WhatsApp.
 *
 * El número llega del proveedor tal cual lo reenvía (`+18095550000`,
 * `8095550000`, `+1 (809) 555-0000`), mientras que la base guarda el de
 * `usuarios.telefono`. Comparar literalmente rechazaría respuestas legítimas,
 * así que la igualdad se decide sobre los DÍGITOS y con tolerancia al prefijo
 * de país: si el remitente trae uno de más y el resto coincide, es la misma
 * persona.
 *
 * El umbral de 8 dígitos evita que coincidan números demasiado cortos por
 * casualidad (un `1234567` contra un `41234567` no es el mismo teléfono).
 */
export function telefonosCoinciden(esperado: string, recibido: string): boolean {
  const a = (esperado ?? '').replace(/\D/g, '');
  const b = (recibido ?? '').replace(/\D/g, '');

  if (!a || !b) {
    return false;
  }

  if (a === b) {
    return true;
  }

  const [corto, largo] = a.length <= b.length ? [a, b] : [b, a];
  return corto.length >= 8 && largo.endsWith(corto);
}