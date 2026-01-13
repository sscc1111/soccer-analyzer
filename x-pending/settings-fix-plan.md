# 設定機能の修正プラン

## 概要

基本設定と試合設定の実装を徹底調査した結果、以下の問題点が発見された。
このプランでは優先度順に修正を行い、自動パス判定機能の前提条件を整える。

---

## 発見された問題点

### 高優先度
1. マッチ作成時にデフォルト設定が適用されない
2. ロスターがデフォルトから試合に自動コピーされない
3. カメラ詳細設定のUI未実装
4. Firestoreルールが甘すぎる（セキュリティリスク）

### 中優先度
5. DefaultSettingsがクラウドに保存されない（ローカルのみ）
6. 設定値の検証がない
7. shared packageにDefaultSettingsの型がない

---

## Phase 1: マッチ作成時のデフォルト設定適用

### 1.1 upload.tsx の修正

- [x] `getDefaultSettings()` をインポート
- [x] `createMatch` 呼び出し前にデフォルト設定を取得
- [x] `createMatch` に `settings` を渡す
  ```typescript
  // 修正前
  const matchId = await createMatch({
    ownerUid,
    title: title || "Untitled Match",
    date: date || null,
    analysis: { status: "idle" },
  });

  // 修正後
  const defaults = await getDefaultSettings();
  const matchId = await createMatch({
    ownerUid,
    title: title || "Untitled Match",
    date: date || null,
    analysis: { status: "idle" },
    settings: {
      teamColors: defaults.teamColors,
      formation: defaults.formation
        ? {
            shape: defaults.formation.shape,
            assignments: defaults.roster?.map((r) => ({
              jerseyNo: r.jerseyNo,
              role: r.name,
            })),
          }
        : undefined,
    },
  });
  ```

### 1.2 動作確認

- [ ] 新規マッチ作成時にデフォルト設定が適用されることを確認
- [ ] 設定画面で「Using team defaults」バッジが表示されないことを確認（設定済みのため）

---

## Phase 2: 試合設定画面のロスター適用修正

### 2.1 match/[id]/settings.tsx の修正

- [x] デフォルト適用時にロスターも適用する
  ```typescript
  // 修正前（221-223行目付近）
  } else {
    setUsingDefaults(true);
    setSettings({
      teamColors: defaultSettings.teamColors,
      formation: defaultSettings.formation,
    });
    setRoster(defaultSettings.roster ?? []);
  }

  // 修正後
  } else {
    setUsingDefaults(true);
    setSettings({
      teamColors: defaultSettings.teamColors,
      formation: {
        ...defaultSettings.formation,
        assignments: defaultSettings.roster?.map((r) => ({
          jerseyNo: r.jerseyNo,
          role: r.name,
        })),
      },
    });
    setRoster(defaultSettings.roster ?? []);
  }
  ```

### 2.2 動作確認

- [ ] 設定未保存のマッチでロスターがデフォルトから表示されることを確認

---

## Phase 3: カメラ詳細設定UIの追加

### 3.1 型定義の確認

既存の `MatchSettings.camera` 型:
```typescript
camera?: {
  position?: "sideline" | "goalLine" | "corner" | "other" | null;
  x?: number; // 0..1
  y?: number; // 0..1
  headingDeg?: number; // 0..360
  zoomHint?: "near" | "mid" | "far" | null;
} | null;
```

### 3.2 UIコンポーネント追加

- [x] ズームレベル選択UIを追加
  ```typescript
  const ZOOM_HINTS = [
    { value: "near", label: "Near (Close-up)" },
    { value: "mid", label: "Mid (Half field)" },
    { value: "far", label: "Far (Full field)" },
  ] as const;
  ```

- [x] カメラ位置セクションにズーム選択を追加
  ```tsx
  <OptionSelector
    label="Zoom Level"
    options={ZOOM_HINTS}
    value={settings.camera?.zoomHint ?? null}
    onChange={(v) =>
      setSettings((s) => ({
        ...s,
        camera: { ...s.camera, zoomHint: v },
      }))
    }
  />
  ```

