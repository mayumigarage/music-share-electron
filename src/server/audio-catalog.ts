/**
 * MusicShare — YouTube Backend via play-dl
 * (AIのブロックリストを排除し、play-dlによるリアルタイム抽出に差し替え)
 */

import play from 'play-dl';

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
 * 1. 検索用エンドポイント (/api/search-audio?q=キーワード) の実体
 */
export async function searchAudioCatalog(query: string): Promise<AudioSearchResult[]> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) return [];

  try {
    // YouTubeで動画を検索 (最大10件取得)
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
 * 2. ストリームURL取得用 (/api/get-audio-stream?sourceId=動画ID) の実体
 */
export async function resolveAuthorizedAudio(sourceId: string): Promise<AudioCatalogItem | null> {
  const normalizedId = sourceId.trim();
  if (!normalizedId) return null;

  try {
    const videoUrl = `https://www.youtube.com/watch?v=${normalizedId}`;

    // 1. まず動画の詳細情報をしっかりと取得
    const videoInfo = await play.video_info(videoUrl);
    const details = videoInfo.video_details;

    // 2. videoInfo の中から、条件に合う「最高音質の音声ストリームURL」を直接探す
    // quality: 2 に相当する、ビットレートが最も高い音声のみのフォーマット（audio/webm など）を抽出します
    const audioFormats = videoInfo.format.filter(f => f.mimeType?.startsWith('audio/'));
    
    // ビットレート順に並び替えて、一番高いものを取得
    const bestAudioFormat = audioFormats.sort((a, b) => {
      const bitRateA = a.bitrate ? parseInt(String(a.bitrate), 10) : 0;
      const bitRateB = b.bitrate ? parseInt(String(b.bitrate), 10) : 0;
      return bitRateB - bitRateA;
    })[0];

    // 万が一フォーマットが見つからなければ、一番最後のフォーマットのURLをフォールバックにする
    const directAudioUrl = bestAudioFormat?.url || videoInfo.format[videoInfo.format.length - 1]?.url;

    if (!directAudioUrl) {
      throw new Error('Streaming URL could not be found in video formats.');
    }

    return {
      id: normalizedId,
      title: details.title || 'Unknown Title',
      artist: details.channel?.name || 'Unknown Artist',
      audioUrl: directAudioUrl, // 👈 これで完全に型エラーが消え、安全にURLが渡せます！
      thumbnailUrl: details.thumbnails[0]?.url || '',
      durationSeconds: details.durationInSec,
    };
  } catch (error) {
    console.error('[YouTube Stream] Failed to resolve:', error);
    return null;
  }
}