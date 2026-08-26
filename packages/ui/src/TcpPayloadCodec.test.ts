import { strict as assert } from "node:assert";
import { encodeTcpPayload, formatTcpPayload } from "./TcpPayloadCodec";

assert.equal(new TextDecoder().decode(encodeTcpPayload("json", "{\"ok\":true}")), '{"ok":true}');
assert.deepEqual([...encodeTcpPayload("hex", "48 65 6c 6c 6f")], [72, 101, 108, 108, 111]);
assert.deepEqual([...encodeTcpPayload("base64", "SGVsbG8=")], [72, 101, 108, 108, 111]);
assert.equal(formatTcpPayload(new Uint8Array([72, 101, 108, 108, 111]), "base64"), "SGVsbG8=");
const packed = encodeTcpPayload("msgpack", '{"ok":true}');
assert.equal(formatTcpPayload(packed, "msgpack"), '{\n  "ok": true\n}');

assert.equal(new TextDecoder().decode(encodeTcpPayload("xml", "<root><ok/></root>")), "<root><ok/></root>");
assert.throws(() => encodeTcpPayload("xml", "<root><ok>"), /XML/);
assert.throws(() => encodeTcpPayload("xml", "not-xml"), /XML/);

console.log("TCP payload codec tests passed");