### 3.3 将来の拡張用（Phase 6以降）

- [ ] x, y座標入力（スライダー）- 距離校正時に実装
- [ ] headingDeg入力 - 距離校正時に実装

---

## Phase 4: Firestoreセキュリティルールの厳格化

### 4.1 firebase.rules の修正

- [x] ownerUidによるアクセス制限を追加
  ```rules
  rules_version = '2';
  service cloud.firestore {
    match /databases/{database}/documents {
      // Helper function
      function isOwner(matchId) {
        return get(/databases/$(database)/documents/matches/$(matchId)).data.ownerUid == request.auth.uid;
      }

      match /matches/{matchId} {
        allow read: if request.auth != null && resource.data.ownerUid == request.auth.uid;
        allow create: if request.auth != null && request.resource.data.ownerUid == request.auth.uid;
        allow update, delete: if request.auth != null && resource.data.ownerUid == request.auth.uid;
      }

      match /matches/{matchId}/{sub=**} {
        allow read, write: if request.auth != null && isOwner(matchId);
      }

      match /jobs/{jobId} {
        // Jobs are system-managed, but users can read their own
        allow read: if request.auth != null;
        allow write: if false; // Only Cloud Functions can write
      }
    }
  }
  ```

### 4.2 バックエンド側の調整

- [ ] Cloud Functions が書き込みできるようにサービスアカウント確認
- [ ] テスト環境でルールが正しく動作することを確認

---

## Phase 5: 設定値の検証追加

### 5.1 バリデーション関数の作成

- [x] `packages/shared/src/validation/settings.ts` を作成
  ```typescript
  import { z } from "zod";

  export const rosterItemSchema = z.object({
    jerseyNo: z.number().int().min(1).max(99),
    name: z.string().max(50).optional(),
  });

  export const matchSettingsSchema = z.object({
    attackDirection: z.enum(["LTR", "RTL"]).nullable().optional(),
    teamColors: z
      .object({
        home: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
        away: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
      })
      .nullable()
      .optional(),
    camera: z
      .object({
        position: z.enum(["sideline", "goalLine", "corner", "other"]).nullable().optional(),
        zoomHint: z.enum(["near", "mid", "far"]).nullable().optional(),
      })
      .nullable()
      .optional(),
    formation: z
      .object({
        shape: z.string().nullable().optional(),
        assignments: z.array(
          z.object({
            jerseyNo: z.number().int().min(1).max(99),
            role: z.string().max(30).optional(),
          })
        ).optional(),
      })
      .nullable()
      .optional(),
  });

  export type ValidatedMatchSettings = z.infer<typeof matchSettingsSchema>;
  ```

### 5.2 フロントエンドでの検証適用

- [x] 設定保存前にバリデーション実行
- [x] エラー時にトーストでユーザーに通知
  ```typescript
  const handleSave = async () => {
    const result = matchSettingsSchema.safeParse(settings);
    if (!result.success) {
      toast({
        title: "Invalid settings",
        message: result.error.issues[0].message,
        variant: "error",
      });
      return;
    }
    // 保存処理...
  };
  ```

### 5.3 背番号の重複チェック

- [x] RosterEditorで同じ背番号が入力された場合に警告
  ```typescript
  const hasDuplicates = roster.some(
    (p, i) => roster.findIndex((r) => r.jerseyNo === p.jerseyNo) !== i
  );
  if (hasDuplicates) {
    toast({ title: "Duplicate jersey numbers", variant: "warning" });
  }
  ```

---

## Phase 6: shared packageにDefaultSettings型を追加

### 6.1 型定義の追加

- [x] `packages/shared/src/domain/settings.ts` を作成
  ```typescript
  export type DefaultSettings = {
    teamColors?: {
      home?: string | null;
      away?: string | null;
    } | null;
    formation?: {
      shape?: string | null;
    } | null;
    roster?: Array<{
      jerseyNo: number;
      name?: string;
    }>;
  };
  ```

