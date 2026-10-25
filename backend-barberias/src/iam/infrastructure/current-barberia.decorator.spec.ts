import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Controller, Get, INestApplication, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import {
  resolverBarberiaId,
  CurrentBarberiaId,
  CurrentBarberiaIdOpcional,
} from './current-barberia.decorator.js';

/** UUID v4 valido, para el caso en el que la sede SI es legitima. */
const SEDE_UUID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const RECURSO_UUID = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

/**
 * Fase 5 (Punto 5.3): la sede viaja en la RUTA (`/shops/:shopId/...`). Dos
 * sondas: una anidada bajo `:shopId` (el contrato normal) y otra plana, que es
 * como se prueban las rutas globales que acotan por query (`?shopId=`).
 */
@Controller('prueba-sede/:shopId')
class SondaRutaController {
  @Get('obligatoria')
  obligatoria(@CurrentBarberiaId() barberiaId: string) {
    return { barberiaId };
  }

  @Get('opcional')
  opcional(@CurrentBarberiaIdOpcional() barberiaId: string | null) {
    return { barberiaId };
  }
}

@Controller('prueba-sede-query')
class SondaQueryController {
  @Get('obligatoria')
  obligatoria(@CurrentBarberiaId() barberiaId: string) {
    return { barberiaId };
  }

  @Get('opcional')
  opcional(@CurrentBarberiaIdOpcional() barberiaId: string | null) {
    return { barberiaId };
  }
}

@Module({ controllers: [SondaRutaController, SondaQueryController] })
class SondaModule {}

/**
 * E1-06 · el `barberiaId` tiene que ser un UUID ANTES de llegar a Prisma.
 *
 * El decorador se prueba sobre una app Nest de verdad (supertest) y no llamando
 * al ParameterDecorator a mano: `createParamDecorator` devuelve la funcion que
 * Nest aplica en la declaracion del metodo, no la fabrica, asi que invocarla
 * directamente no ejecuta nada y el test pasaria sin comprobar nada.
 *
 * Fase 5: la cabecera `x-barberia-id` ya NO es fuente de tenant. Estas pruebas
 * fijan las dos vias que quedan —parámetro de ruta y query— y que la cabecera
 * se ignora por completo.
 */
