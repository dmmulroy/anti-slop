import { RuleTester } from "oxlint/plugins-dev";

import { streamLargeFilesRule } from "./stream-large-files.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const streamLargeFile = [{ messageId: "streamLargeFile" }];

tester.run("anti-slop-effect/stream-large-files", streamLargeFilesRule, {
	valid: [
		"fs.stream(path)",
		"Stream.fromFile(path)",
		"fs.writeFile(path, content)",
		"fs.readDirectory(path)",
		"fs.readFile(path)",
		"fs.readFileString(filePath)",
		"fs.readFileString('config.toml')",
		"fs.readFileString('themes-by-mode.json')",
		"fs.readFileString(catalogPath)",
		"fs.readFileString(dialogFile)",
		// A built path that ends in a known file name.
		"fs.readFileString(path.join(directory, 'package.json'))",
		"fs.readFileString(path.resolve(root, '.git', 'config'))",
		"fs.readFileString(root + '/README.md')",
		// Sync reads and other receivers are not whole-file reads through a FileSystem service.
		"fs.readFileSync(logPath)",
		"buffer.readFile(logPath)",
		// The callback form takes a function, not an encoding.
		"fs.readFile(logPath, (error, data) => done(error, data))",
		`const hint = "consider streaming fs.readFile(logPath)";`,
		"// fs.readFile(logPath) is fine for small files",
	],
	invalid: [
		{ code: "await fs.readFileString('/data/large.txt')", errors: streamLargeFile },
		{ code: "fs.readFile('/var/log/app.log')", errors: streamLargeFile },
		{ code: "fs.readFileString(path.join(dir, fileName))", errors: streamLargeFile },
		{ code: "fs.readFileString(path.resolve(root, name))", errors: streamLargeFile },
		{ code: "fs.readFileString(dir + '/' + name)", errors: streamLargeFile },
		{ code: "fs.readFileString(path.join(root, 'exports', name))", errors: streamLargeFile },
		{ code: "fs.readFileString(files[index])", errors: streamLargeFile },
		{ code: "fs.readFileString(entry.path)", errors: streamLargeFile },
		{ code: "fs.readFileString(logPath)", errors: streamLargeFile },
		{ code: "fs.readFile(exportFile, 'utf8')", errors: streamLargeFile },
		{ code: "fs.readFileString(sessionJsonlPath, 'utf-8')", errors: streamLargeFile },
	],
});
