import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * T-51 · modelo de solicitud de antecedente.
 *
 * El flujo de antecedentes deja de escribir directo: el personal pide y la
 * plataforma resuelve. La petición vive en su propia tabla para no mezclar el
 * historial de decisiones con la tabla `antecedentes`, que solo guarda lo que ya
 * fue aprobado.
 *
 * En rojo falla porque el modelo, la migración y la tabla no existen.
 */
const RAIZ = process.cwd();
const ESQUEMA = readFileSync(join(RAIZ, 'prisma/schema.prisma'), 'utf8');
const MIGRACIONES = join(RAIZ, 'prisma/migrations');

function modelo(): string {
  return ESQUEMA.match(/model SolicitudAntecedente \{[\s\S]*?\n\}/)?.[0] ?? '';
}

function sqlDeSolicitudAntecedente(): string {
  return readdirSync(MIGRACIONES)
    .filter((nombre) => nombre.includes('f501'))
    .map((carpeta) => {
      try {
        return readFileSync(join(MIGRACIONES, carpeta, 'migration.sql'), 'utf8');
      } catch {
        return '';
      }
    })
    .join('\n');
}

describe('T-51 · solicitud de antecedente', () => {
  describe('modelo Prisma', () => {
    it('declara la tabla con solicitante, cliente, motivo, estado y resolución', () => {
      const bloque = modelo();

      expect(bloque).not.toBe('');
      expect(bloque).toMatch(/barberiaId\s+String\s+@map\("barberia_id"\)\s+@db\.Uuid/);
      expect(bloque).toMatch(/solicitanteId\s+String\s+@map\("solicitante_id"\)\s+@db\.Uuid/);
      expect(bloque).toMatch(/clienteId\s+String\s+@map\("cliente_id"\)\s+@db\.Uuid/);
      expect(bloque).toMatch(/motivo\s+String\s+@db\.Text/);
      expect(bloque).toMatch(/evidenciaTexto\s+String\?\s+@map\("evidencia_texto"\)\s+@db\.Text/);
      expect(bloque).toMatch(/estado\s+String\s+@default\("PENDIENTE"\)\s+@db\.VarChar\(20\)/);
      expect(bloque).toMatch(/resueltoPor\s+String\?\s+@map\("resuelto_por"\)\s+@db\.Uuid/);
      expect(bloque).toMatch(/resueltoAt\s+DateTime\?\s+@map\("resuelto_at"\)\s+@db\.Timestamptz/);
      expect(bloque).toMatch(/creadoAt\s+DateTime\?\s+@default\(now\(\)\)\s+@map\("creado_at"\)/);
      expect(bloque).toMatch(/@@map\("solicitudes_antecedente"\)/);
    });

    it('declara los índices por cliente y por sede con su estado', () => {
      const bloque = modelo();

      expect(bloque).toMatch(/@@index\(\[clienteId, estado\]/);
      expect(bloque).toMatch(/@@index\(\[barberiaId, estado\]/);
    });
  });

  describe('migración', () => {
    it('crea la tabla con CHECK de estado y de resolución completa', () => {
      const sql = sqlDeSolicitudAntecedente();

      expect(sql).not.toBe('');
      expect(sql).toMatch(/CREATE TABLE\s+(IF NOT EXISTS\s+)?"solicitudes_antecedente"/i);
      expect(sql).toMatch(
        /"estado"\s+IN\s*\(\s*'PENDIENTE'\s*,\s*'APROBADA'\s*,\s*'DENEGADA'\s*\)/i,
      );
      expect(sql).toMatch(/"resuelto_por"\s+IS NOT NULL/i);
      expect(sql).toMatch(/"resuelto_at"\s+IS NOT NULL/i);
      expect(sql).toMatch(/motivo_denegacion/i);
    });

    it('impide dos PENDIENTES del mismo cliente en la misma sede con un índice único parcial', () => {
      const sql = sqlDeSolicitudAntecedente();

      expect(sql).toMatch(/CREATE UNIQUE INDEX\s+(IF NOT EXISTS\s+)?"uk_solicitud_antecedente_pendiente"/i);
      expect(sql).toMatch(/WHERE\s+"estado"\s*=\s*'PENDIENTE'/i);
      expect(sql).toMatch(/idx_solicitudes_antecedente_cliente_estado/i);
      expect(sql).toMatch(/idx_solicitudes_antecedente_sede_estado/i);
      expect(sql).not.toMatch(/DROP TABLE|TRUNCATE/i);
    });
  });
});
