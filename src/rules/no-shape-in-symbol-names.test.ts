import { RuleTester } from "oxlint/plugins-dev";

import { noForbiddenTermInSymbolNamesRule } from "./no-shape-in-symbol-names.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "tsx" } } });
const error = { messageId: "forbiddenSymbolName" };

tester.run("anti-slop/no-shape-in-symbol-names", noForbiddenTermInSymbolNamesRule, {
	valid: [
		"declare const schema: ExternalSchema; const field = schema.shape.id;",
		"declare const outer: External; const value = outer.inner.shape;",
		"declare const schema: ExternalSchema; schema.shape.id.parse('x');",
		"const owner = { id: 1 }; const value = owner.id;",
		"import { Warp } from '@paper-design/shaders-react'; const view = <Warp shape=\"checks\" shapeScale={0.1} />;",
		"import Avatar from 'ui-library'; const view = <Avatar shape=\"circle\" />;",
		"import * as Shaders from 'shader-library'; const view = <Shaders.Warp shape=\"checks\" />;",
	],
	invalid: [
		{ code: "const shape = 1;", errors: [error] },
		{ code: "function shapeOf() {}", errors: [error] },
		{ code: "type PayloadShape = { id: string };", errors: [error] },
		{ code: "type Payload = { shape: string };", errors: [error] },
		{ code: 'const view = <div shape="circle" />;', errors: [error] },
		{ code: 'const view = <Avatar shape="circle" />;', errors: [error] },
		{
			code: 'function Avatar() { return null; } const view = <Avatar shape="circle" />;',
			errors: [error],
		},
		{
			code: "import { Avatar } from './avatar'; const view = <Avatar shape=\"circle\" />;",
			errors: [error],
		},
		{
			code: "import { Avatar } from '/components/avatar'; const view = <Avatar shape=\"circle\" />;",
			errors: [error],
		},
		{
			code: "import { Avatar } from '#components/avatar'; const view = <Avatar shape=\"circle\" />;",
			errors: [error],
		},
		{
			code: "import { Avatar } from '@/components/avatar'; const view = <Avatar shape=\"circle\" />;",
			errors: [error],
		},
		{
			code: "import { Avatar } from '~/components/avatar'; const view = <Avatar shape=\"circle\" />;",
			errors: [error],
		},
		{
			code: "import * as Local from './local'; const view = <Local.Avatar shape=\"circle\" />;",
			errors: [error],
		},
		{
			code: "import { Warp } from '@paper-design/shaders-react'; const shapeName = 'checks'; const view = <Warp shape={shapeName} />;",
			errors: 2,
		},
		{
			code: "declare const owner: External; const shape = 'field'; const value = owner[shape];",
			errors: 2,
		},
	],
});
