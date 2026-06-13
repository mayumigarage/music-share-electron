# MusicShare 実装タスク一覧

## Phase 0: プロジェクト初期セットアップ
- [ ] 0.1 `package.json` 作成（Electron + TypeScript + Socket.IO 依存）
- [ ] 0.2 `tsconfig.json` / `tsconfig.main.json` / `tsconfig.renderer.json` / `tsconfig.server.json` 作成
- [ ] 0.3 `electron-builder.yml` 作成（Windows/macOS/Linux ビルド設定、`assets/players/` を `extraResources` に含める）
- [ ] 0.4 `.gitignore` 作成（`node_modules/`, `dist/`, `crash.log` 等）
- [ ] 0.5 ディレクトリ構成 (`src/main/`, `src/preload/`, `src/renderer/`, `src/shared/`, `src/server/`, `assets/players/`) を作成
- [ ] 0.6 `npm install` 実行（Electron, typescript, socket.io, socket.io-client, electron-builder, jest 等）
- [ ] 0.7 `package.json` scripts 整備（`start`, `server`, `build`, `dist`, `lint`, `test` 等）

## Phase 1: 共通型定義（shared）
- [ ] 1.1 `src/shared/models.ts` — `MusicServiceType` enum 定義
- [ ] 1.2 `src/shared/models.ts` — `Track` interface（`durationSeconds: number | null` とする）
- [ ] 1.3 `src/shared/models.ts` — `PlayerState` interface（`positionSeconds` は必須。ホストは1秒ごとに送信、ゲストは受信時反映）
- [ ] 1.4 `src/shared/models.ts` — `RoomMode` enum 定義
- [ ] 1.5 `src/shared/models.ts` — `User` interface 定義
- [ ] 1.6 `src/shared/models.ts` — `TrackHistory` interface 定義
- [ ] 1.7 `src/shared/models.ts` — `Room` interface（`audioConfig` フィールドは削除。WebRTC では SDP 内で自動ネゴシエーションされる）
- [ ] 1.8 ~~`src/shared/models.ts` — `AudioConfig` interface~~ **削除** — WebRTC では不要
- [ ] 1.9 `src/shared/models.ts` — Socket.IO イベント名・ペイロード型を型安全に定義（`ServerToClientEvents`, `ClientToServerEvents`）。`SendAudioChunk` / `UpdateRoomAudioFormat` / `AudioFormatUpdated` を削除し、`SDPOffer` / `SDPAnswer` / `ICECandidate` を追加
- [ ] 1.10 `src/shared/preload-api.ts` — `contextBridge` で公開する API の型定義（`ElectronAPI` interface）

## Phase 2: サーバー（server）
- [ ] 2.1 `src/server/server.ts` — Socket.IO サーバー起動（ポート 5000、CORS 設定）
- [ ] 2.2 `src/server/room-manager.ts` — ルーム CRUD（CreateRoom, JoinRoom, LeaveRoom）
- [ ] 2.3 `src/server/room-manager.ts` — `roomId` 生成（6 文字英数字ランダム）
- [ ] 2.4 `src/server/room-manager.ts` — ホスト自動交代ロジック（ホスト退出時先頭ユーザー昇格）
- [ ] 2.5 `src/server/room-manager.ts` — ユーザー 0 人のルーム自動削除
- [ ] 2.6 `src/server/room-manager.ts` — 履歴最大 100 件制限（FIFO 破棄）
- [ ] 2.7 `src/server/handlers.ts` — ルーム操作ハンドラ（CreateRoom, JoinRoom, LeaveRoom, TransferHost）
- [ ] 2.8 `src/server/handlers.ts` — キュー操作ハンドラ（AddTrack, RemoveTrack, ReorderQueue）。サーバーが正規の状態を保持し、変更後に `QueueUpdated` をブロードキャスト
- [ ] 2.9 `src/server/handlers.ts` — プレイヤー状態ハンドラ（UpdatePlayerState, SkipTrack, TrackFinished）
- [ ] 2.10 ~~`src/server/handlers.ts` — 音声配信ハンドラ（SendAudioChunk, UpdateRoomAudioFormat）~~ **削除** — WebRTC P2P ではサーバーが音声バイナリを転送しない
- [ ] 2.11 `src/server/handlers.ts` — ゲスト要求ハンドラ（RequestPlayPause, RequestStop → ホストに転送）
- [ ] 2.12 `src/server/handlers.ts` — サーバー → クライアントブロードキャスト実装（`QueueUpdated`, `TrackAdded`, `PlayerStateUpdated`, `HistoryUpdated` 等全イベント）。`AudioData` / `AudioFormatUpdated` のブロードキャストは削除
- [ ] 2.13 `src/server/handlers.ts` — WebRTC シグナリングハンドラ：`SDPOffer` 受信 → 対象ゲストソケットに転送
- [ ] 2.14 `src/server/handlers.ts` — WebRTC シグナリングハンドラ：`SDPAnswer` 受信 → 対象ホストソケットに転送
- [ ] 2.15 `src/server/handlers.ts` — WebRTC シグナリングハンドラ：`ICECandidate` 受信 → 対象ピアソケットに転送
- [ ] 2.16 `src/server/room-manager.ts` — ホスト接続数制限（ゲスト 5 人まで）。超過時の参加拒否ロジック
- [ ] 2.17 `src/server/__tests__/room-manager.test.ts` — RoomManager の単体テスト（Jest）
- [ ] 2.18 `src/server/__tests__/handlers.test.ts` — Socket.IO イベントハンドラの単体テスト（Jest + `socket.io-client`）
- [ ] 2.19 サーバー手動動作確認（`npm run server` で起動、簡易クライアントで接続テスト）

