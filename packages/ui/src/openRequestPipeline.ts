/** UX-023: stash open/hydrate payloads so a workbench that mounts after tab switch still receives them. */

export type HydratePayload = {
  workbenchId: string;
  sessionId?: string;
  protocolId?: string;
  envelope: unknown;
};

let pending: HydratePayload | null = null;

export function stashHydrate(payload: HydratePayload): void {
  pending = payload;
}

export function consumeHydrate(workbenchId: string): HydratePayload | null {
  if (!pending || pending.workbenchId !== workbenchId) return null;
  const value = pending;
  pending = null;
  return value;
}

export function peekHydrate(workbenchId: string): HydratePayload | null {
  if (!pending || pending.workbenchId !== workbenchId) return null;
  return pending;
}
