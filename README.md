# LogitsToken Image MCP

一个用于 Codex 的本地 MCP 服务，连接 LogitsToken 生图接口：

- `POST https://logitstoken.com/v1/images/generations`
- `POST https://logitstoken.com/v1/images/edits`

它提供 `generate_image` 和 `edit_image` 两个工具，并将生成结果保存为本地
PNG 文件。

完整的 Windows 安装、Codex 配置、验证和故障排查步骤请查看
[INSTALL.zh-CN.md](./INSTALL.zh-CN.md)。

## 安全说明

- 每位使用者应配置自己的 `LOGITSTOKEN_IMAGE_API_KEY`。
- 不要把 API Key 写入代码、Codex 配置、提交记录或聊天消息。
- 不要提交 `node_modules`、生成图片或本地 `.env` 文件。

## 本地自检

```powershell
npm.cmd ci
npm.cmd test
```
