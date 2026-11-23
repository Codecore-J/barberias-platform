import { ValidationPipe, type ArgumentMetadata } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { CreateServicioDto } from './create-servicio.dto.js';
import { UpdateServicioDto } from './update-servicio.dto.js';

/**
 * T-22 · el servicio del catálogo de la sede vuelve a tener DESCRIPCIÓN.
 *
 * DEF-03 dejó el campo fuera del DTO para no aceptarlo y descartarlo en
 * silencio. La decisión ahora es la contraria: la descripción forma parte del
 * catálogo que gestiona el administrador de la barbería, así que el DTO la
 * declara —opcional, texto y máximo 500— y `forbidNonWhitelisted` deja de
 * rechazarla. Lo que sigue prohibido es cualquier OTRA propiedad.
 */
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});

const meta = (metatype: unknown): ArgumentMetadata => ({
  type: 'body',
  metatype: metatype as ArgumentMetadata['metatype'],
  data: '',
});

describe('Servicio · descripción (T-22)', () => {
  it('acepta `descripcion` al crear y la conserva en el DTO', async () => {
    const dto = (await pipe.transform(
      {
        nombre: 'Corte QA',
        precio: 20,
        duracionEstimada: 30,
        descripcion: 'Tijera y máquina',
      },
      meta(CreateServicioDto),
    )) as CreateServicioDto;

    expect(dto).toBeInstanceOf(CreateServicioDto);
    expect(dto.descripcion).toBe('Tijera y máquina');
  });

  it('la descripción es opcional', async () => {
    const dto = (await pipe.transform(
      { nombre: 'Corte QA', precio: 20, duracionEstimada: 30 },
      meta(CreateServicioDto),
    )) as CreateServicioDto;

    expect(dto.descripcion).toBeUndefined();
  });

  it('la edición también admite `descripcion`', async () => {
    const dto = (await pipe.transform(
      { descripcion: 'Texto nuevo' },
      meta(UpdateServicioDto),
    )) as UpdateServicioDto;

    expect(dto.descripcion).toBe('Texto nuevo');
  });

  it('rechaza una descripción de más de 500 caracteres', async () => {
    await expect(
      pipe.transform(
        {
          nombre: 'Corte QA',
          precio: 20,
          duracionEstimada: 30,
          descripcion: 'x'.repeat(501),
        },
        meta(CreateServicioDto),
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('acepta exactamente 500 caracteres', async () => {
    const dto = (await pipe.transform(
      {
        nombre: 'Corte QA',
        precio: 20,
        duracionEstimada: 30,
        descripcion: 'x'.repeat(500),
      },
      meta(CreateServicioDto),
    )) as CreateServicioDto;

    expect(dto.descripcion).toHaveLength(500);
  });

  it('un valor no textual se convierte a texto (el pipe global usa implicit conversion)', async () => {
    const dto = (await pipe.transform(
      { nombre: 'Corte QA', precio: 20, duracionEstimada: 30, descripcion: 123 },
      meta(CreateServicioDto),
    )) as CreateServicioDto;

    expect(dto.descripcion).toBe('123');
  });

  it('sigue rechazando propiedades que el contrato no declara', async () => {
    await expect(
      pipe.transform(
        { nombre: 'Corte QA', precio: 20, duracionEstimada: 30, inventado: true },
        meta(CreateServicioDto),
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
});
