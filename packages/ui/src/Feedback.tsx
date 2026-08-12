import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Icon, type IconName } from "./Icons";

type FeedbackTone = "info" | "success" | "warning" | "danger";
interface ToastRecord { id: number; message: string; tone: FeedbackTone }
interface ConfirmOptions { title: string; description: string; confirmLabel?: string; tone?: "default" | "danger" }
interface PromptOptions { title: string; description?: string; initialValue?: string; placeholder?: string; confirmLabel?: string }
interface FeedbackApi { notify: (message: string, tone?: FeedbackTone) => void; confirm: (options: ConfirmOptions) => Promise<boolean>; prompt: (options: PromptOptions) => Promise<string | null> }
const FeedbackContext = createContext<FeedbackApi | null>(null);
let toastId = 0;

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const [confirmation, setConfirmation] = useState<(ConfirmOptions & { resolve: (value: boolean) => void }) | null>(null);
  const [promptRequest, setPromptRequest] = useState<(PromptOptions & { resolve: (value: string | null) => void }) | null>(null);
  const [promptValue, setPromptValue] = useState("");
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const promptRef = useRef<HTMLInputElement>(null);
  const promptCancelRef = useRef<HTMLButtonElement>(null);
  const promptConfirmRef = useRef<HTMLButtonElement>(null);
  const notify = useCallback((message: string, tone: FeedbackTone = "info") => { const id = ++toastId; setToasts((items) => [...items, { id, message, tone }].slice(-4)); window.setTimeout(() => setToasts((items) => items.filter((item) => item.id !== id)), 4200); }, []);
  const confirm = useCallback((options: ConfirmOptions) => new Promise<boolean>((resolve) => setConfirmation({ ...options, resolve })), []);
  const prompt = useCallback((options: PromptOptions) => new Promise<string | null>((resolve) => { setPromptValue(options.initialValue ?? ""); setPromptRequest({ ...options, resolve }); }), []);
  const closeConfirmation = useCallback((value: boolean) => { setConfirmation((current) => { current?.resolve(value); return null; }); }, []);
  useEffect(() => { if (confirmation) cancelRef.current?.focus(); }, [confirmation]);
  useEffect(() => { if (promptRequest) promptRef.current?.focus(); }, [promptRequest]);
  useEffect(() => { if (!promptRequest) return; const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Tab" && document.activeElement === promptConfirmRef.current && !event.shiftKey) { event.preventDefault(); promptRef.current?.focus(); } else if (event.key === "Tab" && document.activeElement === promptRef.current && event.shiftKey) { event.preventDefault(); promptConfirmRef.current?.focus(); } }; window.addEventListener("keydown", onKeyDown); return () => window.removeEventListener("keydown", onKeyDown); }, [promptRequest]);
  useEffect(() => { if (!confirmation) return; const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") closeConfirmation(false); if (event.key === "Tab" && document.activeElement === confirmRef.current && !event.shiftKey) { event.preventDefault(); cancelRef.current?.focus(); } else if (event.key === "Tab" && document.activeElement === cancelRef.current && event.shiftKey) { event.preventDefault(); confirmRef.current?.focus(); } }; window.addEventListener("keydown", onKeyDown); return () => window.removeEventListener("keydown", onKeyDown); }, [confirmation, closeConfirmation]);
  const closePrompt = useCallback((result: string | null) => { setPromptRequest((current) => { current?.resolve(result); return null; }); }, []);
  const value = useMemo(() => ({ notify, confirm, prompt }), [notify, confirm, prompt]);
  return <FeedbackContext.Provider value={value}>{children}<div className="toast-region" aria-live="polite" aria-label="通知">{toasts.map((toast) => <div className={`toast toast-${toast.tone}`} key={toast.id} role={toast.tone === "danger" ? "alert" : "status"}><Icon name={toneIcon(toast.tone)}/><span>{toast.message}</span><button aria-label="关闭通知" onClick={() => setToasts((items) => items.filter((item) => item.id !== toast.id))}><Icon name="close"/></button></div>)}</div>{confirmation ? <div className="dialog-backdrop" role="presentation" onMouseDown={() => { if (confirmation.tone !== "danger") closeConfirmation(false); }}><div className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-description" onMouseDown={(event) => event.stopPropagation()}><div className={`dialog-icon dialog-${confirmation.tone ?? "default"}`}><Icon name={confirmation.tone === "danger" ? "trash" : "settings"}/></div><div><h2 id="confirm-title">{confirmation.title}</h2><p id="confirm-description">{confirmation.description}</p></div><div className="dialog-actions"><button ref={cancelRef} className="ui-button secondary" onClick={() => closeConfirmation(false)}>取消</button><button ref={confirmRef} className={`ui-button ${confirmation.tone === "danger" ? "danger" : "primary"}`} onClick={() => closeConfirmation(true)}>{confirmation.confirmLabel ?? "确认"}</button></div></div></div> : null}{promptRequest ? <div className="dialog-backdrop" role="presentation" onMouseDown={() => closePrompt(null)}><form className="confirm-dialog prompt-dialog" role="dialog" aria-modal="true" aria-labelledby="prompt-title" onSubmit={(event) => { event.preventDefault(); const result = promptValue.trim(); if (result) closePrompt(result); }} onMouseDown={(event) => event.stopPropagation()}><div className="dialog-icon"><Icon name="edit"/></div><div><h2 id="prompt-title">{promptRequest.title}</h2>{promptRequest.description ? <p>{promptRequest.description}</p> : null}<label className="prompt-field"><span>输入内容</span><input ref={promptRef} value={promptValue} placeholder={promptRequest.placeholder} onChange={(event) => setPromptValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") closePrompt(null); }}/></label></div><div className="dialog-actions"><button ref={promptCancelRef} type="button" className="ui-button secondary" onClick={() => closePrompt(null)}>取消</button><button ref={promptConfirmRef} type="submit" className="ui-button primary" disabled={!promptValue.trim()}>{promptRequest.confirmLabel ?? "确认"}</button></div></form></div> : null}</FeedbackContext.Provider>;
}
function toneIcon(tone: FeedbackTone): IconName { return tone === "success" ? "activity" : tone === "warning" ? "bolt" : tone === "danger" ? "archive" : "settings"; }
export function useFeedback() { const value = useContext(FeedbackContext); if (!value) throw new Error("useFeedback must be used within FeedbackProvider"); return value; }
export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) { return <div className="ui-empty-state"><span className="ui-empty-icon"><Icon name="activity"/></span><strong>{title}</strong><p>{description}</p>{action}</div>; }
export function LoadingState({ label = "正在加载…" }: { label?: string }) { return <div className="ui-loading" role="status"><span className="ui-spinner" aria-hidden="true"/><span>{label}</span></div>; }
