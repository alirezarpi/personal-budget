FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    TZ=Europe/Berlin \
    MONAT_DB=/data/monat.db

# Budget months and "today" follow local time, so the container needs real time zone data.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tzdata \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY web ./web

RUN useradd --system --uid 10001 monat && mkdir /data && chown monat /data
USER monat
VOLUME /data
EXPOSE 8765

HEALTHCHECK --interval=1m --timeout=5s --start-period=10s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8765/healthz', timeout=4)"

# One worker on purpose: the hourly sync runs inside the server process.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8765", "--proxy-headers", "--forwarded-allow-ips", "*"]
