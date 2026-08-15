import { useEffect, useRef } from "react";
import { consumeHydrate } from "./openRequestPipeline";

/**
 * Delivers open-request / hydrate payloads, including a stashed payload when this
 * workbench mounts after WorkbenchDeck switches tabs (UX-023).
 */
export function useWorkbenchHydration(
  workbenchId: string,
  onDetail: (detail: unknown) => void,
  sessionId?: string,
): void {
  const handlerRef = useRef(onDetail);
  handlerRef.current = onDetail;

  useEffect(() => {
    const deliver = (detail: unknown) => {
      if (detail == null) return;
      handlerRef.current(detail);
    };

    const pending = consumeHydrate(workbenchId);
    if (pending) deliver(pending.envelope);

    const onHydrate = (event: Event) => {
      const detail = (event as CustomEvent<{ workbenchId?: string; sessionId?: string; envelope?: unknown }>).detail;
      if (detail?.workbenchId !== workbenchId) return;
      if (detail.sessionId && detail.sessionId !== sessionId) return;
      deliver(detail.envelope);
    };

    window.addEventListener("apivoy-hydrate-request", onHydrate);
    return () => {
      window.removeEventListener("apivoy-hydrate-request", onHydrate);
    };
  }, [workbenchId, sessionId]);
}