## Phase 3: Electron Main Process
- [ ] 3.1 `src/main/main.ts` — Electron アプリエントリーポイント。`app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')` を設定
- [ ] 3.2 `src/main/main.ts` — `app.whenReady()` で `BaseWindow` + `WebContentsView` 作成。`contextIsolation: true`, `nodeIntegration: false` を徹底
- [ ] 3.3 `src/main/window-manager.ts` — `BaseWindow` 作成（幅 1200px、高さ 700px、ダークテーマ `#121212`）
- [ ] 3.4 `src/main/window-manager.ts` — 最小化時システムトレイ格納
- [ ] 3.5 `src/main/window-manager.ts` — `BaseWindow.contentView.addChildView()` で WebContentsView（プレイヤー）を追加
- [ ] 3.6 `src/main/layout-manager.ts` — ウィンドウリサイズ時のレイアウト再計算（左パネル固定幅 240px、右パネル固定幅 280px、中央可変）。`playerView.setBounds()` を右パネル下部に更新
- [ ] 3.7 `src/main/asset-path.ts` — 開発時/パッケージ化後の `assets/players/` パス解決ユーティリティ
- [ ] 3.8 `src/main/player-bridge.ts` — `WebContentsView` の webContents 管理。プレイヤー HTML 読み込み（`asset-path.ts` 経由）
- [ ] 3.9 `src/main/player-bridge.ts` — `webContents.executeJavaScript()` で `playTrack(url)`, `pause()`, `resume()`, `seek(seconds)`, `setVolume(volume)` 呼び出し
- [ ] 3.10 `src/main/player-bridge.ts` — プレイヤーからの `postMessage` / `ipc` メッセージ受信（STATE, ENDED, ERROR）
- [ ] 3.11 `src/main/player-bridge.ts` — **WebContentsView 破棄処理**: プレイヤー切り替え時に `removeChildView()` + `webContents.destroy()` を実行
- [ ] 3.12 `src/main/track-resolver.ts` — Node.js `https` / `fetch` で URL メタデータ解決（CORS 回避）
- [ ] 3.13 `src/main/track-resolver.ts` — YouTube oembed API 対応
- [ ] 3.14 `src/main/track-resolver.ts` — Spotify oembed API 対応
- [ ] 3.15 `src/main/track-resolver.ts` — Apple Music HTML 取得 + `og:title` / `og:image` 抽出
- [ ] 3.16 `src/main/track-resolver.ts` — 取得失敗時フォールバック（Unknown Track / Unknown Artist / 空サムネイル / duration null）
- [ ] 3.17 `src/main/crash-handler.ts` — 未処理例外キャッチ、`crash.log` 追記書き込み（出力先: `app.getPath('userData')`）

## Phase 4: Preload Script
- [ ] 4.1 `src/preload/preload.ts` — `contextBridge.exposeInMainWorld('electronAPI', {...})` を `preload-api.ts` の型に従って定義
- [ ] 4.2 `src/preload/preload.ts` — `onPlayerMessage`（Main → Renderer、プレイヤーからのメッセージ受信）
- [ ] 4.3 `src/preload/preload.ts` — `sendToPlayer`（Renderer → Main、プレイヤーへのスクリプト実行/メッセージ送信）
- [ ] 4.4 `src/preload/preload.ts` — `openExternal`（Renderer → Main、デフォルトブラウザで URL 開く）
- [ ] 4.5 `src/preload/preload.ts` — `resolveTrack`（Renderer → Main、URL メタデータ解決要求）
- [ ] 4.6 ~~`captureAudio` / `playbackAudio`~~ **削除** — WebRTC P2P では Renderer 内で直接 `getDisplayMedia` / `RTCPeerConnection` を使用するため不要
- [ ] 4.7 ~~`onAudioData`~~ **削除** — WebRTC P2P では音声データはサーバーを経由しないため不要

