import { onRequest as handleStream } from './functions/api/stream.js';
import { onRequest as handleSchedule } from './functions/api/schedule.js';
import { onRequest as handleAdminStream } from './functions/api/admin/stream.js';
import { onRequest as handleAdminSchedule } from './functions/api/admin/schedule.js';
import { onRequest as handleProxy } from './functions/api/proxy.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // API Routes
    if (pathname === '/api/stream') {
      return handleStream({ request, env, waitUntil: (p) => ctx.waitUntil(p) });
    }
    if (pathname === '/api/schedule') {
      return handleSchedule({ request, env, waitUntil: (p) => ctx.waitUntil(p) });
    }
    if (pathname === '/api/admin/stream') {
      return handleAdminStream({ request, env, waitUntil: (p) => ctx.waitUntil(p) });
    }
    if (pathname === '/api/admin/schedule') {
      return handleAdminSchedule({ request, env, waitUntil: (p) => ctx.waitUntil(p) });
    }
    if (pathname === '/api/proxy') {
      return handleProxy({ request, env, waitUntil: (p) => ctx.waitUntil(p) });
    }

    // Serve static assets from public/ directory
    if (env.ASSETS) {
      // Handle /admin and /admin/ by rewriting to /admin/index.html if needed
      if (pathname === '/admin' || pathname === '/admin/') {
        const adminUrl = new URL('/admin/index.html', request.url);
        return env.ASSETS.fetch(new Request(adminUrl, request));
      }
      return env.ASSETS.fetch(request);
    }

    return new Response('Asset binding not found', { status: 404 });
  }
};
