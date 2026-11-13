import { ApiError, extensionFromMime, sanitizeFilename } from './_utils.js';

const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const MOBILE_UA =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';
const CRAWLER_UA = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';
const X_BOT_UA = 'Twitterbot/1.0';
const HTML_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
const IG_APP_ID = '936619743392459';
const YOUTUBE_API_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';

const INNERTUBE_CLIENTS = [
  {
    name: 'ANDROID_VR',
    clientName: 'ANDROID_VR',
    clientVersion: '1.62.27',
    deviceMake: 'Oculus',
    deviceModel: 'Quest 3',
    androidSdkVersion: 32,
    osName: 'Android',
    osVersion: '12',
    clientId: '28',
    userAgent:
      'com.google.android.apps.youtube.vr.oculus/1.62.27 (Linux; U; Android 12; en-US; Quest 3 Build/SQ3A.220605.009.A1) gzip',
  },
  {
    name: 'IOS',
    clientName: 'IOS',
    clientVersion: '19.45.4',
    deviceMake: 'Apple',
    deviceModel: 'iPhone16,2',
    osName: 'iPhone',
    osVersion: '18.1.0.22B83',
    clientId: '5',
    userAgent: 'com.google.ios.youtube/19.45.4 (iPhone16,2; U; CPU iOS 18_1_0 like Mac OS X;)',
  },
];

const CACHE_TTL_MS = 90_000;
const CACHE_MAX_ENTRIES = 40;
const cache = new Map();

export const PLATFORM_LABELS = {
  youtube: 'YouTube',
  tiktok: 'TikTok',
  instagram: 'Instagram',
  x: 'X (Twitter)',
  facebook: 'Facebook',
};

export const SUPPORTED_PLATFORMS = Object.keys(PLATFORM_LABELS);

export function detectPlatform(input) {
  const url = toUrl(input);
  if (!url) return null;

  const host = url.hostname.replace(/^www\./i, '').toLowerCase();

  if (host === 'youtu.be' || host === 'youtube.com' || host.endsWith('.youtube.com')) return 'youtube';
  if (host === 'youtube-nocookie.com' || host.endsWith('.youtube-nocookie.com')) return 'youtube';
  if (host === 'tiktok.com' || host.endsWith('.tiktok.com')) return 'tiktok';
  if (host === 'instagram.com' || host.endsWith('.instagram.com')) return 'instagram';
  if (host === 'x.com' || host.endsWith('.x.com') || host === 'twitter.com' || host.endsWith('.twitter.com')) return 'x';
  if (host === 'fb.watch' || host === 'facebook.com' || host.endsWith('.facebook.com') || host === 'fb.com') {
    return 'facebook';
  }

  return null;
}

export async function extractMedia(input) {
  const url = normalizeUrl(input);
  const cacheKey = url.href;

  const cached = readCache(cacheKey);
  if (cached) return cached;

  const platform = detectPlatform(cacheKey);
  const label = PLATFORM_LABELS[platform] || platform;

  let media;
  try {
    if (platform === 'youtube') media = await extractYouTube(cacheKey);
    else if (platform === 'tiktok') media = await extractTikTok(cacheKey);
    else if (platform === 'instagram') media = await extractInstagram(cacheKey);
    else if (platform === 'x') media = await extractX(cacheKey);
    else if (platform === 'facebook') media = await extractFacebook(cacheKey);
    else throw new ApiError('Platform tidak didukung.', 422, 'UNSUPPORTED_PLATFORM');
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      `Gagal mengambil media dari ${label}. Coba lagi beberapa saat atau gunakan tautan lain.`,
      502,
      'EXTRACTION_FAILED',
      { reason: String(error?.message || error).slice(0, 180) },
    );
  }

  const normalized = {
    platform,
    platformLabel: label,
    sourceUrl: cacheKey,
    title: cleanText(media.title) || `Media ${label}`,
    author: cleanText(media.author) || null,
    thumbnail: media.thumbnail || null,
    duration: toPositiveNumber(media.duration),
    video: collapseStreams(media.video || []),
    audio: collapseStreams(media.audio || []),
    photo: uniquePhotos(media.photo || []),
    note: media.note || null,
    extractedAt: new Date().toISOString(),
  };

  if (!normalized.video.length && !normalized.audio.length && !normalized.photo.length) {
    throw new ApiError(
      `Tidak ada media yang bisa diunduh dari tautan ${label} ini. Pastikan postingan bersifat publik.`,
      422,
      'NO_MEDIA_FOUND',
    );
  }

  writeCache(cacheKey, normalized);
  return normalized;
}

export function toPublicInfo(media) {
  const publicStream = (item) => ({
    quality: item.quality || null,
    label: item.label || null,
    ext: item.ext || null,
    mimeType: item.mimeType || null,
    width: item.width || null,
    height: item.height || null,
    bitrate: item.bitrate || null,
    size: item.size || null,
    hasAudio: item.hasAudio !== false,
    watermark: Boolean(item.watermark),
  });

  return {
    ok: true,
    platform: media.platform,
    platformLabel: media.platformLabel,
    title: media.title,
    author: media.author,
    thumbnail: media.thumbnail,
    duration: media.duration,
    sourceUrl: media.sourceUrl,
    note: media.note,
    extractedAt: media.extractedAt,
    formats: {
      video: media.video.map(publicStream),
      audio: media.audio.map(publicStream),
      photo: media.photo.map((item) => ({
        width: item.width || null,
        height: item.height || null,
        ext: item.ext || 'jpg',
      })),
    },
    available: {
      video: media.video.length > 0,
      audio: media.audio.length > 0,
      photo: media.photo.length > 0,
    },
  };
}

export function buildDownload(media, options = {}) {
  const format = ['video', 'audio', 'photo'].includes(options.format) ? options.format : 'video';
  const list = media[format] || [];

  if (!list.length) {
    const label = format === 'audio' ? 'Audio' : format === 'photo' ? 'Foto' : 'Video';
    throw new ApiError(
      `Format ${label} tidak tersedia untuk media ini. Silakan pilih format lain.`,
      422,
      'FORMAT_UNAVAILABLE',
    );
  }

  let selected;
  let index = null;

  if (format === 'photo') {
    const parsed = Number.parseInt(options.index, 10);
    index = Number.isInteger(parsed) ? Math.min(Math.max(parsed, 0), list.length - 1) : 0;
    selected = list[index];
  } else {
    selected = pickStream(list, options.quality);
  }

  const ext =
    selected.ext ||
    extensionFromMime(selected.mimeType) ||
    (format === 'audio' ? 'm4a' : format === 'photo' ? 'jpg' : 'mp4');

  const filename = `${sanitizeFilename(media.title, `xena-${media.platform}`)}.${ext}`;

  return {
    ok: true,
    platform: media.platform,
    platformLabel: media.platformLabel,
    title: media.title,
    author: media.author,
    thumbnail: media.thumbnail,
    duration: media.duration,
    format,
    requestedQuality: options.quality || null,
    quality: selected.quality || null,
    label: selected.label || null,
    ext,
    mimeType: selected.mimeType || null,
    downloadUrl: selected.url,
    filename,
    size: selected.size || null,
    hasAudio: selected.hasAudio !== false,
    photoIndex: index,
    downloads: list.map((item, i) => ({
      index: i,
      quality: item.quality || null,
      label: item.label || null,
      url: item.url,
      ext: item.ext || extensionFromMime(item.mimeType) || ext,
      width: item.width || null,
      height: item.height || null,
      size: item.size || null,
      hasAudio: item.hasAudio !== false,
      watermark: Boolean(item.watermark),
    })),
    extractedAt: media.extractedAt,
  };
}

