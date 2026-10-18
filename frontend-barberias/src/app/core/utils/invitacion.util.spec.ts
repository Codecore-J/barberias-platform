import { describe, expect, it } from 'vitest';
import { parsearInvitacion, qrDeInvitacion, urlDeInvitacion } from './invitacion.util';

/**
 * E3-12/2 · lo que el cliente pega en el campo de unión (regla 1.10).
 *
 * El backend exige EXACTAMENTE una puerta de entrada y distingue el código del
 * enlace; esta utilidad es la que tiene que acertar cuál de las dos le están
 * pegando, porque de eso depende que la petición llegue con el campo correcto.
 * Los casos son los que de verdad llegan: el código dictado, el enlace copiado
 * de un chat, la URL entera del QR y el enlace con espacios o en otra caja.
 */
describe('parsearInvitacion · la puerta de entrada del cliente', () => {
  it('reconoce el código de acceso de 8 caracteres', () => {
    expect(parsearInvitacion('ABC12345')).toEqual({ codigoAcceso: 'ABC12345' });
  });

  it('sube a mayúsculas el código: su alfabeto no distingue caja', () => {
    expect(parsearInvitacion('abc12345')).toEqual({ codigoAcceso: 'ABC12345' });
  });

  it('recorta los espacios de lo que se pega', () => {
    expect(parsearInvitacion('  ABC12345  ')).toEqual({ codigoAcceso: 'ABC12345' });
  });

  it('reconoce un enlace único suelto y lo baja a minúsculas', () => {
    expect(parsearInvitacion('IMPERIAL-AB12')).toEqual({ enlaceUnico: 'imperial-ab12' });
  });

  it('extrae el enlace de la URL completa del QR', () => {
    expect(parsearInvitacion('https://app.example.com/unirse/imperial-ab12')).toEqual({
      enlaceUnico: 'imperial-ab12',
    });
  });

  it('ignora la query y el fragmento de la URL', () => {
    expect(parsearInvitacion('https://app.example.com/unirse/imperial-ab12?utm=qr#top')).toEqual({
      enlaceUnico: 'imperial-ab12',
    });
  });

  it('acepta una ruta relativa, que es lo que se copia de la barra del navegador', () => {
    expect(parsearInvitacion('/unirse/imperial-ab12')).toEqual({ enlaceUnico: 'imperial-ab12' });
  });

  it('decodifica un enlace percent-encoded', () => {
    expect(parsearInvitacion('https://app.example.com/unirse/imperial%2Dab12')).toEqual({
      enlaceUnico: 'imperial-ab12',
    });
  });

  it('devuelve null cuando no hay nada que leer: la pantalla avisa sin llamar al backend', () => {
    expect(parsearInvitacion('')).toBeNull();
    expect(parsearInvitacion('   ')).toBeNull();
    expect(parsearInvitacion(null)).toBeNull();
    expect(parsearInvitacion(undefined)).toBeNull();
    expect(parsearInvitacion('https://app.example.com/unirse/')).toBeNull();
    expect(parsearInvitacion('un código con espacios')).toBeNull();
  });
});

describe('urlDeInvitacion · el enlace que se comparte y que codifica el QR', () => {
  it('compone el enlace con el origen del navegador que lo pinta', () => {
    expect(urlDeInvitacion('imperial-ab12', 'https://app.example.com')).toBe(
      'https://app.example.com/unirse/imperial-ab12',
    );
  });

  it('no duplica la barra final del origen', () => {
    expect(urlDeInvitacion('imperial-ab12', 'https://app.example.com/')).toBe(
      'https://app.example.com/unirse/imperial-ab12',
    );
  });
});

describe('qrDeInvitacion · el QR se dibuja en el navegador', () => {
  it('devuelve una imagen embebible en el propio dispositivo', () => {
    const imagen = qrDeInvitacion('https://app.example.com/unirse/imperial-ab12');

    // Un `data:` URL: nada de la invitación sale del dispositivo para dibujarse.
    expect(imagen.startsWith('data:image/')).toBe(true);
  });

  it('un enlace más largo produce un código con más módulos (y por tanto más grande)', () => {
    const corto = qrDeInvitacion('https://a.co/unirse/ab12');
    const largo = qrDeInvitacion(
      `https://app.example.com/unirse/imperial-barberia-premium-${'x'.repeat(80)}`,
    );

    expect(largo.length).toBeGreaterThan(corto.length);
  });
});
