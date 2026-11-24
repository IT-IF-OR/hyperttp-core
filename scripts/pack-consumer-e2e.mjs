import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFile = promisify(execFileCallback);
const coreDirectory = fileURLToPath(new URL("..", import.meta.url));
const workspaceDirectory = dirname(coreDirectory);
const packages = {
  core: coreDirectory,
  client: join(workspaceDirectory, "hyperttp"),
  node: join(workspaceDirectory, "hyperttp-transport-node"),
};

async function pack(directory, destination) {
  const { stdout } = await execFile("npm", ["pack", "--json", "--pack-destination", destination], {
    cwd: directory,
  });
  const packed = JSON.parse(stdout);
  const result = Array.isArray(packed)
    ? packed[0]
    : packed.filename
      ? packed
      : Object.values(packed)[0];
  if (!result?.filename) throw new Error(`Could not pack ${directory}.`);
  return join(destination, result.filename);
}

async function freePort() {
  const { createServer } = await import("node:net");
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  if (!address || typeof address === "string") throw new Error("Could not allocate a TCP port.");
  return address.port;
}

const temporaryDirectory = await mkdtemp(join(tmpdir(), "hyperttp-core-consumer-"));
try {
  for (const directory of Object.values(packages)) {
    await access(join(directory, "dist"));
  }

  const tarballsDirectory = join(temporaryDirectory, "tarballs");
  const consumerDirectory = join(temporaryDirectory, "consumer");
  await Promise.all([mkdir(tarballsDirectory), mkdir(consumerDirectory)]);
  const [coreTarball, clientTarball, nodeTarball] = await Promise.all([
    pack(packages.core, tarballsDirectory),
    pack(packages.client, tarballsDirectory),
    pack(packages.node, tarballsDirectory),
  ]);
  const coreDependency = `file:${coreTarball}`;

  await writeFile(
    join(consumerDirectory, "package.json"),
    `${JSON.stringify(
      {
        name: "hyperttp-isolated-consumer",
        private: true,
        type: "module",
        dependencies: {
          "@hyperttp/core": coreDependency,
          "@hyperttp/transport-node": `file:${nodeTarball}`,
          hyperttp: `file:${clientTarball}`,
        },
        pnpm: { overrides: { "@hyperttp/core": coreDependency } },
      },
      null,
      2,
    )}\n`,
  );

  await execFile("pnpm", ["install", "--node-linker=isolated", "--ignore-scripts"], {
    cwd: consumerDirectory,
  });

  const port = await freePort();
  await writeFile(
    join(consumerDirectory, "consumer.mjs"),
    `import assert from "node:assert/strict";
import { HyperClient } from "hyperttp";

const client = new HyperClient({ builtInPlugins: false });
const server = client.server({ host: "127.0.0.1", port: ${port} });
server.rest.get("/health", () => ({ body: "ok" }));
try {
  await server.start();
  const response = await fetch("http://127.0.0.1:${port}/health");
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "ok");
} finally {
  await server.close();
  await client.destroy();
}
`,
  );
  await execFile(process.execPath, ["consumer.mjs"], { cwd: consumerDirectory });
  console.log("Packed isolated-pnpm consumer: HyperClient server request OK");
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
