# Gemini API から Vertex AI への移行プラン

## 概要

現在の Gemini REST API (v1beta) + APIキー認証を、Vertex AI + サービスアカウント認証に移行する。

**移行理由:**
- Firebase/GCPとのネイティブ統合
- APIキー漏洩リスクの排除
- 本番環境での安定性・レート制限向上
- 将来のカスタムモデル・ファインチューニング対応

---

## 影響範囲

### 変更が必要なファイル

| ファイル | 変更内容 | 優先度 |
|---------|---------|--------|
| `services/analyzer/src/gemini/labelClip.ts` | API呼び出し全面書き換え | 必須 |
| `services/analyzer/src/jobs/steps/04_labelClipsGemini.ts` | 環境変数・モデル名対応 | 必須 |
| `services/analyzer/package.json` | 依存パッケージ追加 | 必須 |
| `infra/cloud-run-service.yaml` | 環境変数・SA設定変更 | 必須 |
| `services/analyzer/src/lib/errors.ts` | エラーコード追加（任意） | 任意 |

### 変更不要なファイル

- `services/analyzer/src/lib/retry.ts` - 汎用リトライロジック
- `services/analyzer/src/gemini/prompts/clip_label_v1.json` - プロンプト定義
- `packages/shared/src/version.ts` - バージョン管理
- `packages/shared/src/domain/clip.ts` - 型定義

---

## フェーズ1: GCP準備

### 1.1 Vertex AI API有効化
- [x] GCPコンソールで Vertex AI API を有効化
- [ ] 必要な場合、請求アラートを設定

### 1.2 サービスアカウント設定
- [x] Firebase Admin SAに `roles/aiplatform.user` 権限を付与
  ```bash
  gcloud projects add-iam-policy-binding yuyama-hp \
    --member="serviceAccount:firebase-adminsdk-fbsvc@yuyama-hp.iam.gserviceaccount.com" \
    --role="roles/aiplatform.user"
  ```
- [x] ローカル開発用にADC設定確認
  ```bash
  gcloud auth application-default login
  ```

### 1.3 リージョン選定
- [x] Vertex AI でGeminiモデルが利用可能なリージョンを確認
  - 選択: `us-central1` (最も安定)
- [x] Cloud Runと同一リージョンに設定済み

---

## フェーズ2: 依存パッケージ追加

### 2.1 パッケージインストール
- [x] `@google-cloud/vertexai` パッケージを追加
  ```bash
  cd services/analyzer
  pnpm add @google-cloud/vertexai
  ```

### 2.2 TypeScript型定義確認
- [x] 型定義が含まれているか確認（@types不要のはず）

---

## フェーズ3: labelClip.ts リファクタリング

### 3.1 Vertex AI クライアント初期化
- [x] ファイル先頭にインポート追加
  ```typescript
  import { VertexAI, GenerativeModel } from '@google-cloud/vertexai';
  ```
- [x] クライアント初期化関数を作成
  ```typescript
  function getVertexAIClient(): GenerativeModel {
    const projectId = process.env.GCP_PROJECT_ID;
    const location = process.env.GCP_REGION || 'us-central1';
    const modelId = process.env.GEMINI_MODEL || 'gemini-1.5-flash';

    const vertexAI = new VertexAI({ project: projectId, location });
    return vertexAI.getGenerativeModel({ model: modelId });
  }
  ```

### 3.2 callGemini関数の書き換え
- [x] 現在のfetch実装をVertex AI SDKに置き換え
  ```typescript
  // Before: fetch + APIキー
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  // After: Vertex AI SDK
  const model = getVertexAIClient();
  const result = await model.generateContent({
    contents: [{ role: 'user', parts }],
    generationConfig: { temperature: 0.2, responseMimeType: 'application/json' }
  });
  ```

### 3.3 レスポンス解析の調整
- [x] Vertex AI SDKのレスポンス形式に対応
  ```typescript
  // Vertex AI SDK形式
  const response = result.response;
  const text = response.candidates?.[0]?.content?.parts?.[0]?.text;
  ```
- [x] エラーハンドリングの調整（SDK固有の例外処理）

### 3.4 画像送信形式の確認
- [x] インラインデータ形式がVertex AIでも同じか確認
  ```typescript
  {
    inlineData: {
      mimeType: 'image/jpeg',
      data: base64ImageData
    }
  }
  ```

### 3.5 APIキー関連コードの削除
- [x] `process.env.GEMINI_API_KEY` 参照を削除
- [x] APIキーチェックロジックを削除
- [x] GCP_PROJECT_ID必須チェックに置き換え

---

## フェーズ4: ステップ04の更新

### 4.1 環境変数チェックの変更
- [x] `04_labelClipsGemini.ts` のAPIキーチェックを変更
  ```typescript
  // Before
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY not set");
  }

  // After
  if (!process.env.GCP_PROJECT_ID) {
    throw new Error("GCP_PROJECT_ID not set");
  }
  ```

### 4.2 モデル名の確認
- [x] Vertex AIでのモデル名形式を確認
  - `gemini-1.5-flash` → `gemini-1.5-flash-001` など
