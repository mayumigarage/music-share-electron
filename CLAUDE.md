# MusicShare — Electron + TypeScript

## アーキテクチャ

- **Main Process**: Electron (Node.js) + TypeScript
  - ウィンドウ管理、システムトレイ
  - `BaseWindow` + `WebContentsView` によるプレイヤー管理
  - ファイル I/O、未処理例外の `crash.log` 書き込み
  - URL メタデータ解決（CORS 回避のため Renderer ではなく Main で実行）
- **Renderer Process**: TypeScript + 純正 HTML/CSS/JS（第一フェーズ）
  - UI 表示、ユーザー入力、キュー/履歴描画
  - WebSocket 経由でのサーバー通信
  - WebRTC P2P 音声配信（HostBroadcast モード時）— `getDisplayMedia` でキャプチャ、`RTCPeerConnection` でゲストへ直接送信
- **Preload Script**: TypeScript
  - `contextBridge` による Main ↔ Renderer 間の安全な IPC
- **Server**: Node.js + TypeScript + Socket.IO
  - ルーム管理、メッセージ中継、キュー/履歴/再生状態のインメモリ保持

## ファイル構成

```
MusicShare/
├── src/
│   ├── main/
│   │   ├── main.ts              # Electron エントリーポイント
│   │   ├── window-manager.ts    # BaseWindow / WebContentsView / トレイ管理
│   │   ├── layout-manager.ts    # ウィンドウリサイズ時の WebContentsView 再配置
│   │   ├── player-bridge.ts     # WebContentsView 管理、プレイヤー通信、破棄処理
│   │   ├── asset-path.ts        # 開発時/パッケージ化後の assets パス解決
│   │   ├── track-resolver.ts    # URL → メタデータ解決（Node.js https/fetch）
│   │   └── crash-handler.ts     # 未処理例外キャッチ、crash.log 書き込み
│   ├── preload/
│   │   └── preload.ts           # contextBridge IPC 定義
│   ├── renderer/
│   │   ├── index.html           # メイン UI（左パネル + 中央キュー/履歴 + 右メンバー/プレイヤー + 下部コントロール）
│   │   ├── renderer.ts          # レンダラー側エントリーポイント
│   │   ├── ui/
│   │   │   ├── app.ts           # UI 初期化、イベントバインド
│   │   │   ├── playlist-panel.ts# 左パネル：マイライブラリ/プレイリスト（第一フェーズはダミー表示）
│   │   │   ├── queue-panel.ts   # 中央パネル：キュー描画、D&D、カスタムコンテキストメニュー
│   │   │   ├── history-panel.ts # 中央パネル：履歴描画
│   │   │   ├── members-panel.ts # 右パネル：メンバーリスト描画
│   │   │   ├── player-control.ts# 下部コントロール：シークバー、音量
│   │   │   └── room-modal.ts    # ルーム作成/参加モーダル
│   │   └── sync/
│   │       ├── sync-engine.ts   # ホスト/ゲスト同期ロジック
│   │       ├── websocket-client.ts# Socket.IO クライアント
│   │       ├── player-proxy.ts  # プレイヤー操作の抽象層（Renderer → Preload → Main → WebContentsView）
│   │       ├── webrtc-manager.ts# WebRTC P2P 接続管理（RTCPeerConnection、MediaStream、ICE）
│   │       └── signaling-client.ts# WebRTC シグナリング（SDP/ICE Candidate の Socket.IO 経由送受信）
│   ├── shared/
│   │   ├── models.ts            # Track, PlayerState, Room, User 等の型定義
│   │   └── preload-api.ts       # contextBridge で公開する API の型定義
│   └── server/
│       ├── server.ts            # Socket.IO サーバー エントリーポイント
│       ├── room-manager.ts      # ルーム CRUD、ホスト自動交代
│       └── handlers.ts          # イベントハンドラ集
├── assets/
│   └── players/
│       ├── YouTubePlayer.html   # YouTube IFrame Player API ラッパー
│       ├── SpotifyPlayer.html   # Spotify Web Playback SDK ラッパー
│       └── AppleMusicPlayer.html# Apple MusicKit JS v3 ラッパー
├── package.json
├── tsconfig.json
├── tsconfig.main.json
├── tsconfig.renderer.json
├── tsconfig.server.json
└── electron-builder.yml
```

## UI レイアウト（3ペイン構成版）

`WebContentsView` は DOM に含まれない独立レイヤーのため、以下の3ペイン分割レイアウトを採用する。

