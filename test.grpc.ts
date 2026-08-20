import { HyperCore } from "./src/index.js";
import { GrpcTestTransport, GrpcSender } from "/home/dirold2/dev/git/hyperttp-sender-grpc/dist/index.js";

const handler = (service: string, method: string, payload: Uint8Array) => {
  const msg = JSON.parse(new TextDecoder().decode(payload));
  if (method === "GetUser") {
    return { body: new TextEncoder().encode(JSON.stringify({ id: 1, name: msg.name })) };
  }
  return { body: new Uint8Array(), grpcStatus: 5, grpcMessage: "Not found" };
};

const core = new HyperCore({
  customSender: new GrpcSender(),
  customTransport: new GrpcTestTransport(handler),
});

const res = await core.grpc.call({
  service: "api.v1.UserService",
  method: "GetUser",
  message: { name: "Alice" },
  encode: (msg) => new TextEncoder().encode(JSON.stringify(msg)),
  decode: (bytes) => JSON.parse(new TextDecoder().decode(bytes)),
});

const missing = await core.grpc.call({
  service: "api.v1.UserService",
  method: "GetMissing",
  message: {},
  encode: (msg) => new TextEncoder().encode(JSON.stringify(msg)),
  decode: (bytes) => JSON.parse(new TextDecoder().decode(bytes)),
});

console.log("sender:", await core.getSenderName("grpc"));
console.log("transport:", await core.getTransportName());
console.log("protocol:", await core.getProtocolName());

console.log("--- GetUser ---");
console.log("status:", res.status);
console.log("ok:", res.ok);
console.log("grpcStatus:", res.data.grpcStatus);
console.log("data:", res.data.data);

console.log("--- GetMissing ---");
console.log("ok:", missing.ok);
console.log("grpcStatus:", missing.data.grpcStatus);
console.log("grpcMessage:", missing.data.grpcMessage);
