/**
 * GET /api/stream
 * Returns the active stream configuration for the public player
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
    // Read from KV if available
    if (env.STREAM_KV) {
      const raw = await env.STREAM_KV.get('streamConfig');
      if (raw) {
        const config = JSON.parse(raw);
        // Strip sensitive data for public endpoint
        const publicConfig = {
          name:        config.name || '',
          description: config.description || '',
          url:         config.active ? config.url : null,
          thumbnail:   config.thumbnail || '',
          type:        config.type || 'hls',
          withCredentials: config.withCredentials || false,
          headers:     config.active ? (config.headers || {}) : {},
          cookies:     config.active ? (config.cookies || {}) : {},
          hlsOptions:  config.hlsOptions || {},
        };
        return new Response(JSON.stringify(publicConfig), { headers: corsHeaders });
      }
    }

    // Fallback: no stream configured
    return new Response(JSON.stringify({ url: null }), { headers: corsHeaders });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: corsHeaders,
    });
  }
}
