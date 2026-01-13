"""
テスト用サンプルスクリプト

使用方法:
    python test_example.py <video_path>
"""

import sys
import time
from pathlib import Path

import cv2
import numpy as np

from detector import create_detector
from tracker import create_tracker
from pipeline import process_video_file, PipelineConfig


def test_detector(video_path: str):
    """検出器のテスト"""
    print("\n=== Testing Detector ===")

    # 検出器を作成
    detector = create_detector(model_size="n", conf_threshold=0.3)

    # 動画を開く
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        print(f"Failed to open video: {video_path}")
        return

    # 最初のフレームで検出
    ret, frame = cap.read()
    if not ret:
        print("Failed to read frame")
        cap.release()
        return

    # 検出実行
    start_time = time.time()
    detections = detector.detect(frame)
    elapsed_time = time.time() - start_time

    print(f"Detection time: {elapsed_time:.3f} seconds")
    print(f"Detected {len(detections)} objects:")

    for det in detections:
        print(f"  - {det.class_name}: confidence={det.confidence:.2f}, bbox={det.bbox}")

    cap.release()


def test_tracker(video_path: str, max_frames: int = 100):
    """トラッカーのテスト"""
    print("\n=== Testing Tracker ===")

    # 検出器とトラッカーを作成
    detector = create_detector(model_size="n", conf_threshold=0.3)
    tracker = create_tracker(frame_rate=30, multi_class=True)

    # 動画を開く
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        print(f"Failed to open video: {video_path}")
        return

    frame_number = 0
    start_time = time.time()

    while cap.isOpened() and frame_number < max_frames:
        ret, frame = cap.read()
        if not ret:
            break

        # 検出
        detections = detector.detect(frame)

        # トラッキング
        result = tracker.update(detections, frame_number)

        if frame_number % 10 == 0:
            print(f"Frame {frame_number}: {len(result['players'])} players, {len(result['ball'])} balls")

        frame_number += 1

    elapsed_time = time.time() - start_time
    fps = frame_number / elapsed_time if elapsed_time > 0 else 0

    print(f"\nProcessed {frame_number} frames in {elapsed_time:.2f} seconds")
    print(f"Average FPS: {fps:.2f}")

    cap.release()


def test_pipeline(video_path: str, output_path: str = "test_output.json"):
    """パイプラインのテスト"""
    print("\n=== Testing Pipeline ===")

    # 設定
    config = PipelineConfig(
        model_size="n",
        conf_threshold=0.3,
        device="cpu",
        frame_rate=30,
        max_frames=100  # テストなので100フレームまで
    )

    # 処理実行
    start_time = time.time()
    result = process_video_file(
        video_path=video_path,
        output_path=output_path,
        config=config
    )
    elapsed_time = time.time() - start_time

    print(f"\nPipeline completed in {elapsed_time:.2f} seconds")
    print(f"Results saved to: {output_path}")
    print(f"\nSummary:")
    print(f"  - Processed frames: {result.metadata['processedFrames']}")
    print(f"  - Total tracks: {len(result.tracks)}")
    print(f"  - Ball detections: {len(result.ball)}")
    print(f"  - Video dimensions: {result.metadata['width']}x{result.metadata['height']}")
    print(f"  - FPS: {result.metadata['fps']}")

    # トラックの詳細を表示
    print(f"\nTrack details:")
    for i, track in enumerate(result.tracks[:5]):  # 最初の5トラックのみ表示
        print(f"  Track {i+1} ({track.trackId}): {len(track.frames)} frames")


def main():
    """メイン関数"""
    if len(sys.argv) < 2:
        print("Usage: python test_example.py <video_path>")
        print("\nExample:")
        print("  python test_example.py /path/to/video.mp4")
        sys.exit(1)

    video_path = sys.argv[1]

    if not Path(video_path).exists():
        print(f"Error: Video file not found: {video_path}")
        sys.exit(1)

    print(f"Testing with video: {video_path}")

    # 各モジュールをテスト
    test_detector(video_path)
    test_tracker(video_path, max_frames=100)
    test_pipeline(video_path, output_path="test_output.json")

    print("\n=== All tests completed ===")


if __name__ == "__main__":
    main()
