import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service.js';
import { PrismaExceptionFilter } from './filters/prisma-exception.filter.js';
import { RELOJ, TiempoService } from './time/tiempo.service.js';

@Global()
@Module({
  providers: [
    PrismaService,
    PrismaExceptionFilter,
    TiempoService,
    // E2-04 · el reloj real es un proveedor: las pruebas lo sustituyen por uno
    // fijo y ningún servicio vuelve a llamar a `new Date()` para leer "ahora".
    { provide: RELOJ, useValue: () => new Date() },
  ],
  exports: [PrismaService, PrismaExceptionFilter, TiempoService],
})
export class SharedModule {}
