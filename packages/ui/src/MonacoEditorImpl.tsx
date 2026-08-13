import Editor, { loader, type EditorProps } from "@monaco-editor/react";
import * as monaco from "monaco-editor/editor/editor.api";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";
import JsonWorker from "monaco-editor/language/json/json.worker?worker";
import TypeScriptWorker from "monaco-editor/language/typescript/ts.worker?worker";
import HtmlWorker from "monaco-editor/language/html/html.worker?worker";
import CssWorker from "monaco-editor/language/css/css.worker?worker";
import "monaco-editor/language/html/monaco.contribution";
import "monaco-editor/language/css/monaco.contribution";
import "monaco-editor/language/json/monaco.contribution";
import "monaco-editor/language/typescript/monaco.contribution";

type MonacoRuntime = typeof globalThis & { MonacoEnvironment?: { getWorker: (_moduleId: string, label: string) => Worker } };
(globalThis as MonacoRuntime).MonacoEnvironment = {
  getWorker: (_moduleId, label) => {
    if (label === "json") return new JsonWorker();
    if (label === "html" || label === "handlebars" || label === "razor") return new HtmlWorker();
    if (label === "css" || label === "scss" || label === "less") return new CssWorker();
    if (label === "typescript" || label === "javascript") return new TypeScriptWorker();
    return new EditorWorker();
  },
};

loader.config({ monaco });

monaco.editor.defineTheme("apivoy-dark", {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "comment", foreground: "6A9955", fontStyle: "italic" },
    { token: "keyword", foreground: "C586C0" },
    { token: "string", foreground: "CE9178" },
    { token: "number", foreground: "B5CEA8" },
    { token: "type", foreground: "4EC9B0" },
    { token: "type.identifier", foreground: "4EC9B0" },
    { token: "identifier", foreground: "DCDCAA" },
    { token: "variable", foreground: "9CDCFE" },
    { token: "attribute.name", foreground: "9CDCFE" },
    { token: "attribute.value", foreground: "CE9178" },
    { token: "delimiter", foreground: "D4D4D4" },
  ],
  colors: {
    "editor.findMatchBackground": "#2F6FBE99",
    "editor.findMatchBorder": "#79B8FF",
    "editor.findMatchHighlightBackground": "#31547A80",
    "editor.findMatchHighlightBorder": "#5688B566",
    "editor.findRangeHighlightBackground": "#27415F55",
  },
});

