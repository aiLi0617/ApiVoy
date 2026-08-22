import type { ReactNode } from "react";
import type { HttpRunResult } from "./HttpWorkbench";
import { SplitPane } from "./WorkbenchFrame";

interface ProtocolWorkbenchLayoutProps {
  id: string; protocol: string; name: string; target: string; targetLabel: string;
  actionLabel: string; loadingLabel?: string; loading: boolean; result: HttpRunResult | null;
  responseTitle: string; emptyResponse: string; message?: string; controls?: ReactNode; children: ReactNode;
  onNameChange: (value: string) => void; onTargetChange: (value: string) => void;
  onRun: () => void; onSave?: () => void; onCancel?: () => void;
}

export function ProtocolWorkbenchLayout({ id, protocol, name, target, targetLabel, actionLabel, loadingLabel = "运行中…", loading, result, responseTitle, emptyResponse, message, controls, children, onNameChange, onTargetChange, onRun, onSave, onCancel }: ProtocolWorkbenchLayoutProps) {
  const metrics = result ? <span className="protocol-response-metrics">{result.summary.durationMs} ms · {result.summary.bytesReceived} B</span> : null;
  return <div className="protocol-workbench-layout" aria-busy={loading || undefined}>
      <div className="protocol-commandbar">
        <span className="protocol-command-badge">{protocol}</span>
        <input aria-label="请求名称" className="protocol-name-input" value={name} onChange={(event) => onNameChange(event.target.value)} />
        <input aria-label={targetLabel} className="protocol-target-input" value={target} onChange={(event) => onTargetChange(event.target.value)} />
        <button type="button" className="protocol-run-button" disabled={loading} onClick={onRun}>{loading ? loadingLabel : actionLabel}</button>
        {onSave ? <button type="button" className="protocol-save-button" disabled={loading} onClick={onSave}>保存</button> : null}
        {loading && onCancel ? <button type="button" className="protocol-cancel-button" onClick={onCancel}>取消</button> : null}
      </div>
      <div className="protocol-workbench-split">
        <SplitPane id={`${id}-workbench`} direction="vertical" minPrimary={180} minSecondary={140} primaryLabel="请求配置" secondaryLabel="响应检查器" secondaryActions={metrics}
          primary={<div className="protocol-request-pane">{controls ? <div className="protocol-mode-tabs" role="tablist">{controls}</div> : null}<div className="protocol-request-content">{children}</div></div>}
          secondary={<div className="protocol-response-pane"><div className="protocol-response-tabs"><button type="button" className="is-active">{responseTitle}</button></div><pre className={`protocol-response-body${result ? " has-result" : " is-empty"}`}>{result?.preview ?? emptyResponse}</pre></div>}
        />
      </div>
      {message ? <div className="protocol-status" role="status" aria-live="polite">{message}</div> : null}
  </div>;
}
