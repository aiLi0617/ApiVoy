import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { EmptyState, LoadingState, useFeedback } from "./Feedback";
import { Icon } from "./Icons";
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
    return <EmptyState title="需要登录团队空间" description="评论挂在当前选中的集合/请求上下文。请先在账户与协作中登录。" action={<button className="ui-button primary" type="button" onClick={() => window.dispatchEvent(new CustomEvent("apivoy-collaboration-tab", { detail: "team" }))}>前往团队登录</button>} />;
  }
  return <section style={styles.root}>
    <header style={styles.header}><div><h2 style={styles.title}>工作区评论</h2><p style={styles.muted}>{contextLabel ? `当前上下文：${contextLabel}` : "围绕当前集合/请求进行异步评审。"}</p></div><span style={styles.badge}>{comments.filter(c => !c.resolvedAt && !c.parentId).length} OPEN</span></header>
    <div style={styles.toolbar}><label style={styles.field}><span>上下文 ID</span><input style={styles.input} value={workspaceId} onChange={event => setWorkspaceId(event.target.value)} /><small style={styles.hint}>默认绑定选中集合/请求；可手动覆盖</small></label><button style={styles.ghost} onClick={() => void refresh()} disabled={loading}>{loading ? "同步中…" : "刷新讨论"}</button></div>
    {loading && comments.length === 0 ? <LoadingState label="加载评论…" /> : null}
    <div style={styles.composer}>{replyTo && <div style={styles.replyBanner}>回复 {replyTo.actorName}<button style={styles.close} onClick={() => setReplyTo(null)} aria-label="关闭回复上下文"><Icon name="close" /></button></div>}<textarea style={styles.textarea} value={body} onChange={event => setBody(event.target.value)} placeholder={replyTo ? "写下你的回复…" : "提出问题、记录结论或请求评审…"} /><div style={styles.composerFooter}><span>{body.length} / 4000</span><button style={styles.primary} disabled={!body.trim() || body.length > 4000} onClick={() => void submit()}>发布{replyTo ? "回复" : "主题"}</button></div></div>
    <div style={styles.list}>{roots.length === 0 && !loading && <EmptyState title="还没有讨论" description="发起第一条评审主题吧。" />}{roots.map(root => <article key={root.id} style={{...styles.thread, ...(root.resolvedAt ? styles.resolved : {})}}><CommentCard comment={root} currentUserId={auth.user.id} canResolve={canResolve} onReply={setReplyTo} onEdit={edit} onToggle={toggle} />{comments.filter(item => item.parentId === root.id).map(reply => <div key={reply.id} style={styles.reply}><CommentCard comment={reply} currentUserId={auth.user.id} canResolve={false} onReply={setReplyTo} onEdit={edit} onToggle={toggle} /></div>)}</article>)}</div>
    {message && <div role="status" aria-live="polite" style={styles.notice}>{message}</div>}
  </section>;
}

function CommentCard({ comment, currentUserId, canResolve, onReply, onEdit, onToggle }: { comment: Comment; currentUserId: string; canResolve: boolean; onReply: (value: Comment) => void; onEdit: (value: Comment) => void; onToggle: (value: Comment) => void }) {
  return <div style={styles.comment}><div style={styles.avatar}>{comment.actorName.slice(0, 1).toUpperCase()}</div><div style={styles.content}><div style={styles.meta}><b>{comment.actorName}</b><time>{new Date(comment.createdAt).toLocaleString()}</time>{comment.updatedAt !== comment.createdAt && <span>已编辑</span>}{comment.resolvedAt && <span style={styles.resolvedBadge}>RESOLVED</span>}</div><p style={styles.body}>{comment.body}</p><div style={styles.actions}><button onClick={() => onReply(comment)}>回复</button>{comment.actorId === currentUserId && <button onClick={() => void onEdit(comment)}>编辑</button>}{canResolve && <button onClick={() => void onToggle(comment)}>{comment.resolvedAt ? "重新打开" : "标记解决"}</button>}</div></div></div>;
}

function readAuth(): Auth | null { try { return JSON.parse(localStorage.getItem("apivoy:collaboration-auth") ?? "null") as Auth | null; } catch { return null; } }

const styles: Record<string, CSSProperties> = {
  root:{display:"grid",gap:12},header:{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:20},title:{fontSize:18,letterSpacing:-.4,margin:"0 0 6px"},muted:{color:"var(--apivoy-muted)",lineHeight:1.55,maxWidth:650,margin:0},badge:{fontSize:10,letterSpacing:1.4,color:"#79ddb7",border:"1px solid rgba(73,207,158,.35)",background:"rgba(73,207,158,.09)",padding:"7px 11px",borderRadius:999,fontWeight:800},toolbar:{display:"flex",alignItems:"flex-end",gap:10},field:{display:"grid",gap:6,flex:1,color:"var(--apivoy-muted)",fontSize:10,fontWeight:750,letterSpacing:1},hint:{fontWeight:500,letterSpacing:0,textTransform:"none"},input:{width:"100%",border:"1px solid var(--apivoy-border)",borderRadius:9,background:"var(--apivoy-bg-elevated)",color:"var(--apivoy-text)",padding:"10px 12px",outline:"none"},ghost:{border:"1px solid var(--apivoy-border)",borderRadius:8,background:"transparent",color:"var(--apivoy-muted)",padding:"8px 11px",cursor:"pointer"},composer:{border:"1px solid var(--apivoy-border)",borderRadius:10,background:"var(--apivoy-bg-elevated)",padding:12,display:"grid",gap:8},replyBanner:{display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:12,color:"var(--apivoy-accent)"},close:{border:0,background:"transparent",color:"var(--apivoy-muted)"},textarea:{width:"100%",minHeight:88,resize:"vertical",border:"1px solid var(--apivoy-border)",borderRadius:8,background:"var(--apivoy-workspace)",color:"var(--apivoy-text)",padding:10},composerFooter:{display:"flex",justifyContent:"space-between",alignItems:"center"},primary:{border:0,borderRadius:8,background:"var(--apivoy-accent)",color:"#fff",fontWeight:700,padding:"8px 12px",cursor:"pointer"},list:{display:"grid",gap:10},thread:{border:"1px solid var(--apivoy-border)",borderRadius:10,padding:12,background:"var(--apivoy-bg-elevated)"},resolved:{opacity:.72},reply:{marginTop:8,paddingLeft:18,borderLeft:"2px solid var(--apivoy-border)"},comment:{display:"grid",gridTemplateColumns:"34px 1fr",gap:10},avatar:{width:32,height:32,borderRadius:9,display:"grid",placeItems:"center",background:"var(--apivoy-accent-soft)",color:"var(--apivoy-accent)",fontWeight:800},content:{display:"grid",gap:6},meta:{display:"flex",gap:8,alignItems:"center",fontSize:11,color:"var(--apivoy-muted)"},body:{margin:0,whiteSpace:"pre-wrap",lineHeight:1.55},actions:{display:"flex",gap:8},resolvedBadge:{color:"var(--apivoy-success)"},notice:{borderLeft:"3px solid var(--apivoy-accent)",background:"var(--apivoy-accent-soft)",padding:"8px 11px",fontSize:12}
};
