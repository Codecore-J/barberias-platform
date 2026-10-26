// Optimización de concurrencia libuv (PERF-01): aumentar pool de hilos para criptografía (Bcrypt)
process.env.UV_THREADPOOL_SIZE = process.env.UV_THREADPOOL_SIZE || '16';

import { NestFactory, Reflector } from '@nestjs/core';
import { ValidationPipe, ClassSerializerInterceptor } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import express from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { PrismaExceptionFilter } from './shared/filters/prisma-exception.filter.js';

async function bootstrap() {
  const allowedEnvs = ['dev', 'staging', 'production'];
  const appEnv = process.env.APP_ENV;
  
  if (!appEnv || !allowedEnvs.includes(appEnv)) {
    console.error(`FATAL ERROR: APP_ENV is required and must be one of: ${allowedEnvs.join(', ')}`);
    process.exit(1);
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // E1-10 · endurecimiento HTTP (punto 4 del backlog):
  // - `helmet()` añade las cabeceras de seguridad (X-Content-Type-Options,
  //   X-Frame-Options, Strict-Transport-Security, Referrer-Policy, CSP, ...).
  // - Límite de cuerpo de 100 kB en JSON y urlencoded para mitigar payloads
  //   excesivos. Estos middlewares se registran ANTES de `init()`, así que
  //   corren primero y el parser por defecto de Nest (que se registra en
  //   `listen()`) solo ve un cuerpo ya parseado (`req._body`) y lo salta.
  app.use(helmet());
  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ limit: '100kb', extended: true }));

  // Confianza en proxy inverso (Render / Cloudflare) para resolución de IP real (SEC-02)
  app.set('trust proxy', 1);

  // Prefijo global de API — todas las rutas serán /api/v1/..., excluyendo healthchecks de infraestructura (MON-01).
  // H64: la sonda de vida (liveness) se excluye igual que la de preparación, para que
  // Render pueda apuntar `healthCheckPath` a /api/v1/health/liveness sin que un Redis
  // caído provoque reinicios de una instancia que sí está sirviendo.
  app.setGlobalPrefix('api/v1', {
    exclude: [
      'health',
      'api/v1/health',
      'health/liveness',
      'api/v1/health/liveness',
      // Fase 7 · el webhook de WhatsApp queda fuera del prefijo: la URL que se
      // configura en Meta Cloud API o en el gateway es /webhooks/whatsapp y no
      // debe cambiar cuando la versión del prefijo cambie.
      'webhooks/whatsapp',
      'api/v1/webhooks/whatsapp',
    ],
  });

  // Configuración estricta de CORS (CONF-02):
  // Solo se permiten orígenes autorizados del frontend oficial y entornos locales de desarrollo.
  const allowedOrigins = [
    'https://barberias-platform-git-main-developerstem.vercel.app',
    'https://barberias-platform.vercel.app',
    'http://localhost:4200',
    'http://localhost:3000',
    'http://localhost:5173',
    'http://127.0.0.1:4200',
  ];

  if (process.env.FRONTEND_URL) {
    allowedOrigins.push(
      ...process.env.FRONTEND_URL.split(',').map((u) => u.trim()),
    );
  }

  app.enableCors({
    origin: (origin, callback) => {
      // Permitir peticiones sin origen (curl, pruebas locales, postman, llamadas servidor a servidor)
      if (!origin) {
        return callback(null, true);
      }

      // Validar si está en la lista blanca de orígenes
      const isAllowed = allowedOrigins.includes(origin);

      // Permitir previsualizaciones dinámicas de Vercel del equipo
      const isVercelPreview = /^https:\/\/barberias-platform.*-developerstem\.vercel\.app$/.test(origin);

      if (isAllowed || isVercelPreview) {
        return callback(null, true);
      }

      return callback(
        new Error(`Política de CORS: El origen ${origin} no está autorizado para acceder a esta API.`),
        false,
      );
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Origin',
      'X-Requested-With',
      'Content-Type',
      'Accept',
      'Authorization',
      'X-RateLimit-Limit',
      'X-RateLimit-Remaining',
      'X-RateLimit-Reset',
      'Retry-After',
    ],
    exposedHeaders: [
      'X-RateLimit-Limit',
      'X-RateLimit-Remaining',
      'X-RateLimit-Reset',
      'Retry-After',
    ],
    credentials: true,
    maxAge: 86400, // Cache de preflight por 24 horas
  });

  // Filtro global de excepciones Prisma:
  // - Postgres 40001 / Prisma P2034 (concurrencia) → HTTP 409 Conflict
  // - Prisma P2002 (violación de unicidad) → HTTP 409 Conflict
  // - Prisma P2025 (no encontrado) → HTTP 404 Not Found
  app.useGlobalFilters(new PrismaExceptionFilter());

  // Pipe de validación global: rechaza campos no declarados en los DTOs
  // y transforma los payloads al tipo correcto antes de llegar al controlador.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // Elimina propiedades no declaradas en el DTO
      forbidNonWhitelisted: true, // Retorna error 400 si llegan propiedades extra
      transform: true, // Transforma el JSON al tipo del DTO automáticamente
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Interceptor global: aplica @Exclude() y @Expose() de class-transformer
  // en todas las respuestas — garantiza que passwordHash nunca se exponga.
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));

  await app.listen(process.env.PORT ?? 3000);
}

await bootstrap();
