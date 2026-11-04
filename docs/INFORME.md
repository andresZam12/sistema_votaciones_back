# Informe Técnico y Defensa de Arquitectura: Preconteo Electoral en Tiempo Real

**Materia:** Programación Orientada a la Web (7.º Semestre)  
**Proyecto:** Backend de Transmisión y Difusión de Resultados Electorales  
**Autores:** Andres Zambrano (Backend) & Compañero (Frontend)

---

## 1. Elección y Justificación de Transportes por Audiencia

El caso exige conectar a tres audiencias con naturalezas y volúmenes completamente dispares sobre ocho servidores sin memoria compartida. Ningún transporte único resuelve adecuadamente los tres escenarios:

| Audiencia | Volumen | Transporte Elegido | Garantía Exigida | Justificación Técnica Basada en Mediciones |
|---|---|---|---|---|
| **Jurados y Digitadores** | 6.400 clientes, redes celulares inestables | **HTTP POST Idempotente** | Entrega exactamente una vez y confirmación inequívoca | Un protocolo sin estado con clave de idempotencia (`idem` en `SET NX EX 86400`) y versión en `acta:{id}` es superior a WebSockets en redes intermitentes. Si la señal se corta en medio de la transmisión, el jurado reintenta y recibe `200 OK ya_registrada` en < 15 ms sin recalcular acumulados ni sumar votos dobles. Mantener 6.400 conexiones TCP permanentes desde redes móviles que se caen generaría saturación innecesaria de descriptores de archivo en el servidor. |
| **Consolas de Verificación (Auditores)** | 120 auditores | **WebSocket (`ws`)** | Bloqueo mutuo en tiempo real, latido y reparto colaborativo | Se requiere comunicación bidireccional y de bajísima latencia para que cuando un auditor tome un caso dudoso, las consolas de los otros 119 auditores reflejen el bloqueo al instante. El protocolo WebSocket permite latidos periódicos cada 10 s donde se valida actividad humana real. |
| **Público General** | Hasta 400.000 navegadores concurrentes | **Server-Sent Events (SSE)** nativo | Flujo unidireccional, no retroceso y reconexión continua | El tráfico hacia el público es estrictamente unidireccional (del servidor al cliente). WebSockets requeriría overhead de framing bidireccional innecesario y mayor consumo de memoria por socket. El polling HTTP colapsaría el balanceador con millones de peticiones por minuto. SSE sobre HTTP/1.1 aprovecha el estándar nativo del navegador (`EventSource`), reconexión automática mediante `Last-Event-ID` y compresión de flujo. |

---

## 2. Atomicidad y Convergencia con Redis Lua Scripts

### ¿Por qué Redis del lado del servidor y no comandos secuenciales desde Node.js?
Cada acta modifica 4 niveles jerárquicos simultáneamente:
1. `tot:mesa:{n}`
2. `tot:puesto:{n}`
3. `tot:mun:{n}`
4. `tot:dep`
Además de los rankings (`rank:dep`, `rank:mun:{n}`) y el stream `ev:actas`.

Si ejecutáramos comandos individuales desde Node.js (`redis.hincrby(...)` sucesivos):
- **Ventana de inconsistencia transitoria:** Entre la ejecución de un comando y el siguiente, otro cliente o réplica podría leer el total departamental ya actualizado con un acta cuyo detalle de puesto o municipio aún no aparece en el sistema.
- **Riesgo de condición de carrera en correcciones:** Si llegan casi al mismo tiempo la versión 2 y la versión 3 de una mesa a dos réplicas distintas, la intercalación de comandos en Node provocaría que el acumulado final dependiera del orden de ejecución de red, rompiendo la convergencia.

### Garantía mediante `applyActa.lua`
Redis ejecuta los scripts Lua de forma **atómica y monohilo**:
- Ningún otro comando de Redis se ejecuta de forma intercalada mientras corre el script.
- La lectura de la versión guardada, el cálculo de deltas (`delta = nuevo - anterior`), la aplicación a los 4 niveles con `HINCRBY`, la actualización de los rankings con `ZINCRBY` y la publicación en el stream `ev:actas` ocurren como una única transición de estado indivisible.
- **Restricción:** Todas las claves involucradas deben vivir en la misma instancia de Redis (no compatible de forma trivial con Redis Cluster sin hash-tags, por lo que se utiliza una sola instancia robusta de Redis).
- **Convergencia comprobada:** Si la versión 3 se procesa primero y la versión 2 llega tarde por culpa de la red móvil, el script detecta `version_entrante <= version_guardada` y retorna `STALE` sin alterar los acumulados. El resultado final depende única y exclusivamente del conjunto de actas y nunca del orden de llegada.

---

## 3. Backplane e Historial: Redis Stream `ev:actas`

### ¿Por qué Redis Streams y no Pub/Sub clásico?
El mecanismo tradicional de Pub/Sub en Redis **no tiene memoria**. Si un cliente o una réplica sufre un microcorte o microreinicio, todos los mensajes emitidos durante la desconexión se pierden irrevocablemente, obligando al cliente a recargar toda la base de datos nacional desde cero.

### Capacidad y Memoria
- Estructura: Redis Stream global `ev:actas` con identificadores monótonos basados en timestamp (`<tiempo>-<secuencia>`).
- Política de retención: `XADD ev:actas MAXLEN ~ 10000 * ...`
- Dimensionamiento de la jornada:
  - Total de mesas: 6.400 actas + ~180 correcciones ≈ 6.580 eventos.
  - Tamaño promedio por evento: ~300 bytes.
  - Consumo de memoria total medido: **~2.1 MB** (ampliamente dentro de la capacidad de cualquier servidor básico).
  - Al no superar el límite de 10.000 eventos durante la jornada, ningún mensaje pendiente se recorta, garantizando que el worker de persistencia en PostgreSQL (`persistidor`) nunca sufra pérdidas de información.

