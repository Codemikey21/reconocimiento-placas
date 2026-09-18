# AWS — Despliegue del backend

Este documento describe la infraestructura de AWS usada para alojar el backend de reconocimiento de placas. Para el detalle de configuración del servicio (systemd, dependencias, etc.) ver [`backend/README.md`](../backend/README.md).

> Nota: los valores de dominio/IP mostrados aquí son de ejemplo. El endpoint real se comparte de forma privada (no se documenta públicamente para evitar tráfico no autorizado).

## Cuenta y entorno

- **Cuenta:** AWS Academy Learner Lab
- **Instancia:** EC2 (tipo `t2.large`)
- **DNS público (ejemplo):** `ec2-XX-XXX-XX-XX.compute-1.amazonaws.com`
- **Puerto de la API:** `8080`

## Par de llaves

- **Nombre:** `placa`
- **Archivo:** `placa.pem`
- Este archivo **no está incluido en el repositorio** (excluido vía `.gitignore`). Se guarda localmente en una ruta privada fuera del proyecto.

## Security Group

| Puerto | Protocolo | Uso |
|--------|-----------|-----|
| 22     | TCP       | Acceso SSH |
| 8080   | TCP       | API FastAPI (puerto abierto por defecto en el Learner Lab) |

## Checklist antes de una demo

1. Entrar a AWS Academy y darle **Start Lab**.
2. Esperar a que la instancia quede en estado `running`.
3. Confirmar que el DNS público siga siendo el mismo (con IP elástica no debería cambiar).
4. Verificar que la API responda:

```powershell
curl http://<tu-dns-ec2>:8080/health
```

5. Si no responde, conectarse por SSH y revisar el servicio (ver [`backend/README.md`](../backend/README.md)):

```powershell
ssh -i "<ruta-a-tu-llave>\placa.pem" ubuntu@<tu-dns-ec2>
```

## Notas

- AWS Academy Learner Lab tiene un límite de horas de sesión activa; si expira, la instancia se detiene y hay que iniciarla de nuevo.
- El modelo entrenado (`best.pt`) y el código del backend viven en `/home/ubuntu/backend` dentro de la instancia.
