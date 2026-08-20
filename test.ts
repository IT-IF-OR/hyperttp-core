import { HyperCore } from "./src/index.js";

const core = new HyperCore({});

const res = await core.rest.get(`https://httpbin.org/get`);

console.log("sender:", await core.getSenderName());
console.log("transport:", await core.getTransportName());
console.log("protocol:", await core.getProtocolName());

console.log("--- REST API GET ---");
console.log("status:", res.status);
console.log("ok:", res.ok);
console.log("data:", res.data);
