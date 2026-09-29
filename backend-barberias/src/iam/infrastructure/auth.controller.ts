import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { AuthService } from '../application/auth.service.js';
import { RegisterDto } from '../application/dto/register.dto.js';
import { LoginDto } from '../application/dto/login.dto.js';
import { UsuarioResponseDto } from '../application/dto/usuario-response.dto.js';
import { Public } from './public.decorator.js';
import { CurrentUser } from './current-user.decorator.js';
import type { UsuarioAutenticado } from '../domain/jwt.interface.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * Registro de un nuevo usuario en la plataforma.
   * Endpoint público: asigna rol CLIENTE por defecto y retorna el usuario creado
   * (con passwordHash excluido automáticamente).
   */
  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() dto: RegisterDto): Promise<UsuarioResponseDto> {
    return this.authService.register(dto);
  }

  /**
   * Autenticación de un usuario con credenciales (correo y contraseña).
   * Endpoint público: retorna el JWT de acceso y los datos de perfil del usuario.
   */
  @Public()
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
   */
  @Get('me')
  @HttpCode(HttpStatus.OK)
  async getProfile(
    @CurrentUser() user: UsuarioAutenticado,
  ): Promise<UsuarioResponseDto> {
    return this.authService.getProfile(user.id);
  }
}
