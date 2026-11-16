import { s as messageOf } from "./jev-BC3UITJZ.mjs";
import { fileURLToPath } from "node:url";
import { createSyncFn } from "synckit";
//#region src/sync-jev.ts
const BACKSTOP_MS = 6e4;
const SYNCKIT_TIMEOUT = "Internal error: Atomics.wait() failed: timed-out";
let call = null;
function workerCall() {
	call ??= createSyncFn(fileURLToPath(new URL("./worker.mjs", import.meta.url)), { timeout: BACKSTOP_MS });
	return call;
}
function askModel(input) {
	try {
		return workerCall()(input);
	} catch (error) {
		const message = messageOf(error);
		if (message === SYNCKIT_TIMEOUT) return {
			ok: false,
			reason: "timeout"
		};
		return {
			ok: false,
			reason: `network: ${message}`
		};
	}
}
//#endregion
export { askModel };
