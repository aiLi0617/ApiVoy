import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { Icon, type IconName } from "./Icons";
import { Button } from "./Components";
import { ModalFrame } from "./ModalFrame";

export { EmptyState, LoadingState } from "./Components";

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
  const promptRef = useRef<HTMLInputElement>(null);
  const notify = useCallback((message: string, tone: FeedbackTone = "info") => { const id = ++toastId; setToasts((items) => [...items, { id, message, tone }].slice(-4)); window.setTimeout(() => setToasts((items) => items.filter((item) => item.id !== id)), 4200); }, []);
  const confirm = useCallback((options: ConfirmOptions) => new Promise<boolean>((resolve) => setConfirmation({ ...options, resolve })), []);
  const prompt = useCallback((options: PromptOptions) => new Promise<string | null>((resolve) => { setPromptValue(options.initialValue ?? ""); setPromptRequest({ ...options, resolve }); }), []);
  const closeConfirmation = useCallback((value: boolean) => { setConfirmation((current) => { current?.resolve(value); return null; }); }, []);
  const closePrompt = useCallback((result: string | null) => { setPromptRequest((current) => { current?.resolve(result); return null; }); }, []);
  const value = useMemo(() => ({ notify, confirm, prompt }), [notify, confirm, prompt]);
  return <FeedbackContext.Provider value={value}>{children}<div className="toast-region" aria-live="polite" aria-label="通知">{toasts.map((toast) => <div className={`toast toast-${toast.tone}`} key={toast.id} role={toast.tone === "danger" ? "alert" : "status"}><Icon name={toneIcon(toast.tone)}/><span>{toast.message}</span><button aria-label="关闭通知" onClick={() => setToasts((items) => items.filter((item) => item.id !== toast.id))}><Icon name="close"/></button></div>)}</div>{confirmation ? <ModalFrame open onClose={() => closeConfirmation(false)} closeOnBackdrop={confirmation.tone !== "danger"} className="confirm-dialog" role="alertdialog" ariaLabelledBy="confirm-title" ariaDescribedBy="confirm-description" initialFocusRef={cancelRef}><div className={`dialog-icon dialog-${confirmation.tone ?? "default"}`}><Icon name={confirmation.tone === "danger" ? "trash" : "settings"}/></div><div><h2 id="confirm-title">{confirmation.title}</h2><p id="confirm-description">{confirmation.description}</p></div><div className="dialog-actions"><Button ref={cancelRef} variant="secondary" onClick={() => closeConfirmation(false)}>取消</Button><Button variant={confirmation.tone === "danger" ? "danger" : "primary"} onClick={() => closeConfirmation(true)}>{confirmation.confirmLabel ?? "确认"}</Button></div></ModalFrame> : null}{promptRequest ? <ModalFrame open onClose={() => closePrompt(null)} className="confirm-dialog prompt-dialog" ariaLabelledBy="prompt-title" initialFocusRef={promptRef} as="form" onSubmit={(event) => { event.preventDefault(); const result = promptValue.trim(); if (result) closePrompt(result); }}><div className="dialog-icon"><Icon name="edit"/></div><div><h2 id="prompt-title">{promptRequest.title}</h2>{promptRequest.description ? <p>{promptRequest.description}</p> : null}<label className="prompt-field"><span>输入内容</span><input ref={promptRef} value={promptValue} placeholder={promptRequest.placeholder} onChange={(event) => setPromptValue(event.target.value)}/></label></div><div className="dialog-actions"><Button variant="secondary" onClick={() => closePrompt(null)}>取消</Button><Button type="submit" variant="primary" disabled={!promptValue.trim()}>{promptRequest.confirmLabel ?? "确认"}</Button></div></ModalFrame> : null}</FeedbackContext.Provider>;
}
function toneIcon(tone: FeedbackTone): IconName { return tone === "success" ? "activity" : tone === "warning" ? "bolt" : tone === "danger" ? "archive" : "settings"; }
export function useFeedback() { const value = useContext(FeedbackContext); if (!value) throw new Error("useFeedback must be used within FeedbackProvider"); return value; }
