const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const backendDir = path.join(root, "backend");
const frontendDir = path.join(root, "front-end");
const failures = [];

function walk(directory, predicate) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) walk(fullPath, predicate);
        else if (predicate(fullPath)) checkJavaScript(fullPath, fs.readFileSync(fullPath, "utf8"));
    }
}

function checkJavaScript(filePath, source) {
    try {
        new vm.Script(source, { filename: path.relative(root, filePath) });
        process.stdout.write("OK  " + path.relative(root, filePath) + "\n");
    } catch (error) {
        failures.push({ file: path.relative(root, filePath), error: error.message });
        process.stderr.write("FAIL " + path.relative(root, filePath) + ": " + error.message + "\n");
    }
}

walk(backendDir, file => file.endsWith(".js"));

for (const file of fs.readdirSync(frontendDir).filter(name => name.endsWith(".html"))) {
    const fullPath = path.join(frontendDir, file);
    const html = fs.readFileSync(fullPath, "utf8");
    const scripts = [...html.matchAll(/<script(?:\\s[^>]*)?>([\\s\\S]*?)<\\/script>/gi)];
    scripts.forEach((match, index) => {
        if (match[1].trim()) checkJavaScript(fullPath + "#inline-script-" + (index + 1), match[1]);
    });
}

if (failures.length) {
    process.stderr.write("\\nSyntax check failed for " + failures.length + " script(s).\\n");
    process.exitCode = 1;
} else {
    process.stdout.write("\\nAll backend and inline frontend scripts passed syntax parsing.\\n");
}
