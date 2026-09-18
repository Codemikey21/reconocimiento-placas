# AWS — Despliegue del backend

Este documento describe la infraestructura de AWS usada para alojar el backend de reconocimiento de placas. Para el detalle de configuración del servicio (systemd, dependencias, etc.) ver [`backend/README.md`](../backend/README.md).

## Cuenta y entorno

- **Cuenta:** AWS Academy Learner Lab
- **Instancia:** EC2 (tipo `t2.large`)
- **DNS público:** `ec2-44-219-23-95.compute-1.amazonaws.com`
- **Puerto de la API:** `8080`

## Par de llaves

- **Nombre:** `placa`
- **Archivo:** `placa.pem`
- Este archivo **no está incluido en el repositorio** (está excluido vía `.gitignore` por seguridad). Se guarda localmente en:
  `C:\Users\Migue\Documents\placa aws\placa.pem`

## Security Group

Puertos habilitados en el grupo de seguridad de la instancia:

| Puerto | Protocolo | Uso |
|--------|-----------|-----|
| 22     | TCP       | Acceso SSH |
| 8080   | TCP       | API FastAPI (se usó este puerto porque ya estaba abierto en el Learner Lab por defecto) |

## Checklist antes de una demo

1. Entrar a AWS Academy y darle **Start Lab** (los laboratorios de Learner Lab se apagan solos tras un tiempo de inactividad).
2. Esperar a que el ícono de estado quede en verde (instancia `running`).
3. Confirmar que el DNS público siga siendo el mismo (en Learner Lab puede cambiar si la instancia se reinicia por completo, no solo se detiene).
4. Verificar que la API responda:

```powershell
curl http://ec2-44-219-23-95.compute-1.amazonaws.com:8080/health
```

5. Si no responde, conectarse por SSH y revisar el servicio (ver [`backend/README.md`](../backend/README.md) para los comandos de diagnóstico):

```powershell
ssh -i "C:\Users\Migue\Documents\placa aws\placa.pem" ubuntu@ec2-44-219-23-95.compute-1.amazonaws.com
```

## Notas

- AWS Academy Learner Lab tiene un límite de horas de sesión activa; si la sesión expira, la instancia se detiene y hay que iniciarla de nuevo desde el paso 1.
- El modelo entrenado (`best.pt`) y el código del backend viven en `/home/ubuntu/backend` dentro de la instancia.
