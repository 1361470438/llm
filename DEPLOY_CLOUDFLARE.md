# Cloudflare Pages 全栈一体化部署与自定义域名绑定指南

本项目已全面升级为 **Cloudflare Pages 全栈一体化同源架构**：
- **前端静态资源**：`index.html`、`css/`、`js/`、`assets/` 等。
- **边缘动态代理**：`_worker.js` + `_routes.json`，在同一域名下直接接管 `/api/proxy` 与 `/v1/*` 动态转发。
- **纯前端密钥控制**：后端不配置、不存储任何 `API_KEY`，密钥完全由用户在前端设置中输入并保存在本地浏览器中，由后端边缘服务进行纯透明加密转发。

---

## 核心优势

1. **同源零跨域**：静态页面与代理 API 运行在完全相同的域名下，**100% 免 OPTIONS 预检请求**，彻底告别浏览器跨域拦截与 WAF 403 阻断！
2. **极简运维（单项目）**：无需单独创建和维护第二个代理 Worker 项目，无需占用额外的二级域名，一个 Pages 项目搞定全栈。
3. **主备智能容灾**：前端优先直连目标大模型；跨域受限时优先走本站同源代理 `/api/proxy`；万一当前节点异常，自动无缝降级至内置备用网关。
4. **完全免费**：Cloudflare Pages 静态流量不限量，每日免费提供 100,000 次边缘函数请求。
5. **一键绑定自定义域名**：自动配置全球 Anycast CDN 和免费 SSL/TLS 证书（全自动 HTTPS）。

---

## 方式一：GitHub 自动部署（最推荐，更新代码最方便）

### 1. 将项目推送到 GitHub
如果你已有 GitHub 账号：
1. 在 GitHub 上新建一个仓库（例如 `llm-chat`）。
2. 在本地项目根目录打开终端执行：
   ```bash
   git init
   git add .
   git commit -m "feat: fullstack cloudflare pages support"
   git branch -M main
   git remote add origin https://github.com/你的用户名/llm-chat.git
   git push -u origin main
   ```

### 2. 在 Cloudflare Pages 中导入
1. 打开并登录 [Cloudflare 控制台](https://dash.cloudflare.com/)。
2. 左侧导航点击 **Workers & Pages** -> 点击 **Create Application**。
3. 选择 **Pages** 选项卡 -> 点击 **Connect to Git**（连接到 Git）。
4. 选择刚才创建的 `llm-chat` 仓库，点击 **Begin setup**（开始设置）。
5. 在构建设置中：
   * **Project name**（项目名称）：自定（如 `my-llm-chat`）。
   * **Framework preset**（框架预设）：选择 **None**。
   * **Build command**（构建命令）：**留空**。
   * **Build output directory**（构建输出目录）：填 **`.`**（即根目录）。
6. 点击 **Save and Deploy**（保存并部署）。

---

## 方式二：网页端直接上传（无需 Git，2 分钟搞定）

如果你不想使用 Git / GitHub：
1. 将本地 `llm-chat` 文件夹整理好（确保包含 `_worker.js`、`_routes.json`、`index.html` 以及 `js`、`css` 等文件夹）。
2. 打开 [Cloudflare 控制台](https://dash.cloudflare.com/)。
3. 左侧导航点击 **Workers & Pages** -> 点击 **Create Application**。
4. 选择 **Pages** 选项卡 -> 点击 **Upload assets**（上传资产）。
5. 输入项目名称（如 `my-chat`），点击 **Create project**。
6. 直接将项目文件夹拖入上传区域，或打包成 zip 上传。
7. 点击 **Deploy site**，完成部署！

---

## 绑定自定义域名（完全免费）

部署成功后，Cloudflare 会赠送一个默认的 `*.pages.dev` 域名。如果你想使用自己的个性域名：

1. 在 Pages 项目详情页中，切换到 **Custom domains**（自定义域）选项卡。
2. 点击 **Set up a custom domain**（设置自定义域）。
3. 输入你的域名（例如 `chat.yourdomain.com` 或主域名 `yourdomain.com`）。
4. 点击 **Continue**（继续）：
   * 如果你的域名已经在 Cloudflare 托管解析，系统会自动添加 CNAME 记录，一秒生效！
   * 如果你的域名在阿里云、腾讯云等其他平台，按照页面提示在你域名的 DNS 管理后台添加一条指向 `你的项目.pages.dev` 的 **CNAME** 记录即可。
5. Cloudflare 会自动为你申请并签发免费的 SSL/TLS 证书（全自动 HTTPS）。

---

## 密钥与模型使用说明

- **无需在 Cloudflare 后台配置 API_KEY**：
  打开部署完成的网站，点击左下角的 **「设置」** $\rightarrow$ **「API 配置」**，填入你的 API Key 及对应的 API Base 地址即可开始对话。
- 所有密钥仅加密缓存在你的本地浏览器（IndexedDB / localStorage）中，绝不上传任何云端服务器，保障资产与隐私安全。
