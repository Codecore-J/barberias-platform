export interface UsuarioResponseDto {
  id: string;
  correo: string;
  nombreCompleto: string;
  telefono: string;
  cedula?: string | null;
  estadoCuenta: string;
  creadoAt?: string | Date | null;
  roles: string[];
  // V2.1 · verificación OTP. `auth.guard` los usa para redirigir a
  // /auth/verify antes de dejar entrar en el panel.
  telefonoVerificado?: boolean;
  correoVerificado?: boolean;
}

/** V2.1 · canal de un código OTP: decide si sale por WhatsApp o por correo. */
export type TipoOtp = 'TELEFONO' | 'CORREO';

export interface SendOtpResponseDto {
  mensaje: string;
  expiraEn: string;
}

export interface VerifyOtpResponseDto {
  verificado: boolean;
  tipo: TipoOtp;
}

// E3-contrato: `password` es OBLIGATORIO, igual que en el backend
// (RegisterDto: @IsString @MinLength(8) @Matches letra+número;
// LoginDto: @IsNotEmpty). Marcarlo opcional daba una falsa seguridad de tipos.
export interface RegisterDto {
  correo: string;
  password: string;
  nombreCompleto: string;
  telefono: string;
  cedula?: string | null;
}

export interface LoginDto {
  correo: string;
  password: string;
}

export interface AuthResponseDto {
  accessToken: string;
  usuario: UsuarioResponseDto;
}

