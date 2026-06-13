# MusicShare

複数人で同期して音楽を聴くことができる Electron + TypeScript アプリケーションです。YouTube・Spotify・Apple Music の URL をキューに追加し、ホスト配信（WebRTC P2P）または個別再生モードで楽曲を共有できます。

## 必要条件

- [Node.js](https://nodejs.org/) 18 以上
- npm（Node.js に同梱）
- Windows 10/11（開発・実行ともに対応）

## インストール

```bash
npm install
```

## 使い方

### 1. サーバーを起動する

```bash
npm run server
```

Socket.IO サーバーが `ws://localhost:5000` で起動します。

### 2. Electron アプリを起動する

別のターミナルで：

```bash
npm start
```

アプリが起動したら、ルーム作成モーダルで「ホスト配信」または「個別再生」を選び、ルームを作成します。他のユーザーは Room ID を入力して参加できます。

## スクリプト一覧

| スクリプト | 説明 |
|-----------|------|
| `npm start` | TypeScript コンパイル後、Electron アプリを起動 |
| `npm run server` | TypeScript コンパイル後、Socket.IO サーバーを起動 |
| `npm run build` | main / renderer / server の TypeScript を一括コンパイル |
| `npm run dist` | electron-builder で Windows インストーラー（`.exe`）を生成 |
| `npm run lint` | 型チェックのみ実行（ファイルは出力しない） |
| `npm test` | Jest でサーバー側の単体テストを実行 |

## ビルド

### TypeScript コンパイル

```bash
npm run build
```

- `dist/main/` — Main Process（Electron）
- `dist/renderer/` — Renderer Process（UI）
- `dist/server/` — Socket.IO サーバー

### インストーラー生成

```bash
npm run dist
```

`release/` ディレクトリに以下が生成されます：

- `MusicShare Setup 1.0.0.exe` — Windows インストーラー
- `win-unpacked/` — 展開済みアプリ（インストール不要で実行可能）

> `assets/players/`（YouTubePlayer.html など）は `extraResources` としてパッケージに含まれます。

## テスト

```bash
npm test
```

Jest を使用したサーバー側の単体テストが実行されます：

- `src/server/__tests__/room-manager.test.ts`
- `src/server/__tests__/handlers.test.ts`

## トラブルシューティング

### `npm run build` で型エラーが出る

- `npm install` を再実行し、依存関係が揃っているか確認してください。
- `tsc -p tsconfig.server.json --noEmit` など個別に型チェックすると原因を絞り込めます。

### `npm run dist` でパッケージングに失敗する

- `npm run build` が成功していることを前提としています。先にビルドを通してください。
- インストーラー生成時に NSIS などのバイナリを自動ダウンロードします。プロキシ環境の場合は `ELECTRON_BUILDER_HTTP_PROXY` などの環境変数を設定してください。

### Electron アプリが真っ暗で何も表示されない

- `src/renderer/index.html` が存在するか確認してください。
- コンソールにエラーが出ていないか、`Ctrl+Shift+I`（Developer Tools）で確認してください。

### サーバーに接続できない

- `npm run server` でサーバーが起動しているか確認してください。
- ファイアウォールでポート 5000 がブロックされていないか確認してください。

### WebRTC（ホスト配信）で音声が届かない

- ホスト側で `getDisplayMedia` の音声キャプチャ許可ダイアログが表示されたか確認してください。
- ゲスト側のブラウザ / Electron で `<audio>` 要素が mute になっていないか確認してください。
- ネットワークが対称型 NAT（Symmetric NAT）の場合、STUN サーバー（`stun:stun.l.google.com:19302`）だけでは P2P 接続が確立できないことがあります。

## 技術スタック

- **Main Process**: Electron + TypeScript
- **Renderer Process**: TypeScript + 純正 HTML/CSS/JS
- **Server**: Node.js + TypeScript + Socket.IO
- **P2P 音声**: WebRTC (`RTCPeerConnection` + `getDisplayMedia`)

## ライセンス

MIT
