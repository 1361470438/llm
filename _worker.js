/**
 * Cloudflare Pages Advanced Mode - _worker.js
 * 统一接管路由与全动态 API 代理转发
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, HEAD',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '86400',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 1. 处理 OPTIONS 预检请求（直接返回 200 OK）
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 200,
        headers: CORS_HEADERS,
      });
    }

    // 2. 匹配 API 代理路由：/api/proxy 或 /v1/*
    if (
      url.pathname === '/api/proxy' ||
      url.pathname.startsWith('/api/proxy') ||
      url.pathname.startsWith('/v1/')
    ) {
      try {
        // 获取动态目标地址（支持 x-target-url 请求头或 ?url= 查询参数）
        let targetUrlStr =
          request.headers.get('x-target-url') ||
          request.headers.get('x-upstream-url') ||
          url.searchParams.get('url') ||
          url.searchParams.get('target');

        // 若未指定目标，且为 /v1/* 请求，默认拼接到配置的上游基址
        if (!targetUrlStr) {
          const defaultBase = env.UPSTREAM_BASE || 'https://www.ssxinjie.com';
          targetUrlStr = defaultBase.replace(/\/+$/, '') + url.pathname + url.search;
        }

        let targetUrl;
        try {
          targetUrl = new URL(targetUrlStr);
        } catch (_) {
          return new Response(
            JSON.stringify({
              error: {
                message: `无效的目标地址: "${targetUrlStr}"`,
                type: 'invalid_target_url',
              },
            }),
            {
              status: 400,
              headers: {
                ...CORS_HEADERS,
                'Content-Type': 'application/json; charset=utf-8',
              },
            }
          );
        }

        // 构建向上游转发的请求头
        const newHeaders = new Headers(request.headers);
        newHeaders.set('Host', targetUrl.host);
        newHeaders.delete('x-target-url');
        newHeaders.delete('x-upstream-url');
        newHeaders.delete('cf-connecting-ip');
        newHeaders.delete('cf-ipcountry');
        newHeaders.delete('cf-ray');
        newHeaders.delete('cf-visitor');

        if (env.API_KEY && !newHeaders.has('Authorization')) {
          newHeaders.set('Authorization', `Bearer ${env.API_KEY}`);
        }

        // 向真实上游发起请求
        const reqInit = {
          method: request.method,
          headers: newHeaders,
          body: request.body,
          redirect: 'follow',
        };
        if (request.body) reqInit.duplex = 'half';
        const upstreamRequest = new Request(targetUrl.toString(), reqInit);

        const response = await fetch(upstreamRequest);

        // 复制响应头并注入 CORS 标头
        const responseHeaders = new Headers(response.headers);
        for (const [k, v] of Object.entries(CORS_HEADERS)) {
          responseHeaders.set(k, v);
        }

        // 流式响应禁用缓存与缓冲
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('text/event-stream')) {
          responseHeaders.set('Cache-Control', 'no-cache, no-transform');
          responseHeaders.set('X-Accel-Buffering', 'no');
        }

        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: responseHeaders,
        });
      } catch (err) {
        return new Response(
          JSON.stringify({
            error: {
              message: `代理中转请求失败: ${err.message}`,
              type: 'proxy_error',
            },
          }),
          {
            status: 502,
            headers: {
              ...CORS_HEADERS,
              'Content-Type': 'application/json; charset=utf-8',
            },
          }
        );
      }
    }

    // 3. 静态资源（index.html, css, js 等）直接由 Cloudflare 边缘托管服务
    if (env.ASSETS && typeof env.ASSETS.fetch === 'function') {
      return env.ASSETS.fetch(request);
    }

    return new Response('Not Found', { status: 404 });
  },
};
