# LogitsToken Image MCP 安装与使用

这个 MCP 服务为 Codex 提供以下工具：

- `logitstoken_image.generate_image`：根据提示词生成图片。
- `logitstoken_image.edit_image`：使用本地参考图编辑图片。

服务默认连接 `https://logitstoken.com/v1`，支持 `gpt-image-2`、
`gemini-3-pro-image` 和 `gemini-3.1-flash-image`。

## 1. 环境要求

- Windows 10 或 Windows 11
- Node.js 20 或更高版本
- Codex 桌面端或支持 MCP 的 Codex CLI
- LogitsToken 生图分组 API Key

确认 Node.js 版本：

```powershell
node --version
```

## 2. 下载并安装依赖

克隆仓库，进入项目目录，然后安装锁定版本的依赖：

```powershell
git clone https://github.com/simonsFeng/logitstoken-image-mcp.git
Set-Location .\logitstoken-image-mcp
npm.cmd ci
```

Windows PowerShell 如果禁止执行 `npm.ps1`，请使用上面的 `npm.cmd`。

## 3. 设置 API Key

在 LogitsToken 中创建生图分组密钥，然后写入 Windows 用户环境变量：

```powershell
[Environment]::SetEnvironmentVariable(
  "LOGITSTOKEN_IMAGE_API_KEY",
  "YOUR_IMAGE_GROUP_API_KEY",
  "User"
)
```

不要把真实 API Key 写入本仓库、`config.toml`、截图或聊天消息。

## 4. 配置 Codex MCP

打开 `%USERPROFILE%\.codex\config.toml`，添加以下配置，并将 `cwd` 和
`LOGITSTOKEN_IMAGE_OUTPUT_DIR` 替换成当前电脑上的实际绝对路径：

```toml
[mcp_servers.logitstoken_image]
command = 'C:\Program Files\nodejs\node.exe'
args = ["server.mjs"]
cwd = 'D:\tools\logitstoken-image-mcp'
env_vars = ["LOGITSTOKEN_IMAGE_API_KEY"]
enabled = true
startup_timeout_sec = 20
tool_timeout_sec = 240
default_tools_approval_mode = "prompt"

[mcp_servers.logitstoken_image.env]
LOGITSTOKEN_IMAGE_BASE_URL = "https://logitstoken.com/v1"
LOGITSTOKEN_IMAGE_OUTPUT_DIR = 'D:\Codex\generated-images'
```

TOML 中的 Windows 路径建议使用单引号，避免反斜杠转义问题。

## 5. 重启并验证

完全退出 Codex，再重新打开。然后发送：

```text
使用 logitstoken_image 的 generate_image 工具，
通过 gpt-image-2 生成一张 1024x1024 的日出山间木屋图片。
```

生成的文件会保存到 `LOGITSTOKEN_IMAGE_OUTPUT_DIR` 指定的目录。

也可以先运行不访问网络的本地自检：

```powershell
npm.cmd test
```

## 6. 常用参数

- `model`：`gpt-image-2`、`gemini-3-pro-image`、`gemini-3.1-flash-image`
- `size`：`1K`、`1024x1024`、`2K`、`2048x2048`、`4K`、`4096x4096`
- `quality`：`low`、`medium`、`high`
- `aspect_ratio`：`1:1`、`4:3`、`3:4`、`16:9`、`9:16`
- `n`：生成数量，范围为 1 到 4

## 7. 故障排查

### 缺少 API Key

如果提示 `Missing LOGITSTOKEN_IMAGE_API_KEY`，检查用户环境变量是否存在，
并在设置变量后完全重启 Codex。

### 返回内容缺少 `data[].b64_json`

如果 LogitsToken 日志显示生成成功，但工具提示：

```text
Image 1 did not contain the expected data[].b64_json field.
```

说明上游已经完成生成，但实际响应没有遵循文档中的
`data[].b64_json` 格式。当前版本不会保存这种响应。排查时应只记录响应的
顶层字段名、`data[0]` 字段名和请求 ID，不能记录完整 Base64 或 API Key。

### 请求超时

单次请求超时时间为 180 秒，Codex MCP 工具超时时间建议设置为至少 240 秒。

## 8. 更新

拉取更新后重新安装锁定依赖并重启 Codex：

```powershell
git pull
npm.cmd ci
```
