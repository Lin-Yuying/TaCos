import { common, createLowlight } from "lowlight";

// The same grammars the fence language menu offers. Aliases keep a short info
// string (`ts`, `py`) highlighted without rewriting it in the stored Markdown.
export const documentLowlight = createLowlight(common);

documentLowlight.registerAlias({
  typescript: ["ts", "tsx"],
  javascript: ["js", "jsx"],
  python: ["py"],
  yaml: ["yml"],
  bash: ["sh", "zsh", "shell"],
  xml: ["html"],
  markdown: ["md"],
  ruby: ["rb"],
  rust: ["rs"],
  csharp: ["cs"],
  cpp: ["c++"],
});
