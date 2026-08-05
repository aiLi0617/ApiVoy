/** Protocol UI Schema types — filled in during M1/M2. */

export interface ProtocolUiSchema {
  protocolId: string;
  version: string;
  form: Record<string, unknown>;
}
