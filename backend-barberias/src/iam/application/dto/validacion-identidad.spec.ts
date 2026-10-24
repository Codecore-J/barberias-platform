import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { RegisterDto } from './register.dto.js';
import { CrearUsuarioPlataformaDto } from './crear-usuario-plataforma.dto.js';
import { CreateBarberiaDto } from '../../../barberia/application/dto/create-barberia.dto.js';
import { UpdateBarberiaDto } from '../../../barberia/application/dto/update-barberia.dto.js';

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

    // El formulario manda "" cuando el campo queda vacío. Sin el `@Transform`
    // fallaría `@Matches` y, además, `""` chocaría contra el índice único parcial
    // de `usuarios.cedula` al haber dos cuentas sin cédula.
    it.each([
      ['undefined', undefined],
      ['null', null],
      ['cadena vacía', ''],
      ['solo espacios', '   '],
    ])('acepta la cédula como %s', async (_caso, cedula) => {
      const errores = await erroresDe(RegisterDto, { ...baseRegistro, cedula });
      expect(errores).toHaveLength(0);
    });

    it('normaliza la cédula vacía a undefined (no guarda "")', () => {
      const dto = plainToInstance(RegisterDto, { ...baseRegistro, cedula: '   ' });
      expect(dto.cedula).toBeUndefined();
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
      ['ABC12345678', 'letras'],
    ])('rechaza la cédula %s (%s)', async (cedula) => {
      const errores = await erroresDe(RegisterDto, { ...baseRegistro, cedula });
      expect(erroresEn(errores, 'cedula').matches).toContain('11 dígitos');
    });

    it('rechaza el teléfono vacío aunque se mande como cadena', async () => {
      const errores = await erroresDe(RegisterDto, { ...baseRegistro, telefono: '' });
      const fallos = erroresEn(errores, 'telefono');
      expect(fallos.matches ?? fallos.isNotEmpty).toBeDefined();
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

    it.each([undefined, null, '', '  '])(
      'acepta la cédula opcional (%s) sin mandarla al índice único',
      async (cedula) => {
        const errores = await erroresDe(CrearUsuarioPlataformaDto, { ...baseAlta, cedula });
        expect(errores).toHaveLength(0);
        // `null` se queda en null y el resto de vacíos pasa a undefined: ninguno
        // llega como "" a PostgreSQL.
        expect(plainToInstance(CrearUsuarioPlataformaDto, { ...baseAlta, cedula }).cedula).toBeFalsy();
      },
    );

    it('convierte la cédula vacía en undefined (nunca en cadena vacía)', async () => {
      const dto = plainToInstance(CrearUsuarioPlataformaDto, { ...baseAlta, cedula: '' });
      expect(dto.cedula).toBeUndefined();
    });
  });

  describe('CreateBarberiaDto y UpdateBarberiaDto', () => {
    const baseSede = {
      nombre: 'Sede Centro',
      telefono: '8095550100',
      ubicacion: 'Av. Principal 1',
    };

    it('acepta el alta de sede con 10 dígitos', async () => {
      expect(await erroresDe(CreateBarberiaDto, baseSede)).toHaveLength(0);
    });

    it.each(['809555010', '80955501001', '809-555-0100'])(
      'rechaza el teléfono %s en el alta de sede',
      async (telefono) => {
        const errores = await erroresDe(CreateBarberiaDto, { ...baseSede, telefono });
        expect(erroresEn(errores, 'telefono').matches).toContain('10 dígitos');
      },
    );

    it('acepta la edición con 10 dígitos', async () => {
      expect(await erroresDe(UpdateBarberiaDto, { telefono: '8095550101' })).toHaveLength(0);
    });

    it('rechaza la edición con 9 dígitos', async () => {
      const errores = await erroresDe(UpdateBarberiaDto, { telefono: '809555010' });
      expect(erroresEn(errores, 'telefono').matches).toContain('10 dígitos');
    });
  });
});
