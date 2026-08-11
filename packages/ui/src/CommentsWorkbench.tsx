import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { defaultCollaborationUrl } from "./runtimeConfig";

type Auth = { token: string; organizationId: string; role: string; user: { id: string; displayName: string } };
type Comment = { id: string; workspaceId: string; actorId: string; actorName: string; parentId: string | null; body: string; resolvedAt: string | null; resolvedBy: string | null; createdAt: string; updatedAt: string };

export function CommentsWorkbench() {
  const [auth, setAuth] = useState<Auth | null>(() => readAuth());
  const [baseUrl, setBaseUrl] = useState(() => localStorage.getItem("apivoy:collaboration-url") ?? defaultCollaborationUrl());
  const [workspaceId, setWorkspaceId] = useState("shared-workspace");
  const [comments, setComments] = useState<Comment[]>([]);
  const [body, setBody] = useState("");
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const canResolve = auth ? ["OWNER", "ADMIN", "EDITOR"].includes(auth.role) : false;

  useEffect(() => { const sync = () => { setAuth(readAuth()); setBaseUrl(localStorage.getItem("apivoy:collaboration-url") ?? defaultCollaborationUrl()); }; window.addEventListener("storage", sync); window.addEventListener("focus", sync); return () => { window.removeEventListener("storage", sync); window.removeEventListener("focus", sync); }; }, []);
  const request = useCallback(async <T,>(path: string, init?: RequestInit): Promise<T> => {
    if (!auth) throw new Error("请先在 Team 页签登录团队空间");
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}${path}`, { ...init, headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth.token}`, ...(init?.headers ?? {}) } });
    const text = await response.text(); const payload = text ? JSON.parse(text) : undefined;
    if (!response.ok) throw new Error(payload?.message ?? payload?.detail ?? `HTTP ${response.status}`);
    return payload as T;
  }, [auth, baseUrl]);
  const path = useMemo(() => auth ? `/v1/organizations/${auth.organizationId}/workspaces/${encodeURIComponent(workspaceId)}/comments` : "", [auth, workspaceId]);
  const refresh = useCallback(async () => { if (!auth || !workspaceId.trim()) return; setLoading(true); try { setComments(await request<Comment[]>(path)); setMessage(""); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } finally { setLoading(false); } }, [auth, workspaceId, request, path]);
  useEffect(() => { void refresh(); }, [refresh]);

  async function submit() { if (!body.trim()) return; try { await request(path, { method: "POST", body: JSON.stringify({ parentId: replyTo?.id ?? null, body }) }); setBody(""); setReplyTo(null); await refresh(); setMessage("评论已发布"); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } }
  async function toggle(comment: Comment) { try { await request(`${path}/${comment.id}/resolution`, { method: "PATCH", body: JSON.stringify({ resolved: !comment.resolvedAt }) }); await refresh(); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } }
  async function edit(comment: Comment) { const next = window.prompt("编辑评论", comment.body); if (!next?.trim() || next === comment.body) return; try { await request(`${path}/${comment.id}`, { method: "PATCH", body: JSON.stringify({ body: next }) }); await refresh(); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } }
  const roots = comments.filter(comment => !comment.parentId);

  if (!auth) return <section style={styles.root}><div style={styles.emptyIcon}>◎</div><small style={styles.eyebrow}>COLLABORATIVE REVIEW</small><h2 style={styles.title}>让讨论留在工作区上下文里</h2><p style={styles.muted}>请先前往 Team 页签登录。登录后可在这里发起主题、回复成员并跟踪解决状态。</p></section>;
  return <section style={styles.root}>
    <header style={styles.header}><div><small style={styles.eyebrow}>COLLABORATIVE REVIEW</small><h2 style={styles.title}>工作区评论</h2><p style={styles.muted}>围绕共享工作区进行异步评审，所有操作都会写入审计日志。</p></div><span style={styles.badge}>{comments.filter(c => !c.resolvedAt && !c.parentId).length} OPEN</span></header>
    <div style={styles.toolbar}><label style={styles.field}><span>WORKSPACE ID</span><input style={styles.input} value={workspaceId} onChange={event => setWorkspaceId(event.target.value)} /></label><button style={styles.ghost} onClick={() => void refresh()} disabled={loading}>{loading ? "同步中…" : "刷新讨论"}</button></div>
    <div style={styles.composer}>{replyTo && <div style={styles.replyBanner}>回复 {replyTo.actorName}<button style={styles.close} onClick={() => setReplyTo(null)}>×</button></div>}<textarea style={styles.textarea} value={body} onChange={event => setBody(event.target.value)} placeholder={replyTo ? "写下你的回复…" : "提出问题、记录结论或请求评审…"} /><div style={styles.composerFooter}><span>{body.length} / 4000</span><button style={styles.primary} disabled={!body.trim() || body.length > 4000} onClick={() => void submit()}>发布{replyTo ? "回复" : "主题"}</button></div></div>
    <div style={styles.list}>{roots.length === 0 && !loading && <div style={styles.blank}>这个工作区还没有讨论。发起第一条评审主题吧。</div>}{roots.map(root => <article key={root.id} style={{...styles.thread, ...(root.resolvedAt ? styles.resolved : {})}}><CommentCard comment={root} currentUserId={auth.user.id} canResolve={canResolve} onReply={setReplyTo} onEdit={edit} onToggle={toggle} />{comments.filter(item => item.parentId === root.id).map(reply => <div key={reply.id} style={styles.reply}><CommentCard comment={reply} currentUserId={auth.user.id} canResolve={false} onReply={setReplyTo} onEdit={edit} onToggle={toggle} /></div>)}</article>)}</div>
    {message && <div style={styles.notice}>{message}</div>}
  </section>;
}

