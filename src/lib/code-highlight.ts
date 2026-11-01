// A deliberately small highlighter: enough to tell keywords, strings, comments and
// numbers apart without pulling a grammar engine into the renderer. Every token keeps
// its exact source text, because the editor's ghost layer mirrors the textarea and any
// dropped space would move the caret.

export type CodeTokenKind = "plain" | "keyword" | "string" | "comment" | "number" | "builtin";

export interface CodeToken {
  text: string;
  kind: CodeTokenKind;
}

interface Grammar {
  keywords: Set<string>;
  builtins: Set<string>;
  lineComments: string[];
  block?: [string, string];
  quotes: string[];
  /** Python's triple-quoted strings run across lines; most languages stop at a newline. */
  tripleQuotes?: boolean;
  caseInsensitive?: boolean;
}

const words = (list: string) => new Set(list.split(/\s+/).filter(Boolean));

const PYTHON: Grammar = {
  keywords: words(
    "False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case type",
  ),
  builtins: words(
    "abs all any ascii bin bool breakpoint bytearray bytes callable chr classmethod compile complex delattr dict dir divmod enumerate eval exec filter float format frozenset getattr globals hasattr hash help hex id input int isinstance issubclass iter len list locals map max memoryview min next object oct open ord pow print property range repr reversed round set setattr slice sorted staticmethod str sum super tuple type vars zip self cls",
  ),
  lineComments: ["#"],
  quotes: ['"', "'"],
  tripleQuotes: true,
};

const JAVASCRIPT: Grammar = {
  keywords: words(
    "as async await break case catch class const continue debugger default delete do else enum export extends false finally for from function if implements import in instanceof interface keyof let new null of package private protected public readonly return satisfies set static super switch this throw true try type typeof undefined var void while with yield abstract declare namespace number string boolean any unknown never object symbol bigint",
  ),
  builtins: words("console document window Math JSON Promise Array Object String Number Boolean Map Set Date Error RegExp process require module exports fetch setTimeout clearTimeout"),
  lineComments: ["//"],
  block: ["/*", "*/"],
  quotes: ['"', "'", "`"],
};

const SHELL: Grammar = {
  keywords: words(
    "if then else elif fi for while until do done case esac function in select time coproc local export readonly declare unset shift source return exit",
  ),
  builtins: words("cd pwd echo printf read test exec eval set alias type trap wait true false"),
  lineComments: ["#"],
  quotes: ['"', "'"],
};

const SQL: Grammar = {
  keywords: words(
    "select from where group by order having limit offset join left right inner outer full on as and or not null is in like between exists union all distinct insert into values update set delete create table view index primary key foreign references default constraint alter add drop column case when then else end asc desc count sum avg min max",
  ),
  builtins: new Set(),
  lineComments: ["--"],
  block: ["/*", "*/"],
  quotes: ["'", '"', "`"],
  caseInsensitive: true,
};

const JSON_GRAMMAR: Grammar = {
  keywords: words("true false null"),
  builtins: new Set(),
  lineComments: [],
  quotes: ['"'],
};

const GO: Grammar = {
  keywords: words(
    "break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var",
  ),
  builtins: words("append cap close complex copy delete imag len make new panic print println real recover bool byte error float32 float64 int int8 int16 int32 int64 rune string uint uint8 uint16 uint32 uint64 uintptr true false nil"),
  lineComments: ["//"],
  block: ["/*", "*/"],
  quotes: ['"', "'", "`"],
};

const RUST: Grammar = {
  keywords: words(
    "as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while",
  ),
  builtins: words("String Vec Box Option Some None Ok Err Result println print vec format panic assert drop clone"),
  lineComments: ["//"],
  block: ["/*", "*/"],
  quotes: ['"'],
};

const JAVA_LIKE: Grammar = {
  keywords: words(
    "abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public record return sealed short static strictfp super switch synchronized this throw throws transient try var void volatile while yield async await foreach in out ref internal sealed namespace string bool decimal using virtual override params null nullptr true false",
  ),
  builtins: words("System String Math Integer Long Double Float List Map Set Console DateTime"),
  lineComments: ["//"],
  block: ["/*", "*/"],
  quotes: ['"', "'"],
};

const RUBY: Grammar = {
  keywords: words(
    "begin break case class def defined do else elsif end ensure false for if in module next nil not or redo rescue retry return self super then true undef unless until when while yield require require_relative attr_accessor attr_reader attr_writer",
  ),
  builtins: words("puts print p gets raise lambda proc loop"),
  lineComments: ["#"],
  quotes: ['"', "'"],
};

const PHP: Grammar = {
  keywords: words(
    "abstract and array as break callable case catch class clone const continue declare default do else elseif empty enddeclare endfor endforeach endif endswitch endwhile eval exit extends final finally fn for foreach function global goto if implements include include_once instanceof insteadof interface isset list match namespace new or print private protected public readonly require require_once return static switch throw trait try unset use var while xor yield true false null",
  ),
  builtins: new Set(),
  lineComments: ["//", "#"],
  block: ["/*", "*/"],
  quotes: ['"', "'"],
};

const C_LIKE: Grammar = {
  keywords: words(
    "auto break case char const continue default do double else enum extern float for goto if inline int long register return short signed sizeof static struct switch typedef union unsigned void volatile while class namespace template typename public private protected virtual override new delete using try catch throw bool true false nullptr",
  ),
  builtins: words("std printf scanf malloc free size_t string vector map unordered_map cout cin endl"),
  lineComments: ["//"],
  block: ["/*", "*/"],
  quotes: ['"', "'"],
};

