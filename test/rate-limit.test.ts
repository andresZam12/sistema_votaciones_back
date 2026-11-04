import { describe, it, expect, vi } from 'vitest';
import { buildApp } from '../src/server.js';
import { redis } from '../src/redis/client.js';

describe('Rate Limiting (Protección contra saturación)', () => {
  const app = buildApp();

  it('Retorna 429 Too Many Requests con Retry-After: 60 cuando se supera el límite de tasa', async () => {
    // Simular que el script rateLimit retorna allowed = 0 (límite superado)
    vi.spyOn(redis, 'rateLimit').mockResolvedValue([0, 301]);

    const res = await app.inject({
      method: 'POST',
      url: '/actas',
      headers: {
        'x-api-key': 'jurado-key-demo'
      },
      payload: {
        acta: 'E14-RL-TEST',
        mesa: 1,
        puesto: 1,
        municipio: 1,
        version: 1,
        jurado: 'JUR-1',
        ts_cierre: 1000,
        votos: { C1: 10 },
        sufragantes: 10,
        hash_foto: 'hash1',
        idem: 'idem-rl'
      }
    });

    expect(res.statusCode).toBe(429);
    expect(res.headers['retry-after']).toBe('60');
    const body = JSON.parse(res.payload);
    expect(body).toHaveProperty('error', 'Limite de tasa excedido');
    expect(body.retryAfter).toBe(60);
  });
});
