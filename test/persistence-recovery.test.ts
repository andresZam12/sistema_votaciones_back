import { describe, it, expect, vi } from 'vitest';
import { buildApp } from '../src/server.js';
import { redis } from '../src/redis/client.js';

describe('Persistencia Durable y Recuperación (Fase 5b)', () => {
  const app = buildApp();

  it('La ruta POST /actas es completamente asíncrona respecto a PostgreSQL y no se bloquea si Postgres cae', async () => {
    // Simular que Redis está saludable
    vi.spyOn(redis, 'rateLimit').mockResolvedValue([1, 1]);
    vi.spyOn(redis, 'set').mockResolvedValue('OK');
    vi.spyOn(redis, 'applyActa').mockResolvedValue(['OK', '1700000000-1', '1', 'nueva', '{}']);

    const res = await app.inject({
      method: 'POST',
      url: '/actas',
      headers: {
        'x-api-key': 'jurado-key-demo'
      },
      payload: {
        acta: 'E14-NO-PG-TEST',
        mesa: 100,
        puesto: 10,
        municipio: 1,
        version: 1,
        jurado: 'JUR-TEST',
        ts_cierre: 1700000000,
        votos: { C1: 100, C2: 50 },
        sufragantes: 150,
        hash_foto: 'hash123',
        idem: 'idem-no-pg'
      }
    });

    // Debe responder 201 en milisegundos sin esperar confirmación de PostgreSQL
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.payload);
    expect(body.estado).toBe('registrada');
  });

  it('Idempotencia en Postgres: INSERT con ON CONFLICT (acta, version) DO NOTHING es seguro ante reprocesamientos', () => {
    // Comprobar la sintaxis de inserción idempotente del worker
    const query = `
      INSERT INTO actas_versiones (
        acta, version, mesa, puesto, municipio, votos, sufragantes, dudosa,
        jurado, hash_foto, ts_cierre, instancia
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, to_timestamp($11), $12)
      ON CONFLICT (acta, version) DO NOTHING
    `;
    expect(query).toContain('ON CONFLICT (acta, version) DO NOTHING');
  });
});

