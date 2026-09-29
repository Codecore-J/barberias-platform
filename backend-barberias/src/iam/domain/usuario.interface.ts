export interface IUsuario {
  id: string;
  nombreCompleto: string;
  correo: string;
  telefono: string;
  cedula?: string | null;
  estadoCuenta: 'ACTIVO' | 'SUSPENDIDO' | 'ELIMINADO';
  creadoAt: Date | null;
}

export interface IUsuarioConHash extends IUsuario {
  passwordHash: string;
}
