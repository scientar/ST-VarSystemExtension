/**
 * 测试函数调用解析器
 */

import { test } from "node:test";
import assert from "node:assert";
import {
  extractFunctionArgs,
  splitArguments,
  parseFunctionCalls,
} from "../src/functions/parser.ts";

test("extractFunctionArgs - 简单参数", () => {
  const result = extractFunctionArgs('"a", "b");');
  assert.strictEqual(result.argsString, '"a", "b"');
  assert.strictEqual(result.endIndex, 8);
});

test("extractFunctionArgs - 括号在引号内", () => {
  const result = extractFunctionArgs('"a", "我(me)的");');
  assert.strictEqual(result.argsString, '"a", "我(me)的"');
  assert.strictEqual(result.endIndex, 13);
});

test("extractFunctionArgs - 嵌套对象", () => {
  const result = extractFunctionArgs('"data", {"name": "value"});');
  assert.strictEqual(result.argsString, '"data", {"name": "value"}');
  assert.strictEqual(result.endIndex, 25);
});

test("splitArguments - 简单参数", () => {
  const args = splitArguments('"a", "b", 123');
  assert.deepStrictEqual(args, ['"a"', '"b"', "123"]);
});

test("splitArguments - 括号在引号内", () => {
  const args = splitArguments('"a", "我(me)的"');
  assert.deepStrictEqual(args, ['"a"', '"我(me)的"']);
});

test("splitArguments - 逗号在引号内", () => {
  const args = splitArguments('"a,b", "c"');
  assert.deepStrictEqual(args, ['"a,b"', '"c"']);
});

test("splitArguments - 对象参数", () => {
  const args = splitArguments('"data", {"name": "张三(测试)", "age": 20}');
  assert.deepStrictEqual(args, ['"data"', '{"name": "张三(测试)", "age": 20}']);
});

test("splitArguments - 转义引号", () => {
  const args = splitArguments('"a", "say \\"hello\\""');
  assert.deepStrictEqual(args, ['"a"', '"say \\"hello\\""']);
});

test("parseFunctionCalls - 基本功能", () => {
  const text = '@.ADD("count", 1);';
  const functions = [
    {
      id: "test-add",
      name: "ADD",
      type: "active",
      enabled: true,
    },
  ];

  const calls = parseFunctionCalls(text, functions);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].functionName, "ADD");
  assert.deepStrictEqual(calls[0].args, ['"count"', "1"]);
});

test("parseFunctionCalls - 括号在引号内", () => {
  const text = '@.ADD("a", "我(me)的");';
  const functions = [
    {
      id: "test-add",
      name: "ADD",
      type: "active",
      enabled: true,
    },
  ];

  const calls = parseFunctionCalls(text, functions);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].functionName, "ADD");
  assert.deepStrictEqual(calls[0].args, ['"a"', '"我(me)的"']);
});

test("parseFunctionCalls - 多个函数调用", () => {
  const text = '@.ADD("a", 1); @.SET("b", "测试(test)");';
  const functions = [
    {
      id: "test-add",
      name: "ADD",
      type: "active",
      enabled: true,
    },
    {
      id: "test-set",
      name: "SET",
      type: "active",
      enabled: true,
    },
  ];

  const calls = parseFunctionCalls(text, functions);
  assert.strictEqual(calls.length, 2);
  assert.strictEqual(calls[0].functionName, "ADD");
  assert.strictEqual(calls[1].functionName, "SET");
  assert.deepStrictEqual(calls[1].args, ['"b"', '"测试(test)"']);
});

test("parseFunctionCalls - 嵌套对象参数", () => {
  const text = '@.SET("data", {"name": "张三(主角)", "items": ["剑(weapon)", "盾"]});';
  const functions = [
    {
      id: "test-set",
      name: "SET",
      type: "active",
      enabled: true,
    },
  ];

  const calls = parseFunctionCalls(text, functions);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].functionName, "SET");
  assert.strictEqual(calls[0].args.length, 2);
  assert.strictEqual(calls[0].args[0], '"data"');
  assert.strictEqual(
    calls[0].args[1],
    '{"name": "张三(主角)", "items": ["剑(weapon)", "盾"]}',
  );
});

test("parseFunctionCalls - 同一函数多次调用", () => {
  const text = '@.ADD("x", 1); @.ADD("x", 3); @.ADD("y", 5);';
  const functions = [
    {
      id: "test-add",
      name: "ADD",
      type: "active",
      enabled: true,
    },
  ];

  const calls = parseFunctionCalls(text, functions);

  // 应该识别到3次 ADD 调用
  assert.strictEqual(calls.length, 3);

  // 验证第1次调用
  assert.strictEqual(calls[0].functionName, "ADD");
  assert.deepStrictEqual(calls[0].args, ['"x"', "1"]);
  assert.strictEqual(calls[0].index, 0);

  // 验证第2次调用
  assert.strictEqual(calls[1].functionName, "ADD");
  assert.deepStrictEqual(calls[1].args, ['"x"', "3"]);
  assert(calls[1].index > calls[0].index, "第2次调用应该在第1次之后");

  // 验证第3次调用
  assert.strictEqual(calls[2].functionName, "ADD");
  assert.deepStrictEqual(calls[2].args, ['"y"', "5"]);
  assert(calls[2].index > calls[1].index, "第3次调用应该在第2次之后");
});

test("parseFunctionCalls - 复杂场景：多函数多次调用混合", () => {
  const text =
    '@.ADD("count", 1); @.SET("msg", "你好(hello)"); @.ADD("count", 2); @.INC("level");';
  const functions = [
    {
      id: "test-add",
      name: "ADD",
      type: "active",
      enabled: true,
    },
    {
      id: "test-set",
      name: "SET",
      type: "active",
      enabled: true,
    },
    {
      id: "test-inc",
      name: "INC",
      type: "active",
      enabled: true,
    },
  ];

  const calls = parseFunctionCalls(text, functions);

  // 应该识别到4次调用，按顺序排列
  assert.strictEqual(calls.length, 4);
  assert.strictEqual(calls[0].functionName, "ADD");
  assert.strictEqual(calls[1].functionName, "SET");
  assert.strictEqual(calls[2].functionName, "ADD");
  assert.strictEqual(calls[3].functionName, "INC");

  // 验证顺序
  assert(calls[0].index < calls[1].index);
  assert(calls[1].index < calls[2].index);
  assert(calls[2].index < calls[3].index);
});

console.log("所有测试通过！✓");
