"""
FastAPI エンドポイント

POST /detect - 単一フレームの検出
POST /track - 動画全体のトラッキング
GET /health - ヘルスチェック
"""

import base64
import io
import json
import os
import shutil
import tempfile
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Dict, List, Optional, Annotated
import asyncio
from concurrent.futures import ThreadPoolExecutor

import cv2
import numpy as np
from fastapi import FastAPI, File, UploadFile, Form, HTTPException, BackgroundTasks
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
import uvicorn

from detector import PlayerBallDetector, Detection, create_detector
from tracker import MultiClassTracker, create_tracker
from pipeline import TrackingPipeline, PipelineConfig, PipelineResult


# スレッドプール (lifespan外で定義)
executor = ThreadPoolExecutor(max_workers=int(os.environ.get("MAX_WORKERS", "4")))


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler for startup and shutdown"""
    global detector, tracker, pipeline

    # Startup: Initialize detector, tracker, and pipeline
    detector = create_detector(model_size="n", conf_threshold=0.3)
    tracker = create_tracker(frame_rate=30, multi_class=True)

    config = PipelineConfig(
        model_size="n",
        conf_threshold=0.3,
        device="cpu"
    )
    pipeline = TrackingPipeline(config)

    print("ML Inference API started successfully")

    yield

    # Shutdown: Cleanup
    executor.shutdown(wait=True)
    print("ML Inference API shut down")


# FastAPIアプリケーション
app = FastAPI(
    title="Soccer Analyzer ML Inference API",
    description="YOLOv8 + ByteTrack による選手・ボール検出・トラッキングAPI",
    version="1.0.0",
    lifespan=lifespan
)

# グローバルな検出器とトラッカー
detector: Optional[PlayerBallDetector] = None
tracker: Optional[MultiClassTracker] = None
pipeline: Optional[TrackingPipeline] = None

# 処理中のジョブを管理
processing_jobs: Dict[str, Dict] = {}


# --- リクエスト/レスポンスモデル ---

class DetectionResponse(BaseModel):
    """検出結果のレスポンス"""
    detections: List[Dict]
    inferenceTimeMs: float
    modelId: str = Field(default="yolov8n")


class TrackingRequest(BaseModel):
    """トラッキングリクエスト"""
    modelSize: str = Field(default="n", description="YOLOモデルサイズ (n, s, m, l, x)")
    confThreshold: float = Field(default=0.3, ge=0.0, le=1.0, description="信頼度閾値")
    frameRate: int = Field(default=30, gt=0, description="フレームレート")
    skipFrames: int = Field(default=0, ge=0, description="スキップするフレーム数")
    maxFrames: Optional[int] = Field(default=None, description="処理する最大フレーム数")
    device: str = Field(default="cpu", description="デバイス (cpu, cuda, mps)")


class TrackingResponse(BaseModel):
    """トラッキング結果のレスポンス"""
    jobId: str
    status: str
    message: str


class JobStatusResponse(BaseModel):
    """ジョブステータスのレスポンス"""
    jobId: str
    status: str
    progress: float
    result: Optional[Dict] = None
    error: Optional[str] = None


# --- エンドポイント ---

@app.get("/health")
async def health_check():
    """ヘルスチェック"""
    return {
        "status": "healthy",
        "timestamp": time.time(),
        "models": {
            "detector": detector is not None,
            "tracker": tracker is not None,
            "pipeline": pipeline is not None
        }
    }


class DetectJsonRequest(BaseModel):
    """JSON形式での検出リクエスト"""
    frameData: str = Field(..., description="Base64エンコードされた画像データ")
    width: int = Field(..., description="画像の幅")
    height: int = Field(..., description="画像の高さ")
    confThreshold: float = Field(default=0.3, ge=0.0, le=1.0)


@app.post("/detect/players", response_model=DetectionResponse)
async def detect_players_json(request: DetectJsonRequest):
    """
    選手検出 (JSON形式)

    Base64エンコードされた画像から選手を検出
    """
    if detector is None:
        raise HTTPException(status_code=500, detail="Detector not initialized")

    start_time = time.time()

    try:
        import base64
        # Base64デコード（data URL形式に対応）
        frame_data = request.frameData
        if frame_data.startswith("data:"):
            # data URL形式: data:image/xxx;base64,XXXX
            frame_data = frame_data.split(",", 1)[1] if "," in frame_data else frame_data

        image_bytes = base64.b64decode(frame_data)
        nparr = np.frombuffer(image_bytes, np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        # Raw RGB dataの場合、reshapeを試みる
        if frame is None and len(image_bytes) == request.width * request.height * 3:
            frame = np.frombuffer(image_bytes, dtype=np.uint8).reshape((request.height, request.width, 3))
            frame = cv2.cvtColor(frame, cv2.COLOR_RGB2BGR)

        if frame is None:
            raise HTTPException(status_code=400, detail="Invalid image data")

        # 検出実行（選手のみ）- スレッドセーフにパラメータで閾値を渡す
        detections = detector.detect(
            frame,
            detect_players=True,
            detect_ball=False,
            conf_threshold=request.confThreshold
        )

        # レスポンス
        detection_list = [
            {
                "bbox": {"x": det.bbox[0], "y": det.bbox[1], "w": det.bbox[2], "h": det.bbox[3]},
                "confidence": det.confidence,
                "classId": det.class_id,
                "className": det.class_name
            }
            for det in detections
        ]

        return DetectionResponse(
            detections=detection_list,
            inferenceTimeMs=(time.time() - start_time) * 1000,
            modelId="yolov8n-player"
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Detection failed: {str(e)}")


@app.post("/detect/ball", response_model=DetectionResponse)
async def detect_ball_json(request: DetectJsonRequest):
    """
    ボール検出 (JSON形式)

    Base64エンコードされた画像からボールを検出
    """
    if detector is None:
        raise HTTPException(status_code=500, detail="Detector not initialized")

    start_time = time.time()

    try:
        import base64
        # Base64デコード（data URL形式に対応）
        frame_data = request.frameData
        if frame_data.startswith("data:"):
            frame_data = frame_data.split(",", 1)[1] if "," in frame_data else frame_data

        image_bytes = base64.b64decode(frame_data)
        nparr = np.frombuffer(image_bytes, np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        # Raw RGB dataの場合、reshapeを試みる
        if frame is None and len(image_bytes) == request.width * request.height * 3:
            frame = np.frombuffer(image_bytes, dtype=np.uint8).reshape((request.height, request.width, 3))
            frame = cv2.cvtColor(frame, cv2.COLOR_RGB2BGR)

        if frame is None:
            raise HTTPException(status_code=400, detail="Invalid image data")

        # 検出実行（ボールのみ）- スレッドセーフにパラメータで閾値を渡す
        detections = detector.detect(
            frame,
            detect_players=False,
            detect_ball=True,
            conf_threshold=request.confThreshold
        )

        # レスポンス
        detection_list = [
            {
                "bbox": {"x": det.bbox[0], "y": det.bbox[1], "w": det.bbox[2], "h": det.bbox[3]},
                "confidence": det.confidence,
                "classId": det.class_id,
                "className": det.class_name
            }
            for det in detections
        ]

        return DetectionResponse(
            detections=detection_list,
            inferenceTimeMs=(time.time() - start_time) * 1000,
            modelId="yolov8n-ball"
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Detection failed: {str(e)}")


@app.post("/detect", response_model=DetectionResponse)
async def detect_frame(
    image: UploadFile = File(..., description="入力画像 (JPEG, PNG)"),
    conf_threshold: float = Form(default=0.3, ge=0.0, le=1.0),
    detect_players: bool = Form(default=True),
    detect_ball: bool = Form(default=True)
):
    """
    単一フレームの検出

    Args:
        image: 入力画像ファイル
        conf_threshold: 信頼度閾値
        detect_players: 選手を検出するか
        detect_ball: ボールを検出するか

    Returns:
        検出結果
    """
    if detector is None:
        raise HTTPException(status_code=500, detail="Detector not initialized")

    start_time = time.time()

    try:
        # 画像を読み込み
        contents = await image.read()
        nparr = np.frombuffer(contents, np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        if frame is None:
            raise HTTPException(status_code=400, detail="Invalid image format")

        # 信頼度閾値を更新
        original_threshold = detector.conf_threshold
        detector.conf_threshold = conf_threshold

        # 検出実行
        detections = detector.detect(
            frame,
            detect_players=detect_players,
            detect_ball=detect_ball
        )

        # 閾値を戻す
        detector.conf_threshold = original_threshold

        # レスポンスを構築
        detection_list = [
            {
                "bbox": {
                    "x": det.bbox[0],
                    "y": det.bbox[1],
                    "w": det.bbox[2],
                    "h": det.bbox[3]
                },
                "confidence": det.confidence,
                "classId": det.class_id,
                "className": det.class_name
            }
            for det in detections
        ]

        inference_time_ms = (time.time() - start_time) * 1000

        return DetectionResponse(
            detections=detection_list,
            inferenceTimeMs=inference_time_ms,
            modelId="yolov8n"
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Detection failed: {str(e)}")


@app.post("/track", response_model=TrackingResponse)
async def track_video(
    background_tasks: BackgroundTasks,
    video: UploadFile = File(..., description="入力動画ファイル (MP4, AVI, MOV)"),
    config: str = Form(default="{}", description="トラッキング設定 (JSON)")
):
    """
    動画全体のトラッキング (非同期)

    Args:
        video: 入力動画ファイル
        config: トラッキング設定 (JSON文字列)

    Returns:
        ジョブID
    """
    if pipeline is None:
        raise HTTPException(status_code=500, detail="Pipeline not initialized")

    try:
        # 設定をパース
        import json
        config_dict = json.loads(config) if config else {}
        request_config = TrackingRequest(**config_dict)

        # 一時ファイルに動画を保存
        temp_dir = tempfile.mkdtemp()
        video_path = os.path.join(temp_dir, video.filename or "video.mp4")

        with open(video_path, "wb") as f:
            contents = await video.read()
            f.write(contents)

        # ジョブIDを生成
        job_id = f"job_{int(time.time() * 1000)}"

        # ジョブステータスを初期化
        processing_jobs[job_id] = {
            "status": "processing",
            "progress": 0.0,
            "result": None,
            "error": None,
            "video_path": video_path,
            "temp_dir": temp_dir
        }

        # バックグラウンドでトラッキングを実行
        background_tasks.add_task(
            process_tracking_job,
            job_id,
            video_path,
            request_config,
            temp_dir
        )

        return TrackingResponse(
            jobId=job_id,
            status="processing",
            message="Tracking job started"
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to start tracking job: {str(e)}")


@app.get("/track/{job_id}", response_model=JobStatusResponse)
async def get_tracking_status(job_id: str):
    """
    トラッキングジョブのステータスを取得

    Args:
        job_id: ジョブID

    Returns:
        ジョブステータス
    """
    if job_id not in processing_jobs:
        raise HTTPException(status_code=404, detail="Job not found")

    job = processing_jobs[job_id]

    return JobStatusResponse(
        jobId=job_id,
        status=job["status"],
        progress=job["progress"],
        result=job["result"],
        error=job["error"]
    )


# --- バックグラウンドタスク ---

def process_tracking_job(
    job_id: str,
    video_path: str,
    request_config: TrackingRequest,
    temp_dir: str
):
    """トラッキングジョブを処理"""
    try:
        # パイプライン設定を構築
        config = PipelineConfig(
            model_size=request_config.modelSize,
            conf_threshold=request_config.confThreshold,
            device=request_config.device,
            frame_rate=request_config.frameRate,
            skip_frames=request_config.skipFrames,
            max_frames=request_config.maxFrames
        )

        # パイプラインを作成
        job_pipeline = TrackingPipeline(config)

        # 進捗コールバック
        def progress_callback(current: int, total: int):
            progress = current / total if total > 0 else 0.0
            processing_jobs[job_id]["progress"] = progress

        # トラッキング実行
        result = job_pipeline.process_video(video_path, progress_callback)

        # 結果を構築
        result_data = {
            "tracks": [
                {
                    "trackId": track.trackId,
                    "frames": track.frames
                }
                for track in result.tracks
            ],
            "ball": [
                {
                    "frameNumber": ball.frameNumber,
                    "timestamp": ball.timestamp,
                    "position": ball.position,
                    "confidence": ball.confidence,
                    "visible": ball.visible
                }
                for ball in result.ball
            ],
            "metadata": result.metadata
        }

        # ジョブステータスを更新
        processing_jobs[job_id]["status"] = "completed"
        processing_jobs[job_id]["progress"] = 1.0
        processing_jobs[job_id]["result"] = result_data

    except Exception as e:
        # エラー時
        processing_jobs[job_id]["status"] = "error"
        processing_jobs[job_id]["error"] = str(e)

    finally:
        # 一時ファイルをクリーンアップ（再帰的に削除）
        try:
            if os.path.exists(temp_dir):
                shutil.rmtree(temp_dir)
        except Exception as cleanup_error:
            print(f"Cleanup error: {cleanup_error}")


# --- メイン ---

if __name__ == "__main__":
    # サーバーを起動
    port = int(os.environ.get("PORT", 8080))
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=port,
        log_level="info"
    )
