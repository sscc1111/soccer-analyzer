# ML Inference Service

GPU-accelerated ML inference service for soccer video analysis using YOLOv8 and ByteTrack.

## Architecture

This service is designed to run on GPU-enabled infrastructure (Vertex AI or GCE) and is invoked by Cloud Tasks from the main analyzer service.

```
Cloud Run (Analyzer) → Cloud Tasks → ML Inference Service (GPU)
                                            ↓
                                     Cloud Storage
                                            ↓
                                       Firestore
```

## Features

- **YOLOv8 Object Detection**: Detect players, ball, and referees
- **ByteTrack Multi-Object Tracking**: Track detected objects across frames
- **GPU Acceleration**: CUDA-enabled for fast inference
- **Cloud-Native**: Integrates with GCS and Firestore
- **RESTful API**: FastAPI-based HTTP interface

## Technology Stack

- **Base Image**: NVIDIA CUDA 11.8 with cuDNN 8
- **Python**: 3.10
- **ML Framework**: PyTorch 2.1+ (CUDA-enabled)
- **Detection**: Ultralytics YOLOv8
- **Tracking**: Supervision (ByteTrack)
- **Web Framework**: FastAPI + Uvicorn

## API Endpoints

### Health Check
```bash
GET /health
```

Returns GPU availability and service status.

### Inference
```bash
POST /inference
Content-Type: application/json

{
  "video_path": "gs://bucket/videos/match123.mp4",
  "match_id": "match123",
  "model_type": "yolov8"
}
```

## Development

### Prerequisites

- Docker with GPU support
- NVIDIA Container Toolkit
- NVIDIA drivers

### Build

```bash
docker build -t ml-inference:latest .
```

### Run Locally

```bash
docker run --gpus all -p 8080:8080 ml-inference:latest
```

### Test

```bash
curl http://localhost:8080/health
```

## Deployment

### Deploy to Vertex AI

```bash
gcloud ai custom-jobs create \
  --region=us-central1 \
  --display-name=ml-inference \
  --worker-pool-spec=machine-type=n1-standard-4,accelerator-type=NVIDIA_TESLA_T4,accelerator-count=1,container-image-uri=gcr.io/PROJECT_ID/ml-inference:latest
```

### Deploy to GCE with GPU

```bash
gcloud compute instances create ml-inference-vm \
  --zone=us-central1-a \
  --machine-type=n1-standard-4 \
  --accelerator=type=nvidia-tesla-t4,count=1 \
  --image-family=common-cu118 \
  --image-project=deeplearning-platform-release \
  --maintenance-policy=TERMINATE \
  --boot-disk-size=50GB
```

## Environment Variables

- `PORT`: HTTP server port (default: 8080)
- `NVIDIA_VISIBLE_DEVICES`: GPU devices to use (default: all)
- `NVIDIA_DRIVER_CAPABILITIES`: Driver capabilities (default: compute,utility)
- `GCS_BUCKET`: GCS bucket for video storage
- `FIRESTORE_PROJECT`: GCP project ID for Firestore

## Model Weights

YOLO model weights are automatically downloaded on first run. To use custom weights:

1. Upload weights to GCS
2. Set `MODEL_WEIGHTS_PATH` environment variable
3. Service will download and cache on startup

## Performance

Expected throughput on NVIDIA T4:

- **YOLOv8n**: ~100 FPS (1920x1080)
- **YOLOv8m**: ~50 FPS (1920x1080)
- **ByteTrack**: <1ms overhead per frame

## Monitoring

Health check includes GPU status:

```json
{
  "status": "healthy",
  "cuda_available": true,
  "gpu_count": 1,
  "gpu_name": "Tesla T4"
}
```

## Future Enhancements

- [ ] Model caching and warm-up
- [ ] Batch processing support
- [ ] Multi-GPU support
- [ ] Custom model fine-tuning
- [ ] Real-time streaming inference
- [ ] Prometheus metrics export
