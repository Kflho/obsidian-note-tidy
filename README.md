# Note Tidy

Obsidian desktop plugin that tidies a vault: it brings externally-linked images into your vault, renames garbled image files, and typesets note text — spacing between Chinese / English / formulas, punctuation width, LaTeX layout, tags, block order and chat logs. Everything is available from the right-click menu or the command palette, for one note or the whole vault.

> Previously released as **Absolute Image Transfer** (`absolute-image-transfer`). The plugin id changed with v1.3.0 — see [Renaming](#renaming) if you are upgrading.

## What this plugin does

### 1. Transfer external images into the vault

Converts absolute-path image links like `file:///D:\Images\photo.png` or `C:\Users\...\pic.jpg` into standard Obsidian `![[...]]` wikilinks. The image file is copied into your vault (respecting your attachment folder settings) and the link is updated automatically.

**Example — before:**
```markdown
![|350](file:///D:\QQ_Data\Image\screenshot.png)
```

**Example — after:**
```markdown
![[Pasted image 20260420123045.png|350]]
```

### 2. Rename garbled images to a clean preset format

Finds images with messy filenames (e.g., `Q)\TN\Q)TNF]S%MRO@AI1(F[I]OYC.gif`, `%01...png`, `123.456.jpg`) and renames them to a configurable clean format. Renames the physical file AND updates all referencing notes across the vault.

**Default preset:** `Pasted image {YYYY}{MM}{DD}{HH}{mm}{ss}` → `Pasted image 20260420123045.png`

Customize the format in settings using placeholders: `{YYYY}`, `{MM}`, `{DD}`, `{HH}`, `{mm}`, `{ss}`.

### 3. Fix QQ/WeChat chat log formatting

Reformats exported chat logs from messy single-line timestamps into clean, indented format:

**Example — before:**
```
张三 2024/1/5 14:30:25你好，文件收到了吗
```

**Example — after:**
```
张三: 2024/01/05 14:30:25
	你好，文件收到了吗
```

Idempotent — running it multiple times on the same text won't produce duplicate newlines or extra whitespace.

The same command also fixes **broken leading indentation**, which is what copied QQ/WeChat text usually suffers from: a line starts with a space plus a tab (`" \t"`), or tabs with trailing spaces (`"\t\t "`). Indentation should be tabs only, with 4 spaces counting as one tab:

| Before | After | Rule |
|--------|-------|------|
| `" \tmessage"` | `"\tmessage"` | space + tab → tab |
| `"\t\t message"` | `"\t\tmessage"` | stray spaces around tabs removed |
| `"    message"` | `"\tmessage"` | 4 spaces = 1 tab (same column) |
| `"  message"` | `"message"` | 1–3 stray spaces before plain text or an image are dropped |
| `"  - sub item"` | unchanged | a list marker follows, so the indent is real nesting |
| `"  paragraph"` under a list item, after a blank line | unchanged | it is a paragraph inside that list item |

YAML frontmatter and anything inside a fenced code block (``` / ~~~) is never touched — there the indentation is syntax, not layout.

The same command also normalizes the whitespace of **block markers** — blockquotes (comments), lists and headings:

| Before | After | Rule |
|--------|-------|------|
| `" >quote"` | `"> quote"` | 1–3 stray spaces before `>` are dropped, and `>` gets a space before the text |
| `">>quote"` | `"> > quote"` | nested quotes written as one canonical form |
| `">[!note] title"` | `"> [!note] title"` | callout marker followed by a space |
| `"-    item"` | `"- item"` | list marker followed by exactly one space |
| `"1)   item"` | `"1) item"` | ordered list, same rule |
| `"##   heading"` | `"## heading"` | heading marker followed by one space |
| `"#tag"` | unchanged | no space after `#` → it is a tag, not a heading (adding a space would turn it into one) |
| `">   - nested"` | unchanged | indent after `>` means a nested block inside the quote |
| `"- item"` then `"  > quote"` | unchanged | the quote belongs to that list item — its indent is syntax |

The layout is configurable (see **Settings** below):

- Toggle each piece of header info independently — username, date, time
- Choose the body indent — tab, 2 spaces, 4 spaces, or none
- When a message contains both an image and text, choose whether the image goes above or below the text (or keep the original order)
- Choose how aggressively leading indentation is rewritten (off / smart / strict) — this also switches the block-marker fixes on and off
- Turn **tag layout** on to move inline `#tags` to the end of their block, and **tag sorting** to order them alphabetically
- Turn **content block sorting** on to sort a note's blocks by first letter

### 4. Set image size in one click

Replaces the usual find-and-replace chore with a command. Pick an image size once, then apply it to a note, a folder, or the whole vault.

**Example — before → after:**

```
![[photo.png]]              →  ![[photo.png|100]]
![[photo.png|300]]          →  ![[photo.png|100]]
![[photo.png|300x200]]      →  ![[photo.png|100]]
![[photo.png#outline]]      →  ![[photo.png#outline|100]]
![](https://x.com/a.jpg)    →  ![100](https://x.com/a.jpg)
![[photo.png|a caption]]    →  unchanged (alias is a caption, not a size)
![[notes.md]]               →  unchanged (not an image)
```

Why it is safer than a regex replace:

- **Only writes files that actually change.** Sizes that already match are left alone — no save, sync or diff noise from re-running it.
- **Case-insensitive extensions** and full format coverage (`png` `jpg` `jpeg` `gif` `bmp` `webp` `heic` `avif` `svg`).
- **Handles `|300x200`**, `#outline` fragments and Markdown images, which a simple `(\|\d+)?` pattern silently skips.
- **Never eats captions.** When the alias holds text instead of a number, the link is left untouched.
- **Preview before applying.** The dialog shows how many links will change and the first few before → after examples, updating live as you type.
- Leave both width and height empty to **remove** existing sizes.

### 5. Organize image locations

After you copy-paste a note, its short links such as `![[photo.png]]` still point at the image in the **original** folder — the note's own attachments folder has no such file. Move, rename or delete that original image and the note loses its pictures.

**Organize image locations** copies those images into the note's own attachment folder and repoints the links:

| Situation | What happens |
|-----------|--------------|
| Image lives elsewhere, nothing local | A copy is placed in the attachment folder, link repointed |
| An **identical** copy is already there | Link is repointed only — nothing duplicated |
| A **different** file with the same name is there | The copy is named `name 2.ext`; nothing is overwritten |
| The link is ambiguous (several files share the name) | Skipped, and the reason is reported |
| Image already sits in the right folder | Untouched |

Image contents are compared byte-for-byte before deciding, so two different pictures are never treated as the same one. When a file name exists in several folders the plugin writes the full path (e.g. `![[folderB/attachments/photo.png]]`) instead of a bare file name, so the link can never resolve to the wrong picture.

Available from the right-click **图片功能 → 整理…图片位置** submenu, and from the command palette (current note / entire vault).

### 6. Tag layout and content block sorting

Two optional layout features, both off by default because they rearrange text:

**Tag layout** — when a block contains both text and tags, the tags are moved to the end of the block, separated from the text by a single space. A paragraph counts as one block, a list item and a heading each count as one, and **a table is handled cell by cell** (moving a tag to the end of the row would shift the columns):

| Before | After |
|--------|-------|
| `"#math today I studied limits"` | `"today I studied limits #math"` |
| `"today I studied #math limits"` | `"today I studied limits #math"` |
| `"a sentence #note."` | `"a sentence. #note"` |
| `"- #tag item text"` | `"- item text #tag"` |
| `"> #tag quoted text"` | `"> quoted text #tag"` |
| `"\| #tag cell \| other \|"` | `"\| cell #tag \| other \|"` |
| `"#tag"` on its own line | unchanged (nothing but tags → position kept) |

**Tag sorting** — multiple tags in one place are ordered by first letter (Chinese by pinyin, numbers numerically): `"text #math #note"` → `"text #note #math"`.

Left untouched: frontmatter, fenced and indented code blocks, inline code, `%%comments%%`, wiki links and Markdown links (`[[note#heading]]`, `[text](url#anchor)`), `C#`, `#123`, and `#` written directly after a character. Rows without a leading `|` (non-standard tables) are also left alone.

**Content block sorting** — sorts a note's blocks by first letter (Chinese by pinyin, numbers numerically). Consecutive list items are sorted among themselves, consecutive paragraphs among themselves, so lists and paragraphs never interleave. Headings split the note into sections and are kept in place — sorting only happens between one heading and the next. Tables, images, horizontal rules, footnotes and chat log messages are anchors: they stay where they are and split the sorting range, so a copied chat log is never scrambled. Ordered lists are renumbered after sorting (only when the original numbers were a consecutive run).

### 7. Formula (LaTeX) layout

Rewrites the LaTeX code of formulas — `$$ … $$` blocks and inline `$…$` — so that **the spaces in the code match the spaces the formula renders with**. Inline formulas only get the spacing rules (commas, operators, braces); they are never split across lines, and `$…$` whose content touches the delimiters on both sides is left alone (which is how Obsidian decides what is inline math at all).

| Before | After | Rule |
|--------|-------|------|
| `$$\dot{x}=f(x, t)$$` | `$$\dot{x} = f(x, t)$$` | operators, relations and logic symbols get one space on each side (rule 1) |
| `$$a&b&c$$` | `$$a & b & c$$` | `&` and `\\` are layout symbols: one space on each side |
| `$$(-x)$$` | `$$(-x)$$` | a sign (`+x`, `-Q`) stays tight against its argument (rule 2) |
| `$$(x-x_e)$$` | `$$(x - x_e)$$` | …while a real subtraction gets spaces |
| `$$\begin{cases}-1 & x<0\\ 1 & x\ge0\end{cases}$$` | `-1` stays tight | the first element of an environment (`\begin{cases}`, `\begin{bmatrix}`) is also an "operand expected" position; so is every cell after `&` or `\\` |
| `$$x^-1$$` | `$$x^-1$$` | a sign right after `^` / `_` *is* the script, so it hugs what follows |
| `$$f'-g$$` | `$$f' - g$$` | a prime does not swallow the next token — that minus is a real subtraction and gets spaces on both sides |
| `$$a\pmod{n}$$` | `$$a \pmod{n}$$` | a relation command that takes an argument stays tight against it |
| `$$Λ或等价地A$$` | `$$Λ\text{或等价地}A$$` | Chinese written straight into a formula is wrapped in `\text{…}` (the spec's own formulas do this: `\text{i 为奇数}`); the first element of an environment also stays tight now (`\begin{cases}\le 0`) |
| `$$a_ij$$` | unchanged | multi-character scripts are **not** auto-braced: `a_ij` (a matrix element), `A^TP` (Aᵀ·P) and `k_mx_m` (k_m·x_m) are written exactly the same way, so guessing would silently change what the formula means |
| `$$\partial f$$` | `$$\partial{f}$$` | a command stays tight against its argument; braces keep the command name intact (rule 6) |
| `$$\sin x$$` / `$$\sin 2x$$` | `$$\sin{x}$$` / `$$\sin2x$$` | braces only where joining would swallow the name (`\sinx` is invalid, `\sin2x` is fine) |
| `$$A_{i}, \quadA_{j}$$` | `$$A_{i}, A_{j}$$` | a spacing command glued to a letter (`\quadA` — LaTeX reads it as an undefined command and the formula errors out) is split: when a comma or another separator is already there, the redundant spacing is dropped; otherwise it becomes `\quad{A}` |
| ``$$ x = 1 $$`` | ``$$x = 1$$`` | no space between `$$` and the content (rule 3) |
| ``$M=1$`` | ``$M = 1$`` | inline formulas get the same spacing rules |
| ``$y_{i,k}=C_ix_{i,k}+D_i u_{i,k}$`` | ``$y_{i, k} = C_ix_{i, k} + D_iu_{i, k}$`` | …and content that is joined in the rendering is joined in the code |
| `$$f(x,y)$$` | `$$f(x, y)$$` | a comma gets no space before it and one after |
| line breaks that are not `\\` | joined into one line | line breaks only where `\\` is (rule 5) |
| `\\`, then a new line | continuation indented one tab deeper | continuation = first line's indent + one tab; `\begin{}` adds nothing (rule 4) |

Example — a matrix inside a list item:

```
	说明$$T = (a, b){\begin{bmatrix}1 \\
		a & b \\
		\end{bmatrix}}$$
```

Untouched: frontmatter, fenced and indented code blocks, inline code, `\text{…}` / `\operatorname{…}` arguments (Chinese text and spaces inside are kept verbatim), formulas containing a `%` comment, and inline formulas containing `\\`. A stray `$$` no longer disables the whole note: a region that looks like prose (blank line, heading, fence, rule, or hundreds of lines) is skipped and the real formulas after it are still formatted.

### 8. Spacing layout (typesetting)

Where the LaTeX layout owns the code **inside** `$…$`, this one owns the spaces **between** Chinese, English, numbers, formulas and punctuation — the format the reader actually sees.

| Before | After | Rule |
|--------|-------|------|
| `用anki卡片记笔记` | `用 anki 卡片记笔记` | one space between Chinese and English (inline code, wikilinks, links and `#tags` count as English) |
| `第 3 章` | `第3章` | Chinese and numbers get **no** space (note rule), existing spaces are removed |
| `用GPT4写代码` | `用 GPT4 写代码` | runs that contain letters (`GPT4`, `3D`, `v1.2.2`, `100kg`) count as one English word, so model numbers stay in one piece |
| `设$x$为未知数` | `设 $x$ 为未知数` | one space between an inline formula and the text around it; never inside the `$…$` |
| `中文 ，内容 。` | `中文，内容。` | no space on either side of a full-width punctuation mark |
| `word,word` | `word, word` | half-width `, . ! ? :` get no space before and one after (decimals `1.2.2`, times `12:30` and `...` are exempt) |
| `如, ：`, `7. 并列：&` | `如,：`, `7. 并列：&` | two symbols next to each other stay tight as well — **a space only ever separates content of different languages**, never two symbols |
| `甲 & 乙`, `甲 \| 乙`, `甲 → 乙` | `甲&乙`, `甲\|乙`, `甲→乙` | a symbol stays tight against Chinese (existing spaces are removed): `&` is punctuation, `\|` and `→` are math symbols — Chinese and those get no space between them |
| `A & B`, `$A$ & $B$`, `word, word` | unchanged | the space is only ever called for between Chinese and **Western words / numbers / formulas** (W3C [clreq](https://www.w3.org/TR/clreq/): up to a quarter of a Han character wide; Han characters and punctuation are 1:1 squares set seamlessly) |
| `（ + ）`, `" + "`, `《 书名 》` | `（+）`, `"+"`, `《书名》` | a wrapper symbol (`（）` `《》` `“”` `""`) is **not content itself**: its inside is always tight, a symbol inside it is only *mentioned* and never asks for that space, while text inside keeps its own spacing (`《新 吊带袜天使》`) |
| `x ^ 2`, `等等 ... 内容` | `x^2`, `等等...内容` | the modifier `^` and the ellipsis `...` stay tight |
| `( x )` | `(x)` | no space just inside ASCII brackets |
| `100kg` (optional, off by default) | `100 kg` | one space between a number and a unit from the built-in list |
| `元素: $A$` | `元素：$A$` | half-width `, : ; ! ?` in Chinese context become full-width, and full-width `，。、；！？` in a **pure-English** line become half-width (`什么语境用什么标点`). The Chinese direction is judged per sentence, not per neighbouring character: the mark changes when the text before it is Chinese, the text after it is Chinese, or the sentence is Chinese-dominant (letters inside formulas, code and links do not count as English, and word count is used rather than letter count) — so `没有 $M_{ij}$, 且` → `没有 $M_{ij}$，且`. The English direction only fires when the line has **no Chinese at all and at least two English words**; half-and-half lines such as `参数 gain=50、shift=0` are left alone. `.` is never converted (ellipsis, version numbers, `e.g.`), and neither are `（）`, `：`, `《》`, marks after digits (`1,000`, `12:30`), after a backslash (`\,`), inside half-width brackets (`(mod, k)`), next to `/`, in the chat-log header (`张三: 2024/…`) or inside `《…》` / `“…”` |

Rule sources are the note-taking spec this plugin was built for: languages are separated by one character width, punctuation stays tight, and Chinese↔numbers stay tight. Two rules that would break proper nouns are off by default: English↔numbers (`GPT4`, `3D`, `v1.2.2`) and number↔unit. Symbols follow Chinese typography: a space is only ever called for between Han characters and Western letters/numbers (clreq §6.3.3, up to a quarter of a Han character wide, none at the line start or end), punctuation gets none of it, and Han characters with punctuation are 1:1 squares set seamlessly (§1.2) — the default of CSS `text-autospace` agrees (it spaces CJK against letters/numbers only; punctuation needs the explicit `punctuation` value).

Untouched: frontmatter, fenced and indented code blocks, `$$ … $$` blocks (including every line in between), **GFM table rows** (their spaces are alignment, and `|` is a cell separator), inline code, wikilinks and markdown links, URLs, HTML tags, `%%comments%%`, `#tags`, the inside of `《…》` / `〈…〉` / `“…”` (so 《新 吊带袜天使》 and 《a子计划》 keep their original form), Chinese-to-Chinese spaces, math operators (`ctrl+c` is never split), a pipe glued to letters or digits (`|x|`, `P(A|B)`, `x̂_{k|k}` — that is math notation) and the dot/ampersand inside single-letter abbreviations (`e.g.`, `i.e.`, `Q&A`, `R&D`).

Emphasis markers are transparent: the rules see the content they wrap, so `**可逆矩阵**$P$` becomes `**可逆矩阵** $P$` and `中文**English**中文` becomes `中文 **English** 中文`. Spaces are only ever added *outside* the markers — never between `**` and the text, which would stop the emphasis from rendering. A star that has no pair (`2*3`, `a*b`) is left alone.

Three details that matter on real notes:

- **A line that merely contains `$$…$$` is still formatted.** `1.矩阵指数$e^{At}$是$$…$$` used to be skipped as a whole (the line "is a formula"), so nothing on it was ever repaired. Now a same-line `$$…$$` pair is treated as one inline formula and the text around it is formatted; only the lines *between* a multi-line `$$ … $$` block are skipped, and the text before the opening `$$` / after the closing `$$` on those boundary lines is still formatted.
- **NBSP (`U+00A0`) counts as a space.** Text pasted from Word or a PDF often uses non-breaking spaces, which look identical to spaces but were invisible to the rules (`矩阵 A` would never be touched). Wherever a rule applies, the NBSP is normalized to a regular space; where no rule applies it is left as it is.
- **Whitespace-only lines become truly empty.** A line holding just tabs or spaces renders the same but leaves invisible indentation behind.

### 9. Plain-text math becomes formulas

Math symbols typed as plain text get wrapped in `$…$`, so they render as formulas and the formula layout can format them:

| Before | After | Rule |
|--------|-------|------|
| `矩阵 A` / `矩阵A` | `矩阵 $A$` | a single Latin letter next to Chinese is a variable |
| `n维` / `n 阶` / `n 次` | `$n$ 维` / `$n$ 阶` / `$n$ 次` | measure words count as the Chinese anchor too |
| `V(F)` / `a(b)` / `T(x)` | `$V(F)$` / `$a(b)$` / `$T(x)$` | a single letter plus a parenthesised argument |
| `x = 0` / `x = Tz` / `Ax = λx` | `$x = 0$` / `$x = Tz$` / `$Ax = \lambda x$` | the **whole expression** is wrapped — never just the letters, which would leave `= 0` outside the formula |
| `a, b ∈ F` | `$a, b \in F$` | commas, numbers and operators join the run |
| `特征值 λ` | `特征值 $\lambda$` | Greek letters (and `∈ ≤ ≥ × → …`) become LaTeX commands; a space is inserted when the command would swallow the next letter (`\lambdax` is invalid) |
| `$z$` written earlier, then `讨论 z 的模长` | `讨论 $z$ 的模长` | **variable table**: writing `z` as a formula declares "z is a variable", so every later plain `z` in the note is wrapped too — no context word needed |
| `$$z = a + bi$$` written earlier, then `因此 z 的实部` | `因此 $z$ 的实部` | variables inside a `$$…$$` block count as well (including multi-line blocks) |
| `$e^{At}$` written earlier, then `其中 A 是矩阵，t 是时间` | `其中 $A$ 是矩阵，$t$ 是时间` | letters inside a compound formula join the table; command names (`\sin`, `\mathrm`) and text-style arguments (`\text{max}`) do not |

Deliberately conservative — it rewrites prose, so "not sure" means "don't touch". A run is only wrapped when there is real evidence that it is math:

- the run contains parentheses or an operator (`V(F)`, `x = 0`, `a, b ∈ F`);
- a math noun sits right before it (`矩阵 A`, `向量 x`, `数域 F`, `特征值 λ` …);
- a measure word sits right after it (`n维`, `n 阶`, `k 行`);
- it contains a Greek letter (never anything else), or
- the same variable was already recognized earlier — earlier in the line (`矩阵 A …… 称为 A 的秩`), or anywhere in the note via the variable table.

The variable table has a few limits: it only reads formulas already present in **the same note** (`$…$` and `$$…$$`, multi-line blocks included) and never spans notes; `$z$` inside code blocks, inline code or frontmatter does not count; letters are case-sensitive (writing `$z$` does not make `Z` follow); the Chinese-anchor rule still applies, so English prose such as `the value z is` is untouched; and `_`/`^` names (`Q_inv`, `z^2`, `z_1`) stay untouched. Wrapped formulas become "existing formulas", so running the layout twice gives the same result.

Everything else is left alone: frontmatter, fenced/indented code, inline code, wikilinks, links, URLs, HTML tags, tags, comments, existing formulas (kept verbatim — they are only read into the variable table), the inside of `《…》` / `〈…〉` / `“…”` (so 《a子计划》 keeps its form), English prose, words of three letters or more (`Jordan`, `latex`, `Steinitz`), two-letter abbreviations with no expression around them (`AI`, `QQ`, `pg`, `tv`, `xx`), the two-letter function words (`is`, `to`), abbreviations (`e.g.`, `i.e.`), paths and extensions (`C:\data`, `main.ts`), model numbers (`A4`, `B5`), `_`/`^` naming conventions (`Q_inv`, `x^2`, `a_ij`), list labels (`(a)`, `(b)`), task checkboxes (`- [x]`) and letter-plus-proper-noun pairs (`C 语言`, `D 盘`, `A 股`). Turn the setting off to keep symbols as plain text.

## How to use

The right-click menu is grouped into two submenus so it stays short: **图片功能** (image tools) and **文本排版** (text layout). Both carry a `›` chevron at the right edge and open on hover or click — they use Obsidian's own submenu, so the parent menu stays open.

| Method | Action |
|--------|--------|
| Right-click a `.md` file | **图片功能**: convert / rename / organize locations / set size · **文本排版**: fix layout (spaces / indent / chat log / tags / formulas) |
| Right-click a folder | The same two submenus, applied to every note in that folder |
| Command palette (`Ctrl+P`) | Every menu action is also a command: convert images (current note / entire vault), rename garbled images (current note / entire vault), rename all images vault-wide (normal or forced), organize image locations (current note / entire vault), set image size (current note / entire vault), fix layout — spaces, indent, chat log, tags and formulas (current note / entire vault) |

### Settings

The settings tab follows the same split as the spec: **图片导入** / **图片大小** for images, **代码格式** for how source code (LaTeX) is written, **排版格式** for what the reader sees.

- **Attachment location** — where transferred images are stored (system default, vault root, current folder, subfolder, or custom path)
- **Image naming preset** — format for renamed images, supports `{YYYY}` `{MM}` `{DD}` `{HH}` `{mm}` `{ss}`
- **Link format after rename** — use full path (`folder/image.png`) or filename only (`image.png`)

Image size:

- **Default width** — pre-filled width in the size dialog, in pixels
- **Default height** — optional; leave empty to scale proportionally
- **Overwrite existing sizes** — when off, only images without a size are filled in

Chat log formatting:

- **Show username** — keep or drop the sender name
- **Show date** / **Show time** — keep or drop the date (`{YYYY}/{MM}/{DD}`) and time (`{HH}:{mm}:{ss}`)
- **Body indent** — tab, 2 spaces, 4 spaces, or none
- **Image position in mixed messages** — image above the text, below the text, or keep the original order
- **Blank line between messages** — only available when username, date and time are all turned off; inserts an empty line between adjacent messages so they stay visually distinct

All defaults reproduce the previous layout exactly, so existing notes are not reformatted until you change a setting.

Blank lines already present in the source text are always preserved.

**代码格式 (code format)** — how the source code is written:

- **Formula layout** — rewrite the LaTeX code inside `$$ … $$` (spacing, line breaks, indentation). Off by default; inline `$…$` is never touched

**排版格式 (layout format)** — what the reader actually sees. All of it is applied by the same "fix layout" command:

Math symbols:

- **Plain-text math becomes formulas** — on by default; `矩阵 A` → `矩阵 $A$`, `n维` → `$n$ 维`, `V(F)` → `$V(F)$`, `x = 0` → `$x = 0$`, `λ` → `$\lambda$`. A variable you already wrote as a formula (`$z$`) is remembered for the whole note. See section 9 for what is deliberately left alone

Word spacing:

- **Chinese ↔ English** — one character width (`space`, default) or keep as is. Inline code, wikilinks, links and tags count as English
- **Chinese ↔ numbers** — no space (`none`, default, removes existing spaces), one space (`space`), or keep as is
- **English ↔ numbers** — keep as is (default) or one space. Keeping it avoids splitting `GPT4`, `3D`, `v1.2.2`
- **Formula ↔ text** — one space (default) or keep as is; the space goes outside the `$…$` only

Punctuation and symbols:

- **No space next to full-width punctuation** — on by default; quotes and the inside of `《…》` are exempt
- **Half-width punctuation** `, . ! ? :` — no space before, one space after; on by default
- **Per-symbol spacing rules** — on by default. **A space only ever separates content of different languages**: a symbol stays tight against Chinese and against other symbols (`甲 & 乙` → `甲&乙`, `如, ：` → `如,：`), while `A & B`, `$A$ & $B$` and `word, word` keep their space. `^` and `...` stay tight, `||` and paired pipes stay tight, wrapper symbols are tight inside, and GFM table rows are skipped entirely
- **No space inside parentheses** `( x )` → `(x)`; on by default
- **One space between numbers and units** — off by default; units must be in the built-in list (`%`, `3D`, `4K`, `5G` are not units)
- **Half-width punctuation becomes full-width after Chinese** — on by default; `元素: $A$` → `元素：$A$`. Applies to `, : ; ! ?` only

Tags and blocks:

- **Tag layout** — move inline `#tags` to the end of their block, one space away from the text. Off by default
- **Tag sorting** — order the tags of one block by first letter (Chinese by pinyin, numbers numerically). Keeps the original order when off
- **Content block sorting** — sort a note's blocks by first letter, section by section. Off by default

Indentation and markers:

- **Leading indent fix** — smart (default: 4 spaces = 1 tab, tab/space mixes normalized, 1–3 stray spaces before plain text or images dropped, while list-item indentation and paragraphs inside list items are kept), strict (tabs only, every leading space dropped), or off. Smart/strict also normalize block markers: `" >quote"` → `"> quote"`, multiple spaces after a list or heading marker collapse to one. Turning it off switches all of these fixes off

Chat log:

- **Show username** — keep or drop the sender name
- **Show date** / **Show time** — keep or drop the date (`{YYYY}/{MM}/{DD}`) and time (`{HH}:{mm}:{ss}`)
- **Body indent** — tab, 2 spaces, 4 spaces, or none
- **Image position in mixed messages** — image above the text, below the text, or keep the original order
- **Blank line between messages** — only available when username, date and time are all turned off; inserts an empty line between adjacent messages so they stay visually distinct

## Supported formats

`png` `jpg` `jpeg` `gif` `bmp` `webp` `heic` (case-insensitive)

## Important

**Do not use Ctrl+Z after renaming images.** This plugin renames physical files on disk. Undoing in the editor reverts the text link but not the filename — causing broken images.

Back up your vault before bulk operations.

## Development

```bash
npm install     # install dependencies
npm run dev     # watch mode
npm run build   # type-check + bundle main.js
npm test        # test suite (no test framework needed)
npm run lint    # eslint
```

Feature logic is split into focused modules so it can be tested without Obsidian:

| Module | Responsibility |
|--------|----------------|
| `src/chat-log.ts` | chat log layout (username / date / time toggles, indent, image order, blank lines) |
| `src/text-pipeline.ts` | runs the layout steps in a fixed order: indent → markers → chat log → plain-text math → formulas → word spacing → tags → block sorting, and **iterates the whole pipeline to a fixed point** (at most 5 rounds, 1–3 in practice): a later step changes text an earlier step looked at — the space the number↔unit rule adds is what makes plain-text math recognise `5/10mm` as an expression, and normalizing `$w\approx 0$` to `$w \approx 0$` changes the key block sorting uses. Without the loop, "run it twice" would edit more lines than "run it once", so every save would rewrite the file |
| `src/text-math.ts` | plain-text math detection — `矩阵 A`, `n维`, `V(F)`, `x = 0`, `λ` → `$…$`, plus the variable table that reads variables out of the note's existing formulas |
| `src/inline-scan.ts` | shared inline protection — code spans, links, URLs, tags, comments, existing `$…$` |
| `src/text-layout.ts` | general layout fixes — leading indentation (4 spaces = 1 tab) |
| `src/markdown-markers.ts` | block marker spacing — blockquotes, lists, headings |
| `src/tags.ts` | tag layout — moving tags to the end of a block, per-cell tables, tag sorting |
| `src/block-sort.ts` | content block sorting — sections, anchors, ordered-list renumbering |
| `src/latex-layout.ts` | formula layout — spacing rules, `$$` delimiters, `\\` line breaks, continuation indent |
| `src/symbols.ts` | the per-symbol spacing table — the left/right requirement of `, . ! ? :`, `\|`, `&`, `→`, `^`, `...` and the wrapper symbols, each entry citing its rule in the note spec |
| `src/line-scan.ts` | shared protection rules — frontmatter, fenced code, indented code, `$$` formulas, GFM table rows |
| `src/collate.ts` | "first letter" comparison (Chinese by pinyin, numbers numerically) |
| `src/image-size.ts` | rewriting `\|100` / `\|100x200` sizes, caption-safe |
| `src/image-links.ts` | link resolution, same-name ambiguity detection, link form choice |
| `src/image-organizer.ts` | copying images into a note's own attachment folder and repointing links |
| `src/attachment-folder.ts` | resolving / creating the attachment folder (shared by several features) |

`npm test` runs expected-output checks, idempotency across every settings combination, blank-line and content-loss invariants, and the safety rules that keep captions, non-image links and same-name images untouched.

`test/commands.test.ts` boots the plugin against a stubbed Obsidian API and audits the entry points: every right-click menu action must have a matching command (and the reverse), command IDs are locked in, and both submenu paths — Obsidian's native `setSubmenu` and the fallback — must produce the same actions.

## Installation

1. Download `main.js`, `manifest.json`, and `styles.css` from [Releases](https://github.com/Kflho/obsidian-note-tidy/releases)
2. Place them in `.obsidian/plugins/note-tidy/`
3. Enable the plugin in Settings → Community Plugins

### Renaming

v1.3.0 renamed the plugin from `absolute-image-transfer` to `note-tidy`. Obsidian keeps settings per plugin id, so:

1. Rename the folder `.obsidian/plugins/absolute-image-transfer/` to `.obsidian/plugins/note-tidy/`
2. Copy `data.json` along with it (the settings schema is unchanged, so the file can simply be moved)
3. Reload Obsidian and enable **Note Tidy** (the old entry can be removed)

## Changelog

### v1.3.3
- New: **per-symbol spacing rules** (typesetting, on by default) — "spaces around symbols" is no longer limited to content neighbours; every rule answers two questions only: one space on the left, one on the right? (`有内容才有一格` is the shared premise of every space, not a special condition of one rule — at the start of a line there is nothing on the left, so nobody has to decide "no space" there)
  - `, . ! ? :` get one space after and none before (`word,word` → `word, word`); `：` annotates the **content** it follows and **yields when a symbol wants a space on its left**, so `如, ：` keeps its space instead of being eaten by "no space next to full-width punctuation" (`1. , /. /! /? /:：` → `1. , /. /! /? /: ：`)
  - a lone `|`, `&` and `→` get one space on each side (`|：单独一个` → `| ：单独一个`, `→：` → `→ ：`, `&：` → `& ：`); `^` and `...` stay tight (`x ^ 2` → `x^2`); `/` and `+ - = < > *` are left alone in prose (`a/b`, `ctrl+c`, `gain=50`, `nnunet==1.*` stay in one piece)
  - **wrapper symbols** (`（）`, `《》`, `“”`, a paired `"`) are **not content themselves**: their inside is always tight (`（ + ）` → `（+）`, `" + "` → `"+"`, `《 书名 》` → `《书名》`), a symbol inside one is only *mentioned* and never asks for that space, text inside keeps its own spacing (`《新 吊带袜天使》`), and the outside of half-width quotes is untouched
  - a pipe glued to letters or digits (`|x|`, `P(A|B)`, `x̂_{k|k}`) belongs to the math notation and is never touched; dots and ampersands inside single-letter abbreviations (`e.g.`, `i.e.`, `Q&A`, `R&D`) are exempt — this also fixes `e.g.` being split into `e. g.`; `||` (norm) and paired pipes stay tight
  - **GFM table rows are skipped entirely** — their spaces are alignment and `|` is a cell separator, not a symbol of the prose
  - the half/full-width conversion no longer touches a symbol that is being mentioned (`如, ：` keeps its `,`, `: ：` keeps its half-width colon). The old behaviour is what you get with the switch off: `如, ：` collapses to `如,：`
- Tests: `spacing` grew to 488 checks (new symbol, wrapper, abbreviation and table cases); new source file `src/symbols.ts` (the per-symbol table, each entry citing its rule in the note spec)

### v1.3.2
- New: **a variable table for plain-text math** — formulas already written in a note now back every occurrence of the same variable: once `$z$` is there, a later plain `z` is wrapped too (`设 $z$ 为复数。` followed by `讨论 z 的模长` → `讨论 $z$ 的模长`), with no context word needed. Variables inside `$$z = a + bi$$` blocks and compound formulas such as `$e^{At}$` (`e` / `A` / `t`) join the table as well. Only formulas in the same note are read — `$z$` inside code blocks, inline code or frontmatter does not count; letters are case-sensitive (writing `$z$` does not make `Z` follow); the Chinese-anchor rule still applies, and `_`/`^` names (`Q_inv`, `z^2`, `z_1`) stay untouched. See section 9
- Changed: the second `z` in `1. x = Tz：x 为原状态，z 为新状态` is now wrapped as well — `$x = Tz$` already declared z a variable
- Internal: because a freshly wrapped formula becomes a variable source for the next pass, plain-text math iterates to a fixed point (two or three passes in practice), so running the layout twice gives the same result; `test/text-math.test.ts` grew to 146 checks and `test/text-pipeline.test.ts` gained an end-to-end case

### v1.3.1
- Fixed: batch-operation notice suppression no longer writes inline styles — it toggles a CSS class instead. A suppressed notice container can no longer keep a stale inline `display: none` that hides other plugins' popups (as Image Converter's did)
- Settings now use Obsidian's declarative settings API (`getSettingDefinitions()`), so every option is findable in the settings search on Obsidian 1.13.0 and later. `display()` is kept as the fallback for older versions
- Compatibility: `window.clearTimeout()` and the cross-window `instanceOf()` check, so timers and node checks behave inside popout windows
- Internal: lint runs `eslint-plugin-obsidianmd` 0.4.2 — the version the community-plugin review uses — and `styles.css` no longer needs `!important`

### v1.3.0
- **Renamed**: the plugin is now **Note Tidy** with the id `note-tidy` (it outgrew "Absolute Image Transfer" — it has been doing full note typesetting for a while). To keep your settings, rename the plugin folder to `note-tidy` and move `data.json` with it; see [Renaming](#renaming)
- New: everything from v1.2.3 — **plain-text math becomes formulas** and **punctuation follows the language**; see below

### v1.2.3
- New: **plain-text math becomes formulas** (on by default) — `矩阵 A` / `矩阵A` → `矩阵 $A$`, `n维` / `n 阶` → `$n$ 维` / `$n$ 阶`, `V(F)` / `a(b)` → `$V(F)$` / `$a(b)$`, whole expressions (`x = 0`, `x = Tz`, `Ax = λx`, `a, b ∈ F`) are wrapped as one run, and Greek letters become LaTeX commands (`λ` → `$\lambda$`). It needs evidence before touching prose (brackets or operators, a math noun before, a measure word after, a Greek letter, or the same variable already seen on the line) and leaves English sentences, words of three letters or more, two-letter abbreviations (`AI`, `QQ`, `pg`, `tv`, `xx`), `e.g.`, `C:\path`, `A4`, `Q_inv`, list labels `(a)`, task checkboxes `- [x]`, `《…》` / `“…”` and existing formulas alone. See section 9
- New: **punctuation follows the language** — half-width `, : ; ! ?` become full-width in Chinese context (`没有 $M_{ij}$, 且` → `没有 $M_{ij}$，且`; the sentence as a whole is judged, not just the left neighbour, and letters inside formulas/code/links do not count as English), and full-width `，。、；！？` become half-width in pure-English lines (only when the line has no Chinese at all and at least two English words, so `参数 gain=50、shift=0` stays untouched). `（）`, `：`, `《》`, `.`, digits (`1,000`, `12:30`), `\,`, half-width brackets and the chat-log header are never converted
- Fixed: a line that merely **contains** `$$…$$` is no longer skipped as a whole — `1.矩阵指数$e^{At}$是…$$…$$` used to come out completely unrepaired. A same-line `$$…$$` pair now counts as one inline formula and the text around it is formatted; only the lines between a multi-line `$$ … $$` block are skipped, and the text before the opening `$$` or after the closing `$$` on those boundary lines still is
- Fixed: **NBSP** (`U+00A0`, what pasting from Word or a PDF produces) now counts as a space, so `矩阵 A` is finally repaired; whitespace-only lines become truly empty
- Fixed: **emphasis markers are transparent** — `**可逆矩阵**$P$` → `**可逆矩阵** $P$`, `中文**English**中文` → `中文 **English** 中文`. Spaces are only ever added outside the markers (never between `**` and the text, which would stop the emphasis from rendering), and unpaired stars (`2*3`, `a*b`) are left alone
- Fixed: unary vs binary `+` / `-` inside formulas. A sign at the start of an environment (`\begin{cases}-1`, `\begin{bmatrix}-1`), right after `^` / `_` (`x^-1`) and after a prime (`f'-g`) is now decided by "is an operand missing here?"; `\pmod{n}` no longer becomes `\pmod {n}`; `\Longrightarrow`, `\hookrightarrow`, `\nleq`, `\setminus`, `\uplus`, `\dagger` and more joined the relation table
- Fixed: Chinese written straight into a formula is wrapped in `\text{…}` (`Λ或等价地A` → `Λ\text{或等价地}A`), and an environment stays tight against its first element (`\begin{cases}\le 0`)
- New setting: **正文数学符号自动加公式**; the punctuation setting is now **标点全半角按语境** (both on by default)
- Tests: new `test/text-math.test.ts`; `spacing` grew to 396 checks; all layout steps verified idempotent against a 322-note vault

### v1.2.2
- New: **spacing layout** (typesetting) — it owns the spaces **outside** `$…$`, i.e. between Chinese, English, numbers, formulas and punctuation. One character width between Chinese and English (inline code, wikilinks, links and tags count as English), **no** space between Chinese and numbers (existing spaces are removed: `第 3 章` → `第3章`), one space around inline formulas, none on either side of full-width punctuation, half-width `, . ! ? :` get no space before and one after, no space inside brackets, and (off by default) one space between a number and a unit. Runs that contain letters (`GPT4`, `3D`, `v1.2.2`, `100kg`) count as one English word, so model numbers are never split; the inside of `《…》` / `〈…〉` / `“…”` is kept verbatim (《新 吊带袜天使》, 《a子计划》)
- New: the settings tab is grouped by feature — 图片导入 / 图片大小 / **代码格式** (formula code) / **排版格式** (word spacing, punctuation, tags & blocks, indentation, chat log)
- Fixed: unary vs binary `+` / `-` inside formulas. A sign at the start of an environment (`\begin{cases}-1`, `\begin{bmatrix}-1`) was spaced like a binary operator (`- 1`); `x^-1` became `x^- 1`; `f'-g` only received the right-hand space. All three now follow the same question — is an operand missing at this position?
- Fixed: `\pmod{n}` was rewritten as `\pmod {n}` (a relation command that takes an argument now stays tight against it), and `\Longrightarrow`, `\hookrightarrow`, `\nleq`, `\setminus`, `\uplus`, `\dagger` and more were added to the relation table
- Tests: new `test/spacing.test.ts` (8 rules, safety boundaries, 9 settings combinations × idempotency); 8 unary/binary regression cases for formulas

### v1.2.1
- Fixed: **a tag-only line had its tags moved away** — when such a line sat at the start or in the middle of a paragraph it was dropped entirely and its tags were appended to a neighbouring text line (`"first line"` / `"#tag"` / `"third line"` → `"first line"` / `"third line #tag"`), and two consecutive tag-only lines were merged into one. A tags-only line is now a block of its own: it keeps its position, its tags neither leak out nor receive tags from elsewhere, and the paragraph breaks there. Its own tags are still sorted

### v1.2.0
- Fixed: a line such as `" >quote"` (a stray leading space before a blockquote) used to be treated as meaningful indentation and skipped — nothing was repaired at all. It is now normalized to `"> quote"`, with a space between the marker and the text
- Fixed: a single stray `$$` used to disable formula formatting for the **whole note** (the `$$` count had to be even). Each `$$` is now paired with the next one that forms a plausible formula region — a region that looks like prose (blank line, heading, fence, rule, hundreds of lines) is skipped and the real formulas after it are still formatted
- Fixed: a vault-wide run stopped at the **first file that failed to read or write**, silently skipping every note after it — which looked like "the whole-vault command doesn't work, the single-note command does". A failing file is now logged and counted, and the run continues to the end; the summary reports how many notes were processed and how many failed
- Fixed: vault-wide runs now write through `vault.process` (atomic read-modify-write) so a note open in the editor with unsaved edits is no longer reverted
- Fixed: leading indent fix no longer treats `#tag` as a heading, so a stray space in front of a tag line is dropped
- New: block markers are normalized as well — nested quotes (`">>quote"` → `"> > quote"`), callouts (`">[!note]"` → `"> [!note]"`), multiple spaces after a list marker (`"-    item"` → `"- item"`) and after a heading marker (`"##   heading"` → `"## heading"`). `#tag` (no space after `#`) stays a tag and is never turned into a heading; indentation inside a list item or after `>` is preserved
- New: **tag layout** — when a block holds both text and tags, the tags move to the end of the block, one space away from the text. A paragraph is one block, a list item and a heading are one block each, and tables are handled **cell by cell** (the row would otherwise shift). Tags alone on a line keep their position. Frontmatter, fenced/indented code, `$$` formulas, inline code, `%%comments%%`, wiki links and Markdown links are left alone
- New: **tag sorting** — the tags of one block are ordered by first letter (Chinese by pinyin, numbers numerically)
- New: **content block sorting** — sorts a note's blocks by first letter. Headings split the note into sections; tables, images, rules, footnotes, formulas and chat log messages are anchors that stay in place and split the sorting range; lists and paragraphs are sorted separately so they never interleave; ordered lists are renumbered after sorting
- New: **formula layout** — rewrites the LaTeX code of `$$ … $$` blocks and inline `$…$` so the code's spaces match what the formula renders: `=` `+` `\le` `&` `\\` get one space on each side, a sign or a modifier command stays tight against its argument (`\delta x` → `\delta{x}`), a spacing command glued to a letter (`\quadA`) is repaired, commas get one space after, `$$` hugs the content, invisible whitespace is dropped, line breaks happen only at `\\`, and every continuation line is indented one tab deeper than the first. Inline formulas get the spacing rules only and are never split; `\text{…}` arguments, code blocks and inline formulas containing `\\` are left alone
- The result notice now reports how many notes were processed, how many failed, and which layout steps are enabled — so "why wasn't this note fixed" (a switch that is off) is visible at a glance
- Command callbacks return their promise, so the batch path can be driven from tests
- New modules `src/markdown-markers.ts`, `src/tags.ts`, `src/block-sort.ts`, `src/latex-layout.ts`, `src/text-pipeline.ts`, `src/line-scan.ts`, `src/collate.ts`, with tests for expected output, safety boundaries (frontmatter / code / links / list nesting / formulas) and idempotency; `test/commands.test.ts` now also covers the vault-wide batch path, including one failing file in the middle of the run

### v1.1.8
- The chat log command (and the **文本排版** submenu entry) now also fixes **broken leading indentation**: a line starting with space + tab (`" \t"`), tabs with trailing spaces (`"\t\t "`), a tab written as 4 spaces, or 1–3 stray spaces in front of plain text/an image is normalized to tabs only. `frontmatter` and fenced code blocks are left untouched, and indentation that carries meaning is preserved (a following list marker / `>` / `#` / `|` / fence, or a paragraph inside a list item after a blank line)
- New setting **Leading indent fix** — smart (default), strict (tabs only, list nesting flattened too), or off
- Fixed: a chat log header line that carried its own indentation (`" \t李四 2024/1/5 14:31:02"`) left that whitespace behind as an empty-looking line between messages; the header's indentation is no longer emitted as message body
- New module `src/text-layout.ts` plus `test/text-layout.test.ts` (expected outputs, safety guards for frontmatter / code blocks / nested lists / list-item paragraphs, idempotency, and idempotency of the combined indent + chat log pipeline)

### v1.1.7
- The **图片功能** / **文本排版** right-click submenus now use Obsidian's own submenu: a `›` chevron sits at the right edge of the entry and the submenu opens beside it on hover or click, with the parent menu staying open (keyboard left/right works too). On versions without that API the previous click-to-open behaviour is kept, with `›` shown in the title
- Fixed: **fix chat log formatting** and **rename garbled images** could only be reached from the right-click menu. Both are now commands as well (current note / entire vault), so every menu action has a command-palette twin
- New regression test: boots the plugin against a stubbed Obsidian API and audits both directions — every menu action has a command, command IDs stay stable, and both submenu paths produce the same actions

### v1.1.6
- New: **organize image locations** — finds images that a note references from *another* folder (the usual result of copy-pasting a note) and brings a copy into that note's own attachment folder, then repoints the link
  - If the attachment folder already holds an identical copy, the link is just repointed — nothing is duplicated
  - If a *different* file with the same name is there, the copy gets a ` 2` suffix instead of overwriting
  - Image content is compared byte-for-byte before deciding, so different images are never treated as the same
- Fixed: **wrong images after renaming / link rewriting.** When two images in different folders shared a file name, the fallback link resolver picked the first match and could rename the wrong file or repoint a link at the other image. It now only resolves when the target is unambiguous, otherwise it skips and says so
- Fixed: the same image, referenced from several notes, was renamed once per note during a vault-wide run (the name kept changing). Each image is now handled once per batch
- Fixed: with **Link format after rename** set to filename only, links were stripped to bare file names even when that name existed in several folders, creating ambiguous links that could display the wrong image. Ambiguous names now keep the full path
- Fixed: `#outline`-style fragments were dropped from links when link formats were normalized
- Fixed: Markdown image links at the end of a message body were split by the chat log sender matcher, which broke the link
- Chat log layout is now configurable: username, date and time can each be toggled independently
- Body indent can be set to tab, 2 spaces, 4 spaces or none
- Image position in mixed image + text messages can be set to above, below, or keep original order
- New option to insert a blank line between adjacent messages when all header info is hidden
- Fixed blank lines growing without bound: a message followed by a blank line and an unparseable sender name added one extra newline on every run
- Chat log layout no longer drops text when the username is hidden (the previous line's text could be consumed as a sender name)
- Right-click menu reorganised into two submenus, **图片功能** and **文本排版**
- New: set image size in one click — replaces the manual find-and-replace regex, with a dialog showing affected count and before → after preview
- Formatting engines extracted into `src/chat-log.ts`, `src/image-size.ts`, `src/image-links.ts`, `src/image-organizer.ts` and `src/attachment-folder.ts` as testable units; `npm test` covers expected outputs, idempotency across every settings combination, and the same-name safety rules

### v1.1.4
- Fixed `restoreNotices()` not clearing inline styles set by MutationObserver, which could permanently hide notice containers and break other plugins' popups (e.g. Image Converter)
- Track all suppressed elements in a `Set<HTMLElement>` and reset their CSS properties on restore
- Notices are now restored after a 5-second delay, allowing suppressed spam notices to expire naturally before unblocking
- Operation result notices (success/error) are now shown after unblocking, ensuring they are never suppressed

### v1.1.2
- Progress indicator uses the built-in status bar (not a floating overlay), updating per-image during single-file operations
- Notice suppression now covers all operation types, including single-file right-click actions
- MutationObserver backup for notice suppression to catch edge cases where CSS alone is insufficient

### v1.1.1
- CSS class `suppress-notices` added to `document.body` during batch operations, hiding system notification popups via `styles.css`
- Status bar progress for vault-wide and folder-wide operations with descriptive labels (e.g. `📷 图片重命名: 33/100`)

### v1.1.0
- Batch operation notice suppression via CSS
- Real-time progress labels in the status bar during transfer and rename operations
- Garbled image detection improvements: pure digit+dot filenames now recognized as auto-generated

### v1.0.9
- Non-greedy wikilink regex to handle filenames with embedded `]` brackets
- Three-layer garbled detection: special chars, URL-encoded residues, auto-generated patterns
- `resolveImageLink()` shared resolver with `getFirstLinkpathDest` fallback to global file search

### v1.0.8
- Vault-wide basename deduplication using pre-scanned `Map<basename, vaultPath>`
- Force rename mode: renames all images including those already matching the preset format
- Operation mutex lock (`isRenaming`) to prevent concurrent operations

### v1.0.6
- Link format setting: choose between full path or filename-only wikilinks after rename
- Images already matching the preset naming format are automatically skipped
- Batch progress shown in status bar instead of repeated notification popups

### v1.0.5
- Custom image naming presets with `{YYYY}` `{MM}` `{DD}` `{HH}` `{mm}` `{ss}` placeholders
- Right-click menu for renaming all images in a single file, folder, or entire vault
- Batch link format correction after all renames complete

### v1.0.4
- Chat log formatting for QQ/WeChat exported text
- WebP and HEIC format support

### v1.0.3
- Image size syntax preservation (`![|350]`) after conversion
- Hardened path resolution engine for special characters and URL-encoded paths

### v1.0.2
- Respects Obsidian system attachment folder settings
- Auto-creates nested attachment directories

### v1.0.1
- Garbled image detection and renaming for already-imported images
- Vault-wide link auto-update via Obsidian's `fileManager.renameFile` API

### v1.0.0
- Initial release: external image transfer with absolute path resolution

## License

MIT

---

## Documentation in other languages

- [中文说明 — Chinese guide](README.zh-CN.md)
