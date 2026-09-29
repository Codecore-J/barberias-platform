// Optimización de concurrencia libuv (PERF-01): aumentar pool de hilos para criptografía (Bcrypt)
process.env.UV_THREADPOOL_SIZE = process.env.UV_THREADPOOL_SIZE || '16';

import { NestFactory, Reflector } from '@nestjs/core';
import { ValidationPipe, ClassSerializerInterceptor } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { PrismaExceptionFilter } from './shared/filters/prisma-exception.filter.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Confianza en proxy inverso (Render / Cloudflare) para resolución de IP real (SEC-02)
  app.set('trust proxy', 1);

  // Prefijo global de API — todas las rutas serán /api/v1/...
  app.setGlobalPrefix('api/v1');

  // Configuración estricta de CORS (CONF-01):
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
