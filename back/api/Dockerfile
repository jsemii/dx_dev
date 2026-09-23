FROM python:3.12-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-client \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY . .

ENV PYTHONUNBUFFERED=1
ENV APPLIANCE_API_HOST=0.0.0.0
ENV APPLIANCE_API_PORT=8000

EXPOSE 8000

CMD ["python", "appliance_api.py"]