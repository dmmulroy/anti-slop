import { a as locationCandidates, c as probabilityOf, d as verdictAsk, i as locationAsk, l as selectedLocation, n as isValidAnswer, o as locationOfLine, r as locates, s as messageOf, t as buildRequest, u as truncateSnippet } from "./jev-BC3UITJZ.mjs";
import { askModel } from "./sync-jev.mjs";
import { mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
//#region src/cache.ts
const defaultCacheDir = () => path.join(process.cwd(), "node_modules", ".cache", "oxlint-plugin-jev");
/** One cached answer, or null when the entry is missing or not shaped like one. */
function readCache(dir, key) {
	try {
		const stored = JSON.parse(readFileSync(path.join(dir, `${key}.json`), "utf8"));
		if (typeof stored !== "object" || stored === null) return null;
		if (!("model" in stored) || typeof stored.model !== "string" || stored.model === "") return null;
		if (!("answer" in stored)) return null;
		return {
			model: stored.model,
			answer: stored.answer
		};
	} catch {
		return null;
	}
}
function writeCache(dir, key, entry) {
	const target = path.join(dir, `${key}.json`);
	const temp = `${target}.tmp-${process.pid}`;
	mkdirSync(dir, { recursive: true });
	writeFileSync(temp, JSON.stringify(entry));
	renameSync(temp, target);
}
//#endregion
//#region src/answers.ts
/**
* Answers every ask, from the cache where it can and with one request for the rest. A missing
* or invalid verdict fails the batch; an invalid location is returned but never cached, so it is
* asked again on the next run.
*/
function answerAll({ asks, backend, timeoutMs, cacheDir, onCacheError }) {
	const answers = /* @__PURE__ */ new Map();
	const misses = /* @__PURE__ */ new Map();
	for (const ask of asks) {
		if (answers.has(ask.key) || misses.has(ask.key)) continue;
		const cached = readCache(cacheDir, ask.key);
		if (cached !== null && isValidAnswer(ask, cached.answer)) answers.set(ask.key, cached);
		else misses.set(ask.key, ask);
	}
	if (misses.size === 0) return {
		ok: true,
		answers
	};
	const pending = [...misses.values()];
	const { request, ids } = buildRequest(pending);
	const result = askModel({
		backend,
		request,
		timeoutMs
	});
	if (!result.ok) return result;
	let missingVerdict = null;
	for (const [index, ask] of pending.entries()) {
		const answer = result.answers[ids[index]];
		const entry = {
			model: result.model,
			answer
		};
		if (!isValidAnswer(ask, answer)) {
			if (ask.kind === "verdict") missingVerdict ??= ids[index];
			else answers.set(ask.key, entry);
			continue;
		}
		answers.set(ask.key, entry);
		try {
			writeCache(cacheDir, ask.key, entry);
		} catch (error) {
			onCacheError?.(`could not write cache in ${cacheDir}: ${messageOf(error)}`);
		}
	}
	if (missingVerdict !== null) return {
		ok: false,
		reason: `response has no probability in [0, 1] for "${missingVerdict}"`
	};
	return {
		ok: true,
		answers
	};
}
//#endregion
//#region src/backend.ts
const DEFAULT_TYPESAFE_URL = "https://api.typesafe.ai/v1";
const DEFAULT_FACTORY_URL = "https://api.factory.ai";
const env = (name) => (process.env[name] ?? "").trim();
function typeSafeBaseURL() {
	const host = env("TYPESAFE_BASE_URL").replace(/\/+$/, "");
	if (host !== "") return `${host}/v1`;
	return env("TYPESAFE_AI_BASE_URL").replace(/\/+$/, "") || DEFAULT_TYPESAFE_URL;
}
/** Factory's decision route speaks TypeSafe's wire format under `/api/llm/decision/v1`. */
function factoryDecisionBaseURL() {
	return `${env("FACTORY_API_BASE_URL").replace(/\/+$/, "") || DEFAULT_FACTORY_URL}/api/llm/decision/v1`;
}
const isPinnedJevModel = (model) => /^jev-\d/.test(model);
const hasGatewayCredentials = () => env("AI_GATEWAY_API_KEY") !== "" || env("VERCEL_OIDC_TOKEN") !== "";
/** Named in the warning when no Jev credential of any kind is set. */
const NO_JEV_CREDENTIALS = "no Jev credentials: TYPESAFE_API_KEY, TYPESAFE_AI_API_KEY, FACTORY_API_KEY, and AI_GATEWAY_API_KEY are all unset";
/** The AI Gateway id for a TypeSafe model id; `jev-latest` is published there as `typesafe-ai/jev`. */
const gatewayModelFor = (model) => model === "jev-latest" ? "typesafe-ai/jev" : `typesafe-ai/${model}`;
/** Picks the backend for a rule list, or says which credential is missing. */
function backendFor(options) {
	const { judge } = options;
	if (judge !== void 0) {
		if (judge.provider === void 0 && !hasGatewayCredentials()) return {
			ok: false,
			reason: "AI_GATEWAY_API_KEY is not set"
		};
		const provider = judge.provider === void 0 ? void 0 : path.resolve(process.cwd(), judge.provider);
		return {
			ok: true,
			backend: {
				kind: "judge",
				model: judge.model,
				provider
			},
			id: `judge ${provider ?? "gateway"} ${judge.model}`
		};
	}
	if (options.model.includes("/")) {
		if (!hasGatewayCredentials()) return {
			ok: false,
			reason: "AI_GATEWAY_API_KEY is not set"
		};
		return {
			ok: true,
			backend: {
				kind: "gateway",
				model: options.model,
				longContext: options.longContext
			},
			id: `gateway ${options.model}`
		};
	}
	const typeSafeKey = env("TYPESAFE_API_KEY") || env("TYPESAFE_AI_API_KEY");
	if (typeSafeKey !== "") {
		const baseURL = typeSafeBaseURL();
		return {
			ok: true,
			backend: {
				kind: "typesafe",
				model: options.model,
				apiKey: typeSafeKey,
				baseURL,
				longContext: options.longContext
			},
			id: `typesafe ${baseURL} ${options.model}`
		};
	}
	const factoryKey = env("FACTORY_API_KEY");
	if (factoryKey !== "") {
		if (isPinnedJevModel(options.model)) return {
			ok: false,
			reason: `Factory serves only Jev aliases such as "jev-latest", not the pinned model "${options.model}"`
		};
		const baseURL = factoryDecisionBaseURL();
		return {
			ok: true,
			backend: {
				kind: "typesafe",
				model: options.model,
				apiKey: factoryKey,
				baseURL,
				longContext: options.longContext
			},
			id: `factory ${baseURL} ${options.model}`
		};
	}
	if (!hasGatewayCredentials()) return {
		ok: false,
		reason: NO_JEV_CREDENTIALS
	};
	const model = gatewayModelFor(options.model);
	return {
		ok: true,
		backend: {
			kind: "gateway",
			model,
			longContext: options.longContext
		},
		id: `gateway ${model}`
	};
}
//#endregion
//#region src/changed.ts
const git = (cwd, args) => execFileSync("git", [
	"-c",
	"core.quotePath=false",
	...args
], {
	cwd,
	encoding: "utf8",
	maxBuffer: 268435456,
	stdio: [
		"ignore",
		"pipe",
		"pipe"
	]
});
const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;
/** Parses `git diff -U0` output into the new-side line numbers each file changed. */
function parseDiff(diff) {
	const files = /* @__PURE__ */ new Map();
	let current = null;
	for (const line of diff.split("\n")) {
		if (line.startsWith("+++ ")) {
			const target = line.slice(4);
			current = null;
			if (target.startsWith("b/")) {
				current = files.get(target.slice(2)) ?? /* @__PURE__ */ new Set();
				files.set(target.slice(2), current);
			}
			continue;
		}
		const hunk = current === null ? null : HUNK.exec(line);
		if (hunk === null || current === null) continue;
		const start = Number(hunk[1]);
		const count = hunk[2] === void 0 ? 1 : Number(hunk[2]);
		if (count === 0) {
			current.add(start);
			current.add(start + 1);
		}
		for (let offset = 0; offset < count; offset++) current.add(start + offset);
	}
	return files;
}
const repoByDir = /* @__PURE__ */ new Map();
const changesByRoot = /* @__PURE__ */ new Map();
function repoChanges(dir, base, warn) {
	const dirKey = `${base}\0${dir}`;
	if (repoByDir.has(dirKey)) return repoByDir.get(dirKey) ?? null;
	let changes = null;
	try {
		const root = realpathSync(git(dir, ["rev-parse", "--show-toplevel"]).trim());
		const rootKey = `${base}\0${root}`;
		if (changesByRoot.has(rootKey)) changes = changesByRoot.get(rootKey) ?? null;
		else {
			const diff = git(root, [
				"diff",
				"-U0",
				"--no-color",
				"--no-ext-diff",
				"--no-renames",
				"--src-prefix=a/",
				"--dst-prefix=b/",
				base,
				"--"
			]);
			const files = new Map(parseDiff(diff));
			const untracked = git(root, [
				"ls-files",
				"--others",
				"--exclude-standard",
				"-z"
			]);
			for (const file of untracked.split("\0").filter(Boolean)) files.set(file, "all");
			changes = {
				root,
				files
			};
			changesByRoot.set(rootKey, changes);
		}
	} catch (error) {
		warn(`changedOnly could not diff against ${base} in ${dir}, checking every line: ${messageOf(error)}`);
	}
	repoByDir.set(dirKey, changes);
	return changes;
}
const flag = (name) => {
	const value = (process.env[name] ?? "").trim().toLowerCase();
	if ([
		"1",
		"true",
		"yes"
	].includes(value)) return true;
	if ([
		"0",
		"false",
		"no"
	].includes(value)) return false;
};
/** Whether changed-lines mode is on, and the ref it diffs against. Env vars override options. */
function changedMode(options) {
	return {
		on: flag("JEV_CHANGED_ONLY") ?? options.changedOnly,
		base: (process.env.JEV_CHANGED_BASE ?? "").trim() || options.changedBase
	};
}
/**
* The lines of a file changed against `base`, computed once per repository per process. An empty
* set means the file is unchanged. When git cannot answer, every line counts as changed, so a
* broken diff never silently turns checks off.
*/
function changedLines(filename, base, warn) {
	let file;
	try {
		file = realpathSync(filename);
	} catch {
		return "all";
	}
	const changes = repoChanges(path.dirname(file), base, warn);
	if (changes === null) return "all";
	const relative = path.relative(changes.root, file).split(path.sep).join("/");
	return changes.files.get(relative) ?? /* @__PURE__ */ new Set();
}
function overlaps(lines, start, end) {
	if (lines === "all") return true;
	for (let line = start; line <= end; line++) if (lines.has(line)) return true;
	return false;
}
//#endregion
//#region src/options.ts
const TARGET_NODE_TYPES = {
	function: [
		"FunctionDeclaration",
		"FunctionExpression",
		"ArrowFunctionExpression"
	],
	call: ["CallExpression"],
	jsx: ["JSXElement"],
	file: ["Program"]
};
const NAMED_PARENTS = {
	VariableDeclarator: "init",
	Property: "value",
	MethodDefinition: "value",
	PropertyDefinition: "value"
};
const isNamedParentType = (type) => type in NAMED_PARENTS;
const ANONYMOUS_FUNCTIONS = /* @__PURE__ */ new Set(["FunctionExpression", "ArrowFunctionExpression"]);
function snippetNodeFor(node) {
	const parent = node.parent;
	if (parent === null || parent === void 0) return node;
	const parentType = parent.type;
	if (!isNamedParentType(parentType)) return node;
	const field = NAMED_PARENTS[parentType];
	return ANONYMOUS_FUNCTIONS.has(node.type) && parent[field] === node ? parent : node;
}
const DEFAULTS = {
	ci: "skip",
	timeoutMs: 1e4,
	maxMatchesPerFile: 25,
	maxSnippetChars: 4e3,
	model: "jev-latest",
	longContext: false,
	changedOnly: false,
	changedBase: "HEAD"
};
const SCHEMA = {
	type: "object",
	additionalProperties: false,
	properties: {
		ci: { enum: ["skip", "fail"] },
		timeoutMs: {
			type: "integer",
			minimum: 1
		},
		maxMatchesPerFile: {
			type: "integer",
			minimum: 1
		},
		maxSnippetChars: {
			type: "integer",
			minimum: 1
		},
		model: {
			type: "string",
			minLength: 1
		},
		longContext: { type: "boolean" },
		judge: {
			type: "object",
			additionalProperties: false,
			required: ["model"],
			properties: {
				model: {
					type: "string",
					minLength: 1
				},
				provider: {
					type: "string",
					minLength: 1
				}
			}
		},
		changedOnly: { type: "boolean" },
		changedBase: {
			type: "string",
			minLength: 1
		},
		rules: {
			type: "array",
			minItems: 1,
			items: {
				type: "object",
				additionalProperties: false,
				required: [
					"id",
					"target",
					"question",
					"cutoff"
				],
				properties: {
					id: {
						type: "string",
						minLength: 1
					},
					target: { enum: Object.keys(TARGET_NODE_TYPES) },
					question: {
						type: "string",
						minLength: 1
					},
					location: {
						type: "object",
						additionalProperties: false,
						required: ["question", "cutoff"],
						properties: {
							question: {
								type: "string",
								minLength: 1
							},
							cutoff: {
								type: "number",
								minimum: .5,
								exclusiveMinimum: true,
								maximum: 1
							}
						}
					},
					cutoff: {
						type: "number",
						minimum: 0,
						maximum: 1
					},
					message: {
						type: "string",
						minLength: 1
					}
				}
			}
		}
	}
};
function fail(message) {
	throw new Error(`oxlint-plugin-jev: ${message}`);
}
function checkRules(rules) {
	const seen = /* @__PURE__ */ new Set();
	for (const { id, target, location, message } of rules) {
		if (location && target !== "file") fail("location is supported only for file rules");
		if (message !== void 0 && message.trim() === "") fail(`rule "${id}" has a blank message`);
		if (seen.has(id)) fail(`rule id "${id}" is used more than once`);
		seen.add(id);
	}
}
function checkOptions(raw) {
	if (typeof raw !== "object" || raw === null) fail("options must be an object");
	const options = raw;
	if (!Array.isArray(options.rules)) fail("options.rules must list at least one rule");
	checkRules(options.rules);
	return options;
}
const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
function validate(value, schema, at) {
	if (schema.enum && !schema.enum.includes(value)) fail(`${at} must be one of ${schema.enum.map((option) => JSON.stringify(option)).join(", ")}`);
	switch (schema.type) {
		case "string":
			if (typeof value !== "string" || value.length < (schema.minLength ?? 0)) fail(`${at} must be a non-empty string`);
			return;
		case "boolean":
			if (typeof value !== "boolean") fail(`${at} must be a boolean`);
			return;
		case "integer":
		case "number":
			if (!(typeof value === "number" && Number.isFinite(value) && (schema.type === "number" || Number.isInteger(value)) && (schema.minimum === void 0 || (schema.exclusiveMinimum ? value > schema.minimum : value >= schema.minimum)) && (schema.maximum === void 0 || value <= schema.maximum))) fail(`${at} is out of range`);
			return;
		case "array":
			if (!Array.isArray(value) || value.length < (schema.minItems ?? 0)) fail(`${at} must list at least ${schema.minItems ?? 0} item(s)`);
			value.forEach((item, index) => validate(item, schema.items ?? {}, `${at}[${index}]`));
			return;
		case "object": {
			if (!isRecord(value)) fail(`${at} must be an object`);
			const properties = schema.properties ?? {};
			for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) fail(`${at}.${key} is required`);
			for (const [key, field] of Object.entries(value)) {
				if (!Object.hasOwn(properties, key)) {
					if (schema.additionalProperties === false) fail(`${at}.${key} is not a known option`);
					continue;
				}
				if (field !== void 0) validate(field, properties[key], `${at}.${key}`);
			}
		}
	}
}
function checkPluginOptions(raw) {
	if (!isRecord(raw)) fail("createJevPlugin options must be an object");
	const { name, ...rest } = raw;
	if (typeof name !== "string" || name.trim() === "" || name.includes("/")) fail("createJevPlugin needs a plugin name without \"/\"");
	validate(rest, {
		...SCHEMA,
		required: ["rules"]
	}, "options");
	const options = {
		...DEFAULTS,
		...rest
	};
	checkRules(options.rules);
	for (const { id } of options.rules) if (id.includes("/")) fail(`rule id "${id}" cannot contain "/", since it becomes ${name}/${id}`);
	return {
		...options,
		name
	};
}
function headOf(text, line, column) {
	const newline = text.indexOf("\n");
	const length = newline === -1 ? text.length : newline;
	return {
		start: {
			line,
			column
		},
		end: {
			line,
			column: column + length
		}
	};
}
const REPORT_LOC = {
	function: (node, text) => headOf(text, node.loc.start.line, node.loc.start.column),
	call: (node) => node.loc,
	jsx: (node) => (node.openingElement ?? node).loc,
	file: (_node, text) => headOf(text, 1, 0)
};
//#endregion
//#region src/index.ts
const optionsByRaw = /* @__PURE__ */ new WeakMap();
const warnedReasons = /* @__PURE__ */ new Set();
let missingKeyRaised = false;
function warnOnce(reason, message) {
	if (warnedReasons.has(reason)) return;
	warnedReasons.add(reason);
	console.warn(`oxlint-plugin-jev: ${message}`);
}
const snippetOf = (sourceCode, node) => node.type === "Program" ? sourceCode.text : sourceCode.getText(node);
function optionsFor(raw) {
	if (typeof raw !== "object" || raw === null) return checkOptions(raw);
	const cached = optionsByRaw.get(raw);
	if (cached !== void 0) return cached;
	const options = checkOptions(raw);
	optionsByRaw.set(raw, options);
	return options;
}
function rulesByNodeType(rules) {
	const byType = /* @__PURE__ */ new Map();
	for (const rule of rules) for (const type of TARGET_NODE_TYPES[rule.target]) byType.set(type, [...byType.get(type) ?? [], rule]);
	return byType;
}
const byTypeByRules = /* @__PURE__ */ new WeakMap();
function nodeTypeIndex(rules) {
	const cached = byTypeByRules.get(rules);
	if (cached !== void 0) return cached;
	const byType = rulesByNodeType(rules);
	byTypeByRules.set(rules, byType);
	return byType;
}
function degrade(context, options, reason) {
	if (process.env.CI && options.ci === "fail") throw new Error(`oxlint-plugin-jev: ${reason} (${context.filename})`);
	warnOnce(reason, `${reason} (${context.filename})`);
}
function startPass(context, member) {
	const options = member.options(context);
	const chosen = backendFor(options);
	if (!chosen.ok) {
		if (process.env.CI && options.ci === "fail") {
			if (missingKeyRaised) return "skip";
			missingKeyRaised = true;
			throw new Error(`oxlint-plugin-jev: ${chosen.reason}`);
		}
		warnOnce(`missing-key:${chosen.reason}`, `${chosen.reason}, skipping Jev checks`);
		return "skip";
	}
	let changed = null;
	const mode = changedMode(options);
	if (mode.on) {
		changed = changedLines(context.filename, mode.base, (message) => warnOnce(`changed:${message}`, message));
		if (changed !== "all" && changed.size === 0) return "skip";
	}
	return {
		filename: context.filename,
		options,
		backend: chosen.backend,
		backendId: chosen.id,
		changed,
		matches: [],
		dropped: 0,
		outcome: null,
		asks: [],
		deadline: 0,
		refinementFailed: false,
		failureRaised: false
	};
}
function runBatch(pass, name, filename) {
	const { options } = pass;
	if (pass.dropped > 0) {
		const total = pass.matches.length + pass.dropped;
		warnOnce(`capped:${name}:${filename}`, `${total} matches exceeded maxMatchesPerFile=${options.maxMatchesPerFile}, ${pass.dropped} not checked by ${name} (${filename})`);
	}
	pass.deadline = Date.now() + options.timeoutMs;
	const locating = pass.backend.kind !== "judge";
	pass.asks = pass.matches.map((match) => ({
		verdict: verdictAsk(pass.backendId, match),
		location: locating && locates(match) ? locationAsk(pass.backendId, match) : void 0
	}));
	return answerAll({
		asks: pass.asks.flatMap(({ verdict, location }) => location === void 0 ? [verdict] : [verdict, location]),
		backend: pass.backend,
		timeoutMs: options.timeoutMs,
		cacheDir: defaultCacheDir(),
		onCacheError: (message) => warnOnce("cache-write", message)
	});
}
function locateMatch(pass, match, ask, answers) {
	if (ask === void 0 || !locates(match)) return { loc: match.loc };
	const { cutoff } = match.rule.location;
	let candidates = locationCandidates(match.snippet);
	let location = selectedLocation(answers.get(ask.key)?.answer, candidates, cutoff);
	while (location && location.start !== location.end) {
		const followup = locationAsk(pass.backendId, match, location);
		candidates = locationCandidates(match.snippet, location);
		const refined = answerAll({
			asks: [followup],
			backend: pass.backend,
			timeoutMs: Math.max(1, pass.deadline - Date.now()),
			cacheDir: defaultCacheDir(),
			onCacheError: (message) => warnOnce("cache-write", message)
		});
		if (!refined.ok) return {
			loc: match.loc,
			failure: refined.reason
		};
		location = selectedLocation(refined.answers.get(followup.key)?.answer, candidates, cutoff);
	}
	return { loc: location ? locationOfLine(match.snippet, location.start) : match.loc };
}
function reportMatches(context, member, pass, outcome) {
	if (!outcome.ok) return;
	let failure = null;
	for (const [index, match] of pass.matches.entries()) {
		if (match.owner !== member) continue;
		const asks = pass.asks[index];
		const answered = outcome.answers.get(asks.verdict.key);
		const score = probabilityOf(answered?.answer);
		if (answered === void 0 || score === null || score < match.rule.cutoff) continue;
		const { id, cutoff, question, message } = match.rule;
		const located = pass.refinementFailed ? { loc: match.loc } : locateMatch(pass, match, asks.location, outcome.answers);
		if (located.failure !== void 0) {
			pass.refinementFailed = true;
			failure = {
				id,
				loc: match.loc,
				reason: located.failure
			};
		}
		context.report({
			loc: located.loc,
			messageId: message === void 0 ? "yes" : "custom",
			data: {
				id,
				model: answered.model,
				score: score.toFixed(2),
				cutoff: cutoff.toFixed(2),
				question,
				message
			}
		});
	}
	if (failure === null) return;
	if (process.env.CI && pass.options.ci === "fail") context.report({
		loc: failure.loc,
		messageId: "unlocated",
		data: {
			id: failure.id,
			reason: failure.reason
		}
	});
	else warnOnce(failure.reason, `${failure.reason} (${context.filename})`);
}
function visitorsFor(group, member, context, nodeTypes) {
	const activePass = () => typeof group.pass === "object" && group.pass?.filename === context.filename ? group.pass : null;
	const collect = (type, node) => {
		const pass = activePass();
		if (pass === null) return;
		const rules = nodeTypeIndex(member.rules(pass.options)).get(type);
		if (rules === void 0) return;
		for (const rule of rules) {
			if (pass.changed !== null && rule.target !== "file" && !overlaps(pass.changed, node.loc.start.line, node.loc.end.line)) continue;
			if (pass.matches.length >= pass.options.maxMatchesPerFile) {
				pass.dropped += 1;
				continue;
			}
			const own = snippetOf(context.sourceCode, node);
			const named = snippetNodeFor(node);
			const text = named === node ? own : context.sourceCode.getText(named);
			pass.matches.push({
				rule,
				owner: member,
				loc: REPORT_LOC[rule.target](node, own),
				snippet: truncateSnippet(text, pass.options.maxSnippetChars),
				truncated: text.length > pass.options.maxSnippetChars
			});
		}
	};
	const visitors = {};
	for (const type of nodeTypes) visitors[type] = (node) => collect(type, node);
	visitors.Program = (node) => {
		if (group.pass === null || group.filename !== context.filename) {
			group.filename = context.filename;
			group.pass = null;
			group.pass = startPass(context, member);
		}
		collect("Program", node);
	};
	visitors["Program:exit"] = () => {
		const pass = activePass();
		if (pass === null) return;
		pass.outcome ??= runBatch(pass, group.name ?? context.id, context.filename);
		const outcome = pass.outcome;
		if (!outcome.ok) {
			if (pass.failureRaised) return;
			pass.failureRaised = true;
			degrade(context, pass.options, outcome.reason);
			return;
		}
		reportMatches(context, member, pass, outcome);
	};
	visitors.after = () => {
		group.pass = null;
	};
	return visitors;
}
const messages = {
	yes: "[{{id}}] {{model}} answered yes ({{score}} >= {{cutoff}}): {{question}}",
	custom: "[{{id}}] {{message}} ({{model}} answered yes, {{score}} >= {{cutoff}})",
	unlocated: "oxlint-plugin-jev: {{reason}} while refining the location of [{{id}}]; the finding is reported at the file level"
};
const ALL_NODE_TYPES = Object.values(TARGET_NODE_TYPES).flat().filter((type) => type !== "Program");
const meta = {
	type: "problem",
	docs: { description: "Ask TypeSafe Jev a plain-English yes/no question about matched code and report when the yes-probability clears the rule's cutoff." },
	schema: [SCHEMA],
	defaultOptions: [DEFAULTS],
	messages
};
function listRule() {
	const group = {
		pass: null,
		filename: ""
	};
	const member = {
		options: (context) => optionsFor(context.options[0]),
		rules: (options) => options.rules
	};
	return {
		meta,
		createOnce: (context) => visitorsFor(group, member, context, ALL_NODE_TYPES)
	};
}
const plugin = {
	meta: { name: "jev" },
	rules: {
		ask: listRule(),
		suggest: listRule()
	}
};
/**
* Builds an oxlint plugin with one rule per question, named `<name>/<id>`, so each question's
* severity and on/off state live in the oxlint config. All of the plugin's enabled rules share one
* request per file.
*/
function createJevPlugin(options) {
	const { name, ...resolved } = checkPluginOptions(options);
	const group = {
		name,
		pass: null,
		filename: ""
	};
	const rules = {};
	for (const rule of resolved.rules) {
		const own = [rule];
		const member = {
			options: () => resolved,
			rules: () => own
		};
		const nodeTypes = TARGET_NODE_TYPES[rule.target].filter((type) => type !== "Program");
		rules[rule.id] = {
			meta: {
				type: "problem",
				docs: { description: rule.question },
				schema: [],
				messages
			},
			createOnce: (context) => visitorsFor(group, member, context, nodeTypes)
		};
	}
	return {
		meta: { name },
		rules
	};
}
//#endregion
export { createJevPlugin, plugin as default };
