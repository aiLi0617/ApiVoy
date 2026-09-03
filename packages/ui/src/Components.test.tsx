import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { Accordion, Breadcrumbs, Button, ButtonGroup, Checkbox, DataTable, EmptyState, Field, IconButton, InlineAlert, LoadingState, Pagination, ProgressBar, SearchInput, SegmentedControl, Select, Skeleton, StatusBadge, Switch, Tabs, Tag, Textarea, TextInput, Toolbar } from "./Components";

const button = renderToStaticMarkup(<Button variant="primary" loading>Save</Button>);
assert.match(button, /class="ui-button primary"/);
assert.match(button, /disabled=""/);
assert.match(button, /aria-busy="true"/);

const iconButton = renderToStaticMarkup(<IconButton label="Close" icon="close" active />);
assert.match(iconButton, /aria-label="Close"/);
assert.match(iconButton, /aria-pressed="true"/);
assert.match(iconButton, /ui-icon-button is-active/);

const field = renderToStaticMarkup(<Field label="Name" required hint="Required field"><TextInput /></Field>);
assert.match(field, /ui-field-required/);
assert.match(field, /Required field/);
assert.match(field, /aria-describedby=/);
assert.match(field, /class="ui-input"/);

assert.match(renderToStaticMarkup(<Select><option>One</option></Select>), /class="ui-select"/);
assert.match(renderToStaticMarkup(<Textarea />), /class="ui-textarea"/);
assert.match(renderToStaticMarkup(<Checkbox label="Enabled" defaultChecked />), /type="checkbox"/);
assert.match(renderToStaticMarkup(<Switch label="Auto save" defaultChecked />), /role="switch"/);
assert.match(renderToStaticMarkup(<SegmentedControl ariaLabel="Mode" value="a" onValueChange={() => undefined} items={[{ value: "a", label: "A" }, { value: "b", label: "B" }]} />), /aria-pressed="true"/);

const tabs = renderToStaticMarkup(
  <Tabs
    ariaLabel="Request sections"
    value="params"
    onValueChange={() => undefined}
    items={[
      { value: "params", label: "Params", content: "Parameters" },
      { value: "body", label: "Body", content: "Body content" },
    ]}
  />,
);
assert.match(tabs, /role="tablist"/);
assert.match(tabs, /aria-selected="true"/);
assert.match(tabs, /role="tabpanel"/);
assert.doesNotMatch(tabs, /Body content/);

assert.match(renderToStaticMarkup(<StatusBadge tone="success">Ready</StatusBadge>), /ui-status-badge success/);
assert.match(renderToStaticMarkup(<InlineAlert tone="danger">Failed</InlineAlert>), /role="alert"/);
assert.match(renderToStaticMarkup(<ButtonGroup><Button>One</Button><Button>Two</Button></ButtonGroup>), /ui-button-group/);
assert.match(renderToStaticMarkup(<SearchInput aria-label="Search" defaultValue="users" />), /ui-search-input/);
assert.match(renderToStaticMarkup(<Toolbar label="Actions"><Button>Run</Button></Toolbar>), /role="toolbar"/);
assert.match(renderToStaticMarkup(<Tag tone="info">HTTP</Tag>), /ui-tag info/);
assert.match(renderToStaticMarkup(<ProgressBar label="Progress" value={62} />), /aria-valuenow="62"/);
assert.match(renderToStaticMarkup(<LoadingState />), /role="status"/);
assert.equal((renderToStaticMarkup(<Skeleton lines={2} />).match(/<i/g) ?? []).length, 2);
assert.match(renderToStaticMarkup(<EmptyState title="No data" />), /ui-empty-state/);
assert.match(renderToStaticMarkup(<Breadcrumbs items={[{ label: "Home", current: true }]} />), /aria-current="page"/);
assert.match(renderToStaticMarkup(<Pagination page={2} pages={5} onPageChange={() => undefined} />), /aria-label="分页"/);
assert.match(renderToStaticMarkup(<DataTable caption="Requests" columns={[{ id: "name", label: "Name" }]} rows={[{ name: "Users" }]} />), /<table class="ui-data-table">/);
assert.match(renderToStaticMarkup(<Accordion items={[{ id: "one", title: "One", content: "Details" }]} />), /<details>/);

console.log("Components tests passed");
