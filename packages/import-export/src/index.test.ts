import test from "node:test";
import assert from "node:assert/strict";
import { exportApiVoyProject, importDocument, importJson, scanSensitiveData } from "./index.js";

test("imports OpenAPI operations", () => {
  const result = importJson(JSON.stringify({ openapi: "3.0.0", info: { title: "Pets" }, servers: [{ url: "https://api.example.com" }], paths: { "/pets": { get: { summary: "List pets" } } } }));
  assert.equal(result.requests[0]?.url, "https://api.example.com/pets");
});

test("imports nested Postman items and HAR", () => {
  const postman = importJson(JSON.stringify({ info: { name: "Demo", schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" }, item: [{ name: "Folder", item: [{ name: "One", request: { method: "POST", url: "https://example.com", body: { raw: "{}" } } }] }] }));
  assert.equal(postman.requests[0]?.method, "POST");
  const har = importJson(JSON.stringify({ log: { entries: [{ request: { method: "GET", url: "https://example.com", headers: [] } }] } }));
  assert.equal(har.requests.length, 1);
});

test("blocks sensitive exports by default", () => {
  const requests = [{ name: "Secret", method: "GET", url: "https://example.com?api_key=x", headers: { Authorization: "Bearer x" } }];
  assert.equal(scanSensitiveData(requests).length, 2);
  assert.throws(() => exportApiVoyProject("Demo", requests));
});

test("imports OpenAPI YAML", async () => {
  const result = await importDocument("openapi: 3.0.0\ninfo:\n  title: YAML API\npaths:\n  /health:\n    get:\n      tags: [system]\n");
  assert.equal(result.name, "YAML API");
  assert.deepEqual(result.requests[0]?.collectionPath, ["system"]);
});

test("resolves OpenAPI component refs into sendable request examples", () => {
  const result = importJson(JSON.stringify({ openapi: "3.0.0", info: { title: "Refs" }, paths: { "/pets": { post: { requestBody: { $ref: "#/components/requestBodies/PetBody" } } } }, components: { requestBodies: { PetBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/Pet" } } } } }, schemas: { Pet: { type: "object", properties: { name: { type: "string", example: "Milo" }, age: { type: "integer" }, active: { type: "boolean" } } } } } }));
  assert.deepEqual(JSON.parse(result.requests[0]?.body ?? "{}"), { name: "Milo", age: 0, active: false });
});

test("maps OpenAPI server variables to ApiVoy request variables", () => {
  const result = importJson(JSON.stringify({ openapi: "3.0.0", info: { title: "Variables" }, servers: [{ url: "https://{region}.example.com/{version}", variables: { region: { default: "cn" }, version: { default: "v1" } } }], paths: { "/health": { get: {} } } }));
  assert.equal(result.requests[0]?.url, "https://{{region}}.example.com/{{version}}/health");
  assert.deepEqual(result.requests[0]?.variables, { region: "cn", version: "v1" });
});

test("resolves relative external OpenAPI refs with their own internal pointers", async () => {
  const main = "openapi: 3.0.0\ninfo: { title: External }\npaths:\n  /pets:\n    post:\n      requestBody:\n        $ref: './parts/pet.yaml#/PetBody'\n";
  const dependency = "PetBody:\n  content:\n    application/json:\n      schema:\n        $ref: '#/Pet'\nPet:\n  type: object\n  properties:\n    name: { type: string, example: Luna }\n";
  const result = await importDocument(main, { baseUri: "spec/openapi.yaml", documents: { "spec/parts/pet.yaml": dependency } });
  assert.deepEqual(JSON.parse(result.requests[0]?.body ?? "{}"), { name: "Luna" });
});

test("detects external OpenAPI ref cycles", async () => {
  const main = "openapi: 3.0.0\ninfo: { title: Cycle }\npaths:\n  $ref: './paths.yaml#/paths'\n";
  const dependency = "paths:\n  $ref: './openapi.yaml#/paths'\n";
  await assert.rejects(() => importDocument(main, { baseUri: "spec/openapi.yaml", documents: { "spec/paths.yaml": dependency } }), /循环|cycle/i);
});
