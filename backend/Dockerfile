FROM python:3.11-slim

WORKDIR /app

# Install system dependencies (curl for container healthcheck)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy build manifest and install dependencies
COPY pyproject.toml .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir .

# Copy application code and pre-load curated 360 frames cache
COPY app ./app

# Ensure cache directory exists and permissions are set
RUN mkdir -p /app/app/data/cache && ls -la /app/app/data/cache

EXPOSE 8000

# Docker-native healthcheck
HEALTHCHECK --interval=15s --timeout=5s --retries=3 \
  CMD curl -f http://localhost:8000/health || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
