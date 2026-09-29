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
  app.enableCors();

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
