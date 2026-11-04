# Diagramas de Secuencia y Arquitectura

---

## 1. Ingestión de Actas (Jurados)

```mermaid
sequenceDiagram
    autonumber
    actor Jurado as Jurado / Digitador
    participant Nginx as Balanceador Nginx
    participant App as Instancia Fastify
    participant Redis as Redis (Single Instance)
    participant Stream as Redis Stream (ev:actas)

    Jurado->>Nginx: POST /actas (con x-api-key e idem)
    Nginx->>App: Round-Robin a réplica
    App->>Redis: rateLimit.lua (rl:key:min)
    alt Límite excedido (>300 req/min)
        App-->>Jurado: 429 Too Many Requests (Retry-After: 60)
    end
    App->>Redis: SET idem:{idem} 1 NX EX 86400
    alt Clave idempotencia ya existía (Reintento)
        App->>Redis: HGET acta:{id} version
        App-->>Jurado: 200 OK (ya_registrada)
    else Primera vez
        App->>Redis: applyActa.lua (atómico)
        Note over Redis: Compara versión, calcula deltas,<br/>actualiza 4 niveles (HINCRBY),<br/>rankings (ZINCRBY) y publica en Stream
        Redis->>Stream: XADD ev:actas (MAXLEN ~ 10000)
        alt Versión entrante <= guardada
            Redis-->>App: STALE
            App-->>Jurado: 200 OK (ya_registrada)
        else Versión nueva aplicada
            Redis-->>App: OK + streamId
            App-->>Jurado: 201 Created (registrada)
        end
    end
```

---

## 2. Difusión y Streaming Masivo (Público)

```mermaid
sequenceDiagram
    autonumber
    actor Publico as Navegador Público
    participant App as Instancia Fastify
    participant Batcher as FanoutBatcher (Ventana 2s)
    participant Reader as StreamReader (XREAD BLOCK)
    participant Stream as Redis Stream (ev:actas)

    Reader->>Stream: XREAD BLOCK 2000 ev:actas
    Stream-->>Reader: Nuevos eventos de actas
    Reader->>Batcher: accumulateEvent(topico, deltas, kind)

    Note over Batcher: Fusiona todos los deltas en una sola estructura.<br/>Al cumplirse 2s, serializa UNA VEZ por tópico.

    Publico->>App: GET /stream?topic=dep (Last-Event-ID: id_previo)
    alt Reconexión reciente (<= 500 eventos)
        App->>Stream: XRANGE ev:actas (id_previo +
        Stream-->>App: Eventos perdidos
        App-->>Publico: event: delta (catchup acumulado)
    else Primera conexión o desfasaje > 500
        App->>Redis: snapshot.lua
        Redis-->>App: Snapshot atómico + último streamId
        App-->>Publico: event: snapshot
    end

    loop Cada 2 segundos (Flush de Lote)
        Batcher->>Publico: event: delta (lotes de 500 con setImmediate)
    end
```

---

## 3. Consola de Verificación y Semáforo Distribuido (Auditores)

```mermaid
sequenceDiagram
    autonumber
    actor Auditor as Auditor Conectado
    participant WS as AuditorWsServer (WebSocket)
    participant Redis as Redis (verif:queue / locks)
    participant Reaper as LockReaper (cada 5s)

    Auditor->>WS: WS /auditores?key=...&id=AUD-01
    WS-->>Auditor: evento: conectado

    Auditor->>WS: {"accion": "tomar"}
    WS->>Redis: takeCase.lua (ZPOPMAX verif:queue + SET lock NX PX 30s)
    alt Hay caso disponible
        Redis-->>WS: OK + actaId + token
        WS-->>Auditor: evento: caso_asignado
    else Cola vacía
        WS-->>Auditor: evento: cola_vacia
    end

    loop Cada 10s (Latido de Auditor)
        Auditor->>WS: {"accion": "latido", "actividad": true}
        alt Hubo actividad real en los últimos 2 min
            WS->>Redis: renewLock.lua (PEXPIRE 30s si dueño coincide)
            WS-->>Auditor: evento: latido_ack (renovado: true)
        else Inactivo > 2 min ("se fue a almorzar")
            WS-->>Auditor: evento: latido_ack (renovado: false)
            Note over Reaper,Redis: El lock vence a los 30s.<br/>Reaper ejecuta reapExpired.lua y<br/>devuelve el caso a verif:queue.
        end
    end
```

---

## 4. Persistencia Desacoplada a PostgreSQL (Append-Only)

```mermaid
sequenceDiagram
    autonumber
    participant Stream as Redis Stream (ev:actas)
    participant Worker as PersistenceWorker (Consumer Group)
    participant Postgres as PostgreSQL 16 (Append-Only)

    Worker->>Stream: XREADGROUP GROUP persistidor ... STREAMS ev:actas >
    Stream-->>Worker: Batch de eventos de actas
    Worker->>Postgres: INSERT INTO actas_versiones (...) ON CONFLICT DO NOTHING
    alt Inserción confirmada en Postgres
        Worker->>Stream: XACK ev:actas persistidor {id}
    else Postgres caído o con latencia
        Note over Worker,Postgres: No se hace XACK.<br/>El mensaje queda en el PEL y se reintenta.<br/>POST /actas continúa a 0 ms de afectación.
    end
```
