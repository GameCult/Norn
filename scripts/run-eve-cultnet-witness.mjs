import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import os from "node:os";
import { Buffer } from "node:buffer";
import { decode, encode } from "@msgpack/msgpack";
import { invokeCultNetOperation } from "cultnet-ts";

const root = path.resolve(import.meta.dirname, "..");
const cargo = process.env.CARGO || (process.platform === "win32" ? path.join(os.homedir(), ".cargo/bin/cargo.exe") : "cargo");
const build = spawnSync(cargo, ["build", "--quiet", "-p", "norn-eve-plugin"], { cwd: root, stdio: "inherit" });
assert.equal(build.status, 0, "norn-eve-plugin build failed");
const executable = path.join(root, "target", "debug", process.platform === "win32" ? "norn-eve-plugin.exe" : "norn-eve-plugin");
const fixture = JSON.parse(fs.readFileSync(path.join(root, "plugins/norn-graph.plugin-abi-fixture.json"), "utf8"));
const child = spawn(executable, [], { cwd: root, stdio: ["ignore", "pipe", "inherit"] });
const lines = readline.createInterface({ input: child.stdout })[Symbol.asyncIterator]();
const endpointLine = await lines.next();
assert.equal(endpointLine.done, false);
const endpointAdvertisement = JSON.parse(endpointLine.value);
assert.equal(endpointAdvertisement.pluginId, fixture.pluginId);
const startedAt = performance.now();
const operations = [];

try {
  for (let index = 0; index < fixture.operations.length; index += 1) {
    const fixtureOperation = fixture.operations[index];
    const requestId = `norn-witness-${index}`;
    const operationStartedAt = performance.now();
    const abiRequest = { schema: fixture.requestSchema, pluginId: fixture.pluginId, operation: fixtureOperation.operation, requestId, input: fixtureOperation.input };
    const envelope = await invokeCultNetOperation(endpointAdvertisement.endpoint, {
      schemaVersion: "cultnet.operation_request.v0",
      messageId: requestId,
      serviceId: fixture.pluginId,
      operation: fixtureOperation.operation,
      payloadSchema: fixture.requestSchema,
      payloadEncoding: "messagepack-base64",
      payload: Buffer.from(encode(abiRequest)).toString("base64"),
      sourceRuntimeId: "eve-conformance",
    }, { runtimeId: "eve-conformance" });
    const response = decode(Buffer.from(envelope.payload, "base64"));
    assert.equal(response.schema, fixture.responseSchema);
    assert.equal(response.pluginId, fixture.pluginId);
    assert.equal(response.operation, fixtureOperation.operation);
    assert.equal(response.requestId, requestId);
    assert.equal(response.status, "accepted");
    assertSubset(response.output, fixtureOperation.expect, fixtureOperation.operation);
    operations.push({ operation: fixtureOperation.operation, requestId, status: response.status, durationMs: Number((performance.now() - operationStartedAt).toFixed(3)), expectationCount: Object.keys(fixtureOperation.expect).length });
  }
} finally {
  child.kill();
}

const outputPath = path.join(root, "artifacts/eve-plugin/runtime-witness.json");
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify({
  schema: "gamecult.eve.plugin_witness.v1",
  witnessId: "norn.graph.owner-sidecar",
  pluginId: fixture.pluginId,
  ownerRepo: "Norn",
  status: "pass",
  transport: "cultnet-operation-v0+rudp",
  generatedAtUtc: new Date().toISOString(),
  durationMs: Number((performance.now() - startedAt).toFixed(3)),
  operations,
  advertisementPath: "plugins/norn-graph.plugin-advertisement.json",
  fixturePath: "plugins/norn-graph.plugin-abi-fixture.json",
  executable: { artifact: "target/debug/norn-eve-plugin", command: "cargo build -p norn-eve-plugin" },
  diagnostics: [],
  authority: "norn-sidecar-owns-graph-semantics-provider-retains-command-acceptance",
}, null, 2)}\n`);
console.log(outputPath);

function assertSubset(actual, expected, label) {
  if (Array.isArray(expected)) return assert.deepEqual(actual, expected, label);
  if (expected && typeof expected === "object") {
    for (const [key, value] of Object.entries(expected)) assertSubset(actual?.[key], value, `${label}.${key}`);
    return;
  }
  assert.equal(actual, expected, label);
}
