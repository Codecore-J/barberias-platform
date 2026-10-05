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

@Controller('prueba-sede')
class SondaController {
  @Get('obligatoria')
  obligatoria(@CurrentBarberiaId() barberiaId: string) {
    return { barberiaId };
  }

  @Get('opcional')
  opcional(@CurrentBarberiaIdOpcional() barberiaId: string | null) {
    return { barberiaId };
  }
}

@Module({ controllers: [SondaController] })
class SondaModule {}

/**
 * E1-06 · el `barberiaId` tiene que ser un UUID ANTES de llegar a Prisma.
 *
 * El decorador se prueba sobre una app Nest de verdad (supertest) y no llamando
 * al ParameterDecorator a mano: `createParamDecorator` devuelve la funcion que
 * Nest aplica en la declaracion del metodo, no la fabrica, asi que invocarla
 * directamente no ejecuta nada y el test pasaria sin comprobar nada.
 *
 * Sin validacion, `x-barberia-id: no-es-uuid` viaja entero al `where` de una
 * columna uuid: Prisma lanza y el filtro global responde 400 DESPUES de haber
 * tocado la conexion. El requisito del backlog es 400 antes de Prisma.
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
  ])('responde 400 si la cabecera es %s', async (_caso, valor) => {
    const res = await request(app.getHttpServer())
      .get('/prueba-sede/obligatoria')
      .set('x-barberia-id', valor);

    expect(res.status).toBe(400);
  });

  it('responde 400 si el barberiaId de la query no es UUID', async () => {
    const res = await request(app.getHttpServer()).get('/prueba-sede/obligatoria?barberiaId=barberia-abc');
    expect(res.status).toBe(400);
  });

  it('responde 400 si la sede no viene de ninguna fuente', async () => {
    const res = await request(app.getHttpServer()).get('/prueba-sede/obligatoria');
    expect(res.status).toBe(400);
  });

  it('el id del recurso NUNCA rescata una sede ausente', async () => {
    // Reproduce GET /catalogo/servicios/:id sin cabecera, donde `params.id` es el
    // id del recurso. Debe ser 400, nunca un 200 con ese id usado como sede.
    const res = await request(app.getHttpServer()).get(`/prueba-sede/obligatoria?id=${RECURSO_UUID}`);
    expect(res.status).toBe(400);
  });

  it('deja pasar un UUID legitimo desde la cabecera', async () => {
    const res = await request(app.getHttpServer())
      .get('/prueba-sede/obligatoria')
      .set('x-barberia-id', SEDE_UUID);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ barberiaId: SEDE_UUID });
  });

  it('la variante opcional responde 200 con null en vez de propagar basura', async () => {
    const sinNada = await request(app.getHttpServer()).get('/prueba-sede/opcional');
    expect(sinNada.status).toBe(200);
    expect(sinNada.body).toEqual({ barberiaId: null });

    const conBasura = await request(app.getHttpServer())
      .get('/prueba-sede/opcional')
      .set('x-barberia-id', 'no-es-uuid');
    expect(conBasura.status).toBe(200);
    expect(conBasura.body).toEqual({ barberiaId: null });

    const conUuid = await request(app.getHttpServer())
      .get('/prueba-sede/opcional')
      .set('x-barberia-id', SEDE_UUID);
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
    expect(
      resolverBarberiaId({
        params: { id: RECURSO_UUID },
        headers: { 'x-barberia-id': SEDE_HEADER },
        query: {},
      }),
    ).toBe(SEDE_HEADER);

    // Sin cabecera, `params.id` no suple a la sede: null, y el decorador
    // responde 400. Antes devolvia el id del recurso y la consulta buscaba un
    // servicio cuyo id fuera su propia barberia.
    expect(resolverBarberiaId({ params: { id: RECURSO_UUID }, headers: {}, query: {} })).toBeNull();
  });

  it('prioriza params.barberiaId sobre la cabecera y la query', () => {
    expect(
      resolverBarberiaId({
        params: { barberiaId: SEDE_RUTA },
        headers: { 'x-barberia-id': SEDE_HEADER },
        query: { barberiaId: SEDE_QUERY },
      }),
    ).toBe(SEDE_RUTA);
  });

  it('usa la cabecera antes que la query', () => {
    expect(
      resolverBarberiaId({
        params: {},
        headers: { 'x-barberia-id': SEDE_HEADER },
        query: { barberiaId: SEDE_QUERY },
      }),
    ).toBe(SEDE_HEADER);
  });

  it('usa la query cuando no hay ruta ni cabecera', () => {
    expect(resolverBarberiaId({ params: {}, headers: {}, query: { barberiaId: SEDE_QUERY } })).toBe(SEDE_QUERY);
  });

  it('toma la primera cabecera si llega repetida', () => {
    expect(
      resolverBarberiaId({
        params: {},
        headers: { 'x-barberia-id': [SEDE_HEADER, SEDE_QUERY] },
        query: {},
      }),
    ).toBe(SEDE_HEADER);
  });

  it('trata una cabecera vacia como sede no indicada', () => {
    expect(resolverBarberiaId({ params: {}, headers: { 'x-barberia-id': '   ' }, query: {} })).toBeNull();
    expect(resolverBarberiaId({ params: {}, headers: {}, query: {} })).toBeNull();
    expect(resolverBarberiaId({ params: {}, headers: { 'x-barberia-id': `  ${SEDE_UUID}  ` }, query: {} })).toBe(
      SEDE_UUID,
    );
  });

  it('descarta un valor que no es UUID en vez de devolverlo tal cual', () => {
    expect(resolverBarberiaId({ params: {}, headers: { 'x-barberia-id': 'barberia-abc' }, query: {} })).toBeNull();
    expect(
      resolverBarberiaId({ params: { barberiaId: SEDE_UUID }, headers: {}, query: {} }),
    ).toBe(SEDE_UUID);
  });
});
