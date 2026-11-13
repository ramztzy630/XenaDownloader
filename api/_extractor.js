import ytdl from '@distube/ytdl-core';
import { ApiError, extensionFromMime, sanitizeFilename } from './_utils.js';

const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const MOBILE_UA =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';
const CRAWLER_UA = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';
const IG_APP_ID = '936619743392459';

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
    (format === 'audio' ? 'mp3' : format === 'photo' ? 'jpg' : 'mp4');

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

  try {
    return await youtubeFromYtdl(sourceUrl);
  } catch (error) {
    errors.push(`ytdl: ${String(error?.message || error).slice(0, 120)}`);
  }

  try {
    return await youtubeFromPiped(id);
  } catch (error) {
    errors.push(`piped: ${String(error?.message || error).slice(0, 120)}`);
  }

  throw new ApiError(
    'YouTube menolak permintaan dari server ini. Coba lagi beberapa saat atau gunakan tautan dari platform lain.',
    502,
    'YOUTUBE_EXTRACTION_FAILED',
    { attempts: errors },
  );
}

async function youtubeFromYtdl(sourceUrl) {
  if (!ytdl || typeof ytdl.getInfo !== 'function') {
    throw new Error('ytdl-core tidak tersedia');
  }

  const info = await withTimeout(ytdl.getInfo(sourceUrl), 8_000, 'ytdl-core timeout');
  const details = info.videoDetails || {};
  const formats = (info.formats || []).filter((item) => item && item.url);

  const muxed = formats.filter((item) => item.hasVideo && item.hasAudio);
  const adaptive = formats.filter((item) => item.hasVideo && !item.hasAudio);
  const videoSource = muxed.length ? muxed : adaptive;

  const video = videoSource.map((item) => {
    const height = toPositiveNumber(item.height) || heightFromLabel(item.qualityLabel);
    const mimeType = normalizeMime(item.mimeType, 'video/mp4');
    return makeStream({
      url: item.url,
      quality: normalizeQuality(item.qualityLabel, height),
      label: item.qualityLabel || (height ? `${height}p` : null),
      mimeType,
      width: toPositiveNumber(item.width),
      height,
      bitrate: toPositiveNumber(item.bitrate),
      size: toPositiveNumber(item.contentLength),
      hasAudio: Boolean(item.hasAudio),
    });
  });

  const audio = formats
    .filter((item) => item.hasAudio && !item.hasVideo)
    .map((item) => {
      const bitrate = toPositiveNumber(item.bitrate);
      const mimeType = normalizeMime(item.mimeType, 'audio/mp4');
      return makeStream({
        url: item.url,
        quality: audioQuality(bitrate),
        label: bitrate ? `${Math.round(bitrate / 1000)}kbps` : 'Audio',
        mimeType,
        bitrate,
        size: toPositiveNumber(item.contentLength),
        hasAudio: true,
      });
    });

  const thumbnails = details.thumbnails || [];
  const bestThumb = [...thumbnails].sort((a, b) => (b.width || 0) - (a.width || 0))[0];

  return {
    title: details.title,
    author: details.author?.name || details.ownerChannelName,
    thumbnail: bestThumb?.url || null,
    duration: toPositiveNumber(details.lengthSeconds),
    video,
    audio,
    photo: [],
    note: muxed.length ? null : 'Video YouTube ini tersedia tanpa trek audio terpisah.',
  };
}

async function youtubeFromPiped(id) {
  const instances = String(process.env.PIPED_API_INSTANCES || 'pipedapi.ducks.party,pipedapi.reallyaweso.me,pipedapi.adminforge.de')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  if (!instances.length) throw new Error('Tidak ada instance Piped');

  const attempts = instances.map((host) =>
    fetchPipedStreams(host, id).catch((error) => {
      throw new Error(`${host}: ${String(error?.message || error).slice(0, 80)}`);
    }),
  );

  const results = await Promise.allSettled(attempts);
  const fulfilled = results.filter((result) => result.status === 'fulfilled').map((result) => result.value);

  if (!fulfilled.length) throw new Error('Semua instance Piped gagal');

  const primary = fulfilled[0];

  return {
    title: primary.title,
    author: primary.author,
    thumbnail: primary.thumbnail,
    duration: primary.duration,
    video: fulfilled.flatMap((result) => result.video),
    audio: fulfilled.flatMap((result) => result.audio),
    photo: [],
  };
}

