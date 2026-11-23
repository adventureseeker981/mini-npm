'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { satisfies, maxSatisfying, compare } = require('../src/semver');

test('caret ranges', () => {
  assert.ok(satisfies('1.2.3', '^1.2.3'));
  assert.ok(satisfies('1.9.0', '^1.2.3'));
  assert.ok(!satisfies('2.0.0', '^1.2.3'));
  assert.ok(!satisfies('1.2.2', '^1.2.3'));
  // 0.x: the minor acts like a major
  assert.ok(satisfies('0.2.9', '^0.2.3'));
  assert.ok(!satisfies('0.3.0', '^0.2.3'));
  // 0.0.x: only the exact patch
  assert.ok(satisfies('0.0.3', '^0.0.3'));
  assert.ok(!satisfies('0.0.4', '^0.0.3'));
});

test('tilde ranges', () => {
  assert.ok(satisfies('1.2.9', '~1.2.3'));
  assert.ok(!satisfies('1.3.0', '~1.2.3'));
  assert.ok(satisfies('1.9.0', '~1'));
});

test('x-ranges, wildcards and empty range', () => {
  assert.ok(satisfies('1.5.0', '1.x'));
  assert.ok(!satisfies('2.0.0', '1.x'));
  assert.ok(satisfies('1.2.8', '1.2.*'));
  assert.ok(satisfies('9.9.9', '*'));
  assert.ok(satisfies('3.1.4', ''));
});

test('comparators, AND and OR', () => {
  assert.ok(satisfies('1.5.0', '>=1.2.0 <2.0.0'));
  assert.ok(!satisfies('2.0.0', '>=1.2.0 <2.0.0'));
  assert.ok(satisfies('3.0.0', '^1.0.0 || ^3.0.0'));
  assert.ok(!satisfies('2.0.0', '^1.0.0 || ^3.0.0'));
  assert.ok(satisfies('1.2.3', '1.2.3'));
  assert.ok(!satisfies('1.2.4', '1.2.3'));
});

test('hyphen ranges', () => {
  assert.ok(satisfies('1.5.0', '1.2.3 - 2.3.4'));
  assert.ok(satisfies('2.3.4', '1.2.3 - 2.3.4'));
  assert.ok(!satisfies('2.3.5', '1.2.3 - 2.3.4'));
});

test('prereleases are excluded unless asked for', () => {
  assert.ok(!satisfies('1.3.0-beta.1', '^1.2.0'));
  assert.ok(satisfies('1.3.0-beta.2', '>=1.3.0-beta.1'));
});

test('compare orders versions correctly', () => {
  assert.equal(compare('1.0.0', '1.0.0'), 0);
  assert.equal(compare('1.10.0', '1.9.0'), 1); // numeric, not string, comparison
  assert.equal(compare('1.0.0-beta', '1.0.0'), -1);
  assert.equal(compare('1.0.0-alpha.2', '1.0.0-alpha.10'), -1);
});

test('maxSatisfying picks the highest match', () => {
  const versions = ['1.0.0', '1.2.0', '1.10.0', '2.0.0', '2.1.0-beta.1'];
  assert.equal(maxSatisfying(versions, '^1.0.0'), '1.10.0');
  assert.equal(maxSatisfying(versions, '^2.0.0'), '2.0.0');
  assert.equal(maxSatisfying(versions, '^3.0.0'), null);
});
