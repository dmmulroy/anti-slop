import { RuleTester } from "oxlint/plugins-dev";

import { noUnboundedRetryRule } from "./no-unbounded-retry.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const imports = `
	import { Effect, Schedule, Stream } from "effect";
	import { HttpClient } from "effect/http";
`;
const unbounded = [{ messageId: "unboundedRetry" }];

tester.run("anti-slop-effect/no-unbounded-retry", noUnboundedRetryRule, {
	valid: [
		`${imports}
		const write = fs.rename(temp, file).pipe(Effect.retry({ times: 20, schedule: Schedule.spaced("10 millis") }));`,
		`${imports}
		const cached = Effect.retry(load, { schedule: Schedule.exponential("1 second"), times: 3, while: transient });`,
		// Effect 4.1 bounds a schedule with Schedule.upTo; cevr's 0.32.4 reports these.
		`${imports}
		const retryForAFewSeconds = Schedule.exponential("100 millis").pipe(Schedule.upTo({ duration: "5 seconds" }));
		const call = once.pipe(Effect.retry({ while: (error) => error.retryable, schedule: retryForAFewSeconds }));`,
		`${imports}
		const retrySchedule = Schedule.exponential("500 millis").pipe(Schedule.upTo({ times: 2 }));
		const answer = ask(prompt).pipe(Effect.retry(retrySchedule));`,
		`${imports}
		const resendRetrySchedule = Schedule.exponential(Duration.millis(250)).pipe(
			Schedule.setInputType<ResendError>(),
			Schedule.jittered,
			Schedule.upTo({ times: 3 }),
			Schedule.passthrough,
		);
		const send = (effect: Effect.Effect<void, ResendError>) =>
			Effect.retry(effect, { schedule: resendRetrySchedule, while: (error) => error.retryable });`,
		`${imports}
		const answer = ask(prompt).pipe(Effect.retry(Schedule.upTo(Schedule.spaced("1 second"), { times: 3 })));`,
		`${imports}
		const answer = ask(prompt).pipe(Effect.retry(Schedule.exponential("1 second").pipe(Schedule.max(Schedule.recurs(5)))));`,
		`${imports}
		const answer = ask(prompt).pipe(Effect.retry(Schedule.max(Schedule.spaced("1 second"), Schedule.recurs(3))));`,
		`${imports}
		const answer = ask(prompt).pipe(Effect.retry(Schedule.recurs(3)), Effect.retry(Schedule.during("1 minute")));`,
		// A later timeout bounds the elapsed time of the retry.
		`${imports}
		const vcs = request.pipe(Effect.retry(Schedule.spaced("10 millis")), Effect.timeout("2 seconds"));`,
		`${imports}
		const state = rpc.state(input).pipe(
			Effect.retry({
				while: (error) => error.type === "unavailable",
				schedule: Schedule.spaced("10 millis"),
			}),
			Effect.timeout("5 seconds"),
		);`,
		`${imports}
		const url = tunnelURL.pipe(
			Effect.retry({ schedule: Schedule.spaced("1 second") }),
			Effect.mapError(toTunnelError),
			Effect.timeoutOrElse({ duration: "3 minutes", orElse: () => Effect.fail(new TunnelTimeout()) }),
		);`,
		`${imports}
		const ready = check.pipe(Effect.retry(Schedule.forever)).pipe(Effect.timeoutOption("1 minute"));`,
		`${imports}
		const ready = Effect.timeout(Effect.retry(check, Schedule.spaced("1 second")), "10 seconds");`,
		`${imports}
		const poll = Effect.fn("poll")(function* () {
			return yield* check;
		}, Effect.retry(Schedule.forever), Effect.timeout("1 minute"));`,
		// Schedules the rule cannot read are left alone.
		`${imports}
		const done = stopped(pid).pipe(Effect.retry(poll(timing)), Effect.option);`,
		`${imports}
		import { retrySchedule } from "./schedules.ts";
		const answer = ask(prompt).pipe(Effect.retry(retrySchedule));`,
		`${imports}
		const answer = ask(prompt).pipe(Effect.retry(Schedule.spaced("1 second").pipe(withAttemptLimit)));`,
		`
		import * as Effect from "other-library";
		import * as Schedule from "other-library/Schedule";
		const answer = ask(prompt).pipe(Effect.retry(Schedule.forever));`,
	],
	invalid: [
		{
			code: `${imports}
			const authorization = client.execute(pollRequest).pipe(
				Effect.retry({
					while: (error) => error.response?.status === 403 || error.response?.status === 404,
					schedule: Schedule.spaced(pollDelayMs),
				}),
				Effect.mapError((cause) => deviceFlowError("Failed to poll device authorization", cause)),
			);`,
			errors: unbounded,
		},
		{
			code: `${imports}
			const changes = feed.pipe(Stream.retry(Schedule.spaced("5 seconds")), Stream.orDie);`,
			errors: unbounded,
		},
		{
			code: `${imports}
			const repositoryStatusReadRetry = Schedule.exponential("1 second").pipe(
				Schedule.jittered,
				Schedule.modifyDelay(({ duration }) => Effect.succeed(Duration.min(duration, Duration.seconds(30)))),
			);
			const status = readStatus.pipe(Effect.retry(repositoryStatusReadRetry));`,
			errors: unbounded,
		},
		{
			code: `${imports}
			const count = Effect.sync(() => subscriptions.length).pipe(
				Effect.filterOrFail((count) => count > 0),
				Effect.retry(Schedule.spaced("10 millis")),
			);`,
			errors: unbounded,
		},
		{
			code: `
			import * as Effect from "effect/Effect";
			import * as Schedule from "effect/Schedule";
			const ready = Effect.retry(check, Schedule.forever);`,
			errors: unbounded,
		},
		{
			code: `
			import * as HttpClient from "effect/http/HttpClient";
			import * as Schedule from "effect/Schedule";
			const client = base.pipe(HttpClient.retryTransient({ schedule: Schedule.exponential("100 millis") }));`,
			errors: unbounded,
		},
		{
			code: `${imports}
			const value = load.pipe(Effect.retryOrElse(Schedule.spaced("1 second"), () => fallback));`,
			errors: unbounded,
		},
		{
			code: `${imports}
			const value = Effect.retryOrElse(load, Schedule.fibonacci("1 second"), () => fallback);`,
			errors: unbounded,
		},
		// Schedule.min keeps recurring while either schedule does.
		{
			code: `${imports}
			const answer = ask(prompt).pipe(Effect.retry(Schedule.min(Schedule.spaced("1 second"), Schedule.recurs(3))));`,
			errors: unbounded,
		},
		// A timeout that runs before the retry does not bound it.
		{
			code: `${imports}
			const answer = ask(prompt).pipe(Effect.timeout("1 second"), Effect.retry(Schedule.forever));`,
			errors: unbounded,
		},
	],
});
