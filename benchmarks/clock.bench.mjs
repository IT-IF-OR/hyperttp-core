const WARMUP_MS = 200;
const SAMPLE_MS = 400;
const ROUNDS = 5;
const BATCH = 4096;

const perf = globalThis.performance;
const cachedPerformanceNow = perf.now.bind(perf);

const cachedDateNow = Date.now;

const cachedHrtimeBigint = process.hrtime.bigint.bind(process.hrtime);

const cases = [
  {
    name: "performance.now()",
    read: () => performance.now(),
    type: "number: milliseconds",
  },
  {
    name: "cached performance.now.bind()",
    read: cachedPerformanceNow,
    type: "number: milliseconds",
  },
  {
    name: "Date.now()",
    read: () => Date.now(),
    type: "number: milliseconds",
  },
  {
    name: "cached Date.now",
    read: cachedDateNow,
    type: "number: milliseconds",
  },
  {
    name: "process.hrtime.bigint()",
    read: () => process.hrtime.bigint(),
    type: "bigint: nanoseconds",
  },
  {
    name: "hrtime.bigint() -> Number ms",
    read: () => Number(process.hrtime.bigint()) / 1e6,
    type: "number: milliseconds",
  },
  {
    name: "cached hrtime -> Number ms",
    read: () => Number(cachedHrtimeBigint()) / 1e6,
    type: "number: milliseconds",
  },
  {
    name: "noop (function overhead)",
    read: () => 0,
    type: "number",
  },
];

let sink;

function createRunner(read) {
  return function run(durationMs) {
    let operations = 0;
    let last;

    const startedAt = performance.now();
    let elapsed = 0;

    do {
      for (let i = 0; i < BATCH; i++) {
        last = read();
      }

      operations += BATCH;
      elapsed = performance.now() - startedAt;
    } while (elapsed < durationMs);

    sink = last;

    return (operations * 1000) / elapsed;
  };
}

const runners = cases.map((item) => ({
  ...item,
  run: createRunner(item.read),
  samples: [],
}));

for (const item of runners) {
  item.run(WARMUP_MS);
}

for (let round = 0; round < ROUNDS; round++) {
  for (let offset = 0; offset < runners.length; offset++) {
    const index = (offset + round) % runners.length;
    const item = runners[index];

    item.samples.push(item.run(SAMPLE_MS));
  }
}

for (const item of runners) {
  item.samples.sort((a, b) => a - b);

  item.median = item.samples[Math.floor(item.samples.length / 2)];

  item.min = item.samples[0];
  item.max = item.samples[item.samples.length - 1];
}

const noop = runners.find((item) => item.name.startsWith("noop"));
const baseline = noop.median;

const results = runners.filter((item) => item !== noop).sort((a, b) => b.median - a.median);

const format = (value) => Math.round(value).toLocaleString("en-US");

console.log(`Bun ${Bun.version}`);
console.log(`Rounds: ${ROUNDS}`);
console.log(`Warmup: ${WARMUP_MS} ms`);
console.log(`Sample: ${SAMPLE_MS} ms`);
console.log("");

console.log(
  "Method".padEnd(38) +
    "ops/sec".padStart(15) +
    "ns/op".padStart(12) +
    "min/max spread".padStart(19),
);

console.log("-".repeat(84));

for (const item of results) {
  const nsPerOperation = 1e9 / item.median;
  const spread = ((item.max - item.min) / item.median) * 100;

  console.log(
    item.name.padEnd(38) +
      format(item.median).padStart(15) +
      nsPerOperation.toFixed(2).padStart(12) +
      `${spread.toFixed(1)}%`.padStart(19),
  );
}

console.log("");
console.log(`Noop function: ${format(baseline)} calls/sec`);
console.log(`Final sink type: ${typeof sink}`);
