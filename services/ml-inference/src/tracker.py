"""
ByteTrackによるトラッキングモジュール

supervisionライブラリのByteTrackを使用してフレーム間でIDを一貫して維持
"""

from dataclasses import dataclass
from typing import List, Dict, Optional
import numpy as np
import supervision as sv

from detector import Detection


@dataclass
class TrackedDetection:
    """トラックID付きの検出結果"""

    track_id: str  # "track_0", "track_1", etc.
    frame_number: int
    timestamp: float  # seconds
    bbox: tuple[float, float, float, float]  # (x, y, w, h) normalized 0-1
    center: tuple[float, float]  # (x, y) normalized 0-1
    confidence: float
    class_name: str


class ObjectTracker:
    """ByteTrackを使用したオブジェクトトラッカー"""

    def __init__(
        self,
        track_activation_threshold: float = 0.3,
        lost_track_buffer: int = 30,
        minimum_matching_threshold: float = 0.8,
        frame_rate: int = 30
    ):
        """
        Args:
            track_activation_threshold: トラック開始の信頼度閾値
            lost_track_buffer: トラックを失ってから削除するまでのフレーム数
            minimum_matching_threshold: マッチングの最小閾値
            frame_rate: 動画のフレームレート (fps)
        """
        # supervision 0.18.0+ uses different parameter names
        self.tracker = sv.ByteTrack(
            track_thresh=track_activation_threshold,
            track_buffer=lost_track_buffer,
            match_thresh=minimum_matching_threshold,
            frame_rate=frame_rate
        )
        self.frame_rate = frame_rate
        self.current_frame = 0

    def reset(self):
        """トラッカーをリセット"""
        self.tracker.reset()
        self.current_frame = 0

    def update(
        self,
        detections: List[Detection],
        frame_number: Optional[int] = None
    ) -> List[TrackedDetection]:
        """
        検出結果を更新してトラッキング結果を取得

        Args:
            detections: 検出結果のリスト
            frame_number: フレーム番号 (Noneの場合は内部カウンターを使用)

        Returns:
            トラックID付きの検出結果リスト
        """
        if frame_number is not None:
            self.current_frame = frame_number
        else:
            self.current_frame += 1

        # タイムスタンプを計算
        timestamp = self.current_frame / self.frame_rate

        # supervisionの形式に変換
        # 仮想的なフレームサイズを使用 (1920x1080)
        frame_width, frame_height = 1920, 1080

        if not detections:
            # 検出がない場合でも更新してトラック状態を維持
            sv_detections = sv.Detections.empty()
        else:
            # バウンディングボックスを非正規化 (supervisionはピクセル座標を期待)
            xyxy = []
            confidences = []
            class_ids = []

            for det in detections:
                x, y, w, h = det.bbox
                # 正規化座標 → ピクセル座標
                x1 = x * frame_width
                y1 = y * frame_height
                x2 = (x + w) * frame_width
                y2 = (y + h) * frame_height

                xyxy.append([x1, y1, x2, y2])
                confidences.append(det.confidence)
                class_ids.append(det.class_id)

            # Explicit dtypes for supervision compatibility
            sv_detections = sv.Detections(
                xyxy=np.array(xyxy, dtype=np.float32),
                confidence=np.array(confidences, dtype=np.float32),
                class_id=np.array(class_ids, dtype=np.int32)
            )

        # ByteTrackで更新
        try:
            tracked = self.tracker.update_with_detections(sv_detections)
        except Exception as e:
            print(f"ByteTrack update failed: {e}")
            return []

        # 結果を変換
        tracked_detections = []

        # Check if tracker_id exists and has elements
        if tracked.tracker_id is None or len(tracked.xyxy) == 0:
            return tracked_detections

        # Create class_id to class_name mapping
        class_id_to_name = {0: "person", 32: "sports ball"}

        for i in range(len(tracked.xyxy)):
            # Safely get tracker_id
            if tracked.tracker_id is None or i >= len(tracked.tracker_id):
                continue

            tracker_id_val = tracked.tracker_id[i]
            if tracker_id_val is None:
                continue

            track_id = f"track_{int(tracker_id_val)}"
            x1, y1, x2, y2 = tracked.xyxy[i]

            # ピクセル座標 → 正規化座標
            x_norm = x1 / frame_width
            y_norm = y1 / frame_height
            w_norm = (x2 - x1) / frame_width
            h_norm = (y2 - y1) / frame_height

            # 中心点を計算
            center_x = x_norm + w_norm / 2
            center_y = y_norm + h_norm / 2

            # Get class_name from tracked object's class_id (not index correlation)
            class_name = "person"  # Default
            if tracked.class_id is not None and i < len(tracked.class_id):
                class_id_val = int(tracked.class_id[i])
                class_name = class_id_to_name.get(class_id_val, "person")

            # Safely get confidence
            confidence = 0.0
            if tracked.confidence is not None and i < len(tracked.confidence):
                confidence = float(tracked.confidence[i])

            tracked_det = TrackedDetection(
                track_id=track_id,
                frame_number=self.current_frame,
                timestamp=timestamp,
                bbox=(x_norm, y_norm, w_norm, h_norm),
                center=(center_x, center_y),
                confidence=confidence,
                class_name=class_name
            )
            tracked_detections.append(tracked_det)

        return tracked_detections


