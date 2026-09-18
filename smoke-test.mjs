import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const toolDir = fileURLToPath(new URL(".", import.meta.url));
const childEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(([, value]) => typeof value === "string"),
);
delete childEnvironment.LOGITSTOKEN_IMAGE_API_KEY;
delete childEnvironment.LOGITSTOKEN_API_KEY;

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["server.mjs"],
  cwd: toolDir,
  env: childEnvironment,
});
const client = new Client({
  name: "logitstoken-image-smoke-test",
  version: "1.0.0",
});

try {
  await client.connect(transport);
  const listed = await client.listTools();
  const toolNames = listed.tools.map((tool) => tool.name).sort();
  const expected = ["edit_image", "generate_image"];

  if (JSON.stringify(toolNames) !== JSON.stringify(expected)) {
    throw new Error(`Unexpected tools: ${toolNames.join(", ")}`);
  }

  const missingKeyResult = await client.callTool({
    name: "generate_image",
    arguments: { prompt: "MCP smoke test; no network request should be sent." },
  });

  if (!missingKeyResult.isError) {
    throw new Error("Expected generate_image to reject a missing API key.");
  }

  console.log(`Smoke test passed. Registered tools: ${toolNames.join(", ")}`);
} finally {
  await client.close();
}
