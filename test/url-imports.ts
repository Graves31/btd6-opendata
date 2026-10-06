// Node stand-in for Vite's `?url` imports (web/src/data/rounds/index.ts imports each set file that way): the
// import resolves to a module whose default export is the file's site path, as Vite would give in dev.
// Loaded with `node --import ./test/url-imports.ts` (package.json "test").
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(specifier, context, next) {
    if (!specifier.endsWith("?url")) return next(specifier, context);
    const file = fileURLToPath(new URL(specifier.slice(0, -4), context.parentURL)).split("\\").join("/");
    const web = file.split("/web/").pop()!;
    return { url: `data:text/javascript,export default ${encodeURIComponent(JSON.stringify(`/${web}`))}`, shortCircuit: true };
  },
});
