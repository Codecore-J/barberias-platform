import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { RegisterDto } from './register.dto.js';
import { CrearUsuarioPlataformaDto } from './crear-usuario-plataforma.dto.js';

/**
 * Formato de identidad: teléfono con 10 dígitos exactos y cédula con 11.
 *
 * La regla vive en los DTOs (`@Matches`), no en el controlador, así que se mide
 * aquí: cualquier endpoint que reciba estos DTOs hereda la validación. Es lo que
 * evita que `usuarios.telefono` —que es UNIQUE— se llene de formatos distintos
 * del mismo número.
 */
async function erroresDe<T extends object>(clase: new () => T, datos: Record<string, unknown>) {
  return validate(plainToInstance(clase, datos), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
}

const erroresEn = (errores: Awaited<ReturnType<typeof erroresDe>>, campo: string) =>
  errores.find((e) => e.property === campo)?.constraints ?? {};

const baseRegistro = {
  nombreCompleto: 'Ana Pérez',
  correo: 'ana@example.com',
  telefono: '8095550199',
  password: 'Password1!',
};

describe('validación de teléfono y cédula', () => {
  describe('RegisterDto', () => {
    it('acepta 10 dígitos de teléfono y 11 de cédula', async () => {
      const errores = await erroresDe(RegisterDto, {
        ...baseRegistro,
        cedula: '00112345678',
      });
      expect(errores).toHaveLength(0);
    });

    it('acepta la cédula ausente (es opcional)', async () => {
      const errores = await erroresDe(RegisterDto, baseRegistro);
      expect(errores).toHaveLength(0);
    });

    it.each([
      ['809555019', '9 dígitos'],
      ['80955501990', '11 dígitos'],
      ['+18095550199', 'prefijo internacional'],
      ['809 555 0199', 'espacios'],
      ['809-555-0199', 'guiones'],
      ['809555019a', 'letras'],
    ])('rechaza el teléfono %s (%s)', async (telefono) => {
      const errores = await erroresDe(RegisterDto, { ...baseRegistro, telefono });
      expect(erroresEn(errores, 'telefono').matches).toContain('10 dígitos');
    });

    it.each([
      ['0011234567', '10 dígitos'],
      ['001123456789', '12 dígitos'],
      ['001-12345678', 'guiones'],
    ])('rechaza la cédula %s (%s)', async (cedula) => {
      const errores = await erroresDe(RegisterDto, { ...baseRegistro, cedula });
      expect(erroresEn(errores, 'cedula').matches).toContain('11 dígitos');
    });
  });

  describe('CrearUsuarioPlataformaDto (alta desde /admin/usuarios)', () => {
    const baseAlta = {
      ...baseRegistro,
      rolNombre: 'CLIENTE',
    };

    it('acepta un alta válida', async () => {
      const errores = await erroresDe(CrearUsuarioPlataformaDto, {
        ...baseAlta,
        cedula: '00112345678',
      });
      expect(errores).toHaveLength(0);
    });

    it('exige los mismos 10 dígitos que el registro público', async () => {
      const errores = await erroresDe(CrearUsuarioPlataformaDto, {
        ...baseAlta,
        telefono: '80955501',
      });
      expect(erroresEn(errores, 'telefono').matches).toContain('10 dígitos');
    });

    it('exige 11 dígitos en la cédula', async () => {
      const errores = await erroresDe(CrearUsuarioPlataformaDto, {
        ...baseAlta,
        cedula: '12345678',
      });
      expect(erroresEn(errores, 'cedula').matches).toContain('11 dígitos');
    });
  });
});
