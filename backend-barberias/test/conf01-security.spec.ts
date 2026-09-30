import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getJwtSecret, DEFAULT_DEV_JWT_SECRET } from '../src/iam/iam.config.js';

describe('CONF-01: Fortalecimiento de JWT_SECRET y Validación de Seguridad', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('Validación de JWT_SECRET (getJwtSecret)', () => {
    it('debe retornar la clave configurada en desarrollo si es válida', () => {
      delete process.env.NODE_ENV;
      process.env.JWT_SECRET = 'mi-clave-de-desarrollo-segura-12345';

      const secret = getJwtSecret();
      expect(secret).toBe('mi-clave-de-desarrollo-segura-12345');
    });

    it('debe retornar el fallback de 256 bits si JWT_SECRET no está definido en desarrollo/test', () => {
      delete process.env.NODE_ENV;
      delete process.env.JWT_SECRET;

      const secret = getJwtSecret();
      expect(secret).toBe(DEFAULT_DEV_JWT_SECRET);
      expect(secret.length).toBeGreaterThanOrEqual(64);
    });

    it('debe fallar inmediatamente en producción si JWT_SECRET no está configurado', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.JWT_SECRET;

      expect(() => getJwtSecret()).toThrowError(/JWT_SECRET debe ser una clave criptográfica/);
    });

    it('debe fallar en producción si JWT_SECRET usa valores triviales o por defecto', () => {
      process.env.NODE_ENV = 'production';

      process.env.JWT_SECRET = 'default-secret-change-in-production';
      expect(() => getJwtSecret()).toThrowError(/JWT_SECRET debe ser una clave criptográfica/);

      process.env.JWT_SECRET = 'super-secret-barberia-jwt-key';
      expect(() => getJwtSecret()).toThrowError(/JWT_SECRET debe ser una clave criptográfica/);
    });

    it('debe fallar en producción si JWT_SECRET tiene menos de 32 caracteres (baja entropía)', () => {
      process.env.NODE_ENV = 'production';
      process.env.JWT_SECRET = 'clave-corta-insegura-123';

      expect(() => getJwtSecret()).toThrowError(/al menos 32 caracteres/);
    });

    it('debe aceptar con éxito en producción una clave de 256 bits (>= 32 caracteres)', () => {
      process.env.NODE_ENV = 'production';
      process.env.JWT_SECRET = 'c4a9f2e8b7d15a3068e49f12d8a7c3b5e0f91a2b3c4d5e6f7a8b9c0d1e2f3a4b';

      const secret = getJwtSecret();
      expect(secret).toBe('c4a9f2e8b7d15a3068e49f12d8a7c3b5e0f91a2b3c4d5e6f7a8b9c0d1e2f3a4b');
    });
  });

  describe('Validación de Políticas de CORS (CONF-02)', () => {
    const allowedOrigins = [
      'https://barberias-platform-git-main-developerstem.vercel.app',
      'https://barberias-platform.vercel.app',
      'http://localhost:4200',
      'http://localhost:3000',
      'http://localhost:5173',
      'http://127.0.0.1:4200',
    ];

    function validateOrigin(origin: string | undefined): boolean {
      if (!origin) return true;
      if (allowedOrigins.includes(origin)) return true;
      return /^https:\/\/barberias-platform.*-developerstem\.vercel\.app$/.test(origin);
    }

    it('debe autorizar el origen de producción en Vercel', () => {
      expect(validateOrigin('https://barberias-platform-git-main-developerstem.vercel.app')).toBe(true);
    });

    it('debe autorizar entornos de desarrollo local estándar (Angular, Vite, Node)', () => {
      expect(validateOrigin('http://localhost:4200')).toBe(true);
      expect(validateOrigin('http://127.0.0.1:4200')).toBe(true);
      expect(validateOrigin('http://localhost:3000')).toBe(true);
    });

    it('debe autorizar previews dinámicos legítimos de Vercel del equipo', () => {
      expect(validateOrigin('https://barberias-platform-feat-auth-developerstem.vercel.app')).toBe(true);
    });

    it('debe rechazar orígenes no autorizados o maliciosos', () => {
      expect(validateOrigin('https://malicious-site.com')).toBe(false);
      expect(validateOrigin('https://evil-barberias.org')).toBe(false);
      expect(validateOrigin('http://fake-localhost:4200')).toBe(false);
    });

    it('debe permitir peticiones sin origen (server-to-server, curl, probes)', () => {
      expect(validateOrigin(undefined)).toBe(true);
    });
  });
});
