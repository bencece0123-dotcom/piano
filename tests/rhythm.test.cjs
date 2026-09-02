const test = require("node:test");
const assert = require("node:assert/strict");
const { recognizeOnsets } = require("../rhythm.js");

function recognize(values) {
  return recognizeOnsets(values.map((rawStartBeat, index) => ({ id: `n${index}`, rawStartBeat })));
}

test("keeps an eighth plus two sixteenths on the straight grid", () => {
  const result = recognize([0, 0.5, 0.75]);
  assert.deepEqual(result.map((item) => item.startBeat), [0, 0.5, 0.75]);
  assert.ok(result.every((item) => item.tuplet === null));
});

test("recognizes a human-played eighth-note triplet", () => {
  const result = recognize([0.01, 0.34, 0.68]);
  assert.deepEqual(result.map((item) => item.startBeat), [0, 0.333333, 0.666667]);
  assert.ok(result.every((item) => item.tuplet?.count === 3));
  assert.ok(result.every((item) => item.tuplet?.notesOccupied === 2));
});

test("recognizes a human-played five-note tuplet", () => {
  const result = recognize([0, 0.19, 0.41, 0.6, 0.81]);
  assert.deepEqual(result.map((item) => item.startBeat), [0, 0.2, 0.4, 0.6, 0.8]);
  assert.ok(result.every((item) => item.tuplet?.count === 5));
  assert.ok(result.every((item) => item.tuplet?.notesOccupied === 4));
});

test("accepts a slightly slow but evenly played quintuplet", () => {
  const result = recognize([0, 0.225, 0.45, 0.675, 0.9]);
  assert.ok(result.every((item) => item.tuplet?.count === 5));
});

test("does not misread ordinary sixteenth notes as a triplet", () => {
  const result = recognize([0, 0.25, 0.5, 0.75]);
  assert.deepEqual(result.map((item) => item.startBeat), [0, 0.25, 0.5, 0.75]);
  assert.ok(result.every((item) => item.tuplet === null));
});

test("supports sextuplets and septuplets", () => {
  const sextuplet = recognize([0, 0.17, 0.33, 0.5, 0.67, 0.84]);
  const septuplet = recognize([1, 1.14, 1.29, 1.43, 1.57, 1.71, 1.86]);
  assert.ok(sextuplet.every((item) => item.tuplet?.count === 6));
  assert.ok(septuplet.every((item) => item.tuplet?.count === 7));
});
