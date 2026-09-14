/**
 * Cloudflare Worker - OpenAI & LLM API 跨域反向代理
 * 
 * 功能特点：
 * 1. 彻底解决跨域：接管并拦截 OPTIONS 预检请求，直接返回 200 OK 与完整 CORS 头。
 * 2. 完美支持流式传输：原生透传 SSE (text/event-stream) 流式响应，打字机效果不卡顿、不缓冲。
 * 3. 灵活的目标地址：默认转发至 https://www.ssxinjie.com，也支持在 Cloudflare 后台设置环境变量 UPSTREAM_BASE。
 */

// 默认上游目标域名（末尾不带斜杠）
const DEFAULT_UPSTREAM = 'https://www.ssxinjie.com';

// 统一的跨域响应头
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, HEAD',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '86400',
};

export default {
  async fetch(request, env, ctx) {
    // 1. 拦截并处理浏览器的 OPTIONS 预检探测请求，直接返回 200 OK
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 200,
        headers: CORS_HEADERS,
      });
    }

    try {
      const url = new URL(request.url);

      // 如果直接在浏览器根路径访问，显示运行状态提示页
      if (url.pathname === '/' || url.pathname === '') {
        return new Response(
          JSON.stringify({
            status: 'ok',
            message: 'Cloudflare Worker LLM Proxy 运行中',
            default_upstream: DEFAULT_UPSTREAM,
            usage_example: `${url.origin}/v1/responses 或 ${url.origin}/v1/chat/completions`
          }, null, 2),
          {
            status: 200,
            headers: {
              ...CORS_HEADERS,
              'Content-Type': 'application/json; charset=utf-8',
            },
          }
        );
      }

      // 目标上游基址（支持后台环境变量覆盖）
      const upstreamBase = (env && env.UPSTREAM_BASE) || DEFAULT_UPSTREAM;
      const targetBase = new URL(upstreamBase);

      // 拼接目标完整路径与参数
      const targetPath = (targetBase.pathname.replace(/\/+$/, '') + '/' + url.pathname.replace(/^\/+/, '')).replace(/\/+/g, '/');
      const targetUrl = new URL(targetPath + url.search, targetBase.origin);

      // 复制并修正请求头
      const newHeaders = new Headers(request.headers);
      newHeaders.set('Host', targetBase.host);

      // 移除可能引起 Cloudflare 循环校验的专有标头
      newHeaders.delete('cf-connecting-ip');
      newHeaders.delete('cf-ipcountry');
      newHeaders.delete('cf-ray');
      newHeaders.delete('cf-visitor');

      // 构造转发请求（流式 body 原生透传）
      const upstreamRequest = new Request(targetUrl.toString(), {
        method: request.method,
        headers: newHeaders,
        body: request.body,
        redirect: 'follow',
      });

      // 发起上游请求
      const response = await fetch(upstreamRequest);

      // 复制响应头并注入 CORS 标头
      const responseHeaders = new Headers(response.headers);
      for (const [key, value] of Object.entries(CORS_HEADERS)) {
        responseHeaders.set(key, value);
      }

      // 如果是流式响应，禁用浏览器端缓存与缓冲
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('text/event-stream')) {
        responseHeaders.set('Cache-Control', 'no-cache, no-transform');
        responseHeaders.set('X-Accel-Buffering', 'no');
      }

      // 返回流式响应给客户端
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      });
    } catch (err) {
      return new Response(
        JSON.stringify({
          error: {
            message: `代理转发失败: ${err.message}`,
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
  },
};
