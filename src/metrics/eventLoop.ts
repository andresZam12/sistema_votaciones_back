import { monitorEventLoopDelay, IntervalHistogram } from 'node:perf_hooks';

export class EventLoopMonitor {
  private histogram: IntervalHistogram;

  constructor() {
    this.histogram = monitorEventLoopDelay({ resolution: 10 });
    this.histogram.enable();
  }

  // Retorna las métricas del Event Loop en milisegundos y resetea el histograma
  getMetrics(): { p50: number; p99: number; max: number } {
    const p50 = this.histogram.percentile(50) / 1e6; // nanosegundos a milisegundos
    const p99 = this.histogram.percentile(99) / 1e6;
    const max = this.histogram.max / 1e6;

    this.histogram.reset();

    return {
      p50: Number(p50.toFixed(2)),
      p99: Number(p99.toFixed(2)),
      max: Number(max.toFixed(2))
    };
  }

  disable(): void {
    this.histogram.disable();
  }
}

export const eventLoopMonitor = new EventLoopMonitor();