- [x] 必要に応じて環境変数のデフォルト値を更新

---

## フェーズ5: インフラ設定更新

### 5.1 cloud-run-service.yaml の更新
- [x] GEMINI_API_KEY環境変数を削除
- [x] 必要な環境変数を追加
  ```yaml
  env:
  - name: GCP_PROJECT_ID
    value: "your-project-id"
  - name: GCP_REGION
    value: "us-central1"
  - name: GEMINI_MODEL
    value: "gemini-1.5-flash"
  ```

### 5.2 Secret Manager設定
- [ ] gemini-api-key シークレットの参照を削除（デプロイ後）
- [ ] 必要に応じてシークレット自体を削除（移行完了後）

### 5.3 サービスアカウント確認
- [ ] Cloud Runサービスに正しいSAが設定されているか確認
  ```bash
  gcloud run services describe soccer-analyzer \
    --region=us-central1 \
    --format='value(spec.template.spec.serviceAccountName)'
  ```

---

## フェーズ6: エラーハンドリング更新（任意）

### 6.1 エラーコードの追加
- [ ] `errors.ts` に Vertex AI 固有のエラーコードを追加（必要に応じて）
  ```typescript
  VERTEX_AI_ERROR = "VERTEX_AI_ERROR",
  ```

### 6.2 エラー分類の調整
- [ ] Vertex AI SDK の例外タイプに応じたリトライ判定を実装

---

## フェーズ7: テスト

### 7.1 ユニットテスト
- [ ] `labelClipWithGemini()` 関数のモックテスト作成
- [ ] Vertex AI クライアント初期化のテスト
- [ ] レスポンスパースのテスト

### 7.2 ローカル統合テスト
- [ ] ADC認証でローカル実行テスト
  ```bash
  GCP_PROJECT_ID=your-project pnpm test:integration
  ```
- [ ] 実際のGeminiモデル呼び出しテスト（小規模）

### 7.3 ステージング環境テスト
- [ ] Cloud Run ステージング環境にデプロイ
- [ ] エンドツーエンドテスト実行
- [ ] コスト・レイテンシ計測

### 7.4 レスポンス互換性確認
- [ ] Vertex AI レスポンスが既存スキーマと互換性があるか確認
- [ ] `gemini.rawResponse` の形式変更を確認

---

## フェーズ8: 本番デプロイ

### 8.1 デプロイ準備
- [ ] 変更内容のコードレビュー完了
- [ ] ロールバック手順の確認
- [ ] モニタリングアラートの設定確認

### 8.2 段階的ロールアウト
- [ ] 1つのmatchIdでテスト実行
- [ ] 問題なければ全体に展開
- [ ] ログ・メトリクス監視

### 8.3 クリーンアップ
- [ ] 旧APIキー関連コードの完全削除
- [ ] Secret Manager の gemini-api-key 削除
- [ ] ドキュメント更新

---

## フェーズ9: ドキュメント更新

### 9.1 コード内ドキュメント
- [ ] labelClip.ts のコメント更新
- [ ] 環境変数の説明更新

### 9.2 運用ドキュメント
- [ ] `infra/DEPLOYMENT.md` 更新
- [ ] `docs/backend_runbook.md` 更新（存在する場合）
- [ ] README.md の環境変数セクション更新

---

## 環境変数サマリ

### 移行前

```
GEMINI_API_KEY      # 必須
GEMINI_MODEL        # オプション (default: gemini-1.5-flash)
MAX_GEMINI_CLIPS    # オプション (default: 30)
GEMINI_COST_PER_CLIP_USD  # オプション (default: 0)
```

### 移行後

```
GCP_PROJECT_ID      # 必須 (新規)
GCP_REGION          # オプション (default: us-central1) (新規)
GEMINI_MODEL        # オプション (default: gemini-1.5-flash)
MAX_GEMINI_CLIPS    # オプション (default: 30)
GEMINI_COST_PER_CLIP_USD  # オプション (default: 0)
```

---

## リスクと対策

| リスク | 対策 |
|--------|------|
| レスポンス形式の違い | 事前にVertex AI APIドキュメントで確認、テストで検証 |
| レイテンシ増加 | ベンチマークテストで比較、問題あればリージョン調整 |
| 認証エラー | ローカル・ステージングで十分にテスト |
| コスト増加 | Vertex AI料金体系を確認、モニタリング設定 |
| ロールバック | 旧コードをブランチに保持、即座に切り戻し可能に |

---

## 完了条件

- [ ] 全てのユニットテストがパス
- [ ] ステージング環境で正常動作確認
- [ ] 本番環境で少なくとも10件のクリップ処理成功
- [ ] エラー率が移行前と同等以下
- [ ] レイテンシが許容範囲内
- [ ] ドキュメント更新完了

---

## 参考リンク

- [Vertex AI Generative AI ドキュメント](https://cloud.google.com/vertex-ai/docs/generative-ai/start/quickstarts/api-quickstart)
- [@google-cloud/vertexai npm](https://www.npmjs.com/package/@google-cloud/vertexai)
- [Gemini モデル一覧](https://cloud.google.com/vertex-ai/docs/generative-ai/model-reference/gemini)
