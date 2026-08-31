import assert from "node:assert/strict";
import test from "node:test";
import { interfaceCaseCategory, lifecycleTabsFor } from "./InterfaceLifecycle";

test("treats an unset test case group as the default positive category", () => {
  assert.equal(interfaceCaseCategory(), "positive");
  assert.equal(interfaceCaseCategory({}), "positive");
  assert.equal(interfaceCaseCategory({ __apivoyCaseGroup: "positive" }), "positive");
  assert.equal(interfaceCaseCategory({ __apivoyCaseGroup: "未分组" }), "other");
});

test("enables the full lifecycle for schema-driven API protocols", () => {
  for (const protocol of ["http", "graphql", "grpc", "rpc", "mqtt", "amqp", "kafka"]) {
    assert.deepEqual(lifecycleTabsFor(protocol), ["debug", "definition", "examples", "docs", "mock"], protocol);
  }
});

test("keeps lifecycle tabs capability-driven for every remaining protocol", () => {
  assert.deepEqual(lifecycleTabsFor("websocket"), ["debug", "examples", "docs", "mock"]);
  assert.deepEqual(lifecycleTabsFor("sse"), ["debug", "examples", "docs", "mock"]);
  assert.deepEqual(lifecycleTabsFor("tcp"), ["debug", "examples"]);
  assert.deepEqual(lifecycleTabsFor("udp"), ["debug", "examples"]);
  assert.deepEqual(lifecycleTabsFor("redis"), ["debug", "examples", "docs"]);
  assert.deepEqual(lifecycleTabsFor("sql"), ["debug", "definition", "examples", "docs"]);
});

test("does not add interface lifecycle tabs to management workbenches", () => {
  for (const workbench of ["mock", "runner", "gateway", "capture", "plugins", "ai"]) assert.deepEqual(lifecycleTabsFor(workbench), []);
});
