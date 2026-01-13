"""
YOLOv8による選手・ボール検出モジュール

入力: フレーム画像 (numpy array)
出力: List[Detection] (bbox, confidence, class_id)
クラス: person (選手), sports ball (ボール)
"""

from dataclasses import dataclass
from typing import List, Optional, Tuple
import numpy as np
from ultralytics import YOLO


@dataclass
class Detection:
    """検出結果を表すデータクラス"""

    bbox: Tuple[float, float, float, float]  # (x, y, w, h) in normalized coordinates (0-1)
    confidence: float  # 0-1
    class_id: int  # COCO class ID
    class_name: str  # "person" or "sports ball"


class PlayerBallDetector:
    """YOLOv8を使用した選手・ボール検出器"""

    # COCO dataset class IDs
    PERSON_CLASS_ID = 0
    SPORTS_BALL_CLASS_ID = 32

    def __init__(
        self,
        model_path: str = "yolov8n.pt",
        conf_threshold: float = 0.3,
        iou_threshold: float = 0.5,
        device: str = "cpu"
    ):
        """
        Args:
            model_path: YOLOモデルファイルパス (yolov8n.pt, yolov8s.pt, etc.)
            conf_threshold: 信頼度閾値 (0-1)
            iou_threshold: IoU閾値 (NMS用)
            device: 使用デバイス ("cpu", "cuda", "mps")

        Raises:
            RuntimeError: モデルのロードに失敗した場合
        """
        try:
            self.model = YOLO(model_path)
        except Exception as e:
            raise RuntimeError(f"Failed to load YOLO model from {model_path}: {e}") from e

        self.conf_threshold = conf_threshold
        self.iou_threshold = iou_threshold
        self.device = device

        # 検出対象クラスを制限
        self.target_classes = [self.PERSON_CLASS_ID, self.SPORTS_BALL_CLASS_ID]

    def detect(
        self,
        frame: np.ndarray,
        detect_players: bool = True,
        detect_ball: bool = True,
        conf_threshold: Optional[float] = None
    ) -> List[Detection]:
        """
        フレーム内の選手とボールを検出

        Args:
            frame: 入力フレーム (numpy array, BGR format)
            detect_players: 選手を検出するか
            detect_ball: ボールを検出するか
            conf_threshold: 信頼度閾値（Noneの場合はインスタンスのデフォルト値を使用）

        Returns:
            検出結果のリスト
        """
        # 検出対象クラスを決定
        classes = []
        if detect_players:
            classes.append(self.PERSON_CLASS_ID)
        if detect_ball:
            classes.append(self.SPORTS_BALL_CLASS_ID)

        if not classes:
            return []

        # フレームのバリデーション
        if frame is None or not isinstance(frame, np.ndarray):
            raise ValueError("Frame must be a valid numpy array")
        if len(frame.shape) < 2:
            raise ValueError(f"Frame must have at least 2 dimensions, got shape {frame.shape}")

        # フレームサイズを取得
        height, width = frame.shape[:2]

        # 使用する閾値を決定（パラメータ優先）
        effective_conf = conf_threshold if conf_threshold is not None else self.conf_threshold

        # YOLOv8で推論
        results = self.model.predict(
            frame,
            conf=effective_conf,
            iou=self.iou_threshold,
            classes=classes,
            device=self.device,
            verbose=False
        )

        # 結果を変換
        detections = []
        for result in results:
            boxes = result.boxes
            for box in boxes:
                # バウンディングボックス (xyxy形式)
                x1, y1, x2, y2 = box.xyxy[0].cpu().numpy()

                # 正規化座標に変換 (0-1)、Python floatに変換
                x_norm = float(x1 / width)
                y_norm = float(y1 / height)
                w_norm = float((x2 - x1) / width)
                h_norm = float((y2 - y1) / height)

                # 信頼度とクラスID
                confidence = float(box.conf[0])
                class_id = int(box.cls[0])

                # クラス名を取得
                class_name = self.model.names[class_id]

                detection = Detection(
                    bbox=(x_norm, y_norm, w_norm, h_norm),
                    confidence=confidence,
                    class_id=class_id,
                    class_name=class_name
                )
                detections.append(detection)

        return detections

    def detect_players(self, frame: np.ndarray) -> List[Detection]:
        """選手のみを検出"""
        return self.detect(frame, detect_players=True, detect_ball=False)

    def detect_ball(self, frame: np.ndarray) -> List[Detection]:
        """ボールのみを検出"""
        return self.detect(frame, detect_players=False, detect_ball=True)

    def filter_by_class(
        self,
        detections: List[Detection],
        class_name: str
    ) -> List[Detection]:
        """特定クラスの検出結果のみを抽出"""
        return [d for d in detections if d.class_name == class_name]

    def filter_by_confidence(
        self,
        detections: List[Detection],
        min_confidence: float
    ) -> List[Detection]:
        """信頼度による検出結果のフィルタリング"""
        return [d for d in detections if d.confidence >= min_confidence]

    def get_highest_confidence_ball(
        self,
        detections: List[Detection]
    ) -> Optional[Detection]:
        """
        最も信頼度の高いボール検出結果を取得

        Returns:
            最も信頼度の高いボール検出、見つからない場合はNone
        """
        ball_detections = self.filter_by_class(detections, "sports ball")
        if not ball_detections:
            return None
        return max(ball_detections, key=lambda d: d.confidence)


def create_detector(
    model_size: str = "n",
    conf_threshold: float = 0.3,
    device: str = "cpu"
) -> PlayerBallDetector:
    """
    便利な検出器作成関数

    Args:
        model_size: モデルサイズ ("n", "s", "m", "l", "x")
        conf_threshold: 信頼度閾値
        device: 使用デバイス

    Returns:
        PlayerBallDetectorインスタンス
    """
    model_path = f"yolov8{model_size}.pt"
    return PlayerBallDetector(
        model_path=model_path,
        conf_threshold=conf_threshold,
        device=device
    )


if __name__ == "__main__":
    # テスト用コード
    import cv2

    # 検出器を作成
    detector = create_detector(model_size="n", conf_threshold=0.3)

    # テスト画像を読み込み (実際のパスに変更してください)
    # frame = cv2.imread("test_frame.jpg")
    # detections = detector.detect(frame)
    #
    # print(f"Detected {len(detections)} objects:")
    # for det in detections:
    #     print(f"  {det.class_name}: confidence={det.confidence:.2f}, bbox={det.bbox}")

    print("Detector module loaded successfully")