async function extractYouTube(sourceUrl) {
  const id = youtubeId(sourceUrl);
  if (!id) throw new ApiError('Tautan YouTube tidak valid.', 400, 'INVALID_YOUTUBE_URL');

  const errors = [];

  for (const client of INNERTUBE_CLIENTS) {
    try {
      const data = await youtubePlayer(id, client);
      const media = youtubeMedia(data);
      if (media.video.length || media.audio.length) return media;
      throw new Error('Tidak ada stream video/audio');
    } catch (error) {
      errors.push(`${client.name}: ${String(error?.message || error).slice(0, 120)}`);
    }
  }

  throw new ApiError(
    'YouTube menolak permintaan dari server ini. Coba lagi beberapa saat atau gunakan tautan dari platform lain.',
    502,
    'YOUTUBE_EXTRACTION_FAILED',
    { attempts: errors },
  );
}

async function youtubePlayer(videoId, client) {
  const clientContext = {
    clientName: client.clientName,
    clientVersion: client.clientVersion,
    deviceMake: client.deviceMake,
    deviceModel: client.deviceModel,
    osName: client.osName,
    osVersion: client.osVersion,
    hl: 'en',
    gl: 'US',
    userAgent: client.userAgent,
    utcOffsetMinutes: 0,
  };

  if (client.androidSdkVersion) clientContext.androidSdkVersion = client.androidSdkVersion;

  const data = await fetchJson(
    `https://www.youtube.com/youtubei/v1/player?key=${YOUTUBE_API_KEY}&prettyPrint=false`,
    {
      method: 'POST',
      timeout: 9_000,
      body: JSON.stringify({
        context: { client: clientContext },
        videoId,
        contentCheckOk: true,
        racyCheckOk: true,
      }),
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': client.userAgent,
        'X-YouTube-Client-Name': client.clientId,
        'X-YouTube-Client-Version': client.clientVersion,
        Origin: 'https://www.youtube.com',
        Referer: 'https://www.youtube.com/',
      },
    },
  );

  const status = data?.playabilityStatus?.status;
  if (status && status !== 'OK') {
    throw new Error(data?.playabilityStatus?.reason || status);
  }
  if (!data?.streamingData) throw new Error('Streaming data tidak tersedia');

  return data;
}

