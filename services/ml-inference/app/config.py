"""Configuration management for ML inference service."""

from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import Optional


class Settings(BaseSettings):
    """Application settings."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    # Server
    port: int = 8080
    host: str = "0.0.0.0"
    workers: int = 1

    # GCP
    gcp_project: str = ""
    gcs_bucket: str = ""
    firestore_collection: str = "matches"

    # ML Models
    yolo_model: str = "yolov8n.pt"  # yolov8n, yolov8s, yolov8m, yolov8l, yolov8x
    model_weights_path: Optional[str] = None
    confidence_threshold: float = 0.25
    iou_threshold: float = 0.45

    # Tracking
    track_buffer: int = 30
    track_thresh: float = 0.5
    match_thresh: float = 0.8

    # Processing
    batch_size: int = 1
    max_video_duration: int = 7200  # 2 hours in seconds
    frame_skip: int = 0  # Process every frame by default

    # GPU
    device: str = "cuda"  # "cuda" or "cpu"
    gpu_memory_fraction: float = 0.9

    # Logging
    log_level: str = "INFO"
    log_json: bool = True


settings = Settings()
