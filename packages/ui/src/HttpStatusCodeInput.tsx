import { useId, useState } from "react";

export const HTTP_RESPONSE_STATUS_OPTIONS = [
  ["100", "继续"], ["101", "切换协议"], ["102", "处理中"], ["103", "早期提示"],
  ["200", "成功"], ["201", "已创建"], ["202", "已接受"], ["203", "非权威信息"], ["204", "无内容"], ["205", "重置内容"], ["206", "部分内容"], ["207", "多状态"], ["208", "已报告"], ["226", "IM 已使用"],
  ["300", "多种选择"], ["301", "永久移动"], ["302", "临时重定向"], ["303", "参见其他位置"], ["304", "未修改"], ["305", "使用代理"], ["307", "临时重定向"], ["308", "永久重定向"],
  ["400", "请求错误"], ["401", "未授权"], ["402", "需要付款"], ["403", "禁止访问"], ["404", "未找到"], ["405", "方法不允许"], ["406", "不可接受"], ["407", "需要代理认证"], ["408", "请求超时"], ["409", "冲突"], ["410", "已删除"], ["411", "需要长度"], ["412", "前置条件失败"], ["413", "内容过大"], ["414", "URI 过长"], ["415", "不支持的媒体类型"], ["416", "范围不可满足"], ["417", "预期失败"], ["418", "我是茶壶"], ["421", "请求被误导"], ["422", "无法处理的内容"], ["423", "已锁定"], ["424", "依赖失败"], ["425", "过早"], ["426", "需要升级"], ["428", "需要前置条件"], ["429", "请求过多"], ["431", "请求头字段过大"], ["451", "因法律原因不可用"],
  ["500", "服务器内部错误"], ["501", "尚未实现"], ["502", "错误网关"], ["503", "服务不可用"], ["504", "网关超时"], ["505", "HTTP 版本不受支持"], ["506", "变体也参与协商"], ["507", "存储空间不足"], ["508", "检测到循环"], ["510", "未扩展"], ["511", "需要网络认证"],
] as const;

const STATUS_GROUP_LABELS = { "1": "信息", "2": "成功", "3": "重定向", "4": "客户端错误", "5": "服务器错误" } as const;

const HTTP_STATUS_EXPLANATIONS: Record<string, string> = {
  "100": "服务器已收到请求头，客户端可以继续发送请求体。", "101": "服务器同意客户端请求，并将连接切换到指定协议。", "102": "服务器正在处理请求，但暂时还没有最终响应。", "103": "服务器提前返回部分响应头，便于客户端预加载资源。",
  "200": "请求已成功处理，并返回预期结果。", "201": "请求已成功处理，并创建了新的资源。", "202": "请求已被接受，但处理尚未完成。", "204": "请求已成功处理，但响应不包含正文。",
  "301": "资源已永久移动，后续请求应使用新的地址。", "302": "资源暂时位于其他地址，客户端可临时重定向。", "304": "资源没有变化，客户端可以继续使用缓存。",
  "400": "服务器无法理解或处理当前请求。", "401": "请求缺少有效的身份认证信息。", "403": "服务器理解请求，但拒绝执行。", "404": "服务器找不到请求的资源。", "409": "请求与资源的当前状态发生冲突。", "422": "请求格式正确，但内容无法被处理。", "429": "请求过于频繁，客户端应稍后重试。",
  "500": "服务器处理请求时发生了未预期的内部错误。", "502": "网关从上游服务器收到了无效响应。", "503": "服务当前不可用，通常是临时过载或维护。", "504": "网关等待上游服务器响应超时。",
};

function httpStatusClassExplanation(group: string) {
  return group === "1" ? "1XX 信息响应：请求已收到，服务器将继续处理。" : group === "2" ? "2XX 成功响应：请求已被服务器成功接收和处理。" : group === "3" ? "3XX 重定向响应：客户端需要采取进一步操作。" : group === "4" ? "4XX 客户端错误：请求本身存在问题或无权访问。" : "5XX 服务器错误：服务器处理有效请求时发生错误。";
}

function httpStatusExplanation(code: string, label: string) {
  return HTTP_STATUS_EXPLANATIONS[code] ?? `${code} ${label}：${httpStatusClassExplanation(code[0] ?? "5")}`;
}

export interface HttpStatusCodeInputProps {
  value: string;
  onChange: (value: string) => void;
  onOptionSelect?: (value: string, label: string) => void;
  ariaLabel?: string;
  autoFocus?: boolean;
  required?: boolean;
  invalid?: boolean;
  maxLength?: number;
}

export function HttpStatusCodeInput({ value, onChange, onOptionSelect, ariaLabel = "HTTP 状态码", autoFocus, required, invalid = false, maxLength = 9 }: HttpStatusCodeInputProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const instanceId = useId().replace(/:/g, "");
  const listId = `http-status-options-${instanceId}`;
  const openPicker = () => {
    const selectedIndex = HTTP_RESPONSE_STATUS_OPTIONS.findIndex(([code]) => code === value);
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
    setOpen(true);
  };
  const selectOption = (code: string, label: string) => {
    onChange(code);
    onOptionSelect?.(code, label);
    setOpen(false);
  };

  return <div className="http-status-combobox">
    <input className="ui-input" autoFocus={autoFocus} required={required} type="text" inputMode="numeric" minLength={1} maxLength={maxLength} pattern="[0-9]{1,9}" role="combobox" aria-label={ariaLabel} aria-autocomplete="list" aria-controls={listId} aria-expanded={open} aria-activedescendant={open ? `${listId}-${HTTP_RESPONSE_STATUS_OPTIONS[activeIndex]?.[0]}` : undefined} value={value} onClick={openPicker} onFocus={openPicker} onBlur={() => setOpen(false)} onChange={(event) => onChange(event.target.value.replace(/\D/g, "").slice(0, maxLength))} onKeyDown={(event) => {
      if (event.key === "Escape") { event.stopPropagation(); setOpen(false); return; }
      if (open && (event.key === "ArrowDown" || event.key === "ArrowUp")) { event.preventDefault(); const delta = event.key === "ArrowDown" ? 1 : -1; setActiveIndex((index) => (index + delta + HTTP_RESPONSE_STATUS_OPTIONS.length) % HTTP_RESPONSE_STATUS_OPTIONS.length); return; }
      if (event.key === "Enter" && open) { event.preventDefault(); const option = HTTP_RESPONSE_STATUS_OPTIONS[activeIndex]; if (option) selectOption(option[0], option[1]); }
    }} aria-invalid={invalid} title={`请输入 1–${maxLength} 位数字`}/>
    {open ? <div id={listId} className="http-status-options" role="listbox">{(["1", "2", "3", "4", "5"] as const).map((group) => <div className={`http-status-group status-${group}xx`} key={group}>{HTTP_RESPONSE_STATUS_OPTIONS.map(([code, label], index) => code.startsWith(group) ? <button id={`${listId}-${code}`} type="button" role="option" aria-selected={value === code} className={activeIndex === index ? "is-active" : ""} key={code} onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setActiveIndex(index)} onClick={() => selectOption(code, label)}><b>{code}</b><span>{label}</span><i className="http-status-info" data-tooltip={httpStatusExplanation(code, label)} aria-label={`${code} 协议说明`}>i</i></button> : null)}<div className="http-status-class"><b>{group}XX</b><span>{STATUS_GROUP_LABELS[group]}</span><i className="http-status-info" data-tooltip={httpStatusClassExplanation(group)} aria-label={`${group}XX 协议说明`}>i</i></div></div>)}</div> : null}
  </div>;
}
