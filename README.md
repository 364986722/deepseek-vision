# deepseek-vision MCP Server

解决 Claude Code 使用 DeepSeek 等不具备多模态能力的模型时无法识别图片的问题。通过调用外部多模态视觉 API 实现图片分析能力。

## 功能

- **截图即识别**：截图后无需保存文件，直接粘贴到聊天框即可分析
- **本地图片**：传入文件路径分析本地图片
- **网络图片**：传入 URL 分析网络图片
- **自定义提问**：可针对图片提出具体问题

## 前置条件

- [Node.js](https://nodejs.org/) 18+
- [Claude Code](https://claude.ai/code)
- **Windows 系统**（剪贴板读取功能依赖 PowerShell）

> macOS / Linux 暂未适配，不传参的剪贴板读取不可用。可通过传入图片路径或 URL 使用。欢迎 PR。

## 安装

```bash
git clone https://github.com/364986722/deepseek-vision.git
cd deepseek-vision
npm install
```

## 配置

### 1. 获取 API

联系服务商获取兼容 OpenAI 格式的多模态视觉 API 的地址、模型名称和密钥。

### 2. 注册到 Claude Code

在项目根目录创建（或编辑） `.mcp.json`：

```json
{
  "mcpServers": {
    "deepseek-vision": {
      "command": "cmd",
      "args": [
        "/c", "node",
        "D:\\path\\to\\deepseek-vision\\index.js"
      ],
      "env": {
        "DEEPVISION_API_KEY": "your-api-key",
        "DEEPVISION_BASE_URL": "https://your-api-endpoint.com/v1",
        "DEEPVISION_MODEL": "mimo-v2.5",
        "DEEPVISION_MAX_TOKENS": "4096"
      }
    }
  }
}
```

> Windows 上 `command` 必须用 `cmd`，首个参数为 `/c`。

### 3. 环境变量说明

| 变量 | 必需 | 说明 |
|------|------|------|
| `DEEPVISION_API_KEY` | ✅ | API 密钥 |
| `DEEPVISION_BASE_URL` | ✅ | API 地址（需包含 `/v1`） |
| `DEEPVISION_MODEL` | ✅ | 模型名称 |
| `DEEPVISION_MAX_TOKENS` | ❌ | 最大输出 token 数，默认 `4096` |

### 4. 重启 Claude Code

完成后重启 Claude Code，在聊天中输入 `/mcp` 确认 `deepseek-vision` 已加载。

## 使用方法

重启后 `analyze_image` 会自动注册为 Claude Code 的内置工具。

### 粘贴截图识别

```
截图（Win+Shift+S）→ 粘贴到聊天框 → 说"识别"
```

Claude Code 会自动调用 `analyze_image` 读取剪贴板中的图片并识别。

### 本地图片

```
analyze_image("screenshot.png")
```

### 网络图片

```
analyze_image("https://example.com/image.png")
```

## 工作原理

```
截图 → 粘贴到聊天框 → Claude Code 调用 analyze_image
                                      ↓
                          MCP Server 读取 Windows 剪贴板
                                      ↓
                          调用视觉 API 分析图片
                                      ↓
                                  返回结果
```

## 许可

MIT
