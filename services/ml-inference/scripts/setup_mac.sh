#!/bin/bash
# M1/M2/M3 Mac用セットアップスクリプト

set -e

echo "🍎 Setting up ML Inference Service for Apple Silicon..."

cd "$(dirname "$0")/.."

# Python仮想環境作成
if [ ! -d "venv" ]; then
    echo "📦 Creating virtual environment..."
    python3 -m venv venv
fi

# 仮想環境有効化
source venv/bin/activate

# pip更新
pip install --upgrade pip

# PyTorch (MPS対応版) インストール
echo "🔧 Installing PyTorch with MPS support..."
pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu

# その他の依存関係インストール
echo "📥 Installing dependencies..."
pip install ultralytics supervision fastapi uvicorn opencv-python-headless numpy tqdm python-multipart

# MPS動作確認
echo "🧪 Verifying MPS availability..."
python3 -c "
import torch
print(f'PyTorch version: {torch.__version__}')
print(f'MPS available: {torch.backends.mps.is_available()}')
print(f'MPS built: {torch.backends.mps.is_built()}')
if torch.backends.mps.is_available():
    print('✅ MPS is ready!')
else:
    print('⚠️ MPS not available, will use CPU')
"

echo ""
echo "✅ Setup complete!"
echo ""
echo "To start the ML service:"
echo "  source venv/bin/activate"
echo "  python src/api.py"
echo ""
echo "To test with a video:"
echo "  python src/test_example.py /path/to/video.mp4"
