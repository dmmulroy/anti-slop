/** Whether a thrown value carries a string `message`, as every `Error` does, including errors from another realm. */
export const hasMessage = (cause: unknown): cause is { readonly message: string; readonly [key: string]: unknown } =>
	typeof cause === "object" && cause !== null && "message" in cause && typeof cause.message === "string";

/** The message of a thrown value, or its string form when it has none. */
export const errorMessage = (cause: unknown): string => (hasMessage(cause) ? cause.message : String(cause));
