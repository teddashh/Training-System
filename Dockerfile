FROM python:3.13-slim
ARG BRAND=default
ENV BRAND=$BRAND
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && useradd --uid 10001 --create-home app
COPY backend/ .
COPY shared/ ./shared/
ENV LOCALE_ROOT=/app/shared/locales
RUN mkdir -p media staticfiles && chown -R app:app /app
USER app
RUN DEBUG=true python manage.py collectstatic --noinput
EXPOSE 8000
CMD ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "3", "--timeout", "120"]
