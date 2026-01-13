#!/bin/bash

# Firebase Emulator起動チェックスクリプト

set -e

echo "🔍 Checking prerequisites..."

# Java確認
if ! command -v java &> /dev/null; then
    echo "❌ Java is not installed"
    echo "   Please install Java 11 or higher:"
    echo "   macOS: brew install openjdk@17"
    echo "   Linux: sudo apt install openjdk-17-jre"
    exit 1
fi

echo "✓ Java found: $(java -version 2>&1 | head -n 1)"

# Firebase CLI確認
if ! command -v firebase &> /dev/null; then
    echo "❌ Firebase CLI is not installed"
    echo "   Install with: npm install -g firebase-tools"
    exit 1
fi

echo "✓ Firebase CLI found: $(firebase --version)"

# Emulator起動
echo ""
echo "🚀 Starting Firebase Emulator..."
firebase emulators:start --only firestore --project soccer-analyzer-test &
EMULATOR_PID=$!

# 起動待機
echo "⏳ Waiting for emulator to be ready..."
for i in {1..30}; do
    if curl -s http://127.0.0.1:8080 > /dev/null 2>&1; then
        echo "✓ Emulator is ready!"
        echo ""
        echo "You can now run tests with:"
        echo "  cd infra && pnpm test"
        exit 0
    fi
    sleep 1
done

echo "❌ Emulator failed to start within 30 seconds"
kill $EMULATOR_PID 2>/dev/null || true
exit 1