function youtubeMedia(data) {
  const details = data.videoDetails || {};
  const muxedFormats = Array.isArray(data.streamingData?.formats) ? data.streamingData.formats : [];
  const adaptiveFormats = Array.isArray(data.streamingData?.adaptiveFormats) ? data.streamingData.adaptiveFormats : [];

  const formats = [
    ...muxedFormats.map((item) => ({ ...item, muxed: true })),
    ...adaptiveFormats.map((item) => ({ ...item, muxed: false })),
  ].filter((item) => item?.url);

  const videoCandidates = formats.filter((item) => /^video\//i.test(item.mimeType || ''));
  const mp4Video = videoCandidates.filter((item) => /mp4/i.test(item.mimeType || ''));
  const selectedVideo = mp4Video.length ? mp4Video : videoCandidates;

  const video = selectedVideo.map((item) => {
    const height = toPositiveNumber(item.height) || heightFromLabel(item.qualityLabel);
    const mimeType = normalizeMime(item.mimeType, 'video/mp4');
    return makeStream({
      url: item.url,
      quality: normalizeQuality(item.qualityLabel, height),
      label: item.qualityLabel ? `${item.qualityLabel} MP4` : height ? `${height}p MP4` : 'MP4',
      mimeType,
      width: toPositiveNumber(item.width),
      height,
      bitrate: toPositiveNumber(item.bitrate),
      size: toPositiveNumber(item.contentLength),
      hasAudio: Boolean(item.muxed),
    });
  });

  const audioCandidates = formats.filter((item) => /^audio\//i.test(item.mimeType || ''));
  const m4aAudio = audioCandidates.filter((item) => /audio\/mp4/i.test(item.mimeType || ''));
  const selectedAudio = m4aAudio.length ? m4aAudio : audioCandidates;

  const audio = selectedAudio.map((item) => {
    const bitrate = toPositiveNumber(item.bitrate);
    const mimeType = normalizeMime(item.mimeType, 'audio/mp4');
    const isM4a = /audio\/mp4/i.test(mimeType);
    return makeStream({
      url: item.url,
      quality: audioQuality(bitrate) || '128kbps',
      label: bitrate ? `${Math.round(bitrate / 1000)} kbps M4A` : 'M4A',
      mimeType,
      ext: isM4a ? 'm4a' : undefined,
      bitrate,
      size: toPositiveNumber(item.contentLength),
      hasAudio: true,
    });
  });

  const thumbnails = details.thumbnail?.thumbnails || [];
  const bestThumb = [...thumbnails].sort((a, b) => (b.width || 0) - (a.width || 0))[0];
  const hasVideoOnly = video.some((item) => !item.hasAudio);

  return {
    title: details.title,
    author: details.author || details.ownerChannelName,
    thumbnail: bestThumb?.url || null,
    duration: toPositiveNumber(details.lengthSeconds),
    video,
    audio,
    photo: [],
    note: hasVideoOnly ? 'Kualitas tinggi YouTube tersedia sebagai video-only; unduh audio M4A secara terpisah.' : null,
  };
}

async function extractTikTok(sourceUrl) {
  const id = tiktokId(sourceUrl);
  const errors = [];
  const attempts = [
    () => tiktokFromPage(sourceUrl),
    id ? () => tiktokFromPage(`https://m.tiktok.com/v/${id}.html`) : null,
    id ? () => tiktokFromEmbed(id) : null,
  ].filter(Boolean);

  for (const attempt of attempts) {
    try {
      return await attempt();
    } catch (error) {
      errors.push(String(error?.message || error).slice(0, 120));
    }
  }

  throw new ApiError(
    'TikTok tidak dapat memproses tautan ini. Pastikan video bersifat publik dan coba lagi.',
    502,
    'TIKTOK_EXTRACTION_FAILED',
    { attempts: errors },
  );
}

async function tiktokFromPage(sourceUrl) {
  const html = await fetchText(sourceUrl, {
    timeout: 10_000,
    headers: {
      'User-Agent': MOBILE_UA,
      Accept: HTML_ACCEPT,
      Referer: 'https://www.tiktok.com/',
    },
  });

  if (!html || html.length < 1_000) throw new Error('Halaman TikTok kosong');

  const scripts = [
    readJsonScriptById(html, '__UNIVERSAL_DATA_FOR_REHYDRATION__'),
    readJsonScriptById(html, 'SIGI_STATE'),
    readJsonScriptById(html, 'api-data'),
  ].filter(Boolean);

  for (const data of scripts) {
    const item = findTikTokItem(data);
    if (item) return tiktokItemToMedia(item);
  }

  const fallback = tiktokFromHtml(html);
  if (fallback) return fallback;

  throw new Error('Data video TikTok tidak ditemukan');
}

async function tiktokFromEmbed(id) {
  const errors = [];

  for (const url of [`https://www.tiktok.com/embed/v2/${id}`, `https://www.tiktok.com/embed/${id}`]) {
    try {
      const html = await fetchText(url, {
        timeout: 8_000,
        headers: {
          'User-Agent': MOBILE_UA,
          Accept: HTML_ACCEPT,
          Referer: 'https://www.tiktok.com/',
        },
      });

      const scripts = [
        readJsonScriptById(html, '__UNIVERSAL_DATA_FOR_REHYDRATION__'),
        readJsonScriptById(html, 'SIGI_STATE'),
        readJsonScriptById(html, 'api-data'),
      ].filter(Boolean);

      for (const data of scripts) {
        const item = findTikTokItem(data);
        if (item) return tiktokItemToMedia(item);
      }

      const fallback = tiktokFromHtml(html);
      if (fallback) return fallback;
    } catch (error) {
      errors.push(String(error?.message || error).slice(0, 100));
    }
  }

  throw new Error(`Embed TikTok gagal: ${errors.join('; ')}`);
}

function findTikTokItem(data) {
  const scopes = [data?.__DEFAULT_SCOPE__, data?.defaultScope, data];

  const direct = data?.videoDetail?.itemInfo?.itemStruct;
  if (direct?.video || direct?.imagePost) return direct;

  for (const scope of scopes) {
    if (!scope || typeof scope !== 'object') continue;

    for (const key of ['webapp.reflow.video.detail', 'webapp.video-detail']) {
      const detail = scope[key];
      const item = detail?.itemInfo?.itemStruct || detail?.itemStruct;
      if (item?.video || item?.imagePost) return item;
    }

    const itemModule = scope.ItemModule;
    if (itemModule && typeof itemModule === 'object') {
      const item = Object.values(itemModule).find((value) => value?.video || value?.imagePost);
      if (item) return item;
    }
  }

  return findDeep(
    data,
    (value) => Boolean(value?.video?.playAddr || value?.video?.downloadAddr || value?.imagePost?.images?.length),
    10,
  );
}

function tiktokItemToMedia(item) {
  const videoInfo = item.video || {};
  const author = item.author || {};
  const height = toPositiveNumber(videoInfo.height) || toPositiveNumber(videoInfo.width) || null;
  const video = [];

  const addVideo = (rawUrl, options = {}) => {
    const url = decodeJsonish(rawUrl);
    if (!url) return;
    const itemHeight = toPositiveNumber(options.height) || height;
    video.push(
      makeStream({
        url,
        quality: qualityFromHeight(itemHeight) || '720p',
        label: itemHeight ? `${itemHeight}p${options.label ? ` ${options.label}` : ''}` : options.label || 'Video',
        mimeType: 'video/mp4',
        width: toPositiveNumber(options.width) || toPositiveNumber(videoInfo.width),
        height: itemHeight,
        bitrate: toPositiveNumber(options.bitrate),
        hasAudio: true,
      }),
    );
  };

  const bitrateInfo = Array.isArray(videoInfo.bitrateInfo) ? videoInfo.bitrateInfo : [];
  for (const entry of bitrateInfo) {
    const playAddr = entry?.PlayAddr || entry?.playAddr;
    const urls = playAddr?.UrlList || playAddr?.urlList || [];
    for (const rawUrl of urls) {
      addVideo(rawUrl, {
        height: toPositiveNumber(playAddr?.Height) || toPositiveNumber(entry?.Height),
        width: toPositiveNumber(playAddr?.Width) || toPositiveNumber(entry?.Width),
        bitrate: toPositiveNumber(entry?.Bitrate),
        label: 'Tanpa watermark',
      });
    }
  }

  addVideo(videoInfo.playAddr, { label: 'Tanpa watermark' });
  addVideo(videoInfo.downloadAddr, { label: 'Unduhan' });

  const photo = [];
  const images = Array.isArray(item.imagePost?.images) ? item.imagePost.images : [];

  for (const image of images) {
    const imageUrl =
      image?.imageURL?.urlList?.[0] ||
      image?.imageURL ||
      image?.displayImage?.urlList?.[0] ||
      image?.displayImage ||
      image?.url;
    const url = decodeJsonish(imageUrl);
    if (!url) continue;
    photo.push({
      url,
      ext: 'jpg',
      width: toPositiveNumber(image?.imageWidth) || toPositiveNumber(image?.width),
      height: toPositiveNumber(image?.imageHeight) || toPositiveNumber(image?.height),
    });
  }

  const musicUrl = decodeJsonish(item.music?.playUrl);
  const audio = musicUrl
    ? [
        makeStream({
          url: musicUrl,
          quality: '128kbps',
          label: 'Audio original',
          mimeType: 'audio/mp4',
          ext: 'm4a',
          bitrate: 128_000,
          hasAudio: true,
        }),
      ]
    : [];

  if (!video.length && !audio.length && !photo.length) throw new Error('Media TikTok tidak ditemukan');

  const thumbnail =
    decodeJsonish(videoInfo.originCover) ||
    decodeJsonish(videoInfo.cover) ||
    decodeJsonish(videoInfo.dynamicCover) ||
    photo[0]?.url ||
    null;

  return {
    title: item.desc || item.title || (photo.length ? 'Slide foto TikTok' : 'Video TikTok'),
    author: author.nickname || (author.uniqueId ? `@${author.uniqueId}` : null),
    thumbnail,
    duration: toPositiveNumber(videoInfo.duration) || toPositiveNumber(item.duration),
    video,
    audio,
    photo,
    note: photo.length ? 'Postingan ini berisi slide foto.' : null,
  };
}

function tiktokFromHtml(html) {
  const playUrl = firstMatch(html, /"playAddr"\s*:\s*"([^"]+)"/);
  const downloadUrl = firstMatch(html, /"downloadAddr"\s*:\s*"([^"]+)"/);
  const cover = firstMatch(html, /"(?:originCover|cover|dynamicCover)"\s*:\s*"([^"]+)"/);
  const title = firstMatch(html, /"(?:desc|title)"\s*:\s*"([^"]+)"/);
  const nickname = firstMatch(html, /"nickname"\s*:\s*"([^"]+)"/);
  const uniqueId = firstMatch(html, /"uniqueId"\s*:\s*"([^"]+)"/);
  const video = [];

  for (const rawUrl of [playUrl, downloadUrl]) {
    const url = decodeJsonish(rawUrl);
    if (!url) continue;
    video.push(
      makeStream({
        url,
        quality: '720p',
        label: 'Video',
        mimeType: 'video/mp4',
        hasAudio: true,
      }),
    );
  }

  if (!video.length) return null;

  return {
    title: decodeJsonish(title) || 'Video TikTok',
    author: decodeJsonish(nickname) || (uniqueId ? `@${decodeJsonish(uniqueId)}` : null),
    thumbnail: decodeJsonish(cover),
    duration: null,
    video,
    audio: [],
    photo: [],
  };
}

