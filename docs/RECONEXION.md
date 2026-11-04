# Guía de Reconexión con Backoff Exponencial y Full Jitter (RT-9, RF-10)

Esta guía explica la política de reconexión obligatoria para la aplicación pública y jurados, protegiendo las 7 réplicas restantes si una de las 8 instancias cae (evitando la avalancha del *Thundering Herd*).

---

## 1. El Problema: Avalancha de Reconexión (Thundering Herd)
Cuando una réplica del backend se reinicia o sufre un microcorte de red, sus ~50.000 clientes conectados pierden la conexión TCP simultáneamente.

- **Comportamiento ingenuo (Reintento inmediato o con retraso fijo):**
  Todos los 50.000 clientes reintentan a los 2 segundos exactos. Esto produce un pico instantáneo de 50.000 peticiones en el mismo segundo sobre las instancias vivas, saturando el balanceador Nginx, asfixiando el Event Loop y provocando caídas en cascada.
- **Backoff exponencial sin jitter:**
  Los clientes reintentan a los 1s, 2s, 4s, 8s. Aunque el tiempo crece, todos los clientes desconectados en el mismo instante avanzan en "olas sincronizadas", repitiendo los picos de saturación periódicos.
- **Solución óptima: Backoff Exponencial con Full Jitter:**
  En cada reintento, el cliente calcula un retraso aleatorio uniforme entre $0$ y el techo exponencial:
  $$\text{retraso} = \text{random}(0, \min(\text{cap}, \text{base} \times 2^{\text{intento}}))$$
  Esto dispersa uniformemente las 50.000 peticiones a lo largo de varios segundos, reduciendo la presión instantánea a una tasa perfectamente manejable.

---

## 2. Implementación de Referencia para el Frontend (TypeScript / JavaScript)

Copia y utiliza esta función en el cliente SSE (`EventSource`) o llamadas HTTP de reintento:

```typescript
export interface BackoffConfig {
  baseMs?: number; // Tiempo base inicial (ej: 1000 ms)
  capMs?: number;  // Techo máximo de espera (ej: 30000 ms)
  intento: number; // Número de intento fallido actual (1, 2, 3...)
}

/**
 * Calcula el tiempo de espera en milisegundos aplicando Full Jitter
 */
export function calcularBackoffConJitter(config: BackoffConfig): number {
  const base = config.baseMs ?? 1000;
  const cap = config.capMs ?? 30000;

  // Techo exponencial para el intento actual
  const maxDelay = Math.min(cap, base * Math.pow(2, config.intento));

  // Full Jitter: selección aleatoria uniforme entre 0 y maxDelay
  const delayConJitter = Math.floor(Math.random() * maxDelay);

  return delayConJitter;
}

/**
 * Ejemplo de reconexión resiliente para SSE en el frontend
 */
export function conectarSSEPúblico(topic: string, onMessage: (data: any) => void) {
  let intento = 0;
  let lastEventId: string | null = null;
  let es: EventSource | null = null;

  function conectar() {
    const url = new URL('/stream', window.location.origin);
    url.searchParams.set('topic', topic);

    es = new EventSource(url.toString());

    es.addEventListener('snapshot', (e) => {
      intento = 0; // Resetear intentos al recibir datos
      lastEventId = e.lastEventId;
      onMessage(JSON.parse(e.data));
    });

    es.addEventListener('delta', (e) => {
      lastEventId = e.lastEventId;
      onMessage(JSON.parse(e.data));
    });

    es.addEventListener('degraded', () => {
      console.warn('El servidor reporta modo degradado.');
    });

    es.onerror = () => {
      es?.close();
      intento++;
      const espera = calcularBackoffConJitter({ intento, baseMs: 1000, capMs: 30000 });
      console.log(`Reconectando en ${espera} ms (intento ${intento})...`);
      setTimeout(conectar, espera);
    };
  }

  conectar();
}
```

---

## 3. Comportamiento del Encabezado `Retry-After`
Si el backend responde con código HTTP `503 Service Unavailable` o `429 Too Many Requests`, siempre incluirá la cabecera `Retry-After` (en segundos). El frontend **debe** respetar ese valor mínimo antes de programar su siguiente intento con jitter.

