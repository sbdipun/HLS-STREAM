/**
 * Admin Schedule API
 * PUT /api/admin/schedule  — Update schedule
 * GET /api/admin/schedule  — Get schedule
 */

function verifyToken(request, env) {
  const token = request.headers.get('X-Admin-Token');
  if (!token) return false;
  try {
    const decoded = atob(token);
    const stored  = env.ADMIN_PASSWORD || 'admin123';
    return decoded === stored;
  } catch {
    return false;
  }
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Token',
  'Content-Type': 'application/json',
};

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (!verifyToken(request, env)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: corsHeaders,
    });
  }

  if (request.method === 'GET') {
    if (!env.STREAM_KV) return new Response(JSON.stringify([]), { headers: corsHeaders });
    const raw = await env.STREAM_KV.get('schedule');
    return new Response(raw || '[]', { headers: corsHeaders });
  }

  if (request.method === 'PUT') {
    const body = await request.json();
    if (!env.STREAM_KV) {
      return new Response(JSON.stringify({ ok: false, error: 'KV not configured' }), { headers: corsHeaders });
    }
    await env.STREAM_KV.put('schedule', JSON.stringify(body));
    return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
  }

  return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
}