async function extractInstagram(sourceUrl) {
  const shortcode = instagramShortcode(sourceUrl);
  if (!shortcode) throw new ApiError('Tautan Instagram tidak valid.', 400, 'INVALID_INSTAGRAM_URL');

  const errors = [];
  const attempts = [
    () => instagramFromEmbed(shortcode),
    () => instagramFromPage(shortcode),
    () => instagramFromJson(shortcode),
  ];

  for (const attempt of attempts) {
    try {
      return await attempt();
    } catch (error) {
      errors.push(String(error?.message || error).slice(0, 100));
    }
  }

  throw new ApiError(
    'Instagram tidak dapat memproses tautan ini. Pastikan postingan publik dan bukan dari akun privat.',
    502,
    'INSTAGRAM_EXTRACTION_FAILED',
    { attempts: errors },
  );
}

async function instagramFromEmbed(shortcode) {
  const html = await fetchText(`https://www.instagram.com/p/${shortcode}/embed/captioned/`, {
    timeout: 8_000,
    headers: {
      'User-Agent': DESKTOP_UA,
      Accept: HTML_ACCEPT,
      Referer: 'https://www.instagram.com/',
    },
  });

  const media = parseInstagramHtml(html, shortcode);
  if (!media) throw new Error('Media tidak ditemukan pada embed');
  return media;
}

async function instagramFromPage(shortcode) {
  const html = await fetchText(`https://www.instagram.com/p/${shortcode}/`, {
    timeout: 8_000,
    headers: {
      'User-Agent': DESKTOP_UA,
      Accept: HTML_ACCEPT,
      Referer: 'https://www.instagram.com/',
    },
  });

  const media = parseInstagramHtml(html, shortcode);
  if (!media) throw new Error('Media tidak ditemukan pada halaman');
  return media;
}

async function instagramFromJson(shortcode) {
  const data = await fetchJson(`https://www.instagram.com/p/${shortcode}/?__a=1&__d=dis`, {
    timeout: 8_000,
    headers: {
      'User-Agent': `${MOBILE_UA} Instagram 320.0.0.42.101`,
      Accept: 'application/json',
      'x-ig-app-id': IG_APP_ID,
      Referer: 'https://www.instagram.com/',
    },
  });

  const node = findKeyDeep(data, 'shortcode_media') || data?.items?.[0] || data?.data?.items?.[0];
  if (!node) throw new Error('JSON Instagram tidak berisi media');

  return instagramNodeToMedia(node, shortcode);
}

function parseInstagramHtml(html, shortcode) {
  if (!html || html.length < 200) return null;

  const candidates = [];
  const gqlData = extractJsonAfterKey(html, 'gql_data');
  if (gqlData) candidates.push(findKeyDeep(gqlData, 'shortcode_media'));

  const direct = extractJsonAfterKey(html, 'shortcode_media');
  if (direct) candidates.push(direct);

  const additional = extractJsonAfterPattern(html, /__additionalDataLoaded\s*\([^,]*,\s*/);
  if (additional) candidates.push(findKeyDeep(additional, 'shortcode_media') || additional);

  for (const script of readJsonScripts(html)) {
    const node = findKeyDeep(script, 'shortcode_media');
    if (node) candidates.push(node);
  }

  for (const node of candidates) {
    if (!node || typeof node !== 'object') continue;
    try {
      return instagramNodeToMedia(node, shortcode);
    } catch {
      continue;
    }
  }

  const videoUrls = uniqueByUrl(extractEncodedUrls(html, /"video_url"\s*:\s*"([^"]+)"/g));
  const imageUrls = uniqueByUrl([
    ...extractEncodedUrls(html, /"(?:display_url|display_src|thumbnail_src)"\s*:\s*"([^"]+)"/g),
    findMeta(html, 'og:image'),
  ])
    .map((value) => (typeof value === 'string' ? decodeHtml(value) : value))
    .filter(Boolean);

  const ogVideo = findMeta(html, 'og:video') || findMeta(html, 'og:video:url');
  if (ogVideo) videoUrls.push(decodeHtml(ogVideo));

  const title = findMeta(html, 'og:title') || findMeta(html, 'twitter:title');
  const author = firstMatch(html, /"username"\s*:\s*"([^"]+)"/);
  const height = toPositiveNumber(findMeta(html, 'og:video:height'));

  const video = uniqueByUrl(videoUrls).map((url) =>
    makeStream({
      url,
      quality: qualityFromHeight(height) || '720p',
      label: height ? `${height}p` : 'Video',
      mimeType: 'video/mp4',
      height,
      hasAudio: true,
    }),
  );

  const photo = uniqueByUrl(imageUrls).map((url) => ({ url, ext: 'jpg' }));

  if (!video.length && !photo.length) return null;

  return {
    title: title ? cleanText(decodeHtml(title)) : `Postingan Instagram ${shortcode}`,
    author: author ? `@${decodeHtml(author)}` : null,
    thumbnail: imageUrls[0] || (video.length ? null : null),
    duration: null,
    video,
    audio: [],
    photo,
  };
}

