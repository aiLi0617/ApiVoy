import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { HttpLiveRequestView, type HttpWorkbenchRequest } from "./HttpWorkbench";

const request: HttpWorkbenchRequest = {
  name: "Not found",
  method: "GET",
  url: "https://httpbin.org/status/404",
  headers: [["Accept", "*/*"], ["Content-Type", "text/plain"]],
  body: "",
  timeoutMs: 30_000,
  variables: {},
  assertions: [],
  auth: null,
  followRedirects: true,
  retryMax: 0,
  retryBackoffMs: 250,
  proxy: null,
  tlsVerify: true,
};

test("renders the live request as URL, Header table, Body, and request code sections", () => {
  const markup = renderToStaticMarkup(<HttpLiveRequestView request={request}/>);

  assert.match(markup, /class="http-live-request"/);
  assert.match(markup, /请求 URL:/);
  assert.match(markup, /data-method="GET"/);
  assert.match(markup, /https:\/\/httpbin\.org\/status\/404/);
  assert.match(markup, /aria-label="实时请求 Header"/);
  assert.match(markup, /名称/);
  assert.match(markup, /值/);
  assert.match(markup, /text\/plain/);
  assert.match(markup, /请求代码/);
  assert.doesNotMatch(markup, /interface-case-preview-split/);
});
