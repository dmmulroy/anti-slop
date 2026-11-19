import { RuleTester } from "oxlint/plugins-dev";

import { noDevEnvBranchRule } from "./no-dev-env-branch.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "tsx" } } });
const fakeResult = [{ messageId: "fakeResult" }];
const fakeValue = [{ messageId: "fakeValue" }];
const skippedCheck = [{ messageId: "skippedCheck" }];

tester.run("anti-slop/no-dev-env-branch", noDevEnvBranchRule, {
	valid: [
		// Development-only configuration: a local server URL built at runtime.
		`function getCurrentServerUrl() {
			if (import.meta.env.DEV) {
				const host = import.meta.env.VITE_SERVER_HOST ?? "localhost";
				return \`http://\${host}:\${import.meta.env.VITE_SERVER_PORT ?? "4096"}\`;
			}
			return location.origin;
		}`,
		// Skipping a side effect in development returns nothing fake.
		`async function startDaemon(userId: string) {
			if (import.meta.env.DEV && !import.meta.env.VITE_FORCE_DAEMON_IN_DEV) {
				logger.debug("Skipping daemon spawn in dev mode");
				return null;
			}
			return spawnDaemon(userId);
		}`,
		`export function initSentry() {
			if (import.meta.env.DEV) {
				console.info("Sentry disabled in development");
				return;
			}
			Sentry.init({ dsn });
		}`,
		`function checkForUpdates() {
			if (import.meta.env.DEV) return;
			updater.check();
		}`,
		// The production branch is not inspected.
		`function readSwapMode() {
			if (!import.meta.env.DEV) return "hover";
			return localStorage.getItem("swap") === "global" ? "global" : "hover";
		}`,
		// Development tooling and logging.
		`if (!import.meta.env.PROD) enableDevtools();`,
		`if (process.env.NODE_ENV !== "production") console.warn("Icon is missing a label");`,
		`const PluginHotReload = import.meta.env.DEV ? lazy(() => import("./hmr")) : undefined;`,
		`const hud = import.meta.env.DEV ? <FocusDebugHud /> : null;`,
		`const options = { environment: import.meta.env.DEV ? "local" : (import.meta.env.VITE_ENVIRONMENT ?? "prod") };`,
		// Choosing between constants is configuration.
		`const connectSources = import.meta.env.DEV ? ["http://localhost:3000"] : [];`,
		`function logConfig() {
			if (process.env.NODE_ENV === "development") return { level: "debug", pretty: true };
			return { level: "info", pretty: false };
		}`,
		// Test-mode branches belong to ai-guard's no-test-env-branch.
		`function getUser() {
			if (process.env.NODE_ENV === "test") return mockUser;
			return db.user.find();
		}`,
		// A parameter named isDev says nothing about the running mode.
		`function getUser(isDev: boolean) {
			if (isDev) return mockUser;
			return db.user.find();
		}`,
		// A reassigned flag cannot be trusted.
		`let isDev = process.env.NODE_ENV === "development";
		isDev = override;
		function getUser() {
			if (isDev) return mockUser;
			return db.user.find();
		}`,
		// Test, fixture, and config files may branch on the mode.
		{
			code: `function getUser() {
				if (process.env.NODE_ENV === "development") return mockUser;
				return db.user.find();
			}`,
			filename: "src/user.test.ts",
		},
		{
			code: `export const handler = () => (import.meta.env.DEV ? fakeOrders : loadOrders());`,
			filename: "src/mocks/handlers.ts",
		},
	],
	invalid: [
		{
			code: `export async function getUser(id: string) {
				if (process.env.NODE_ENV === "development") return mockUser;
				return db.user.findUnique({ where: { id } });
			}`,
			errors: fakeResult,
		},
		{
			code: `const data = import.meta.env.DEV ? fakeData : await fetchData();`,
			errors: fakeValue,
		},
		{
			code: `export function listUsers() {
				return import.meta.env.DEV ? [{ id: 1, name: "Ada" }] : db.users.findMany();
			}`,
			errors: fakeValue,
		},
		{
			code: `export async function POST(event: APIEvent) {
				if (import.meta.env.DEV || Resource.App.stage !== "production")
					return Response.json({ success: true, message: translate(event.request) });
				return handleEnterpriseRequest(event.request);
			}`,
			errors: fakeResult,
		},
		{
			code: `const isDev = process.env.NODE_ENV !== "production";
			export function verifyToken(token: string) {
				if (isDev) return true;
				return jwt.verify(token, key) !== null;
			}`,
			errors: skippedCheck,
		},
		{
			code: `export function requireAuth(request: Request) {
				if (__DEV__) return;
				if (request.headers.get("authorization") === null) throw new Unauthorized();
			}`,
			errors: skippedCheck,
		},
		{
			code: `const isDevelopment = () => process.env.NODE_ENV === "development";
			export async function currentUser() {
				let user = await session.user();
				if (isDevelopment()) {
					user = MOCK_USER;
				}
				return user;
			}`,
			errors: fakeValue,
		},
		{
			code: `export function orders() {
				if (import.meta.env.PROD) {
					return api.get("/orders");
				} else {
					return createStubOrders();
				}
			}`,
			errors: fakeResult,
		},
	],
});