function instagramNodeToMedia(node, shortcode) {
  const entries = Array.isArray(node.edge_sidecar_to_children?.edges)
    ? node.edge_sidecar_to_children.edges.map((edge) => edge.node).filter(Boolean)
    : Array.isArray(node.carousel_media)
      ? node.carousel_media
      : [node];

  const video = [];
  const photo = [];

  for (const entry of entries) {
    const image= pickImageCandidate(entry.image_versions2?.candidates);
    const imageUrl =
      entry.display_url ||
      image?.url ||
      entry.thumbnail_src ||
      entry.display_resources?.[entry.display_resources.length - 1]?.src ||
      null;

    const hasVideo = Boolean(
      entry.video_url || (Array.isArray(entry.video_versions) && entry.video_versions.length) || entry.is_video,
    );

    if (imageUrl && !hasVideo) {
      photo.push({
        url: imageUrl,
        ext: 'jpg',
        width: toPositiveNumber(entry.dimensions?.width) || toPositiveNumber(image?.width),
        height: toPositiveNumber(entry.dimensions?.height) || toPositiveNumber(image?.height),
      });
    }

    if (entry.video_url) {
      const height =
        toPositiveNumber(entry.dimensions?.height) ||
        toPositiveNumber(entry.original_height) ||
        toPositiveNumber(entry.height);
      video.push(
        makeStream({
          url: entry.video_url,
          quality: qualityFromHeight(height) || '720p',
          label: height ? `${height}p` : 'Video',
          mimeType: 'video/mp4',
          width: toPositiveNumber(entry.dimensions?.width) || toPositiveNumber(entry.original_width),
          height,
          hasAudio: true,
        }),
      );
    }

    const versions = Array.isArray(entry.video_versions) ? entry.video_versions : [];
    for (const version of versions) {
      if (!version?.url) continue;
      const height = toPositiveNumber(version.height);
      video.push(
        makeStream({
          url: version.url,
          quality: qualityFromHeight(height) || '720p',
          label: height ? `${height}p` : 'Video',
          mimeType: 'video/mp4',
          width: toPositiveNumber(version.width),
          height,
          hasAudio: true,
        }),
      );
    }
  }

  if (!video.length && !photo.length) throw new Error('Media Instagram kosong');

  const title =
    node.edge_media_to_caption?.edges?.[0]?.node?.text ||
    node.caption?.text ||
    node.title ||
    `Postingan Instagram ${shortcode}`;
  const author = node.owner?.username || node.user?.username || null;
  const thumbnail =
    node.thumbnail_src ||
    node.display_url ||
    node.image_versions2?.candidates?.[0]?.url ||
    photo[0]?.url ||
    null;

  return {
    title: truncate(title, 120),
    author: author ? `@${author}` : null,
    thumbnail,
    duration: toPositiveNumber(node.video_duration),
    video,
    audio: [],
    photo,
  };
}

async function extractX(sourceUrl) {
  const id = tweetId(sourceUrl);
  if (!id) throw new ApiError('Tautan X/Twitter tidak valid.', 400, 'INVALID_X_URL');

  const errors = [];
  const attempts = [
    () => xFromSyndication(id),
    () => xFromPage(sourceUrl, id),
    () => xFromOEmbed(sourceUrl),
  ];

  for (const attempt of attempts) {
    try {
      return await attempt();
    } catch (error) {
      errors.push(String(error?.message || error).slice(0, 100));
    }
  }

  throw new ApiError(
    'Postingan X/Twitter tidak dapat diakses. Pastikan postingan publik dan masih tersedia.',
    502,
    'X_EXTRACTION_FAILED',
    { attempts: errors },
  );
}

async function xFromSyndication(id) {
  const token = xSyndicationToken(id);
  const data = await fetchJson(
    `https://cdn.syndication.twimg.com/tweet-result?id=${id}&lang=en&token=${token}`,
    {
      timeout: 8_000,
      headers: {
        'User-Agent': DESKTOP_UA,
        Accept: 'application/json',
        Referer: 'https://platform.twitter.com/',
      },
    },
  );

  if (!data || data.__typename === 'TweetTombstone') {
    throw new Error('Tweet tidak tersedia pada syndication');
  }

  const media = xMediaFromSyndication(data);
  if (!media.video.length && !media.photo.length) throw new Error('Media tweet tidak ditemukan');

  return media;
}

function xMediaFromSyndication(data) {
  const video = [];
  const photo = [];
  const topVideo = data.video;
  const mediaDetails = Array.isArray(data.mediaDetails) ? data.mediaDetails : [];
  const isGif = mediaDetails.some((item) => String(item.type || '').toLowerCase() === 'animated_gif');

  if (topVideo?.variants) {
    for (const variant of topVideo.variants) {
      const type = String(variant.type || variant.content_type || '');
      if (!/video\/mp4/i.test(type) || !variant.src) continue;
      const dimensions = dimensionsFromUrl(variant.src);
      const height = dimensions.height;
      video.push(
        makeStream({
          url: variant.src,
          quality: isGif ? 'GIF' : qualityFromHeight(height) || '720p',
          label: isGif ? 'GIF (MP4)' : height ? `${height}p` : 'Video',
          mimeType: 'video/mp4',
          width: dimensions.width,
          height,
          hasAudio: !isGif,
        }),
      );
    }
  }

  for (const item of mediaDetails) {
    const variants = Array.isArray(item.video_info?.variants) ? item.video_info.variants : [];
    const itemIsGif = String(item.type || '').toLowerCase() === 'animated_gif';

    for (const variant of variants) {
      const type = String(variant.content_type || variant.type || '');
      if (!/video\/mp4/i.test(type) || !variant.url) continue;
      const dimensions = dimensionsFromUrl(variant.url);
      const height = dimensions.height;
      video.push(
        makeStream({
          url: variant.url,
          quality: itemIsGif ? 'GIF' : qualityFromHeight(height) || '720p',
          label: itemIsGif ? 'GIF (MP4)' : height ? `${height}p` : 'Video',
          mimeType: 'video/mp4',
          width: dimensions.width,
          height,
          bitrate: toPositiveNumber(variant.bitrate),
          hasAudio: !itemIsGif,
        }),
      );
    }

    if (!variants.length && item.media_url_https) {
      photo.push({
        url: item.media_url_https,
        ext: extensionFromMime(item.media_url_https) || 'jpg',
      });
    }
  }

  const photos = Array.isArray(data.photos) ? data.photos : [];
  for (const item of photos) {
    const url = typeof item === 'string' ? item : item?.url || item?.media_url_https;
    if (url) photo.push({ url, ext: 'jpg' });
  }

  const firstVideo = mediaDetails.find((item) => item.video_info);
  const durationMs =
    toPositiveNumber(topVideo?.durationMs) ||
    toPositiveNumber(firstVideo?.video_info?.duration_millis) ||
    null;

  return {
    title: truncate(data.text || 'Postingan X', 120),
    author: data.user
      ? `${data.user.name || ''}${data.user.screen_name ? ` (@${data.user.screen_name})` : ''}`.trim()
      : null,
    thumbnail: topVideo?.poster || mediaDetails[0]?.media_url_https || photo[0]?.url || null,
    duration: durationMs ? durationMs / 1000 : null,
    video,
    audio: [],
    photo,
  };
}

