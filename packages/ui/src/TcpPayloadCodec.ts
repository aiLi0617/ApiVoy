import { encodeMessagePack } from "./HttpWorkbench";

export type TcpPayloadFormat = "text" | "json" | "xml" | "hex" | "base64" | "msgpack";

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const compact = value.replace(/\s+/g, "");
  if (!compact || !/^[A-Za-z0-9+/]*={0,2}$/.test(compact) || compact.length % 4 !== 0) throw new Error("Base64 内容格式无效");
  try { return Uint8Array.from(atob(compact), (character) => character.charCodeAt(0)); }
  catch { throw new Error("Base64 内容格式无效"); }
}

function hexToBytes(value: string): Uint8Array {
  const compact = value.replace(/\s+/g, "").replace(/^0x/i, "");
  if (!compact || compact.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(compact)) throw new Error("Hex 内容必须由偶数个十六进制字符组成");
  return Uint8Array.from(compact.match(/.{2}/g)!, (pair) => Number.parseInt(pair, 16));
}

function validateXml(value: string): void {
  if (typeof DOMParser === "undefined") return;
  const document = new DOMParser().parseFromString(value, "application/xml");
  if (document.querySelector("parsererror")) throw new Error("XML 内容格式无效");
}

export function encodeTcpPayload(format: TcpPayloadFormat, value: string): Uint8Array {
  if (format === "hex") return hexToBytes(value);
  if (format === "base64") return base64ToBytes(value);
  if (format === "json") { JSON.parse(value); return new TextEncoder().encode(value); }
  if (format === "xml") { validateXml(value); return new TextEncoder().encode(value); }
  if (format === "msgpack") return encodeMessagePack(JSON.parse(value));
  return new TextEncoder().encode(value);
}

function decodeMessagePack(bytes: Uint8Array): unknown {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); let offset = 0;
  const ensure = (length: number) => { if (offset + length > bytes.length) throw new Error("MessagePack 数据不完整"); };
  const uint = (length: 1 | 2 | 4) => { ensure(length); const value = length === 1 ? view.getUint8(offset) : length === 2 ? view.getUint16(offset, false) : view.getUint32(offset, false); offset += length; return value; };
  const int = (length: 1 | 2 | 4) => { ensure(length); const value = length === 1 ? view.getInt8(offset) : length === 2 ? view.getInt16(offset, false) : view.getInt32(offset, false); offset += length; return value; };
  const text = (length: number) => { ensure(length); const value = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(offset, offset + length)); offset += length; return value; };
  const read = (): unknown => {
    ensure(1); const prefix = bytes[offset++];
    if (prefix <= 0x7f) return prefix;
    if (prefix >= 0xe0) return prefix - 0x100;
    if ((prefix & 0xe0) === 0xa0) return text(prefix & 0x1f);
    if ((prefix & 0xf0) === 0x90) return Array.from({ length: prefix & 0x0f }, read);
    if ((prefix & 0xf0) === 0x80) return Object.fromEntries(Array.from({ length: prefix & 0x0f }, () => [String(read()), read()]));
    switch (prefix) {
      case 0xc0: return null; case 0xc2: return false; case 0xc3: return true;
      case 0xca: ensure(4); { const value = view.getFloat32(offset, false); offset += 4; return value; }
      case 0xcb: ensure(8); { const value = view.getFloat64(offset, false); offset += 8; return value; }
      case 0xcc: return uint(1); case 0xcd: return uint(2); case 0xce: return uint(4);
      case 0xd0: return int(1); case 0xd1: return int(2); case 0xd2: return int(4);
      case 0xd9: return text(uint(1)); case 0xda: return text(uint(2)); case 0xdb: return text(uint(4));
      case 0xc4: { const length = uint(1); ensure(length); const value = bytes.slice(offset, offset + length); offset += length; return { base64: bytesToBase64(value) }; }
      case 0xc5: { const length = uint(2); ensure(length); const value = bytes.slice(offset, offset + length); offset += length; return { base64: bytesToBase64(value) }; }
      case 0xdc: return Array.from({ length: uint(2) }, read);
      case 0xde: return Object.fromEntries(Array.from({ length: uint(2) }, () => [String(read()), read()]));
      default: throw new Error(`暂不支持 MessagePack 标记 0x${prefix.toString(16)}`);
    }
  };
  const value = read(); if (offset !== bytes.length) throw new Error(`MessagePack 尾部还有 ${bytes.length - offset} 个字节`); return value;
}

function prettyXml(value: string): string {
  validateXml(value);
  const compact = value.replace(/>\s*</g, "><").trim(); let depth = 0;
  return compact.replace(/(<[^>]+>)/g, "$1\n").split("\n").filter(Boolean).map((part) => {
    if (/^<\//.test(part)) depth = Math.max(0, depth - 1);
    const line = `${"  ".repeat(depth)}${part}`;
    if (/^<[^!?/][^>]*[^/]?>$/.test(part) && !/<\/[^>]+>$/.test(part)) depth += 1;
    return line;
  }).join("\n");
}

export function formatTcpPayload(bytes: Uint8Array, format: TcpPayloadFormat): string {
  if (format === "hex") return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join(" ");
  if (format === "base64") return bytesToBase64(bytes);
  if (format === "msgpack") return JSON.stringify(decodeMessagePack(bytes), null, 2);
  const value = new TextDecoder("utf-8", { fatal: format === "json" || format === "xml" }).decode(bytes);
  if (format === "json") return JSON.stringify(JSON.parse(value), null, 2);
  if (format === "xml") return prettyXml(value);
  return value;
}

export function tcpPayloadLanguage(format: TcpPayloadFormat): string {
  return format === "json" || format === "msgpack" ? "json" : format === "xml" ? "xml" : "plaintext";
}

export function tcpPayloadLabel(format: TcpPayloadFormat): string {
  return format === "msgpack" ? "MessagePack" : format === "base64" ? "Base64" : format.toUpperCase();
}
