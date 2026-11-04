# Contrato de Integración API (Backend - Frontend)

Este documento define las especificaciones exactas para el desarrollo del frontend de **Jurados**, **Público** y **Auditores**.

---

## 1. Jurados / Digitadores (HTTP POST)

### `POST /actas`
Registra la transmisión del acta E-14 de una mesa. Es una operación idempotente.

- **Headers obligatorios:**
  - `Content-Type: application/json`
  - `x-api-key: <clave_jurado>` (ejemplo: `jurado-key-demo` o `JUR-88134`)

- **Cuerpo de la petición (JSON):**
```json
{
  "acta": "E14-176-0042-03",
  "mesa": 4201,
  "puesto": 176,
  "municipio": 11,
  "version": 1,
  "jurado": "JUR-88134",
  "ts_cierre": 1793577600,
  "votos": {
    "C1": 184,
    "C2": 97,
    "C3": 311,
    "BLANCO": 22,
    "NULO": 9,
    "NO_MARCADO": 4
  },
  "sufragantes": 627,
  "hash_foto": "9f2cabc123...",
  "idem": "8f14e45fceea167a"
}
```

#### Regla de Negocio Contable
- `suma(votos) = sufragantes`.
- Si la suma no cuadra con `sufragantes`, el acta se registra en el acumulado informativo pero se marca automáticamente como **dudosa** y entra a la cola de verificación humana.

#### Códigos de Respuesta:
- **`201 Created`**: El acta se registró por primera vez o se aplicó una corrección válida (versión superior).
```json
{
  "estado": "registrada",
  "acta": "E14-176-0042-03",
  "version": 1,
  "dudosa": false,
  "kind": "nueva",
  "streamId": "1700000000-0"
}
```
- **`200 OK`**: El acta ya estaba registrada con esa clave de idempotencia (`idem`) o ya se había procesado una versión igual/superior.
```json
{
  "estado": "ya_registrada",
  "acta": "E14-176-0042-03",
  "version": 1,
  "motivo": "idempotencia_idem"
}
```
- **`401 Unauthorized`**: Falta `x-api-key` o no es válida.
- **`422 Unprocessable Entity`**: Error de validación en los datos (números negativos, campos faltantes).
- **`429 Too Many Requests`**: Se superó el límite de tasa (300 actas/min). Incluye cabecera `Retry-After: 60`.
- **`503 Service Unavailable`**: El servicio está temporalmente degradado (por ejemplo, Redis no responde). Incluye cabecera `Retry-After: 5`. El frontend debe reintentar con backoff exponencial.

---

## 2. Público (Server-Sent Events - SSE)

### `GET /stream?topic={topico}`
Recibe en tiempo real el preconteo acumulado y sus variaciones periódicas.

- **Parámetro `topic`**:
  - `dep`: Acumulado departamental global.
  - `mun:{id}`: Acumulado de un municipio (ej: `mun:11`).
  - `puesto:{id}`: Acumulado de un puesto (ej: `puesto:176`).
- **Cabeceras de Reconexión:**
  - `Last-Event-ID`: El último ID de evento recibido. Si se desconecta, el cliente envía este encabezado para recibir los deltas acumulados sin recargar la página.

#### Eventos emitidos:
1. `event: snapshot`: Fotografía completa del estado al conectar o reconectar tras desfase largo.
```json
{
  "tipo": "snapshot",
  "topic": "dep",
  "streamId": "1700000000-0",
  "mesasInformadas": 350,
  "totalMesas": 6400,
  "porcentajeMesas": 5.47,
  "totales": { "C1": 42000, "C2": 39500, "BLANCO": 2100 },
  "ranking": [
    { "candidato": "C1", "votos": 42000 },
    { "candidato": "C2", "votos": 39500 }
  ]
}
```
2. `event: delta`: Agregado de cambios producidos en la ventana de tiempo (`FANOUT_WINDOW_MS = 2s`).
```json
{
  "tipo": "delta",
  "topic": "dep",
  "streamId": "1700000002-0",
  "mesasNuevas": 12,
  "mesasInformadas": 362,
  "deltas": { "C1": +184, "C2": -15 },
  "motivo": "nueva"
}
```
3. `event: degraded`: Emitido si el motor entra en modo degradado.

---

## 3. Auditores (WebSocket)

### `WS /auditores?key=<clave_auditor>&id=<auditor_id>`

- **Mensajes Cliente → Servidor (JSON):**
  - `{"accion": "tomar"}`: Solicita el caso de mayor prioridad disponible de la cola.
  - `{"accion": "latido", "actividad": true}`: Latido periódico (cada 10s) para renovar el lock y marcar presencia. Solo renueva el lock si `actividad === true`.
  - `{"accion": "liberar", "acta": "E14-..."}`: Libera voluntariamente el caso actual.
  - `{"accion": "cerrar_caso", "acta": "E14-...", "resolucion": "aprobada"|"corregida"}`: Da por finalizada la revisión.

- **Mensajes Servidor → Cliente (JSON):**
  - `{"evento": "cola", "pendientes": [...]}`: Estado actual de la cola de actas dudosas.
  - `{"evento": "caso_asignado", "caso": {...}, "token": "..."}`: Caso asignado con lock exclusivo.
  - `{"evento": "caso_tomado_por_otro", "acta": "..."}`: Notificación de bloqueo de un caso.
  - `{"evento": "presencia", "auditores": [...]}`: Lista de auditores activos en tiempo real.

