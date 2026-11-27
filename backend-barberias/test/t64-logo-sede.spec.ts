import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { BarberiaController } from '../src/barberia/infrastructure/barberia.controller.js';
import { BarberiaService } from '../src/barberia/application/barberia.service.js';
import { SolicitudCambioService } from '../src/barberia/application/solicitud-cambio.service.js';
import { AnalyticsService } from '../src/analytics/application/analytics.service.js';
import { PrismaService } from '../src/shared/prisma/prisma.service.js';
import { AuditoriaService } from '../src/auditoria/application/auditoria.service.js';
import { NominatimService } from '../src/geocodificacion/nominatim.service.js';
import { CloudinaryService } from '../src/shared/cloudinary/cloudinary.service.js';

/**
 * F6 / T-64 · logo de la sede por subida de archivo.
 *
 * Lo que fija esta prueba:
 *  1. Existe `PATCH /shops/:shopId/logo` y responde **201** con la URL nueva.
 *     Antes de esta tarea la ruta no existe: Nest responde 404.
 *  2. Solo el ADMIN_BARBERIA de esa sede puede cambiarlo: el ADMINISTRADOR
 *     global no sube logos (la sede es de su dueño) y el servicio lo vuelve a
 *     comprobar aunque el guard ya lo filtró.
 *  3. Sin `CLOUDINARY_URL` responde **503 `IMAGEN_NO_CONFIGURADA`** sin fingir
 *     una subida.
 *  4. Reemplazar el logo **borra el anterior** de Cloudinary (mismo criterio que
 *     la foto de servicio de T-24) y guarda `logo_public_id`.
 *  5. Tipo no permitido → 400 `IMAGEN_TIPO_INVALIDO`; nada se sube.
 */

const SEDE = '11111111-1111-4111-8111-111111111111';
const OTRA_SEDE = '22222222-2222-4222-8222-222222222222';
const URL_NUEVA = 'https://res.cloudinary.com/demo/image/upload/sedes/sede/logo-nuevo.png';
const URL_ANTERIOR = 'https://res.cloudinary.com/demo/image/upload/sedes/sede/logo-viejo.png';

const ADMIN_SEDE = {
  id: 'usuario-admin-sede',
  correo: 'admin.sede@test.com',
  roles: ['ADMIN_BARBERIA'],
  rolesDetallados: [
    { nombre: 'ADMIN_BARBERIA', barberiaId: SEDE, ambito: 'BARBERIA' },
  ],
} as any;

const ADMINISTRADOR_GLOBAL = {
  id: 'usuario-global',
  correo: 'global@test.com',
  roles: ['ADMINISTRADOR'],
  rolesDetallados: [{ nombre: 'ADMINISTRADOR', barberiaId: null, ambito: 'GLOBAL' }],
} as any;

function archivo(mimetype = 'image/png', bytes = 1024) {
  return { mimetype, size: bytes, buffer: Buffer.alloc(bytes, 1), originalname: 'logo.png' };
}

async function capturarError(promesa: Promise<unknown>) {
  try {
    await promesa;
  } catch (error: any) {
    const respuesta = typeof error?.getResponse === 'function' ? error.getResponse() : {};
    return { status: error?.getStatus?.() ?? respuesta.statusCode, codigo: respuesta.codigo };
  }
  throw new Error('Se esperaba una excepción y la promesa se resolvió.');
}

describe('T-64 · PATCH /shops/:shopId/logo', () => {
  let app: INestApplication;
  const actualizarLogo = vi.fn();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [BarberiaController],
      providers: [
        { provide: BarberiaService, useValue: { actualizarLogo } },
        { provide: SolicitudCambioService, useValue: {} },
        { provide: AnalyticsService, useValue: {} },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    actualizarLogo.mockReset();
    actualizarLogo.mockResolvedValue({ id: SEDE, logoUrl: URL_NUEVA });
  });

  it('sube el logo y responde 201 con la URL', async () => {
    const respuesta = await request(app.getHttpServer())
      .patch(`/api/v1/shops/${SEDE}/logo`)
      .attach('archivo', Buffer.from([1, 2, 3]), 'logo.png');

    expect(respuesta.status).toBe(201);
    expect(respuesta.body.logoUrl).toBe(URL_NUEVA);
  });
});

