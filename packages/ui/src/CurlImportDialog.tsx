import { useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { HttpWorkbenchRequest } from "./HttpWorkbench";
import { Icon } from "./Icons";
import { parseCurl } from "./curlImport";
import { useDialogFocus } from "./useDialogFocus";

export interface CurlImportDialogProps { open: boolean; onClose: () => void; onCreate: (request: HttpWorkbenchRequest) => void }

export function CurlImportDialog({ open, onClose, onCreate }: CurlImportDialogProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [source, setSource] = useState("");
  useDialogFocus(open, dialogRef, onClose, inputRef);
  const result = useMemo(() => {
    if (!source.trim()) return { request: null, error: "" };
    try { return { request: parseCurl(source), error: "" }; }
    catch (error) { return { request: null, error: error instanceof Error ? error.message : String(error) }; }
  }, [source]);
  if (!open) return null;
  return createPortal(
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <form ref={dialogRef} className="curl-import-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} onMouseDown={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); if (result.request) { onCreate(result.request); setSource(""); } }}>
        <header className="settings-dialog-header"><div><h2 id={titleId}>导入 cURL</h2></div><button type="button" className="ui-icon-button" aria-label="关闭导入 cURL" onClick={onClose}><Icon name="close"/></button></header>
        <div className="curl-import-body">
          <label htmlFor={`${titleId}-source`}>cURL 命令</label>
          <textarea ref={inputRef} id={`${titleId}-source`} value={source} onChange={(event) => setSource(event.target.value)} placeholder={"curl --request POST \\\n  --url https://api.example.com/users \\\n  --header 'Content-Type: application/json' \\\n  --data '{\"name\":\"Ada\"}'"} spellCheck={false}/>
          {result.request ? <div className="curl-import-preview" aria-live="polite"><span>{result.request.method}</span><strong>{result.request.url}</strong><small>{result.request.headers.length} 个 Header{result.request.body !== undefined ? " · 包含 Body" : ""}</small></div> : result.error ? <p className="curl-import-error" role="alert"><Icon name="activity"/>{result.error}</p> : null}
        </div>
        <footer className="settings-dialog-footer"><button type="button" className="ui-button secondary" onClick={onClose}>取消</button><button type="submit" className="ui-button primary" disabled={!result.request}><Icon name="plus"/>创建请求</button></footer>
      </form>
    </div>, document.body,
  );
}
