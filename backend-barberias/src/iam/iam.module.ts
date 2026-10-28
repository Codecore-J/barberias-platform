import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './application/auth.service.js';
import { OtpService } from './application/otp.service.js';
import { JwtStrategy } from './infrastructure/jwt.strategy.js';
import { RolesGuard } from './infrastructure/roles.guard.js';
import { AuthController } from './infrastructure/auth.controller.js';
// V2.1 · `OtpService` entrega el código por WhatsApp o correo, así que este
// módulo necesita los adaptadores. Se importa SOLO el módulo de adaptadores,
// no `NotificacionesModule` completo: este grafo lo montan aislado pruebas como
// `test/cliente-ficha-roles.e2e-spec.ts`, donde no existen ni
// `EventEmitterModule.forRoot()` (lo exige `RecordatoriosCronService`) ni
// `BullModule.forRoot`.
import { NotificacionesAdaptadoresModule } from '../notificaciones/infrastructure/notificaciones-adaptadores.module.js';

import { getJwtSecret } from './iam.config.js';

// La bandeja de plataforma de usuarios (E4-03/5) NO se registra aquí: depende de
// la auditoría, que trae su cola y su `@Processor`, y eso rompería el grafo
// mínimo que componen las pruebas de este módulo. Tiene el suyo:
// `PlataformaUsuariosModule`.
@Module({
  imports: [
    // V2.1: aporta `EMAIL_PROVIDER` y `WHATSAPP_PROVIDER` a `OtpService`.
    NotificacionesAdaptadoresModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({
      secret: getJwtSecret(),
      signOptions: {
        expiresIn: '24h', // Los tokens expiran en 24 horas
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, OtpService, JwtStrategy, RolesGuard],
  exports: [AuthService, JwtModule, RolesGuard],
})
export class IamModule {}