async function xFromPage(sourceUrl, id) {
  const html = await fetchText(`https://x.com/i/status/${id}`, {
    timeout: 8_000,
    headers: {
      'User-Agent': X_BOT_UA,
      Accept: HTML_ACCEPT,
      Referer: sourceUrl,
    },
  });

  const videoUrl =
    findMeta(html, 'og:video') ||
    findMeta(html, 'og:video:url') ||
    findMeta(html, 'og:video:secure_url');
  const imageUrl = findMeta(html, 'og:image');
  const title = findMeta(html, 'og:title') || findMeta(html, 'twitter:title');
  const author = findMeta(html, 'twitter:creator');
  const height = toPositiveNumber(findMeta(html, 'og:video:height'));

  const video = [];
  const photo = [];

  if (videoUrl && /(?:\.mp4|video\.twimg\.com)/i.test(videoUrl)) {
    const dimensions = dimensionsFromUrl(videoUrl);
    video.push(
      makeStream({
        url: decodeHtml(videoUrl),
        quality: qualityFromHeight(height || dimensions.height) || '720p',
        label: height || dimensions.height ? `${height || dimensions.height}p` : 'Video',
        mimeType: 'video/mp4',
        width: dimensions.width,
        height: height || dimensions.height,
        hasAudio: true,
      }),
    );
  } else if (imageUrl) {
    photo.push({ url: decodeHtml(imageUrl), ext: 'jpg' });
  }

  if (!video.length && !photo.length) throw new Error('Media tweet tidak ditemukan pada halaman');

  return {
    title: title ? cleanText(decodeHtml(title)) : `Postingan X ${id}`,
    author: author ? decodeHtml(author) : null,
    thumbnail: imageUrl ? decodeHtml(imageUrl) : null,
    duration: null,
    video,
    audio: [],
    photo,
  };
}

async function xFromOEmbed(sourceUrl) {
  const data = await fetchJson(
    `https://publish.twitter.com/oembed?url=${encodeURIComponent(sourceUrl)}&omit_script=1&dnt=1`,
    {
      timeout: 8_000,
      headers: { 'User-Agent': DESKTOP_UA, Accept: 'application/json' },
    },
  );

  const html = String(data?.html || '');
  const imageUrls = [];
  const pattern = /src="(https:\/\/pbs\.twimg\.com\/[^"]+)"/g;
  let match;

  while ((match = pattern.exec(html)) !== null) {
    imageUrls.push(decodeHtml(match[1]));
  }

  if (!imageUrls.length) throw new Error('Media tweet tidak ditemukan pada oEmbed');

  return {
    title: `Postingan X ${data?.author_name || ''}`.trim(),
    author: data?.author_name || null,
    thumbnail: imageUrls[0],
    duration: null,
    video: [],
    audio: [],
    photo: uniqueByUrl(imageUrls).map((url) => ({ url, ext: 'jpg' })),
  };
}

async function extractFacebook(sourceUrl) {
  const errors = [];
  const attempts = [() => facebookFromPlugin(sourceUrl), () => facebookFromPage(sourceUrl)];

  for (const attempt of attempts) {
    try {
      return await attempt();
    } catch (error) {
      errors.push(String(error?.message || error).slice(0, 100));
    }
  }

  throw new ApiError(
    'Facebook tidak dapat memproses tautan ini. Pastikan video publik dan dapat diputar tanpa login.',
    502,
    'FACEBOOK_EXTRACTION_FAILED',
    { attempts: errors },
  );
}

async function facebookFromPlugin(sourceUrl) {
  const pluginUrl = `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(sourceUrl)}&show_text=false&width=734`;
  const html = await fetchText(pluginUrl, {
    timeout: 10_000,
    headers: {
      'User-Agent': MOBILE_UA,
      Accept: HTML_ACCEPT,
      Referer: 'https://www.facebook.com/',
    },
  });

  if (!html || html.length < 200) throw new Error('Halaman plugin kosong');

  const hd = firstMatch(
    html,
    /"(?:hd_src(?:_no_ratelimit)?|browser_native_hd_url|playable_url_quality_hd)"\s*:\s*"([^"]+)"/,
  );
  const sd = firstMatch(
    html,
    /"(?:sd_src(?:_no_ratelimit)?|browser_native_sd_url|playable_url)"\s*:\s*"([^"]+)"/,
  );
  const preview =
    firstMatch(html, /"preview_image"\s*:\s*"([^"]+)"/) ||
    firstMatch(html, /"preview_image"\s*:\s*\{[^}]*"uri"\s*:\s*"([^"]+)"/);

  const video = [];
  const addVideo = (rawUrl, quality, label, height) => {
    const url = decodeJsonish(rawUrl);
    if (!url || video.some((item) => item.url === url)) return;
    video.push(
      makeStream({
        url,
        quality,
        label,
        mimeType: 'video/mp4',
        height,
        hasAudio: true,
      }),
    );
  };

  addVideo(hd, '1080p', 'HD', 1080);
  addVideo(sd, '480p', 'SD', 480);

  if (!video.length) throw new Error('URL video Facebook tidak ditemukan');

  let og = {};
  try {
    const pageHtml = await fetchText(sourceUrl, {
      timeout: 8_000,
      headers: { 'User-Agent': CRAWLER_UA, Accept: HTML_ACCEPT },
    });
    og = readOpenGraph(pageHtml);
  } catch {
    og = {};
  }

  const title = og.title || firstMatch(html, /<title[^>]*>([^<]+)<\/title>/i) || 'Video Facebook';

  return {
    title: decodeHtml(cleanText(title)),
    author: og.site_name && og.site_name !== 'Facebook' ? og.site_name : null,
    thumbnail: og.image || decodeJsonish(preview) || null,
    duration: null,
    video,
    audio: [],
    photo: [],
  };
}

