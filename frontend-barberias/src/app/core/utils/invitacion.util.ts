import qrcode from 'qrcode-generator';

/**
 * E3-12/2 · la puerta de entrada del cliente (regla 1.10), en el navegador.
 *
 * Aquí vive lo que el backend a propósito no decide:
 *
 *  - Cómo se LEE una invitación cuando llega escrita por una persona: el mismo
 *    campo tiene que aceptar el código de 8 caracteres dictado en el mostrador,
 *    el enlace único suelto y la URL completa del QR pegada desde el móvil.
 *  - Cómo se COMPONE el enlace que va dentro del QR. El backend no conoce —ni
 *    debe— el origen desde el que se sirve esta aplicación, así que el enlace se
 *    arma aquí, con el origen real del navegador que lo imprime.
 *
 * Todo es puro y sin estado para que la pantalla que lo usa no tenga que
 * replicarlo y las reglas se puedan probar por sí solas.
 */

/** La puerta de entrada tal y como la espera `POST /mi-estado/unirse`. */
export interface PuertaDeEntrada {
  codigoAcceso?: string;
  enlaceUnico?: string;
}

/**
 * El código de acceso que genera el backend: 8 caracteres de un alfabeto
 * alfanumérico. La longitud es el otro rasgo que lo distingue de un enlace.
 */
const LARGO_CODIGO = 8;

/**
 * El segmento de la ruta que sirve la pantalla de unión (`/unirse/:enlaceUnico`).
 * Se nombra aquí para que el parser y la ruta del router no puedan divergir en
 * silencio: si el enlace del QR apunta a otra ruta, la lectura de la URL del QR
 * dejaría de encontrar la invitación.
 */
const RUTA_UNIRSE = 'unirse';

/**
 * Un enlace único generado por el backend es `slug-xxxx` y SIEMPRE lleva un
 * guion (`generateSlug(nombre)` + sufijo). Un texto sin guion y de ocho
 * caracteres es un código; cualquier otra cosa se trata como enlace.
 */
function clasificar(segmento: string): PuertaDeEntrada | null {
  if (!/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(segmento)) {
    return null;
  }

  if (!segmento.includes('-') && segmento.length === LARGO_CODIGO) {
    return { codigoAcceso: segmento.toUpperCase() };
  }

  return { enlaceUnico: segmento.toLowerCase() };
}

/**
 * Traduce lo que la persona pegó a la puerta que viaja en el cuerpo de la
 * petición. Devuelve `null` cuando el texto no puede ser ninguna de las dos: la
 * pantalla avisa sin gastar una llamada al servidor.
 *
 * Acepta, entre otras formas equivalentes:
 *   `ABC12345`  ·  `abc12345`  ·  `ENLACE-XY`  ·  `https://host/unirse/enlace-xy`
 *   ·  `/unirse/enlace-xy?utm=qr`  ·  `  enlace-xy  `
 */
export function parsearInvitacion(texto: string | null | undefined): PuertaDeEntrada | null {
  const crudo = (texto ?? '').trim();
  if (!crudo) {
    return null;
  }

  // Una URL puede traer query o fragmento: la invitación es lo que va en la
  // RUTA, no todo lo que venga detrás.
  const sinParametros = crudo.split(/[?#]/)[0];
  const segmentos = sinParametros.split('/').filter(Boolean);

  if (segmentos.length === 0) {
    return null;
  }

  let valor: string | undefined;
  const posicionRuta = segmentos.indexOf(RUTA_UNIRSE);

  if (posicionRuta >= 0) {
    // La URL del QR: lo que se lee es lo que va DESPUÉS de la ruta. Sin nada
    // detrás —`https://…/unirse/`— no hay invitación, y tomarla del nombre de la
    // ruta daría por buena una URL que solo lleva a la pantalla vacía.
    if (posicionRuta === segmentos.length - 1) {
      return null;
    }

    valor = segmentos[posicionRuta + 1];
  } else {
    // Un código o un enlace suelto, o una ruta compartida a mano
    // (`/imperial-ab12`): no hay nombre de ruta que interpretar.
    valor = segmentos[segmentos.length - 1];
  }

  if (!valor) {
    return null;
  }

  let decodificado: string;
  try {
    decodificado = decodeURIComponent(valor).trim();
  } catch {
    // Un `%` suelto no es un enlace mal escrito: es texto que no se puede leer.
    return null;
  }

  return clasificar(decodificado);
}

/**
 * El enlace único hecho URL, que es lo que se comparte y lo que codifica el QR.
 * Se compone con el origen del navegador que lo pinta para que un QR impreso en
 * el mostrador apunte al dominio donde la sede opera de verdad.
 */
export function urlDeInvitacion(enlaceUnico: string, origen: string): string {
  const base = origen.replace(/\/+$/, '');
  return `${base}/unirse/${encodeURIComponent(enlaceUnico)}`;
}

/**
 * La URL de invitación como imagen embebible (`data:image/gif;base64,…`).
 *
 * El QR se genera EN EL NAVEGADOR y no se pide a ningún servicio externo: lo que
 * codifica es la puerta de entrada de una sede, y mandarla a un tercero para que
 * la dibuje sería regalarla. El margen y el tamaño de celda están elegidos para
 * que el código se lea bien en pantalla y al imprimirlo.
 */
export function qrDeInvitacion(url: string): string {
  const qr = qrcode(0, 'M');
  qr.addData(url);
  qr.make();
  return qr.createDataURL(4, 8);
}
