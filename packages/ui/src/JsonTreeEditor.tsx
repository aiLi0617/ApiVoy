import { Icon } from "./Icons";

export type JsonTreeValue =
  | string
  | number
  | boolean
  | null
  | JsonTreeValue[]
  | { [key: string]: JsonTreeValue };

export type JsonTreeValueType =
  | "string"
  | "number"
  | "boolean"
  | "null"
  | "object"
  | "array";

type JsonPath = Array<string | number>;

const JSON_TREE_TYPES: JsonTreeValueType[] = [
  "string",
  "number",
  "boolean",
  "null",
  "object",
  "array",
];

export function parseJsonTreeSource(source: string):
  | { ok: true; value: JsonTreeValue }
  | { ok: false; message: string } {
  try {
    const value = JSON.parse(source || "{}") as unknown;
    if (value === undefined) return { ok: false, message: "JSON 内容为空" };
    return { ok: true, value: value as JsonTreeValue };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "JSON 格式无效",
    };
  }
}

export function jsonTreeValueType(value: JsonTreeValue): JsonTreeValueType {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return "object";
  return typeof value as "string" | "number" | "boolean";
}

export function defaultJsonTreeValue(type: JsonTreeValueType): JsonTreeValue {
  if (type === "array") return [""];
  if (type === "object") return {};
  if (type === "number") return 0;
  if (type === "boolean") return false;
  if (type === "null") return null;
  return "";
}

export function updateJsonTreeValue(
  root: JsonTreeValue,
  path: JsonPath,
  value: JsonTreeValue,
): JsonTreeValue {
  if (!path.length) return value;
  const [segment, ...rest] = path;
  if (Array.isArray(root)) {
    const next = [...root];
    next[Number(segment)] = updateJsonTreeValue(next[Number(segment)], rest, value);
    return next;
  }
  const object = root as Record<string, JsonTreeValue>;
  return {
    ...object,
    [String(segment)]: updateJsonTreeValue(object[String(segment)], rest, value),
  };
}

export function removeJsonTreeValue(
  root: JsonTreeValue,
  path: JsonPath,
): JsonTreeValue {
  if (!path.length) return {};
  const [segment, ...rest] = path;
  if (Array.isArray(root)) {
    if (!rest.length) return root.filter((_, index) => index !== Number(segment));
    const next = [...root];
    next[Number(segment)] = removeJsonTreeValue(next[Number(segment)], rest);
    return next;
  }
  const object = root as Record<string, JsonTreeValue>;
  if (!rest.length)
    return Object.fromEntries(
      Object.entries(object).filter(([key]) => key !== String(segment)),
    );
  return {
    ...object,
    [String(segment)]: removeJsonTreeValue(object[String(segment)], rest),
  };
}

function uniquePropertyName(value: Record<string, JsonTreeValue>) {
  let suffix = 1;
  let name = "field";
  while (Object.hasOwn(value, name)) name = `field${++suffix}`;
  return name;
}

function renameObjectProperty(
  root: JsonTreeValue,
  parentPath: JsonPath,
  previous: string,
  nextName: string,
) {
  const parent = valueAtPath(root, parentPath) as Record<string, JsonTreeValue>;
  if (!nextName || nextName === previous || Object.hasOwn(parent, nextName)) return root;
  const renamed = Object.fromEntries(
    Object.entries(parent).map(([key, value]) =>
      key === previous ? [nextName, value] : [key, value],
    ),
  );
  return updateJsonTreeValue(root, parentPath, renamed);
}

function valueAtPath(root: JsonTreeValue, path: JsonPath): JsonTreeValue {
  return path.reduce<JsonTreeValue>(
    (current, segment) =>
      Array.isArray(current)
        ? current[Number(segment)]
        : (current as Record<string, JsonTreeValue>)[String(segment)],
    root,
  );
}

interface JsonTreeRow {
  path: JsonPath;
  parentPath: JsonPath;
  key: string | number;
  value: JsonTreeValue;
  depth: number;
  parentType?: "object" | "array";
}

function flattenJsonTree(value: JsonTreeValue): JsonTreeRow[] {
  const rows: JsonTreeRow[] = [
    { path: [], parentPath: [], key: "$", value, depth: 0 },
  ];
  const append = (parent: JsonTreeValue, parentPath: JsonPath, depth: number) => {
    const entries = Array.isArray(parent)
      ? parent.map((item, index) => [index, item] as const)
      : typeof parent === "object" && parent !== null
        ? Object.entries(parent)
        : [];
    for (const [key, child] of entries) {
      const path = [...parentPath, key];
      rows.push({
        path,
        parentPath,
        key,
        value: child,
        depth,
        parentType: Array.isArray(parent) ? "array" : "object",
      });
      append(child, path, depth + 1);
    }
  };
  append(value, [], 1);
  return rows;
}

