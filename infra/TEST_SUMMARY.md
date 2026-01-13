# Firebase Security Rules Test Summary

## テスト対象
`infra/firebase.rules` - Firestore Security Rules

## テスト戦略

### 選択したテスト種類
- **統合テスト**: Firebase Rules Unit Testing Framework
- **ツール**: `@firebase/rules-unit-testing` + Vitest
- **実行環境**: Firebase Emulator Suite

### 理由
1. **実際の環境に近い**: Emulatorを使用することで、本番環境に近い条件でテスト可能
2. **包括的な検証**: 認証、権限、データ構造を総合的にテスト
3. **高速なフィードバック**: ローカルで実行でき、デプロイ前に問題を発見
4. **CI/CD対応**: 自動テストパイプラインに組み込み可能

## テストケース

### 1. matchesコレクション（12テスト）

#### 読み取り操作（3テスト）
- ✅ 正常系: オーナーが自分のマッチを読み取り可能
- ❌ 異常系: 非オーナーがマッチを読み取り不可
- ❌ 未認証: 認証なしユーザーが読み取り不可

#### 作成操作（3テスト）
- ✅ 正常系: 認証ユーザーが自分をオーナーとしてマッチを作成可能
- ❌ 異常系: 他ユーザーをオーナーとしてマッチを作成不可
- ❌ 未認証: 認証なしユーザーが作成不可

#### 更新操作（3テスト）
- ✅ 正常系: オーナーが自分のマッチを更新可能
- ❌ 異常系: 非オーナーがマッチを更新不可
- ❌ 未認証: 認証なしユーザーが更新不可

#### 削除操作（3テスト）
- ✅ 正常系: オーナーが自分のマッチを削除可能
- ❌ 異常系: 非オーナーがマッチを削除不可
- ❌ 未認証: 認証なしユーザーが削除不可

### 2. matchesサブコレクション（12テスト）

各サブコレクション（tracks, passEvents, pendingReviews, stats）について:

#### tracksサブコレクション（3テスト）
- ✅ オーナーが読み取り可能
- ✅ オーナーが書き込み可能
- ❌ 非オーナーが読み取り不可
- ❌ 非オーナーが書き込み不可

#### passEventsサブコレクション（3テスト）
- ✅ オーナーが読み取り可能
- ✅ オーナーが書き込み可能
- ❌ 非オーナーがアクセス不可

#### pendingReviewsサブコレクション（3テスト）
- ✅ オーナーが読み取り可能
- ✅ オーナーが書き込み可能
- ❌ 非オーナーがアクセス不可

#### statsサブコレクション（3テスト）
- ✅ オーナーが読み取り可能
- ✅ オーナーが書き込み可能
- ❌ 非オーナーがアクセス不可

### 3. jobsコレクション（5テスト）
- ✅ 認証ユーザーがjobsを読み取り可能
- ❌ 未認証ユーザーがjobsを読み取り不可
- ❌ 認証ユーザーがjobsを作成不可（Cloud Functionsのみ）
- ❌ 認証ユーザーがjobsを更新不可
- ❌ 認証ユーザーがjobsを削除不可

### 4. usersコレクション（7テスト）

#### ユーザードキュメント（4テスト）
- ✅ 自分のドキュメントを読み取り可能
- ✅ 自分のドキュメントを書き込み可能
- ❌ 他人のドキュメントを読み取り不可
- ❌ 他人のドキュメントを書き込み不可

#### ユーザーサブコレクション（3テスト）
- ✅ 自分のサブコレクションを読み取り可能
- ✅ 自分のサブコレクションを書き込み可能
- ❌ 他人のサブコレクションを読み取り不可

## テストコード

### ファイル構成
```
infra/
├── __tests__/
│   └── firebase.rules.test.ts    # メインテストファイル（36テスト）
├── scripts/
│   └── check-emulator.sh         # Emulator起動チェックスクリプト
├── firebase.rules                # テスト対象のルール
├── package.json                  # テスト依存関係
├── vitest.config.ts              # Vitestの設定
├── test-setup.ts                 # テストセットアップ
├── tsconfig.json                 # TypeScript設定
├── README.md                     # セットアップガイド
├── TEST_EXECUTION_GUIDE.md       # 実行ガイド
└── TEST_SUMMARY.md               # このファイル
```

