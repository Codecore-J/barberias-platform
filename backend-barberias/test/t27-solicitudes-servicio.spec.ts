import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { describe, expect, it, vi } from 'vitest';
import { SolicitudesServicioService } from '../src/catalogo/application/solicitudes-servicio.service.js';
import { SolicitudesServicioController } from '../src/catalogo/infrastructure/solicitudes-servicio.controller.js';
import { PrismaService } from '../src/shared/prisma/prisma.service.js';

/**
 * T-27 · solicitudes de servicio del barbero.
 *
 * La tabla guarda la petición con su estado (`PENDIENTE`, `APROBADA`,
 * `RECHAZADA`), el tipo (`ALTA` o `DESACTIVACION`) y, cuando se rechaza, el
 * motivo. Nada de esto se borra: es el historial de lo que el barbero pidió y
 * cómo se resolvió.
 *
 * En rojo falla porque no hay modelo, ni migración, ni servicio, ni ruta.
 */
const RAIZ = process.cwd();
const ESQUEMA = readFileSync(join(RAIZ, 'prisma/schema.prisma'), 'utf8');
const MIGRACIONES = join(RAIZ, 'prisma/migrations');

const SEDE = '11111111-1111-4111-8111-111111111111';
const BARBERO = '44444444-4444-4444-8444-444444444444';
const CATEGORIA = '55555555-5555-4555-8555-555555555555';
const SERVICIO = '77777777-7777-4777-8777-777777777777';

function modelo(): string {
  return ESQUEMA.match(/model SolicitudServicioBarbero \{[\s\S]*?\n\}/)?.[0] ?? '';
}

function sqlDeSolicitudes(): string {
  return readdirSync(MIGRACIONES)
    .filter((nombre) => nombre.includes('solicitud') && nombre.includes('servicio'))
    .map((carpeta) => {
      try {
        return readFileSync(join(MIGRACIONES, carpeta, 'migration.sql'), 'utf8');
      } catch {
        return '';
      }
    })
    .join('\n');
}

function prismaFalso() {
  return {
    usuarioRol: { findFirst: vi.fn() },
    categoriaServicio: { findFirst: vi.fn() },
    servicioBarbero: { findFirst: vi.fn() },
    solicitudServicioBarbero: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
  };
}

function preparar(prisma: ReturnType<typeof prismaFalso>) {
  prisma.usuarioRol.findFirst.mockResolvedValue({
    usuario: { estadoCuenta: 'ACTIVO' },
  });
  return new SolicitudesServicioService(prisma as unknown as PrismaService);
}

const altaBase = {
  tipo: 'ALTA' as const,
  categoriaId: CATEGORIA,
  nombre: 'Corte degradado',
  precio: 500,
  duracionMinutos: 30,
  descripcion: '  Con máquina y tijera  ',
};

