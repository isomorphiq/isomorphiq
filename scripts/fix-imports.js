#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const distDir = "./dist";

// Fix import statements to include .js extensions
function fixImports(filePath) {
	const content = fs.readFileSync(filePath, "utf8");

	// Fix relative imports
	const fixed = content.replace(/from ['"]\.\/([^'"]+)['"]/g, "from './$1.js'");

	fs.writeFileSync(filePath, fixed);
	console.log(`Fixed imports in ${filePath}`);
}

// Process all .js files in dist
function processDirectory(dir) {
	const files = fs.readdirSync(dir);

	for (const file of files) {
		const filePath = path.join(dir, file);
		const stat = fs.statSync(filePath);

		if (stat.isDirectory() && file !== "node_modules") {
			processDirectory(filePath);
		} else if (file.endsWith(".js")) {
			fixImports(filePath);
		}
	}
}

console.log("Fixing import extensions in compiled files...");
processDirectory(distDir);
console.log("Done!");
