import { extractMedia, toPublicInfo } from './_extractor.js';
import { ApiError, applyCors, handlePreflight, methodNotAllowed, readJsonBody, sendError } from './_utils.js';

export default async function handler(req, res) {
  applyCors(res);

  if (handlePreflight(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  try {
    const body = await readJsonBody(req);
    const url = normalizeInput(body.url ?? body.link ?? req.query?.url);

    const media = await extractMedia(url);

    res.setHeader('Cache-Control', 'no-store, max-age=0');
    return res.status(200).json(toPublicInfo(media));
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