function registerGeneratedCodeLanguage(id: string, keywords: string[]) {
  if (!monaco.languages.getLanguages().some((language) => language.id === id)) monaco.languages.register({ id });
  monaco.languages.setMonarchTokensProvider(id, {
    keywords,
    tokenizer: {
      root: [
        [/\s+/, "white"],
        [/#.*$/, "comment"],
        [/\/\/.*$/, "comment"],
        [/--[\w-]+/, "keyword"],
        [/-[A-Za-z]\b/, "keyword"],
        [/\$[A-Za-z_]\w*/, "variable"],
        [/[A-Za-z_][\w-]*/, { cases: { "@keywords": "keyword", "@default": "identifier" } }],
        [/\d+(?:\.\d+)?/, "number"],
        [/"/, "string", "@doubleQuotedString"],
        [/'/, "string", "@singleQuotedString"],
        [/[{}()[\],.;:=|&<>]+/, "delimiter"],
      ],
      doubleQuotedString: [[/[^"\\]+/, "string"], [/\\./, "string.escape"], [/"/, "string", "@pop"]],
      singleQuotedString: [[/[^'\\]+/, "string"], [/\\./, "string.escape"], [/'/, "string", "@pop"]],
    },
  });
}

registerGeneratedCodeLanguage("shell", ["curl", "wget", "http", "true", "false", "if", "then", "else", "fi", "for", "do", "done"]);
registerGeneratedCodeLanguage("bat", ["curl", "curl.exe", "set", "if", "else", "for", "call", "echo"]);
registerGeneratedCodeLanguage("powershell", ["Invoke-WebRequest", "param", "function", "if", "else", "foreach", "return", "true", "false"]);
registerGeneratedCodeLanguage("javascript", ["const", "let", "var", "async", "await", "function", "class", "new", "if", "else", "for", "of", "return", "throw", "try", "catch", "true", "false", "null", "undefined"]);
registerGeneratedCodeLanguage("java", ["import", "class", "new", "var", "public", "private", "static", "void", "return", "true", "false", "null"]);
registerGeneratedCodeLanguage("swift", ["import", "var", "let", "try", "await", "func", "return", "true", "false", "nil"]);
registerGeneratedCodeLanguage("go", ["package", "import", "func", "var", "defer", "if", "else", "return", "true", "false", "nil"]);
registerGeneratedCodeLanguage("php", ["php", "echo", "function", "return", "true", "false", "null", "new", "use"]);
registerGeneratedCodeLanguage("python", ["import", "from", "as", "def", "if", "else", "for", "in", "return", "True", "False", "None"]);
registerGeneratedCodeLanguage("http", ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "HTTP"]);
registerGeneratedCodeLanguage("c", ["include", "int", "char", "void", "struct", "return", "if", "else", "NULL"]);
registerGeneratedCodeLanguage("csharp", ["using", "var", "new", "class", "public", "private", "static", "async", "await", "return", "true", "false", "null"]);
registerGeneratedCodeLanguage("objective-c", ["import", "interface", "implementation", "void", "return", "nil", "YES", "NO"]);
registerGeneratedCodeLanguage("ruby", ["require", "def", "end", "if", "else", "do", "return", "true", "false", "nil"]);
registerGeneratedCodeLanguage("dart", ["import", "final", "var", "class", "Future", "async", "await", "return", "true", "false", "null"]);
registerGeneratedCodeLanguage("r", ["library", "function", "if", "else", "for", "in", "return", "TRUE", "FALSE", "NULL"]);

if (!monaco.languages.getLanguages().some((language) => language.id === "graphql")) {
  monaco.languages.register({ id: "graphql" });
  monaco.languages.setMonarchTokensProvider("graphql", { tokenizer: { root: [[/#.*$/, "comment"], [/\b(query|mutation|subscription|fragment|on|true|false|null)\b/, "keyword"], [/\$[A-Za-z_]\w*/, "variable"], [/[A-Za-z_]\w*(?=\s*:)/, "type.identifier"], [/"([^"\\]|\\.)*"/, "string"], [/[{}()!\[\]:=@|]/, "delimiter"]] } });
  monaco.languages.registerCompletionItemProvider("graphql", { provideCompletionItems: (model, position) => ({ suggestions: ["query", "mutation", "subscription", "fragment", "__typename", "__schema", "__type"].map((label) => ({ label, kind: monaco.languages.CompletionItemKind.Keyword, insertText: label, range: { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: model.getWordUntilPosition(position).startColumn, endColumn: model.getWordUntilPosition(position).endColumn } })) }) });
}

if (!monaco.languages.getLanguages().some((language) => language.id === "xml")) {
  monaco.languages.register({ id: "xml" });
  monaco.languages.setMonarchTokensProvider("xml", { tokenizer: { root: [[/<!--/, "comment", "@comment"], [/<\?/, "metatag", "@processing"], [/(<)([\w:.-]+)/, ["delimiter", "tag"], "@tag"], [/(<\/)([\w:.-]+)(\s*>)/, ["delimiter", "tag", "delimiter"]], [/&\w+;/, "string.escape"], [/[^<&]+/, ""]], tag: [[/[\w:.-]+/, "attribute.name"], [/=/, "delimiter"], [/"[^"]*"|'[^']*'/, "attribute.value"], [/\/>/, "delimiter", "@pop"], [/>/, "delimiter", "@pop"]], comment: [[/-->/, "comment", "@pop"], [/./, "comment"]], processing: [[/\?>/, "metatag", "@pop"], [/./, "metatag"]] } });
}

export default function MonacoEditorImpl(props: EditorProps) {
  return <Editor {...props} />;
}
