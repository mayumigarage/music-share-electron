# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

MusicShare は、複数人で曲を同期再生する Electron + TypeScript アプリ（Socket.IO サーバー同梱）。コメント・UI 文言・README は日本語。

## コマンド

```bash
npm start          # renderer を esbuild + main を tsc → Electron 起動（サーバーはビルドも起動もしない）
npm run server     # Socket.IO サーバーをビルドして起動（ポート 5000、PORT で変更可）
npm run build      # server / renderer / main を一括ビルド（dist/）
npm run lint       # 型チェックのみ（tsc --noEmit を 3 つの tsconfig で実行。ESLint はない）
npm test           # Jest（対象は src/server/__tests__ のみ）
npx jest src/server/__tests__/handlers.test.ts    # 単一ファイル
npx jest -t "テスト名の一部"                       # 単一テスト
npm run dist:win   # Windows インストーラー（release/）
npm run dist:mac   # macOS 用（macOS 上で実行すること）
```

- renderer は esbuild でバンドルするため型エラーがあっても `npm start` は通る。変更後は `npm run lint` を実行する。
- 開発時の曲解決には PATH 上の `yt-dlp` が必要。パッケージ版 Windows は `tools/yt-dlp.exe` を同梱して使う（`getYtDlpCommand()`）。

## 接続先サーバーに注意

`npm run server` を起動しても、**アプリは既定でローカルではなく本番の Render（`https://music-share-electron-server.onrender.com`）に接続する**（README の localhost:5000 の記述とは異なる）。URL は 3 か所に別々にある。

| 用途 | 場所 | 上書き手段 |
|---|---|---|
| Socket.IO | `src/renderer/sync/websocket-client.ts` | なし（直書き） |
| audio-only API | `src/renderer/sync/audio-only-player.ts` | `globalThis.MUSICSHARE_AUDIO_API_BASE_URL` |
| Spotify メタデータ | `src/main/track-resolver.ts` | 環境変数 `MUSIC_SHARE_SERVER_URL` |

サーバー側の変更をアプリで確認するには、接続先を一時的にローカルへ向ける必要がある。

## `src/` にコンパイル済みファイルを置かない

renderer は `../../shared/models.js` のように `.js` 付きで import し、esbuild が `models.ts` に解決する。`src/shared/` に実体の `models.js` があると **esbuild も Jest もそちらを優先し**、`models.ts` の変更が型チェックを通ったまま実行時に反映されなくなる。出力先は `dist/` のみ。

## アーキテクチャ

### プロセス構成

- **Main（`src/main/`）**: `BaseWindow` に全面表示の `WebContentsView` を 1 枚だけ載せる。外部アクセスを伴う処理を担当する — URL 解決と yt-dlp 実行（`track-resolver.ts`）、プレイリスト取り込み（`playlist-importer.ts`）、プレイリスト保存、Spotify OAuth PKCE（`musicshare://` プロトコルでコールバック）。IPC ハンドラの大半は `window-manager.ts`、一部（audio 系のプレースホルダ実装）は `main.ts`。
- **Renderer（`src/renderer/`）**: フレームワークなしの DOM。React は `ui/icons.ts` でアイコンを静的 HTML 文字列にする用途だけ。CSS はすべて `index.html` 内。`ui/app.ts` が全パネルを束ねる中心。
- **Server（`src/server/`）**: `room-manager.ts`（インメモリの状態と規則）と `handlers.ts`（Socket.IO の入出力）に分離。`server.ts` は HTTP API（Spotify メタデータ、`/api/search-audio`、`/api/get-audio-stream`）も提供する。Spotify API には `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` が必要。

renderer は `file://` ではなく、main が立てる `http://127.0.0.1:<port>` のローカルサーバー（`renderer-server.ts`）から読み込む。YouTube IFrame API が origin/referrer のない文書を拒否するため。

Electron は Widevine 対応の castLabs フォーク。`widevine-ready` を待ってからウィンドウを作る（発火しない場合の `whenReady` フォールバックあり）。

### IPC を追加するとき

`src/shared/preload-api.ts`（型）→ `src/preload/preload.ts` → `window-manager.ts` の `ipcMain.handle` の順にそろえ、`WindowManager.destroy()` の `removeHandler` にも追加する。引数は main 側で型検証する。

### プレイヤー

プレイヤーは `WebContentsView` や別 HTML ではなく **renderer の DOM 要素**。`sync/player-proxy.ts` が次の 2 実装を切り替える。切り替え基準はルーム作成時に選ぶ `RoomPlayerType`。

- `youtube`: `dom-youtube-player.ts`（IFrame API）。`track.resolvedVideoId` を再生する。
- `html-video`: `dom-video-player.ts`。IPC `resolveHtmlVideoSource`（yt-dlp）で直接 URL を取得し、先の 3 曲を事前読み込みする。

Spotify / Apple Music の曲も、元サービスのメタデータと URL を保ったまま YouTube の動画に解決して再生する。

`PlayerProxy` は 2 インスタンスある。共有ルーム用（`SyncEngine` が制御）と、ローカルプレイリスト再生のフローティングミニプレイヤー用（サーバーと同期しない）。audio-only 検索再生（`audio-only-player.ts`）はさらに別系統。

### 同期モデル

- キュー・履歴・再生状態の正はサーバー。**再生中の曲はキューに残ったまま**で、終了/スキップ時にキューから履歴へ移る。キューにない曲を指す `UpdatePlayerState` はサーバーが拒否し、renderer も古いローカル状態を無視する。
- 空のキューに曲を追加すると、サーバーが自動で再生状態にする。
- ホストは 1 秒ごとに `PlayerState` を送信し、`ended` で `TrackFinished` を送る。再生失敗した曲もホストが `TrackFinished` で飛ばす。ゲストは差が 2 秒を超えたときだけシークする。
- イベント型は `src/shared/models.ts` の `ClientToServerEvents` / `ServerToClientEvents` が定義元。キュー操作は個別イベント（`AddTrack` / `RemoveTrack` / `ReorderQueue`）を送り、画面の再描画は `QueueUpdated` で行う（`TrackAdded` は追加ハイライト用）。
- `RoomMode` は `Individual` のみ。WebRTC による HostBroadcast 配信は削除済み。

### 永続化

サーバーには永続化層を置かない。ユーザーのローカルプレイリストは main 経由でファイル保存し（`playlist-storage.ts`、`ui/playlist-store.ts` が旧 localStorage 形式から移行）、UI 設定は localStorage。

## 設計上の制約

- `contextIsolation: true` / `nodeIntegration: false` / `sandbox: true` を維持し、renderer から Node.js API を使わず preload 経由にする。`webSecurity: false` は使わない。
- Main には UI ロジックや再生状態を持たせない。
- `autoplay-policy` は `webPreferences` ではなく `app.commandLine.appendSwitch()` で設定する。

## 秘密情報

- YouTube Data API キーは環境変数 `YOUTUBE_DATA_API_KEY`（または `GOOGLE_API_KEY`）、あるいは `resources/youtube-data-api-key.txt`（git ignore 済み）。
- ルートの `cookies.txt`（yt-dlp 用、git ignore 済み）と上記キーファイルは、`electron-builder.yml` の `extraResources` により**インストーラーに同梱される**。配布前に中身を確認する。
