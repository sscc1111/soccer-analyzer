# Firebase Rules Test Execution Guide

## 前提条件の確認

### 1. Java環境の確認
```bash
java -version
```

もし表示されない場合:
```bash
# macOS
brew install openjdk@17

# Linux (Ubuntu/Debian)
sudo apt install openjdk-17-jre
```

### 2. Firebase CLIの確認
```bash
firebase --version
```

もし表示されない場合:
```bash
npm install -g firebase-tools
```

### 3. 依存関係のインストール
```bash
# プロジェクトルートから
pnpm install
```

## テスト実行手順

### ステップ1: Firebase Emulatorの起動

別のターミナルウィンドウで実行:
```bash
# プロジェクトルートから
firebase emulators:start --only firestore
```

または、便利なチェックスクリプトを使用:
```bash
cd infra
./scripts/check-emulator.sh
```

Emulatorが起動すると、以下のような出力が表示されます:
```
✔  firestore: Emulator started at http://127.0.0.1:8080
```

### ステップ2: テストの実行

別のターミナルで:
```bash
cd infra
pnpm test
```

または、ワンタイムで実行:
```bash
cd infra
pnpm test:rules
```

## テスト実行モード

### 1. 通常実行
```bash
pnpm test:rules
```

### 2. ウォッチモード（開発時）
```bash
pnpm test:watch
```

### 3. 特定のテストファイルのみ実行
```bash
pnpm test __tests__/firebase.rules.test.ts
```

### 4. 特定のテストケースのみ実行
```bash
pnpm test -t "owner can read their match"
```

## トラブルシューティング

### エラー: ECONNREFUSED 127.0.0.1:8080

**原因**: Firebase Emulatorが起動していない

**解決策**:
1. Emulatorが起動していることを確認
2. ポート8080が使用中でないか確認: `lsof -i :8080`
3. Emulatorを再起動

### エラー: Java is not installed

**原因**: Java Runtime Environmentが未インストール

**解決策**:
```bash
# macOS
brew install openjdk@17

# Java PATHを設定
echo 'export PATH="/opt/homebrew/opt/openjdk@17/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

### エラー: Cannot find module '@firebase/rules-unit-testing'

**原因**: 依存関係が正しくインストールされていない

**解決策**:
```bash
# プロジェクトルートから
pnpm install
```

### テストがタイムアウトする

**原因**: Emulatorの応答が遅い、またはテストが複雑すぎる

**解決策**:
1. `vitest.config.ts`で`testTimeout`を調整:
   ```typescript
   export default defineConfig({
     test: {
       testTimeout: 60000, // 60秒に延長
     },
   });
   ```

2. Emulatorを再起動
3. システムリソースを確認

## CI/CD環境でのテスト実行

GitHub Actionsの例:
```yaml
name: Test Firebase Rules

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Setup Java
        uses: actions/setup-java@v4
        with:
          distribution: 'temurin'
          java-version: '17'

      - name: Install pnpm
        uses: pnpm/action-setup@v2
        with:
          version: 9

      - name: Install dependencies
        run: pnpm install

      - name: Install Firebase CLI
        run: npm install -g firebase-tools

      - name: Start Firebase Emulators
        run: |
          firebase emulators:start --only firestore --project demo-test &
          sleep 10

      - name: Run tests
        run: |
          cd infra
          pnpm test:rules

      - name: Stop Emulators
        if: always()
        run: pkill -f firebase-tools || true
```

## テスト結果の確認

### 成功時の出力例
```
✓ __tests__/firebase.rules.test.ts (36)
  ✓ Firestore Security Rules (36)
    ✓ matches collection (12)
      ✓ read operations (3)
        ✓ owner can read their match
        ✓ non-owner cannot read match
        ✓ unauthenticated user cannot read match
      ✓ create operations (3)
      ✓ update operations (3)
      ✓ delete operations (3)
    ✓ matches subcollections (12)
    ✓ jobs collection (5)
    ✓ users collection (7)

Test Files  1 passed (1)
     Tests  36 passed (36)
```

### 失敗時の対応

テストが失敗した場合、以下を確認:

1. **ルールの記述が正しいか**: `infra/firebase.rules`を確認
2. **テストケースが正確か**: 期待される動作と実際の動作を比較
3. **Emulatorが正しく動作しているか**: Emulatorのログを確認

## 参考リンク

- [Firebase Rules Unit Testing](https://firebase.google.com/docs/rules/unit-tests)
- [Vitest Documentation](https://vitest.dev/)
- [Firebase Emulator Suite](https://firebase.google.com/docs/emulator-suite)
