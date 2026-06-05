#!/usr/bin/env node
/**
 * deepseek-vision MCP Server
 *
 * 多模态视觉识别能力增强。通过 MiMo v2.5 API 提供图片识别，
 * 弥补当前模型无原生视觉能力的短板。
 *
 * 使用方式（重启 Claude Code 后自动注册为内置 tool）：
 *   - 传图片路径：analyze_image("docs/xxx.png")
 *   - 不传参：自动从剪贴板读取（Win+Shift+S 截图后直接识别）
 *   - 传网络 URL：analyze_image("https://...")
 */

const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");
const { execSync } = require("child_process");
const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require("@modelcontextprotocol/sdk/types.js");

// ============ 配置（全部通过环境变量设置）============
const API_KEY = process.env.DEEPVISION_API_KEY;
const BASE_URL = process.env.DEEPVISION_BASE_URL;
const MODEL = process.env.DEEPVISION_MODEL;
const MAX_TOKENS = parseInt(process.env.DEEPVISION_MAX_TOKENS || "4096", 10) || 4096;

const missing = [];
if (!API_KEY) missing.push("DEEPVISION_API_KEY");
if (!BASE_URL) missing.push("DEEPVISION_BASE_URL");
if (!MODEL) missing.push("DEEPVISION_MODEL");
if (missing.length) {
  console.error("错误: 缺少必需的环境变量: " + missing.join(", "));
  process.exit(1);
}

// ============ 图片源解析 ============

function resolveImageSource(input) {
  if (!input || input === "clipboard" || input === "latest") {
    return readClipboard();
  }
  if (input.startsWith("http://") || input.startsWith("https://")) {
    return input;
  }
  return readLocalFile(input);
}

function readClipboard() {
  const tmpFile = path.join(require("os").tmpdir(), "dv-clip-" + Date.now() + ".ps1");
  const psLines = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "Add-Type -AssemblyName System.Drawing",
    "$img = [System.Windows.Forms.Clipboard]::GetImage()",
    'if ($img -eq $null) { Write-Host "__NONE__"; exit 0 }',
    "$ms = New-Object System.IO.MemoryStream",
    "$img.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)",
    "$b64 = [System.Convert]::ToBase64String($ms.ToArray())",
    "$ms.Close()",
    "Write-Host $b64",
  ];

  fs.writeFileSync(tmpFile, psLines.join("\r\n"), "utf8");
  let out;
  try {
    out = execSync(
      'powershell -ExecutionPolicy Bypass -File "' + tmpFile + '"',
      { encoding: "utf8", timeout: 10000 }
    ).trim();
  } catch (e) {
    out = (e.stdout || "").trim() || (e.stderr || "").trim();
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }

  if (!out || out === "__NONE__") {
    throw new Error("剪贴板中没有图片。请先截图（Win+Shift+S）或复制图片。");
  }
  return "data:image/png;base64," + out;
}

function readLocalFile(filePath) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`文件不存在: ${resolved}`);
  }

  const ext = path.extname(resolved).toLowerCase().replace(".", "");
  const mime = { jpg: "jpeg", jpeg: "jpeg", png: "png", gif: "gif", webp: "webp", bmp: "bmp" };

  // 校验真实文件头，跳过 TSD 等非标准容器格式
  const fd = fs.openSync(resolved, "r");
  const magic = Buffer.alloc(8);
  fs.readSync(fd, magic, 0, 8, 0);
  fs.closeSync(fd);

  if (!isValidImage(magic)) {
    throw new Error(
      `不支持的文件格式（可能是钉钉/企业微信导出的 TSD 格式）。\n` +
      `请用截图工具重新截取保存为标准 PNG/JPEG。`
    );
  }

  const data = fs.readFileSync(resolved);
  return `data:image/${mime[ext] || "jpeg"};base64,${data.toString("base64")}`;
}

function isValidImage(magic) {
  return (
    (magic[0] === 0x89 && magic.slice(1, 4).toString() === "PNG") ||
    (magic[0] === 0xff && magic[1] === 0xd8) ||
    magic.slice(0, 6).toString() === "GIF89a" ||
    magic.slice(0, 6).toString() === "GIF87a" ||
    (magic[0] === 0x42 && magic[1] === 0x4d) ||
    magic.slice(0, 4).toString() === "RIFF"
  );
}

// ============ API 调用 ============

function callVisionAPI(imageUrl, prompt) {
  const body = JSON.stringify({
    model: MODEL,
    messages: [{
      role: "user",
      content: [
        { type: "image_url", image_url: { url: imageUrl } },
        { type: "text", text: prompt },
      ],
    }],
    stream: false,
    max_tokens: MAX_TOKENS,
  });

  const url = new URL(BASE_URL.replace(/\/+$/, "") + "/chat/completions");
  const transport = url.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    const req = transport.request(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    }, (res) => {
      let data = "";
      res.on("data", (c) => data += c);
      res.on("end", () => {
        if (res.statusCode >= 400) {
          return reject(new Error(`API ${res.statusCode}: ${data.slice(0, 300)}`));
        }
        try {
          resolve(JSON.parse(data)?.choices?.[0]?.message?.content || data);
        } catch {
          resolve(data);
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(120000, () => {
      req.destroy();
      reject(new Error("API 请求超时 (120s)"));
    });
    req.write(body);
    req.end();
  });
}

// ============ MCP Server ============

const server = new Server(
  { name: "deepseek-vision", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{
    name: "analyze_image",
    description: "识别图片内容。不传参数时自动从剪贴板读取；传路径则读本地文件；传 URL 则拉取网络图片。粘贴截图后直接说「识别」即可。",
    inputSchema: {
      type: "object",
      properties: {
        image_path: {
          type: "string",
          description: "图片路径、网络 URL，或不传/传 clipboard/latest 从剪贴板读取",
        },
        prompt: {
          type: "string",
          description: "可选，识别提示。不传默认要求详细描述图片内容",
        },
      },
    },
  }],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== "analyze_image") {
    throw new Error(`未知 tool: ${request.params.name}`);
  }

  const args = request.params.arguments || {};
  const imagePath = args.image_path;
  const prompt = args.prompt || "请详细描述这张图片的内容，包括所有文字、数据、表格、图表等细节";

  try {
    const imageUrl = resolveImageSource(imagePath);
    const result = await callVisionAPI(imageUrl, prompt);
    return { content: [{ type: "text", text: result }] };
  } catch (err) {
    return {
      isError: true,
      content: [{ type: "text", text: `识图失败: ${err.message}` }],
    };
  }
});

// ============ 启动 ============

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("deepseek-vision MCP Server 已启动");
}

main().catch((err) => {
  console.error("启动失败:", err);
  process.exit(1);
});