async function fetchPipedStreams(host, id) {
  const base = /^https?:\/\//i.test(host) ? host.replace(/\/+$/, '') : `https://${host}`;
  const data = await fetchJson(`${base}/streams/${id}`, { timeout: 8_000 });

  if (!data || data.error || !data.title) {
    throw new Error('Respons Piped tidak valid');
  }

  const rawVideo = Array.isArray(data.videoStreams) ? data.videoStreams.filter((item) => item?.url) : [];
  const muxed = rawVideo.filter((item) => item.videoOnly === false);
  const adaptive = rawVideo.filter((item) => item.videoOnly === true);
  const videoSource = muxed.length ? muxed : adaptive;

  const video = videoSource.map((item) => {
    const height = toPositiveNumber(item.height) || heightFromLabel(item.quality);
    const mimeType = normalizeMime(item.mimeType, 'video/mp4');
    return makeStream({
      url: item.url,
      quality: normalizeQuality(item.quality, height),
      label: item.quality || (height ? `${height}p` : null),
      mimeType,
      width: toPositiveNumber(item.width),
      height,
      bitrate: toPositiveNumber(item.bitrate),
      size: toPositiveNumber(item.contentLength),
      hasAudio: item.videoOnly === false,
    });
  });

  const audio = (Array.isArray(data.audioStreams) ? data.audioStreams : [])
    .filter((item) => item?.url)
    .map((item) => {
      const bitrate = toPositiveNumber(item.bitrate) || bitrateFromLabel(item.quality);
      const mimeType = normalizeMime(item.mimeType, 'audio/mp4');
      return makeStream({
        url: item.url,
        quality: audioQuality(bitrate),
        label: item.quality || (bitrate ? `${Math.round(bitrate / 1000)}kbps` : 'Audio'),
        mimeType,
        bitrate,
        size: toPositiveNumber(item.contentLength),
        hasAudio: true,
      });
    });

  if (!video.length && !audio.length) {
    throw new Error('Piped tidak mengembalikan stream');
  }

  return {
    title: data.title,
    author: data.uploader || null,
    thumbnail: data.thumbnailUrl || null,
    duration: toPositiveNumber(data.duration),
    video,
    audio,
    photo: [],
  };
}

async function extractTikTok(sourceUrl) {
  const endpoint = `https://www.tikwm.com/api/?url=${encodeURIComponent(sourceUrl)}&hd=1`;
  const payload = await fetchJson(endpoint, { timeout: 12_000 });

  if (!payload || payload.code !== 0 || !payload.data) {
    throw new ApiError(
      payload?.msg || 'TikTok tidak dapat memproses tautan ini. Pastikan video bersifat publik.',
      422,
      'TIKTOK_EXTRACTION_FAILED',
    );
  }

  const data = payload.data;
  const resolve = (value) => absoluteUrl(value, 'https://www.tikwm.com');

  const video = [];
  const hdUrl = resolve(data.hdplay);
  const playUrl = resolve(data.play);
  const wmUrl = resolve(data.wmplay);

  if (hdUrl) {
    video.push(
      makeStream({
        url: hdUrl,
        quality: '1080p',
        label: 'HD tanpa watermark',
        mimeType: 'video/mp4',
        height: 1080,
        hasAudio: true,
      }),
    );
  }

  if (playUrl && playUrl !== hdUrl) {
    video.push(
      makeStream({
        url: playUrl,
        quality: '720p',
        label: 'Tanpa watermark',
        mimeType: 'video/mp4',
        height: 720,
        hasAudio: true,
      }),
    );
  }

  if (wmUrl && wmUrl !== playUrl && wmUrl !== hdUrl) {
    video.push(
      makeStream({
        url: wmUrl,
        quality: '480p',
        label: 'Dengan watermark',
        mimeType: 'video/mp4',
        height: 480,
        hasAudio: true,
        watermark: true,
      }),
    );
  }

  const musicUrl = resolve(data.music);
  const audio = musicUrl
    ? [
        makeStream({
          url: musicUrl,
          quality: '128kbps',
          label: 'Audio original',
          mimeType: 'audio/mpeg',
          bitrate: 128_000,
          hasAudio: true,
        }),
      ]
    : [];

  const images = Array.isArray(data.images) ? data.images.filter(Boolean).map(resolve) : [];
  const photo = images.map((url, index) => ({
    url,
    ext: 'jpg',
    width: toPositiveNumber(data.image_post_info?.images?.[index]?.image_width),
    height: toPositiveNumber(data.image_post_info?.images?.[index]?.image_height),
  }));

  const author = data.author?.nickname || data.author?.unique_id || null;

  return {
    title: data.title || (images.length ? 'Slide foto TikTok' : 'Video TikTok'),
    author,
    thumbnail: resolve(data.origin_cover) || resolve(data.cover) || (photo[0]?.url ?? null),
    duration: toPositiveNumber(data.duration),
    video,
    audio,
    photo,
    note: images.length ? 'Postingan ini berisi slide foto.' : null,
  };
}

