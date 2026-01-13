"""
統合パイプライン: 動画ファイルを処理してトラッキング結果を出力

入力: 動画ファイルパス, 設定(fps等)
処理: フレーム抽出 → 検出 → トラッキング
出力: JSON形式のトラッキング結果
"""

import json
import os
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Dict, List, Optional, Callable
import cv2
import numpy as np
from tqdm import tqdm

from detector import PlayerBallDetector, create_detector
from tracker import MultiClassTracker, TrackedDetection, create_tracker


@dataclass
class PipelineConfig:
    """パイプライン設定"""

    # 検出設定
    model_size: str = "n"  # "n", "s", "m", "l", "x"
    conf_threshold: float = 0.3
    device: str = "cpu"  # "cpu", "cuda", "mps"

    # トラッキング設定
    frame_rate: int = 30
    track_activation_threshold: float = 0.3
    lost_track_buffer: int = 30

    # フレーム処理設定
    skip_frames: int = 0  # 0 = すべてのフレームを処理
    max_frames: Optional[int] = None  # None = すべてのフレームを処理

    # 出力設定
    output_format: str = "json"  # "json"
    save_annotated_video: bool = False
    annotated_video_path: Optional[str] = None


@dataclass
class TrackData:
    """トラック情報"""

    trackId: str
    frames: List[Dict]  # TrackFrameのdict表現


@dataclass
class BallData:
    """ボール検出情報"""

    frameNumber: int
    timestamp: float
    position: Dict[str, float]  # {"x": ..., "y": ...}
    confidence: float
    visible: bool


@dataclass
class PipelineResult:
    """パイプライン実行結果"""

    tracks: List[TrackData]
    ball: List[BallData]
    metadata: Dict


