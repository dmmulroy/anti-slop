import { RuleTester } from "oxlint/plugins-dev";

import { noReduceAccumulatorCopyRule } from "./no-reduce-accumulator-copy.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const error = { messageId: "accumulatorCopy" };

tester.run("anti-slop/no-reduce-accumulator-copy", noReduceAccumulatorCopyRule, {
  valid: [
    "items.reduce((acc, item) => { acc.push(item); return acc; }, []);",
    "items.reduce((acc, item) => Object.assign(acc, item), {});",
    "items.reduce((acc, item) => Object.assign(acc, acc, item), {});",
    "items.reduce((acc, item) => { acc[item.id] = { ...item }; return acc; }, {});",
    "items.reduce((acc, item) => { acc.push(Object.assign({}, item)); return acc; }, []);",
    "items.reduce((acc, item) => { acc.push(item.slice()); return acc; }, []);",
    "items.reduce((acc, item) => acc.concat(item), '');",
    "items.reduce((acc, item) => acc.concat(item), customCollection);",
    "function copy(acc) { return Object.assign({}, acc); }",
    "items.map((acc, item) => Object.assign({}, acc));",
    "items.reduce((acc, item) => { function copy(acc) { return Object.assign({}, acc); } return acc; }, {});",
    "items.reduce((acc, item) => { const snapshot = () => Object.assign({}, acc); return acc; }, {});",
    "items.reduce((acc, item) => { { const acc = {}; Object.assign({}, acc); } return acc; }, {});",
    "const Object = custom; items.reduce((acc, item) => Object.assign({}, acc), {});",
    "function run(Object) { return items.reduce((acc, item) => Object.assign({}, acc), {}); }",
    "const Array = custom; items.reduce((acc, item) => Array.from(acc), []);",
    "items.reduce((acc, item) => { let alias = acc; alias = item; return Object.assign({}, alias); }, {});",
    "items.reduce((acc, item) => [...acc, item], []);", // Owned by the native rule.
    "items.reduce((acc, item) => ({ ...acc, [item.id]: item }), {});",
    {
      code: "const once = { reduce(fn, initial) { return fn(initial, { id: 1 }); } }; once.reduce((acc, item) => Object.assign({}, acc, item), {});",
      options: [{ requireArrayReceiver: true }],
    },
    {
      code: "items.reduce((acc, item) => Object.assign({}, acc, item), {});",
      options: [{ requireArrayReceiver: true }],
    },
    {
      code: "const custom = { reduceRight(fn, initial) { return fn(initial); } }; custom.reduceRight(acc => Array.from(acc), []);",
      options: [{ requireArrayReceiver: true }],
    },
    {
      code: "const items = [1, 2]; items.reduce((acc, item) => { acc.push(item); return acc; }, []);",
      options: [{ requireArrayReceiver: true }],
    },
  ],
  invalid: [
    { code: "items.reduce((acc, item) => Object.assign({}, acc, { [item.id]: item }), {});", errors: [error] },
    { code: "items.reduceRight((acc, item) => Object.assign({}, acc, item), {});", errors: [error] },
    { code: "items.reduce((acc, item, index, array) => Object.assign({}, acc, item), {});", errors: [error] },
    { code: "items.reduce(acc => Object.assign({}, acc), {});", errors: [error] },
    { code: "items.reduce(function (acc, item) { return Object.assign({}, item, acc); }, {});", errors: [error] },
    { code: "items['reduce'](((acc, item) => Object['assign']({}, acc, item)), {});", errors: [error] },
    { code: "items.reduce((acc = {}, item) => Object.assign({}, acc, item), {});", errors: [error] },
    { code: "items.reduce((acc, item) => { const alias = acc; return Object.assign({}, alias, item); }, {});", errors: [error] },
    { code: "items.reduce((acc, item) => Object.assign({}, acc as State, item), {});", errors: [error] },
    { code: "items.reduce((acc, item) => { const next = Object.assign({}, acc); next[item.id] = item; return next; }, {});", errors: [error] },
    { code: "items.reduce((acc, item) => acc.concat([item]), []);", errors: [error] },
    { code: "items.reduceRight((acc, item, index) => acc['concat']([item]), [] as Item[]);", errors: [error] },
    { code: "items.reduce((acc, item) => { const next = acc.slice(); next.push(item); return next; }, []);", errors: [error] },
    { code: "items.reduce((acc, item) => { const alias = acc; return alias.concat(item); }, []);", errors: [error] },
    { code: "const initial = []; items.reduce((acc, item) => acc.concat(item), initial);", errors: [error] },
    { code: "items.reduce((acc, item) => { const next = Array.from(acc); next.push(item); return next; }, []);", errors: [error] },
    { code: "items.reduce((acc, item) => acc.toSpliced(acc.length, 0, item), []);", errors: [error] },
    { code: "items.reduce((acc, item) => acc.toSorted(), []);", errors: [error] },
    { code: "items.reduce((acc, item) => acc.toReversed(), []);", errors: [error] },
    { code: "items.reduce((acc, item) => acc.with(0, item), []);", errors: [error] },
    {
      code: "[1, 2].reduce((acc, item) => Object.assign({}, acc, { [item]: item }), {});",
      options: [{ requireArrayReceiver: true }], errors: [error],
    },
    {
      code: "const source = [1, 2]; const alias = source; alias.reduceRight((acc, item) => Array.from(acc), []);",
      options: [{ requireArrayReceiver: true }], errors: [error],
    },
    {
      code: "function run(items: readonly string[]) { return items.filter(Boolean).reduce((acc, item) => acc.concat(item), []); }",
      options: [{ requireArrayReceiver: true }], errors: [error],
    },
  ],
});
