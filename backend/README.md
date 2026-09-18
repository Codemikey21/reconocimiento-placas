# Backend — API de reconocimiento de placas

API construida con FastAPI, YOLOv8 (localización de placas) y EasyOCR (lectura de texto), desplegada en una instancia EC2 mediante `systemd`.

> Nota: el dominio/IP real de la instancia no se documenta aquí públicamente; usa `<tu-dns-ec2>` como referencia y reemplázalo por el valor real que solo tú conoces.

## Configuración del servidor

- **Usuario:** `ubuntu`
- **Ruta del proyecto en el servidor:** `/home/ubuntu/backend`
- **Puerto:** `8080`
- **Llave SSH:** `placa.pem` (no incluida en el repo, ver [`aws/README.md`](../aws/README.md))

## Primer despliegue

1. Dar permisos correctos a la llave (Windows suele bloquear el uso si son demasiado abiertos):

```powershell
icacls "<ruta-a-tu-llave>\placa.pem" /inheritance:r
icacls "<ruta-a-tu-llave>\placa.pem" /grant:r "$($env:USERNAME):(R)"
```

2. Copiar el proyecto al servidor:

```powershell
scp -i "<ruta-a-tu-llave>\placa.pem" -r backend ubuntu@<tu-dns-ec2>:~/backend
```

3. Conectarse y preparar el entorno:

```powershell
ssh -i "<ruta-a-tu-llave>\placa.pem" ubuntu@<tu-dns-ec2>
```

Dentro del servidor:

```bash
cd ~/backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

4. Crear el servicio `systemd` para que corra siempre en segundo plano:

```bash
sudo tee /etc/systemd/system/placas-api.service > /dev/null << 'EOF'
[Unit]
Description=API de reconocimiento de placas
After=network.target

[Service]
User=ubuntu
WorkingDirectory=/home/ubuntu/backend
ExecStart=/home/ubuntu/backend/venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8080
Restart=always

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable placas-api
sudo systemctl start placas-api
```

## Actualizar el backend (redeploy)

Desde tu PC, cada vez que cambies código:

```powershell
scp -i "<ruta-a-tu-llave>\placa.pem" backend\app\main.py ubuntu@<tu-dns-ec2>:~/backend/app/main.py
scp -i "<ruta-a-tu-llave>\placa.pem" backend\app\plate_pipeline.py ubuntu@<tu-dns-ec2>:~/backend/app/plate_pipeline.py
ssh -i "<ruta-a-tu-llave>\placa.pem" ubuntu@<tu-dns-ec2> "sudo systemctl restart placas-api && sleep 2 && sudo systemctl status placas-api --no-pager"
```

## Verificar que está corriendo

```powershell
curl http://<tu-dns-ec2>:8080/health
```

## Ver logs / diagnosticar errores

```powershell
ssh -i "<ruta-a-tu-llave>\placa.pem" ubuntu@<tu-dns-ec2> "sudo journalctl -u placas-api -n 50 --no-pager"
```

## Importante

AWS Academy Learner Lab tiene límite de horas por sesión. Si la API deja de responder, revisa primero si el Lab sigue activo (`Start Lab` en la consola de AWS Academy) antes de asumir que es un error de código.
