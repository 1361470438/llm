/**
 * Cloudflare Pages Functions - /v1/* 统一路由
 * 处理所有发往 /v1/responses, /v1/chat/completions 等接口的请求
 * 
 * 优势：
 * 1. 与前端同域：前端直接请求 /v1/responses，浏览器视为同源请求，完全不发 OPTIONS 预检，彻底告别 403 跨域！
 * 2. 边缘流式透传：原生支持 SSE 流式返回，打字机体验丝滑。
 * 3. 安全可选：支持在 Cloudflare 后台配置环境变量 API_KEY，前端免填 key。
 */

const DEFAULT_UPSTREAM = 'https://www.ssxinjie.com';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '86400',
};

export async function onRequest(context) {
  const { request, env } = context;

  // 1. 处理 OPTIONS 预检探测
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: CORS_HEADERS,
    });
  }

  try {
    const url = new URL(request.url);
    const upstreamBase = env.UPSTREAM_BASE || DEFAULT_UPSTREAM;
    const targetBase = new URL(upstreamBase);

    // 拼接上游完整地址（例如：https://www.ssxinjie.com/v1/responses）
    const targetPath = (targetBase.pathname.replace(/\/+$/, '') + '/' + url.pathname.replace(/^\/+/, '')).replace(/\/+/g, '/');
    const targetUrl = new URL(targetPath + url.search, targetBase.origin);

    const newHeaders = new Headers(request.headers);
    newHeaders.set('Host', targetBase.host);
    newHeaders.delete('cf-connecting-ip');
    newHeaders.delete('cf-ipcountry');
    newHeaders.delete('cf-ray');
    newHeaders.delete('cf-visitor');

    // 支持在 Cloudflare 后台设置全局 API_KEY（如果前端没传）
    if (env.API_KEY && !newHeaders.has('Authorization')) {
      newHeaders.set('Authorization', `Bearer ${env.API_KEY}`);
    }

    const upstreamRequest = new Request(targetUrl.toString(), {
      method: request.method,
      headers: newHeaders,
      body: request.body,
      redirect: 'follow',
    });

    const response = await fetch(upstreamRequest);
    const responseHeaders = new Headers(response.headers);
    for (const [k, v] of Object.entries(CORS_HEADERS)) {
      responseHeaders.set(k, v);
    }

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
          message: `后端代理请求失败: ${err.message}`,
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
