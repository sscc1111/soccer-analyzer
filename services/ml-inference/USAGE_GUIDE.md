# ML Inference Service - 使用ガイド

## 作成されたファイル

以下のファイルが `/Users/fujiwarakazuma/Works/soccer-analyzer/services/ml-inference/src/` に作成されました：

### コアモジュール

1. **detector.py** (6.0 KB)
   - YOLOv8による選手・ボール検出
   - クラス: `PlayerBallDetector`, `Detection`
   - 関数: `create_detector()`

2. **tracker.py** (8.4 KB)
   - ByteTrackによるトラッキング
   - クラス: `ObjectTracker`, `MultiClassTracker`, `TrackedDetection`
   - 関数: `create_tracker()`

3. **pipeline.py** (12 KB)
   - 統合パイプライン
   - クラス: `TrackingPipeline`, `PipelineConfig`, `PipelineResult`
   - 関数: `process_video_file()`

4. **api.py** (11 KB)
   - FastAPI REST API
   - エンドポイント: `/health`, `/detect`, `/track`

### サポートファイル

5. **__init__.py** (981 B)
   - パッケージ初期化
   - 公開API定義

6. **test_example.py** (4.3 KB)
   - テスト用サンプルスクリプト
   - 各モジュールの動作確認

## クイックスタート

### 1. 環境セットアップ

```bash
cd /Users/fujiwarakazuma/Works/soccer-analyzer/services/ml-inference

# 依存関係をインストール
pip install -r requirements.txt
```

### 2. 動作確認

```bash
# テストスクリプトを実行 (動画ファイルが必要)
python src/test_example.py /path/to/your/video.mp4
```

### 3. API サーバー起動

```bash
# サーバーを起動
python src/api.py

# または
uvicorn src.api:app --host 0.0.0.0 --port 8080
```

### 4. API テスト

```bash
# ヘルスチェック
curl http://localhost:8080/health

# 画像検出
curl -X POST http://localhost:8080/detect \
  -F "image=@frame.jpg" \
  -F "conf_threshold=0.3"

# 動画トラッキング
curl -X POST http://localhost:8080/track \
  -F "video=@video.mp4" \
  -F 'config={"modelSize":"n","confThreshold":0.3}'
```

## モジュール詳細

### detector.py

**主要クラス:**
- `Detection`: 検出結果を表すデータクラス
  - `bbox`: バウンディングボックス (x, y, w, h) 正規化座標
  - `confidence`: 信頼度 (0-1)
  - `class_id`: COCOクラスID
  - `class_name`: "person" または "sports ball"

- `PlayerBallDetector`: YOLOv8検出器
  - `detect()`: フレーム内の検出実行
  - `detect_players()`: 選手のみ検出
  - `detect_ball()`: ボールのみ検出

**使用例:**
```python
from src.detector import create_detector
import cv2

detector = create_detector(model_size="n", conf_threshold=0.3)
frame = cv2.imread("frame.jpg")
detections = detector.detect(frame)

for det in detections:
    print(f"{det.class_name}: {det.confidence:.2f}")
```

### tracker.py

**主要クラス:**
- `TrackedDetection`: トラックID付き検出結果
  - `track_id`: "track_0", "track_1", etc.
  - `frame_number`: フレーム番号
  - `timestamp`: タイムスタンプ (秒)
  - `bbox`: バウンディングボックス
  - `center`: 中心点座標
  - `confidence`: 信頼度

- `MultiClassTracker`: 複数クラス対応トラッカー
  - `update()`: フレーム更新とトラッキング
  - `reset()`: トラッカーリセット

**使用例:**
```python
from src.tracker import create_tracker

tracker = create_tracker(frame_rate=30, multi_class=True)

# 各フレームで更新
result = tracker.update(detections, frame_number=0)

# 結果を確認
print(f"Players: {len(result['players'])}")
print(f"Balls: {len(result['ball'])}")
```

### pipeline.py

**主要クラス:**
- `PipelineConfig`: パイプライン設定
  - `model_size`: YOLOモデルサイズ ("n", "s", "m", "l", "x")
  - `conf_threshold`: 信頼度閾値 (0-1)
  - `device`: デバイス ("cpu", "cuda", "mps")
  - `frame_rate`: フレームレート
  - `skip_frames`: スキップフレーム数
  - `max_frames`: 最大処理フレーム数

- `TrackingPipeline`: 動画処理パイプライン
  - `process_video()`: 動画を処理
  - `save_result()`: 結果をJSON保存
  - `load_result()`: JSONから結果読み込み

