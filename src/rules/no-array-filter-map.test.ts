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
    "const data = { widths: [] }; data.widths.values().filter(active).map(email).toArray();",
    "const data = { widths: [] }; data.widths.flatMap(width => active(width) ? [email(width)] : []);",
  ],
  invalid: [
    { code: "function candidates(data: { widths: readonly number[] }) { return data.widths.filter(x => x > 0).map(String); }", errors: [error] },
    { code: "const data = { widths: [1, 2] }; data.widths.map(String).filter(Boolean);", errors: [error] },
    { code: "const data = { widths: [1, 2] }; const alias = data; const widths = alias.widths; widths['filter'](positive)['map'](String);", errors: [error] },
    { code: "function collect(data: { readonly widths: ReadonlyArray<number> }) { return data['widths']['map'](String)['filter'](Boolean); }", errors: [error] },
    { code: "function collect(data: { widths: Array<number> }) { const alias = data; return alias.widths.filter(active).map(email); }", errors: [error] },
    { code: "function collect(data: { widths: readonly (384 | 1200)[]; sourceWidth: number }) { return data.widths.filter(width => width !== data.sourceWidth).map(String); }", errors: [error] },
    { code: "function collect(data: { nested: { widths: readonly [1, 2] } }) { return data.nested.widths.filter(active).map(email); }", errors: [error] },
    { code: "function collect(data: { widths?: readonly number[] }) { return data.widths?.filter(active)?.map(email); }", errors: [error] },
    { code: "const widths = []; const data = { widths }; data.widths.filter(active).map(email);", errors: [error] },
    { code: "const data = { nested: { 'widths': [] } }; data.nested.widths.slice().filter(active).map(email);", errors: [error] },
    { code: "({ widths: [] }).widths.filter(active).map(email);", errors: [error] },
    { code: "const data = { ['widths']: [] }; (data.widths!).filter(active).map(email);", errors: [error] },
    { code: "const data: { widths: number[] } = fetchData(); data.widths.filter(active).map(email);", errors: [error] },
    { code: "const data = { widths: [] }; { const data = { widths: [] }; data.widths.map(email).filter(active); }", errors: [error] },
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
  ],
});
