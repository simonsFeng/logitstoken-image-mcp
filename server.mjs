import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const DEFAULT_BASE_URL = "https://logitstoken.com/v1";
const DEFAULT_OUTPUT_DIR = path.resolve(process.cwd(), "generated-images");
const REQUEST_TIMEOUT_MS = 180_000;

const baseUrl = (process.env.LOGITSTOKEN_IMAGE_BASE_URL || DEFAULT_BASE_URL).replace(
  /\/+$/,
  "",
);
const outputDir = path.resolve(
  process.env.LOGITSTOKEN_IMAGE_OUTPUT_DIR || DEFAULT_OUTPUT_DIR,
);

const modelSchema = z
  .enum(["gpt-image-2", "gemini-3-pro-image", "gemini-3.1-flash-image"])
  .default("gpt-image-2")
  .describe("Image model exposed by LogitsToken.");
const sizeSchema = z
  .enum(["1K", "1024x1024", "2K", "2048x2048", "4K", "4096x4096"])
  .default("1024x1024");
const qualitySchema = z.enum(["low", "medium", "high"]).default("medium");
const aspectRatioSchema = z
  .enum(["1:1", "4:3", "3:4", "16:9", "9:16"])
  .optional();
const filenamePrefixSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/)
  .default("image")
  .describe("Safe ASCII filename prefix without a path or extension.");

function getApiKey() {
  const apiKey =
    process.env.LOGITSTOKEN_IMAGE_API_KEY?.trim() ||
    process.env.LOGITSTOKEN_API_KEY?.trim();

  if (!apiKey) {
    throw new Error(
      "Missing LOGITSTOKEN_IMAGE_API_KEY. Create a LogitsToken key in an image-generation group, set the user environment variable, and restart Codex.",
    );
  }

  return apiKey;
}

async function requestImageApi(endpoint, options) {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      ...options.headers,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const responseText = await response.text();
  let body;

  try {
    body = JSON.parse(responseText);
  } catch {
    body = null;
  }

  if (!response.ok) {
    const detail =
      body?.error?.message || body?.message || responseText || response.statusText;
    throw new Error(
      `LogitsToken image request failed (${response.status}): ${String(detail).slice(0, 1500)}`,
    );
  }

  return body;
}

async function saveImages(body, filenamePrefix) {
  if (!Array.isArray(body?.data) || body.data.length === 0) {
    throw new Error("LogitsToken returned no image data.");
  }

  await mkdir(outputDir, { recursive: true });
  const savedPaths = [];
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

  for (const [index, item] of body.data.entries()) {
    if (typeof item?.b64_json !== "string" || item.b64_json.length === 0) {
      throw new Error(
        `Image ${index + 1} did not contain the expected data[].b64_json field.`,
      );
    }

    const imageBytes = Buffer.from(item.b64_json, "base64");
    if (imageBytes.length === 0) {
      throw new Error(`Image ${index + 1} contained an empty Base64 payload.`);
    }

    const filename = `${filenamePrefix}-${timestamp}-${randomUUID().slice(0, 8)}.png`;
    const outputPath = path.join(outputDir, filename);
    await writeFile(outputPath, imageBytes, { flag: "wx" });
    savedPaths.push(outputPath);
  }

  return savedPaths;
}

function toolResult(action, savedPaths) {
  return {
    content: [
      {
        type: "text",
        text: `${action} ${savedPaths.length} image(s).\n${savedPaths.join("\n")}`,
      },
    ],
  };
}

function mimeTypeForImage(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".png":
      return "image/png";
    default:
      throw new Error(
        `Unsupported reference image type for ${filePath}. Use PNG, JPEG, or WebP.`,
      );
  }
}

const server = new McpServer({
  name: "logitstoken-image",
  version: "1.0.1",
});

server.registerTool(
  "generate_image",
  {
    title: "Generate image with LogitsToken",
    description:
      "Generate one or more images through the fixed LogitsToken Images API and save them as local PNG files.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      prompt: z.string().min(1).max(32_000),
      model: modelSchema,
      size: sizeSchema,
      aspect_ratio: aspectRatioSchema,
      quality: qualitySchema,
      n: z.number().int().min(1).max(4).default(1),
      filename_prefix: filenamePrefixSchema,
    },
  },
  async ({ prompt, model, size, aspect_ratio, quality, n, filename_prefix }) => {
    const requestBody = {
      model,
      prompt,
      n,
      size,
      quality,
      response_format: "b64_json",
    };

    if (aspect_ratio) {
      requestBody.aspect_ratio = aspect_ratio;
    }

    const body = await requestImageApi("/images/generations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });
    const savedPaths = await saveImages(body, filename_prefix);
    return toolResult("Generated", savedPaths);
  },
);

server.registerTool(
  "edit_image",
  {
    title: "Edit image with LogitsToken",
    description:
      "Edit one or more local reference images through the fixed LogitsToken Images API and save the results as local PNG files.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      prompt: z.string().min(1).max(32_000),
      image_paths: z.array(z.string().min(1)).min(1).max(14),
      model: modelSchema,
      size: sizeSchema,
      aspect_ratio: aspectRatioSchema,
      quality: qualitySchema,
      filename_prefix: filenamePrefixSchema,
    },
  },
  async ({
    prompt,
    image_paths,
    model,
    size,
    aspect_ratio,
    quality,
    filename_prefix,
  }) => {
    const form = new FormData();
    form.set("model", model);
    form.set("prompt", prompt);
    form.set("size", size);
    form.set("quality", quality);
    form.set("response_format", "b64_json");

    if (aspect_ratio) {
      form.set("aspect_ratio", aspect_ratio);
    }

    const imageField = image_paths.length === 1 ? "image" : "image[]";
    for (const imagePath of image_paths) {
      const absolutePath = path.resolve(imagePath);
      const imageBytes = await readFile(absolutePath);
      form.append(
        imageField,
        new Blob([imageBytes], { type: mimeTypeForImage(absolutePath) }),
        path.basename(absolutePath),
      );
    }

    const body = await requestImageApi("/images/edits", {
      method: "POST",
      body: form,
    });
    const savedPaths = await saveImages(body, filename_prefix);
    return toolResult("Edited", savedPaths);
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`LogitsToken image MCP ready; output directory: ${outputDir}`);
