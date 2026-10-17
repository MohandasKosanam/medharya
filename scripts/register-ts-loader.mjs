import { register } from "node:module";

const sourceRoot = new URL("../src/", import.meta.url).href;
const loaderSource = [
  `const sourceRoot = ${JSON.stringify(sourceRoot)};`,
  "export async function resolve(specifier, context, nextResolve) {",
  '  if (specifier.startsWith("@/")) {',
  '    return nextResolve(new URL(specifier.slice(2) + ".ts", sourceRoot).href, context);',
  "  }",
  '  if (specifier.startsWith(".") && !/\\.[^/]+$/.test(specifier)) {',
  "    try {",
  "      return await nextResolve(specifier, context);",
  "    } catch (error) {",
  '      if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;',
  '      return nextResolve(specifier + ".ts", context);',
  "    }",
  "  }",
  "  return nextResolve(specifier, context);",
  "}",
].join("\n");

register(`data:text/javascript,${encodeURIComponent(loaderSource)}`, import.meta.url);
