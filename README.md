# baidu-netdisk-mcp

一个最小的 MCP server，把百度网盘开放平台 API 包装成 Claude Code 可调用的工具。

## 前置条件

- Node.js >= 18（已在 v22 上实测通过；没有系统 node 时可装到用户目录，见下文「接入实录」）
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

推荐用 `claude mcp add` 注册到用户级（所有项目可用），并用 Node 自带的 `--env-file` 显式指定 `.env`：

```bash
claude mcp add baidu-netdisk -s user -- \
  "$(command -v node)" --env-file=/绝对路径/baidu-netdisk-mcp/.env \
  /绝对路径/baidu-netdisk-mcp/src/server.js
```

为什么要 `--env-file`：`src/server.js` 用 `dotenv/config` 读 `.env`，而 dotenv 默认从**当前工作目录**找 `.env`。Claude Code 拉起 MCP 子进程时，工作目录是你打开 Claude Code 的项目目录，不是本仓库，所以只靠 dotenv 会读不到 AppKey。`--env-file`（Node >= 20.6）用绝对路径加载，不依赖工作目录，密钥也不用写进 Claude 的配置文件。

`node` 也建议写绝对路径：Claude Code 未必继承你交互 shell 的 `PATH`（比如 node 装在 `~/.local/node/bin`、nvm 等位置时）。

验证：

```bash
claude mcp get baidu-netdisk   # Status 应为 ✔ Connected
```

然后在 Claude Code 里重开会话，就能看到 `mcp__baidu-netdisk__*` 这组工具。

<details>
<summary>备选：项目级 <code>.mcp.json</code>（把 env 写进配置）</summary>

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

注意这样密钥会以明文存在 `.mcp.json` 里，别把它提交到仓库。
</details>

## 接入实录（Linux，2026-09）

下面是在一台没有系统 Node 的 Linux 机器上，从零接入 Claude Code 的实际步骤。

1. **安装 Node 到用户目录**（不需要 sudo）：从 nodejs.org 下载 Linux x64 的 v22 LTS 预编译包，解压到 `~/.local/node`，把 `~/.local/node/bin` 加进 `PATH`。
2. **安装依赖**：`npm install`（生成的 `package-lock.json` 已提交，锁定依赖版本）。
3. **百度开放平台建应用**：在 <https://pan.baidu.com/union> 创建个人应用，把 AppKey / SecretKey 填进 `.env`（`cp .env.example .env`；`.env` 已在 `.gitignore` 里，建议 `chmod 600 .env`）。
4. **授权**：`npm run authorize`，按提示在浏览器打开网址、输入 code，完成后 token 写入 `~/.baidu-netdisk-mcp/tokens.json`（权限 600）。
5. **注册到 Claude Code**：

   ```bash
   claude mcp add baidu-netdisk -s user -- \
     ~/.local/node/bin/node --env-file=$HOME/code/baidu-netdisk-mcp/.env \
     $HOME/code/baidu-netdisk-mcp/src/server.js
   ```

6. **确认连接**：`claude mcp get baidu-netdisk` 显示 `✔ Connected`，重开 Claude Code 会话。

### 实测结果

| 工具 | 结果 | 备注 |
| --- | --- | --- |
| `baidu_list_dir` | ✅ | 根目录正常列出，含大小、修改时间、fs_id |
| `baidu_search_files` | ✅ | 递归搜索正常；百度搜索是分词/模糊匹配，结果可能混入不相关文件 |
| `baidu_upload_file` | ✅ | 上传小文件成功，`list_dir` 立即可见 |
| `baidu_download_file` | ✅ | 下载内容与上传逐字节一致 |
| `baidu_create_share_link` | 未测 | 会生成公开链接，且需要应用有分享权限 |
| `baidu_create_folder` | ✅ | 多层嵌套一次建好；重复创建报 `-8`（已存在） |
| `baidu_rename` | ✅ | 正常；源不存在报 `-9`；新名字含 `/` 会被拒绝 |
| `baidu_move` | ✅ | 正常；目标重名默认报错不覆盖；可带 `newName` 移动时改名 |
| `baidu_delete` | ✅ | 文件和整个文件夹都能删；`/`、`/xx/../` 这类根路径被拒绝 |

新增的 4 个工具是通过 MCP stdio 客户端端到端跑的（建目录 → 上传 → 改名 → 移动 → 冲突 → 删除 → 清理），20 项检查全部通过。

- **刚上传的文件立刻下载会报 `File not found`**：`list_dir` 已经能看到，但 `search_files` 还搜不到；等十几秒后下载和搜索都正常。推测下载时按路径查文件依赖百度的搜索索引，新文件入索引有延迟。上传后如需立即下载，建议稍等或重试。
- `access_token` 过期后 server 会自动用 `refresh_token` 续期并写回 `tokens.json`，实测无需重新授权。

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
| `baidu_create_folder` | 创建文件夹（自动补齐中间层级；同名已存在时报错） |
| `baidu_delete` | 删除一个或多个文件/文件夹（进网盘回收站；拒绝删除根目录 `/`） |
| `baidu_move` | 把文件/文件夹移到目标文件夹，可同时改名；重名时可选 `fail`（默认）/`newcopy`/`overwrite`/`skip` |
| `baidu_rename` | 原地重命名文件/文件夹 |

另外，`baidu_upload_file` 的目标路径里不存在的文件夹会被自动创建，所以「往某个新文件夹里放文件」直接上传即可。

## 已知限制 / 待验证

- 如遇 `errno` 报错，多半是该应用未获得对应接口权限，去开发者后台查看接口权限列表。
- 新上传文件短时间内无法通过下载/搜索找到（索引延迟，见「实测结果」）。
- 删除的文件进百度网盘回收站（保留期视会员等级而定），本 server 不提供回收站恢复/清空。
- 个人开发者应用通常有网盘容量/接口调用频率限制（历史上常见 20GB 总量限制），大文件上传前请确认额度。
- 上传分片大小固定 4MB，超大文件会顺序上传多个分片，暂无并发/断点续传。
- HTTP 模式（`src/httpServer.js`）用的是无状态（stateless）Streamable HTTP，每个请求起一个新的 McpServer 实例，实现简单但没有服务端主动推送/多会话能力；单用户个人使用够用，多人共用建议按用户拆 token 存储路径。
