import {
  RESEND_API_URL,
  ResendEmailProvider,
} from './resend-email.provider.js';
import { type MensajeEmail } from '../domain/port/email.provider.js';

/** El símbolo `&` por código, para no depender de literales de entidad. */
const AMP = String.fromCharCode(38);

const MENSAJE: MensajeEmail = {
  destinatario: 'ana@test.com',
  asunto: 'Recordatorio de tu cita · Sede Centro',
  cuerpo: 'Hola Ana, tu cita en Sede Centro es en 2 horas (26/10/2026 a las 12:30).',
  tipo: 'reserva.recordatorio',
  cita: { sede: 'Sede Centro', fecha: '26/10/2026', hora: '12:30' },
};

function respuesta(ok: boolean, status = 200, texto = '') {
  return { ok, status, text: vi.fn().mockResolvedValue(texto) };
}

describe('ResendEmailProvider (Fase 7)', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  interface CuerpoResend {
    from?: string;
    to?: string[];
    subject?: string;
    html?: string;
  }

  function cuerpoEnviado(): CuerpoResend {
    const [, init] = fetchMock.mock.calls[0] as [
      string,
      { body: string },
    ];
    return JSON.parse(init.body) as CuerpoResend;
  }

  it('hace el POST a Resend con la clave, el remitente y timeout de 5 s', async () => {
    fetchMock.mockResolvedValue(respuesta(true));

    await new ResendEmailProvider({
      apiKey: 're_abc123',
      from: 'Barberias <no-reply@barberias.com>',
    }).enviar(MENSAJE);

    const [url, init] = fetchMock.mock.calls[0] as [
      string,
      { method: string; headers: Record<string, string>; body: string; signal: unknown },
    ];
    expect(url).toBe(RESEND_API_URL);
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer re_abc123');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.signal).toBeInstanceOf(AbortSignal);

    const body = cuerpoEnviado();
    expect(body.from).toBe('Barberias <no-reply@barberias.com>');
    expect(body.to).toEqual(['ana@test.com']);
    expect(body.subject).toBe(MENSAJE.asunto);
  });

  it('cambia la cabecera de la plantilla según el evento y adjunta la cita', async () => {
    fetchMock.mockResolvedValue(respuesta(true));

    await new ResendEmailProvider({ apiKey: 're_abc', from: 'x@y.com' }).enviar(
      MENSAJE,
    );

    const html = cuerpoEnviado().html ?? '';
    expect(html).toContain('Recordatorio de cita');
    expect(html).toContain('Sede Centro');
    expect(html).toContain('26/10/2026');
    expect(html).toContain('12:30');
    expect(html).toContain('Hola Ana');

    // El color de la cabecera es el del evento de recordatorio.
    expect(html).toContain('#b45309');
  });

  it('usa el remitente por defecto de Resend cuando falta EMAIL_FROM', async () => {
    fetchMock.mockResolvedValue(respuesta(true));

    await new ResendEmailProvider({ apiKey: 're_abc' }).enviar(MENSAJE);

    expect(cuerpoEnviado().from).toBe('onboarding@resend.com');
  });

  it('escapa el HTML del contenido: un cuerpo malicioso no se convierte en etiqueta', async () => {
    fetchMock.mockResolvedValue(respuesta(true));

    await new ResendEmailProvider({ apiKey: 're_abc', from: 'x@y.com' }).enviar({
      ...MENSAJE,
      cuerpo: 'Hola <script>alert(1)</script>',
    });

    const html = cuerpoEnviado().html ?? '';
    expect(html).not.toContain('<script>');
    expect(html).toContain(`${AMP}lt;script${AMP}gt;`);
  });

  it('sin remitente configurado igual envía (por defecto), sin API key NO', async () => {
    fetchMock.mockResolvedValue(respuesta(true));

    await expect(
      new ResendEmailProvider({ apiKey: 're_abc' }).enviar(MENSAJE),
    ).resolves.toBeUndefined();

    await expect(
      new ResendEmailProvider({ apiKey: '' }).enviar(MENSAJE),
    ).rejects.toThrow(/RESEND_API_KEY/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('convierte un rechazo de Resend en un error con el estado y el detalle', async () => {
    fetchMock.mockResolvedValue(respuesta(false, 401, 'API key inválida'));

    await expect(
      new ResendEmailProvider({ apiKey: 'mala', from: 'x@y.com' }).enviar(MENSAJE),
    ).rejects.toThrow(/\(401\).*API key inválida/);
  });

  it('propaga el fallo de red o el timeout del fetch', async () => {
    fetchMock.mockRejectedValue(new Error('El tiempo de espera ha expirado'));

    await expect(
      new ResendEmailProvider({ apiKey: 're_abc', from: 'x@y.com' }).enviar(MENSAJE),
    ).rejects.toThrow(/espera/);
  });

  it('formatea el correo de cupo liberado con cabecera azul', async () => {
    fetchMock.mockResolvedValue(respuesta(true));

    await new ResendEmailProvider({ apiKey: 're_abc', from: 'x@y.com' }).enviar({
      destinatario: 'ana@test.com',
      asunto: '¡Se liberó un turno en Sede Centro!',
      cuerpo: '¡Hay un hueco disponible para ti en Sede Centro el 26/10/2026 de 12:00 a 13:00!',
      tipo: 'lista_espera.cupo_disponible',
    });

    const html = cuerpoEnviado().html ?? '';
    expect(html).toContain('¡Se liberó un turno en Sede Centro!');
    expect(html).toContain('#4f46e5');
    expect(html).toContain('26/10/2026');
  });
});