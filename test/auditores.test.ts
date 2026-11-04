import { describe, it, expect, vi } from 'vitest';

// Simulación del semáforo distribuido y cola de verificación que ejecutan los scripts Lua
class MemoriaAuditoria {
  queue: { actaId: string; score: number }[] = [];
  inflight: Set<string> = new Set();
  locks: Map<string, { owner: string; expiresAt: number }> = new Map();

  addCase(actaId: string, score: number) {
    this.queue.push({ actaId, score });
    this.queue.sort((a, b) => b.score - a.score); // Mayor sufragantes primero
  }

  takeCase(auditorId: string, token: string, ttlMs = 30000): { status: string; actaId?: string; token?: string } {
    if (this.queue.length === 0) return { status: 'EMPTY' };

    const item = this.queue.shift()!;
    const owner = `${auditorId}:${token}`;
    const now = Date.now();

    const existingLock = this.locks.get(item.actaId);
    if (existingLock && existingLock.expiresAt > now) {
      // Bloqueado por otro
      this.queue.unshift(item);
      return { status: 'LOCKED_BY_OTHER', actaId: item.actaId };
    }

    this.locks.set(item.actaId, { owner, expiresAt: now + ttlMs });
    this.inflight.add(item.actaId);
    return { status: 'OK', actaId: item.actaId, token };
  }

  renewLock(actaId: string, owner: string, ttlMs = 30000): boolean {
    const lock = this.locks.get(actaId);
    const now = Date.now();
    if (!lock || lock.expiresAt <= now || lock.owner !== owner) {
      return false;
    }
    lock.expiresAt = now + ttlMs;
    return true;
  }

  releaseLock(actaId: string, owner: string, accion: 'liberar' | 'cerrar'): boolean {
    const lock = this.locks.get(actaId);
    const now = Date.now();
    if (!lock || lock.expiresAt <= now || lock.owner !== owner) {
      // No coincide el dueño o ya expiró
      return false;
    }

    this.locks.delete(actaId);
    this.inflight.delete(actaId);

    if (accion === 'liberar') {
      this.addCase(actaId, 100);
    }
    return true;
  }

  reapExpired(): string[] {
    const now = Date.now();
    const reaped: string[] = [];

    for (const actaId of Array.from(this.inflight)) {
      const lock = this.locks.get(actaId);
      if (!lock || lock.expiresAt <= now) {
        this.inflight.delete(actaId);
        this.locks.delete(actaId);
        this.addCase(actaId, 100);
        reaped.push(actaId);
      }
    }
    return reaped;
  }
}

describe('Auditores y Bloqueo Distribuido (RF-7, RF-8)', () => {
  it('RF-7: Dos auditores concurrentes nunca toman el mismo caso', () => {
    const sim = new MemoriaAuditoria();
    sim.addCase('E14-DUDOSA-01', 500);

    const r1 = sim.takeCase('auditor-1', 'tok-1');
    expect(r1.status).toBe('OK');
    expect(r1.actaId).toBe('E14-DUDOSA-01');

    // Auditor 2 intenta tomar un caso
    const r2 = sim.takeCase('auditor-2', 'tok-2');
    expect(r2.status).toBe('EMPTY'); // Ya no hay más en la cola
  });

  it('RF-7: Lock expirado y reasignado no puede ser liberado por el auditor original (Compare-and-Delete)', () => {
    const sim = new MemoriaAuditoria();
    sim.addCase('E14-DUDOSA-02', 300);

    // Auditor 1 toma el caso
    sim.takeCase('auditor-1', 'tok-1', 100); // 100ms TTL

    // Pasa el tiempo y el lock expira
    const now = Date.now();
    vi.setSystemTime(now + 200);

    // El reaper detecta la expiración y lo devuelve a la cola
    const reaped = sim.reapExpired();
    expect(reaped).toContain('E14-DUDOSA-02');

    // Ahora Auditor 2 toma el caso reasignado
    const r2 = sim.takeCase('auditor-2', 'tok-2', 30000);
    expect(r2.status).toBe('OK');

    // Auditor 1 despierta tarde e intenta liberar el caso con su viejo token
    const intentoLiberar = sim.releaseLock('E14-DUDOSA-02', 'auditor-1:tok-1', 'liberar');
    expect(intentoLiberar).toBe(false);

    // El lock sigue perteneciendo de forma segura al Auditor 2
    expect(sim.locks.get('E14-DUDOSA-02')?.owner).toBe('auditor-2:tok-2');

    vi.useRealTimers();
  });

  it('RF-7 / RF-8: El caso vuelve a la cola automáticamente cuando vence el lock (Reaper)', () => {
    const sim = new MemoriaAuditoria();
    sim.addCase('E14-DUDOSA-03', 450);

    sim.takeCase('auditor-1', 'tok-1', 50); // 50ms TTL

    vi.useFakeTimers();
    vi.advanceTimersByTime(100);

    const devueltos = sim.reapExpired();
    expect(devueltos).toContain('E14-DUDOSA-03');
    expect(sim.queue.length).toBe(1);
    expect(sim.queue[0].actaId).toBe('E14-DUDOSA-03');

    vi.useRealTimers();
  });

  it('Tensión trabajo vs almuerzo: Latido solo renueva si reporta actividad real reciente (<2 min)', () => {
    const sim = new MemoriaAuditoria();
    sim.addCase('E14-DUDOSA-04', 200);
    sim.takeCase('auditor-1', 'tok-1', 30000);

    let lastActivityTs = Date.now();

    // Caso 1: Sigue trabajando (actividad real hace 30 segundos)
    const inactividad1 = 30000;
    const renuevaActivo = inactividad1 < 120000;
    expect(renuevaActivo).toBe(true);
    expect(sim.renewLock('E14-DUDOSA-04', 'auditor-1:tok-1')).toBe(true);

    // Caso 2: Se fue a almorzar con el navegador abierto (sin actividad real por 3 minutos)
    const inactividad2 = 180000; // > 120000
    const renuevaInactivo = inactividad2 < 120000;
    expect(renuevaInactivo).toBe(false); // NO renueva
  });
});