```
┌───────────────────────────────────────────────────────────────────────────┐
│ 🎵 MusicShare  [ Room ID: 873-921 ]                              [⚙️]      │  <-- DOM（トップパネル）
├──────────────────────┬────────────────────────────────────┬───────────────┤
│ 📂 マイライブラリ     │  [ 🎵 キュー ]   [ 📜 履歴 ]        │ 👥 メンバー (4) │  <-- DOM（左パネル）
│ ・🏠 ホーム          │ ────────────────────────────────── │ 👑 Host       │  <-- DOM（中央上部タブ）
│ ・🔍 検索            │                                    │  └ 小田 (You) │  <-- DOM（右パネル上部）
│                      │  🎵 再生待ちのキュー (3曲)         │               │
│ 📁 プレイリスト      │  ┌──────────────────────────────┐  │ 🟢 Online     │
│ ・お気に入り         │  │ 🟩 1. Next Title    [鈴木] [🗑️] │  │  ├ 鈴木       │
│ ・作業用BGM          │  ├──────────────────────────────┤  │  └ 田中       │
│ ・ドライブ用         │  │ 📄 2. Future Track  [田中] [🗑️] │  │               │
│                      │  └──────────────────────────────┘  │ ⚪ Offline    │
│ [➕ プレイリスト作成] │                                    │  └ 佐藤       │
├──────────────────────┴────────────────────────────────────┴───────────────┤
│                                                                         │
│                    WebContentsView（プレイヤー）                          │  <-- 右パネル下部（独立ビュー）
│                    YouTube / Spotify / AppleMusic                       │
│                                                                         │
├───────────────────────────────────────────────────────────────────────────┤
│ ┌───┐ 🎵 Now Playing...                                                    │
│ │📷 │ Title - Artist                                                      │  <-- DOM（下部固定プレイヤー）
│ └───┘ [⏮️] [▶️] [⏭️]   01:24 ──────────────🔘───────────── 03:45   🔊 [🔘───] │
└───────────────────────────────────────────────────────────────────────────┘
```

- **左側パネル（固定幅 240px）**: DOM。マイライブラリ/プレイリストナビゲーション。第一フェーズはダミー表示（将来的に機能実装）。
- **中央パネル（可変幅）**: DOM。上部にキュー/履歴のタブ切り替え。下部にキュー/履歴リスト（サムネイル、曲名、アーティスト、追加者、削除ボタン）。
- **右側パネル（固定幅 280px）**: DOM（上部メンバーリスト）＋ WebContentsView（下部プレイヤー）。ウィンドウリサイズ時に `setBounds()` で再計算。
- **下部コントロール**: DOM。全幅。シークバー/音量/Now Playing情報。
- **右クリックメニュー**: Renderer 内カスタム HTML/CSS で実装（ダークテーマ統一・ネイティブ外観より UI 一貫性を優先）

## 禁止事項・設計原則

- **Renderer から直接 Node.js API を呼び出さない** — 必ず Preload Script 経由の IPC を使用する
- **Main Process で UI ロジックを持たない** — Main はウィンドウ/WebContentsView 管理に専念し、状態管理・音声配信は Renderer/SyncEngine に委ねる
- **`nodeIntegration: false` を必須とする** — Renderer Process では Node.js 統合を完全に無効化
- **`contextIsolation: true` を必須とする** — Preload Script と Renderer のコンテキストを分離
- `webSecurity: false` や `allowRunningInsecureContent: true` の無闇な使用を禁止する — 必要な場合は最小限の範囲で `webPreferences` を調整
- **プレーヤー HTML 内で外部スクリプトを `document.write` や `eval` で動的生成しない** — `<script src="...">` タグの直接読み込みに限定
- **Server 側で永続化層を導入しない**（第一フェーズ） — ルーム・キュー・履歴はすべてインメモリ。永続化は将来拡張として扱う
- **`autoplay-policy` を `webPreferences` と誤認しない** — `autoplay-policy=no-user-gesture-required` は `app.commandLine.appendSwitch()` で設定する
- **WebContentsView のメモリリークを防ぐ** — プレイヤー切り替え時は必ず `removeChildView()` + `webContents.destroy()` を実行する
- **サーバーは音声バイナリを一切転送しない** — 音声データは WebRTC P2P で直接送受信し、サーバーはシグナリング（SDP・ICE Candidate の中継）のみを行う
- **WebRTC の `RTCConfiguration` にパブリック STUN サーバーを必ず指定する** — `stun:stun.l.google.com:19302` を設定し、NAT 越えを実現する（手動ポート開放は不要）
- **第一フェーズの推奨同時接続数はホスト1人に対してゲスト3〜5人まで** — ホストのアップロード帯域（Mesh 接続の限界）を考慮したソフトリミット。超過時は参加拒否または警告を表示する

## イベント設計原則（Socket.IO）

- **クライアント → サーバー**: キュー操作は個別イベント（`AddTrack`, `RemoveTrack`, `ReorderQueue`）のみ使用する
- **サーバー → クライアント**:
  - `QueueUpdated`（キュー全体の同期）を基本とする
  - `TrackAdded`（個別追加通知）は**追加ハイライト UX 用**として残す。キュー再描画は `QueueUpdated` に依存する
- **WebRTC シグナリング**: サーバーは SDP および ICE Candidate の中継のみを行う。音声バイナリは一切転送しない。
  - `SDPOffer` — ホストが対象ゲストに SDP offer を送信（サーバー経由）
  - `SDPAnswer` — ゲストがホストに SDP answer を送信（サーバー経由）
  - `ICECandidate` — ピア間で ICE candidate を交換（サーバー経由）
