import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { ClosableTabStrip } from "./ClosableTabStrip";

const markup = renderToStaticMarkup(<ClosableTabStrip
  items={[
    { id: "one", title: "First", icon: "activity" },
    { id: "two", title: "Second", icon: "code" },
  ]}
  activeId="two"
  ariaLabel="Open requests"
  menuLabel="Tab actions"
  onActivate={() => undefined}
  onClose={() => undefined}
  onCloseAll={() => undefined}
  onCloseOthers={() => undefined}
/>);

assert.match(markup, /role="tablist"/);
assert.match(markup, /aria-label="Open requests"/);
assert.match(markup, /aria-selected="true" tabindex="0"/);
assert.match(markup, /aria-selected="false" tabindex="-1"/);
assert.match(markup, /aria-label="关闭 First"/);
assert.match(markup, /aria-haspopup="menu"/);

console.log("ClosableTabStrip tests passed");
