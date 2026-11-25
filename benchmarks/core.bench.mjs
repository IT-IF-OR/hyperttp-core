import { performance } from "node:perf_hooks";
import { HyperCore } from "../dist/index.js";

const PROTOCOL = "bench";
const EMPTY_HEADERS = Object.freeze({});
const INPUT = Object.freeze({ value: 42 });
const REQUEST = Object.freeze({ protocol: PROTOCOL, input: INPUT });

const RAW_RESPONSE = Object.freeze({
  status: 200,
  statusText: "OK",
  headers: EMPTY_HEADERS,
  url: "/bench",
  body: null,
});

const UNIVERSAL_RESPONSE = Object.freeze({
  protocol: PROTOCOL,
  ok: true,
  status: 200,
  statusText: "OK",
  headers: EMPTY_HEADERS,
  url: "/bench",
  data: INPUT,
  raw: RAW_RESPONSE,
});

const SERVER_RESPONSE = Object.freeze({
  status: 200,
  statusText: "OK",
  headers: EMPTY_HEADERS,
  url: "/bench",
  body: null,
});

const SERVER_REQUEST = Object.freeze({
  method: "GET",
  url: "/bench",
  headers: EMPTY_HEADERS,
  body: INPUT,
  protocol: PROTOCOL,
});

const PREPARED_REQUEST = Object.freeze({
  method: "GET",
  url: "/bench",
  headers: EMPTY_HEADERS,
  body: INPUT,
  protocol: PROTOCOL,
});

const WARMUP_MS = readPositiveInt("BENCH_WARMUP_MS", 300);
const DURATION_MS = readPositiveInt("BENCH_DURATION_MS", 1000);
const CONCURRENCY_DURATION_MS = readPositiveInt("BENCH_CONCURRENCY_MS", 700);
const LATENCY_SAMPLES = readPositiveInt("BENCH_LATENCY_SAMPLES", 250);
const CONCURRENCY_LEVELS = [1, 8, 32, 64];
const CHUNK_SIZE = 128;

function readPositiveInt(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function now() {
  return performance.now();
}

function createTransport() {
  return {
    execute() {
      // A resolved Promise preserves the async transport contract without I/O,
      // serialization, timers, sockets, or response allocations.
      return Promise.resolve(RAW_RESPONSE);
    },
    close() {},
  };
}

const sender = {
  protocol: PROTOCOL,
  prepare() {
    return PREPARED_REQUEST;
  },
  send(prepared, transport) {
    return transport.execute(prepared);
  },
  parse() {
    return UNIVERSAL_RESPONSE;
  },
};

function createClientPlugin(name, hooks = {}) {
  const plugin = { name };
  if (hooks.request) plugin.onRequest = () => undefined;
  if (hooks.response) plugin.onResponse = () => undefined;
  return plugin;
}

function createServerPlugin(name, hooks = {}) {
  const plugin = { name };
  if (hooks.request) plugin.onServerRequest = () => undefined;
  if (hooks.response) plugin.onServerResponse = () => undefined;
  if (hooks.settled) plugin.onServerSettled = () => undefined;
  return plugin;
}

async function createClientCase(label, plugins = []) {
  const transport = createTransport();
  const core = new HyperCore({ plugins }, transport);
  core.registerSender(sender);

  return {
    label,
    run: () => core.send(REQUEST),
    dispose: () => core.destroy(),
  };
}

function createServerTransport() {
  let onRequest;

  return {
    execute() {
      return Promise.resolve(RAW_RESPONSE);
    },
    async listen(options) {
      onRequest = options.onRequest;
      return {
        close() {
          onRequest = undefined;
        },
      };
    },
    dispatch(request) {
      if (typeof onRequest !== "function") {
        throw new Error("Benchmark server has not started or has already closed.");
      }
      return onRequest(request);
    },
    close() {
      onRequest = undefined;
    },
  };
}

const receiver = {
  protocol: PROTOCOL,
  receive(request) {
    return request.body;
  },
  handle(request) {
    return request;
  },
  respond() {
    return SERVER_RESPONSE;
  },
};

async function createServerCase(label, plugins = []) {
  const transport = createServerTransport();
  const core = new HyperCore({ plugins }, transport);
  core.registerReceiver(receiver);
  await core.listen({ protocol: PROTOCOL, host: "127.0.0.1", port: 0 });

  return {
    label,
    run: () => transport.dispatch(SERVER_REQUEST),
    dispose: () => core.destroy(),
  };
}

async function warmup(fn, durationMs) {
  const deadline = now() + durationMs;
  while (now() < deadline) {
    for (let i = 0; i < CHUNK_SIZE; i++) await fn();
  }
}

async function measureThroughput(fn, warmupMs, durationMs) {
  await warmup(fn, warmupMs);

  let count = 0;
  const start = now();
  const deadline = start + durationMs;
  do {
    for (let i = 0; i < CHUNK_SIZE; i++) {
      await fn();
      count++;
    }
  } while (now() < deadline);

  const elapsedMs = now() - start;
  return {
    operations: count,
    elapsedMs,
    opsPerSecond: (count * 1000) / elapsedMs,
  };
}

function percentile(sorted, fraction) {
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1);
  return sorted[index] ?? 0;
}

async function measureLatency(fn, samples) {
  const values = new Array(samples);
  for (let i = 0; i < samples; i++) {
    const start = now();
    await fn();
    values[i] = (now() - start) * 1000;
  }
  values.sort((a, b) => a - b);

  return {
    p50Us: percentile(values, 0.5),
    p95Us: percentile(values, 0.95),
    p99Us: percentile(values, 0.99),
  };
}

