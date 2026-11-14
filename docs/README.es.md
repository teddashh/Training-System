# Training System

Sistema de formación, creación de cursos y evaluación alojado por una organización.

**[Probar la demo](https://teddashh.github.io/Training-System/demo/)**: la interfaz real con datos sintéticos, en el navegador. No se guarda nada.

[English](../README.md) · [繁體中文](README.zh-TW.md)

![Panel de formación](screenshots/dashboard-es.png)

## Qué puedes hacer

- Aprender: realizar cursos, continuar lecciones SCORM y seguir la formación obligatoria.
- Crear: preparar lecciones en Studio, importar texto de documentos o cargar paquetes SCORM.
- Organizar sesiones: programar formación, inscribir personas y registrar asistencia.
- Evaluar: crear exámenes, reutilizar preguntas y corregir respuestas escritas.
- Consultar informes: ver finalización, resultados y análisis de preguntas; exportar registros.
- Administrar: gestionar personas, roles, organización, inicio de sesión y correo.

## Inicio rápido

Instala Docker Engine y Compose v2. Desde la raíz del repositorio:

```bash
cp .env.example .env
chmod 600 .env
```

Edita `.env`: sustituye `SECRET_KEY` y `POSTGRES_PASSWORD` por valores aleatorios distintos. Mantén `DEBUG=true` para esta prueba local y establece `DEMO_MODE=false`. Deja vacías las credenciales de proveedores.

```bash
docker compose up --build -d --wait
docker compose exec api python manage.py createsuperuser --username training-admin
docker compose exec api python manage.py shell -c "from training.models import User; u=User.objects.get(username='training-admin'); u.role='admin'; u.save(update_fields=['role'])"
```

Introduce el correo y la contraseña del administrador cuando se soliciten. El último comando concede a esa cuenta el rol de plataforma **Superadministrador** (Super administrator).

Abre <http://localhost:8080> e inicia sesión. En la barra lateral, abre **Configuración** y luego la pestaña **Configuración** (Settings → Settings); establece el nombre y logotipo, los idiomas, el inicio de sesión y el correo. Guarda y, si el correo está habilitado, pulsa **Enviarme un correo de prueba** (Send test email to me).

Este entorno es una prueba local. Sigue [Primeros pasos](GETTING-STARTED.md) para el primer flujo y [Despliegue](DEPLOYMENT.md) para HTTPS y producción.

## Adáptalo a tu organización

Establece el nombre y carga un logotipo en Configuración. Puedes habilitar inglés, chino tradicional o español para la interfaz. El contenido creado conserva su idioma original.

Elige Microsoft Entra ID, Google Workspace o cuentas locales con contraseña y códigos por correo. Los códigos requieren un servicio de correo operativo. Para el correo, elige servidor SMTP, buzón de Microsoft 365 o desactivado.

Los valores controlados por el servidor muestran **Configurado por el servidor** (Set by the server). Los paquetes `BRAND` cambian los colores durante la compilación; consulta la [guía de marca](../DESIGN.md#brand-packs).

![Configuración de la organización](screenshots/settings.png)
![Configuración del inicio de sesión](screenshots/settings-sign-in.png)

## Pantallas

[Cursos](screenshots/courses.png) · [Studio](screenshots/studio.png) · [Sesiones](screenshots/sessions.png) · [Examen](screenshots/exam.png) · [Análisis](screenshots/insights.png) · [Móvil](screenshots/mobile.png)

## Documentación

| Guía | Para qué sirve |
| --- | --- |
| [Primeros pasos](GETTING-STARTED.md) | Preparar el primer flujo de formación |
| [Despliegue](DEPLOYMENT.md) | Instalar, configurar, respaldar y actualizar |
| [Operaciones](OPERATIONS.md) | Gestionar personas, cursos, sesiones, exámenes e informes |
| [Biblioteca inicial](course-library-sources.md) | Crear e importar 60 cursos en borrador |
| [Integraciones](INTEGRATIONS.md) / [API](SIMPLE-TRAINING-API.md) | Revisar la integración del código y los contratos de API |
| [Seguridad](../SECURITY.md) / [Diseño](../DESIGN.md) | Revisar los límites de confianza y los paquetes de marca |
| [Auditoría del código de origen](UPSTREAM-AUDIT.md) | Consultar funciones implementadas y pendientes |

## Desarrollo

Usa Python 3.13 y Node.js 24:

```bash
python3.13 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt
npm ci --prefix frontend
npm ci --prefix vendor/scormly
DEBUG=true .venv/bin/python backend/manage.py check
python3 scripts/check_upstream_audit.py
```

La [guía de desarrollo local](DEPLOYMENT.md#develop-locally) explica las migraciones y el arranque de servicios. Las comprobaciones incluyen pruebas de Django, las dos compilaciones de frontend, pruebas unitarias del frontend y pruebas de Studio. Las pruebas de concurrencia necesitan PostgreSQL; los flujos de navegador necesitan un entorno de prueba aislado y en funcionamiento.

## Estado y límites

Es un espacio para una sola organización. La equivalencia con las funciones de los proyectos de origen está incompleta; la auditoría registra lo pendiente. Verifica el acceso, el correo, la restauración y la carga prevista en tu despliegue.

SCORM admite un subconjunto de ejecución 1.2/2004 de un solo SCO, sin secuenciación de varios SCO ni certificación completa. El LMS no importa cmi5 ni ofrece un LRS de xAPI. Los exámenes no admiten supervisión remota, respuestas mediante archivos ni un entorno aislado de programación. La importación de documentos extrae texto, sin OCR ni diseño de diapositivas.

## Licencia

El código nuevo usa [BSD de 3 cláusulas](../LICENSE). El código de origen conservado mantiene su propia licencia; consulta los [avisos de terceros](../THIRD_PARTY_NOTICES.md).

[FOSSEE Yaksh](https://github.com/FOSSEE/online_test) aporta el código de evaluación conservado y la base para migraciones.

[Scormly](https://github.com/dmmat/Scormly) aporta el editor de cursos integrado y el reproductor exportado.