export function JsonTreeEditor({
  value,
  onChange,
  disabled = false,
}: {
  value: JsonTreeValue;
  onChange: (value: JsonTreeValue) => void;
  disabled?: boolean;
}) {
  const rows = flattenJsonTree(value);

  const addChild = (row: JsonTreeRow) => {
    if (Array.isArray(row.value)) {
      onChange(updateJsonTreeValue(value, row.path, [...row.value, ""]));
      return;
    }
    const object = row.value as Record<string, JsonTreeValue>;
    onChange(
      updateJsonTreeValue(value, row.path, {
        ...object,
        [uniquePropertyName(object)]: "",
      }),
    );
  };

  return (
    <div className="http-json-tree" aria-label="JSON 结构化编辑器">
      <div className="http-json-tree-header" aria-hidden="true">
        <span>字段</span>
        <span>值</span>
        <span>类型</span>
        <span>操作</span>
      </div>
      {rows.map((row) => {
        const type = jsonTreeValueType(row.value);
        const structured = type === "object" || type === "array";
        return (
          <div className="http-json-tree-row" key={JSON.stringify(row.path)}>
            <div
              className="http-json-tree-name"
              style={{ paddingLeft: `${row.depth * 18 + 8}px` }}
            >
              {row.depth ? <span aria-hidden="true" /> : null}
              {row.parentType === "object" ? (
                <input
                  aria-label={`${String(row.key)} 字段名称`}
                  defaultValue={String(row.key)}
                  disabled={disabled}
                  onBlur={(event) =>
                    onChange(
                      renameObjectProperty(
                        value,
                        row.parentPath,
                        String(row.key),
                        event.target.value.trim(),
                      ),
                    )
                  }
                />
              ) : (
                <code>{row.parentType === "array" ? `[${row.key}]` : "$"}</code>
              )}
            </div>
            <div className="http-json-tree-value">
              {type === "boolean" ? (
                <select
                  aria-label={`${String(row.key)} 的值`}
                  value={String(row.value)}
                  disabled={disabled}
                  onChange={(event) =>
                    onChange(
                      updateJsonTreeValue(
                        value,
                        row.path,
                        event.target.value === "true",
                      ),
                    )
                  }
                >
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              ) : !structured && type !== "null" ? (
                <input
                  aria-label={`${String(row.key)} 的值`}
                  value={String(row.value)}
                  disabled={disabled}
                  type={type === "number" ? "number" : "text"}
                  onChange={(event) =>
                    onChange(
                      updateJsonTreeValue(
                        value,
                        row.path,
                        type === "number"
                          ? Number(event.target.value)
                          : event.target.value,
                      ),
                    )
                  }
                />
              ) : (
                <span className="http-json-tree-summary">
                  {Array.isArray(row.value)
                    ? `${row.value.length} 个元素`
                    : row.value !== null && typeof row.value === "object"
                      ? `${Object.keys(row.value).length} 个字段`
                      : "null"}
                </span>
              )}
            </div>
            <select
              className="http-json-tree-type"
              aria-label={`${String(row.key)} 类型`}
              value={type}
              disabled={disabled}
              onChange={(event) =>
                onChange(
                  updateJsonTreeValue(
                    value,
                    row.path,
                    defaultJsonTreeValue(event.target.value as JsonTreeValueType),
                  ),
                )
              }
            >
              {JSON_TREE_TYPES.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
            <div className="http-json-tree-actions">
              {structured ? (
                <button
                  type="button"
                  className="ui-icon-button compact"
                  aria-label={type === "object" ? "添加子字段" : "添加数组元素"}
                  title={type === "object" ? "添加子字段" : "添加数组元素"}
                  disabled={disabled}
                  onClick={() => addChild(row)}
                >
                  <Icon name="plus" />
                </button>
              ) : null}
              {row.path.length ? (
                <button
                  type="button"
                  className="ui-icon-button compact"
                  aria-label={`删除 ${String(row.key)}`}
                  title="删除节点"
                  disabled={disabled}
                  onClick={() => onChange(removeJsonTreeValue(value, row.path))}
                >
                  <Icon name="trash" />
                </button>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