function CommentCard({ comment, currentUserId, canResolve, onReply, onEdit, onToggle }: { comment: Comment; currentUserId: string; canResolve: boolean; onReply: (value: Comment) => void; onEdit: (value: Comment) => void; onToggle: (value: Comment) => void }) {
  return <div style={styles.comment}><div style={styles.avatar}>{comment.actorName.slice(0, 1).toUpperCase()}</div><div style={styles.content}><div style={styles.meta}><b>{comment.actorName}</b><time>{new Date(comment.createdAt).toLocaleString()}</time>{comment.updatedAt !== comment.createdAt && <span>已编辑</span>}{comment.resolvedAt && <span style={styles.resolvedBadge}>RESOLVED</span>}</div><p style={styles.body}>{comment.body}</p><div style={styles.actions}><button onClick={() => onReply(comment)}>回复</button>{comment.actorId === currentUserId && <button onClick={() => void onEdit(comment)}>编辑</button>}{canResolve && <button onClick={() => void onToggle(comment)}>{comment.resolvedAt ? "重新打开" : "标记解决"}</button>}</div></div></div>;
}
function readAuth(): Auth | null { try { return JSON.parse(localStorage.getItem("apivoy:collaboration-auth") ?? "null") as Auth | null; } catch { return null; } }

const styles: Record<string, CSSProperties> = {
  root:{border:"1px solid var(--apivoy-border)",borderRadius:18,background:"radial-gradient(700px 300px at 100% 0,rgba(55,185,147,.09),transparent 58%),linear-gradient(150deg,rgba(18,27,38,.97),rgba(8,13,20,.99))",padding:24,minHeight:520,boxShadow:"0 24px 70px rgba(0,0,0,.22)"},header:{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:20,marginBottom:22},eyebrow:{letterSpacing:2,color:"#6fc6ff",fontSize:10,fontWeight:800},title:{fontSize:26,letterSpacing:-.7,margin:"5px 0 7px"},muted:{color:"var(--apivoy-muted)",lineHeight:1.65,maxWidth:650,margin:0},badge:{fontSize:10,letterSpacing:1.4,color:"#79ddb7",border:"1px solid rgba(73,207,158,.35)",background:"rgba(73,207,158,.09)",padding:"7px 11px",borderRadius:999,fontWeight:800},toolbar:{display:"flex",alignItems:"flex-end",gap:10,marginBottom:14},field:{display:"grid",gap:6,flex:1,color:"var(--apivoy-muted)",fontSize:10,fontWeight:750,letterSpacing:1},input:{width:"100%",border:"1px solid var(--apivoy-border)",borderRadius:9,background:"#090f17",color:"var(--apivoy-text)",padding:"10px 12px",outline:"none"},ghost:{border:"1px solid var(--apivoy-border)",borderRadius:9,background:"rgba(255,255,255,.025)",color:"#b8c7d8",padding:"10px 13px",cursor:"pointer"},composer:{border:"1px solid var(--apivoy-border)",borderRadius:13,background:"rgba(5,10,16,.62)",overflow:"hidden",marginBottom:18},replyBanner:{display:"flex",justifyContent:"space-between",padding:"8px 12px",fontSize:11,color:"#9ed6ff",background:"rgba(86,173,245,.08)",borderBottom:"1px solid var(--apivoy-border)"},close:{border:0,background:"transparent",color:"var(--apivoy-muted)",fontSize:17,cursor:"pointer"},textarea:{display:"block",width:"100%",minHeight:92,resize:"vertical",border:0,background:"transparent",color:"var(--apivoy-text)",padding:14,outline:"none",fontFamily:"inherit",lineHeight:1.6},composerFooter:{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"9px 11px",borderTop:"1px solid rgba(255,255,255,.055)",fontSize:10,color:"var(--apivoy-muted)"},primary:{border:0,borderRadius:8,background:"linear-gradient(135deg,#2798ed,#37b993)",color:"white",fontWeight:750,padding:"8px 13px",cursor:"pointer"},list:{display:"grid",gap:11},thread:{border:"1px solid var(--apivoy-border)",borderRadius:13,background:"rgba(5,10,16,.48)",overflow:"hidden"},resolved:{opacity:.7,borderColor:"rgba(73,207,158,.24)"},comment:{display:"grid",gridTemplateColumns:"36px 1fr",gap:11,padding:14},avatar:{width:34,height:34,borderRadius:10,display:"grid",placeItems:"center",background:"linear-gradient(135deg,rgba(86,173,245,.28),rgba(73,207,158,.18))",fontWeight:800,color:"#c9eaff"},content:{minWidth:0},meta:{display:"flex",gap:9,alignItems:"center",fontSize:11},body:{margin:"8px 0",lineHeight:1.65,whiteSpace:"pre-wrap",color:"#dbe8f5"},actions:{display:"flex",gap:5},reply:{marginLeft:46,borderTop:"1px solid rgba(255,255,255,.055)"},resolvedBadge:{color:"#79ddb7",fontSize:9,letterSpacing:1},blank:{border:"1px dashed var(--apivoy-border)",borderRadius:13,padding:40,textAlign:"center",color:"var(--apivoy-muted)"},notice:{marginTop:14,borderLeft:"3px solid var(--apivoy-accent)",background:"rgba(86,173,245,.08)",padding:"10px 13px",fontSize:12},emptyIcon:{fontSize:46,color:"#65c6a5",marginBottom:20}
};
