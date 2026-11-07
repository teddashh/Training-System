# Evitina Learn · Formación y evaluación empresarial

[English](../README.md) · [繁體中文](README.zh-TW.md) · Español

Plataforma autohospedada de formación, creación de cursos, exámenes y evaluación para empleados, contratistas y participantes invitados. Reconstruye la plataforma Yaksh con una API moderna e integra Scormly.

**El idioma predeterminado es el inglés.** Puede cambiar a chino tradicional o español desde el inicio de sesión, el espacio de trabajo, el editor o un examen. La plataforma y el estudio comparten la preferencia sin borrar cambios ni respuestas. Los contenidos de cursos, preguntas y nombres conservan su idioma original.

Incluye SSO con Entra ID; acceso por correo, usuario o ID de empleado; cursos SCORM con reanudación; publicación y copia editable del proyecto; exámenes independientes; límites por participante; revisión manual y paneles de resultados. Los exámenes admiten audiencias de empleados, contratistas, departamentos, personas seleccionadas o solo invitados. Los enlaces pueden exigir verificación del correo del destinatario; el formulario del organizador activa esta opción de forma predeterminada.

Desde la raíz del repositorio:

```bash
cp .env.example .env
# Configure un SECRET_KEY aleatorio y POSTGRES_PASSWORD.
docker compose up --build -d --wait
docker compose exec api python manage.py createsuperuser
docker compose exec api python manage.py shell -c \
  "from training.models import User; User.objects.filter(is_superuser=True).update(role='admin')"
```

Abra <http://localhost:8080>. Entra ID y SMTP requieren la configuración de su empresa; el repositorio público contiene el código, no un servicio corporativo ya desplegado. SCORM implementa un subconjunto para un solo SCO, sin certificación completa. El código antiguo de Yaksh es un archivo de referencia para migración y no debe desplegarse.

Consulte la [guía completa en inglés](../README.md), la [documentación de despliegue](DEPLOYMENT.md) y las [integraciones](INTEGRATIONS.md) para conocer los comandos, pruebas y límites.

![Interfaz en español con datos de demostración](screenshots/dashboard-es.png)

## Entrega para despliegue corporativo

La versión 1.1 añade resultados paginados con filtros y exportaciones coincidentes, análisis por evaluación y pregunta, y límites individuales visibles antes de comenzar un intento. Los informes analizan las preguntas guardadas en cada intento y respetan los permisos del administrador o instructor. [Vista del análisis](screenshots/insights.png).

La versión 1.0 añade formación obligatoria con plazos, informes de finalización, banco de preguntas, exámenes aleatorios, importación CSV y gestión de contraseñas. El idioma inicial sigue siendo inglés, con chino tradicional y español disponibles. Consulta la [entrega a Peach1](PEACH1-HANDOVER.md) y las [operaciones](OPERATIONS.md). La conexión corporativa de Entra, la sincronización de Graph y el correo se validarán en Peach1.
