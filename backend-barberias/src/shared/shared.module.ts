import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service.js';
import { PrismaExceptionFilter } from './filters/prisma-exception.filter.js';

@Global()
@Module({
  providers: [PrismaService, PrismaExceptionFilter],
  exports: [PrismaService, PrismaExceptionFilter],
})
export class SharedModule {}
