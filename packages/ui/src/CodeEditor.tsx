import { lazy, Suspense } from "react";

const MonacoEditor = lazy(() => import("./MonacoEditorImpl"));

export interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  language?: string;
  height?: number;
  readOnly?: boolean;
}

export function CodeEditor({ value, onChange, language = "plaintext", height = 180, readOnly = false }: CodeEditorProps) {
  return <div style={{ height, marginTop: 6, overflow: "hidden", border: "1px solid var(--apivoy-border)", borderRadius: 9, background: "#080c12" }}>
    <Suspense fallback={<textarea value={value} onChange={(event) => onChange(event.target.value)} readOnly={readOnly} style={{ boxSizing: "border-box", width: "100%", height: "100%", resize: "none", border: 0, padding: 12, background: "#080c12", color: "#dccfe8", fontFamily: "monospace" }} />}>
      <MonacoEditor
        height="100%"
        language={language}
        value={value}
        onChange={(next) => onChange(next ?? "")}
        theme="vs-dark"
        options={{ automaticLayout: true, minimap: { enabled: false }, wordWrap: "on", scrollBeyondLastLine: false, fontSize: 12, lineHeight: 19, tabSize: 2, readOnly, padding: { top: 10, bottom: 10 }, renderLineHighlight: "line", overviewRulerBorder: false }}
      />
    </Suspense>
  </div>;
}
