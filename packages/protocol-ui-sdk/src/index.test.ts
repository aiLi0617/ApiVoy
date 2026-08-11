import assert from "node:assert/strict";
import { validateProtocolUiSchema } from "./index";

assert.equal(validateProtocolUiSchema({ protocolId: "demo", version: "1", displayName: "Demo", fields: [{ kind: "text", name: "target", label: "Target" }] }), true);
assert.equal(validateProtocolUiSchema({ protocolId: "demo", version: "1", fields: [] }), false);
assert.equal(validateProtocolUiSchema(null), false);

console.log("protocol-ui-sdk tests passed");
