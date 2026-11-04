import { describe, it, expect, vi } from 'vitest';
import { buildApp } from '../src/server.js';
import { redis } from '../src/redis/client.js';

describe('Snapshot Atómico (RF-6)', () => {
  const app = buildApp();

  it('GET /stream envía evento snapshot con cursor del stream coherente', async () => {
    const mockSnapshot = JSON.stringify({
      topico: 'dep',
      streamId: '1793577600-0',
      mesasInformadas: 1500,
      totalMesas: 6400,
      porcentajeMesas: 23.43,
      totales: { C1: 15000, C2: 12000 },
      ranking: [
        { candidato: 'C1', votos: 15000 },
        { candidato: 'C2', votos: 12000 }
      ]
    });

    vi.spyOn(redis, 'getSnapshot').mockResolvedValue(mockSnapshot);

    const res = await app.inject({
      method: 'GET',
      url: '/stream?topic=dep'
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/event-stream');
    expect(res.payload).toContain('event: snapshot');
    expect(res.payload).toContain('id: 1793577600-0');
    expect(res.payload).toContain('"porcentajeMesas":23.43');
  });

  it('GET /stream valida que el tópico sea reconocido o rechaza con 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/stream?topic=invalido'
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.payload);
    expect(body.error).toBe('Topico invalido');
  });
});
