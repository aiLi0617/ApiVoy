import assert from "node:assert/strict";
import { CASE_NAME_PRESETS, caseNameFromRequestName, requestNameFromUrl } from "./HttpWorkbench";

assert.equal(requestNameFromUrl("https://api.example.com/users/42?include=team"), "/users/42");
assert.equal(requestNameFromUrl("/health?verbose=true"), "/health");
assert.equal(requestNameFromUrl(""), "未命名接口");
assert.equal(caseNameFromRequestName("获取用户"), "成功");
assert.equal(caseNameFromRequestName("  "), "成功");
assert.deepEqual(CASE_NAME_PRESETS, ["成功", "失败", "记录不存在", "数据为空", "缺少参数", "参数有误", "已登录", "未登录"]);

console.log("Request name tests passed");