## Phase 5: プレイヤー HTML（assets/players/）
- [x] 5.1 `assets/players/YouTubePlayer.html` — YouTube IFrame Player API 動的読み込み
- [x] 5.2 `assets/players/YouTubePlayer.html` — グローバル関数 `playTrack(url)`, `pause()`, `resume()`, `seek(seconds)`, `setVolume(volume)` 実装
- [x] 5.3 `assets/players/YouTubePlayer.html` — 状態通知（`STATE|playing|123.45`）、終了通知（`ENDED`）、エラー通知（`ERROR|VIDEO_ID`）
- [x] 5.4 `assets/players/SpotifyPlayer.html` — Spotify Web Playback SDK 読み込み、OAuth トークン空文字初期化
- [x] 5.5 `assets/players/SpotifyPlayer.html` — 上記共通インターフェース + 通知実装。認証エラー時は `ERROR` 通知
- [x] 5.6 `assets/players/AppleMusicPlayer.html` — Apple MusicKit JS v3 読み込み、developerToken 空文字初期化
- [x] 5.7 `assets/players/AppleMusicPlayer.html` — 上記共通インターフェース + 通知実装。認証エラー時は `ERROR` 通知
- [x] 5.8 `assets/players/` — `file://` 読み込みで SDK エラーが出る場合のフォールバック策を検討（`localhost` 配信 or カスタムプロトコル）

## Phase 6: Renderer Process（UI + 同期）
- [ ] 6.1 `src/renderer/index.html` — メイン UI レイアウトを3ペイン構成（左:マイライブラリ、中央:キュー/履歴タブ、右:メンバー/プレイヤー、下部:コントロール）に変更
- [ ] 6.2 `src/renderer/renderer.ts` — レンダラー側エントリーポイント、各モジュール初期化
- [ ] 6.3 `src/renderer/ui/app.ts` — UI 初期化、イベントバインド、ダークテーマ適用
- [ ] 6.4 `src/renderer/ui/playlist-panel.ts` — 左パネル：マイライブラリ/プレイリスト描画（第一フェーズはダミー表示。将来的に機能実装）
- [ ] 6.5 `src/renderer/ui/room-modal.ts` — ルーム作成モーダル（個別再生 / ホスト配信モード選択）
- [ ] 6.6 `src/renderer/ui/room-modal.ts` — ルーム参加 UI（Room ID 入力、参加ボタン）
- [ ] 6.7 `src/renderer/ui/queue-panel.ts` — 中央パネル：キューリスト描画（サムネイル 40x40、曲名、アーティスト、追加者、サービスアイコン）
- [ ] 6.8 `src/renderer/ui/queue-panel.ts` — ドラッグ&ドロップ並べ替え（`ReorderQueue` 発行）
- [ ] 6.9 `src/renderer/ui/queue-panel.ts` — **Renderer 内カスタム HTML/CSS** で右クリックコンテキストメニュー実装（上へ/下へ/リンクを開く/削除）
- [ ] 6.10 `src/renderer/ui/queue-panel.ts` — ダブルクリックでリンクを開く
- [ ] 6.11 `src/renderer/ui/history-panel.ts` — 中央パネル：履歴リスト描画（最大 100 件表示）
- [ ] 6.12 `src/renderer/ui/members-panel.ts` — 右パネル：メンバーリスト描画（オンライン/オフライン状態、ホスト表示）
- [ ] 6.13 `src/renderer/ui/player-control.ts` — 再生/一時停止、停止、シークバー、音量スライダー UI
- [ ] 6.13 `src/renderer/sync/websocket-client.ts` — Socket.IO クライアント接続（`ws://localhost:5000`）
- [ ] 6.14 `src/renderer/sync/websocket-client.ts` — サーバーイベント受信ハンドラ登録（QueueUpdated, PlayerStateUpdated, HistoryUpdated 等）
- [ ] 6.15 `src/renderer/sync/websocket-client.ts` — クライアント → サーバーイベント発行関数ラッパー
- [ ] 6.16 `src/renderer/sync/sync-engine.ts` — ホストモード：1 秒間隔で `UpdatePlayerState` ブロードキャスト
- [ ] 6.17 `src/renderer/sync/sync-engine.ts` — ホストモード（HostBroadcast）：各ゲスト参加時に `webrtc-manager.ts` で `RTCPeerConnection` を作成し、システム音声を P2P 配信
- [ ] 6.18 `src/renderer/sync/sync-engine.ts` — ゲストモード：`PlayerStateUpdated` 受信 → UI 反映。2秒以上ズレ時のみシーク実行（マイクロシーク防止）
- [ ] 6.19 `src/renderer/sync/sync-engine.ts` — ゲストモード（HostBroadcast）：`SDPOffer` 受信時に `RTCPeerConnection` を作成し、ホストからの音声ストリームを `<audio>` で受信再生
- [ ] 6.20 `src/renderer/sync/sync-engine.ts` — `HostTransferred` 受信時にホストフラグ更新、SyncEngine モード切り替え。既存の WebRTC 接続をクリーンアップ
- [ ] 6.21 `src/renderer/sync/player-proxy.ts` — プレイヤー操作抽象層（Renderer → Preload → Main → WebContentsView）
- [ ] 6.22 `src/renderer/sync/webrtc-manager.ts` — `RTCPeerConnection` 管理（作成、接続、切断）
- [ ] 6.23 `src/renderer/sync/webrtc-manager.ts` — ホスト側: `navigator.mediaDevices.getDisplayMedia({ audio: true, video: false })` でシステム音声キャプチャ
- [ ] 6.24 `src/renderer/sync/webrtc-manager.ts` — ホスト側: `pc.addTrack()` で音声トラックを PeerConnection に追加
- [ ] 6.25 `src/renderer/sync/webrtc-manager.ts` — ゲスト側: `ontrack` イベントで `MediaStream` 受信 → `<audio>` 要素で再生
- [ ] 6.26 `src/renderer/sync/webrtc-manager.ts` — STUN サーバー設定（`stun:stun.l.google.com:19302`）
- [ ] 6.27 `src/renderer/sync/signaling-client.ts` — Socket.IO 経由の SDP/ICE Candidate 送受信ラッパー
- [ ] 6.28 `src/renderer/sync/webrtc-manager.ts` — 接続数制限（ホスト側でゲスト接続数をカウント、5人超過時は新規接続を拒否）

