# Cloudflare Pages 全栈免费部署与自定义域名绑定指南

本项目现已完美升级为 **前端 + 后端（Pages Functions）一体化全栈架构**：
- **前端静态资源**：`index.html`、`css/`、`js/` 等。
- **后端服务端函数**：`functions/v1/[[path]].js`，自动在边缘节点代理 OpenAI / Responses API 请求。
- **核心优势**：
  1. **完全同源**：前端直接请求 `/v1/responses`，浏览器视为同源请求，**100% 不触发 OPTIONS 预检**，彻底根除跨域与 403 阻断！
  2. **完全免费**：Cloudflare Pages 静态流量不限量，后端 Functions 每天免费 100,000 次请求。
  3. **免费绑定自定义域名**：自动配置全球 CDN 和免费 SSL 证书（HTTPS）。

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
   * **Project name**（项目名称）：保持默认或自定（如 `my-llm-chat`）。
   * **Framework preset**（框架预设）：选择 **None**。
   * **Build command**（构建命令）：留空。
   * **Build output directory**（构建输出目录）：填 **`.`**（即当前根目录）。
6. 点击 **Save and Deploy**（保存并部署）。

---

## 方式二：网页端直接上传（无需 Git，2 分钟搞定）

如果你不想使用 Git / GitHub：
1. 将本地 `llm-chat` 文件夹整理好（确保包含 `index.html` 以及 `functions` 文件夹）。
2. 打开 [Cloudflare 控制台](https://dash.cloudflare.com/)。
3. 左侧导航点击 **Workers & Pages** -> 点击 **Create Application**。
4. 选择 **Pages** 选项卡 -> 点击 **Upload assets**（上传资产）。
5. 输入项目名称（如 `my-chat`），点击 **Create project**。
6. 直接将项目文件夹拖入上传区域，或打包成 zip 上传。
7. 点击 **Deploy site**，完成部署！

---

## 绑定自定义域名（完全免费）

部署成功后，Cloudflare 会赠送一个默认的 `*.pages.dev` 域名。如果你想使用自己的域名：

1. 在 Pages 项目详情页中，切换到 **Custom domains**（自定义域）选项卡。
2. 点击 **Set up a custom domain**（设置自定义域）。
3. 输入你的域名（例如 `chat.yourdomain.com` 或主域名 `yourdomain.com`）。
4. 点击 **Continue**（继续）：
   * 如果你的域名已经在 Cloudflare 解析，系统会自动添加 CNAME 记录，一秒生效！
   * 如果你的域名在阿里云、腾讯云等其他平台，按照页面提示在你购买域名的 DNS 管理后台添加一条指向 `你的项目.pages.dev` 的 **CNAME** 记录即可。
5. Cloudflare 会自动为你申请并签发免费的 SSL/TLS 证书（全自动 HTTPS）。

---

## 环境变量配置（可选）

在 Pages 项目的 **Settings** -> **Environment variables**（环境变量）中：
* **`UPSTREAM_BASE`**：默认是 `https://www.ssxinjie.com`。如果有其他目标接口，可在此修改。
* **`API_KEY`**：如果不希望在前端输入 API Key，可以直接在此填入你的 Key（如 `sk-294b8c...`），前端无需填写 Key 也能直接对话。
