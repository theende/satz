// Copyright 2026 the Ende authors. MIT license.
/**
 * A small syntax highlighter for the languages documentation uses most. It
 * returns escaped HTML with tokens wrapped in `<span class="hl-…">`; style
 * those classes to color them:
 *
 * `hl-comment` `hl-string` `hl-number` `hl-keyword` `hl-builtin`
 * `hl-function` `hl-type` `hl-operator` `hl-punctuation` `hl-property`
 * `hl-tag` `hl-attr` `hl-variable` `hl-regex` `hl-inserted` `hl-deleted`
 * `hl-prompt`
 *
 * ```ts
 * import { highlight } from "@ende/satz/highlight";
 * import { assertEquals } from "@ende/assert";
 *
 * assertEquals(highlight("let a = 1;", "ts"), `<span class="hl-keyword">let</span> a <span class="hl-operator">=</span> <span class="hl-number">1</span><span class="hl-punctuation">;</span>`);
 * assertEquals(highlight("x = 1", "hcl"), undefined);
 * ```
 *
 * Each language is a list of regular expressions tried in order at each
 * position, with a stack of states for nested syntax (template literals, JSX,
 * HTML tags). It never drops or reorders characters, so an approximation only
 * ever costs color.
 *
 * @module
 */
import { escape } from "@ende/html";

interface Rule {
  /** The class without its `hl-` prefix, or `null` to leave the match plain. */
  cls: string | null;
  re: RegExp;
  /** Only try the rule when the last token (comments and whitespace aside) matches. */
  after?: RegExp;
  /** Enter this state after the match. */
  push?: string;
  /** Leave the current state after the match (never the last one). */
  pop?: true;
  /** Replace the current state after the match. */
  to?: string;
}

/** States by name; tokenizing starts in `root`. */
type Grammar = Record<string, Rule[]>;

function rule(cls: string | null, re: RegExp, options: Omit<Rule, "cls" | "re"> = {}): Rule {
  return { cls, re: new RegExp(re.source, re.flags + "y"), ...options };
}

/** Matches any of `list` as a whole word: not followed by a character in `wordChars`. */
function words(list: string, flags = "", wordChars = "\\w$"): RegExp {
  return new RegExp(`(?:${list.trim().split(/\s+/).join("|")})(?![${wordChars}])`, flags);
}

function span(cls: string, text: string): string {
  return `<span class="hl-${cls}">${escape(text)}</span>`;
}

function tokenize(code: string, grammar: Grammar): string {
  const stack = ["root"];
  let html = "";
  let plain = "";
  let last = "";
  let i = 0;

  while (i < code.length) {
    const rules = grammar[stack.at(-1)!]!;
    let matched: { rule: Rule; text: string; } | undefined;

    for (const candidate of rules) {
      if (candidate.after !== undefined && !candidate.after.test(last))
        continue;

      candidate.re.lastIndex = i;
      const text = candidate.re.exec(code)?.[0];

      if (text) {
        matched = { rule: candidate, text };
        break;
      }
    }

    if (matched === undefined) {
      const char = code[i]!;
      plain += char;

      if (!/\s/.test(char))
        last = char;

      i++;
      continue;
    }

    const { rule: { cls, push, pop, to }, text } = matched;

    if (cls === null) {
      plain += text;
    } else {
      html += escape(plain) + span(cls, text);
      plain = "";
    }

    if (cls !== "comment" && /\S/.test(text))
      last = text;

    if (pop && stack.length > 1)
      stack.pop();

    if (to !== undefined)
      stack[stack.length - 1] = to;

    if (push !== undefined)
      stack.push(push);

    i += text.length;
  }

  return html + escape(plain);
}

