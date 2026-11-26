const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

const UINT32_MAX = 0xffff_ffff;
const makeBase = () => Date.now().toString(36) + "-";

function makeBase36Current() {
  let counter = 0;
  let base = makeBase();

  return () => {
    counter = (counter + 1) >>> 0;

    if (counter === 0) {
      base = makeBase();
    }

    return base + counter.toString(36);
  };
}

function makeDecimal() {
  let counter = 0;
  let base = makeBase();

  return () => {
    counter = (counter + 1) >>> 0;

    if (counter === 0) {
      base = makeBase();
    }

    return base + counter;
  };
}

function makeBase36NoBitwise() {
  let counter = 0;
  let base = makeBase();

  return () => {
    if (counter === UINT32_MAX) {
      counter = 0;
      base = makeBase();
    } else {
      counter++;
    }

    return base + counter.toString(36);
  };
}

function makeBase36SafeInteger() {
  let counter = 0;
  let base = makeBase();

  return () => {
    if (counter === Number.MAX_SAFE_INTEGER) {
      counter = 0;
      base = makeBase();
    }

    counter++;

    return base + counter.toString(36);
  };
}

function makeBase64Url() {
  let counter = 0;
  let base = makeBase();

  return () => {
    counter = (counter + 1) >>> 0;

    if (counter === 0) {
      base = makeBase();
    }

    const n = counter;

    const suffix = String.fromCharCode(
      ALPHABET.charCodeAt(n >>> 26),
      ALPHABET.charCodeAt((n >>> 20) & 63),
      ALPHABET.charCodeAt((n >>> 14) & 63),
      ALPHABET.charCodeAt((n >>> 8) & 63),
      ALPHABET.charCodeAt((n >>> 2) & 63),
      ALPHABET.charCodeAt((n & 3) << 4),
    );

    return base + suffix;
  };
}

function makeBase64SingleString() {
  let counter = 0;

  let p0, p1, p2, p3, p4;
  let p5, p6, p7, p8, p9;

  function refreshPrefix() {
    const prefix = Date.now().toString(36).padStart(9, "0").slice(-9) + "-";

    p0 = prefix.charCodeAt(0);
    p1 = prefix.charCodeAt(1);
    p2 = prefix.charCodeAt(2);
    p3 = prefix.charCodeAt(3);
    p4 = prefix.charCodeAt(4);
    p5 = prefix.charCodeAt(5);
    p6 = prefix.charCodeAt(6);
    p7 = prefix.charCodeAt(7);
    p8 = prefix.charCodeAt(8);
    p9 = prefix.charCodeAt(9);
  }

  refreshPrefix();

  return () => {
    counter = (counter + 1) >>> 0;

    if (counter === 0) {
      refreshPrefix();
    }

    const n = counter;

    return String.fromCharCode(
      p0,
      p1,
      p2,
      p3,
      p4,
      p5,
      p6,
      p7,
      p8,
      p9,
      ALPHABET.charCodeAt(n >>> 26),
      ALPHABET.charCodeAt((n >>> 20) & 63),
      ALPHABET.charCodeAt((n >>> 14) & 63),
      ALPHABET.charCodeAt((n >>> 8) & 63),
      ALPHABET.charCodeAt((n >>> 2) & 63),
      ALPHABET.charCodeAt((n & 3) << 4),
    );
  };
}

const cases = [
  ["A: Base36 current", makeBase36Current()],
  ["B: Decimal", makeDecimal()],
  ["C: Base36 no bitwise", makeBase36NoBitwise()],
  ["D: Base36 safe integer", makeBase36SafeInteger()],
  ["E: Base64URL", makeBase64Url()],
  ["F: Single string", makeBase64SingleString()],
];

const BATCH = 4096;
const WARMUP_MS = 300;
const SAMPLE_MS = 500;
const ROUNDS = 5;

let sink = "";

function runBenchmark(next, durationMs) {
  let operations = 0;
  let currentTime;
  const start = performance.now();

  do {
    for (let i = 0; i < BATCH; i++) {
      sink = next();
    }

    operations += BATCH;
    currentTime = performance.now();
  } while (currentTime - start < durationMs);

  if (sink.length === 0) {
    throw new Error("Invalid benchmark result");
  }

  return (operations * 1000) / (currentTime - start);
}

for (const [, next] of cases) {
  runBenchmark(next, WARMUP_MS);
}

const results = cases.map(([name, next]) => ({
  name,
  samples: [],
}));

for (let round = 0; round < ROUNDS; round++) {
  for (let offset = 0; offset < cases.length; offset++) {
    const index = (offset + round) % cases.length;
    const [, next] = cases[index];

    results[index].samples.push(runBenchmark(next, SAMPLE_MS));
  }
}

for (const result of results) {
  result.samples.sort((a, b) => a - b);

  const median = result.samples[Math.floor(result.samples.length / 2)];

  result.ops = median;
}

results.sort((a, b) => b.ops - a.ops);

console.log(`Bun ${Bun.version}`);
console.log(`Rounds: ${ROUNDS}, sample: ${SAMPLE_MS}ms`);
console.log("");

for (const result of results) {
  console.log(`${result.name.padEnd(25)} ${Math.round(result.ops).toLocaleString()} IDs/sec`);
}