async function facebookFromPage(sourceUrl) {
  const html = await fetchText(sourceUrl, {
    timeout: 8_000,
    headers: { 'User-Agent': CRAWLER_UA, Accept: HTML_ACCEPT },
  });

  const hd = firstMatch(
    html,
    /"(?:browser_native_hd_url|playable_url_quality_hd|hd_src(?:_no_ratelimit)?)"\s*:\s*"([^"]+)"/,
  );
  const sd = firstMatch(
    html,
    /"(?:browser_native_sd_url|playable_url|sd_src(?:_no_ratelimit)?)"\s*:\s*"([^"]+)"/,
  );
  const ogVideo = findMeta(html, 'og:video') || findMeta(html, 'og:video:url');
  const og = readOpenGraph(html);

  const video = [];
  const addVideo = (rawUrl, quality, label, height) => {
    const url = decodeJsonish(rawUrl);
    if (!url || video.some((item) => item.url === url)) return;
    video.push(
      makeStream({
        url,
        quality,
        label,
        mimeType: 'video/mp4',
        height,
        hasAudio: true,
      }),
    );
  };

  addVideo(hd, '1080p', 'HD', 1080);
  addVideo(sd, '480p', 'SD', 480);
  if (ogVideo && /\.mp4/i.test(decodeHtml(ogVideo))) addVideo(ogVideo, '720p', 'Video', 720);

  if (!video.length) throw new Error('URL video Facebook tidak ditemukan pada halaman');

  return {
    title: og.title ? decodeHtml(cleanText(og.title)) : 'Video Facebook',
    author: og.site_name && og.site_name !== 'Facebook' ? og.site_name : null,
    thumbnail: og.image || null,
    duration: null,
    video,
    audio: [],
    photo: [],
  };
}

function normalizeUrl(input) {
  const url = toUrl(input);
  if (!url) throw new ApiError('Tautan tidak valid. Tempel URL lengkap dengan https://.', 400, 'INVALID_URL');

  if (!/^https?:$/.test(url.protocol)) {
    throw new ApiError('Hanya tautan http/https yang didukung.', 400, 'INVALID_PROTOCOL');
  }

  const platform = detectPlatform(url.href);
  if (!platform) {
    throw new ApiError(
      'Platform belum didukung. Gunakan tautan YouTube, TikTok, Instagram, X, atau Facebook.',
      422,
      'UNSUPPORTED_PLATFORM',
      { supported: SUPPORTED_PLATFORMS.map((key) => PLATFORM_LABELS[key]) },
    );
  }

  url.hash = '';
  return url;
}

function toUrl(input) {
  try {
    return new URL(String(input || '').trim());
  } catch {
    return null;
  }
}

function youtubeId(input) {
  const url = toUrl(input);
  if (!url) return null;

  if (url.hostname.replace(/^www\./, '') === 'youtu.be') {
    return url.pathname.split('/').filter(Boolean)[0] || null;
  }

  const v = url.searchParams.get('v');
  if (v) return v;

  const match = url.pathname.match(/\/(?:shorts|embed|live|v)\/([\w-]{6,})/);
  return match ? match[1] : null;
}

function tiktokId(input) {
  const url = toUrl(input);
  if (!url) return null;
  const match = url.pathname.match(/\/video\/(\d{5,})/);
  return match ? match[1] : null;
}

function instagramShortcode(input) {
  const url = toUrl(input);
  if (!url) return null;
  const match = url.pathname.match(/\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]{5,})/);
  return match ? match[1] : null;
}

function tweetId(input) {
  const url = toUrl(input);
  if (!url) return null;
  const match = url.pathname.match(/\/status(?:es)?\/(\d{5,})/);
  return match ? match[1] : null;
}

function xSyndicationToken(id) {
  try {
    const value = (Number(BigInt(id) / 1_000_000_000_000_000n) * Math.PI).toString(36);
    return value.replace(/(0+|\.)/g, '') || '0';
  } catch {
    return '0';
  }
}

function pickImageCandidate(candidates) {
  if (!Array.isArray(candidates) || !candidates.length) return null;
  return [...candidates].sort((a, b) => (b.width || 0) * (b.height || 0) - (a.width || 0) * (a.height || 0))[0];
}

function makeStream(input) {
  const mimeType = normalizeMime(input.mimeType, 'video/mp4');
  return {
    url: input.url,
    quality: input.quality || qualityFromHeight(input.height) || null,
    label: input.label || null,
    mimeType,
    ext: input.ext || extensionFromMime(mimeType),
    width: toPositiveNumber(input.width),
    height: toPositiveNumber(input.height),
    bitrate: toPositiveNumber(input.bitrate),
    size: toPositiveNumber(input.size),
    hasAudio: input.hasAudio !== false,
    watermark: Boolean(input.watermark),
  };
}

function collapseStreams(streams) {
  const map = new Map();

  for (const stream of streams) {
    if (!stream?.url) continue;
    if (/mpegurl|m3u8/i.test(stream.mimeType || '')) continue;
    if (!stream.height && !stream.quality && !stream.bitrate) continue;
    const key = stream.quality || stream.height || stream.url;
    const previous = map.get(key);
    if (!previous || streamScore(stream) > streamScore(previous)) map.set(key, stream);
  }

  return [...map.values()].sort((a, b) => (b.height || b.bitrate || 0) - (a.height || a.bitrate || 0));
}

function streamScore(stream) {
  const avcBonus = /avc1/i.test(stream.mimeType || '') ? 100_000_000 : 0;
  return (stream.height || 0) * 1_000_000 + (stream.bitrate || 0) + avcBonus + (stream.hasAudio ? 1_000_000_000 : 0);
}

function uniquePhotos(photos) {
  return uniqueByUrl(photos.filter((item) => item?.url));
}

function uniqueByUrl(items) {
  const seen = new Set();
  const output = [];

  for (const item of items) {
    const url = typeof item === 'string' ? item : item?.url;
    if (!url || seen.has(url)) continue;
    seen.add(url);
    output.push(item);
  }

  return output;
}

function pickStream(list, quality) {
  if (!list.length) return null;
  if (!quality) return list[0];

  const targetQuality = String(quality).toLowerCase();
  const exact = list.find((item) => String(item.quality || '').toLowerCase() === targetQuality);
  if (exact) return exact;

  const target = Number.parseInt(targetQuality.replace(/[^0-9]/g, ''), 10);
  if (!Number.isFinite(target) || target <= 0) return list[0];

  const isAudio = list.every((item) => !item.height && item.bitrate);
  const targetValue = isAudio && target < 1_000 ? target * 1_000 : target;

  const ranked = list
    .map((item) => ({ item, value: item.height || item.bitrate || 0 }))
    .filter((entry) => entry.value > 0)
    .sort((a, b) => b.value - a.value);

  const lower = ranked.find((entry) => entry.value <= targetValue);
  return (lower || ranked[0] || { item: list[0] }).item;
}

function qualityFromHeight(height) {
  const value = toPositiveNumber(height);
  if (!value) return null;
  if (value >= 2160) return '2160p';
  if (value >= 1440) return '1440p';
  if (value >= 1080) return '1080p';
  if (value >= 720) return '720p';
  if (value >= 480) return '480p';
  if (value >= 360) return '360p';
  return `${Math.round(value)}p`;
}

function normalizeQuality(label, height) {
  return qualityFromHeight(height) || heightFromLabel(label);
}

