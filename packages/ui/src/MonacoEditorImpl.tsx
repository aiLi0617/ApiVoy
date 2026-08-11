import Editor, { loader, type EditorProps } from "@monaco-editor/react";
import * as monaco from "monaco-editor/editor/editor.api";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";
import JsonWorker from "monaco-editor/language/json/json.worker?worker";
import TypeScriptWorker from "monaco-editor/language/typescript/ts.worker?worker";
import "monaco-editor/language/json/monaco.contribution";
import "monaco-editor/language/typescript/monaco.contribution";

type MonacoRuntime = typeof globalThis & { MonacoEnvironment?: { getWorker: (_moduleId: string, label: string) => Worker } };
(globalThis as MonacoRuntime).MonacoEnvironment = {
  getWorker: (_moduleId, label) => {
    if (label === "json") return new JsonWorker();
    if (label === "typescript" || label === "javascript") return new TypeScriptWorker();
    return new EditorWorker();
  },
};

loader.config({ monaco });

if (!monaco.languages.getLanguages().some((language) => language.id === "graphql")) {
  monaco.languages.register({ id: "graphql" });
  monaco.languages.setMonarchTokensProvider("graphql", { tokenizer: { root: [[/#.*$/, "comment"], [/\b(query|mutation|subscription|fragment|on|true|false|null)\b/, "keyword"], [/\$[A-Za-z_]\w*/, "variable"], [/[A-Za-z_]\w*(?=\s*:)/, "type.identifier"], [/"([^"\\]|\\.)*"/, "string"], [/[{}()!\[\]:=@|]/, "delimiter"]] } });
  monaco.languages.registerCompletionItemProvider("graphql", { provideCompletionItems: (model, position) => ({ suggestions: ["query", "mutation", "subscription", "fragment", "__typename", "__schema", "__type"].map((label) => ({ label, kind: monaco.languages.CompletionItemKind.Keyword, insertText: label, range: { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: model.getWordUntilPosition(position).startColumn, endColumn: model.getWordUntilPosition(position).endColumn } })) }) });
}

export default function MonacoEditorImpl(props: EditorProps) {
  return <Editor {...props} />;
}
