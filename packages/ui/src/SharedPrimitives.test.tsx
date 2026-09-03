import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { MessageDetailActions, MessageInspector, MessageSummary, MessageToolbar } from "./MessageInspector";
import { ModalFrame } from "./ModalFrame";
import { RovingTabList } from "./RovingTabList";

const tabs = renderToStaticMarkup(<RovingTabList ariaLabel="Modes"><button role="tab" tabIndex={0}>One</button></RovingTabList>);
assert.match(tabs, /role="tablist"/);
assert.match(tabs, /aria-label="Modes"/);

const inspector = renderToStaticMarkup(<MessageInspector hasDetail><MessageSummary><MessageToolbar>Tools</MessageToolbar></MessageSummary><MessageDetailActions actions={[{ id: "copy", label: "Copy", icon: "copy", onSelect: () => undefined }]} onClose={() => undefined}/></MessageInspector>);
assert.match(inspector, /websocket-message-browser has-detail/);
assert.match(inspector, /websocket-message-summary/);
assert.match(inspector, /websocket-message-toolbar/);
assert.match(inspector, /aria-label="Copy"/);
assert.match(inspector, /aria-label="更多消息操作"/);

assert.equal(renderToStaticMarkup(<ModalFrame open={false} onClose={() => undefined} className="custom">Hidden</ModalFrame>), "");
const modal = renderToStaticMarkup(<ModalFrame open onClose={() => undefined} className="custom" ariaLabel="Custom dialog">Visible</ModalFrame>);
assert.match(modal, /class="dialog-backdrop"/);
assert.match(modal, /class="custom"/);
assert.match(modal, /role="dialog"/);
assert.match(modal, /aria-label="Custom dialog"/);

console.log("Shared primitive tests passed");
