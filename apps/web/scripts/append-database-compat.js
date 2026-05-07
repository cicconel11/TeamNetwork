const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const databaseTypesPath = path.join(rootDir, "src", "types", "database.ts");
const footerPath = path.join(__dirname, "database-compat-footer.txt");
const marker = "// Compatibility aliases (app-wide imports depend on these exports)";

const databaseTypesSource = fs.readFileSync(databaseTypesPath, "utf8").trimEnd();

if (databaseTypesSource.includes(marker)) {
  process.exit(0);
}

const footer = fs.readFileSync(footerPath, "utf8").trim();
fs.writeFileSync(databaseTypesPath, `${databaseTypesSource}\n\n${footer}\n`);
