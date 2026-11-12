import { HttpErrorResponse } from '@angular/common/http';
import { describe, expect, it } from 'vitest';
import { MENSAJE_GENERICO, mensajeParaUsuario, sanitizar } from './errores';
import { mensajeDeError } from './error-message';

/**
 * Prioridad alta UI/UX · los toasts mostraban el texto crudo del backend: rutas
 * técnicas (`/api/v1/shops/null/hours`), nombres de excepciones de Prisma y
 * `null`/`undefined`. Este mapeo centraliza la traducción y el interceptor deja
 * de decidir textos.
 */
function respuesta(status: number, cuerpo: unknown = null): HttpErrorResponse {
  return new HttpErrorResponse({
    status,
    error: cuerpo,
    url: 'http://localhost:3000/api/v1/shops/null/hours',
  });
}

describe('errores · mapeo global para toasts', () => {
  it('usa el diccionario cuando el backend manda un texto técnico', () => {
    const { mensaje, titulo } = mensajeParaUsuario(
      respuesta(409, {
        codigo: 'CORREO_YA_REGISTRADO',
        mensaje: 'Unique constraint failed on the fields: (`correo`)',
      }),
    );

    expect(mensaje).toBe('Ese correo ya está registrado. Inicia sesión o usa otro correo.');
    expect(titulo).toBe('Datos ya registrados');
  });

  it('respeta el mensaje de negocio aunque el código tenga ficha propia', () => {
    // `ESTADO_INVALIDO` se usa en reservas Y en vinculaciones: la ficha genérica
    // del diccionario no puede pisar el redactado del dominio.
    const { mensaje } = mensajeParaUsuario(
      respuesta(409, {
        codigo: 'ESTADO_INVALIDO',
        mensaje: 'La vinculación ya está resuelta (ACTIVO).',
      }),
    );

    expect(mensaje).toBe('La vinculación ya está resuelta (ACTIVO).');
  });

  it('traduce por código aunque el backend no mande mensaje', () => {
    expect(mensajeParaUsuario(respuesta(422, { codigo: 'CLIENTE_RESTRINGIDO' })).mensaje).toBe(
      'No puedes reservar en esta barbería porque tienes inasistencias acumuladas. Habla con la sede para resolverlo.',
    );
  });

  it('no deja pasar una ruta técnica en un 404', () => {
    const { mensaje } = mensajeParaUsuario(
      respuesta(404, { message: 'Cannot GET /api/v1/shops/null/hours' }),
    );

    expect(mensaje).toBe(
      'No encontramos lo que buscas. Puede que se haya eliminado o que el enlace ya no sea válido.',
    );
    expect(mensaje).not.toMatch(/\/api\/|null|GET/);
  });

  it('no deja pasar una traza de Prisma en un 500', () => {
    const { mensaje } = mensajeParaUsuario(
      respuesta(500, {
        message: 'Invalid `prisma.shop.findMany()` invocation: at PrismaClient._executeRequest',
      }),
    );

    expect(mensaje).toBe(
      'Tuvimos un problema al procesar tu solicitud. Inténtalo de nuevo en unos minutos.',
    );
    expect(mensaje).not.toMatch(/prisma|at /i);
  });

  it('conserva el mensaje de negocio del backend cuando es legible', () => {
    expect(
      mensajeParaUsuario(respuesta(400, { mensaje: 'El código de acceso venció. Pide uno nuevo.' }))
        .mensaje,
    ).toBe('El código de acceso venció. Pide uno nuevo.');
  });

  it('mapea un duplicado sin mensaje legible a un texto accionable', () => {
    const { mensaje, titulo } = mensajeParaUsuario(
      respuesta(409, { message: 'Unique constraint failed on the fields: (`correo`)' }),
    );

    expect(titulo).toBe('Datos duplicados');
    expect(mensaje).toBe(
      'Ya existe un registro con esos datos. Revisa la información e inténtalo de nuevo.',
    );
  });

  it('mapea credenciales inválidas, sin conexión, 429 y 404 genéricos', () => {
    expect(mensajeParaUsuario(respuesta(401)).mensaje).toBe(
      'Tu sesión expiró o las credenciales no son correctas. Vuelve a iniciar sesión.',
    );
    expect(mensajeParaUsuario(respuesta(0)).mensaje).toBe(
      'No pudimos conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.',
    );
    expect(mensajeParaUsuario(respuesta(429)).titulo).toBe('Demasiados intentos');
    expect(mensajeParaUsuario(respuesta(404)).mensaje).toBe(
      'No encontramos lo que buscas. Puede que se haya eliminado o que el enlace ya no sea válido.',
    );
  });

  it('une los errores de validación de un 400 y descarta los técnicos', () => {
    const { mensaje } = mensajeParaUsuario(
      respuesta(400, {
        message: [
          'el correo no es válido',
          'Cannot GET /api/v1/shops',
          'el teléfono debe tener 10 dígitos',
        ],
      }),
    );

    expect(mensaje).toBe('el correo no es válido · el teléfono debe tener 10 dígitos');
  });

  it('cae en el mensaje genérico para lo que no está mapeado', () => {
    expect(mensajeParaUsuario(respuesta(418, {}))).toEqual(MENSAJE_GENERICO);
    expect(mensajeParaUsuario(new Error('boom'))).toEqual(MENSAJE_GENERICO);
  });
});

describe('sanitizar · el texto técnico no llega a la interfaz', () => {
  it('descarta rutas, trazas, nombres de Prisma, nulos y errores de JS', () => {
    expect(sanitizar('Cannot GET /api/v1/shops/null/hours')).toBeNull();
    expect(sanitizar('at Object.<anonymous> (src/main.ts:10:3)')).toBeNull();
    expect(sanitizar('PrismaClientKnownRequestError')).toBeNull();
    expect(sanitizar('El valor es null')).toBeNull();
    expect(sanitizar('TypeError: no es una función')).toBeNull();
    expect(sanitizar('Unique constraint failed on the fields: (`correo`)')).toBeNull();
  });

  it('conserva y normaliza el texto legible', () => {
    expect(sanitizar('  El   código  venció ')).toBe('El código venció');
    expect(sanitizar('')).toBeNull();
    expect(sanitizar(null)).toBeNull();
    expect(sanitizar(42)).toBeNull();
  });
});

describe('mensajeDeError · errores dentro de formularios', () => {
  it('usa el respaldo cuando el backend manda un texto técnico', () => {
    expect(
      mensajeDeError(
        respuesta(500, { message: 'Invalid prisma.reserva.findMany() invocation' }),
        'No se pudo cargar la agenda.',
      ),
    ).toBe('No se pudo cargar la agenda.');
  });

  it('conserva el mensaje de un error de JavaScript', () => {
    expect(
      mensajeDeError(new Error('La sede no está disponible para esta cuenta.'), 'respaldo'),
    ).toBe('La sede no está disponible para esta cuenta.');
  });

  it('prioriza el código D40 sobre el texto crudo', () => {
    expect(
      mensajeDeError(respuesta(422, { codigo: 'PASSWORD_REQUERIDA', mensaje: 'x' }), 'respaldo'),
    ).toBe('Escribe tu contraseña actual para confirmar el cambio.');
  });
});
