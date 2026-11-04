import { describe, it, expect, vi } from 'vitest';
import { buildApp } from '../src/server.js';
import { redis } from '../src/redis/client.js';

describe('Snapshot Atómico (RF-6)', () => {
  const app = buildApp();

  it('Serialización y estructura del Snapshot Atómico', async () => {
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

    const snapshotRaw = await redis.getSnapshot('dep', '');
    const parsed = JSON.parse(snapshotRaw);

    expect(parsed.topico).toBe('dep');
    expect(parsed.streamId).toBe('1793577600-0');
    expect(parsed.porcentajeMesas).toBeCloseTo(23.43);
    expect(parsed.totales.C1).toBe(15000);
    expect(parsed.ranking[0].candidato).toBe('C1');
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