const CONFIG: Grammar = {
  keywords: words("true false null yes no on off"),
  builtins: new Set(),
  lineComments: ["#", ";"],
  quotes: ['"', "'"],
};

const ALIASES: Record<string, string> = {
  py: "python",
  python3: "python",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  tsx: "typescript",
  sh: "bash",
  zsh: "bash",
  shell: "bash",
  yml: "yaml",
  rs: "rust",
  golang: "go",
  csharp: "csharp",
  cs: "csharp",
  cpp: "cpp",
  "c++": "cpp",
  rb: "ruby",
  pyi: "python",
};

function grammarFor(raw: string): Grammar | null {
  const lang = ALIASES[raw.toLowerCase()] ?? raw.toLowerCase();
  switch (lang) {
    case "python":
      return PYTHON;
    case "javascript":
    case "typescript":
      return JAVASCRIPT;
    case "bash":
    case "dockerfile":
      return SHELL;
    case "sql":
      return SQL;
    case "json":
      return JSON_GRAMMAR;
    case "go":
      return GO;
    case "rust":
      return RUST;
    case "java":
    case "kotlin":
    case "swift":
    case "csharp":
      return JAVA_LIKE;
    case "ruby":
      return RUBY;
    case "php":
      return PHP;
    case "c":
    case "cpp":
      return C_LIKE;
    case "yaml":
    case "toml":
    case "ini":
      return CONFIG;
    default:
      // Markdown, HTML, CSS and anything unknown stay unstyled rather than half-styled.
      return null;
  }
}

const NUMBER = /^(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?)/;
const WORD_START = /[A-Za-z_$]/;
const WORD = /[A-Za-z0-9_$]/;

export function tokenize(code: string, lang: string): CodeToken[] {
  const grammar = grammarFor(lang);
  const plain: CodeToken = { text: "", kind: "plain" };
  if (!grammar) return code ? [{ text: code, kind: "plain" }] : [];

  const out: CodeToken[] = [];
  const flush = () => {
    if (plain.text) out.push({ text: plain.text, kind: "plain" });
    plain.text = "";
  };
  const push = (text: string, kind: CodeTokenKind) => {
    flush();
    out.push({ text, kind });
  };

  let i = 0;
  const n = code.length;
  while (i < n) {
    if (grammar.block && code.startsWith(grammar.block[0], i)) {
      const end = code.indexOf(grammar.block[1], i + grammar.block[0].length);
      const stop = end === -1 ? n : end + grammar.block[1].length;
      push(code.slice(i, stop), "comment");
      i = stop;
      continue;
    }
    const lineStart = grammar.lineComments.find((c) => code.startsWith(c, i));
    // "#" only opens a comment at a word boundary: in bash `a#b` is still one word.
    if (lineStart && (lineStart !== "#" || !WORD.test(code[i - 1] ?? ""))) {
      let stop = code.indexOf("\n", i);
      if (stop === -1) stop = n;
      push(code.slice(i, stop), "comment");
      i = stop;
      continue;
    }
    if (grammar.tripleQuotes) {
      const triple = code.startsWith('"""', i) ? '"""' : code.startsWith("'''", i) ? "'''" : null;
      if (triple) {
        let end = code.indexOf(triple, i + 3);
        while (end !== -1 && code[end - 1] === "\\") end = code.indexOf(triple, end + 3);
        const stop = end === -1 ? n : end + 3;
        push(code.slice(i, stop), "string");
        i = stop;
        continue;
      }
    }
    const ch = code[i];
    if (grammar.quotes.includes(ch)) {
      let j = i + 1;
      while (j < n) {
        if (code[j] === "\\") {
          j += 2;
          continue;
        }
        if (code[j] === ch) {
          j += 1;
          break;
        }
        if (code[j] === "\n" && ch !== "`") break;
        j += 1;
      }
      push(code.slice(i, j), "string");
      i = j;
      continue;
    }
    if (ch >= "0" && ch <= "9" && !WORD.test(code[i - 1] ?? "")) {
      const match = NUMBER.exec(code.slice(i));
      if (match) {
        push(match[0], "number");
        i += match[0].length;
        continue;
      }
    }
    if (WORD_START.test(ch)) {
      let j = i + 1;
      while (j < n && WORD.test(code[j])) j += 1;
      const word = code.slice(i, j);
      const key = grammar.caseInsensitive ? word.toLowerCase() : word;
      const kind: CodeTokenKind = grammar.keywords.has(key)
        ? "keyword"
        : grammar.builtins.has(key)
          ? "builtin"
          : "plain";
      if (kind === "plain") plain.text += word;
      else push(word, kind);
      i = j;
      continue;
    }
    plain.text += ch;
    i += 1;
  }
  flush();
  return out;
}

/** Token text carries its newlines; the renderers that draw line by line want them split. */
export function splitTokensByLine(tokens: CodeToken[]): CodeToken[][] {
  const lines: CodeToken[][] = [[]];
  for (const token of tokens) {
    const parts = token.text.split("\n");
    parts.forEach((part, index) => {
      if (index > 0) lines.push([]);
      if (part) lines[lines.length - 1].push({ text: part, kind: token.kind });
    });
  }
  return lines;
}