describe('T-64 · BarberiaService.actualizarLogo', () => {
  let servicio: BarberiaService;
  let prisma: any;
  let cloudinary: {
    configurado: ReturnType<typeof vi.fn>;
    subir: ReturnType<typeof vi.fn>;
    borrar: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    cloudinary = {
      configurado: vi.fn().mockReturnValue(true),
      subir: vi.fn().mockResolvedValue({ url: URL_NUEVA, publicId: 'sedes/sede/logo-nuevo' }),
      borrar: vi.fn().mockResolvedValue(undefined),
    };

    prisma = {
      barberia: {
        findUnique: vi.fn().mockResolvedValue({
          id: SEDE,
          logoUrl: URL_ANTERIOR,
          logoPublicId: 'sedes/sede/logo-viejo',
        }),
        update: vi.fn().mockResolvedValue({ id: SEDE, logoUrl: URL_NUEVA }),
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        BarberiaService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditoriaService, useValue: { registrarEvento: vi.fn().mockResolvedValue({}) } },
        { provide: NominatimService, useValue: { ubicacionDe: vi.fn() } },
        { provide: CloudinaryService, useValue: cloudinary },
      ],
    }).compile();

    servicio = moduleRef.get(BarberiaService);
  });

  it('borra el logo anterior de Cloudinary antes de guardar el nuevo', async () => {
    await servicio.actualizarLogo(SEDE, ADMIN_SEDE, archivo() as any);

    expect(cloudinary.borrar).toHaveBeenCalledWith('sedes/sede/logo-viejo');
    expect(cloudinary.subir).toHaveBeenCalledWith(expect.any(Buffer), `sedes/${SEDE}`);
    expect(prisma.barberia.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: SEDE },
        data: expect.objectContaining({
          logoUrl: URL_NUEVA,
          logoPublicId: 'sedes/sede/logo-nuevo',
        }),
      }),
    );
  });

  it('sin CLOUDINARY_URL responde 503 y no toca la base', async () => {
    cloudinary.configurado.mockReturnValue(false);

    const error = await capturarError(
      servicio.actualizarLogo(SEDE, ADMIN_SEDE, archivo() as any),
    );

    expect(error.status).toBe(503);
    expect(error.codigo).toBe('IMAGEN_NO_CONFIGURADA');
    expect(prisma.barberia.update).not.toHaveBeenCalled();
  });

  it('el ADMINISTRADOR global no sube logos', async () => {
    const error = await capturarError(
      servicio.actualizarLogo(SEDE, ADMINISTRADOR_GLOBAL, archivo() as any),
    );

    expect(error.status).toBe(403);
    expect(cloudinary.subir).not.toHaveBeenCalled();
  });

  it('un administrador de OTRA sede no puede cambiar este logo', async () => {
    const ajeno = {
      ...ADMIN_SEDE,
      rolesDetallados: [
        { nombre: 'ADMIN_BARBERIA', barberiaId: OTRA_SEDE, ambito: 'BARBERIA' },
      ],
    } as any;

    const error = await capturarError(
      servicio.actualizarLogo(SEDE, ajeno, archivo() as any),
    );

    expect(error.status).toBe(403);
    expect(cloudinary.subir).not.toHaveBeenCalled();
  });

  it('un tipo que no es imagen responde 400 y no sube nada', async () => {
    const error = await capturarError(
      servicio.actualizarLogo(SEDE, ADMIN_SEDE, archivo('application/pdf') as any),
    );

    expect(error.status).toBe(400);
    expect(error.codigo).toBe('IMAGEN_TIPO_INVALIDO');
    expect(cloudinary.subir).not.toHaveBeenCalled();
  });
});
