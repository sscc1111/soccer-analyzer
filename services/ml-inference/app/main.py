"""FastAPI application for ML inference service."""

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from typing import Optional
import structlog
import torch

logger = structlog.get_logger()

app = FastAPI(
    title="Soccer ML Inference Service",
    description="GPU-accelerated ML inference for soccer video analysis",
    version="0.1.0",
)


class InferenceRequest(BaseModel):
    """Request model for inference."""

    video_path: str = Field(..., description="GCS path to video file (gs://...)")
    match_id: str = Field(..., description="Match ID for tracking results")
    model_type: str = Field(
        default="yolov8",
        description="Model type to use (yolov8, etc.)",
    )


class InferenceResponse(BaseModel):
    """Response model for inference."""

    status: str
    match_id: str
    message: str
    results_path: Optional[str] = None


@app.get("/health")
async def health_check() -> dict:
    """Health check endpoint."""
    cuda_available = torch.cuda.is_available()
    device_count = torch.cuda.device_count() if cuda_available else 0

    return {
        "status": "healthy",
        "cuda_available": cuda_available,
        "gpu_count": device_count,
        "gpu_name": torch.cuda.get_device_name(0) if cuda_available else None,
    }


@app.get("/")
async def root() -> dict:
    """Root endpoint."""
    return {
        "service": "Soccer ML Inference Service",
        "version": "0.1.0",
        "status": "running",
    }


@app.post("/inference", response_model=InferenceResponse)
async def run_inference(request: InferenceRequest) -> InferenceResponse:
    """
    Run ML inference on video.

    This endpoint is called by Cloud Tasks to process videos.
    """
    try:
        logger.info(
            "inference_requested",
            match_id=request.match_id,
            video_path=request.video_path,
            model_type=request.model_type,
        )

        # TODO: Implement actual inference logic
        # 1. Download video from GCS
        # 2. Run YOLO detection
        # 3. Run ByteTrack tracking
        # 4. Upload results to GCS
        # 5. Update Firestore

        return InferenceResponse(
            status="success",
            match_id=request.match_id,
            message="Inference completed successfully",
            results_path=f"gs://bucket/results/{request.match_id}/tracking.json",
        )

    except Exception as e:
        logger.error("inference_failed", error=str(e), match_id=request.match_id)
        raise HTTPException(status_code=500, detail=str(e))


@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    """Global exception handler."""
    logger.error("unhandled_exception", error=str(exc), path=request.url.path)
    return JSONResponse(
        status_code=500,
        content={"status": "error", "message": "Internal server error"},
    )
