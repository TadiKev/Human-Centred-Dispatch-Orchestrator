

FROM python:3.11-slim
WORKDIR /app
COPY backend/ml/requirements.txt /tmp/requirements.txt
RUN apt-get update && apt-get install -y build-essential gcc && \
    pip install --no-cache-dir -r /tmp/requirements.txt && \
    apt-get remove -y build-essential gcc && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
# copy project (if you want full access to Django ORM, ensure DJANGO_SETTINGS_MODULE and PYTHONPATH envs)
COPY . /app
ENV PYTHONUNBUFFERED=1
CMD ["bash"]