**使用例:**
```python
from src.pipeline import process_video_file, PipelineConfig

config = PipelineConfig(
    model_size="n",
    conf_threshold=0.3,
    device="cpu",
    frame_rate=30
)

result = process_video_file(
    video_path="input.mp4",
    output_path="output.json",
    config=config
)

print(f"Tracks: {len(result.tracks)}")
print(f"Ball detections: {len(result.ball)}")
```

### api.py

**エンドポイント:**

1. `GET /health`
   - ヘルスチェック
   - レスポンス: サーバーステータス

2. `POST /detect`
   - 単一フレーム検出
   - パラメータ:
     - `image`: 画像ファイル (JPEG, PNG)
     - `conf_threshold`: 信頼度閾値 (0-1)
     - `detect_players`: 選手を検出 (bool)
     - `detect_ball`: ボールを検出 (bool)
   - レスポンス: 検出結果リスト

3. `POST /track`
   - 動画トラッキング (非同期)
   - パラメータ:
     - `video`: 動画ファイル (MP4, AVI, MOV)
     - `config`: トラッキング設定 (JSON)
   - レスポンス: ジョブID

4. `GET /track/{job_id}`
   - ジョブステータス確認
   - レスポンス: ステータスと結果

## 出力形式

トラッキング結果のJSON形式:

```json
{
  "tracks": [
    {
      "trackId": "track_0",
      "frames": [
        {
          "frameNumber": 0,
          "timestamp": 0.0,
          "bbox": {"x": 0.1, "y": 0.2, "w": 0.05, "h": 0.1},
          "center": {"x": 0.125, "y": 0.25},
          "confidence": 0.95
        }
      ]
    }
  ],
  "ball": [
    {
      "frameNumber": 0,
      "timestamp": 0.0,
      "position": {"x": 0.5, "y": 0.5},
      "confidence": 0.85,
      "visible": true
    }
  ],
  "metadata": {
    "videoPath": "input.mp4",
    "totalFrames": 1000,
    "processedFrames": 1000,
    "fps": 30.0,
    "width": 1920,
    "height": 1080,
    "modelSize": "n",
    "confThreshold": 0.3,
    "tracksCount": 10,
    "ballDetectionsCount": 800
  }
}
```

## 型定義との対応

このサービスの出力は、`packages/shared/src/domain/tracking.ts` で定義された型と互換性があります：

- `bbox` → `BoundingBox`
- `center` / `position` → `Point2D`
- `tracks[].frames[]` → `TrackFrame[]`
- `ball[]` → `BallDetection[]`

## パフォーマンス

### モデルサイズの選択

| モデル | 速度 (CPU) | 速度 (GPU) | 用途 |
|--------|-----------|-----------|------|
| yolov8n | 最速 | 最速 | リアルタイム処理、プロトタイプ |
| yolov8s | 速い | 速い | バランス重視 |
| yolov8m | 中程度 | 中程度 | 精度重視 |
| yolov8l | 遅い | 速い | 高精度処理 |
| yolov8x | 最遅 | 中程度 | 最高精度 |

### 推奨設定

- **開発・テスト**: `model_size="n"`, `device="cpu"`
- **プロダクション (CPU)**: `model_size="n"`, `skip_frames=1`
- **プロダクション (GPU)**: `model_size="m"`, `device="cuda"`

## トラブルシューティング

### YOLOモデルのダウンロードエラー

```bash
# 手動でダウンロード
python -c "from ultralytics import YOLO; YOLO('yolov8n.pt')"
```

### OpenCVのインポートエラー

```bash
# システムライブラリをインストール (Ubuntu/Debian)
sudo apt-get install libgl1-mesa-glx libglib2.0-0

# または headless版を使用
pip install opencv-python-headless
```

### GPU が認識されない

```bash
# PyTorch CUDA版をインストール
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu118

# MPS (Apple Silicon) を使用
config.device = "mps"
```

## 次のステップ

1. **チーム分類の追加** (Phase 1.2)
   - ユニフォーム色検出
   - チームID割り当て

2. **ジャージ番号認識** (Phase 1.4)
   - OCRによる番号検出
   - プレイヤーマッピング

3. **イベント検出** (Phase 2)
   - パス検出
   - シュート検出
   - タックル検出

## サポート

問題が発生した場合は、以下を確認してください：

1. `requirements.txt` の依存関係がすべてインストールされているか
2. 動画ファイルが正しい形式 (MP4, AVI, MOV) か
3. Python バージョンが 3.8 以上か
4. 十分なメモリ (最低 4GB 推奨) があるか
