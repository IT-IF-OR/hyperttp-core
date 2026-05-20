import { HyperCore } from "./src/index.js";

const core = new HyperCore({
  verbose: true,
});

core.get(`http://localhost:3000/json`);