async function measureConcurrent(fn, concurrency, durationMs) {
  let operations = 0;
  const start = now();
  const deadline = start + durationMs;

  async function worker() {
    let localCount = 0;
    while (now() < deadline) {
      await fn();
      localCount++;
    }
    return localCount;
  }

  const counts = await Promise.all(Array.from({ length: concurrency }, worker));
  operations = counts.reduce((sum, count) => sum + count, 0);
  const elapsedMs = now() - start;

  return {
    operations,
    elapsedMs,
    opsPerSecond: (operations * 1000) / elapsedMs,
  };
}

function formatNumber(value, fractionDigits = 0) {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

function printTable(title, rows, columns) {
  console.log(`\n${title}`);
  console.table(
    rows.map((row) => {
      const formatted = {};
      for (const column of columns) {
        const value = row[column.key];
        formatted[column.label] =
          typeof value === "number" ? formatNumber(value, column.digits ?? 0) : value;
      }
      return formatted;
    }),
  );
}

async function runSerialSuite(cases, title) {
  const rows = [];
  for (const testCase of cases) {
    const throughput = await measureThroughput(testCase.run, WARMUP_MS, DURATION_MS);
    const latency = await measureLatency(testCase.run, LATENCY_SAMPLES);
    rows.push({
      scenario: testCase.label,
      opsPerSecond: throughput.opsPerSecond,
      p50Us: latency.p50Us,
      p95Us: latency.p95Us,
      p99Us: latency.p99Us,
    });
  }

  printTable(title, rows, [
    { key: "scenario", label: "Scenario" },
    { key: "opsPerSecond", label: "ops/sec" },
    { key: "p50Us", label: "p50 µs", digits: 2 },
    { key: "p95Us", label: "p95 µs", digits: 2 },
    { key: "p99Us", label: "p99 µs", digits: 2 },
  ]);
}

async function runConcurrencySuite(cases) {
  const rows = [];
  for (const testCase of cases) {
    await warmup(testCase.run, WARMUP_MS);
    for (const concurrency of CONCURRENCY_LEVELS) {
      const result = await measureConcurrent(
        testCase.run,
        concurrency,
        CONCURRENCY_DURATION_MS,
      );
      rows.push({
        scenario: testCase.label,
        concurrency,
        opsPerSecond: result.opsPerSecond,
      });
    }
  }

  printTable("Client concurrency", rows, [
    { key: "scenario", label: "Scenario" },
    { key: "concurrency", label: "Concurrency" },
    { key: "opsPerSecond", label: "ops/sec" },
  ]);
}

async function main() {
  const runtime =
    typeof Bun !== "undefined"
      ? `Bun ${Bun.version}`
      : `Node ${process.version}`;

  console.log("HyperCore microbenchmark");
  console.log(`Runtime: ${runtime} (${process.platform}/${process.arch})`);
  console.log(
    `Warmup: ${WARMUP_MS} ms | Measure: ${DURATION_MS} ms | Latency samples: ${LATENCY_SAMPLES}`,
  );
  console.log(
    "Synthetic transport: no sockets, network, timers, JSON, compression, or real payload work.",
  );

  const rawTransport = createTransport();
  const directPipelineTransport = createTransport();
  const directPipeline = async () => {
    const prepared = sender.prepare(REQUEST);
    const raw = await sender.send(prepared, directPipelineTransport);
    return sender.parse(raw);
  };

  const clientCases = [
    {
      label: "transport.execute()",
      run: () => rawTransport.execute(PREPARED_REQUEST),
      dispose: async () => {},
    },
    {
      label: "sender prepare/send/parse (no core)",
      run: directPipeline,
      dispose: async () => {},
    },
    await createClientCase("HyperCore / no plugins"),
    await createClientCase("HyperCore / 1 empty plugin", [createClientPlugin("empty-1")]),
    await createClientCase("HyperCore / 1 onRequest", [
      createClientPlugin("request-1", { request: true }),
    ]),
    await createClientCase("HyperCore / 1 onResponse", [
      createClientPlugin("response-1", { response: true }),
    ]),
    await createClientCase("HyperCore / request + response", [
      createClientPlugin("both-1", { request: true, response: true }),
    ]),
    await createClientCase(
      "HyperCore / 4 request + response plugins",
      Array.from({ length: 4 }, (_, i) =>
        createClientPlugin(`both-${i + 1}`, { request: true, response: true }),
      ),
    ),
  ];

  const serverCases = [
    await createServerCase("Server / no plugins"),
    await createServerCase("Server / 1 empty plugin", [createServerPlugin("server-empty")]),
    await createServerCase("Server / request + response + settled", [
      createServerPlugin("server-hooks", {
        request: true,
        response: true,
        settled: true,
      }),
    ]),
  ];

  try {
    await runSerialSuite(clientCases, "Client serial throughput and latency");
    await runConcurrencySuite([
      clientCases[0],
      clientCases[1],
      clientCases[2],
      clientCases[5],
    ]);
    await runSerialSuite(serverCases, "Server pipeline throughput and latency");
  } finally {
    await Promise.allSettled([
      ...clientCases.map((testCase) => testCase.dispose()),
      ...serverCases.map((testCase) => testCase.dispose()),
    ]);
  }
}

main().catch((error) => {
  console.error("Benchmark failed:", error);
  process.exitCode = 1;
});
