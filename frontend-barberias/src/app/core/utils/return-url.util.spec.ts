import { PARAM_RETURN_URL, returnUrlSeguro } from './return-url.util';

describe('returnUrlSeguro · H75', () => {
  it('acepta una ruta interna y la devuelve tal cual', () => {
    expect(returnUrlSeguro('/unirse/imperial-ab12')).toBe('/unirse/imperial-ab12');
  });

  it('conserva la query y el fragmento de la ruta pedida', () => {
    const pedida = '/reservar?sede=imperial&paso=2#horarios';
    expect(returnUrlSeguro(pedida)).toBe(pedida);
  });

  it('acepta la raíz', () => {
    expect(returnUrlSeguro('/')).toBe('/');
  });

  it('recorta los espacios de alrededor', () => {
    expect(returnUrlSeguro('  /unirse/imperial-ab12  ')).toBe('/unirse/imperial-ab12');
  });

  it('rechaza un destino absoluto de otro sitio (open redirect)', () => {
    expect(returnUrlSeguro('https://otro-sitio.example/unirse/x')).toBeNull();
    expect(returnUrlSeguro('http://otro-sitio.example')).toBeNull();
  });

  it('rechaza lo que el navegador leería como otro host', () => {
    expect(returnUrlSeguro('//otro-sitio.example/unirse/x')).toBeNull();
    expect(returnUrlSeguro('/\\otro-sitio.example')).toBeNull();
    expect(returnUrlSeguro('/unirse/a\\b')).toBeNull();
  });

  it('rechaza esquemas ejecutables y rutas relativas sin barra', () => {
    expect(returnUrlSeguro('javascript:alert(1)')).toBeNull();
    expect(returnUrlSeguro('unirse/imperial-ab12')).toBeNull();
  });

  it('rechaza los caracteres de control que van por dentro', () => {
    expect(returnUrlSeguro('/unirse/\nimperial-ab12')).toBeNull();
    expect(returnUrlSeguro('/unirse/imperial\tb')).toBeNull();
  });

  it('rechaza las pantallas de sesión para no volver al login tras entrar', () => {
    expect(returnUrlSeguro('/auth/login')).toBeNull();
    expect(returnUrlSeguro('/auth/register')).toBeNull();
    expect(returnUrlSeguro('/auth')).toBeNull();
    expect(returnUrlSeguro('/auth/login?returnUrl=/unirse/x')).toBeNull();
  });

  it('no confunde una ruta que empieza por /auth con las pantallas de sesión', () => {
    expect(returnUrlSeguro('/authores/lista')).toBe('/authores/lista');
  });

  it('devuelve null cuando no hay valor', () => {
    expect(returnUrlSeguro(null)).toBeNull();
    expect(returnUrlSeguro(undefined)).toBeNull();
    expect(returnUrlSeguro('')).toBeNull();
    expect(returnUrlSeguro('   ')).toBeNull();
  });

  it('el nombre del parámetro es el que comparten guard, login y registro', () => {
    expect(PARAM_RETURN_URL).toBe('returnUrl');
  });
});