async function extractInstagram(sourceUrl) {
  const shortcode = instagramShortcode(sourceUrl);
  if (!shortcode) throw new ApiError('Tautan Instagram tidak valid.', 400, 'INVALID_INSTAGRAM_URL');

  const errors = [];

  try {
    return await instagramFromApi(shortcode);
  } catch (error) {
    errors.push(`api: ${String(error?.message || error).slice(0, 100)}`);
  }

  try {
    return await instagramFromEmbed(shortcode);
  } catch (error) {
    errors.push(`embed: ${String(error?.message || error).slice(0, 100)}`);
  }

  throw new ApiError(
    'Instagram tidak dapat memproses tautan ini. Pastikan postingan publik dan bukan dari akun privat.',
    502,
    'INSTAGRAM_EXTRACTION_FAILED',
    { attempts: errors },
  );
}

async function instagramFromApi(shortcode) {
  const mediaId = instagramIdFromShortcode(shortcode);
  const endpoints = [
    `https://i.instagram.com/api/v1/media/${mediaId}/info/`,
    `https://www.instagram.com/api/v1/media/${mediaId}/info/`,
  ];

  let lastError;
  for (const endpoint of endpoints) {
    try {
      const data = await fetchJson(endpoint, {
        timeout: 9_000,
        headers: {
          'User-Agent': `${MOBILE_UA} Instagram 320.0.0.42.101`,
          'x-ig-app-id': IG_APP_ID,
          Referer: 'https://www.instagram.com/',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });

      const item = data?.items?.[0];
      if (!item) throw new Error('Media tidak ditemukan');

      const entries = Array.isArray(item.carousel_media) && item.carousel_media.length ? item.carousel_media : [item];
      const video = [];
      const photo = [];

      for (const entry of entries) {
        const image = pickImageCandidate(entry.image_versions2?.candidates);
        if (image) {
          photo.push({ url: image.url, width: image.width, height: image.height, ext: 'jpg' });
        }

        const versions = Array.isArray(entry.video_versions) ? entry.video_versions : [];
        for (const version of versions) {
          if (!version?.url) continue;
          const height = toPositiveNumber(version.height);
          video.push(
            makeStream({
              url: version.url,
              quality: qualityFromHeight(height),
              label: height ? `${height}p` : 'Video',
              mimeType: 'video/mp4',
              width: toPositiveNumber(version.width),
              height,
              hasAudio: true,
            }),
          );
        }
      }

      const caption = item.caption?.text || null;
      const author = item.user?.username ? `@${item.user.username}` : null;

      return {
        title: caption ? truncate(caption, 120) : `Postingan Instagram ${author || shortcode}`,
        author,
        thumbnail: pickImageCandidate(item.image_versions2?.candidates)?.url || photo[0]?.url || null,
        duration: toPositiveNumber(item.video_duration),
        video,
        audio: [],
        photo,
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('Instagram API gagal');
}

async function instagramFromEmbed(shortcode) {
  const embedUrl = `https://www.instagram.com/p/${shortcode}/embed/captioned/`;
  const html = await fetchText(embedUrl, {
    timeout: 9_000,
    headers: {
      'User-Agent': DESKTOP_UA,
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });

  if (!html || html.length < 200) throw new Error('Halaman embed kosong');

  const videoUrls = extractEncodedUrls(html, /"video_url"\s*:\s*"([^"]+)"/g);
  const imageUrls = extractEncodedUrls(html, /"display_url"\s*:\s*"([^"]+)"/g);
  const thumbCandidates = extractEncodedUrls(html, /"thumbnail_src"\s*:\s*"([^"]+)"/g);
  const title = findMeta(html, 'og:title') || findMeta(html, 'twitter:title') || null;
  const thumbnail =
    findMeta(html, 'og:image') ||
    findMeta(html, 'twitter:image') ||
    thumbCandidates[0] ||
    imageUrls[0] ||
    null;

  const video = uniqueByUrl(videoUrls).map((url) =>
    makeStream({
      url,
      quality: '720p',
      label: 'Video',
      mimeType: 'video/mp4',
      height: 720,
      hasAudio: true,
    }),
  );

  const photo = uniqueByUrl(imageUrls).map((url) => ({ url, ext: 'jpg' }));

  if (!video.length && !photo.length) throw new Error('Media tidak ditemukan pada embed');

  return {
    title: title ? cleanText(decodeHtml(title)) : `Postingan Instagram ${shortcode}`,
    author: null,
    thumbnail: thumbnail ? decodeHtml(thumbnail) : photo[0]?.url || null,
    duration: null,
    video,
    audio: [],
    photo,
  };
}

async function extractX(sourceUrl) {
  const id = tweetId(sourceUrl);
  if (!id) throw new ApiError('Tautan X/Twitter tidak valid.', 400, 'INVALID_X_URL');

  const errors = [];

  try {
    return await xFromFxTwitter(id);
  } catch (error) {
    errors.push(`fx: ${String(error?.message || error).slice(0, 100)}`);
  }

  try {
    return await xFromSyndication(sourceUrl, id);
  } catch (error) {
    errors.push(`syndication: ${String(error?.message || error).slice(0, 100)}`);
  }

  throw new ApiError(
    'Postingan X/Twitter tidak dapat diakses. Pastikan postingan publik dan masih tersedia.',
    502,
    'X_EXTRACTION_FAILED',
    { attempts: errors },
  );
}

async function xFromFxTwitter(id) {
  const data = await fetchJson(`https://api.fxtwitter.com/status/${id}`, { timeout: 9_000 });
  const tweet = data?.tweet;
  if (!tweet || data.code !== 200 && data.code !== undefined) {
    throw new Error(data?.message || 'Tweet tidak ditemukan');
  }

  const videos = Array.isArray(tweet.media?.videos) ? tweet.media.videos : [];
  const photos = Array.isArray(tweet.media?.photos) ? tweet.media.photos : [];

  const video = videos
    .filter((item) => item?.url)
    .map((item) => {
      const height = toPositiveNumber(item.height);
      const isGif = String(item.type || '').toLowerCase() === 'gif';
      return makeStream({
        url: item.url,
        quality: isGif ? 'GIF' : qualityFromHeight(height),
        label: isGif ? 'GIF (MP4)' : height ? `${height}p` : 'Video',
        mimeType: 'video/mp4',
        width: toPositiveNumber(item.width),
        height,
        hasAudio: !isGif,
      });
    });

  const photo = photos.filter((item) => item?.url).map((item) => ({ url: item.url, ext: 'jpg' }));

  const author = tweet.author
    ? `${tweet.author.name || ''}${tweet.author.screen_name ? ` (@${tweet.author.screen_name})` : ''}`.trim()
    : null;

  return {
    title: truncate(tweet.text || 'Postingan X', 120),
    author: author || null,
    thumbnail: photos[0]?.url || videos[0]?.thumbnail_url || null,
    duration: toPositiveNumber(videos[0]?.duration),
    video,
    audio: [],
    photo,
  };
}

async function xFromSyndication(sourceUrl, id) {
  const endpoint = `https://cdn.syndication.twimg.com/tweet-result?id=${id}&lang=en&token=0`;
  const data = await fetchJson(endpoint, {
    timeout: 8_000,
    headers: { 'User-Agent': DESKTOP_UA, Referer: 'https://platform.twitter.com/' },
  });

  if (!data || data.__typename === 'TweetTombstone' || !data.mediaDetails) {
    throw new Error('Tweet tidak tersedia pada syndication');
  }

  const video = [];
  const photo = [];

  for (const item of data.mediaDetails) {
    const thumb = item.media_url_https || null;
    const variants = Array.isArray(item.video_info?.variants) ? item.video_info.variants : [];
    const mp4s = variants.filter((variant) => String(variant.content_type || '').includes('mp4') && variant.url);

    if (mp4s.length) {
      const best = mp4s.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
      video.push(
        makeStream({
          url: best.url,
          quality: '720p',
          label: 'Video',
          mimeType: 'video/mp4',
          height: 720,
          hasAudio: true,
        }),
      );
    } else if (thumb) {
      photo.push({ url: thumb, ext: 'jpg' });
    }
  }

  const title = data.text || `Postingan X ${id}`;
  const author = data.user ? `${data.user.name || ''} (@${data.user.screen_name || ''})`.trim() : null;

  return {
    title: truncate(title, 120),
    author,
    thumbnail: photo[0]?.url || video[0]?.url || null,
    duration: null,
    video,
    audio: [],
    photo,
    note: sourceUrl.includes('/video/') ? null : undefined,
  };
}

async function extractFacebook(sourceUrl) {
  const errors = [];

  try {
    return await facebookFromPlugin(sourceUrl);
  } catch (error) {
    errors.push(`plugin: ${String(error?.message || error).slice(0, 100)}`);
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
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });

  if (!html || html.length < 200) throw new Error('Halaman plugin kosong');

  const hd = firstMatch(html, /"hd_src(?:_no_ratelimit)?"\s*:\s*"([^"]+)"/);
  const sd =
    firstMatch(html, /"sd_src(?:_no_ratelimit)?"\s*:\s*"([^"]+)"/) ||
    firstMatch(html, /"playable_url(?:_quality_hd)?"\s*:\s*"([^"]+)"/);

  const video = [];
  const hdUrl = decodeJsonish(hd);
  const sdUrl = decodeJsonish(sd);

  if (hdUrl) {
    video.push(
      makeStream({
        url: hdUrl,
        quality: '1080p',
        label: 'HD',
        mimeType: 'video/mp4',
        height: 1080,
        hasAudio: true,
      }),
    );
  }

  if (sdUrl && sdUrl !== hdUrl) {
    video.push(
      makeStream({
        url: sdUrl,
        quality: '480p',
        label: 'SD',
        mimeType: 'video/mp4',
        height: 480,
        hasAudio: true,
      }),
    );
  }

  if (!video.length) throw new Error('URL video tidak ditemukan');

  let og = {};
  try {
    const pageHtml = await fetchText(sourceUrl, {
      timeout: 8_000,
      headers: { 'User-Agent': CRAWLER_UA, 'Accept-Language': 'en-US,en;q=0.9' },
    });
    og = readOpenGraph(pageHtml);
  } catch {
    og = {};
  }

  const title = og.title || firstMatch(html, /<title[^>]*>([^<]+)<\/title>/i) || 'Video Facebook';
  const thumbnail = og.image || firstMatch(html, /"preview_image"\s*:\s*"([^"]+)"/) || null;

  return {
    title: decodeHtml(cleanText(title)),
    author: og.site_name && og.site_name !== 'Facebook' ? og.site_name : null,
    thumbnail: thumbnail ? decodeJsonish(thumbnail) : null,
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

function instagramShortcode(input) {
  const url = toUrl(input);
  if (!url) return null;
  const match = url.pathname.match(/\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]{5,})/);
  return match ? match[1] : null;
}

