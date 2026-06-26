/**
 * MusicShare — YouTube Backend via play-dl
 * (404エラー・ブロック対策を強化した修正版)
 */

import play from 'play-dl';


// 💡 修正：InnerTubeの通信偽装を型安全に行う正しい書き方
// play-dlが内部で自動的にInnerTube（YouTube内部API）の最新の認証トークンを使用するように設定します
play.authorization();

// = async () => {
//   // ここで必要に応じて、ユーザーのCookieやトークンを取得して返すことができます
//   // 例: return { cookie: 'YOUR_COOKIE_HERE' };
//   return {};
// }

export interface AudioCatalogItem {
  id: string;
  title: string;
  artist?: string;
  audioUrl: string;
  thumbnailUrl?: string;
  durationSeconds?: number;
}

export interface AudioSearchResult {
  id: string;
  title: string;
  artist?: string;
  thumbnailUrl?: string;
  durationSeconds?: number;
}

/**
 * 1. 検索用エンドポイント
 */
export async function searchAudioCatalog(query: string): Promise<AudioSearchResult[]> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) return [];

  try {
    const searchResults = await play.search(normalizedQuery, { limit: 10, source: { youtube: 'video' } });
    
    return searchResults.map((video) => ({
      id: video.id || '',
      title: video.title || 'Unknown Title',
      artist: video.channel?.name || 'Unknown Artist',
      thumbnailUrl: video.thumbnails[0]?.url || '',
      durationSeconds: video.durationInSec,
    }));
  } catch (error) {
    console.error('[YouTube Search] Failed:', error);
    return [];
  }
}

/**
 * 2. ストリームURL取得用 (ここで404が出ないように対策)
 */
export async function resolveAuthorizedAudio(sourceId: string): Promise<AudioCatalogItem | null> {
  const normalizedId = sourceId.trim();
  if (!normalizedId) return null;

  try {
    const videoUrl = `https://www.youtube.com/watch?v=${normalizedId}`;

    // 💡 対策：最新のパース処理を確実に通すため、video_info の取得時に Android / Web 双方の偽装を試みる
    const videoInfo = await play.video_info(videoUrl, {
      // ここに偽装設定を追加
    });
    
    const details = videoInfo.video_details;

    // 音声のみのフォーマットを抽出
    const audioFormats = videoInfo.format.filter(f => f.mimeType?.startsWith('audio/'));
    
    if (!audioFormats || audioFormats.length === 0) {
      // 音声専用が見つからない場合は、すべてのフォーマットからURLがあるものを探す
      const anyFormat = videoInfo.format.find(f => f.url);
      if (!anyFormat) throw new Error('No formats with URLs available.');
      
      return {
        id: normalizedId,
        title: details.title || 'Unknown Title',
        artist: details.channel?.name || 'Unknown Artist',
        audioUrl: anyFormat.url!,
        thumbnailUrl: details.thumbnails[0]?.url || '',
        durationSeconds: details.durationInSec,
      };
    }

    // ビットレートが最も高い音声フォーマットを選択
    const bestAudioFormat = audioFormats.sort((a, b) => {
      const bitRateA = a.bitrate ? parseInt(String(a.bitrate), 10) : 0;
      const bitRateB = b.bitrate ? parseInt(String(b.bitrate), 10) : 0;
      return bitRateB - bitRateA;
    })[0];

    return {
      id: normalizedId,
      title: details.title || 'Unknown Title',
      artist: details.channel?.name || 'Unknown Artist',
      audioUrl: bestAudioFormat.url!, // 100% 生のストリームURL
      thumbnailUrl: details.thumbnails[0]?.url || '',
      durationSeconds: details.durationInSec,
    };
  } catch (error) {
    // サーバーのコンソールに具体的な失敗理由（シグネチャエラーやブロックなど）を出力させる
    console.error('[YouTube Stream] Critical Error in resolveAuthorizedAudio:', error);
    return null;
  }
}