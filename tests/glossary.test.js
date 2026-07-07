import { test } from "node:test";
import assert from "node:assert/strict";
import { applyGlossary, unmaskDNT } from "../src/background/glossary.js";

test("applyGlossary masks do-not-translate tokens", () => {
  const [out] = applyGlossary(["Install the Chrome API today"], { dnt: ["Chrome", "API"] });
  assert.equal(out, "Install the {{DNT:Chrome}} {{DNT:API}} today");
});

test("unmaskDNT restores original tokens", () => {
  assert.equal(unmaskDNT("Instala {{DNT:Chrome}} hoy"), "Instala Chrome hoy");
});

test("mask -> unmask round-trips", () => {
  const input = "Chrome uses the API";
  const [masked] = applyGlossary([input], { dnt: ["Chrome", "API"] });
  assert.equal(unmaskDNT(masked), input);
});

test("replace pairs apply before masking", () => {
  const [out] = applyGlossary(["the colour red"], { replace: [["colour", "color"]] });
  assert.equal(out, "the color red");
});

test("empty glossary is a no-op", () => {
  assert.deepEqual(applyGlossary(["hello"], {}), ["hello"]);
  assert.deepEqual(applyGlossary(["hello"], undefined), ["hello"]);
});
