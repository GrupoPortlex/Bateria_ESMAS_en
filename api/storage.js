// api/storage.js — Vercel Serverless Function
// Garda e le as respostas da batería ESMAS-ES+ nunha base de datos Upstash Redis
// (conectada desde Vercel → Storage → Upstash for Redis).
//
// POST /api/storage            { key, value }  → garda (público: o usan os participantes)
// GET  /api/storage?prefix=... → lista claves   (protexido con TEACHER_TOKEN)
// GET  /api/storage?key=...    → le un valor    (protexido con TEACHER_TOKEN)

import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN,
  automaticDeserialization: false, // gardamos e devolvemos o texto JSON tal cal
});

// Só se aceptan claves cos prefixos que usa a batería
const ALLOWED_PREFIXES = [
  'participant:',
  'e1_sino:', 'e2_eleccion:', 'e3_consenso:', 'e4_granularidad:',
  'e5_esmas_mcr:', 'e6_productividad:', 'e7_flexibilidad:',
];
const NAMESPACE = 'esmas:'; // para non mesturar con outros datos da mesma base

function isAllowedKey(key) {
  return typeof key === 'string' && key.length < 200 &&
    ALLOWED_PREFIXES.some(p => key.startsWith(p));
}

function isTeacher(req) {
  const expected = process.env.TEACHER_TOKEN;
  return !!expected && req.headers['x-teacher-token'] === expected;
}

export default async function handler(req, res) {
  try {
    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const { key, value } = body;
      if (!isAllowedKey(key) || typeof value !== 'string') {
        return res.status(400).json({ error: 'Invalid key or value' });
      }
      await redis.set(NAMESPACE + key, value);
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'GET') {
      if (!isTeacher(req)) return res.status(401).json({ error: 'Unauthorized' });

      const { prefix, key } = req.query;

      if (key) {
        if (!isAllowedKey(key)) return res.status(400).json({ error: 'Invalid key' });
        const value = await redis.get(NAMESPACE + key);
        return res.status(200).json({ value });
      }

      if (prefix) {
        if (!ALLOWED_PREFIXES.includes(prefix)) return res.status(400).json({ error: 'Invalid prefix' });
        const keys = [];
        let cursor = '0';
        do {
          const [next, batch] = await redis.scan(cursor, { match: NAMESPACE + prefix + '*', count: 200 });
          cursor = String(next);
          batch.forEach(k => keys.push(k.slice(NAMESPACE.length)));
        } while (cursor !== '0');
        return res.status(200).json({ keys });
      }

      return res.status(400).json({ error: 'Missing prefix or key' });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
}
