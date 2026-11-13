import { applyCors, handlePreflight, methodNotAllowed } from './_utils.js';

export default async function handler(req, res) {
  applyCors(res);

  if (handlePreflight(req, res)) return;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return methodNotAllowed(res, ['GET', 'HEAD']);
  }

  const payload = {
    ok: true,
    status: 'healthy',
    service: 'XenaDownloader API',
    version: '1.0.0',
    runtime: `node ${process.version}`,
    platform: process.platform,
    region: process.env.VERCEL_REGION || 'local',
    environment: process.env.VERCEL_ENV || 'development',
    timestamp: new Date().toISOString(),
    uptime: Number(process.uptime().toFixed(2)),
  };

  res.setHeader('Cache-Control', 'no-store, max-age=0');
  return res.status(200).json(payload);
}
