# Infrastructure Tests

Firebase Firestore Security Rulesのテストスイート。

## 概要

このディレクトリには、Firestore Security Rulesの動作を検証するテストが含まれています。
`@firebase/rules-unit-testing` を使用して、ルールが期待通りに機能することを保証します。

## セットアップ

### 前提条件

- Node.js 18以上
- Java Runtime Environment (JRE) 11以上
- Firebase Emulator Suite

#### Javaのインストール

macOS:
```bash
brew install openjdk@17
```

または、[Oracle JDK](https://www.oracle.com/java/technologies/downloads/)をダウンロード

インストール確認:
```bash
java -version
```

#### Firebase Emulatorのインストール

```bash
npm install -g firebase-tools
```

### 依存関係のインストール

```bash
cd infra
pnpm install
```

## テストの実行

### Firebase Emulatorの起動

別のターミナルでEmulatorを起動:
```bash
firebase emulators:start --only firestore
```

または、プロジェクトルートから:
```bash
firebase emulators:start
```

### テスト実行

```bash
# すべてのテストを実行
pnpm test:rules

# ウォッチモード
pnpm test:watch

# 通常のvitestコマンド
pnpm test
```

## テスト構成

### テストファイル構造

```
infra/
├── __tests__/
│   └── firebase.rules.test.ts    # メインテストファイル
├── firebase.rules                # テスト対象のルール
├── package.json
├── vitest.config.ts
└── test-setup.ts
```

### テスト対象のルール

#### 1. matchesコレクション
- オーナー（ownerUid一致）のみが読み書き可能
- 認証必須
- 作成時は自分自身をownerに設定する必要がある

#### 2. matchesサブコレクション
- `matches/{matchId}/tracks/{trackId}`
- `matches/{matchId}/passEvents/{eventId}`
- `matches/{matchId}/pendingReviews/{reviewId}`
- `matches/{matchId}/stats/{statId}`
- すべてマッチのオーナーのみアクセス可能

#### 3. jobsコレクション
- 認証ユーザーは読み取り可能
- クライアントからの書き込みは不可（Cloud Functionsのみ）

#### 4. usersコレクション
- 自分自身のドキュメントのみ読み書き可能
- サブコレクションも同様

## テストカバレッジ

各コレクションに対して以下のテストケースを実施:

- ✅ 正常系: 権限のあるユーザーの操作
- ❌ 異常系: 権限のないユーザーの操作
- ❌ 未認証: 認証なしの操作

### テスト数

- matchesコレクション: 12テスト
- matchesサブコレクション: 12テスト (各サブコレクション3テスト × 4)
- jobsコレクション: 5テスト
- usersコレクション: 7テスト

合計: 36テスト

## トラブルシューティング

### Emulatorに接続できない

エラー: `ECONNREFUSED 127.0.0.1:8080`

解決策:
1. Firebase Emulatorが起動していることを確認
2. ポート8080が使用可能か確認
3. `firebase emulators:start --only firestore` を実行

### テストがタイムアウトする

`vitest.config.ts` の `testTimeout` を調整:
```typescript
export default defineConfig({
  test: {
    testTimeout: 30000, // 30秒に設定済み
  },
});
```

### ルールの変更がテストに反映されない

1. テスト環境を再起動
2. Emulatorを再起動
3. キャッシュをクリア: `pnpm test:rules --no-cache`

## CI/CDでの実行

GitHub ActionsなどのCI環境では、Emulatorを自動で起動する必要があります:

```yaml
- name: Install Firebase Tools
  run: npm install -g firebase-tools

- name: Start Emulators
  run: firebase emulators:start --only firestore &

- name: Wait for Emulators
  run: sleep 10

- name: Run Tests
  run: cd infra && pnpm test:rules
```

## 参考資料

- [Firebase Rules Unit Testing](https://firebase.google.com/docs/rules/unit-tests)
- [Firestore Security Rules](https://firebase.google.com/docs/firestore/security/get-started)
- [Vitest Documentation](https://vitest.dev/)
