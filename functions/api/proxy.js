/**
 * GET /api/proxy?url=<targetUrl>&h=<optionalBase64Headers>
 * Cloudflare Worker proxy for HLS (.m3u8) and MPEG-DASH (.mpd) streams.
 * Injects User-Agent, Referer, and Cookies (e.g. CloudFront signed cookies)
 * and rewrites manifests so all segments/resources are also fetched via proxy,
 * bypassing CORS restrictions in the browser.
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
    const cleanTarget = targetUrl.split('?')[0].toLowerCase();
    const hQuery = hParam ? `&h=${encodeURIComponent(hParam)}` : '';

    // ── HLS / M3U8 playlist rewriting ────────────────────────────────────────
    const isHlsPlaylist =
      contentType.includes('mpegurl') ||
      contentType.includes('x-mpegurl') ||
      cleanTarget.endsWith('.m3u8');

    if (isHlsPlaylist) {
      const manifestText = await upstreamRes.text();
      const lines = manifestText.split(/\r?\n/);

      const rewrittenLines = lines.map(line => {
        const trimmed = line.trim();
        if (!trimmed) return line;

        // Rewrite #EXT-X-KEY and #EXT-X-MAP URI attributes
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

        if (trimmed.startsWith('#')) return line; // other tags — keep as-is

        // Segment URL (relative or absolute)
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

    // ── MPEG-DASH / MPD manifest rewriting ────────────────────────────────────
    const isDashManifest =
      contentType.includes('dash+xml') ||
      cleanTarget.endsWith('.mpd') ||
      targetUrl.includes('.mpd?');

    if (isDashManifest) {
      let mpdText = await upstreamRes.text();
      const hQuery = hParam ? `&amp;h=${encodeURIComponent(hParam)}` : '';

      // 1. Rewrite existing <BaseURL> tags (both relative and absolute)
      mpdText = mpdText.replace(
        /(<BaseURL[^>]*>)([^<]+)(<\/BaseURL>)/gi,
        (_, openTag, urlText, closeTag) => {
          const trimmed = urlText.trim();
          if (trimmed.startsWith('/api/proxy')) return `${openTag}${urlText}${closeTag}`;
          try {
            const absUrl = new URL(trimmed, targetUrl).href;
            return `${openTag}/api/proxy?url=${encodeURIComponent(absUrl)}${hQuery}${closeTag}`;
          } catch {
            return `${openTag}${urlText}${closeTag}`;
          }
        }
      );

      // 2. If no <BaseURL> exists, inject targetUrl directory as base so relative segments resolve correctly
      if (!/<BaseURL\b/i.test(mpdText)) {
        const baseDirMatch = /^(https?:\/\/[^?#]*\/)/i.exec(targetUrl);
        if (baseDirMatch) {
          const absBaseDir = baseDirMatch[1];
          mpdText = mpdText.replace(
            /(<MPD\b[^>]*>)/i,
            `$1\n  <BaseURL>${absBaseDir}</BaseURL>`
          );
        }
      }

      // 3. Rewrite <Location> tags
      mpdText = mpdText.replace(
        /(<Location[^>]*>)(https?:\/\/[^<]+)(<\/Location>)/gi,
        (_, openTag, locUrl, closeTag) => {
          return `${openTag}/api/proxy?url=${encodeURIComponent(locUrl.trim())}${hQuery}${closeTag}`;
        }
      );

      return new Response(mpdText, {
        status: 200,
        headers: {
          'Content-Type': 'application/dash+xml; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        },
      });
    }

    // ── Binary segment / init segment / key file (.ts, .m4s, .mp4, .key, …) ─
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

