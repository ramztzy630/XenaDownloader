import { buildDownload, extractMedia } from './_extractor.js';
import { ApiError, applyCors, handlePreflight, methodNotAllowed, readJsonBody, sendError } from './_utils.js';

const ALLOWED_FORMATS = ['video', 'audio', 'photo'];

export default async function handler(req, res) {
  applyCors(res);

  if (handlePreflight(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  try {
    const body = await readJsonBody(req);
    const url = normalizeInput(body.url ?? body.link ?? req.query?.url);
    const format = normalizeFormat(body.format ?? req.query?.format);
    const quality = normalizeQuality(body.quality ?? req.query?.quality);
    const index = body.index ?? req.query?.index;

    const media = await extractMedia(url);
    const payload = buildDownload(media, { format, quality, index });

    res.setHeader('Cache-Control', 'no-store, max-age=0');
    return res.status(200).json(payload);
  } catch (error) {
    return sendError(res, error);
  }
}

function normalizeInput(value) {
  if (Array.isArray(value)) value = value[0];
  if (typeof value !== 'string' || !value.trim()) {
    throw new ApiError('Parameter "url" wajib diisi dengan tautan media.', 400, 'MISSING_URL');
  }
  return value.trim();
}

function normalizeFormat(value) {
  if (value === undefined || value === null || value === '') return 'video';
  const format = String(value).toLowerCase();
  if (!ALLOWED_FORMATS.includes(format)) {
    throw new ApiError('Parameter "format" harus bernilai video, audio, atau photo.', 400, 'INVALID_FORMAT');
  }
  return format;
}

function normalizeQuality(value) {
  if (Array.isArray(value)) value = value[0];
  if (value === undefined || value === null) return '';
  return String(value).trim().slice(0, 20);
}
