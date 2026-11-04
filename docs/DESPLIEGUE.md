# Guía de Despliegue en la Nube (Ubuntu 22.04 / 24.04 LTS)

Esta guía documenta los pasos para desplegar el backend completo en una máquina virtual en la nube (AWS EC2, DigitalOcean Droplet, GCP Compute Engine o Hetzner) con 8 réplicas balanceadas por Nginx sin afinidad de sesión (RT-1, RT-2, RT-10).

---

## 1. Requisitos de la Máquina Virtual
- **Sistema Operativo:** Ubuntu Server 22.04 o 24.04 LTS.
- **Hardware recomendado:** Mínimo 2 vCPUs y 4 GB de RAM.
- **Puertos a habilitar en el Firewall / Security Group:**
  - `TCP 80` (requerido por Caddy para el reto ACME HTTP-01 de Let's Encrypt, y como respaldo sin TLS).
  - `TCP 443` (HTTPS/WSS público para Jurados, Público SSE, Auditores y Tablero `/ops`).
  - `TCP 22` (Acceso SSH administrativo).

En Oracle Cloud esto se abre en **dos lugares**: la Security List de la VCN (consola web) y el firewall interno de la VM (`iptables`/`netfilter-persistent`), que en las imágenes de Oracle viene cerrado por defecto para todo lo que no sea el 22.

---

## 2. Optimización de Límites de Descriptores de Archivos (Para 50.000+ Conexiones)

Antes de iniciar los contenedores, configure los límites del sistema operativo del servidor:

```bash
# Elevar descriptores de archivo temporales
sudo sysctl -w fs.file-max=2097152
sudo sysctl -w net.core.somaxconn=65535
ulimit -n 65535

# Hacer permanente la configuración
sudo bash -c 'cat >> /etc/security/limits.conf << EOF
* soft nofile 65535
* hard nofile 65535
root soft nofile 65535
root hard nofile 65535
EOF'
```

---

## 3. Instalación de Docker y Docker Compose

```bash
sudo apt update && sudo apt install -y curl git
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER
newgrp docker
```

---

## 4. Clonación y Configuración del Proyecto

```bash
git clone https://github.com/andresZam12/sistema_votaciones_back.git
cd sistema_votaciones_back

# Configurar variables de entorno
cp .env.example .env
```

Edite `.env` y defina `PUBLIC_HOSTNAME` con el hostname público que usará Caddy para emitir el certificado TLS. Si no tiene dominio propio, use el servicio gratuito **sslip.io**: convierte su IP pública en un hostname resoluble sin registrar nada, reemplazando los puntos por guiones. Ejemplo, con IP `150.230.12.34`:

```bash
PUBLIC_HOSTNAME=150-230-12-34.sslip.io
```

---

## 5. Construcción y Despliegue del Clúster (8 Réplicas)

Ejecute Docker Compose escalando el servicio `app` a **8 réplicas** en segundo plano. Use los dos archivos de compose juntos (`docker-compose.prod.yml` agrega Caddy y hace que nginx deje de exponerse directo al host, para que Caddy sea el único punto de entrada público con TLS):

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build --scale app=8
```

Verifique que los 11 contenedores estén corriendo (`votaciones-redis`, `votaciones-postgres`, `votaciones-nginx`, `votaciones-caddy` y las 8 réplicas de `app`):
```bash
docker compose ps
```

La primera vez, Caddy tarda unos segundos en obtener el certificado de Let's Encrypt (necesita el puerto 80 abierto para el reto ACME HTTP-01). Revise que no haya errores con:
```bash
docker compose logs caddy --tail=50
```

---

## 6. Carga de Topología Electoral (Seed)

**Importante**: no use `docker compose exec app npm run seed`. La imagen de producción de `app` no incluye `scripts/` ni las devDependencies (`tsx`), así que ese comando falla. Use el servicio `seed` dedicado, que construye la etapa `builder` (con el código fuente completo) y corre una sola vez:

```bash
docker compose run --rm seed
```

---

## 7. Verificación del Despliegue y Balanceo Round-Robin (RT-1, RT-2)

1. **Comprobar la distribución de instancias:**
```bash
chmod +x scripts/whoami-check.sh
./scripts/whoami-check.sh http://localhost/whoami
```
Debe observar que las llamadas se reparten equitativamente entre los 8 hostnames de los contenedores. Esta verificación se hace desde dentro de la VM contra `localhost`, porque tras agregar Caddy nginx ya no publica el puerto 80 al host directamente (ver sección 5).

2. **Abrir la URL pública en el navegador** (usando el `PUBLIC_HOSTNAME` configurado, ya con HTTPS):
- Tablero Operacional: `https://<PUBLIC_HOSTNAME>/ops`
- Chequeo de Salud: `https://<PUBLIC_HOSTNAME>/health`
- Streaming Público: `https://<PUBLIC_HOSTNAME>/stream?topic=dep`

---

## 8. Conectar el Frontend (Vercel)

El frontend (repositorio aparte) lee la URL del backend de dos variables de entorno en tiempo de build, con `localhost:3000` como valor por defecto. En el proyecto de Vercel, vaya a **Settings → Environment Variables** y defina:

```
VITE_API_URL=https://<PUBLIC_HOSTNAME>
VITE_WS_URL=wss://<PUBLIC_HOSTNAME>
```

Luego dispare un nuevo deploy (Vercel no reconstruye automáticamente solo por cambiar variables de entorno). Como el backend sirve HTTPS/WSS reales (no un túnel con certificado autofirmado), no hay problema de contenido mixto con la página servida por Vercel.

