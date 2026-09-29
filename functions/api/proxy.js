/**
/**
 * GET /api/proxy?url=<targetUrl>&h=<optionalBase64Headers>
 * High-performance Cloudflare Worker proxy for HLS / M3U8 live streams.
 * Injects User-Agent, Referer, and Cookies (e.g. CloudFront signed cookies)
 * and rewrites playlists so segments bypass CORS and browser cookie blocks.
 */

export async function onRequest(context) {
  const { request, env } = context;

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': '*',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const reqUrl = new URL(request.url);
  const targetUrlParam = reqUrl.searchParams.get('url');

  if (!targetUrlParam) {
    return new Response(JSON.stringify({ error: 'Missing ?url parameter' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let targetUrl;
  try {
    targetUrl = decodeURIComponent(targetUrlParam);
  } catch {
    targetUrl = targetUrlParam;
  }

  // 1. Resolve custom headers and cookies
  let customHeaders = {};
  let customCookies = {};

  // Check query param &h= (base64 encoded JSON for preview/direct use)
  const hParam = reqUrl.searchParams.get('h');
  if (hParam) {
    try {
      let jsonStr;
      try {
        jsonStr = decodeURIComponent(escape(atob(hParam)));
      } catch {
        jsonStr = atob(hParam);
      }
      const decoded = JSON.parse(jsonStr);
      if (decoded.headers) customHeaders = { ...customHeaders, ...decoded.headers };
      if (decoded.cookies) customCookies = { ...customCookies, ...decoded.cookies };
    } catch (_) {}
  }

  // Fallback: Check KV storage if available
  if (env.STREAM_KV && Object.keys(customHeaders).length === 0 && Object.keys(customCookies).length === 0) {
    try {
      const raw = await env.STREAM_KV.get('streamConfig');
      if (raw) {
        const config = JSON.parse(raw);
        if (config.headers) customHeaders = { ...customHeaders, ...config.headers };
        if (config.cookies) customCookies = { ...customCookies, ...config.cookies };
      }
    } catch (_) {}
  }

  // 2. Build upstream headers
  const forwardHeaders = new Headers();
  forwardHeaders.set('Accept', '*/*');

  // Set User-Agent
  const ua = customHeaders['User-Agent'] || customHeaders['user-agent'] ||
    request.headers.get('user-agent') ||
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  forwardHeaders.set('User-Agent', ua);

  // Set Referer
  const referer = customHeaders['Referer'] || customHeaders['referer'];
  if (referer) {
    forwardHeaders.set('Referer', referer);
  }

  // Build and set Cookie header
  const cookieParts = [];
  if (customHeaders['Cookie'] || customHeaders['cookie']) {
    cookieParts.push(customHeaders['Cookie'] || customHeaders['cookie']);
  }
  Object.entries(customCookies).forEach(([k, v]) => {
    // Avoid duplicates if already in Cookie header
    if (!cookieParts.some(c => c.includes(`${k}=`))) {
      cookieParts.push(`${k}=${v}`);
    }
  });

  if (cookieParts.length > 0) {
    forwardHeaders.set('Cookie', cookieParts.join('; '));
  }

  // Forward any other custom headers (excluding hop-by-hop)
  const excludedHeaders = new Set(['host', 'user-agent', 'referer', 'cookie', 'cf-ray', 'cf-connecting-ip']);
  Object.entries(customHeaders).forEach(([k, v]) => {
    if (!excludedHeaders.has(k.toLowerCase())) {
      forwardHeaders.set(k, v);
    }
  });

  try {
    const upstreamRes = await fetch(targetUrl, {
      method: 'GET',
      headers: forwardHeaders,
      redirect: 'follow',
    });

    if (!upstreamRes.ok && upstreamRes.status !== 206) {
      return new Response(`Upstream returned ${upstreamRes.status}: ${upstreamRes.statusText}`, {
        status: upstreamRes.status,
        headers: corsHeaders,
      });
    }

    const contentType = upstreamRes.headers.get('content-type') || '';
    const isPlaylist = contentType.includes('mpegurl') ||
                       contentType.includes('application/x-mpegURL') ||
                       targetUrl.includes('.m3u8');

    if (isPlaylist) {
      const manifestText = await upstreamRes.text();
      const lines = manifestText.split(/\r?\n/);
      const hQuery = hParam ? `&h=${encodeURIComponent(hParam)}` : '';

      const rewrittenLines = lines.map(line => {
        const trimmed = line.trim();
        if (!trimmed) return line;

        // Rewrite encryption keys and init segments: #EXT-X-KEY:...,URI="..."
        if (trimmed.startsWith('#EXT-X-KEY') || trimmed.startsWith('#EXT-X-MAP')) {
          return trimmed.replace(/URI=["']([^"']+)["']/g, (_, uri) => {
            try {
              const absUrl = new URL(uri, targetUrl).href;
              return `URI="/api/proxy?url=${encodeURIComponent(absUrl)}${hQuery}"`;
            } catch {
              return `URI="${uri}"`;
            }
          });
        }

        // Keep standard comment lines
        if (trimmed.startsWith('#')) {
          return line;
        }

        // Segment or sub-playlist URL
        try {
          const absUrl = new URL(trimmed, targetUrl).href;
          return `/api/proxy?url=${encodeURIComponent(absUrl)}${hQuery}`;
        } catch {
          return line;
        }
      });

      return new Response(rewrittenLines.join('\n'), {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        },
      });
    }

    // Binary segment or key file (.ts, .m4s, .key, etc.)
    const responseHeaders = new Headers(upstreamRes.headers);
    responseHeaders.set('Access-Control-Allow-Origin', '*');
    responseHeaders.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    responseHeaders.set('Access-Control-Expose-Headers', '*');

    return new Response(upstreamRes.body, {
      status: upstreamRes.status,
      headers: responseHeaders,
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: 'Proxy request failed', message: err.message }), {
      status: 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}