class TrackingPipeline:
    """動画処理パイプライン"""

    def __init__(self, config: Optional[PipelineConfig] = None):
        """
        Args:
            config: パイプライン設定
        """
        self.config = config or PipelineConfig()

        # 検出器とトラッカーを初期化
        self.detector = create_detector(
            model_size=self.config.model_size,
            conf_threshold=self.config.conf_threshold,
            device=self.config.device
        )

        self.tracker = create_tracker(
            frame_rate=self.config.frame_rate,
            multi_class=True
        )

    def process_video(
        self,
        video_path: str,
        progress_callback: Optional[Callable[[int, int], None]] = None
    ) -> PipelineResult:
        """
        動画ファイルを処理

        Args:
            video_path: 動画ファイルパス
            progress_callback: 進捗コールバック関数 (current_frame, total_frames)

        Returns:
            トラッキング結果
        """
        # 動画を開く
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            raise ValueError(f"Failed to open video: {video_path}")

        # 動画情報を取得
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        fps = cap.get(cv2.CAP_PROP_FPS)
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

        # 最大フレーム数を制限
        if self.config.max_frames:
            total_frames = min(total_frames, self.config.max_frames)

        # トラッカーをリセット
        self.tracker.reset()

        # 結果を格納する辞書
        tracks_dict: Dict[str, List[Dict]] = {}  # track_id -> frames
        ball_detections: List[BallData] = []

        # アノテーション付き動画の準備
        video_writer = None
        if self.config.save_annotated_video:
            if not self.config.annotated_video_path:
                raise ValueError("annotated_video_path must be set when save_annotated_video is True")
            fourcc = cv2.VideoWriter_fourcc(*'mp4v')
            video_writer = cv2.VideoWriter(
                self.config.annotated_video_path,
                fourcc,
                fps,
                (width, height)
            )

        # フレームごとに処理
        frame_number = 0
        processed_frames = 0

        pbar = tqdm(total=total_frames, desc="Processing video")

        while cap.isOpened() and processed_frames < total_frames:
            ret, frame = cap.read()
            if not ret:
                break

            # フレームスキップ
            if self.config.skip_frames > 0 and frame_number % (self.config.skip_frames + 1) != 0:
                frame_number += 1
                continue

            # 検出
            detections = self.detector.detect(frame)

            # トラッキング
            tracked_result = self.tracker.update(detections, frame_number)

            # 選手トラックを集約
            for tracked_det in tracked_result["players"]:
                track_id = tracked_det.track_id
                if track_id not in tracks_dict:
                    tracks_dict[track_id] = []

                frame_data = {
                    "frameNumber": tracked_det.frame_number,
                    "timestamp": tracked_det.timestamp,
                    "bbox": {
                        "x": tracked_det.bbox[0],
                        "y": tracked_det.bbox[1],
                        "w": tracked_det.bbox[2],
                        "h": tracked_det.bbox[3]
                    },
                    "center": {
                        "x": tracked_det.center[0],
                        "y": tracked_det.center[1]
                    },
                    "confidence": tracked_det.confidence
                }
                tracks_dict[track_id].append(frame_data)

            # ボール検出を記録
            for tracked_ball in tracked_result["ball"]:
                ball_data = BallData(
                    frameNumber=tracked_ball.frame_number,
                    timestamp=tracked_ball.timestamp,
                    position={
                        "x": tracked_ball.center[0],
                        "y": tracked_ball.center[1]
                    },
                    confidence=tracked_ball.confidence,
                    visible=True
                )
                ball_detections.append(ball_data)

            # アノテーション
            if video_writer:
                annotated_frame = self._annotate_frame(
                    frame,
                    tracked_result["players"],
                    tracked_result["ball"]
                )
                video_writer.write(annotated_frame)

            # 進捗更新
            frame_number += 1
            processed_frames += 1
            pbar.update(1)

            if progress_callback:
                progress_callback(processed_frames, total_frames)

        pbar.close()
        cap.release()
        if video_writer:
            video_writer.release()

        # トラックデータを構築
        tracks = []
        for track_id, frames in tracks_dict.items():
            if not frames:
                continue

            track_data = TrackData(
                trackId=track_id,
                frames=frames
            )
            tracks.append(track_data)

        # メタデータ
        metadata = {
            "videoPath": video_path,
            "totalFrames": total_frames,
            "processedFrames": processed_frames,
            "fps": fps,
            "width": width,
            "height": height,
            "modelSize": self.config.model_size,
            "confThreshold": self.config.conf_threshold,
            "tracksCount": len(tracks),
            "ballDetectionsCount": len(ball_detections)
        }

        return PipelineResult(
            tracks=tracks,
            ball=ball_detections,
            metadata=metadata
        )

    def _annotate_frame(
        self,
        frame: np.ndarray,
        players: List[TrackedDetection],
        balls: List[TrackedDetection]
    ) -> np.ndarray:
        """フレームにトラッキング結果をアノテーション"""
        annotated = frame.copy()
        height, width = frame.shape[:2]

        # 選手を描画
        for player in players:
            x, y, w, h = player.bbox
            x1 = int(x * width)
            y1 = int(y * height)
            x2 = int((x + w) * width)
            y2 = int((y + h) * height)

            # バウンディングボックス
            cv2.rectangle(annotated, (x1, y1), (x2, y2), (0, 255, 0), 2)

            # トラックID
            label = f"{player.track_id}: {player.confidence:.2f}"
            cv2.putText(
                annotated,
                label,
                (x1, y1 - 10),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.5,
                (0, 255, 0),
                2
            )

        # ボールを描画
        for ball in balls:
            cx, cy = ball.center
            cx_px = int(cx * width)
            cy_px = int(cy * height)

            # 円で描画
            cv2.circle(annotated, (cx_px, cy_px), 10, (0, 0, 255), -1)
            cv2.circle(annotated, (cx_px, cy_px), 12, (255, 255, 255), 2)

        return annotated

    def save_result(self, result: PipelineResult, output_path: str):
        """結果をファイルに保存"""
        output_data = {
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

        with open(output_path, 'w') as f:
            json.dump(output_data, f, indent=2)

    def load_result(self, input_path: str) -> PipelineResult:
        """ファイルから結果を読み込み"""
        with open(input_path, 'r') as f:
            data = json.load(f)

        tracks = [
            TrackData(trackId=t["trackId"], frames=t["frames"])
            for t in data["tracks"]
        ]

        ball = [
            BallData(
                frameNumber=b["frameNumber"],
                timestamp=b["timestamp"],
                position=b["position"],
                confidence=b["confidence"],
                visible=b["visible"]
            )
            for b in data["ball"]
        ]

        return PipelineResult(
            tracks=tracks,
            ball=ball,
            metadata=data["metadata"]
        )


def process_video_file(
    video_path: str,
    output_path: str,
    config: Optional[PipelineConfig] = None
) -> PipelineResult:
    """
    便利な動画処理関数

    Args:
        video_path: 入力動画ファイルパス
        output_path: 出力JSONファイルパス
        config: パイプライン設定

    Returns:
        トラッキング結果
    """
    pipeline = TrackingPipeline(config)
    result = pipeline.process_video(video_path)
    pipeline.save_result(result, output_path)
    return result


if __name__ == "__main__":
    # テスト用コード
    import sys

    if len(sys.argv) < 3:
        print("Usage: python pipeline.py <video_path> <output_path>")
        print("Example: python pipeline.py input.mp4 output.json")
        sys.exit(1)

    video_path = sys.argv[1]
    output_path = sys.argv[2]

    # 設定
    config = PipelineConfig(
        model_size="n",
        conf_threshold=0.3,
        device="cpu",
        frame_rate=30
    )

    # 処理実行
    print(f"Processing video: {video_path}")
    result = process_video_file(video_path, output_path, config)

    print(f"\nResults saved to: {output_path}")
    print(f"Tracks: {len(result.tracks)}")
    print(f"Ball detections: {len(result.ball)}")
    print(f"Processed frames: {result.metadata['processedFrames']}")
