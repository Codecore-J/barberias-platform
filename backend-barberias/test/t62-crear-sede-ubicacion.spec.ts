import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BarberiaService } from '../src/barberia/application/barberia.service.js';
import { PrismaService } from '../src/shared/prisma/prisma.service.js';
import { AuditoriaService } from '../src/auditoria/application/auditoria.service.js';
import { NotificacionService } from '../src/notificacion/application/notificacion.service.js';
import { CloudinaryService } from '../src/shared/cloudinary/cloudinary.service.js';
import {
  GeocodificacionNoDisponibleException,
  NominatimService,
  PaisNoSoportadoException,
  type UbicacionGeocodificada,
} from '../src/geocodificacion/nominatim.service.js';

/**
 * F6 / T-62 · crear sede exige coordenadas y las divisiones las pone el backend.
 *
 * Lo que fija esta prueba:
 *  1. Sin `latitud`/`longitud` el alta responde **422** y NO consulta al
 *     proveedor ni escribe nada. El 422 lo decide el servicio, no el
 *     `ValidationPipe`: el contrato de F6 pide 422 (regla de negocio), no 400.
 *  2. Coordenadas fuera de rango (|lat| > 90, |lon| > 180) también son 422: un
 *     punto imposible no se manda a Nominatim.
 *  3. Si Nominatim no está disponible → **503** y **no se crea la sede**
 *     (nada a medias).
 *  4. Si el país no está soportado → **422 PAIS_NO_SOPORTADO**, sin crear.
 *  5. Con una geocodificación correcta se persisten latitud, longitud,
 *     `pais_codigo`, las dos divisiones y `direccion_completa`.
 *  5.b Si Nominatim no devuelve una división se guarda NULL: el nombre que
 *     pudiera traer el cuerpo NO se usa como respaldo (T-66).
 *  6. La geocodificación ocurre ANTES de abrir la transacción SERIALIZABLE: no
 *     se retiene un bloqueo de fila esperando a un proveedor externo.
 *
 * Nominatim nunca se llama de verdad: se inyecta un doble.
 */

const RESPONSABLE = 'responsable-1';

const DTO_BASE = {
  nombre: 'Sede Nueva',
  descripcion: 'Una sede de prueba',
  telefono: '8095550000',
  ubicacion: 'Calle 1',
};

const UBICACION: UbicacionGeocodificada = {
  paisCodigo: 'DO',
  divisionNivel1: 'Distrito Nacional',
  divisionNivel2: 'Santo Domingo',
  direccionCompleta: 'Calle 1, Santo Domingo, Distrito Nacional, República Dominicana',
};

const FILA_CREADA = {
  id: 'sede-nueva',
  nombre: DTO_BASE.nombre,
  descripcion: DTO_BASE.descripcion,
  telefono: DTO_BASE.telefono,
  ubicacion: DTO_BASE.ubicacion,
  logoUrl: null,
  codigoAcceso: 'ABC12345',
  enlaceUnico: 'sede-nueva-abc',
  responsableId: RESPONSABLE,
  estado: 'ACTIVO',
};

async function capturarError(
  promesa: Promise<unknown>,
): Promise<{ status: number; codigo: string }> {
  try {
    await promesa;
  } catch (error: any) {
    const respuesta =
      typeof error?.getResponse === 'function' ? error.getResponse() : {};
    return {
      status: error?.getStatus?.() ?? respuesta.statusCode,
      codigo: respuesta.codigo,
    };
  }
  throw new Error('Se esperaba una excepción y la promesa se resolvió.');
}