class MultiClassTracker:
    """複数クラスを個別にトラッキングする"""

    def __init__(
        self,
        frame_rate: int = 30,
        player_config: Optional[Dict] = None,
        ball_config: Optional[Dict] = None
    ):
        """
        Args:
            frame_rate: 動画のフレームレート
            player_config: 選手トラッカーの設定
            ball_config: ボールトラッカーの設定
        """
        # デフォルト設定
        default_player_config = {
            "track_activation_threshold": 0.3,
            "lost_track_buffer": 30,
            "minimum_matching_threshold": 0.8
        }
        default_ball_config = {
            "track_activation_threshold": 0.25,
            "lost_track_buffer": 10,
            "minimum_matching_threshold": 0.7
        }

        player_config = player_config or default_player_config
        ball_config = ball_config or default_ball_config

        # 選手用トラッカー
        self.player_tracker = ObjectTracker(
            frame_rate=frame_rate,
            **player_config
        )

        # ボール用トラッカー
        self.ball_tracker = ObjectTracker(
            frame_rate=frame_rate,
            **ball_config
        )

    def reset(self):
        """すべてのトラッカーをリセット"""
        self.player_tracker.reset()
        self.ball_tracker.reset()

    def update(
        self,
        detections: List[Detection],
        frame_number: Optional[int] = None
    ) -> Dict[str, List[TrackedDetection]]:
        """
        検出結果を更新してトラッキング結果を取得

        Args:
            detections: 検出結果のリスト
            frame_number: フレーム番号

        Returns:
            {"players": [...], "ball": [...]}
        """
        # クラスごとに分離
        player_detections = [d for d in detections if d.class_name == "person"]
        ball_detections = [d for d in detections if d.class_name == "sports ball"]

        # それぞれトラッキング
        tracked_players = self.player_tracker.update(player_detections, frame_number)
        tracked_balls = self.ball_tracker.update(ball_detections, frame_number)

        return {
            "players": tracked_players,
            "ball": tracked_balls
        }


def create_tracker(
    frame_rate: int = 30,
    multi_class: bool = True
) -> ObjectTracker | MultiClassTracker:
    """
    便利なトラッカー作成関数

    Args:
        frame_rate: 動画のフレームレート
        multi_class: 複数クラスを個別にトラッキングするか

    Returns:
        トラッカーインスタンス
    """
    if multi_class:
        return MultiClassTracker(frame_rate=frame_rate)
    else:
        return ObjectTracker(frame_rate=frame_rate)


if __name__ == "__main__":
    # テスト用コード
    print("Tracker module loaded successfully")

    # 使用例
    tracker = create_tracker(frame_rate=30, multi_class=True)

    # サンプル検出結果
    sample_detections = [
        Detection(
            bbox=(0.1, 0.2, 0.05, 0.1),
            confidence=0.95,
            class_id=0,
            class_name="person"
        ),
        Detection(
            bbox=(0.5, 0.5, 0.02, 0.02),
            confidence=0.8,
            class_id=32,
            class_name="sports ball"
        )
    ]

    # トラッキング
    result = tracker.update(sample_detections, frame_number=0)
    print(f"Players tracked: {len(result['players'])}")
    print(f"Balls tracked: {len(result['ball'])}")