describe('T-27 · solicitudes de servicio del barbero', () => {
  describe('modelo y migración', () => {
    it('declara estados, tipo, motivo, resolución y vínculo al servicio', () => {
      const bloque = modelo();
      expect(bloque).not.toBe('');
      expect(bloque).toMatch(/estado\s+String\s+@default\("PENDIENTE"\)\s+@db\.VarChar\(20\)/);
      expect(bloque).toMatch(/tipo\s+String\s+@db\.VarChar\(20\)/);
      expect(bloque).toMatch(/motivoRechazo\s+String\?\s+@map\("motivo_rechazo"\)/);
      expect(bloque).toMatch(/resueltoPor\s+String\?\s+@map\("resuelto_por"\)/);
      expect(bloque).toMatch(/resueltaAt\s+DateTime\?\s+@map\("resuelta_at"\)/);
      expect(bloque).toMatch(/servicioId\s+String\?\s+@map\("servicio_id"\)/);
      expect(bloque).toMatch(/@@map\("solicitudes_servicio_barbero"\)/);
    });

    it('la migración crea la tabla con CHECKs de estado, tipo y motivo', () => {
      const sql = sqlDeSolicitudes();
      expect(sql).not.toBe('');
      expect(sql).toMatch(
        /CREATE TABLE\s+(IF NOT EXISTS\s+)?"solicitudes_servicio_barbero"/i,
      );
      expect(sql).toMatch(/"?estado"?\s+IN\s*\(\s*'PENDIENTE'\s*,\s*'APROBADA'\s*,\s*'RECHAZADA'\s*\)/i);
      expect(sql).toMatch(/"?tipo"?\s+IN\s*\(\s*'ALTA'\s*,\s*'DESACTIVACION'\s*\)/i);
      expect(sql).toMatch(/motivo_rechazo/i);
      expect(sql).toMatch(/idx_solicitudes_servicio_sede_estado/i);
      expect(sql).not.toMatch(/DROP TABLE|TRUNCATE/i);
    });
  });

  describe('creación de la solicitud', () => {
    it('una solicitud de ALTA nace PENDIENTE y con el barbero del JWT', async () => {
      const prisma = prismaFalso();
      const service = preparar(prisma);
      prisma.categoriaServicio.findFirst.mockResolvedValue({ id: CATEGORIA, activa: true });
      prisma.solicitudServicioBarbero.findFirst.mockResolvedValue(null);
      prisma.solicitudServicioBarbero.create.mockResolvedValue({ id: 'sol-1' });

      await service.crear(SEDE, BARBERO, altaBase);

      expect(prisma.solicitudServicioBarbero.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            barberiaId: SEDE,
            barberoId: BARBERO,
            tipo: 'ALTA',
            estado: 'PENDIENTE',
            categoriaId: CATEGORIA,
            nombrePersonalizado: 'Corte degradado',
            descripcion: 'Con máquina y tijera',
            precio: 500,
            duracionMinutos: 30,
          }),
        }),
      );
    });

    it('una desactivación exige un servicio propio y activo (404 si es ajeno)', async () => {
      const prisma = prismaFalso();
      const service = preparar(prisma);
      prisma.servicioBarbero.findFirst.mockResolvedValue(null);

      const error = await service
        .crear(SEDE, BARBERO, { tipo: 'DESACTIVACION', servicioId: SERVICIO })
        .catch((e: unknown) => e);

      expect(error).toMatchObject({ status: 404 });
      expect(prisma.solicitudServicioBarbero.create).not.toHaveBeenCalled();
    });

    it('no permite dos solicitudes PENDIENTES iguales (409)', async () => {
      const prisma = prismaFalso();
      const service = preparar(prisma);
      prisma.categoriaServicio.findFirst.mockResolvedValue({ id: CATEGORIA, activa: true });
      prisma.solicitudServicioBarbero.findFirst.mockResolvedValue({ id: 'sol-1' });

      const error = await service.crear(SEDE, BARBERO, altaBase).catch((e: unknown) => e);

      expect(error).toMatchObject({
        status: 409,
        response: { codigo: 'SOLICITUD_PENDIENTE' },
      });
      expect(prisma.solicitudServicioBarbero.create).not.toHaveBeenCalled();
    });
  });

  describe('bandeja y panel', () => {
    it('la bandeja de la sede mira solo las PENDIENTES por defecto', async () => {
      const prisma = prismaFalso();
      const service = preparar(prisma);
      prisma.solicitudServicioBarbero.findMany.mockResolvedValue([]);

      await service.listar(SEDE);

      expect(prisma.solicitudServicioBarbero.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { barberiaId: SEDE, estado: 'PENDIENTE' },
        }),
      );
    });
  });

  describe('rutas', () => {
    const rutas = () => {
      const proto = SolicitudesServicioController.prototype as unknown as Record<string, unknown>;
      return Object.getOwnPropertyNames(proto)
        .map((nombre) => proto[nombre])
        .filter((candidato) => typeof candidato === 'function')
        .map((candidato) => ({
          ruta: Reflect.getMetadata(PATH_METADATA, candidato) as string | undefined,
          metodo: Reflect.getMetadata(METHOD_METADATA, candidato) as number | undefined,
        }));
    };

    it('declara POST, GET y PATCH bajo solicitudes-servicio', () => {
      const declaradas = rutas();
      expect(declaradas).toEqual(
        expect.arrayContaining([
          { ruta: '/', metodo: RequestMethod.POST },
          { ruta: '/', metodo: RequestMethod.GET },
          { ruta: ':id', metodo: RequestMethod.PATCH },
        ]),
      );
    });
  });
});
