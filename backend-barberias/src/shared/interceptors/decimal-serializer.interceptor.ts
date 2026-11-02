import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Observable, map } from 'rxjs';

/**
 * Representación interna de `decimal.js` (la que usa `Prisma.Decimal`).
 * `s` es el signo, `e` el exponente y `d` los dígitos en palabras base 1e7.
 */
interface DecimalSerializado {
  s: number;
  e: number;
  d: number[];
}

/**
 * ¿Es un `Prisma.Decimal` todavía intacto?
 *
 * `Decimal.isDecimal` es el chequeo de la propia librería: reconoce tanto la
 * instancia de Prisma como cualquier `decimal.js` compatible.
 */
function esDecimal(valor: unknown): valor is Prisma.Decimal {
  return Prisma.Decimal.isDecimal(valor);
}

/**
 * ¿Es el resto de un `Decimal` que ya pasó por `instanceToPlain`?
 *
 * `ClassSerializerInterceptor` convierte las clases a objetos planos iterando
 * sus propiedades ENUMERABLES, así que un `Decimal` deja de ser un `Decimal` y
 * se queda en `{ s, e, d }`. Ese objeto ya no sabe multiplicarse ni
 * serializarse como número, y es exactamente lo que llegaba al frontend
 * (`NG02100`: el `CurrencyPipe` recibía `{s,e,d}` en vez de un importe).
 */
function esDecimalSerializado(valor: unknown): valor is DecimalSerializado {
  if (typeof valor !== 'object' || valor === null) return false;

  const claves = Object.keys(valor as object);
  if (claves.length !== 3) return false;

  const { s, e, d } = valor as Partial<DecimalSerializado>;
  return (
    (s === 1 || s === -1) &&
    typeof e === 'number' &&
    Array.isArray(d) &&
    d.length > 0 &&
    d.every((palabra) => typeof palabra === 'number')
  );
}

/**
 * Reconstruye el `Decimal` a partir de su representación `{ s, e, d }`.
 *
 * Se compone el número como notación científica usando los dígitos en claro
 * (`"305e-1"`) en lugar de hacer aritmética con `Number`: así no se pierde
 * precisión en importes altos y el resultado es exactamente el que calculó
 * `decimal.js`.
 */
function desdeDecimalSerializado(valor: DecimalSerializado): Prisma.Decimal {
  const palabras = valor.d.map((palabra, indice) =>
    indice === 0 ? String(palabra) : String(palabra).padStart(7, '0'),
  );

  // `decimal.js` omite los ceros finales del último bloque al imprimir.
  const digitos = palabras.join('').replace(/0+$/, '') || '0';
  const exponente = valor.e + 1 - digitos.length;
  const signo = valor.s < 0 ? '-' : '';

  return new Prisma.Decimal(`${signo}${digitos}e${exponente}`);
}

/** Un objeto plano: lo único que el interceptor reescribe. */
function esObjetoPlano(valor: object): boolean {
  const prototipo = Object.getPrototypeOf(valor);
  return prototipo === Object.prototype || prototipo === null;
}

/**
 * Recorre la respuesta y sustituye cada `Decimal` por su valor numérico.
 *
 * Los `Date` y los `Buffer` se dejan como están (el JSON ya sabe pintarlos y
 * tocarlos alteraría fechas y binarios), y cualquier instancia de clase se
 * devuelve intacta para no romper decoradores de `class-transformer` ni
 * streams. `vistos` evita recursión infinita en estructuras cíclicas.
 */
function normalizarDecimales(valor: unknown, vistos: WeakSet<object>): unknown {
  if (valor === null || typeof valor !== 'object') return valor;

  if (esDecimal(valor)) return valor.toNumber();

  if (valor instanceof Date || Buffer.isBuffer(valor)) return valor;

  if (Array.isArray(valor)) {
    if (vistos.has(valor)) return valor;
    vistos.add(valor);
    return valor.map((elemento) => normalizarDecimales(elemento, vistos));
  }

  if (esDecimalSerializado(valor)) return desdeDecimalSerializado(valor).toNumber();

  if (!esObjetoPlano(valor)) return valor;
  if (vistos.has(valor)) return valor;
  vistos.add(valor);

  const salida: Record<string, unknown> = {};
  for (const [clave, contenido] of Object.entries(valor)) {
    salida[clave] = normalizarDecimales(contenido, vistos);
  }

  return salida;
}

/**
 * Serialización limpia de los `Decimal` de Prisma.
 *
 * Prisma devuelve los campos `DECIMAL` (`Servicio.precio`, `Combo.precioEspecial`,
 * importes de pago, agregados de analítica) como `Prisma.Decimal`. Sin este
 * interceptor la respuesta HTTP los entrega como objetos `{s,e,d}`, que el
 * frontend no puede sumar ni formatear: el `CurrencyPipe` de Angular lanza
 * `NG02100` y el catálogo entero se queda sin precios.
 *
 * La regla es un único tipo de salida: `number`. Es lo que necesitan las tablas,
 * los totales y `currency`/`number` pipes, y el dominio no maneja importes con
 * más precisión de la que un `double` puede representar (dos decimales sobre
 * magnitudes de negocio).
 *
 * Se registra como interceptor GLOBAL y por FUERA de `ClassSerializerInterceptor`:
 * así ve primero el resultado ya serializado (`{s,e,d}`) y lo corrige antes de
 * que salga por el socket. El chequeo de `Prisma.Decimal` sigue presente para
 * cubrir cualquier ruta que no pase por el serializador.
 */
@Injectable()
export class DecimalSerializerInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(map((respuesta) => normalizarDecimales(respuesta, new WeakSet())));
  }
}
