-- Inicialización de esquema para PostgreSQL 16 (Append-Only)

CREATE TABLE IF NOT EXISTS mesas (
  mesa INT PRIMARY KEY,
  puesto INT NOT NULL,
  municipio INT NOT NULL
);

CREATE TABLE IF NOT EXISTS actas_versiones (
  acta TEXT NOT NULL,
  version INT NOT NULL,
  mesa INT NOT NULL,
  puesto INT NOT NULL,
  municipio INT NOT NULL,
  votos JSONB NOT NULL,
  sufragantes INT NOT NULL,
  dudosa BOOLEAN NOT NULL DEFAULT FALSE,
  jurado TEXT NOT NULL,
  hash_foto TEXT NOT NULL,
  ts_cierre TIMESTAMPTZ NOT NULL,
  recibida_en TIMESTAMPTZ DEFAULT NOW(),
  instancia TEXT NOT NULL,
  PRIMARY KEY (acta, version)
);

CREATE TABLE IF NOT EXISTS auditoria_verificacion (
  id BIGSERIAL PRIMARY KEY,
  acta TEXT NOT NULL,
  auditor TEXT NOT NULL,
  evento TEXT NOT NULL,
  ts TIMESTAMPTZ DEFAULT NOW(),
  detalle JSONB
);

CREATE INDEX IF NOT EXISTS idx_actas_recibida ON actas_versiones(recibida_en);
CREATE INDEX IF NOT EXISTS idx_auditoria_acta ON auditoria_verificacion(acta);

