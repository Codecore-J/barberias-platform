import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './application/auth.service.js';
import { JwtStrategy } from './infrastructure/jwt.strategy.js';
import { RolesGuard } from './infrastructure/roles.guard.js';
import { AuthController } from './infrastructure/auth.controller.js';

import { getJwtSecret } from './iam.config.js';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({
      secret: getJwtSecret(),
      signOptions: {
        expiresIn: '24h', // Los tokens expiran en 24 horas
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, RolesGuard],
  exports: [AuthService, JwtModule, RolesGuard],
})
export class IamModule {}
