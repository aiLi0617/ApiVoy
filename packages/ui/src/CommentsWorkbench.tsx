import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, LoadingState, useFeedback } from "./Feedback";
import { Button, IconButton, StatusBadge, Textarea, TextInput } from "./Components";
import { getCollaborationUrl, subscribePreferences } from "./userPreferences";

type Auth = { token: string; organizationId: string; role: string; user: { id: string; displayName: string } };
type Comment = { id: string; workspaceId: string; actorId: string; actorName: string; parentId: string | null; body: string; resolvedAt: string | null; resolvedBy: string | null; createdAt: string; updatedAt: string };

export interface CommentsWorkbenchProps {
  contextCollectionId?: string | null;
  contextRequestId?: string | null;
  contextLabel?: string | null;
}

export function CommentsWorkbench({ contextCollectionId, contextRequestId, contextLabel }: CommentsWorkbenchProps = {}) {
  const { prompt, notify } = useFeedback();
  const [auth, setAuth] = useState<Auth | null>(() => readAuth());
  const [baseUrl, setBaseUrl] = useState(() => getCollaborationUrl());
  const derivedWorkspace = contextRequestId ? `request:${contextRequestId}` : contextCollectionId ? `collection:${contextCollectionId}` : "shared-workspace";
  const [workspaceId, setWorkspaceId] = useState(derivedWorkspace);
  const [comments, setComments] = useState<Comment[]>([]);
  const [body, setBody] = useState("");
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const canResolve = auth ? ["OWNER", "ADMIN", "EDITOR"].includes(auth.role) : false;

  useEffect(() => { setWorkspaceId(derivedWorkspace); }, [derivedWorkspace]);
  useEffect(() => {
    const sync = () => { setAuth(readAuth()); setBaseUrl(getCollaborationUrl()); };
    const unsub = subscribePreferences((keys) => { if (keys.length === 0 || keys.includes("collaborationUrl")) sync(); });
    window.addEventListener("focus", sync);
    return () => { unsub(); window.removeEventListener("focus", sync); };
  }, []);
  const request = useCallback(async <T,>(path: string, init?: RequestInit): Promise<T> => {
    if (!auth) throw new Error("请先在账户与协作中登录团队空间");
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}${path}`, { ...init, headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth.token}`, ...(init?.headers ?? {}) } });
    const text = await response.text(); const payload = text ? JSON.parse(text) : undefined;
    if (!response.ok) throw new Error(payload?.message ?? payload?.detail ?? `HTTP ${response.status}`);
    return payload as T;
  }, [auth, baseUrl]);
  const path = useMemo(() => auth ? `/v1/organizations/${auth.organizationId}/workspaces/${encodeURIComponent(workspaceId)}/comments` : "", [auth, workspaceId]);
  const refresh = useCallback(async () => { if (!auth || !workspaceId.trim()) return; setLoading(true); try { setComments(await request<Comment[]>(path)); setMessage(""); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } finally { setLoading(false); } }, [auth, workspaceId, request, path]);
  useEffect(() => { void refresh(); }, [refresh]);

  async function submit() { if (!body.trim()) return; try { await request(path, { method: "POST", body: JSON.stringify({ parentId: replyTo?.id ?? null, body }) }); setBody(""); setReplyTo(null); await refresh(); setMessage("评论已发布"); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } }
  async function toggle(comment: Comment) { try { await request(`${path}/${comment.id}/resolution`, { method: "PATCH", body: JSON.stringify({ resolved: !comment.resolvedAt }) }); await refresh(); notify("评论已更新", "success"); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } }
  async function edit(comment: Comment) { const next = await prompt({ title: "编辑评论", initialValue: comment.body }); if (!next?.trim() || next === comment.body) return; try { await request(`${path}/${comment.id}`, { method: "PATCH", body: JSON.stringify({ body: next }) }); await refresh(); notify("评论已更新", "success"); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } }
  const roots = comments.filter(comment => !comment.parentId);

  if (!auth) {
    return <EmptyState title="需要登录团队空间" description="评论挂在当前选中的集合/请求上下文。请先在账户与协作中登录。" action={<Button variant="primary" onClick={() => window.dispatchEvent(new CustomEvent("apivoy-collaboration-tab", { detail: "team" }))}>前往团队登录</Button>} />;
  }
  return <section className="comments-workbench">
    <header className="comments-header"><div><h2>工作区评论</h2><p>{contextLabel ? `当前上下文：${contextLabel}` : "围绕当前集合/请求进行异步评审。"}</p></div><StatusBadge tone="success">{comments.filter(c => !c.resolvedAt && !c.parentId).length} OPEN</StatusBadge></header>
    <div className="comments-toolbar"><label className="comments-context-field"><span>上下文 ID</span><TextInput value={workspaceId} onChange={event => setWorkspaceId(event.target.value)} /><small>默认绑定选中集合/请求；可手动覆盖</small></label><Button variant="ghost" onClick={() => void refresh()} disabled={loading}>{loading ? "同步中…" : "刷新讨论"}</Button></div>
    {loading && comments.length === 0 ? <LoadingState label="加载评论…" /> : null}
    <div className="comments-composer">{replyTo && <div className="comments-reply-banner">回复 {replyTo.actorName}<IconButton label="关闭回复上下文" icon="close" className="compact" onClick={() => setReplyTo(null)} /></div>}<Textarea value={body} onChange={event => setBody(event.target.value)} placeholder={replyTo ? "写下你的回复…" : "提出问题、记录结论或请求评审…"} /><div className="comments-composer-footer"><span>{body.length} / 4000</span><Button variant="primary" disabled={!body.trim() || body.length > 4000} onClick={() => void submit()}>发布{replyTo ? "回复" : "主题"}</Button></div></div>
    <div className="comments-list">{roots.length === 0 && !loading && <EmptyState title="还没有讨论" description="发起第一条评审主题吧。" />}{roots.map(root => <article key={root.id} className={`comments-thread${root.resolvedAt ? " is-resolved" : ""}`}><CommentCard comment={root} currentUserId={auth.user.id} canResolve={canResolve} onReply={setReplyTo} onEdit={edit} onToggle={toggle} />{comments.filter(item => item.parentId === root.id).map(reply => <div key={reply.id} className="comments-reply"><CommentCard comment={reply} currentUserId={auth.user.id} canResolve={false} onReply={setReplyTo} onEdit={edit} onToggle={toggle} /></div>)}</article>)}</div>
    {message && <div role="status" aria-live="polite" className="comments-notice">{message}</div>}
  </section>;
}

function CommentCard({ comment, currentUserId, canResolve, onReply, onEdit, onToggle }: { comment: Comment; currentUserId: string; canResolve: boolean; onReply: (value: Comment) => void; onEdit: (value: Comment) => void; onToggle: (value: Comment) => void }) {
  return <div className="comment-card"><div className="comment-avatar">{comment.actorName.slice(0, 1).toUpperCase()}</div><div className="comment-content"><div className="comment-meta"><b>{comment.actorName}</b><time>{new Date(comment.createdAt).toLocaleString()}</time>{comment.updatedAt !== comment.createdAt && <span>已编辑</span>}{comment.resolvedAt && <span className="comment-resolved-badge">RESOLVED</span>}</div><p>{comment.body}</p><div className="comment-actions"><button onClick={() => onReply(comment)}>回复</button>{comment.actorId === currentUserId && <button onClick={() => void onEdit(comment)}>编辑</button>}{canResolve && <button onClick={() => void onToggle(comment)}>{comment.resolvedAt ? "重新打开" : "标记解决"}</button>}</div></div></div>;
}

function readAuth(): Auth | null { try { return JSON.parse(localStorage.getItem("apivoy:collaboration-auth") ?? "null") as Auth | null; } catch { return null; } }