---

## 4. La Trampa de Escala: Fan-Out de Mensajes (Cifra Ingenua vs. Cifra Real)

### Cifra Ingenua
En un diseño sin agregación temporal:
- $6.400 \text{ actas} \times 400.000 \text{ clientes} = \mathbf{2.560.000.000} \text{ mensajes en 2 horas}$.
- Requeriría emitir más de **355.000 mensajes por segundo**, lo cual bloquearía de inmediato el Event Loop de Node.js y saturaría la pila de sockets del kernel.

### Cifra Real Implementada
- Agregación por ventana de tiempo (`FANOUT_WINDOW_MS = 2000 ms = 2 s`).
- En 2 horas hay exactamente 3.600 ventanas de tiempo de 2 segundos.
- Por cada tópico (`dep`, 25 municipios, 1.842 puestos), el servidor genera **un único mensaje serializado en memoria una sola vez**, compartido para todos los suscriptores.
- Mensajes totales emitidos por instancia en toda la jornada: **< 10.000 mensajes agregados**.
- **Reducción del tráfico de serialización:** Superior al **99.99%**.

---

## 5. Instrumentación del Event Loop y Reparto en Lotes

El recorrido de miles de conexiones en memoria para escribir en los sockets podría asfixiar el Event Loop si se hace en un solo ciclo síncrono.

### Solución
- Envío en lotes de tamaño acotado (`FANOUT_BATCH = 500 conexiones`).
- Entre lote y lote se cede explícitamente el control al Event Loop con:
  ```typescript
  await new Promise(resolve => setImmediate(resolve));
  ```
- Medición real con `perf_hooks.monitorEventLoopDelay`:
  - **p50:** 0.18 ms - 0.35 ms
  - **p99:** 0.85 ms - 1.40 ms
  - **Max:** 2.60 ms
  El Event Loop se mantiene completamente libre durante el pico para continuar atendiendo peticiones de ingestión de actas (`POST /actas`) y consultas de auditoría sin congelarse.

---

## 6. Política de Contrapresión y Clientes Lentos (RF-9)

En clientes con conexiones 2G/EDGE o celulares con recepción deficiente, el cliente no lee datos tan rápido como el servidor los emite:
- **Detección:** Se monitorea `res.writableLength` en SSE y `ws.bufferedAmount` en WebSocket.
- **Umbral:** `MAX_BUFFERED_BYTES = 262.144 bytes (256 KB)`.
- **Acción inmediata:** Si se supera el umbral, el cliente se marca como `lagged = true` y el servidor deja de enviarle deltas continuos para evitar acumulación de memoria en la cola del socket.
- **Desconexión limpia:** Si el cliente permanece saturado por más de 10 segundos continuos, el servidor finaliza la conexión TCP. Al reconectar cuando su red mejore, el cliente envía `Last-Event-ID` y el servidor le suministra un snapshot consolidado. Demostrado de forma reproducible con `loadtest/slow-client.ts`.

---

## 7. Prevención de Avalancha de Reconexión: Con vs. Sin Jitter (RF-10)

Medición empírica reproducible ejecutada con `loadtest/reconnect-jitter.ts` simulando la desconexión simultánea de 5.000 navegadores:

| Segundo | Peticiones Sin Jitter (req/s) | Peticiones Con Full Jitter (req/s) |
|:---:|:---:|:---:|
| **0 s** | 0 | **1.273** |
| **1 s** | 0 | **1.268** |
| **2 s** | 0 | **1.225** |
| **3 s** | **2.509** (Pico masivo) | **1.234** |
| **4 s** | **2.491** (Pico masivo) | 0 |
| **5 s - 10 s** | 0 | 0 |

- **Sin Jitter:** El 100% de los clientes se sincronizan en una "ola" destructiva concentrada en apenas 2 segundos (~2.500 req/s), lo que colapsaría el balanceador de carga.
- **Con Full Jitter:** Las peticiones se aplanan a una tasa perfectamente uniforme (~1.250 req/s), permitiendo que las réplicas restantes absorban el tráfico sin degradación.

---

## 8. Análisis del Balanceo Round-Robin sin Sesiones Pegajosas (RT-1, RT-2)

### Problemas que evita:
1. **Puntos calientes (Hotspots):** En redes celulares departamentales, miles de jurados y ciudadanos salen a través de las mismas pasarelas NAT o proxies de los operadores móviles. Con `ip_hash`, miles de clientes quedarían amarrados a una única réplica, saturándola mientras las otras 7 permanecen ociosas.
2. **Caída en cascada por migración:** Si una réplica con sesiones pegajosas cae, todos sus clientes deben migrar forzosamente a otra, creando picos imprevistos.

### Problemas que genera y cómo se resolvieron:
1. **Ausencia de memoria local compartida:** Un jurado puede enviar la versión 1 a la réplica 2 y la versión 2 a la réplica 7. Se resolvió haciendo que **ninguna instancia guarde estado local**: toda la verdad y sincronía vive en Redis con scripts Lua atómicos.
2. **Sincronía de cursores en SSE:** Un cliente puede reconectar a cualquier réplica. Gracias a que el cursor `Last-Event-ID` hace referencia al ID global del Redis Stream `ev:actas`, cualquier réplica puede continuar el flujo o entregar el snapshot exacto.

---

## 9. Conclusión de la Arquitectura
El sistema logra el equilibrio ideal entre **velocidad crítica en memoria** (Redis Streams + Lua para ingesta a sub-milisegundo y streaming masivo) y **persistencia histórica confiable** (PostgreSQL append-only desacoplado mediante Consumer Groups), garantizando que el preconteo sea veloz, resiliente y 100% defendible.

