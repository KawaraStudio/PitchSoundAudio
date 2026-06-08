FROM python:3.12-slim

# Install FFmpeg + curl
RUN apt-get update && apt-get install -y ffmpeg curl && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

ENV WORK_DIR=/tmp/nada
ENV PORT=5000

EXPOSE 5000

CMD ["gunicorn", "main:app", "--bind", "0.0.0.0:5000", "--workers", "2", "--threads", "4", "--timeout", "300"]
