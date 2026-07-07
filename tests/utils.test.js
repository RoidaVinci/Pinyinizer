import { test } from "node:test";
import assert from "node:assert/strict";
import { chunk, chunkByBudget, mapPool } from "../src/common/utils.js";

test("chunk splits arrays", () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
});

test("chunkByBudget respects item cap", () => {
  const batches = chunkByBudget(["a", "b", "c"], { maxItems: 2, maxChars: 100 });
  assert.deepEqual(batches.map(b => b.slice), [["a", "b"], ["c"]]);
  assert.deepEqual(batches.map(b => b.start), [0, 2]);
});

test("chunkByBudget respects char budget", () => {
  const batches = chunkByBudget(["aaaa", "bbbb", "cc"], { maxItems: 10, maxChars: 8 });
  assert.deepEqual(batches.map(b => b.slice), [["aaaa", "bbbb"], ["cc"]]);
});

test("chunkByBudget never strands an oversized item", () => {
  const batches = chunkByBudget(["x".repeat(50)], { maxItems: 10, maxChars: 8 });
  assert.equal(batches.length, 1);
  assert.equal(batches[0].slice.length, 1);
});

test("chunkByBudget covers all inputs exactly once", () => {
  const inputs = Array.from({ length: 37 }, (_, i) => "t".repeat((i % 7) + 1));
  const batches = chunkByBudget(inputs, { maxItems: 5, maxChars: 12 });
  const rebuilt = batches.flatMap(b => b.slice);
  assert.deepEqual(rebuilt, inputs);
});

test("mapPool preserves order under concurrency", async () => {
  const delays = [30, 5, 20, 1, 10];
  const out = await mapPool(delays, 3, async (ms, i) => {
    await new Promise(r => setTimeout(r, ms));
    return i * 2;
  });
  assert.deepEqual(out, [0, 2, 4, 6, 8]);
});
