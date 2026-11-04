import { describe, it, expect, vi } from 'vitest';
import { buildApp } from '../src/server.js';
import { redis } from '../src/redis/client.js';

describe('Endpoint POST /actas', () => {
  const app = buildApp();

  it('401 si falta x-api-key o es inválida', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/actas',
      payload: { acta: 'E14-01' }
    });
    expect(res.statusCode).toBe(401);
  });

  it('422 si el payload no cumple el esquema Zod', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/actas',
      headers: {
        'x-api-key': 'jurado-key-demo'
      },
      payload: {
        acta: 'E14-01',
        votos: { C1: -1 } // inválido
      }
    });
    expect(res.statusCode).toBe(422);
    const body = JSON.parse(res.payload);
    expect(body).toHaveProperty('error', 'Validacion fallida');
  });

  it('201 al registrar un acta correctamente (simulado con mock de Redis)', async () => {
    // Espiar métodos de redis
    vi.spyOn(redis, 'rateLimit').mockResolvedValue([1, 1]);
    vi.spyOn(redis, 'set').mockResolvedValue('OK');
    vi.spyOn(redis, 'applyActa').mockResolvedValue(['OK', '1700000000-0', '1', 'nueva', '{}']);

    const payload = {
      acta: 'E14-176-0042-03',
      mesa: 4201,
      puesto: 176,
      municipio: 11,
      version: 1,
      jurado: 'JUR-88134',
      ts_cierre: 1793577600,
      votos: { C1: 184, C2: 97, C3: 311, BLANCO: 22, NULO: 9, NO_MARCADO: 4 },
      sufragantes: 627,
      hash_foto: '9f2cabc123',
      idem: '8f14e45fceea167a'
    };

    const res = await app.inject({
      method: 'POST',
      url: '/actas',
      headers: {
        'x-api-key': 'jurado-key-demo'
      },
      payload
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.payload);
    expect(body.estado).toBe('registrada');
    expect(body.acta).toBe(payload.acta);
    expect(body.version).toBe(1);
    expect(body.dudosa).toBe(false);
  });

  it('200 si la clave de idempotencia ya existía (reintento del jurado)', async () => {
    vi.spyOn(redis, 'rateLimit').mockResolvedValue([1, 2]);
    vi.spyOn(redis, 'set').mockResolvedValue(null as any); // null significa NX no insertó porque ya existía
    vi.spyOn(redis, 'hget').mockResolvedValue('1');

    const payload = {
      acta: 'E14-176-0042-03',
      mesa: 4201,
      puesto: 176,
      municipio: 11,
      version: 1,
      jurado: 'JUR-88134',
      ts_cierre: 1793577600,
      votos: { C1: 184, C2: 97 },
      sufragantes: 281,
      hash_foto: '9f2cabc123',
      idem: '8f14e45fceea167a'
    };

    const res = await app.inject({
      method: 'POST',
      url: '/actas',
      headers: {
        'x-api-key': 'jurado-key-demo'
      },
      payload
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.estado).toBe('ya_registrada');
  });
});

