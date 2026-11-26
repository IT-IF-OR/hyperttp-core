import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [withClockArg, withoutClockArg] = process.argv.slice(2);
const WITH_CLOCK_PATH = resolve(
  withClockArg ?? "/home/dirold2/dev/git/Hyperttp/hyperttp-core/dist/index.js",
);
const WITHOUT_CLOCK_PATH = resolve(withoutClockArg ?? "/tmp/opencode/dist-clock0/index.js");

const WARMUP_MS = readPositiveInt("AB_WARMUP_MS", 500);
const MEASURE_MS = readPositiveInt("AB_MEASURE_MS", 350);
const ROUNDS = readPositiveInt("AB_ROUNDS", 7);
const CHUNK_SIZE = 128;

const PROTOCOL = "bench";
const EMPTY_HEADERS = Object.freeze({});
const INPUT = Object.freeze({ value: 42 });
const REQUEST = Object.freeze({ protocol: PROTOCOL, input: INPUT });
const PREPARED_REQUEST = Object.freeze({
  method: "GET",
  url: "/bench",
  headers: EMPTY_HEADERS,
  body: INPUT,
  protocol: PROTOCOL,
});

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

function readPositiveInt(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function createTransport() {
  return {
    execute() {
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

async function loadCore(path) {
  const module = await import(pathToFileURL(path).href);
  if (typeof module.HyperCore !== "function") {
    throw new TypeError(`No HyperCore export found in ${path}`);
  }
  return module.HyperCore;
}

function createCoreCase(label, HyperCore) {
  const transport = createTransport();
  const core = new HyperCore({}, transport);
  core.registerSender(sender);

  return {
    label,
    run: () => core.send(REQUEST),
    dispose: () => core.destroy(),
  };
}

const directTransport = createTransport();

async function directPipeline() {
  const prepared = sender.prepare(REQUEST);
  const raw = await sender.send(prepared, directTransport);
  return sender.parse(raw);
}

async function warmup(testCase, durationMs) {
  const deadline = performance.now() + durationMs;

  while (performance.now() < deadline) {
    for (let i = 0; i < CHUNK_SIZE; i++) {
      await testCase.run();
    }
  }
}

async function measure(testCase, durationMs) {
  let operations = 0;
  const start = performance.now();
  const deadline = start + durationMs;

  do {
    for (let i = 0; i < CHUNK_SIZE; i++) {
      await testCase.run();
      operations++;
    }
  } while (performance.now() < deadline);

  const elapsedMs = performance.now() - start;

  return {
    operations,
    elapsedMs,
    opsPerSecond: (operations * 1000) / elapsedMs,
    nsPerOperation: (elapsedMs * 1_000_000) / operations,
  };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function format(value, digits = 2) {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

async function main() {
  const HyperCoreWithClock = await loadCore(WITH_CLOCK_PATH);
  const HyperCoreWithoutClock = await loadCore(WITHOUT_CLOCK_PATH);

  const cases = [
    {
      label: "direct",
      run: directPipeline,
      dispose: async () => {},
    },
    createCoreCase("with-clock", HyperCoreWithClock),
    createCoreCase("clock-zero", HyperCoreWithoutClock),
  ];

  // Rotate ordering across rounds to reduce systematic warm-cache / thermal bias.
  const orders = [
    [0, 1, 2],
    [2, 1, 0],
    [1, 0, 2],
    [2, 0, 1],
    [0, 2, 1],
    [1, 2, 0],
  ];

  const samples = new Map(cases.map((testCase) => [testCase.label, []]));

  console.log("HyperCore clock A/B microbenchmark");
  console.log(
    `Runtime: ${typeof Bun !== "undefined" ? `Bun ${Bun.version}` : `Node ${process.version}`} (${process.platform}/${process.arch})`,
  );
  console.log(`With clock:    ${WITH_CLOCK_PATH}`);
  console.log(`Clock zero:    ${WITHOUT_CLOCK_PATH}`);
  console.log(
    `Warmup: ${WARMUP_MS} ms | Measure: ${MEASURE_MS} ms | Rounds: ${ROUNDS} | Chunk: ${CHUNK_SIZE}`,
  );
  console.log("Synthetic sender/transport; no sockets, I/O, timers, JSON, or real payload work.");

  try {
    // Warm every implementation equally, also alternating order.
    for (let i = 0; i < cases.length; i++) {
      for (const index of orders[i % orders.length]) {
        await warmup(cases[index], WARMUP_MS);
      }
    }

    for (let round = 0; round < ROUNDS; round++) {
      const order = orders[round % orders.length];
      const roundResults = new Map();

      for (const index of order) {
        const result = await measure(cases[index], MEASURE_MS);
        samples.get(cases[index].label).push(result);
        roundResults.set(cases[index].label, result);
      }

      const directNs = roundResults.get("direct").nsPerOperation;
      const withNs = roundResults.get("with-clock").nsPerOperation;
      const zeroNs = roundResults.get("clock-zero").nsPerOperation;

      console.log(
        `Round ${round + 1}: direct ${format(directNs)} ns | with clock ${format(withNs)} ns ` +
          `(overhead ${format(withNs - directNs)} ns) | clock zero ${format(zeroNs)} ns ` +
          `(overhead ${format(zeroNs - directNs)} ns) | saved ${format(withNs - zeroNs)} ns`,
      );
    }

    const summaries = cases.map((testCase) => {
      const values = samples.get(testCase.label);

      return {
        scenario: testCase.label,
        opsPerSecond: median(values.map((value) => value.opsPerSecond)),
        nsPerOperation: median(values.map((value) => value.nsPerOperation)),
      };
    });

    console.log("\nMedian across rounds");

    console.table(
      summaries.map((summary) => ({
        Scenario: summary.scenario,
        "ops/sec": Math.round(summary.opsPerSecond).toLocaleString("en-US"),
        "ns/op": format(summary.nsPerOperation),
      })),
    );

    const directNs = summaries.find((item) => item.scenario === "direct").nsPerOperation;

    const withClock = summaries.find((item) => item.scenario === "with-clock");

    const clockZero = summaries.find((item) => item.scenario === "clock-zero");

    const originalOverhead = withClock.nsPerOperation - directNs;
    const zeroOverhead = clockZero.nsPerOperation - directNs;
    const savedNs = withClock.nsPerOperation - clockZero.nsPerOperation;

    console.log("\nA/B summary");
    console.log(`Original core overhead: ${format(originalOverhead)} ns/op`);
    console.log(`Clock-zero core overhead: ${format(zeroOverhead)} ns/op`);
    console.log(`End-to-end difference: ${format(savedNs)} ns/op`);

    console.log(
      `Throughput change (clock-zero vs original): ${format(
        (clockZero.opsPerSecond / withClock.opsPerSecond - 1) * 100,
      )}%`,
    );

    console.log(
      `Overhead reduction: ${format(
        originalOverhead > 0 ? (1 - zeroOverhead / originalOverhead) * 100 : 0,
      )}%`,
    );
  } finally {
    await Promise.allSettled(cases.map((testCase) => testCase.dispose()));
  }
}

main().catch((error) => {
  console.error("A/B benchmark failed:", error);
  process.exitCode = 1;
});
