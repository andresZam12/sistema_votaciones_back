import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/server.js';
import { config } from '../src/config.js';

describe('Endpoints base', () => {
  const app = buildApp();

  it('GET /whoami debe retornar el identificador de la instancia', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/whoami'
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body).toHaveProperty('instancia', config.instanceId);
  });

  it('GET /health debe responder 200 o 503 dependiendo de Redis', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health'
    });

    // Sin Redis local corriendo puede dar 503 con Retry-After: 5 (comportamiento degradado esperado)
    expect([200, 503]).toContain(res.statusCode);
    if (res.statusCode === 503) {
      expect(res.headers['retry-after']).toBe('5');
    }
  });
});

