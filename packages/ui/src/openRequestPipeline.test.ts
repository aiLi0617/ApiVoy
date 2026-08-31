import assert from "node:assert/strict";
import { consumeHydrate, stashHydrate } from "./openRequestPipeline";

const targeted = {
  workbenchId: "http",
  sessionId: "target-session",
  envelope: { variables: { __apivoyCaseOf: "interface-id" } },
};

stashHydrate(targeted);
assert.equal(consumeHydrate("http", "other-session"), null);
assert.deepEqual(consumeHydrate("http", "target-session"), targeted);
assert.equal(consumeHydrate("http", "target-session"), null);

const untargeted = { workbenchId: "graphql", envelope: { target: "https://example.test/graphql" } };
stashHydrate(untargeted);
assert.deepEqual(consumeHydrate("graphql"), untargeted);

console.log("open request pipeline tests passed");
