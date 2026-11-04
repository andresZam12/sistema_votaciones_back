import { describe, it, expect, vi } from 'vitest';
import { TopicManager, SSEClient } from '../src/fanout/topics.js';
import { FanoutBatcher } from '../src/fanout/batcher.js';

describe('Público SSE - TopicManager y Batcher', () => {
  it('RF-5: Alta y baja O(1) de suscripciones por tópico', () => {
    const tm = new TopicManager();
    const mockRes1 = { write: vi.fn(), writableEnded: false, writableLength: 0 } as any;
    const mockRes2 = { write: vi.fn(), writableEnded: false, writableLength: 0 } as any;

    const c1: SSEClient = { id: 'c1', topic: 'dep', res: mockRes1, lagged: false };
    const c2: SSEClient = { id: 'c2', topic: 'mun:11', res: mockRes2, lagged: false };

    tm.subscribe('dep', c1);
    tm.subscribe('mun:11', c2);

    expect(tm.getTotalConnections()).toBe(2);
    expect(tm.getSubscribers('dep')?.size).toBe(1);
    expect(tm.getSubscribers('mun:11')?.size).toBe(1);

    // Baja O(1)
    tm.unsubscribe('dep', c1);
    expect(tm.getTotalConnections()).toBe(1);
    expect(tm.getSubscribers('dep')).toBeUndefined();
  });

  it('RF-4: Agregación en ventana y emisión de un único mensaje serializado por tópico', async () => {
    const tm = new TopicManager();
    const batcher = new FanoutBatcher();

    const writesC1: string[] = [];
    const writesC2: string[] = [];

    const mockRes1 = {
      write: vi.fn((msg) => writesC1.push(msg)),
      writableEnded: false,
      writableLength: 0
    } as any;
    const mockRes2 = {
      write: vi.fn((msg) => writesC2.push(msg)),
      writableEnded: false,
      writableLength: 0
    } as any;

    const c1: SSEClient = { id: 'c1', topic: 'dep', res: mockRes1, lagged: false };
    const c2: SSEClient = { id: 'c2', topic: 'dep', res: mockRes2, lagged: false };

    // Sustituimos topicManager por nuestro mock en batcher
    // Enviar dos eventos consecutivos en la misma ventana de tiempo
    batcher.accumulateEvent('100-1', 'dep', { C1: 10, C2: 5 }, 'nueva', Date.now());
    batcher.accumulateEvent('100-2', 'dep', { C1: 20, C2: -2 }, 'nueva', Date.now());

    // Suscribir a c1 y c2 a nivel global para probar flush
    import('../src/fanout/topics.js').then(async (mod) => {
      mod.topicManager.subscribe('dep', c1);
      mod.topicManager.subscribe('dep', c2);

      await batcher.flush();

      // C1 y C2 debieron recibir exactamente 1 mensaje con los deltas sumados (C1: 30, C2: 3)
      expect(writesC1.length).toBe(1);
      expect(writesC2.length).toBe(1);
      expect(writesC1[0]).toBe(writesC2[0]); // Mismo string serializado una sola vez

      expect(writesC1[0]).toContain('"C1":30');
      expect(writesC2[0]).toContain('"C2":3');
      expect(writesC1[0]).toContain('event: delta');

      mod.topicManager.unsubscribe('dep', c1);
      mod.topicManager.unsubscribe('dep', c2);
      batcher.stop();
    });
  });

  it('RF-9: Contrapresión - omite envío si res.writableLength supera el umbral de 256 KB', async () => {
    const batcher = new FanoutBatcher();
    const writes: string[] = [];

    const mockSlowRes = {
      write: vi.fn((msg) => writes.push(msg)),
      writableEnded: false,
      writableLength: 300000 // > 256 KB
    } as any;

    const slowClient: SSEClient = { id: 'slow1', topic: 'mun:99', res: mockSlowRes, lagged: false };

    const { topicManager: globalTm } = await import('../src/fanout/topics.js');
    globalTm.subscribe('mun:99', slowClient);

    batcher.accumulateEvent('100-3', 'mun:99', { C1: 15 }, 'nueva', Date.now());
    await batcher.flush();

    // No debe haber escrito al cliente lento mientras esté saturado
    expect(writes.length).toBe(0);
    expect(slowClient.lagged).toBe(true);

    globalTm.unsubscribe('mun:99', slowClient);
    batcher.stop();
  });
});

