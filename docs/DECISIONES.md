# Registro de Decisiones de Arquitectura

1. **Fotos de actas**: Solo se valida y persiste el `hash_foto` en el payload y en PostgreSQL; la subida y almacenamiento de archivos binarios queda fuera de alcance del taller de 3 horas (en producción iría a S3/GCS).
2. **Autenticación simplificada**: Autenticación por roles mediante API keys estáticas simples (`JURADO_KEYS`, `AUDITOR_KEYS` pasadas en cabeceras `x-api-key` y query param `key` en WebSocket) sin tablas pesadas de usuarios para priorizar latencia y defensibilidad.
3. **Persistencia desacoplada con PostgreSQL 16**: Redis maneja el estado caliente y la coordinación atómica en memoria. PostgreSQL almacena el registro histórico append-only vía un worker en segundo plano (`persistidor`) usando Consumer Groups sobre `ev:actas` y `ev:audit`, garantizando que `POST /actas` no se bloquee ni degrade si la base de datos relacional presenta latencia.
4. **Instancias sin estado**: Cada contenedor expone su `os.hostname()` en `/whoami` y ninguna instancia almacena sesiones en memoria local ni se comunica directamente con las demás.
5. **Backplane unificado**: Se utiliza un único Redis Stream global `ev:actas` con recorte aproximado (`MAXLEN ~ 10000`), suficiente para cubrir con holgura las ~6.600 actas de la jornada (~2 MB de memoria).
