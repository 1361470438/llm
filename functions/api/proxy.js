/**
 * Cloudflare Pages Functions - 通用万能 API 动态代理服务
 * 路由：/api/proxy
 * 
 * 功能特点：
 * 1. 动态转发：通过 x-target-url 请求头或 ?url= 查询参数，支持将请求安全转发到任意大模型供应商
 *    （例如：https://www.ssxinjie.com/v1/responses、https://api.deepseek.com/v1/chat/completions 等）。
 * 2. 彻底消灭跨域：在同域下前端直接发起请求，零 OPTIONS 预检，零 CORS 阻断；若外部跨域访问本代理，返回 200 OK 与完整 CORS 标头。
 * 3. 完美流式支持：原生透传 SSE (text/event-stream)，打字机流式输出丝滑流畅。
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, HEAD',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '86400',
};

export async function onRequest(context) {
  const { request, env } = context;

  // 1. 处理 OPTIONS 预检请求（直接返回 200 OK）
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: CORS_HEADERS,
    });
  }

  try {
    const reqUrl = new URL(request.url);

    // 2. 解析动态目标 URL
    let targetUrlStr = request.headers.get('x-target-url') ||
                       request.headers.get('x-upstream-url') ||
                       reqUrl.searchParams.get('url') ||
                       reqUrl.searchParams.get('target');

    // 兜底默认目标
    if (!targetUrlStr) {
      const defaultBase = env.UPSTREAM_BASE || 'https://www.ssxinjie.com';
      targetUrlStr = defaultBase.replace(/\/+$/, '') + '/v1/responses';
    }

    // 简单校验 URL 合法性
    let targetUrl;
    try {
      targetUrl = new URL(targetUrlStr);
    } catch (_) {
      return new Response(
        JSON.stringify({
          error: {
            message: `无效的目标请求地址: "${targetUrlStr}"，请检查 API Base 配置`,
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

    // 3. 构建向上游转发的请求头
    const newHeaders = new Headers(request.headers);
    newHeaders.set('Host', targetUrl.host);

    // 清理前端与 Cloudflare 代理专有标头，防止目标服务器混淆
    newHeaders.delete('x-target-url');
    newHeaders.delete('x-upstream-url');
    newHeaders.delete('cf-connecting-ip');
    newHeaders.delete('cf-ipcountry');
    newHeaders.delete('cf-ray');
    newHeaders.delete('cf-visitor');

    // 4. 向上游目标 API 发起真实请求
    const upstreamRequest = new Request(targetUrl.toString(), {
      method: request.method,
      headers: newHeaders,
      body: request.body,
      redirect: 'follow',
    });

    const response = await fetch(upstreamRequest);

    // 5. 构建回传给浏览器的响应头，并注入 CORS 标头
    const responseHeaders = new Headers(response.headers);
    for (const [k, v] of Object.entries(CORS_HEADERS)) {
      responseHeaders.set(k, v);
    }

    // 流式响应特殊处理
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/event-stream')) {
      responseHeaders.set('Cache-Control', 'no-cache, no-transform');
      responseHeaders.set('X-Accel-Buffering', 'no');
    }

    // 返回流式响应或完整 JSON
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
