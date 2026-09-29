/**
 * GET /api/schedule
 * Returns the program schedule for the public player
 */

export async function onRequest(context) {
  const { env } = context;

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (context.request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (env.STREAM_KV) {
      const raw = await env.STREAM_KV.get('schedule');
      if (raw) {
        const items = JSON.parse(raw);
        return new Response(JSON.stringify({ items }), { headers: corsHeaders });
      }
    }
    return new Response(JSON.stringify({ items: [] }), { headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ items: [], error: err.message }), {
      status: 200,
      headers: corsHeaders,
    });
  }
}
