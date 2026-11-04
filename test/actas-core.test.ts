import { describe, it, expect, beforeEach } from 'vitest';
import { ActaInputSchema, esActaDudosa, ActaInput } from '../src/types/acta.js';

// Simulador lógico del motor de deltas y convergencia que ejecuta applyActa.lua
class MemoriaPreconteo {
  actas: Map<string, { version: number; votos: Record<string, number>; sufragantes: number }> = new Map();
  totMesa: Map<number, Record<string, number>> = new Map();
  totPuesto: Map<number, Record<string, number>> = new Map();
  totMun: Map<number, Record<string, number>> = new Map();
  totDep: Record<string, number> = {};
  mesasInformadasDep = 0;
  colaVerificacion: { acta: string; sufragantes: number; version: number }[] = [];

  applyActa(acta: ActaInput): { status: 'OK' | 'STALE'; version: number; kind: 'nueva' | 'correccion' } {
    const prev = this.actas.get(acta.acta);
    if (prev && acta.version <= prev.version) {
      return { status: 'STALE', version: prev.version, kind: 'nueva' };
    }

    const votosAnt = prev ? prev.votos : {};
    const deltas: Record<string, number> = {};
    const todosCandidatos = new Set([...Object.keys(acta.votos), ...Object.keys(votosAnt)]);

    for (const c of todosCandidatos) {
      const valNuevo = acta.votos[c] || 0;
      const valAnt = votosAnt[c] || 0;
      const diff = valNuevo - valAnt;
      if (diff !== 0) {
        deltas[c] = diff;
      }
    }

    const esPrimera = !prev;
    if (esPrimera) {
      this.mesasInformadasDep += 1;
    }

    // Aplicar a los 4 niveles
    const updateLevel = (map: Map<number, Record<string, number>>, key: number) => {
      const current = map.get(key) || { __mesas: 0 };
      if (esPrimera) current.__mesas += 1;
      for (const [c, diff] of Object.entries(deltas)) {
        current[c] = (current[c] || 0) + diff;
      }
      map.set(key, current);
    };

    updateLevel(this.totMesa, acta.mesa);
    updateLevel(this.totPuesto, acta.puesto);
    updateLevel(this.totMun, acta.municipio);

    for (const [c, diff] of Object.entries(deltas)) {
      this.totDep[c] = (this.totDep[c] || 0) + diff;
    }

    this.actas.set(acta.acta, {
      version: acta.version,
      votos: acta.votos,
      sufragantes: acta.sufragantes
    });

    if (esActaDudosa(acta)) {
      this.colaVerificacion.push({ acta: acta.acta, sufragantes: acta.sufragantes, version: acta.version });
    }

    return { status: 'OK', version: acta.version, kind: esPrimera ? 'nueva' : 'correccion' };
  }
}

