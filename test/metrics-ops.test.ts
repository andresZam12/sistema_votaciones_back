import { describe, it, expect, vi } from 'vitest';
import { eventLoopMonitor } from '../src/metrics/eventLoop.js';
import { buildApp } from '../src/server.js';
import { metricsPublisher } from '../src/metrics/publisher.js';

describe('Métricas y Tablero /ops', () => {
  const app = buildApp();

  it('RT-4: eventLoopMonitor mide p50, p99 y max en milisegundos', () => {
    const metrics = eventLoopMonitor.getMetrics();
    expect(metrics).toHaveProperty('p50');
    expect(metrics).toHaveProperty('p99');
    expect(metrics).toHaveProperty('max');
    expect(typeof metrics.p50).toBe('number');
    expect(typeof metrics.p99).toBe('number');
  });

  it('RT-7: GET /ops retorna la consola HTML de monitoreo con status 200', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/ops'
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.payload).toContain('Tablero de Operaciones');
    expect(res.payload).toContain('Instancias Vivas');
  });

  it('RT-7: GET /ops/data agrega las métricas de las réplicas en formato JSON', async () => {
    vi.spyOn(metricsPublisher, 'aggregateOpsData').mockResolvedValue({
      global: {
        totalInstancias: 8,
        conexionesTotales: 40000,
        conexionesSse: 39880,
        conexionesWs: 120,
        mensajesPorSegundoTotal: 3200,
        eventLoopP99Promedio: 1.25,
        rssTotalMb: 512.4,
        retrasoMaximoMs: 14
      },
      instancias: [
        {
          instancia: 'instancia-1',
          ts: Date.now(),
          conexionesSse: 5000,
          conexionesWs: 15,
          conexionesTotales: 5015,
          mensajesPorSegundo: 400,
          eventLoopP50Ms: 0.2,
          eventLoopP99Ms: 1.1,
          eventLoopMaxMs: 2.5,
          rssMb: 64.2,
          heapUsedMb: 32.1,
          memoriaPorConexionKb: 12.8,
          retrasoRecepcionPublicacionMs: 12
        }
      ]
    });

    const res = await app.inject({
      method: 'GET',
      url: '/ops/data'
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.global.totalInstancias).toBe(8);
    expect(body.global.conexionesTotales).toBe(40000);
    expect(body.instancias.length).toBe(1);
    expect(body.instancias[0].instancia).toBe('instancia-1');
  });
});
