import { s as messageOf } from "./jev-BC3UITJZ.mjs";
import { pathToFileURL } from "node:url";
import { runAsWorker } from "synckit";
import { createTypeSafeAi } from "@ai-sdk/typesafe-ai";
import { APICallError, InvalidResponseDataError, Output, RetryError, experimental_decide, gateway, generateText, jsonSchema } from "ai";
//#region src/worker.ts
let cached = null;
function typeSafeWith(apiKey, baseURL) {
	const key = JSON.stringify([apiKey, baseURL]);
	if (cached === null || cached.key !== key) cached = {
		key,
		provider: createTypeSafeAi({
			apiKey,
			baseURL
		})
	};
	return cached.provider;
}
const isAbort = (error) => error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
function reasonFor(error, lastAttemptError) {
	const cause = RetryError.isInstance(error) ? error.lastError : error;
	if (isAbort(cause)) return lastAttemptError === void 0 || isAbort(lastAttemptError) ? "timeout" : reasonFor(lastAttemptError, void 0);
	if (APICallError.isInstance(cause)) return cause.statusCode === void 0 ? `network: ${cause.message}` : `http ${cause.statusCode}: ${cause.message}`;
	return `${cause instanceof Error ? cause.name : "error"}: ${messageOf(cause)}`;
}
async function decide(backend, request, abortSignal, attempts) {
	const inner = backend.kind === "typesafe" ? typeSafeWith(backend.apiKey, backend.baseURL).decisionModel(backend.model) : gateway.decisionModel(backend.model);
	let last;
	const model = {
		specificationVersion: inner.specificationVersion,
		provider: inner.provider,
		modelId: inner.modelId,
		supportedQuestionTypes: inner.supportedQuestionTypes,
		doDecide: async (options) => {
			try {
				last = await inner.doDecide(options);
				attempts.lastError = void 0;
				return last;
			} catch (error) {
				attempts.lastError = error;
				throw error;
			}
		}
	};
	try {
		const result = await experimental_decide({
			model,
			state: request.state,
			questions: request.questions,
			abortSignal,
			providerOptions: backend.longContext ? { typesafe: { longContext: true } } : void 0
		});
		return {
			ok: true,
			model: result.response.modelId,
			answers: result.answers
		};
	} catch (error) {
		if (!InvalidResponseDataError.isInstance(error) || last === void 0) throw error;
		return {
			ok: true,
			model: last.response?.modelId ?? inner.modelId,
			answers: last.answers
		};
	}
}
const JUDGE_INSTRUCTIONS = "You are a code reviewer answering yes/no questions about code snippets. Each question names the snippet in `snippets` it is about. For every question id, set `violation` to true when the answer is yes, and `confidence` to your probability, between 0 and 1, that your answer is correct. Answer every question id.";
async function languageModelFor(backend) {
	if (backend.provider === void 0) return backend.model;
	const module = await import(pathToFileURL(backend.provider).href);
	const provider = typeof module === "object" && module !== null && "default" in module ? module.default : null;
	if ((typeof provider === "object" || typeof provider === "function") && provider !== null && "languageModel" in provider && typeof provider.languageModel === "function") return provider.languageModel(backend.model);
	throw new Error(`${backend.provider} must default-export an AI SDK provider or registry`);
}
const isJudgement = (value) => typeof value === "object" && value !== null && "violation" in value && typeof value.violation === "boolean" && "confidence" in value && typeof value.confidence === "number" && value.confidence >= 0 && value.confidence <= 1;
async function judge(backend, request, abortSignal) {
	const ids = Object.keys(request.questions).filter((id) => request.questions[id].type === "boolean");
	const judgement = {
		type: "object",
		additionalProperties: false,
		required: ["violation", "confidence"],
		properties: {
			violation: { type: "boolean" },
			confidence: {
				type: "number",
				description: "Probability between 0 and 1."
			}
		}
	};
	const schema = jsonSchema({
		type: "object",
		additionalProperties: false,
		required: ids,
		properties: Object.fromEntries(ids.map((id) => [id, judgement]))
	});
	const questions = Object.fromEntries(ids.map((id) => [id, request.questions[id].instructions]));
	const result = await generateText({
		model: await languageModelFor(backend),
		instructions: JUDGE_INSTRUCTIONS,
		prompt: JSON.stringify({
			snippets: request.state.snippets,
			questions
		}),
		output: Output.object({
			schema,
			name: "verdicts"
		}),
		abortSignal
	});
	const answers = {};
	for (const id of ids) {
		const verdict = result.output[id];
		if (!isJudgement(verdict)) continue;
		answers[id] = {
			type: "boolean",
			probability: verdict.violation ? verdict.confidence : 1 - verdict.confidence
		};
	}
	return {
		ok: true,
		model: result.response.modelId,
		answers
	};
}
runAsWorker(async ({ backend, request, timeoutMs }) => {
	const attempts = {};
	try {
		const signal = AbortSignal.timeout(timeoutMs);
		return backend.kind === "judge" ? await judge(backend, request, signal) : await decide(backend, request, signal, attempts);
	} catch (error) {
		return {
			ok: false,
			reason: reasonFor(error, attempts.lastError)
		};
	}
});
//#endregion
export {};
