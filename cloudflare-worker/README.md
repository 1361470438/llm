# Cloudflare Worker LLM 跨域反向代理部署指南

## 1. 登录 Cloudflare
访问 [https://dash.cloudflare.com/](https://dash.cloudflare.com/) 登录（没有账号可免费注册）。

## 2. 创建 Worker
1. 在左侧导航栏点击 **Compute (Workers & Pages)**（或直接叫 **Workers & Pages**）。
2. 点击右上角的 **Create Application**（创建应用程序）按钮。
3. 选择 **Workers** 选项卡，点击 **Create Worker**（创建 Worker）。
4. 系统会给出一个默认名称（如 `llm-proxy`），直接点击右下角的 **Deploy**（部署）。

## 3. 粘贴代码
1. 部署完成后，点击右上角（或页面中央）的 **Edit code**（编辑代码）。
2. 将左侧编辑器里的默认代码全部清空。
3. 复制 `worker.js` 的完整代码并粘贴进去。
4. 点击右上角的 **Deploy**（部署）按钮。

## 4. 获取你的专属代理域名
部署成功后，返回 Worker 概览页，你会看到一个类似下面的专属域名：
```
https://llm-proxy.xxxx.workers.dev
```

在浏览器直接打开这个地址，如果看到如下 JSON 提示，说明部署大功告成：
```json
{
  "status": "ok",
  "message": "Cloudflare Worker LLM Proxy 运行中",
  "default_upstream": "https://www.ssxinjie.com"
}
```

## 5. 在网页中填入该代理地址
回到你的聊天应用（本地或 axureshow 部署的页面）：
1. 点击右上角 **设置**（齿轮图标）。
2. 在 **API Base** 输入框中，将原来的 `https://www.ssxinjie.com` 改为：
   ```
   https://llm-proxy.xxxx.workers.dev/v1
   ```
   *(或者直接填 `https://llm-proxy.xxxx.workers.dev`，系统会自动补齐 `/v1`)*
3. 接口协议：选择 **Responses API (新版)** 或保持默认。
4. API Key：依然填你的真实 Key（如 `sk-294b8c52...`）。
5. 点击 **保存设置**。

至此，彻底告别跨域和 OPTIONS 403 阻断！
