"""
ML Inference Service - YOLOv8 + ByteTrack による選手・ボール検出・トラッキング

モジュール:
- detector: YOLOv8による検出
- tracker: ByteTrackによるトラッキング
- pipeline: 統合パイプライン
- api: FastAPIエンドポイント
"""

__version__ = "1.0.0"

from .detector import (
    Detection,
    PlayerBallDetector,
    create_detector
)

from .tracker import (
    TrackedDetection,
    ObjectTracker,
    MultiClassTracker,
    create_tracker
)

from .pipeline import (
    PipelineConfig,
    TrackData,
    BallData,
    PipelineResult,
    TrackingPipeline,
    process_video_file
)

__all__ = [
    # Detector
    "Detection",
    "PlayerBallDetector",
    "create_detector",
    # Tracker
    "TrackedDetection",
    "ObjectTracker",
    "MultiClassTracker",
    "create_tracker",
    # Pipeline
    "PipelineConfig",
    "TrackData",
    "BallData",
    "PipelineResult",
    "TrackingPipeline",
    "process_video_file",
]
