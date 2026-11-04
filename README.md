# Sistema de Preconteo Electoral en Tiempo Real (Backend)

Backend de alta concurrencia para preconteo electoral departamental (1.842 puestos, 6.400 mesas) construido en TypeScript y Fastify sobre un backplane en Redis y persistencia append-only en PostgreSQL.

## Arquitectura General
- **Ingestión (Jurados)**: `POST /actas` con idempotencia por `idem` y versión en Hash Redis, atómico vía script Lua (`applyActa.lua`).
- **Difusión Masiva (Público)**: SSE nativo por tópicos (`dep`, `mun:{id}`, `puesto:{id}`) con agregación temporal (`FANOUT_WINDOW_MS`) y streaming continuo sobre `ev:actas` (`Last-Event-ID`).
- **Verificación (Auditores)**: WebSocket bidireccional con bloqueo distribuido atómico (`NX PX`), renovación segura y presencia con expiración automática.
- **Persistencia Durable**: PostgreSQL 16 append-only (`actas_versiones`, `auditoria_verificacion`) alimentado asíncronamente mediante Consumer Groups (`persistidor`).
- **Despliegue**: 8 réplicas de aplicación balanceadas por Nginx en Round-Robin estricto (sin sesiones pegajosas).

---

## Criterios de Aceptación

### Requerimientos Funcionales
- [x] **RF-1**: Recepción de actas con idempotencia (`idem` + versión en `acta:{id}`).
- [x] **RF-2**: Correcciones y convergencia (versión tardía no retrocede estado, deltas matemáticos).
- [x] **RF-3**: Acumulados jerárquicos en tiempo real atómicos vía script Lua.
- [x] **RF-4**: Fan-out sin bloquear el Event Loop (agregación por ventana + lotes de 500 con `setImmediate`).
- [x] **RF-5**: Suscripción por tópico (`Map<topic, Set<Conexión>>`).
- [x] **RF-6**: Reconexión con recuperación de lo perdido (`Last-Event-ID` con `XRANGE` o snapshot).
- [ ] **RF-7**: Cola de verificación con asignación exclusiva (lock con token de auditor y reaper de expirados).
- [ ] **RF-8**: Presencia y reparto del trabajo con TTL (expiración automática de auditores inactivos).
- [x] **RF-9**: Clientes lentos y contrapresión (monitoreo de `writableLength`/`bufferedAmount` > 256KB).
- [ ] **RF-10**: Degradación ante caída de Redis (503 con `Retry-After: 5`) y prevención de avalancha con jitter.

### Requerimientos Técnicos
- [ ] **RT-1**: Mínimo 8 instancias detrás de balanceador en Docker Compose.
- [ ] **RT-2**: Prohibidas sesiones pegajosas (Round-Robin sin `ip_hash`).
- [ ] **RT-3**: Ninguna instancia se comunica directamente con otra (coordinación vía Redis).
- [x] **RT-4**: Fan-out en lotes cediendo control al Event Loop (instrumentación p50, p99, max).
- [ ] **RT-5**: Coexistencia de las 3 audiencias con transportes idóneos (HTTP POST, SSE, WS).
- [x] **RT-6**: Contrato listo para aplicación offline de jurados (`docs/CONTRATO.md`).
- [x] **RT-7**: Tablero de métricas `/ops` y `/ops/data` agregando las 8 instancias.
- [ ] **RT-8**: Prueba de carga reproducible (simulador de 20.000 clientes concurrentes).
- [ ] **RT-9**: Contrato y guía de reconexión con jitter para frontend (`docs/RECONEXION.md`).
- [ ] **RT-10**: Despliegue con configuración lista para nube.
