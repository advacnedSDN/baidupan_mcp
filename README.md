# baidu-netdisk-mcp

一个最小的 MCP server，把百度网盘开放平台 API 包装成 Claude Code 可调用的工具。

## 前置条件

- Node.js >= 18（本机当前未检测到 node，请先自行安装）
- 已在 [百度网盘开放平台](https://pan.baidu.com/union) 创建应用，拿到 `AppKey` / `SecretKey`
  - 应用类型选「个人应用」通常即可用于 list/search/download/upload
  - **分享链接（baidu_create_share_link）需要额外的分享权限审核**，个人应用不一定能通过，失败属预期，非本项目 bug

## 安装

```bash
cd baidu-netdisk-mcp
npm install
cp .env.example .env
# 编辑 .env，填入 BAIDU_APP_KEY / BAIDU_SECRET_KEY
```

## 一次性授权

```bash
npm run authorize
```

这会走设备码流程：终端打印一个网址和一个 code，你用手机或浏览器登录百度账号、打开网址、输入 code 完成授权，脚本会自动轮询并把 `access_token` / `refresh_token` 保存到 `~/.baidu-netdisk-mcp/tokens.json`（可用 `BAIDU_TOKEN_STORE` 环境变量改路径）。

Token 过期前 MCP server 会自动用 `refresh_token` 续期，无需重复授权（除非 refresh_token 本身失效）。

## 注册到 Claude Code

在项目根目录或全局配置里加一个 MCP server 条目，例如项目级 `.mcp.json`：

```json
{
  "mcpServers": {
    "baidu-netdisk": {
      "command": "node",
      "args": ["/绝对路径/baidu-netdisk-mcp/src/server.js"],
      "env": {
        "BAIDU_APP_KEY": "你的appkey",
        "BAIDU_SECRET_KEY": "你的secretkey"
      }
    }
  }
}
```

或者用命令行：

```bash
claude mcp add baidu-netdisk node /绝对路径/baidu-netdisk-mcp/src/server.js
```

如果用命令行添加，记得在运行 Claude Code 前把 `BAIDU_APP_KEY`/`BAIDU_SECRET_KEY` 也导出到环境变量，或者改用上面的 `.mcp.json` 写法把 env 写死在配置里。

## 部署到云端（远程 HTTP 模式）

默认的 `src/server.js` 用的是 stdio transport，只能被 Claude Code 当子进程拉起、跑在本地。要放到云端随时连，用 `src/httpServer.js`（Streamable HTTP transport + Bearer token 鉴权）。

**重要：** 这个 server 一旦跑起来并公网可达，任何拿到 `MCP_AUTH_TOKEN` 的人都能用你的百度网盘账号操作文件；`refresh_token` 也会常驻在云主机上。请只部署在你自己控制的服务器上，务必配 TLS，`MCP_AUTH_TOKEN` 当密码一样保管。

### 1. 先在本地完成一次性授权

`npm run authorize` 必须能弹出浏览器登录，建议还是在本地机器上先跑一次，拿到 `~/.baidu-netdisk-mcp/tokens.json`，再把这个文件拷到云主机上（或者直接在云主机上跑 `npm run authorize`，只要它能出网访问 `openapi.baidu.com` 即可）。

### 2. 生成鉴权密钥

```bash
openssl rand -hex 32
```

把结果填进云主机的 `.env` 的 `MCP_AUTH_TOKEN`。

### 3a. 直接用 Node 跑

```bash
npm install
npm run start:http
# 监听 http://0.0.0.0:3000/mcp
```

### 3b. 用 Docker 跑

```bash
docker build -t baidu-netdisk-mcp .
docker run -d \
  --name baidu-netdisk-mcp \
  -p 127.0.0.1:3000:3000 \
  --env-file .env \
  -v ~/.baidu-netdisk-mcp:/root/.baidu-netdisk-mcp \
  baidu-netdisk-mcp
```

`-v` 把 token 存储目录挂进容器，否则容器重启会丢 token、得重新授权。

### 4. 前面套一层 TLS 反代

不要把 3000 端口直接暴露到公网（Bearer token 走明文 HTTP 等于裸奔）。最简单是用 [Caddy](https://caddyserver.com/)（自动签证书），参考仓库里的 `Caddyfile.example`：

```
your-domain.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

`caddy run` 起来后，对外地址就是 `https://your-domain.example.com/mcp`。

### 5. 在 Claude Code 里连远程 server

```bash
claude mcp add --transport http baidu-netdisk https://your-domain.example.com/mcp \
  --header "Authorization: Bearer 你的MCP_AUTH_TOKEN"
```

（`claude mcp add` 的具体参数以你本地 `claude mcp add --help` 为准，不同版本可能有出入。）

## 提供的工具

| 工具 | 说明 |
| --- | --- |
| `baidu_list_dir` | 列出某目录下的文件/文件夹 |
| `baidu_search_files` | 按关键字递归搜索文件 |
| `baidu_download_file` | 下载网盘文件到本地路径 |
| `baidu_upload_file` | 上传本地文件到网盘指定路径（自动分片、覆盖同名文件） |
| `baidu_create_share_link` | 为文件/文件夹创建分享链接（需应用有分享权限） |

## 已知限制 / 待验证

- 未在本机实际跑通（环境没有 node），逻辑基于百度开放平台公开文档实现，接入后如遇 `errno` 报错，多半是该应用未获得对应接口权限，去开发者后台查看接口权限列表。
- 个人开发者应用通常有网盘容量/接口调用频率限制（历史上常见 20GB 总量限制），大文件上传前请确认额度。
- 上传分片大小固定 4MB，超大文件会顺序上传多个分片，暂无并发/断点续传。
- HTTP 模式（`src/httpServer.js`）用的是无状态（stateless）Streamable HTTP，每个请求起一个新的 McpServer 实例，实现简单但没有服务端主动推送/多会话能力；单用户个人使用够用，多人共用建议按用户拆 token 存储路径。
