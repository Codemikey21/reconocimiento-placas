# Despliegue del backend en AWS EC2

Este backend corre en producción en una instancia EC2, como servicio de sistema (`systemd`), para que quede disponible 24/7 sin depender de una sesión SSH abierta.

## Datos de la instancia actual

- DNS público: `ec2-44-219-23-95.compute-1.amazonaws.com`
- Puerto de la API: `8080` (se usó porque ya estaba abierto en el Security Group; evitó crear una regla nueva)
- Usuario SSH: `ubuntu`
- Llave: `placa.pem` (no se sube al repo, está en `.gitignore`)
- Ruta del backend en el servidor: `/home/ubuntu/backend`
- Entorno virtual: `/home/ubuntu/backend/venv`

## Primer despliegue (ya hecho)

1. Arreglar permisos de la llave en Windows (una sola vez):

```powershell
icacls "C:\Users\Migue\Documents\placa aws\placa.pem" /inheritance:r
icacls "C:\Users\Migue\Documents\placa aws\placa.pem" /grant:r "$($env:USERNAME):(R)"
```

2. Copiar el backend al servidor (sin la carpeta `venv` local):

```powershell
scp -i "C:\Users\Migue\Documents\placa aws\placa.pem" -r backend\app ubuntu@ec2-44-219-23-95.compute-1.amazonaws.com:~/backend_app_tmp
scp -i "C:\Users\Migue\Documents\placa aws\placa.pem" backend\requirements.txt ubuntu@ec2-44-219-23-95.compute-1.amazonaws.com:~/requirements.txt
```

3. Por SSH, crear el entorno virtual e instalar dependencias:

```bash
mkdir -p ~/backend
mv ~/backend_app_tmp ~/backend/app
mv ~/requirements.txt ~/backend/requirements.txt
cd ~/backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

4. Probar manualmente que arranca:

```bash
venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8080
```

(Ctrl+C para detenerlo una vez confirmado que responde)

5. Crear el servicio de systemd para que quede corriendo siempre:

```bash
sudo tee /etc/systemd/system/placas-api.service > /dev/null << 'EOF'
[Unit]
Description=API de Reconocimiento de Placas
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
sudo systemctl status placas-api --no-pager
```

## Actualizar el backend después de un cambio

```powershell
scp -i "C:\Users\Migue\Documents\placa aws\placa.pem" backend\app\main.py ubuntu@ec2-44-219-23-95.compute-1.amazonaws.com:~/backend/app/main.py
scp -i "C:\Users\Migue\Documents\placa aws\placa.pem" backend\app\plate_pipeline.py ubuntu@ec2-44-219-23-95.compute-1.amazonaws.com:~/backend/app/plate_pipeline.py
ssh -i "C:\Users\Migue\Documents\placa aws\placa.pem" ubuntu@ec2-44-219-23-95.compute-1.amazonaws.com "sudo systemctl restart placas-api"
```

## Verificar que está corriendo

```powershell
curl http://ec2-44-219-23-95.compute-1.amazonaws.com:8080/health
```

Debe responder algo como `{"status":"ok","model_loaded":true}`.

## Revisar logs si algo falla

```bash
ssh -i "C:\Users\Migue\Documents\placa aws\placa.pem" ubuntu@ec2-44-219-23-95.compute-1.amazonaws.com
sudo journalctl -u placas-api -n 50 --no-pager
```

## Nota importante

Esta instancia corre en una cuenta de **AWS Academy Learner Lab**, que tiene sesiones de laboratorio con tiempo límite. Antes de cualquier prueba o sustentación, entra al laboratorio y asegúrate de que la instancia esté "Started" — si el laboratorio termina, la instancia se apaga y la API deja de responder.
