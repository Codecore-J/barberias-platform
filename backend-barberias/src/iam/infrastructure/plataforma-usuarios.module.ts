import { Module } from '@nestjs/common';
import { UsuariosPlataformaService } from '../application/usuarios-plataforma.service.js';
import { PlataformaUsuariosController } from './plataforma-usuarios.controller.js';
import { AuditoriaModule } from '../../auditoria/infrastructure/auditoria.module.js';

/**
 * E4-03/5 · D09/D24 · módulo de la bandeja de plataforma para el estado de una
 * cuenta.
 *
 * Vive APARTE de `IamModule` a propósito. `IamModule` lo componen pruebas que
 * levantan un grafo mínimo —`JwtStrategy` y los guards, sin `BullModule.forRoot`
 * (ver `test/cliente-ficha-roles.e2e-spec.ts`)—, y la auditoría trae consigo su
 * cola y su `@Processor`: colgarla de `IamModule` hacía que esas pruebas
 * fallaran con `Worker requires a connection`. La dependencia de auditoría es de
 * ESTE endpoint, así que se declara aquí y `IamModule` conserva su grafo de
 * siempre.
 */
@Module({
  imports: [AuditoriaModule],
  controllers: [PlataformaUsuariosController],
  providers: [UsuariosPlataformaService],
  exports: [UsuariosPlataformaService],
})
export class PlataformaUsuariosModule {}