function heightFromLabel(label) {
  const match = String(label || '').match(/(\d{3,4})p/i);
  return match ? Number(match[1]) : null;
}

function audioQuality(bitrate) {
  const bps = toPositiveNumber(bitrate);
  if (!bps) return null;
  if (bps >= 256_000) return '320kbps';
  if (bps >= 128_000) return '128kbps';
  return `${Math.round(bps / 1000)}kbps`;
}

function normalizeMime(mimeType, fallback) {
  const value = String(mimeType || '').split(';')[0].trim().toLowerCase();
  return value || fallback;
}

function dimensionsFromUrl(value) {
  const match = String(value || '').match(/\/(\d{2,4})x(\d{2,4})\//);
  return {
    width: match ? Number(match[1]) : null,
    height: match ? Number(match[2]) : null,
  };
}

function toPositiveNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return number;
}

function cleanText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncate(value, max) {
  const text = cleanText(value);
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x2F;/gi, '/')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&nbsp;/g, ' ');
}

function decodeJsonish(value) {
  if (!value) return null;
  return decodeHtml(
    String(value)
      .replace(/\\u([0-9a-f]{4})/gi, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
      .replace(/\\\//g, '/')
      .replace(/\\"/g, '"'),
  );
}

function extractEncodedUrls(html, pattern) {
  const urls = [];
  let match;
  while ((match = pattern.exec(html)) !== null) {
    const url = decodeJsonish(match[1]);
    if (url) urls.push(url);
  }
  return urls;
}

function firstMatch(html, pattern) {
  const match = String(html || '').match(pattern);
  return match ? match[1] : null;
}

function findMeta(html, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]*content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${escaped}["']`, 'i'),
  ];

  for (const pattern of patterns) {
    const match = String(html || '').match(pattern);
    if (match) return match[1];
  }

  return null;
}

function readOpenGraph(html) {
  return {
    title: decodeHtml(findMeta(html, 'og:title') || findMeta(html, 'twitter:title')),
    image: decodeHtml(findMeta(html, 'og:image') || findMeta(html, 'twitter:image')),
    site_name: decodeHtml(findMeta(html, 'og:site_name')),
  };
}

function readJsonScriptById(html, id) {
  const escaped = escapeRegExp(id);
  const pattern = new RegExp(`<script[^>]+id=["']${escaped}["'][^>]*>([\\s\\S]*?)<\\/script>`, 'i');
  return parseJsonScript(html, pattern);
}

function readJsonScripts(html) {
  const scripts = [];
  const pattern = /<script[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;

  while ((match = pattern.exec(html)) !== null) {
    try {
      scripts.push(JSON.parse(match[1]));
    } catch {
      continue;
    }
  }

  return scripts;
}

function parseJsonScript(html, pattern) {
  const match = String(html || '').match(pattern);
  if (!match) return null;

  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function findKeyDeep(root, key, maxDepth = 12) {
  const queue = [{ value: root, depth: 0 }];
  const seen = new Set();

  while (queue.length) {
    const { value, depth } = queue.shift();
    if (!value || typeof value !== 'object' || depth > maxDepth || seen.has(value)) continue;
    seen.add(value);

    if (Object.prototype.hasOwnProperty.call(value, key)) {
      const found = value[key];
      if (found && typeof found === 'object') return found;
    }

    for (const child of Object.values(value)) {
      if (child && typeof child === 'object') queue.push({ value: child, depth: depth + 1 });
    }
  }

  return null;
}

function findDeep(root, predicate, maxDepth = 10) {
  const queue = [{ value: root, depth: 0 }];
  const seen = new Set();

  while (queue.length) {
    const { value, depth } = queue.shift();
    if (!value || typeof value !== 'object' || depth > maxDepth || seen.has(value)) continue;
    seen.add(value);

    if (predicate(value)) return value;

    for (const child of Object.values(value)) {
      if (child && typeof child === 'object') queue.push({ value: child, depth: depth + 1 });
    }
  }

  return null;
}

function extractJsonAfterKey(text, key) {
  const pattern = new RegExp(`"${escapeRegExp(key)}"\\s*:\\s*`, 'i');
  return extractJsonAfterPattern(text, pattern);
}

function extractJsonAfterPattern(text, pattern) {
  const value = String(text || '');
  const match = pattern.exec(value);
  if (!match) return null;
  return parseJsonValueAt(value, match.index + match[0].length);
}

function parseJsonValueAt(text, start) {
  let index = start;

  while (index < text.length && /\s/.test(text[index])) index += 1;

  const char = text[index];

  if (char === '{' || char === '[') {
    const end = findJsonEnd(text, index);
    if (end < 0) return null;

    try {
      return JSON.parse(text.slice(index, end + 1));
    } catch {
      return null;
    }
  }

  if (char === '"') {
    const end = findStringEnd(text, index);
    if (end < 0) return null;

    try {
      const decoded = JSON.parse(text.slice(index, end + 1));
      try {
        return JSON.parse(decoded);
      } catch {
        return decoded;
      }
    } catch {
      return null;
    }
  }

  return null;
}

function findJsonEnd(text, start) {
  const open = text[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  return -1;
}

function findStringEnd(text, start) {
  let escaped = false;

  for (let index = start + 1; index < text.length; index += 1) {
    const char = text[index];

    if (escaped) escaped = false;
    else if (char === '\\') escaped = true;
    else if (char === '"') return index;
  }

  return -1;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function fetchJson(url, options = {}) {
  const response = await request(url, options);
  if (!response.ok) {
    throw new ApiError(`Layanan sumber merespons ${response.status}.`, 502, 'UPSTREAM_ERROR');
  }

  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError('Layanan sumber mengembalikan respons yang tidak valid.', 502, 'UPSTREAM_INVALID_RESPONSE');
  }
}

async function fetchText(url, options = {}) {
  const response = await request(url, options);
  if (!response.ok) {
    throw new ApiError(`Layanan sumber merespons ${response.status}.`, 502, 'UPSTREAM_ERROR');
  }
  return response.text();
}

async function request(url, options = {}) {
  const controller = new AbortController();
  const timeout = Number(options.timeout) || 10_000;
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    return await fetch(url, {
      method: options.method || 'GET',
      body: options.body,
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': DESKTOP_UA,
        Accept: 'application/json, text/html;q=0.9, */*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        ...(options.headers || {}),
      },
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new ApiError('Layanan sumber terlalu lama merespons.', 504, 'UPSTREAM_TIMEOUT');
    }
    throw new ApiError('Tidak dapat menghubungi layanan sumber.', 502, 'UPSTREAM_UNREACHABLE', {
      reason: String(error?.message || error).slice(0, 140),
    });
  } finally {
    clearTimeout(timer);
  }
}

function readCache(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function writeCache(key, value) {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}
