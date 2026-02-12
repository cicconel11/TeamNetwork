import ts from "typescript";
import { readFile } from "fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export async function resolve(specifier, context, defaultResolve) {
  if (specifier === "next/server") {
    const result = await defaultResolve("next/server.js", context, defaultResolve);
    return { ...result, shortCircuit: true };
  }

  if (typeof specifier === "string" && specifier.startsWith("@/")) {
    const basePath = path.join(process.cwd(), "src", specifier.slice(2));
    const candidates = [
      basePath,
      `${basePath}.ts`,
      `${basePath}.tsx`,
      `${basePath}.js`,
      `${basePath}.jsx`,
      path.join(basePath, "index.ts"),
      path.join(basePath, "index.tsx"),
      path.join(basePath, "index.js"),
      path.join(basePath, "index.jsx"),
    ];

    for (const candidate of candidates) {
      try {
        const result = await defaultResolve(pathToFileURL(candidate).href, context, defaultResolve);
        return { ...result, shortCircuit: true };
      } catch {
        // try next candidate
      }
    }
  }

  try {
    const result = await defaultResolve(specifier, context, defaultResolve);
    // Node 20 requires shortCircuit to be explicitly set
    return { ...result, shortCircuit: true };
  } catch (err) {
    const error = err;
    const code =
      error && typeof error === "object" && "code" in error ? error.code : null;

    if (code !== "ERR_MODULE_NOT_FOUND") {
      throw error;
    }

    if (typeof specifier !== "string") {
      throw error;
    }

    const isRelative = specifier.startsWith("./") || specifier.startsWith("../") || specifier.startsWith("/");
    const hasExtension = /\.[a-zA-Z0-9]+$/.test(specifier);
    if (!isRelative || hasExtension) {
      throw error;
    }

    const candidates = [
      `${specifier}.ts`,
      `${specifier}.tsx`,
      `${specifier}.js`,
      `${specifier}.jsx`,
      `${specifier}/index.ts`,
      `${specifier}/index.tsx`,
      `${specifier}/index.js`,
      `${specifier}/index.jsx`,
    ];

    for (const candidate of candidates) {
      try {
        const result = await defaultResolve(candidate, context, defaultResolve);
        // Node 20 requires shortCircuit to be explicitly set
        return { ...result, shortCircuit: true };
      } catch {
        // try next candidate
      }
    }

    throw error;
  }
}

export async function load(url, context, defaultLoad) {
  if (!url.endsWith(".ts") && !url.endsWith(".tsx")) {
    return defaultLoad(url, context, defaultLoad);
  }

  const source = await readFile(new URL(url));
  const transpiled = ts.transpileModule(source.toString(), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
    },
    fileName: url,
  });

  return {
    format: "module",
    source: transpiled.outputText,
    shortCircuit: true,
  };
}