describe('CurrentBarberiaId sobre HTTP · validacion UUID (E1-06)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [SondaModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it.each([
    ['una palabra', 'sede-que-no-existe'],
    ['un numero', '12345'],
    ['un id de recurso con guiones', 'servicio-uuid-1'],
    ['un UUID con un caracter cambiado', '3f2504e0-4f89-41d3-9a0c-0305e82c330z'],
    ['un UUID truncado', '3f2504e0-4f89-41d3-9a0c'],
    ['puntos en vez de guiones', '3f2504e0.4f89.41d3.9a0c.0305e82c3301'],
    ['basura larga', 'x'.repeat(200)],
  ])('responde 400 si el shopId de la ruta es %s', async (_caso, valor) => {
    const res = await request(app.getHttpServer()).get(
      `/prueba-sede/${encodeURIComponent(valor)}/obligatoria`,
    );

    expect(res.status).toBe(400);
  });

  it('responde 400 si el shopId de la query no es UUID', async () => {
    const res = await request(app.getHttpServer()).get('/prueba-sede-query/obligatoria?shopId=barberia-abc');
    expect(res.status).toBe(400);
  });

  it('responde 400 si la sede no viene de ninguna fuente', async () => {
    const res = await request(app.getHttpServer()).get('/prueba-sede-query/obligatoria');
    expect(res.status).toBe(400);
  });

  it('el id del recurso NUNCA rescata una sede ausente', async () => {
    // Reproduce GET /shops/:shopId/services/:id, donde `params.id` es el id del
    // recurso. Debe ser 400, nunca un 200 con ese id usado como sede.
    const res = await request(app.getHttpServer()).get(`/prueba-sede-query/obligatoria?id=${RECURSO_UUID}`);
    expect(res.status).toBe(400);
  });

  it('deja pasar un UUID legitimo desde la ruta', async () => {
    const res = await request(app.getHttpServer()).get(`/prueba-sede/${SEDE_UUID}/obligatoria`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ barberiaId: SEDE_UUID });
  });

  it('deja pasar un UUID legitimo desde la query de una ruta global', async () => {
    const res = await request(app.getHttpServer()).get(`/prueba-sede-query/obligatoria?shopId=${SEDE_UUID}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ barberiaId: SEDE_UUID });
  });

  it('IGNORA la cabecera x-barberia-id: ya no es fuente de tenant (Punto 5.3)', async () => {
    const res = await request(app.getHttpServer())
      .get('/prueba-sede-query/obligatoria')
      .set('x-barberia-id', SEDE_UUID);

    expect(res.status).toBe(400);
  });

  it('la variante opcional responde 200 con null en vez de propagar basura', async () => {
    const sinNada = await request(app.getHttpServer()).get('/prueba-sede-query/opcional');
    expect(sinNada.status).toBe(200);
    expect(sinNada.body).toEqual({ barberiaId: null });

    const conBasura = await request(app.getHttpServer()).get('/prueba-sede-query/opcional?shopId=no-es-uuid');
    expect(conBasura.status).toBe(200);
    expect(conBasura.body).toEqual({ barberiaId: null });

    const conUuid = await request(app.getHttpServer()).get(`/prueba-sede/${SEDE_UUID}/opcional`);
    expect(conUuid.status).toBe(200);
    expect(conUuid.body).toEqual({ barberiaId: SEDE_UUID });
  });
});

describe('resolverBarberiaId (E1-06)', () => {
  /** UUID distintos por fuente, para que la precedencia sea observable. */
  const SEDE_RUTA = '11111111-1111-4111-8111-111111111111';
  const SEDE_HEADER = '22222222-2222-4222-8222-222222222222';
  const SEDE_QUERY = '33333333-3333-4333-8333-333333333333';

  it('NUNCA toma el id de la ruta con :id como si fuera la sede', () => {
    expect(resolverBarberiaId({ params: { id: RECURSO_UUID }, query: {} })).toBeNull();
  });

  it('prioriza params.shopId sobre la query', () => {
    expect(
      resolverBarberiaId({
        params: { shopId: SEDE_RUTA },
        query: { shopId: SEDE_QUERY },
      }),
    ).toBe(SEDE_RUTA);
  });

  it('usa la query cuando la ruta no lleva sede', () => {
    expect(resolverBarberiaId({ params: {}, query: { shopId: SEDE_QUERY } })).toBe(SEDE_QUERY);
  });

  it('acepta también el nombre historico de la query (?barberiaId=)', () => {
    expect(resolverBarberiaId({ params: {}, query: { barberiaId: SEDE_QUERY } })).toBe(SEDE_QUERY);
  });

  it('IGNORA la cabecera x-barberia-id por completo (Punto 5.3)', () => {
    expect(
      resolverBarberiaId({
        params: {},
        headers: { 'x-barberia-id': SEDE_HEADER },
        query: {},
      }),
    ).toBeNull();

    expect(
      resolverBarberiaId({
        params: { shopId: SEDE_RUTA },
        headers: { 'x-barberia-id': SEDE_HEADER },
        query: { shopId: SEDE_QUERY },
      }),
    ).toBe(SEDE_RUTA);
  });

  it('trata una sede vacia como sede no indicada', () => {
    expect(resolverBarberiaId({ params: { shopId: '   ' }, query: {} })).toBeNull();
    expect(resolverBarberiaId({ params: {}, query: {} })).toBeNull();
    expect(resolverBarberiaId({ params: { shopId: `  ${SEDE_UUID}  ` }, query: {} })).toBe(SEDE_UUID);
  });

  it('descarta un valor que no es UUID en vez de devolverlo tal cual', () => {
    expect(resolverBarberiaId({ params: { shopId: 'barberia-abc' }, query: {} })).toBeNull();
    expect(resolverBarberiaId({ params: { shopId: SEDE_UUID }, query: {} })).toBe(SEDE_UUID);
  });
});