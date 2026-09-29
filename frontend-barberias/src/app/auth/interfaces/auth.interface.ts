export interface UsuarioResponseDto {
  id: string;
  correo: string;
  nombreCompleto: string;
  telefono: string;
  cedula?: string;
  estadoCuenta: string;
  roles: string[];
}

export interface RegisterDto {
  correo: string;
  password?: string;
  nombreCompleto: string;
  telefono: string;
}

export interface LoginDto {
  correo: string;
  password?: string;
}

export interface AuthResponseDto {
  accessToken: string;
  usuario: UsuarioResponseDto;
}

