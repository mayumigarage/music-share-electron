# MusicShare

複数人で同期して音楽を聴くことができる Electron + TypeScript アプリケーションです。YouTube・Spotify・Apple Music の URL を共有キューに追加し、各参加者のプレイヤーを同期して楽曲を共有できます。

Spotify／Apple Music の曲は、追加時に元サービスの曲名・アーティスト・ジャケットを取得し、`yt-dlp` で YouTube Music の再生候補を検索します。再生には常に YouTube プレイヤーを使用しますが、キュー上のサービス表示と元リンクは維持されます。

## 必要条件

- [Node.js](https://nodejs.org/) 18 以上
- npm（Node.js に同梱）
- [yt-dlp](https://github.com/yt-dlp/yt-dlp)（Spotify／Apple Music 等のリンクを再生するために必須）
- Windows 10/11（開発・実行ともに対応）

## インストール

```bash
npm install
```

### yt-dlp をインストールする

`yt-dlp` は Node.js の依存パッケージではなく、OS のコマンドとしてインストールします。PowerShell を開き、次のいずれかで導入してください。

```powershell
# winget を使う場合
winget install yt-dlp.yt-dlp

# Python/pip を使う場合
py -m pip install -U yt-dlp
```

インストール後、**新しい PowerShell** で以下が成功すれば準備完了です。

```powershell
yt-dlp --version
```

## 使い方

### 1. Socket.IO サーバーを起動する

```bash
npm run server
```

Socket.IO サーバーが `ws://localhost:5000` で起動します。このターミナルは開いたままにします。

### 2. Electron アプリを起動する

別のターミナルで：

```bash
npm start
```

Electron は起動時にプレイヤー用のローカル HTTP サーバーも自動で起動します。別途起動する必要はありません。

アプリが起動したら、ルーム作成モーダルで「ホスト配信」または「個別再生」を選び、ルームを作成します。他のユーザーは Room ID を入力して参加できます。

### 3. 曲を追加する

1. 「曲を追加」から YouTube、Spotify、または Apple Music の曲 URL を入力します。
2. 「URL を解析」を押します。
3. Spotify／Apple Music の場合、元サービスのメタデータを表示したまま、バックグラウンドで `yt-dlp` が YouTube Music の動画 ID を解決します。
4. プレビューを確認してキューへ追加します。再生時はサービスにかかわらず YouTube プレイヤーで再生されます。

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

### Spotify／Apple Music の URL を解析できない

- `yt-dlp --version` を実行し、`yt-dlp` が PATH から起動できることを確認してください。`yt-dlp` をインストールした直後は、Electron とターミナルを一度閉じて開き直してください。
- ネットワークから YouTube へ接続できるか確認してください。
- `yt-dlp` を最新版へ更新してください。

  ```powershell
  py -m pip install -U yt-dlp
  ```

## 技術スタック

- **Main Process**: Electron + TypeScript
- **Renderer Process**: TypeScript + 純正 HTML/CSS/JS
- **Server**: Node.js + TypeScript + Socket.IO

## ライセンス

MIT