function instagramIdFromShortcode(shortcode) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let id = 0n;
  for (const char of shortcode) {
    const value = alphabet.indexOf(char);
    if (value < 0) continue;
    id = id * 64n + BigInt(value);
  }
  return id.toString();
}

function tweetId(input) {
  const url = toUrl(input);
  if (!url) return null;
  const match = url.pathname.match(/\/status(?:es)?\/(\d{5,})/);
  return match ? match[1] : null;
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
  return (stream.height || 0) * 1_000_000 + (stream.bitrate || 0) + (stream.hasAudio ? 1_000_000_000 : 0);
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

function bitrateFromLabel(label) {
  const match = String(label || '').match(/(\d{2,4})\s*kbps/i);
  return match ? Number(match[1]) * 1_000 : null;
}

function normalizeMime(mimeType, fallback) {
  const value = String(mimeType || '').split(';')[0].trim().toLowerCase();
  return value || fallback;
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

function absoluteUrl(value, base) {
  if (!value) return null;
  try {
    return new URL(value, base).href;
  } catch {
    return null;
  }
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
    .replace(/&nbsp;/g, ' ');
}

function decodeJsonish(value) {
  if (!value) return null;
  return decodeHtml(
    String(value)
      .replace(/\\u0026/gi, '&')
      .replace(/\\u0025/gi, '%')
      .replace(/\\u003D/gi, '=')
      .replace(/\\u003F/gi, '?')
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
    title: findMeta(html, 'og:title') || findMeta(html, 'twitter:title'),
    image: findMeta(html, 'og:image') || findMeta(html, 'twitter:image'),
    site_name: findMeta(html, 'og:site_name'),
  };
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

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
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
