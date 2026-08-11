/** Declarative form schema exposed to protocol UI plugins. */

export type ProtocolUiField =
  | { kind: "text" | "password" | "textarea"; name: string; label: string; required?: boolean; placeholder?: string }
  | { kind: "number"; name: string; label: string; required?: boolean; min?: number; max?: number }
  | { kind: "boolean"; name: string; label: string }
  | { kind: "select"; name: string; label: string; options: Array<{ label: string; value: string }> };

export interface ProtocolUiSchema {
  protocolId: string;
  version: string;
  displayName: string;
  fields: ProtocolUiField[];
}

export function validateProtocolUiSchema(value: unknown): value is ProtocolUiSchema {
  if (!value || typeof value !== "object") return false;
  const schema = value as Partial<ProtocolUiSchema>;
  if (!schema.protocolId?.trim() || !schema.version?.trim() || !schema.displayName?.trim() || !Array.isArray(schema.fields)) return false;
  return schema.fields.every((field) => Boolean(field && typeof field === "object" && "kind" in field && "name" in field && "label" in field));
}