- [x] `packages/shared/src/index.ts` にエクスポート追加

### 6.2 フロントエンドの型をsharedから参照

- [x] `apps/mobile/lib/hooks/useDefaultSettings.ts` の型定義を削除
- [x] sharedからインポートするように変更
  ```typescript
  import type { DefaultSettings } from "@soccer/shared";
  ```

---

## Phase 7: DefaultSettingsのクラウド同期（任意）

### 7.1 Firestoreスキーマ追加

- [ ] `users/{uid}/settings` ドキュメント設計
  ```typescript
  type UserSettingsDoc = {
    defaults: DefaultSettings;
    updatedAt: string;
  };
  ```

### 7.2 同期ロジック実装

- [ ] `useDefaultSettings` hookにFirestore同期を追加
  - ローカル（AsyncStorage）を優先
  - バックグラウンドでFirestoreと同期
  - コンフリクト時は新しい方を採用

### 7.3 Firebase Authの導入

- [ ] 匿名認証からFirebase Auth（匿名ログイン）への移行検討
- [ ] `ownerUid` を Firebase Auth UID に統一

---

## ファイル変更一覧

| Phase | ファイル | 変更内容 |
|-------|----------|----------|
| 1 | `apps/mobile/app/upload.tsx` | デフォルト設定の適用 |
| 2 | `apps/mobile/app/match/[id]/settings.tsx` | ロスター適用の修正 |
| 3 | `apps/mobile/app/match/[id]/settings.tsx` | ズームUI追加 |
| 4 | `infra/firebase.rules` | セキュリティ強化 |
| 5 | `packages/shared/src/validation/settings.ts` | 新規作成 |
| 5 | `apps/mobile/app/match/[id]/settings.tsx` | バリデーション追加 |
| 5 | `apps/mobile/app/(tabs)/settings.tsx` | バリデーション追加 |
| 6 | `packages/shared/src/domain/settings.ts` | 新規作成 |
| 6 | `packages/shared/src/index.ts` | エクスポート追加 |
| 6 | `apps/mobile/lib/hooks/useDefaultSettings.ts` | 型参照変更 |
| 7 | `apps/mobile/lib/hooks/useDefaultSettings.ts` | Firestore同期 |
| 7 | `infra/firebase.rules` | usersコレクション追加 |

---

## 依存関係

```
Phase 1 (upload.tsx) ─────────────────────────┐
                                              │
Phase 2 (settings.tsx roster) ────────────────┼──→ Phase 5 (validation)
                                              │
Phase 3 (camera UI) ──────────────────────────┤
                                              │
Phase 4 (security rules) ─────────────────────┘

Phase 6 (shared types) ───────────────────────→ Phase 7 (cloud sync)
```

- Phase 1-4 は独立して並行実行可能
- Phase 5 は Phase 1-3 の後に実行
- Phase 6 は Phase 5 の後に実行
- Phase 7 は Phase 6 の後に実行（任意）

---

## テスト項目

### 機能テスト

- [ ] 新規マッチ作成時にデフォルト設定が適用される
- [ ] 既存マッチの設定画面でデフォルトが正しく表示される
- [ ] ロスターがデフォルトから引き継がれる
- [ ] カメラズームレベルが保存・表示される
- [ ] 不正な設定値がエラーになる
- [ ] 重複背番号に警告が出る

### セキュリティテスト

- [ ] 他ユーザーのマッチが読めない
- [ ] 他ユーザーのマッチに書き込めない
- [ ] 未認証ユーザーがアクセスできない

---

## 完了チェックリスト

各タスクの `[ ]` を `[x]` に変更することで完了を記録できます。

---

## メモ・補足

- Phase 7（クラウド同期）は将来の拡張として任意
- 自動パス判定機能の実装前に Phase 1-5 を完了することを推奨
- カメラ詳細設定（x, y, heading）は距離校正機能と一緒に実装予定
