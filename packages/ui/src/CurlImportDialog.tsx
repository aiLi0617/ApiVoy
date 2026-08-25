import { useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { HttpWorkbenchRequest } from "./HttpWorkbench";
import { Icon } from "./Icons";
import { parseCurlWithWarnings } from "./curlImport";
import { useDialogFocus } from "./useDialogFocus";

export interface CurlImportDialogProps { open: boolean; onClose: () => void; onCreate: (request: HttpWorkbenchRequest) => void }
const C = { title: "\u5bfc\u5165 cURL", intro: "\u89e3\u6790\u540e\u5148\u8fdb\u5165\u8c03\u8bd5\uff0c\u4e0d\u4f1a\u81ea\u52a8\u53d1\u9001\u6216\u4fdd\u5b58\u3002", close: "\u5173\u95ed\u5bfc\u5165 cURL", command: "cURL \u547d\u4ee4", inspect: "\u9700\u8981\u68c0\u67e5", ready: "\u5df2\u8bc6\u522b\u4e3b\u8981\u8bf7\u6c42\u914d\u7f6e", hint: "\u5bfc\u5165\u540e\u8bf7\u68c0\u67e5\u8ba4\u8bc1\u4fe1\u606f\u548c\u53d8\u91cf", cancel: "\u53d6\u6d88", submit: "\u5bfc\u5165\u5230\u8c03\u8bd5" };

export function CurlImportDialog({ open, onClose, onCreate }: CurlImportDialogProps) {
  const titleId = useId(), dialogRef = useRef<HTMLFormElement>(null), inputRef = useRef<HTMLTextAreaElement>(null);
  const [source, setSource] = useState("");
  useDialogFocus(open, dialogRef, onClose, inputRef);
  const result = useMemo(() => { if (!source.trim()) return { request: null, warnings: [], error: "" }; try { return { ...parseCurlWithWarnings(source), error: "" }; } catch (error) { return { request: null, warnings: [], error: error instanceof Error ? error.message : String(error) }; } }, [source]);
  if (!open) return null;
  return createPortal(<div className="dialog-backdrop" role="presentation" onMouseDown={onClose}><form ref={dialogRef} className="curl-import-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} onMouseDown={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); if (result.request) { onCreate(result.request); setSource(""); } }}>
    <header className="settings-dialog-header"><div><h2 id={titleId}>{C.title}</h2><p>{C.intro}</p></div><button type="button" className="ui-icon-button" aria-label={C.close} onClick={onClose}><Icon name="close"/></button></header>
    <div className="curl-import-body"><label htmlFor={`${titleId}-source`}>{C.command}</label><textarea ref={inputRef} id={`${titleId}-source`} value={source} onChange={(event) => setSource(event.target.value)} placeholder={"curl --request POST \\\n  --url https://api.example.com/users \\\n  --header 'Content-Type: application/json' \\\n  --data '{\"name\":\"Ada\"}'"} spellCheck={false}/>{result.request ? <div className="curl-import-result" aria-live="polite"><div className="curl-import-preview"><span>{result.request.method}</span><strong>{result.request.url}</strong><small>{result.request.headers.length} Header{result.request.body !== undefined ? " + Body" : ""}</small></div>{result.warnings.length ? <div className="curl-import-warnings"><strong><Icon name="activity"/>{C.inspect} {result.warnings.length}</strong><ul>{result.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div> : <p className="curl-import-ready"><Icon name="activity"/>{C.ready}</p>}</div> : result.error ? <p className="curl-import-error" role="alert"><Icon name="activity"/>{result.error}</p> : null}</div>
    <footer className="settings-dialog-footer"><span>{C.hint}</span><button type="button" className="ui-button secondary" onClick={onClose}>{C.cancel}</button><button type="submit" className="ui-button primary" disabled={!result.request}><Icon name="download"/>{C.submit}</button></footer>
  </form></div>, document.body);
}
