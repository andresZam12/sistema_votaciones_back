# Guía de Despliegue en la Nube (Ubuntu 22.04 / 24.04 LTS)

Esta guía documenta los pasos para desplegar el backend completo en una máquina virtual en la nube (AWS EC2, DigitalOcean Droplet, GCP Compute Engine o Hetzner) con 8 réplicas balanceadas por Nginx sin afinidad de sesión (RT-1, RT-2, RT-10).

---

## 1. Requisitos de la Máquina Virtual
- **Sistema Operativo:** Ubuntu Server 22.04 o 24.04 LTS.
- **Hardware recomendado:** Mínimo 2 vCPUs y 4 GB de RAM.
- **Puertos a habilitar en el Firewall / Security Group:**
  - `TCP 80` (HTTP público para Jurados, Público SSE, Auditores y Tablero `/ops`).
  - `TCP 22` (Acceso SSH administrativo).

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

---

## 5. Construcción y Despliegue del Clúster (8 Réplicas)

Ejecute Docker Compose escalando el servicio `app` a **8 réplicas** en segundo plano:

```bash
docker compose up -d --build --scale app=8
```

Verifique que los 10 contenedores estén corriendo (`votaciones-redis`, `votaciones-postgres`, `votaciones-nginx` y las 8 réplicas de `app`):
```bash
docker compose ps
```

---

## 6. Carga de Topología Electoral (Seed)

Dentro de cualquiera de las réplicas o desde el host con Node.js:
```bash
docker compose exec app npm run seed
```

---

## 7. Verificación del Despliegue y Balanceo Round-Robin (RT-1, RT-2)

1. **Comprobar la distribución de instancias:**
```bash
chmod +x scripts/whoami-check.sh
./scripts/whoami-check.sh http://localhost/whoami
```
Debe observar que las llamadas se reparten equitativamente entre los 8 hostnames de los contenedores.

2. **Abrir la URL pública en el navegador:**
- Tablero Operacional: `http://<IP_PUBLICA>/ops`
- Chequeo de Salud: `http://<IP_PUBLICA>/health`
- Streaming Público: `http://<IP_PUBLICA>/stream?topic=dep`
