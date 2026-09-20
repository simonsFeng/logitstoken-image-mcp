import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const toolDir = fileURLToPath(new URL(".", import.meta.url));
const pngBytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

function cleanEnvironment(overrides = {}) {
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([, value]) => typeof value === "string"),
  );
  delete environment.LOGITSTOKEN_IMAGE_API_KEY;
  delete environment.LOGITSTOKEN_API_KEY;
  return { ...environment, ...overrides };
}

async function connectClient(environment) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["server.mjs"],
    cwd: toolDir,
    env: environment,
  });
  const client = new Client({
    name: "logitstoken-image-smoke-test",
    version: "1.0.0",
  });
  await client.connect(transport);
  return client;
}

const missingKeyClient = await connectClient(cleanEnvironment());
try {
  const listed = await missingKeyClient.listTools();
  const toolNames = listed.tools.map((tool) => tool.name).sort();
  const expected = ["edit_image", "generate_image"];

  assert.deepEqual(toolNames, expected);

  const missingKeyResult = await missingKeyClient.callTool({
    name: "generate_image",
    arguments: { prompt: "MCP smoke test; no network request should be sent." },
  });
  assert.equal(missingKeyResult.isError, true);
} finally {
  await missingKeyClient.close();
}

const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "logitstoken-image-mcp-"));
const inputPath = path.join(temporaryDirectory, "input.png");
const outputDirectory = path.join(temporaryDirectory, "output");
await writeFile(inputPath, pngBytes);

let resolveRequest;
let rejectRequest;
const requestChecked = new Promise((resolve, reject) => {
  resolveRequest = resolve;
  rejectRequest = reject;
});
const mockApi = createServer((request, response) => {
  const chunks = [];
  request.on("data", (chunk) => chunks.push(chunk));
  request.on("end", () => {
    try {
      assert.equal(request.method, "POST");
      assert.equal(request.url, "/v1/images/edits");
      assert.equal(request.headers.authorization, "Bearer smoke-test-key");
      assert.match(request.headers["content-type"] || "", /^multipart\/form-data; boundary=/);

      const requestBody = Buffer.concat(chunks).toString("latin1");
      assert.match(
        requestBody,
        /name="response_format"\r\n\r\nb64_json\r\n/,
      );
      assert.match(requestBody, /name="image"; filename="input.png"/);
      resolveRequest();

      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ data: [{ b64_json: pngBytes.toString("base64") }] }));
    } catch (error) {
      rejectRequest(error);
      response.writeHead(500, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: { message: error.message } }));
    }
  });
});

await new Promise((resolve, reject) => {
  mockApi.once("error", reject);
  mockApi.listen(0, "127.0.0.1", resolve);
});

const address = mockApi.address();
assert(address && typeof address === "object");
const editClient = await connectClient(
  cleanEnvironment({
    LOGITSTOKEN_IMAGE_API_KEY: "smoke-test-key",
    LOGITSTOKEN_IMAGE_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
    LOGITSTOKEN_IMAGE_OUTPUT_DIR: outputDirectory,
  }),
);

try {
  const editResult = await editClient.callTool({
    name: "edit_image",
    arguments: {
      prompt: "Turn this into a watercolor illustration.",
      image_paths: [inputPath],
      model: "gpt-image-2",
      size: "1K",
      quality: "medium",
      filename_prefix: "edited",
    },
  });
  await requestChecked;
  assert.notEqual(editResult.isError, true);

  const outputFiles = await readdir(outputDirectory);
  assert.equal(outputFiles.length, 1);
  assert.match(outputFiles[0], /^edited-.*\.png$/);
  assert.deepEqual(await readFile(path.join(outputDirectory, outputFiles[0])), pngBytes);
} finally {
  await editClient.close();
  await new Promise((resolve, reject) => {
    mockApi.close((error) => (error ? reject(error) : resolve()));
  });
  await rm(temporaryDirectory, { recursive: true, force: true });
}

console.log("Smoke test passed. Tool registration, API-key guard, and image editing verified.");
