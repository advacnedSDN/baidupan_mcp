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
