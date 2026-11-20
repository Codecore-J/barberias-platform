import { ValidationPipe, type ArgumentMetadata } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { CreateServicioDto } from './create-servicio.dto.js';
import { UpdateServicioDto } from './update-servicio.dto.js';

/**
 * DEF-03 · contrato del catálogo: un servicio NO tiene descripción.
 *
 * Los DTO ya no declaran el campo, así que `forbidNonWhitelisted` (el mismo
 * `ValidationPipe` global de `main.ts`) tiene que rechazar cualquier intento de
 * enviarlo y aceptar el payload sin él. Este test fija ese contrato para que
 * nadie vuelva a añadir el campo por la puerta de atrás.
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

describe('Servicio · contrato sin descripción (DEF-03)', () => {
  it('rechaza `descripcion` como propiedad no declarada', async () => {
    await expect(
      pipe.transform(
        { nombre: 'Corte QA', precio: 20, duracionEstimada: 30, descripcion: 'texto' },
        meta(CreateServicioDto),
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('acepta el payload de creación sin `descripcion`', async () => {
    const dto = (await pipe.transform(
      { nombre: 'Corte QA', precio: 20, duracionEstimada: 30 },
      meta(CreateServicioDto),
    )) as CreateServicioDto;

    expect(dto).toBeInstanceOf(CreateServicioDto);
    expect(dto).not.toHaveProperty('descripcion');
  });

  it('la edición tampoco admite `descripcion`', async () => {
    await expect(
      pipe.transform({ descripcion: 'texto' }, meta(UpdateServicioDto)),
    ).rejects.toMatchObject({ status: 400 });
  });
});
