import type { HttpClientOptions } from "@hyperttp/types";

export const defaultConfig: HttpClientOptions = {
  network: {
    timeout: 30000,
    maxConcurrent: 128,
    pipelining: 0,
    keepAliveTimeout: 5000,
    followRedirects: true,
    maxRedirects: 5,
    rejectUnauthorized: true,
  },
  retry: {
    maxRetries: 0,
    baseDelay: 100,
    maxDelay: 5000,
    jitter: true,
  },
  verbose: false,
};
