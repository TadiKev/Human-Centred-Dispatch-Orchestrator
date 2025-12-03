# backend/ml_service/Dockerfile
FROM python:3.11-slim

WORKDIR /app

# system deps for pandas/scikit-learn if needed
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    gcc \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

# copy only service code (models mounted by docker-compose at runtime)
COPY main.py /app/main.py

EXPOSE 8000

CMD ["uvicorn", "main:APP", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
