import { RuleTester } from "oxlint/plugins-dev";

import { noArrayFilterMapRule } from "./no-array-filter-map.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const error = { messageId: "arrayFilterMap" };

tester.run("anti-slop/no-array-filter-map", noArrayFilterMapRule, {
  valid: [
    "const users = []; users.values().filter(active).map(email).toArray();",
    "const users = []; users.values().map(email).filter(Boolean).toArray();",
    "Iterator.from(users).filter(active).map(email).toArray();",
    "function collect(users: IteratorObject<User>) { return users.filter(active).map(email).toArray(); }",
    "const users = []; users.flatMap(user => user.active ? [user.email] : []);",
    "const users = []; users.map(email); users.filter(active);",
    "const users = []; users.map(email).map(normalize);",
    "const users = []; users.filter(active).filter(verified);",
    "const custom = { filter() { return this; }, map() {} }; custom.filter(active).map(email);",
    "function collect(unknownReceiver) { return unknownReceiver.filter(active).map(email); }",
    "const users = fetchUsers(); users.filter(active).map(email);",
    "const users = []; function collect(users) { return users.filter(active).map(email); }",
    "let users = []; users = iterator; users.filter(active).map(email);",
    "const users = []; users[method](active).map(email);",
    "const first = second; const second = first; first.filter(active).map(email);",
    "const Array = custom; Array.from(users).filter(active).map(email);",
    "function collect(Object) { return Object.keys(users).filter(active).map(email); }",
    "function collect(value, separator) { return value.split(separator).filter(Boolean).map(email); }",
    "Object.groupBy(users, team).filter(active).map(email);",
    "constructor.from(users).filter(active).map(email);",
    "toString.keys(users).filter(active).map(email);",
  ],
  invalid: [
    { code: "[].filter(active).map(email);", errors: [error] },
    { code: "[].map(user => user.active ? user.email : undefined).filter(email => email !== undefined);", errors: [error] },
    { code: "const users = []; users.map(email).filter(Boolean);", errors: [error] },
    { code: "const users = []; const alias = users; alias.filter(active).map(email);", errors: [error] },
    { code: "function collect(users: User[]) { return users.filter(active).map(email); }", errors: [error] },
    { code: "function collect(users: readonly User[]) { return users.map(email).filter(present); }", errors: [error] },
    { code: "function collect(users: ReadonlyArray<User>) { return users.filter(active).map(email); }", errors: [error] },
    { code: "function collect(users: Array<User>) { return users.filter(active).map(email); }", errors: [error] },
    { code: "const users = [] as const; users['filter'](active)['map'](email);", errors: [error] },
    { code: "const users = []; (users.filter(active)!).map(email);", errors: [error] },
    { code: "const users = []; users?.filter(active)?.map(email);", errors: [error] },
    { code: "const users = []; users.slice().filter(active).map(email);", errors: [error] },
    { code: "const users = []; users.filter(active).map(email).filter(Boolean);", errors: [error, error] },
    { code: "function collect(value) { return value.split(',').map(part => part.trim()).filter(Boolean); }", errors: [error] },
    { code: "function collect(value) { return value.split(/\\s+/).filter(Boolean).map(email); }", errors: [error] },
    { code: "Array.from(users).filter(active).map(email);", errors: [error] },
    { code: "Array.of(first, second).map(email).filter(Boolean);", errors: [error] },
    { code: "Object.keys(users).filter(active).map(email);", errors: [error] },
    { code: "Object.values(users).map(email).filter(Boolean);", errors: [error] },
    { code: "Object.entries(users).filter(active).map(email);", errors: [error] },
    { code: "const users = []; users.flat().filter(active).map(email);", errors: [error] },
    { code: "const users = []; users.sort().reverse().filter(active).map(email);", errors: [error] },
    { code: "Array.from(users).filter(active).map(email);", languageOptions: { globals: { Array: "readonly" } }, errors: [error] },
    { code: "Object.keys(users).map(email).filter(Boolean);", languageOptions: { globals: { Object: "readonly" } }, errors: [error] },
  ],
});