describe('T-62 · alta de sede con geolocalización obligatoria', () => {
  let servicio: BarberiaService;
  let prisma: any;
  let nominatim: { ubicacionDe: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    nominatim = { ubicacionDe: vi.fn().mockResolvedValue(UBICACION) };

    prisma = {
      $transaction: vi.fn().mockImplementation(async (cb: any) => cb(prisma)),
      usuario: { findUnique: vi.fn().mockResolvedValue({ id: RESPONSABLE }) },
      usuarioRol: {
        findFirst: vi.fn().mockResolvedValue(null),
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      rol: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ id: 'rol-admin', nombre: 'ADMIN_BARBERIA', ambito: 'BARBERIA' }),
      },
      barberia: {
        count: vi.fn().mockResolvedValue(0),
        create: vi.fn().mockResolvedValue(FILA_CREADA),
      },
      configuracionBarberia: { create: vi.fn().mockResolvedValue({}) },
      categoriaServicio: { createMany: vi.fn().mockResolvedValue({ count: 7 }) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BarberiaService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditoriaService, useValue: { registrarEvento: vi.fn().mockResolvedValue({}) } },
        { provide: NotificacionService, useValue: { enviarNotificacion: vi.fn() } },
        { provide: NominatimService, useValue: nominatim },
        // T-64 añadió la subida del logo al mismo servicio: aquí solo tiene que
        // existir para que el módulo de pruebas resuelva.
        {
          provide: CloudinaryService,
          useValue: { configurado: () => false, subir: vi.fn(), borrar: vi.fn() },
        },
      ],
    }).compile();

    servicio = module.get(BarberiaService);
  });

  it('sin coordenadas responde 422 y no consulta ni escribe nada', async () => {
    const error = await capturarError(servicio.create(RESPONSABLE, DTO_BASE as any));

    expect(error.status).toBe(422);
    expect(error.codigo).toBe('COORDENADAS_REQUERIDAS');
    expect(nominatim.ubicacionDe).not.toHaveBeenCalled();
    expect(prisma.barberia.create).not.toHaveBeenCalled();
  });

  it('una latitud imposible también es 422 (no se manda a Nominatim)', async () => {
    const error = await capturarError(
      servicio.create(RESPONSABLE, { ...DTO_BASE, latitud: 91, longitud: -69.9 } as any),
    );

    expect(error.status).toBe(422);
    expect(error.codigo).toBe('COORDENADAS_REQUERIDAS');
    expect(nominatim.ubicacionDe).not.toHaveBeenCalled();
  });

  it('si Nominatim no está disponible responde 503 y NO crea la sede', async () => {
    nominatim.ubicacionDe.mockRejectedValue(
      new GeocodificacionNoDisponibleException('HTTP 500'),
    );

    const error = await capturarError(
      servicio.create(RESPONSABLE, { ...DTO_BASE, latitud: 18.4861, longitud: -69.9312 } as any),
    );

    expect(error.status).toBe(503);
    expect(error.codigo).toBe('GEOCODIFICACION_NO_DISPONIBLE');
    expect(prisma.barberia.create).not.toHaveBeenCalled();
  });

  it('un país no soportado responde 422 PAIS_NO_SOPORTADO y NO crea la sede', async () => {
    nominatim.ubicacionDe.mockRejectedValue(new PaisNoSoportadoException('US'));

    const error = await capturarError(
      servicio.create(RESPONSABLE, { ...DTO_BASE, latitud: 25.76, longitud: -80.19 } as any),
    );

    expect(error.status).toBe(422);
    expect(error.codigo).toBe('PAIS_NO_SOPORTADO');
    expect(prisma.barberia.create).not.toHaveBeenCalled();
  });

  it('persiste coordenadas, país, divisiones y dirección completa', async () => {
    await servicio.create(RESPONSABLE, {
      ...DTO_BASE,
      latitud: 18.4861,
      longitud: -69.9312,
    } as any);

    expect(nominatim.ubicacionDe).toHaveBeenCalledWith(18.4861, -69.9312);
    expect(prisma.barberia.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        latitud: 18.4861,
        longitud: -69.9312,
        paisCodigo: 'DO',
        divisionNivel1: 'Distrito Nacional',
        divisionNivel2: 'Santo Domingo',
        direccionCompleta: UBICACION.direccionCompleta,
      }),
    });
  });

  it('si Nominatim no devuelve las divisiones guarda NULL aunque el cuerpo traiga nombres', async () => {
    nominatim.ubicacionDe.mockResolvedValue({
      ...UBICACION,
      divisionNivel1: null,
      divisionNivel2: null,
    });

    await servicio.create(RESPONSABLE, {
      ...DTO_BASE,
      latitud: 18.4861,
      longitud: -69.9312,
      // El DTO ya no declara estos campos; se pasan a propósito para fijar que
      // el servicio los ignora: la fuente de verdad es solo Nominatim.
      divisionNivel1: 'Santiago',
      divisionNivel2: 'Tamboril',
    } as any);

    expect(prisma.barberia.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        divisionNivel1: null,
        divisionNivel2: null,
      }),
    });
  });

  it('la respuesta del alta incluye las divisiones que dedujo el backend', async () => {
    const resultado = await servicio.create(RESPONSABLE, {
      ...DTO_BASE,
      latitud: 18.4861,
      longitud: -69.9312,
    } as any);

    expect(resultado).toMatchObject({
      id: 'sede-nueva',
      paisCodigo: 'DO',
      divisionNivel1: 'Distrito Nacional',
      divisionNivel2: 'Santo Domingo',
    });
  });

  it('geocodifica antes de abrir la transacción (no retiene bloqueos esperando al proveedor)', async () => {
    await servicio.create(RESPONSABLE, {
      ...DTO_BASE,
      latitud: 18.4861,
      longitud: -69.9312,
    } as any);

    const ordenGeocodificacion = nominatim.ubicacionDe.mock.invocationCallOrder[0];
    const ordenTransaccion = prisma.$transaction.mock.invocationCallOrder[0];
    expect(ordenGeocodificacion).toBeLessThan(ordenTransaccion);
  });
});
