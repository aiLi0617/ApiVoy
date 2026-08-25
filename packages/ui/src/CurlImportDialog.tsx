import { useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { HttpWorkbenchRequest } from "./HttpWorkbench";
import { Icon } from "./Icons";
import { parseCurlWithWarnings } from "./curlImport";
import { useDialogFocus } from "./useDialogFocus";

export interface CurlImportDialogProps { open: boolean; onClose: () => void; onCreate: (request: HttpWorkbenchRequest) => void | Promise<void> }
const C = { title: "\u5bfc\u5165 cURL", intro: "\u89e3\u6790 cURL \u5e76\u521b\u5efa\u65b0\u63a5\u53e3\uff0c\u540c\u65f6\u751f\u6210\u9ed8\u8ba4\u8c03\u8bd5\u7528\u4f8b\u3002\u4e0d\u4f1a\u81ea\u52a8\u53d1\u9001\u3002", close: "\u5173\u95ed\u5bfc\u5165 cURL", command: "cURL \u547d\u4ee4", inspect: "\u9700\u8981\u68c0\u67e5", ready: "\u5df2\u8bc6\u522b\u63a5\u53e3\u7ed3\u6784\u548c\u9ed8\u8ba4\u7528\u4f8b", hint: "\u8ba4\u8bc1\u51ed\u636e\u4e0d\u4f1a\u5199\u5165\u63a5\u53e3\u6587\u6863", cancel: "\u53d6\u6d88", submit: "\u521b\u5efa\u63a5\u53e3" };

export function CurlImportDialog({ open, onClose, onCreate }: CurlImportDialogProps) {
  const titleId = useId(), dialogRef = useRef<HTMLFormElement>(null), inputRef = useRef<HTMLTextAreaElement>(null);
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  useDialogFocus(open, dialogRef, onClose, inputRef);
  const result = useMemo(() => { if (!source.trim()) return { request: null, warnings: [], error: "" }; try { return { ...parseCurlWithWarnings(source), error: "" }; } catch (error) { return { request: null, warnings: [], error: error instanceof Error ? error.message : String(error) }; } }, [source]);
  if (!open) return null;
  return createPortal(<div className="dialog-backdrop" role="presentation" onMouseDown={onClose}><form ref={dialogRef} className="curl-import-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} onMouseDown={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); if (!result.request || busy) return; setBusy(true); Promise.resolve(onCreate(result.request)).then(() => setSource("")).finally(() => setBusy(false)); }}>
    <header className="settings-dialog-header"><div><h2 id={titleId}>{C.title}</h2><p>{C.intro}</p></div><button type="button" className="ui-icon-button" aria-label={C.close} onClick={onClose}><Icon name="close"/></button></header>
    <div className="curl-import-body"><label htmlFor={`${titleId}-source`}>{C.command}</label><textarea ref={inputRef} id={`${titleId}-source`} value={source} onChange={(event) => setSource(event.target.value)} placeholder={"curl --request POST \\\n  --url https://api.example.com/users \\\n  --header 'Content-Type: application/json' \\\n  --data '{\"name\":\"Ada\"}'"} spellCheck={false}/>{result.request ? <div className="curl-import-result" aria-live="polite"><div className="curl-import-preview"><span>{result.request.method}</span><strong>{result.request.url}</strong><small>{result.request.headers.length} Header{result.request.body !== undefined ? " + Body" : ""}</small></div>{result.warnings.length ? <div className="curl-import-warnings"><strong><Icon name="activity"/>{C.inspect} {result.warnings.length}</strong><ul>{result.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div> : <p className="curl-import-ready"><Icon name="activity"/>{C.ready}</p>}</div> : result.error ? <p className="curl-import-error" role="alert"><Icon name="activity"/>{result.error}</p> : null}</div>
    <footer className="settings-dialog-footer"><span>{C.hint}</span><button type="button" className="ui-button secondary" disabled={busy} onClick={onClose}>{C.cancel}</button><button type="submit" className="ui-button primary" disabled={!result.request || busy}><Icon name="download"/>{busy ? "\u521b\u5efa\u4e2d\u2026" : C.submit}</button></footer>
  </form></div>, document.body);
}
