export class ApiError extends Error {
  constructor(message, status = 500, code = 'INTERNAL_ERROR', details = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function applyCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Range');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('Vary', 'Origin');
}

export function handlePreflight(req, res) {
  if (req.method !== 'OPTIONS') return false;
  res.status(204).end();
  return true;
}

export function methodNotAllowed(res, allowed = ['GET']) {
  res.setHeader('Allow', allowed.join(', '));
  return res.status(405).json({
    ok: false,
    error: `Metode tidak didukung. Gunakan ${allowed.join(', ')}.`,
    code: 'METHOD_NOT_ALLOWED',
  });
}

export async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return req.body;
  }

  if (typeof req.body === 'string') {
    return parseJson(req.body);
  }

  if (Buffer.isBuffer(req.body)) {
    return parseJson(req.body.toString('utf8'));
  }

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};

  return parseJson(Buffer.concat(chunks).toString('utf8'));
}

function parseJson(raw) {
  const text = String(raw || '').trim();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Body harus berupa objek JSON.');
    }
    return parsed;
  } catch {
    throw new ApiError('Body permintaan harus berupa JSON yang valid.', 400, 'INVALID_JSON');
  }
}

export function sendError(res, error) {
  const status = Number(error?.status) || 500;
  const code = error?.code || (status >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST');
  const message = error?.message || 'Terjadi kesalahan saat memproses permintaan.';

  const payload = { ok: false, error: message, code };
  if (error?.details) payload.details = error.details;

  res.setHeader('Cache-Control', 'no-store, max-age=0');
  return res.status(status).json(payload);
}

export function sanitizeFilename(name, fallback = 'xena-media') {
  const cleaned = String(name || '')
    .normalize('NFKD')
    .replace(/[^\w\s.-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90)
    .replace(/^\.+/, '');

  return cleaned || fallback;
}

export function extensionFromMime(mimeType = '') {
  const mime = String(mimeType).toLowerCase();
  if (mime.includes('mp4')) return 'mp4';
  if (mime.includes('webm')) return 'webm';
  if (mime.includes('mpeg') || mime.includes('mp3')) return 'mp3';
  if (mime.includes('m4a') || mime.includes('mp4a')) return 'm4a';
  if (mime.includes('aac')) return 'aac';
  if (mime.includes('opus')) return 'opus';
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('gif')) return 'gif';
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
  return 'bin';
}
