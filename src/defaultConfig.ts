import { HttpClientOptions } from "./types/options.js";

export const defaultConfig: HttpClientOptions = {
  network: {
    timeout: 30000,
    maxConcurrent: 500,
    allowHttp2: true,
    pipelining: 10,
    keepAliveTimeout: 30000,
    followRedirects: true,
    maxRedirects: 5,
    rejectUnauthorized: true,
    userAgent: "Hyperttp/2.0",
  },
  retry: {
    maxRetries: 3,
    baseDelay: 100,
    maxDelay: 5000,
    jitter: true,
  },
  verbose: false,
};
