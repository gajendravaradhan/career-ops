import fs from "node:fs";
import path from "node:path";

/**
 * Resolve an npm-generated Windows shim to its real JS/native entrypoint.
 * Prompts remain argv entries; no shell or PowerShell interpolation is used.
 */
export function prepareCliLaunch(binPath, args, platform = process.platform) {
  if (platform !== "win32") return { command: binPath, args };

  const ext = path.extname(binPath).toLowerCase();
  if (ext && ![".cmd", ".bat", ".ps1"].includes(ext)) return { command: binPath, args };

  const shimBase = ext ? binPath.slice(0, -ext.length) : binPath;
  const ps1Shim = `${shimBase}.ps1`;
  let wrapper;
  try {
    wrapper = fs.readFileSync(ps1Shim, "utf8");
  } catch {
    throw new Error(`Cannot safely launch Windows CLI shim ${binPath}: no readable npm PowerShell shim was found`);
  }

  for (const match of wrapper.matchAll(/["']\$basedir[\\/]([^"']+)["']\s+\$args/g)) {
    const target = path.resolve(path.dirname(ps1Shim), match[1].replace(/[\\/]/g, path.sep));
    if (!fs.existsSync(target)) continue;
    const targetExt = path.extname(target).toLowerCase();
    if ([".js", ".cjs", ".mjs"].includes(targetExt)) {
      return { command: process.execPath, args: [target, ...args] };
    }
    if ([".exe", ".com"].includes(targetExt)) return { command: target, args };
  }

  throw new Error(`Cannot safely launch Windows CLI shim ${binPath}: its executable target could not be resolved`);
}
