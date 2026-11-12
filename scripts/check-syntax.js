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
        if (entry.isDirectory()) {
            if (entry.name !== "node_modules" && entry.name !== ".git") {
                walk(fullPath, predicate);
            }
        } else if (predicate(fullPath)) {
            checkJavaScript(fullPath, fs.readFileSync(fullPath, "utf8"));
        }
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
    let cursor = 0;
    let scriptNumber = 0;

    while (true) {
        const start = html.indexOf("<script", cursor);
        if (start === -1) break;
        const tagEnd = html.indexOf(">", start);
        const end = html.indexOf("</script>", tagEnd + 1);
        if (tagEnd === -1 || end === -1) break;

        const openingTag = html.slice(start, tagEnd + 1);
        const source = html.slice(tagEnd + 1, end);
        scriptNumber += 1;

        if (!openingTag.includes("src=") && source.trim()) {
            checkJavaScript(fullPath + "#inline-script-" + scriptNumber, source);
        }
        cursor = end + "</script>".length;
    }
}

if (failures.length) {
    process.stderr.write("\nSyntax check failed for " + failures.length + " script(s).\n");
    process.exitCode = 1;
} else {
    process.stdout.write("\nAll backend and inline frontend scripts passed syntax parsing.\n");
}