> **注記（プレイリスト機能のスコープ）**: 左パネルの「マイライブラリ」「プレイリスト」機能は**将来拡張**。第一フェーズでは UI 見た目のみ（ナビゲーション項目の表示）とし、クリック時は「Coming Soon」トースト表示または無反応としておく。キュー/履歴操作は中央パネルで行う。

## Phase 7: WebRTC P2P 音声配信（HostBroadcast）
- [ ] 7.1 ホスト側 — Renderer: `navigator.mediaDevices.getDisplayMedia({ audio: true, video: false })` でシステム音声キャプチャ
- [ ] 7.2 ホスト側 — `RTCPeerConnection` 作成、STUN サーバー設定（`stun:stun.l.google.com:19302`）
- [ ] 7.3 ホスト側 — `pc.addTrack(capturedStream.getAudioTracks()[0], capturedStream)` で音声トラック追加
- [ ] 7.4 ホスト側 — `createOffer()` → `setLocalDescription()` → `SDPOffer` をシグナリングサーバー経由でゲストへ送信
- [ ] 7.5 ホスト側 — `ICECandidate` 受信時 `pc.addIceCandidate()`
- [ ] 7.6 ゲスト側 — `SDPOffer` 受信 → `RTCPeerConnection` 作成 → `setRemoteDescription(offer)` → `createAnswer()` → `SDPAnswer` 送信
- [ ] 7.7 ゲスト側 — `ontrack` イベントで `MediaStream` 受信 → `<audio>` 要素で再生
- [ ] 7.8 ゲスト側 — `ICECandidate` 生成時シグナリングサーバー経由でホストへ送信
- [ ] 7.9 接続制限 — ホスト側で接続中ゲスト数をカウント、5人を超える参加要求を拒否（または警告）

## Phase 8: エラーハンドリング・動作確認
- [ ] 8.1 クライアント：未処理例外を `crash.log` に `[YYYY-MM-DD HH:mm:ss]\n{detail}\n\n` 形式で追記
- [ ] 8.2 クライアント：致命的エラー時ダイアログ表示、業務継続可能時はステータスバー短時間表示
- [ ] 8.3 クライアント：URL 解決失敗時「URLの解析に失敗しました」メッセージ
- [ ] 8.4 クライアント：ルーム参加失敗時「ルームに参加できませんでした」メッセージ
- [ ] 8.5 サーバー：存在しない `roomId` / 無効インデックス アクセス時 `false` を返す（例外投げない）
- [ ] 8.6 単体起動確認（サーバー → Electron アプリ → ルーム作成 → キュー追加 → 再生）
- [ ] 8.7 複数クライアント同期確認（ホスト 1 + ゲスト 2 程度で再生/一時停止/シークの同期）
- [ ] 8.8 WebRTC P2P 配信動作確認（ホスト `getDisplayMedia` → ゲスト `<audio>` 再生、超低遅延確認）

## Phase 9: ビルド・リリース準備
- [x] 9.1 `npm run build` — TypeScript コンパイル（main / renderer / server）
- [x] 9.2 `npm run dist` — electron-builder で Windows インストーラー生成（`assets/players/` を `extraResources` として含む）
- [x] 9.3 `npm run test` — Jest でサーバー単体テスト実行
- [x] 9.4 README.md 作成（起動方法、ビルド方法、簡易トラブルシューティング）
