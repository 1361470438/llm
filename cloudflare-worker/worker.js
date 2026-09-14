/**
 * Cloudflare Worker - 万能 LLM 动态反向代理网关
 * 
 * 核心功能：
 * 1. 彻底解决跨域：接管并拦截所有 OPTIONS 预检请求，直接返回 200 OK 与完整 CORS 标头，避开目标服务器 403 阻断。
 * 2. 全动态目标支持：
 *    - 优先读取前端请求头 `x-target-url`（或 `?url=` 查询参数），支持动态中转任意供应商（新界、DeepSeek、OpenAI、Moonshot 等）；
 *    - 若未传目标头，且访问 /v1/* 等路径，自动拼接回退到默认上游服务商。
 * 3. 原生流式传输：完全透传 SSE (text/event-stream) 流式响应，打字机输出丝滑流畅、不截断。
 * 4. 免费绑定域名：可在 Cloudflare Workers 控制台免费绑定个人专属域名（如 api.yourdomain.com）。
 */

// 默认上游目标域名（当客户端未通过 x-target-url 指定时使用）
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
    // 1. 处理浏览器的 OPTIONS 预检探测请求，直接在边缘节点返回 200 OK
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 200,
        headers: CORS_HEADERS,
      });
    }

    try {
      const url = new URL(request.url);

      // 2. 如果直接访问根路径，返回服务状态与使用指引（方便用户自检确认健康）
      if ((url.pathname === '/' || url.pathname === '') && !request.headers.get('x-target-url') && !url.searchParams.get('url')) {
        return new Response(
          JSON.stringify({
            status: 'ok',
            service: 'Cloudflare Worker Universal LLM Proxy',
            message: '代理网关正常运行中',
            features: [
              '零跨域阻断 (Auto 200 OK on OPTIONS)',
              '全动态目标转发 (via x-target-url header or ?url= param)',
              '原生 SSE 流式打字透传 (text/event-stream)'
            ],
            usage: {
              dynamic_forward_header: '携带请求头 x-target-url: https://目标供应商地址/v1/responses',
              dynamic_forward_query: `${url.origin}/api/proxy?url=https://目标供应商地址/v1/chat/completions`,
              default_fallback: `${url.origin}/v1/responses 将默认代理至 ${DEFAULT_UPSTREAM}/v1/responses`
            }
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

      // 3. 提取目标真实 URL
      let targetUrlStr =
        request.headers.get('x-target-url') ||
        request.headers.get('x-upstream-url') ||
        url.searchParams.get('url') ||
        url.searchParams.get('target');

      // 若未显式指定目标，且属于 API 路径访问，则拼接默认上游
      if (!targetUrlStr) {
        const upstreamBase = (env && env.UPSTREAM_BASE) || DEFAULT_UPSTREAM;
        const targetBase = new URL(upstreamBase);
        let basePath = targetBase.pathname.replace(/\/+$/, '');
        let reqPath = '/' + url.pathname.replace(/^\/+/, '');
        if (basePath.endsWith('/v1') && reqPath.startsWith('/v1/')) {
          reqPath = reqPath.slice(3);
        }
        const targetPath = (basePath + reqPath).replace(/\/+/g, '/');
        targetUrlStr = new URL(targetPath + url.search, targetBase.origin).toString();
      }

      // 校验目标 URL 合法性
      let targetUrl;
      try {
        targetUrl = new URL(targetUrlStr);
      } catch (_) {
        return new Response(
          JSON.stringify({
            error: {
              message: `无效的目标请求地址: "${targetUrlStr}"`,
              type: 'invalid_target_url'
            }
          }),
          {
            status: 400,
            headers: {
              ...CORS_HEADERS,
              'Content-Type': 'application/json; charset=utf-8',
            }
          }
        );
      }

      // 4. 构建向上游转发的请求头
      const newHeaders = new Headers(request.headers);
      newHeaders.set('Host', targetUrl.host);
      // 清理代理中转专有头，防止目标服务器困惑
      newHeaders.delete('x-target-url');
      newHeaders.delete('x-upstream-url');
      newHeaders.delete('cf-connecting-ip');
      newHeaders.delete('cf-ipcountry');
      newHeaders.delete('cf-ray');
      newHeaders.delete('cf-visitor');

      // 支持在后台环境变量配置全局 API_KEY 兜底
      if (env && env.API_KEY && !newHeaders.has('Authorization')) {
        newHeaders.set('Authorization', `Bearer ${env.API_KEY}`);
      }

      // 5. 发起上游请求（原生透传请求体与流）
      const reqInit = {
        method: request.method,
        headers: newHeaders,
        body: request.body,
        redirect: 'follow',
      };
      // 支持流式 body 转发时的 duplex 要求
      if (request.body) reqInit.duplex = 'half';
      const upstreamRequest = new Request(targetUrl.toString(), reqInit);

      const response = await fetch(upstreamRequest);

      // 6. 构建回传给浏览器的响应头，强制注入 CORS 允许头
      const responseHeaders = new Headers(response.headers);
      for (const [key, value] of Object.entries(CORS_HEADERS)) {
        responseHeaders.set(key, value);
      }

      // 流式响应特殊优化
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
            message: `Cloudflare 网关代理转发失败: ${err.message}`,
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
