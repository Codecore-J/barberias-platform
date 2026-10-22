export interface UsuarioResponseDto {
  id: string;
  correo: string;
  nombreCompleto: string;
  telefono: string;
  cedula?: string | null;
  estadoCuenta: string;
  creadoAt?: string | Date | null;
  roles: string[];
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

