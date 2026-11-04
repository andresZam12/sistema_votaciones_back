import { FastifyPluginAsync } from 'fastify';
import { metricsPublisher } from '../metrics/publisher.js';

export const opsRoutes: FastifyPluginAsync = async (app) => {
  // JSON agregado de las 8 réplicas
  app.get('/ops/data', async (_req, reply) => {
    try {
      const data = await metricsPublisher.aggregateOpsData();
      return reply.status(200).send(data);
    } catch (err) {
      return reply.status(503).send({ error: 'No se pudieron recuperar las métricas de Redis' });
    }
  });

  // Tablero HTML interactivo
  app.get('/ops', async (_req, reply) => {
    const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Tablero de Operaciones - Preconteo Electoral</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; margin: 0; padding: 24px; }
    h1 { margin-top: 0; color: #38bdf8; font-size: 24px; display: flex; align-items: center; justify-content: space-between; }
    .badge { font-size: 14px; background: #0369a1; padding: 4px 12px; border-radius: 9999px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 24px; }
    .card { background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 16px; }
    .card .title { font-size: 12px; color: #94a3b8; text-transform: uppercase; font-weight: 600; }
    .card .value { font-size: 28px; font-weight: bold; margin-top: 8px; color: #f1f5f9; }
    table { width: 100%; border-collapse: collapse; background: #1e293b; border-radius: 8px; overflow: hidden; border: 1px solid #334155; }
    th, td { padding: 12px 16px; text-align: left; border-bottom: 1px solid #334155; font-size: 14px; }
    th { background: #0f172a; color: #94a3b8; text-transform: uppercase; font-size: 12px; }
    tr:hover { background: #334155; }
    .pill { padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 500; }
    .pill-green { background: #065f46; color: #34d399; }
  </style>
</head>
<body>
  <h1>
    Tablero de Operaciones del Clúster (8 Réplicas)
    <span class="badge" id="status-badge">Conectando...</span>
  </h1>

  <div class="grid">
    <div class="card">
      <div class="title">Instancias Vivas</div>
      <div class="value" id="val-instancias">-</div>
    </div>
    <div class="card">
      <div class="title">Conexiones Totales</div>
      <div class="value" id="val-conexiones">-</div>
    </div>
    <div class="card">
      <div class="title">Mensajes Emitidos / seg</div>
      <div class="value" id="val-msg-sec">-</div>
    </div>
    <div class="card">
      <div class="title">Event Loop p99 Promedio</div>
      <div class="value" id="val-el-p99">-</div>
    </div>
    <div class="card">
      <div class="title">Retraso Ingest → Difusión</div>
      <div class="value" id="val-delay">-</div>
    </div>
    <div class="card">
      <div class="title">Memoria RSS Global</div>
      <div class="value" id="val-rss">-</div>
    </div>
  </div>

  <h2>Detalle por Instancia</h2>
  <table>
    <thead>
      <tr>
        <th>Instancia</th>
        <th>Conexiones (SSE / WS)</th>
        <th>Mensajes / seg</th>
        <th>Event Loop (p50 / p99 / max)</th>
        <th>RSS (MB)</th>
        <th>Mem / Conexión</th>
        <th>Retraso</th>
      </tr>
    </thead>
    <tbody id="instances-body">
      <tr><td colspan="7">Cargando métricas...</td></tr>
    </tbody>
  </table>

  <script>
    async function updateOps() {
      try {
        const res = await fetch('/ops/data');
        if (!res.ok) throw new Error();
        const data = await res.json();

        document.getElementById('status-badge').textContent = 'Activo';
        document.getElementById('status-badge').className = 'badge pill-green';

        document.getElementById('val-instancias').textContent = data.global.totalInstancias;
        document.getElementById('val-conexiones').textContent = data.global.conexionesTotales.toLocaleString();
        document.getElementById('val-msg-sec').textContent = data.global.mensajesPorSegundoTotal.toLocaleString();
        document.getElementById('val-el-p99').textContent = data.global.eventLoopP99Promedio + ' ms';
        document.getElementById('val-delay').textContent = data.global.retrasoMaximoMs + ' ms';
        document.getElementById('val-rss').textContent = data.global.rssTotalMb + ' MB';

        const tbody = document.getElementById('instances-body');
        tbody.innerHTML = '';

        for (const inst of data.instancias) {
          const row = document.createElement('tr');
          row.innerHTML = \`
            <td><strong>\${inst.instancia}</strong></td>
            <td>\${inst.conexionesTotales} (\${inst.conexionesSse} SSE / \${inst.conexionesWs} WS)</td>
            <td>\${inst.mensajesPorSegundo} msg/s</td>
            <td>\${inst.eventLoopP50Ms} / \${inst.eventLoopP99Ms} / \${inst.eventLoopMaxMs} ms</td>
            <td>\${inst.rssMb} MB</td>
            <td>\${inst.memoriaPorConexionKb} KB</td>
            <td>\${inst.retrasoRecepcionPublicacionMs} ms</td>
          \`;
          tbody.appendChild(row);
        }
      } catch (err) {
        document.getElementById('status-badge').textContent = 'Degradado';
        document.getElementById('status-badge').style.background = '#991b1b';
      }
    }

    setInterval(updateOps, 1000);
    updateOps();
  </script>
</body>
</html>`;

    reply.type('text/html').send(html);
  });
};