// Shared pieces.
const WHITESPACE = rule(null, /\s+/);
const DOUBLE_QUOTED = /"(?:[^"\\\n]|\\.)*"?/;
const SINGLE_QUOTED = /'(?:[^'\\\n]|\\.)*'?/;
const C_COMMENTS = [rule("comment", /\/\/.*/), rule("comment", /\/\*[\s\S]*?(?:\*\/|$)/)];
const NUMBER = rule("number", /(?<![\w$.])(?:0[xX][\da-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|(?:\d[\d_]*(?:\.\d[\d_]*)?|\.\d[\d_]*)(?:[eE][+-]?\d+)?)n?(?![\w$])/);

// JavaScript and TypeScript.
const JS_KEYWORDS = words(`
  abstract as async await break case catch class const continue debugger declare default delete do else enum export extends finally for
  from function get if implements import in infer instanceof interface is keyof let namespace new of override private protected public
  readonly return satisfies set static super switch this throw try type typeof using var void while with yield`);
const JS_BUILTINS = words(`
  true false null undefined NaN Infinity globalThis console Ende Deno window document Math JSON Object Array Promise String Number Boolean
  Symbol Error Map Set WeakMap Date RegExp URL BigInt Reflect`);
const JS_TYPES = words("string number boolean any unknown never void object bigint symbol");
// A `/` starts a regex rather than dividing after these.
const BEFORE_REGEX = /(?:^|[(,=:[!&|?{};+\-*%<>~^]|\b(?:return|typeof|case|do|else|in|of|void|yield|await|delete|throw|new))$/;
// A character of a template literal's text.
const TEMPLATE_TEXT = /(?:[^`\\$]|\\[\s\S]|\$(?!\{))/.source;
const NOT_AFTER_DOT = /(?:^|[^.])$/;
// A `<` starts a JSX element rather than comparing after these.
const BEFORE_JSX = /(?:^|[(,=:[?&|{};>]|\b(?:return|default|yield|await))$/;

function jsGrammar(jsx: boolean): Grammar {
  const element = rule("tag", /<(?:[A-Za-z][\w.:-]*)?(?=[\s/>{])/, { push: "jsxTag" });
  const root = [
    WHITESPACE,
    ...C_COMMENTS,
    rule("string", new RegExp(`\`${TEMPLATE_TEXT}*(?=\\$\\{)`), { push: "template" }),
    rule("string", new RegExp(`\`${TEMPLATE_TEXT}*\`?`)),
    rule("string", DOUBLE_QUOTED),
    rule("string", SINGLE_QUOTED),
    rule("regex", /\/(?![*/])(?:[^/\\\n[]|\\.|\[(?:[^\]\\\n]|\\.)*\])+\/[dgimsuyv]*/, { after: BEFORE_REGEX }),
    ...(jsx ? [{ ...element, after: BEFORE_JSX }] : []),
    NUMBER,
    // A name after a `.` is a property, never a keyword.
    rule("keyword", JS_KEYWORDS, { after: NOT_AFTER_DOT }),
    rule("function", /[A-Za-z_$][\w$]*(?=\s*(?:<[^<>()\n]*>)?\s*\()/),
    rule(null, /[A-Za-z_$][\w$]*/, { after: /\.$/ }),
    rule("builtin", JS_BUILTINS),
    rule("type", JS_TYPES),
    rule("type", /[A-Z][a-z][\w$]*/),
    rule(null, /[A-Za-z_$][\w$]*/),
    rule("punctuation", /\{/, { push: "root" }),
    rule("punctuation", /\}/, { pop: true }),
    rule("operator", /=>|\.\.\.|[=!]==?|[<>]=?|&&=?|\|\|=?|\?\?=?|\?\.?|[-+*/%&|^~]=?|[!=]/),
    rule("punctuation", /[()[\];,.:]/)
  ];

  return {
    root,
    template: [
      rule("punctuation", /\$\{/, { push: "root" }),
      rule("string", new RegExp(`${TEMPLATE_TEXT}+(?=\\$\\{)`)),
      rule("string", new RegExp(`${TEMPLATE_TEXT}*\`?`), { pop: true })
    ],
    jsxTag: [
      WHITESPACE,
      rule("tag", /\/>/, { pop: true }),
      rule("tag", />/, { to: "jsxText" }),
      rule("attr", /[A-Za-z_:][\w:.-]*/),
      rule("operator", /=/),
      rule("string", /"[^"]*"?|'[^']*'?/),
      rule("punctuation", /\{/, { push: "root" })
    ],
    jsxText: [
      rule("punctuation", /\{/, { push: "root" }),
      rule("tag", /<\/[\w.:-]*>/, { pop: true }),
      element,
      rule(null, /[^{<]+/)
    ]
  };
}

// Shell. Words run together with paths and URLs, so they are matched whole.
const SHELL_COMMAND_START = /(?<=(?:^|[|;&(]|\$\()[ \t]*)/m;
const SHELL: Grammar = {
  root: [
    WHITESPACE,
    rule("comment", /(?<=^|[\s;&|()])#.*/m),
    rule("string", /\$?'[^']*'?/),
    rule("string", /"(?:[^"\\]|\\[\s\S])*"?/),
    rule("variable", /\$(?:\{[^}\n]*\}?|[A-Za-z_]\w*|[0-9@#?$!*-])/),
    rule("keyword", words("if then else elif fi for while until do done case esac in function select return exit export local readonly unset", "", "\\w./-")),
    rule("function", new RegExp(SHELL_COMMAND_START.source + /[A-Za-z_.~/][\w.~/-]*(?![\w.~/-]*=)/.source, "m")),
    rule("attr", /(?<=\s)--?[A-Za-z][\w-]*/),
    rule("operator", /&&|\|\||[|&;<>]/),
    rule(null, /[\w./:@%+,~=-]+/)
  ]
};

// A console session: prompt lines (and their continuations) are shell, the
// rest is output.
function highlightConsole(code: string): string {
  let continued = false;

  return code
    .split("\n")
    .map(line => {
      if (continued) {
        continued = line.endsWith("\\");
        return tokenize(line, SHELL);
      }

      const prompt = /^([$>]) /.exec(line);

      if (prompt === null)
        return escape(line);

      continued = line.endsWith("\\");
      return span("prompt", prompt[1]!) + tokenize(line.slice(1), SHELL);
    })
    .join("\n");
}

const JSON_GRAMMAR: Grammar = {
  root: [
    WHITESPACE,
    ...C_COMMENTS,
    rule("property", /"(?:[^"\\\n]|\\.)*"(?=\s*:)/),
    rule("string", DOUBLE_QUOTED),
    rule("number", /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/),
    rule("builtin", words("true false null")),
    rule("punctuation", /[{}[\],:]/),
    rule(null, /\w+/)
  ]
};

const DIFF: Grammar = {
  root: [
    rule("comment", /^(?:@@|\+\+\+ |--- |diff |index ).*/m),
    rule("inserted", /^\+.*/m),
    rule("deleted", /^-.*/m),
    rule(null, /[^\n]+/)
  ]
};

const PYTHON: Grammar = {
  root: [
    WHITESPACE,
    rule("comment", /#.*/),
    rule("string", /[rRbBuUfF]{0,2}(?:"""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$))/),
    rule("string", /[rRbBuUfF]{0,2}(?:"(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.)*'?)/),
    rule("function", /@[\w.]+/),
    NUMBER,
    rule(
      "keyword",
      words(`
      and as assert async await break case class continue def del elif else except finally for from global if import in is lambda match
      nonlocal not or pass raise return try while with yield`),
      { after: NOT_AFTER_DOT }
    ),
    rule("builtin", words("True False None self print len range str int float list dict set tuple open super isinstance")),
    rule("function", /[A-Za-z_]\w*(?=\s*\()/),
    rule(null, /[A-Za-z_]\w*/),
    rule("operator", /->|[-+*/%@&|^~<>!=]=?|\*\*|\/\//),
    rule("punctuation", /[()[\]{};,.:]/)
  ]
};

const YAML: Grammar = {
  root: [
    WHITESPACE,
    rule("comment", /(?<=^|\s)#.*/m),
    rule("punctuation", /^(?:---|\.\.\.)(?=\s|$)/m),
    rule("property", /(?<=^[ \t]*(?:-[ \t]+)?)(?:"(?:[^"\\\n]|\\.)*"|'[^'\n]*'|[^\s#'"{}[\],:-][^:#\n]*?|-[^\s:#][^:#\n]*?)(?=[ \t]*:(?:[ \t]|$))/m),
    rule("string", DOUBLE_QUOTED),
    rule("string", /'[^'\n]*'?/),
    rule("variable", /[&*][\w-]+/),
    rule("number", /(?<![\w.-])-?\d+(?:\.\d+)?(?![\w.:-])/),
    rule("builtin", /(?<![\w-])(?:true|false|null|~)(?![\w-])/),
    rule("punctuation", /(?<=^[ \t]*)-(?=[ \t]|$)/m),
    rule("punctuation", /:(?=[ \t]|$)/m),
    rule("punctuation", /[,[\]{}|>]/),
    rule(null, /(?:[\w./@$%+~=-]|:(?![ \t]|$))+/m)
  ]
};

const HTML: Grammar = {
  root: [
    rule("comment", /<!--[\s\S]*?(?:-->|$)/),
    rule("comment", /<![A-Za-z][^>]*>?/),
    rule("tag", /<\/[\w:.-]*>?/),
    rule("tag", /<[A-Za-z][\w:.-]*/, { push: "tag" }),
    rule("builtin", /&(?:#\d+|#x[\da-fA-F]+|\w+);/),
    rule(null, /[^<&]+/)
  ],
  tag: [
    WHITESPACE,
    rule("tag", /\/?>/, { pop: true }),
    rule("attr", /[^\s"'=<>/]+/),
    rule("operator", /=/, { push: "value" })
  ],
  value: [
    rule("string", /"[^"]*"?|'[^']*'?|[^\s"'=<>`]+/, { pop: true }),
    rule(null, /\s+/, { pop: true })
  ]
};

const DOCKERFILE: Grammar = {
  root: [
    WHITESPACE,
    rule("comment", /(?<=^[ \t]*)#.*/m),
    rule(
      "keyword",
      new RegExp(
        /(?<=^[ \t]*)/.source +
          words("FROM RUN CMD LABEL EXPOSE ENV ADD COPY ENTRYPOINT VOLUME USER WORKDIR ARG ONBUILD STOPSIGNAL HEALTHCHECK SHELL MAINTAINER").source,
        "im"
      )
    ),
    rule("keyword", /(?<=\s)AS(?=\s)/i),
    rule("string", /"(?:[^"\\\n]|\\.)*"?|'[^'\n]*'?/),
    rule("variable", /\$(?:\{[^}\n]*\}?|\w+)/),
    rule("attr", /(?<=\s)--[\w-]+(?:=\S*)?/),
    rule(null, /[\w./:@%+,~=-]+/)
  ]
};

const INI: Grammar = {
  root: [
    WHITESPACE,
    rule("comment", /(?<=^[ \t]*)[#;].*/m),
    rule("comment", /(?<=\s)#.*/),
    rule("keyword", /(?<=^[ \t]*)\[\[?[^\]\n]*\]?\]?/m),
    rule("property", /(?<=^[ \t]*)[^\s=#;[][^=\n]*?(?=[ \t]*=)/m),
    rule("string", /"""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)/),
    rule("string", DOUBLE_QUOTED),
    rule("string", /'[^'\n]*'?/),
    rule("builtin", /(?<![\w-])(?:true|false)(?![\w-])/),
    rule("number", /(?<![\w.:/-])[+-]?\d[\d_]*(?:\.\d+)?(?![\w.:/-])/),
    rule("operator", /=/),
    rule("punctuation", /[,[\]{}]/),
    rule(null, /[\w./:@%+~-]+/)
  ]
};

const RUST: Grammar = {
  root: [
    WHITESPACE,
    ...C_COMMENTS,
    rule("attr", /#!?\[[^\]\n]*\]?/),
    rule("string", /b?r(#*)"[\s\S]*?(?:"\1|$)/),
    rule("string", /b?"(?:[^"\\]|\\[\s\S])*"?/),
    rule("string", /b?'(?:[^'\\\n]|\\(?:u\{[\da-fA-F]+\}|.))'/),
    rule("variable", /'[A-Za-z_]\w*/),
    rule("number", /(?<![\w.])\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?(?:[iu](?:8|16|32|64|128|size)|f32|f64)?(?![\w])/),
    rule("function", /[a-z_]\w*!/),
    rule(
      "keyword",
      words(`
      as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self
      static struct super trait true type unsafe use where while`)
    ),
    rule("function", /[A-Za-z_]\w*(?=\s*(?:::<[^<>()\n]*>)?\s*\()/),
    rule("type", words("i8 i16 i32 i64 i128 isize u8 u16 u32 u64 u128 usize f32 f64 bool char str Self")),
    rule("type", /[A-Z]\w*/),
    rule(null, /[A-Za-z_]\w*/),
    rule("operator", /->|=>|::|\.\.=?|&&|\|\||[-+*/%&|^!<>=]=?|\?/),
    rule("punctuation", /[()[\]{};,.:]/)
  ]
};

const JS = jsGrammar(false);
const JSX = jsGrammar(true);

const LANGUAGES: Record<string, (code: string) => string> = {};

for (
  const [names, grammar] of [
    ["sh bash shell zsh", SHELL],
    ["ts typescript js javascript mjs cjs mts cts", JS],
    ["tsx jsx", JSX],
    ["json jsonc json5", JSON_GRAMMAR],
    ["diff patch", DIFF],
    ["py python", PYTHON],
    ["yaml yml", YAML],
    ["html xml svg", HTML],
    ["dockerfile docker", DOCKERFILE],
    ["ini toml", INI],
    ["rs rust", RUST]
  ] as const
) {
  for (const name of names.split(" "))
    LANGUAGES[name] = code => tokenize(code, grammar);
}

for (const name of ["console", "shellsession"])
  LANGUAGES[name] = highlightConsole;

for (const name of ["text", "txt", "plaintext", "plain"])
  LANGUAGES[name] = escape;

/**
 * Highlights `code` written in `lang` (matched case-insensitively, e.g. `ts`,
 * `sh`, `json`).
 *
 * @returns The code as escaped HTML with `<span class="hl-…">` tokens, or
 * `undefined` if the language isn't supported.
 */
export function highlight(code: string, lang: string): string | undefined {
  return LANGUAGES[lang.toLowerCase()]?.(code);
}