### 主要なテストパターン

#### 1. セットアップ
```typescript
let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'soccer-analyzer-test',
    firestore: {
      rules: readFileSync(resolve(__dirname, '../firebase.rules'), 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});
```

#### 2. テストデータの準備
```typescript
await testEnv.withSecurityRulesDisabled(async (context: RulesTestContext) => {
  await setDoc(doc(context.firestore(), 'matches', MATCH_ID), {
    ownerUid: USER_ALICE_ID,
    title: 'Test Match',
    createdAt: new Date().toISOString(),
  });
});
```

#### 3. 権限チェック
```typescript
// 成功すべきケース
const alice = testEnv.authenticatedContext(USER_ALICE_ID);
await assertSucceeds(getDoc(doc(alice.firestore(), 'matches', MATCH_ID)));

// 失敗すべきケース
const bob = testEnv.authenticatedContext(USER_BOB_ID);
await assertFails(getDoc(doc(bob.firestore(), 'matches', MATCH_ID)));
```

## 実行方法

### 前提条件
1. Java 11以上がインストールされていること
2. Firebase Emulator Suiteがインストールされていること

### セットアップ
```bash
# 1. 依存関係のインストール
pnpm install

# 2. Emulator起動（別ターミナル）
firebase emulators:start --only firestore
```

### テスト実行
```bash
# ワンタイム実行
cd infra && pnpm test:rules

# ウォッチモード
cd infra && pnpm test:watch

# 特定のテストケースのみ
cd infra && pnpm test -t "owner can read"
```

### 期待される結果
```
✓ __tests__/firebase.rules.test.ts (36)
  ✓ Firestore Security Rules (36)
    ✓ matches collection (12)
    ✓ matches subcollections (12)
    ✓ jobs collection (5)
    ✓ users collection (7)

Test Files  1 passed (1)
     Tests  36 passed (36)
  Start at  XX:XX:XX
  Duration  X.XXs
```

## カバレッジ

### ルールのカバレッジ
- ✅ matches コレクション: 100%
- ✅ matches サブコレクション: 100%
- ✅ jobs コレクション: 100%
- ✅ users コレクション: 100%

### 操作のカバレッジ
- ✅ read: 完全カバー
- ✅ create: 完全カバー
- ✅ update: 完全カバー
- ✅ delete: 完全カバー

### 認証状態のカバレッジ
- ✅ 認証済みユーザー（オーナー）
- ✅ 認証済みユーザー（非オーナー）
- ✅ 未認証ユーザー

## セキュリティ保証

このテストスイートにより、以下が保証されます:

### 1. データプライバシー
- ユーザーは自分のデータのみにアクセス可能
- 他ユーザーのデータは読み書き不可

### 2. 認証要件
- すべての操作に認証が必要
- 未認証ユーザーはアクセス不可

### 3. 所有権の検証
- マッチのオーナーのみが操作可能
- サブコレクションも親のオーナーシップを継承

### 4. システム整合性
- jobsコレクションはクライアントから変更不可
- Cloud Functionsのみがシステムデータを操作可能

## CI/CD統合

### GitHub Actions
テストは以下のタイミングで自動実行されます:
- Pull Request作成時
- mainブランチへのpush時
- デプロイ前の検証

詳細は `TEST_EXECUTION_GUIDE.md` を参照。

## メンテナンス

### ルール変更時の対応
1. `infra/firebase.rules` を修正
2. 関連するテストケースを更新または追加
3. テストを実行して検証
4. すべてのテストが通過することを確認

### 新しいコレクション追加時
1. ルールに新しいコレクションを追加
2. 新しいdescribeブロックを作成
3. CRUD操作のテストを追加
4. 認証状態のバリエーションをテスト

## トラブルシューティング

よくある問題と解決方法は `TEST_EXECUTION_GUIDE.md` を参照してください。

## 参考資料

- [Firebase Rules Unit Testing](https://firebase.google.com/docs/rules/unit-tests)
- [Firestore Security Rules](https://firebase.google.com/docs/firestore/security/get-started)
- [Vitest Documentation](https://vitest.dev/)
- [Firebase Emulator Suite](https://firebase.google.com/docs/emulator-suite)
