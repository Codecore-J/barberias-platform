import { HttpWhatsAppProvider, TIMEOUT_WHATSAPP_MS } from './http-whatsapp.provider.js';

describe('HttpWhatsAppProvider (Fase 7)', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const CONFIG = {
    apiUrl: 'https://graph.facebook.com/v20.0/1234567890/messages',
    token: 'EAAG-token-privado',
  };

  function respuesta(ok: boolean, status = 200, texto = '') {
    return { ok, status, text: vi.fn().mockResolvedValue(texto) };
  }

  it('hace el POST a la URL configurada con Bearer y timeout de 5 s', async () => {
    fetchMock.mockResolvedValue(respuesta(true));

    await new HttpWhatsAppProvider(CONFIG).enviar({
      telefono: '+18095550000',
      texto: 'Hola Ana, tu cita es en 2 horas.',
    });

    const [url, init] = fetchMock.mock.calls[0] as [
      string,
      {
        method: string;
        headers: Record<string, string>;
        body: string;
        signal: unknown;
      },
    ];

    expect(url).toBe(CONFIG.apiUrl);
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer EAAG-token-privado');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(TIMEOUT_WHATSAPP_MS).toBe(5000);

    const body = JSON.parse(init.body) as {
      messaging_product: string;
      to: string;
      type: string;
      text: { body: string; preview_url: boolean };
    };
    expect(body.messaging_product).toBe('whatsapp');
    expect(body.to).toBe('+18095550000');
    expect(body.type).toBe('text');
    expect(body.text.body).toBe('Hola Ana, tu cita es en 2 horas.');
    expect(body.text.preview_url).toBe(false);
  });

  it('convierte un rechazo del proveedor en un error con el estado', async () => {
    fetchMock.mockResolvedValue(respuesta(false, 403, 'token vencido'));

    await expect(
      new HttpWhatsAppProvider(CONFIG).enviar({ telefono: '+18095550000', texto: 'x' }),
    ).rejects.toThrow(/\(403\).*token vencido/);
  });

  it('propaga el fallo de red o el timeout', async () => {
    fetchMock.mockRejectedValue(new Error('El tiempo de espera ha expirado'));

    await expect(
      new HttpWhatsAppProvider(CONFIG).enviar({ telefono: '+18095550000', texto: 'x' }),
    ).rejects.toThrow(/espera/);
  });

  it('sin URL o sin token NO hace la llamada', async () => {
    await expect(
      new HttpWhatsAppProvider({ apiUrl: '', token: 't' }).enviar({
        telefono: '+18095550000',
        texto: 'x',
      }),
    ).rejects.toThrow(/WHATSAPP_API_URL/);

    await expect(
      new HttpWhatsAppProvider({ apiUrl: 'https://api.test', token: '' }).enviar({
        telefono: '+18095550000',
        texto: 'x',
      }),
    ).rejects.toThrow(/WHATSAPP_API_TOKEN/);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});