describe('Núcleo de Actas - Validación, Idempotencia y Convergencia', () => {
  it('Validación Zod: rechaza actas con campos inválidos o ausentes', () => {
    const invalida = {
      acta: 'E14-1',
      // falta mesa, puesto, municipio
      version: 1,
      votos: { C1: -5 } // negativo
    };
    const res = ActaInputSchema.safeParse(invalida);
    expect(res.success).toBe(false);
  });

  it('Regla contable: detecta actas dudosas cuando suma(votos) != sufragantes', () => {
    const actaCuadrada: ActaInput = {
      acta: 'E14-176-0042-01',
      mesa: 4201,
      puesto: 176,
      municipio: 11,
      version: 1,
      jurado: 'JUR-88134',
      ts_cierre: 1793577600,
      votos: { C1: 100, C2: 50, BLANCO: 10, NULO: 0, NO_MARCADO: 0 },
      sufragantes: 160,
      hash_foto: 'hash1234',
      idem: 'idem0001'
    };
    expect(esActaDudosa(actaCuadrada)).toBe(false);

    const actaDudosa: ActaInput = {
      ...actaCuadrada,
      sufragantes: 170 // no cuadra (160 != 170)
    };
    expect(esActaDudosa(actaDudosa)).toBe(true);
  });

  it('RF-1: Reenvío x5 de la misma acta suma una sola vez', () => {
    const motor = new MemoriaPreconteo();
    const acta: ActaInput = {
      acta: 'E14-001',
      mesa: 1,
      puesto: 1,
      municipio: 1,
      version: 1,
      jurado: 'JUR-1',
      ts_cierre: 1000,
      votos: { C1: 120, C2: 80 },
      sufragantes: 200,
      hash_foto: 'hash1',
      idem: 'idem1'
    };

    const r1 = motor.applyActa(acta);
    expect(r1.status).toBe('OK');

    // 4 reenvíos subsecuentes
    for (let i = 0; i < 4; i++) {
      const r = motor.applyActa(acta);
      expect(r.status).toBe('STALE');
    }

    // Totales departamentales deben reflejar exactamente un solo envío
    expect(motor.totDep['C1']).toBe(120);
    expect(motor.totDep['C2']).toBe(80);
    expect(motor.mesasInformadasDep).toBe(1);
  });

  it('RF-2: v3 antes que v2 no retrocede el acumulado', () => {
    const motor = new MemoriaPreconteo();
    const v1: ActaInput = {
      acta: 'E14-002',
      mesa: 2,
      puesto: 1,
      municipio: 1,
      version: 1,
      jurado: 'JUR-1',
      ts_cierre: 1000,
      votos: { C1: 100 },
      sufragantes: 100,
      hash_foto: 'h1',
      idem: 'id1'
    };

    const v3: ActaInput = {
      ...v1,
      version: 3,
      votos: { C1: 300 },
      sufragantes: 300,
      idem: 'id3'
    };

    const v2Tardia: ActaInput = {
      ...v1,
      version: 2,
      votos: { C1: 200 },
      sufragantes: 200,
      idem: 'id2'
    };

    motor.applyActa(v1);
    expect(motor.totDep['C1']).toBe(100);

    // Llega v3 primero
    const r3 = motor.applyActa(v3);
    expect(r3.status).toBe('OK');
    expect(motor.totDep['C1']).toBe(300);

    // Llega v2 tarde: debe dar STALE y NO retroceder a 200
    const r2 = motor.applyActa(v2Tardia);
    expect(r2.status).toBe('STALE');
    expect(motor.totDep['C1']).toBe(300); // Se mantiene en 300
  });

  it('RF-2: Todas las permutaciones de llegada de versiones dan el mismo resultado final (Convergencia)', () => {
    const ordenNormal = [1, 2, 3];
    const ordenDesordenado = [1, 3, 2];

    const getVersion = (v: number): ActaInput => ({
      acta: 'E14-CONV',
      mesa: 5,
      puesto: 2,
      municipio: 1,
      version: v,
      jurado: 'JUR-X',
      ts_cierre: 1000,
      votos: { C1: v * 50, C2: v * 20 },
      sufragantes: v * 70,
      hash_foto: `h${v}`,
      idem: `id${v}`
    });

    const motorA = new MemoriaPreconteo();
    for (const v of ordenNormal) motorA.applyActa(getVersion(v));

    const motorB = new MemoriaPreconteo();
    for (const v of ordenDesordenado) motorB.applyActa(getVersion(v));

    expect(motorA.totDep).toEqual(motorB.totDep);
    expect(motorA.totDep['C1']).toBe(150);
    expect(motorA.totDep['C2']).toBe(60);
  });

  it('RF-3: Los 4 niveles jerárquicos (mesa, puesto, municipio, dep) cuadran exactamente', () => {
    const motor = new MemoriaPreconteo();
    const acta1: ActaInput = {
      acta: 'E14-10-01-01',
      mesa: 101,
      puesto: 10,
      municipio: 2,
      version: 1,
      jurado: 'JUR-1',
      ts_cierre: 1000,
      votos: { C1: 50, C2: 30 },
      sufragantes: 80,
      hash_foto: 'h1',
      idem: 'id1'
    };
    const acta2: ActaInput = {
      acta: 'E14-10-01-02',
      mesa: 102,
      puesto: 10,
      municipio: 2,
      version: 1,
      jurado: 'JUR-2',
      ts_cierre: 1000,
      votos: { C1: 70, C2: 20 },
      sufragantes: 90,
      hash_foto: 'h2',
      idem: 'id2'
    };

    motor.applyActa(acta1);
    motor.applyActa(acta2);

    // Mesa
    expect(motor.totMesa.get(101)?.['C1']).toBe(50);
    expect(motor.totMesa.get(102)?.['C1']).toBe(70);

    // Puesto (suma de mesa 101 y 102)
    const puesto10 = motor.totPuesto.get(10);
    expect(puesto10?.['C1']).toBe(120);
    expect(puesto10?.['C2']).toBe(50);
    expect(puesto10?.__mesas).toBe(2);

    // Municipio
    const mun2 = motor.totMun.get(2);
    expect(mun2?.['C1']).toBe(120);
    expect(mun2?.__mesas).toBe(2);

    // Departamento
    expect(motor.totDep['C1']).toBe(120);
    expect(motor.totDep['C2']).toBe(50);
    expect(motor.mesasInformadasDep).toBe(2);
  });
});
