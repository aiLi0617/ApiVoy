import { lazy, Suspense, useEffect, useRef } from "react";
import type { editor } from "monaco-editor";

const MonacoEditor = lazy(() => import("./MonacoEditorImpl"));

export interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  language?: string;
  height?: number | string;
  readOnly?: boolean;
  bare?: boolean;
  wordWrap?: boolean;
  revealLine?: number;
}

export function CodeEditor({ value, onChange, language = "plaintext", height = 180, readOnly = false, bare = false, wordWrap = true, revealLine }: CodeEditorProps) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  useEffect(() => { if (revealLine) { editorRef.current?.revealLineInCenter(revealLine); editorRef.current?.setPosition({ lineNumber: revealLine, column: 1 }); } }, [revealLine]);
  return <div className={bare ? "code-editor code-editor-bare" : "code-editor"} style={{ height, marginTop: bare ? 0 : 6, overflow: "hidden", border: bare ? 0 : "1px solid var(--apivoy-border)", borderRadius: bare ? 0 : 9, background: bare ? "transparent" : "#080c12" }}>
    <Suspense fallback={<textarea value={value} onChange={(event) => onChange(event.target.value)} readOnly={readOnly} style={{ boxSizing: "border-box", width: "100%", height: "100%", resize: "none", border: 0, padding: 12, background: "#080c12", color: "#dccfe8", fontFamily: "monospace" }} />}>
      <MonacoEditor
        height="100%"
        language={language}
        value={value}
        onMount={(editorInstance) => { editorRef.current = editorInstance; }}
        onChange={(next) => onChange(next ?? "")}
        theme="apivoy-dark"
        options={{ automaticLayout: true, minimap: { enabled: false }, wordWrap: wordWrap ? "on" : "off", scrollBeyondLastLine: false, fontSize: 12, lineHeight: 19, tabSize: 2, readOnly, folding: true, showFoldingControls: "always", lineNumbersMinChars: 3, glyphMargin: false, padding: { top: 6, bottom: 10 }, renderLineHighlight: "line", overviewRulerBorder: false, scrollbar: { handleMouseWheel: true, alwaysConsumeMouseWheel: false } }}
      />
    </Suspense>
  </div>;
}
