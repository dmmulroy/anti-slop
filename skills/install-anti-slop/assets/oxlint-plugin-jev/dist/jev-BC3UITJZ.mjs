import { createHash } from "node:crypto";
//#region src/jev.ts
const messageOf = (error) => error instanceof Error ? error.message : String(error);
function truncateSnippet(text, maxChars) {
	return text.length <= maxChars ? text : `${text.slice(0, maxChars)}/* ...truncated */`;
}
const sourceLines = (text) => text.split(/\r\n|[\n\r\u2028\u2029]/);
function locates(match) {
	return Boolean(match.rule.location) && !match.truncated;
}
function locationCandidates(snippet, within) {
	const lines = sourceLines(snippet).map((text, index) => ({
		text,
		line: index + 1
	})).filter(({ text, line }) => text.trim() && (!within || line >= within.start && line <= within.end));
	const candidates = {};
	const width = Math.max(1, Math.ceil(lines.length / 254));
	for (let offset = 0; offset < lines.length; offset += width) {
		const start = lines[offset].line;
		const end = lines[Math.min(offset + width - 1, lines.length - 1)].line;
		candidates[start === end ? `L${start}` : `L${start}-L${end}`] = {
			start,
			end
		};
	}
	return candidates;
}
/** The snippet text as the model reads it: numbered when a location question refers to lines. */
function sentSnippet(match) {
	if (!locates(match)) return match.snippet;
	return sourceLines(match.snippet).map((text, index) => `L${index + 1}| ${text}`).join("\n");
}
const hash = (payload) => createHash("sha256").update(JSON.stringify(payload)).digest("hex");
function verdictAsk(backend, match) {
	const snippet = sentSnippet(match);
	const { question } = match.rule;
	return {
		key: hash({
			v: 4,
			backend,
			kind: "verdict",
			question,
			snippet
		}),
		kind: "verdict",
		snippet,
		question: (ref) => ({
			type: "boolean",
			instructions: `Consider only snippet "${ref}" in state.snippets. ${question}`
		})
	};
}
function locationAsk(backend, match, within) {
	const snippet = sentSnippet(match);
	const { question, location } = match.rule;
	const criteria = {
		...Object.fromEntries(Object.keys(locationCandidates(match.snippet, within)).map((key) => [key, null])),
		unknown: "No clear source location for this violation"
	};
	return {
		key: hash({
			v: 4,
			backend,
			kind: "location",
			question,
			location: location.question,
			snippet,
			within: within ?? null
		}),
		kind: "location",
		snippet,
		criteria,
		question: (ref) => ({
			type: "choice",
			instructions: `Consider only the numbered source in state.snippets.${ref}. If it violates this rule, select the line (or range containing that line) to annotate. Rule: ${question} Location: ${location.question} If multiple violations exist, select the earliest one. Select unknown if no violation exists or its location is unclear.`,
			criteria
		})
	};
}
/** One request for many asks. Identical snippets are sent once and identical asks asked once. */
function buildRequest(asks) {
	const snippets = {};
	const refBySnippet = /* @__PURE__ */ new Map();
	const questions = {};
	const idByKey = /* @__PURE__ */ new Map();
	const ids = asks.map((ask) => {
		const existing = idByKey.get(ask.key);
		if (existing !== void 0) return existing;
		let ref = refBySnippet.get(ask.snippet);
		if (ref === void 0) {
			ref = `s${refBySnippet.size}`;
			refBySnippet.set(ask.snippet, ref);
			snippets[ref] = ask.snippet;
		}
		const id = `q${idByKey.size}`;
		idByKey.set(ask.key, id);
		questions[id] = ask.question(ref);
		return id;
	});
	return {
		request: {
			state: { snippets },
			questions
		},
		ids
	};
}
function probabilityOf(answer) {
	if (typeof answer !== "object" || answer === null) return null;
	if (!("type" in answer) || answer.type !== "boolean" || !("probability" in answer)) return null;
	const { probability } = answer;
	return typeof probability === "number" && probability >= 0 && probability <= 1 ? probability : null;
}
function isChoiceAnswer(answer, criteria) {
	if (typeof answer !== "object" || answer === null || !("type" in answer) || answer.type !== "choice") return false;
	if (!("choice" in answer) || typeof answer.choice !== "string" || !Object.hasOwn(criteria, answer.choice)) return false;
	if (!("probabilities" in answer) || typeof answer.probabilities !== "object" || answer.probabilities === null) return false;
	const probability = answer.probabilities[answer.choice];
	return typeof probability === "number" && probability >= 0 && probability <= 1;
}
/** Whether an answer can be cached: a verdict needs a probability, a location a valid choice. */
function isValidAnswer(ask, answer) {
	return ask.kind === "verdict" ? probabilityOf(answer) !== null : isChoiceAnswer(answer, ask.criteria ?? {});
}
function selectedLocation(answer, candidates, cutoff) {
	if (!isChoiceAnswer(answer, {
		...candidates,
		unknown: null
	}) || !Object.hasOwn(candidates, answer.choice)) return null;
	return answer.probabilities[answer.choice] >= cutoff ? candidates[answer.choice] : null;
}
function locationOfLine(snippet, line) {
	const text = sourceLines(snippet)[line - 1];
	return {
		start: {
			line,
			column: text.search(/\S/)
		},
		end: {
			line,
			column: text.trimEnd().length
		}
	};
}
//#endregion
export { locationCandidates as a, probabilityOf as c, verdictAsk as d, locationAsk as i, selectedLocation as l, isValidAnswer as n, locationOfLine as o, locates as r, messageOf as s, buildRequest as t, truncateSnippet as u };
