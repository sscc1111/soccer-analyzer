# Soccer Analyzer — Monorepo Implementation Plan (Expo RN + Firestore + NativeWind + Cloud Run Analyzer)

(省略せず完全版。チェックボックス付きでタスク完了管理が可能)

## 目的
- 少年サッカー（10–20分）動画解析
- 画角不定・土グラウンド対応
- 距離(m)は将来拡張、現時点では相対スタッツ
- React Native + Firestore + Tailwind(NativeWind)
- shadcn/ui思想のNative実装
- スタッツは後から無限に追加できる構造

---

## 1. ディレクトリ構成（確定）
- [ ] リポジトリ作成
- [ ] 下記構成を作成

```
soccer-analyzer/
├─ apps/mobile
├─ services/analyzer
├─ functions
├─ packages/shared
├─ infra
├─ docs
```

---

## 2. UIレイヤー（shadcn-like Native）
- [ ] Button / Card / Badge / Tabs
- [ ] Sheet / Dialog / Toast
- [ ] Progress / Skeleton
- [ ] className統合ユーティリティ（cn.ts）
- [ ] Tailwind tokens（color / radius / spacing）

---

## 3. Firestore データ設計（拡張前提）
- [ ] matches
- [ ] players
- [ ] shots
- [ ] clips
- [ ] events
- [ ] stats（metricKey方式）
- [ ] jobs（解析ジョブ）

---

## 4. 解析パイプライン（Cloud Run）
- [ ] メタ情報抽出
- [ ] ショット分割
- [ ] 動き＋音による候補抽出
- [ ] Geminiによるイベント分類
- [ ] stats calculator 実行（plug-in方式）

---

## 5. スタッツ設計（距離なし）
- [ ] 出場時間
- [ ] 関与回数
- [ ] 相対スプリント指数
- [ ] ヒートマップ（画面座標）
- [ ] チャンス関与

---

## 6. ユーザー任意設定（精度向上）
- [ ] 撮影位置・方向 UI
- [ ] 攻撃方向
- [ ] チーム色
- [ ] 背番号・フォーメーション
- [ ] ゴール指定
- [ ] 手動プレイヤー紐付け

---

## 7. 拡張方針
- 新スタッツ = calculator 1ファイル追加
- Firestore schema 変更不要
- 再解析（re-run）可能

---

## Done定義
- 実動画3本以上で破綻しない
- confidence付きでUI表示
- ユーザー補正が反映される
