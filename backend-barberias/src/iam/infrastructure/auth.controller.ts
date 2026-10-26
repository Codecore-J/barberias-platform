import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
} from '@nestjs/common';
import { AuthService } from '../application/auth.service.js';
import { RegisterDto } from '../application/dto/register.dto.js';
import { LoginDto } from '../application/dto/login.dto.js';
import { ForgotPasswordDto } from '../application/dto/forgot-password.dto.js';
import { ResetPasswordDto } from '../application/dto/reset-password.dto.js';
import { UsuarioResponseDto } from '../application/dto/usuario-response.dto.js';
import { Public } from './public.decorator.js';
import { CurrentUser } from './current-user.decorator.js';
import type { UsuarioAutenticado } from '../domain/jwt.interface.js';
import { Throttle } from '@nestjs/throttler';
import { Autenticado } from './autenticado.decorator.js';

@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  /**
   * Registro de un nuevo usuario en la plataforma.
   * Rate Limit (SEC-02): Máximo 5 registros por minuto por IP para evitar spam masivo.
   *
   * E3-contrato: devuelve el mismo contrato que `login`
   * (`{ accessToken, usuario }`) porque el frontend inicia sesión
   * automáticamente con el token recibido (auto-login tras registro).
   */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(
    @Body() dto: RegisterDto,
  ): Promise<{ accessToken: string; usuario: UsuarioResponseDto }> {
    return this.authService.register(dto);
  }

  /**
   * Autenticación de un usuario con credenciales (correo y contraseña).
   *
   * Rate Limit (SEC-02): máximo 5 intentos de login por minuto por IP, la mitad
   * del límite por defecto. Un humano que teclea mal su contraseña tres veces
   * no se ve afectado; un ataque de fuerza bruta se queda sin presupuesto al
   * quinto intento, antes de poder probar siquiera las 10 000 contraseñas más
   * comunes de un diccionario.
   */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
  ): Promise<{ accessToken: string; usuario: UsuarioResponseDto }> {
    return this.authService.login(dto);
  }

  /**
   * Consulta del perfil del usuario actualmente autenticado.
   * Endpoint protegido: extrae el usuario a partir del JWT verificado.
   *
   * E1-05: `@Autenticado` es aquí la política definitiva. La ruta devuelve los
   * datos del propio solicitante, así que no hay rol que exigir: los cuatro
   * roles la necesitan para arrancar sesión en el frontend.
   */
  @Autenticado()
  @Get('me')
  @HttpCode(HttpStatus.OK)
  async getProfile(
    @CurrentUser() user: UsuarioAutenticado,
  ): Promise<UsuarioResponseDto> {
    return this.authService.getProfile(user.id);
  }

  /**
   * Solicita el restablecimiento de contraseña para un correo dado.
   * Rate Limit (SEC-02): Máximo 5 solicitudes por minuto por IP para prevenir abuso y enumeración.
   */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  async forgotPassword(
    @Body() dto: ForgotPasswordDto,
  ): Promise<{ message: string; debugToken?: string }> {
    return this.authService.forgotPassword(dto);
  }

  /**
   * Restablece la contraseña utilizando un token válido.
   * Rate Limit (SEC-02): Máximo 5 intentos por minuto por IP para mitigar fuerza bruta de tokens.
   */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(
    @Body() dto: ResetPasswordDto,
  ): Promise<{ message: string }> {
    return this.authService.resetPassword(dto);
  }
}

