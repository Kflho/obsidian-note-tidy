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

**Format conversion (built in — no other plugin needed).** With **Convert imported images to the target format** on (the default), each imported image is converted first and **then** written to the vault under the converted name (`png` → `webp`), so the link is written straight to the new file and no half-way png is ever created. The encoder is the **browser's own canvas** (`canvas.toBlob`), so nothing else has to be installed. There are also two commands, **Convert the whole vault to a chosen format** (**Settings → 图片导入 → 「转换图片格式」的目标格式**, default webp, quality in **转换质量**, default 75) and **Convert the current note's images**, which walk every image / the images one note embeds and convert the ones that are not in the target format — animated `gif` files and images already in the target format are always left alone. The conversion result is always used, **even when it ends up larger than the original**: the point is that the whole vault ends up in one format. Picking **`PNG（pngquant 压缩）`** as the target hands PNGs to **your own pngquant** instead (an external, GPL-licensed binary this plugin never bundles or downloads — see below). The same conversion is part of **整理图片** (see below), so the one-click tidy keeps the whole vault on the target format too. Renaming goes through Obsidian's own rename, so wikilinks, Markdown links and canvases are updated automatically.

**A conversion never loses an image.** Anything that cannot be decoded (HEIC / TIFF, which Chromium does not read), anything the encoder hands back in the wrong format, and anything pngquant refuses to compress (it exits with code 99 rather than saving a bad result) is simply kept as it is — one image fewer converted beats one byte written wrong. **Pasted images are taken over by this plugin** too (see section 4).

**Tidying images: convert + merge + clean** — one task, three entry points. The command **整理图片（转换格式 + 合并重复副本 + 清理没人引用的附件）** and the same entry in the **图片功能** right-click submenu ask for confirmation first; the **ribbon icon in the left sidebar** (on by default, **Settings → 图片整理 → 左侧栏放一个「整理图片」图标**) does the whole tidy in **one click** — that is the one to use if you want to replace the *Clear Unused Images* ribbon button (our icon deliberately reuses its `image-file` icon, so the button stays where you expect it). Four steps, always in this order: **rewrite links → trash duplicate copies → convert formats → clean up unreferenced images**. The conversion step converts every image that is not in the target format (switch **Settings → 图片整理 → 整理时转换图片格式**, on by default); it runs *after* the merge so copies that are about to be trashed are never converted first, and `gif` files and images already in the target format are never touched. The tidy merges images with byte-identical content and keeps one copy: only duplicates **in the same folder** are merged, because those are the "pasted the same picture twice" accidents — identical images in *different* folders are left alone on purpose, since that is what **organize image locations** does when it gives every note its own copy. Pairs are found by grouping on folder + byte size first (no disk reads) and then comparing bytes (no hashing, so no collision risk). The copy that notes reference the most stays, links pointing at the others are rewritten to it (wikilinks, Markdown links and canvases), and the extras go to the trash. The last step cleans up **unreferenced images** — implemented here, no Clear Unused Images needed: it scans every note and canvas for image filenames, and images no document mentions go to the trash. Only images are touched (pdfs, audio and anything else are never candidates), and it can be switched off in **Settings → 图片整理 → 整理时清理没人引用的附件**. There is a standalone command for it as well: **清理没人引用的图片**, which asks for confirmation first.

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
- **Blank line between messages** (off by default) — a master switch, independent of the header toggles: off keeps adjacent messages tight (blank lines the paste itself carried are dropped too), on leaves exactly one empty line between them
- **Adjacent messages in time order** (on by default) — see below
- **Drop @-mentions** (off by default) — see below
- Choose how aggressively leading indentation is rewritten (off / smart / strict) — this also switches the block-marker fixes on and off
- Turn **tag layout** on to move inline `#tags` to the end of their block, and **tag sorting** to order them alphabetically
- Turn **content block sorting** on to sort a note's blocks by first letter

**Adjacent messages are put back in time order.** QQ / WeChat do not copy a selection in the order you see it: the text messages are grouped together and the images are appended at the end (or the other way round), so a pair like "text at 19:41:37, two screenshots at 19:41:38" arrives with the images first — the layout then faithfully reproduces that, and the images end up above the text of the *previous* message. With this switch on (the default) the formatting compares the timestamps of **adjacent** messages and emits them in time order:

- only messages that are adjacent — nothing but blank space between them — are reordered. Content of your own between two messages (a `06集` heading, a paragraph) is never moved, and the messages around it are left alone;
- a run is only reordered when every message in it has a comparable timestamp of the same shape (all with a date, or all time-only). A mix, or a timestamp the plugin cannot read, means "leave it as it is";
- turn it off and the paste order is kept exactly as it arrived.

**Only the blank line and the next message header end a body.** A message body runs until a blank line or the next message header — which is how multi-line messages work. Formatting a whole note therefore has one honest limit: if you write something of your own directly under a message with no blank line in between (an episode heading such as `06集`, a note, your own screenshots), the whole-note pass has no way to tell it apart from that message's text, so it is treated as part of the body and indented with it. The same thing happens in reverse when your own line is the indented one (the editor's auto-indent) and the pasted text is not. That is not something more rules can fix reliably — **select the block you want formatted and use 排版选中内容 instead** (see below), which has no such ambiguity.

**Typeset just the selection** (command **排版选中的内容**, entry **排版选中内容（Note Tidy）** in the note right-click menu, on by default) — formats *only* the selected text and leaves the rest of the note untouched, one character included. It runs the same two steps as the quick chat-log fix, but scoped to the selection:

1. images the selection references by absolute path (`file:///D:\…`, `C:\…`) are copied into the vault and the links become `![[…]]`;
2. the layout rules run on that text only.

The result replaces the selection in the editor (so <kbd>Ctrl</kbd>+<kbd>Z</kbd> undoes it, and nothing is written to disk), and the menu entry only appears while something is selected. Practical use: paste a chat log, select it, run this — the messages around it are never touched, so no pass has to guess where a message ends. The indent and the seams work exactly as they do for a paste (see **Fix on paste** below): a selection inside a list item or a quote stays on that level, and the line breaks around it are left as they were.

**@-mentions can be dropped** (**Settings → 排版格式 → 聊天记录 → 去掉 @ 提及**, off by default, because it deletes words): in a group chat every reply starts with `@昵称`, and the nickname points at nobody once the log is in your vault. With the switch on:

| Before | After |
|--------|-------|
| `@徐晃何许人也 这才叫邪恶反派` | `这才叫邪恶反派` |
| `你说的对 @张三 就是这样` | `你说的对 就是这样` |
| `@张三 @李四 大家好` | `大家好` |
| `＠张三 大家好` (full-width `＠`) | `大家好` |
| `发到 foo@bar.com 就行` | unchanged (`@` inside a word is not a mention) |
| `@张三` on a line of its own | the whole line goes away (no indentation-only line is left behind) |

**Quick chat-log fix** — one entry in the command palette and in the right-click menus that does both jobs at once: transfer the external-path images referenced by this note, then fix the note's layout (spaces / indent / chat log / tags / formulas). Chat logs pasted out of QQ / WeChat usually carry `file:///D:\…` images and messy spacing, so one click leaves them clean.

**Fix on paste** (on by default, **Settings → 排版格式 → 聊天记录**) tidies a chat log the moment you paste it — and it only touches **the text you just pasted**. The gate is at least **two** message headers (a username before a timestamp), so mentioning `会议 14:30:25` in prose does not trigger it and copying a single message (which carries no header) does not either.

How it knows which part is "just pasted": the paste event itself is only used to note *where* the paste happened (that event fires before the text is in the document — the insertion is done by CodeMirror's own handler afterwards), and as soon as the editor reports the change, everything from that position to the cursor is the pasted text. That range is read back, checked with the same "does this look like a chat log" test, and then reformatted in place: the images it references by absolute path are copied into the vault, the layout rules run on it, and the result is written back through the editor. So:

- **your own lines are never touched** — no pass has to guess where a message ends (see the selection command above for the manual version);
- **the indent follows where you pasted.** The layout engine only ever sees the pasted text, so it used to start at column 0 and leave the first line wherever the cursor was — paste inside a list item (after pressing Enter, where the editor already indented you by two spaces) and the block landed half in, half out. The pasted block now sits on top of the indentation at the cursor (the leading whitespace and any `>` quotes of that line), every line of it, headers included: **whatever indent the cursor sits at is the indent the block gets**, plus the body indent from your settings (the block's own level is stripped before formatting and put back afterwards, so the two can never eat each other — with tabs on both sides, pasting at one tab used to come out at one tab instead of two). Nothing else is consulted — looking at the neighbouring lines to veto it ("both are flush, so you may not be indented either") was tried and removed, since putting the cursor at a column is an explicit instruction;
- **the seam is left alone.** The formatter always ends a chat log with a newline, which used to add a blank line between the pasted block and whatever followed it. The number of line breaks before and after the pasted text is now restored to what it was, so a paste never changes the spacing around it;
- nothing is written to disk by the plugin: the change goes through the editor's normal save path, and one <kbd>Ctrl</kbd>+<kbd>Z</kbd> undoes it;
- if the editor never reports a change (that paste was swallowed by another plugin, or the view is not a Markdown view), the pending fix is dropped after 5 seconds — better to do nothing than to touch the note.

Turn the switch off and nothing happens automatically — the commands and the menu entries still work.

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

**Sizing on paste** (**Settings → 图片大小 → 粘贴图片时自动套用默认尺寸**, on by default) applies the same preset automatically to whatever you paste: images this plugin stores for you while taking the paste over, screenshots another plugin saves, or image links that came along inside pasted text. It only rewrites the range you just pasted — the rest of the note is untouched, nothing is written to disk, and one <kbd>Ctrl</kbd>+<kbd>Z</kbd> takes it back. Paste several images at once and each one is handled: when this plugin takes the paste over it stores them one by one and writes everything back in a single edit; for a paste another plugin handled the plugin keeps watching that spot for a few seconds rather than giving up after the first. Images that already carry a size follow the **Overwrite existing sizes** switch above, and the step is skipped entirely when the width is empty (that setting means "remove sizes" — not something a paste should do on its own) or the width/height is not a number. When the pasted text is a chat log, the sizing rides along in the *same* edit as the layout fix, so a single undo reverses both.

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
| `( x )`, `中文 (说明)`, `f (x)` | `(x)`, `中文(说明)`, `f(x)` | no space on either side of an ASCII bracket (rule 3) — the `f(x)` function style; in an English sentence the outside keeps its word spacing |
| `100kg` (optional, off by default) | `100 kg` | one space between a number and a unit from the built-in list |
| `元素: $A$` | `元素：$A$` | half-width `, : ; ! ?` in Chinese context become full-width, and full-width `，。、；！？` in a **pure-English** line become half-width (`什么语境用什么标点`). The Chinese direction is judged per sentence, not per neighbouring character: the mark changes when the text before it is Chinese, the text after it is Chinese, or the sentence is Chinese-dominant (letters inside formulas, code and links do not count as English, and word count is used rather than letter count) — so `没有 $M_{ij}$, 且` → `没有 $M_{ij}$，且`. The English direction only fires when the line has **no Chinese at all and at least two English words**; half-and-half lines such as `参数 gain=50、shift=0` are left alone. `.` is never converted (ellipsis, version numbers, `e.g.`), and neither are `（）`, `：`, `《》`, marks after digits (`1,000`, `12:30`), after a backslash (`\,`), inside half-width brackets (`(mod, k)`), next to `/`, in the chat-log header (`张三: 2024/…`) or inside `《…》` / `“…”` |

Rule sources are the note-taking spec this plugin was built for: languages are separated by one character width, punctuation stays tight, and Chinese↔numbers stay tight. **[`docs/规则登记表.md`](docs/规则登记表.md) is the full traceability table** — every rule with the spec item it implements, the setting that switches it, the module that implements it and the test that guards it (`npm test` fails if any of the four drifts). Two rules that would break proper nouns are off by default: English↔numbers (`GPT4`, `3D`, `v1.2.2`) and number↔unit. Symbols follow Chinese typography: a space is only ever called for between Han characters and Western letters/numbers (clreq §6.3.3, up to a quarter of a Han character wide, none at the line start or end), punctuation gets none of it, and Han characters with punctuation are 1:1 squares set seamlessly (§1.2) — the default of CSS `text-autospace` agrees (it spaces CJK against letters/numbers only; punctuation needs the explicit `punctuation` value).

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
| `x - 1` / `n - 1` / `a + b` | `$x - 1$` / `$n - 1$` / `$a + b$` | a binary operator needs **one space on each side** to count as an expression |
| `x=0` / `a+b+c` / `5/10mm` / `A-7` / `cd /d` / `x -1` | left alone | anything glued is never guessed at — it may be a designation, a hyphen, a shell command, or simply missing spaces. Prefix signs are modifiers and stay exempt, so `x = -1` is still wrapped |
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

Everything else is left alone: frontmatter, fenced/indented code, inline code, wikilinks, links, URLs, HTML tags, tags, comments, existing formulas (kept verbatim — they are only read into the variable table), the inside of `《…》` / `〈…〉` / `“…”` (so 《a子计划》 keeps its form), English prose, words of three letters or more (`Jordan`, `latex`, `Steinitz`), two-letter abbreviations with no expression around them (`AI`, `QQ`, `pg`, `tv`, `xx`), the two-letter function words (`is`, `to`), abbreviations (`e.g.`, `i.e.`), paths and extensions (`C:\data`, `main.ts`), model numbers and designations (`A4`, `B5`, `A-7`, `F-22`), operators that are not spaced on both sides (`x=0`, `a+b+c`, `5/10mm`, `cd /d`), `_`/`^` naming conventions (`Q_inv`, `x^2`, `a_ij`), list labels (`(a)`, `(b)`), task checkboxes (`- [x]`) and letter-plus-proper-noun pairs (`C 语言`, `D 盘`, `A 股`). Turn the setting off to keep symbols as plain text.

### 10. List numbering and heading levels

Two "guarantee-style" fixes, **on by default**, that only touch what is out of line:

**List numbering** — every list starts at 1. A list whose first number is not 1 is renumbered from 1 upwards; a list that already starts at 1 is never touched, so a deliberate `1. 1. 1.` (letting Markdown count) or `1. 5. 9.` stays as written. Blank lines do not split a list (loose lists are one list), while paragraphs, code blocks and tables do; nested lists each start at 1; numbers get no leading zeros.

| Before | After | Rule |
|--------|-------|------|
| `3. a` / `4. b` | `1. a` / `2. b` | first number is not 1 → renumber the whole list |
| `2. parent` / `⇥3. child` / `4. parent2` | `1. parent` / `⇥1. child` / `2. parent2` | each nested list starts at 1 |
| `1. a` / `1. b` | unchanged | already starts at 1 |
| `2. a` / blank / `text` / blank / `3. b` | `1. a` / blank / `text` / blank / `1. b` | a paragraph splits the list |

**Heading levels** — a sub-heading sits exactly one level below its parent: `#### child` right under `# parent` becomes `## child`, siblings stay siblings, and coming back up lands on the right parent. **When several headings change at once, every new level is computed from the original levels in a single pass** rather than from the previous heading's new level — otherwise `# → ### → ###` would be computed as `# → ## → ###` and turn two sibling sections into nested ones, drifting further with every heading. The first heading keeps its own level (a note starting at `##` usually continues a hierarchy from somewhere else). Frontmatter, code blocks, `#tags` and headings inside blockquotes are left alone.

| Before | After | Rule |
|--------|-------|------|
| `#` / `####` | `#` / `##` | a skipped level is flattened |
| `#` / `###` / `###` | `#` / `##` / `##` | siblings stay siblings |
| `#` / `###` / `##` | `#` / `##` / `##` | coming back up gives siblings, not parent/child |
| `##` / `#####` | `##` / `###` | the first heading sets the base |

### 11. Copy images as files to the clipboard

Most "copy image" implementations in Obsidian copy a **bitmap**: QQ, Word and WeChat accept it, but Windows Explorer does not — pasting into a folder gives you nothing at all ([the exact complaint this was built for](https://forum-zh.obsidian.md/t/topic/40964); Image Toolkit and Image Context Menus both behave this way).

This plugin puts the **file** on the clipboard instead, so pasting into a folder produces the real `图片.png`:

| Where you paste | What you get |
|-----------------|--------------|
| A folder in Explorer (or any file manager) | The actual image file(s) — copied, not moved |
| QQ / WeChat / Word | The picture itself (a bitmap is added alongside for a single image) |
| A text editor | Nothing — the text format is deliberately not written (some apps paste twice when both text and files are present) |

**Several images at once**: select the text containing the images and use the menu / command — the menu shows **复制 3 张图片（Note Tidy）**. Images are deduplicated (the same picture embedded twice is copied once) and ambiguous same-name links are skipped rather than guessed, exactly like the plugin's other image features.

**Text and images together**: if the selection contains words as well as images, the text comes along — so pasting into QQ / WeChat gives you the sentence *with* the pictures in place, not just the images. That copy carries an HTML flavour (CF_HTML) with the picture data embedded, plus the plain text:

| What you selected | Paste into a folder | Paste into QQ / WeChat |
|-------------------|---------------------|------------------------|
| Images only (e.g. just `![[图片.png]]`) | The image file(s) | The picture |
| Text + images | *(nothing — this copy carries no file list, see below)* | The text and the pictures, in order |

Why the two differ: a clipboard entry that carries a **file list** makes QQ and WeChat upload the file and ignore everything else — the sentence never shows up ([the exact problem](https://www.wsisp.com/helps/30963.html) other plugins hit). So the mixed copy sends HTML + text only, with the images inlined as `data:` URLs (a browser-engine chat client will not load a local `file:///` image from pasted HTML). Consequences worth knowing:

- to paste image **files** into a folder, select the images alone (or use the 复制图片 menu item on an image);
- images are inlined up to 8 MB per image / 16 MB in total — a bigger photo falls back to its `file:///` path, which Word and friends still resolve;
- mixed copy is Windows-only; on macOS this plugin puts the files on the clipboard (AppleScript can only write one flavour at a time).

Where to find it (the menu item always carries **（Note Tidy）** — Obsidian's own image menu already has a *复制图片* item, and it is the bitmap one):

- **Right-click a rendered image in a note** (reading view and Live Preview) → **复制图片（Note Tidy）** is *added* to the menu. Nothing is replaced: Obsidian's own items and other plugins' items stay exactly where they were;
- **Right-click inside the editor with the caret on an image link** (or with images selected) → the same item, appended to Obsidian's own editor menu;
- **Command palette** → **复制图片到剪贴板（可在文件夹中粘贴为文件）** (assign a hotkey if you like);
- **Just press <kbd>Ctrl</kbd>+<kbd>C</kbd>** with the images selected (or the cursor on one) — off by default, switch it on under **Settings → Note Tidy → 复制 → 接管 Ctrl+C**. Same rules as above: only inside the note body, and words in the selection are copied along with the pictures.

### Managing the context menus

Because items are inserted into the existing menus (rather than taking them over), the plugin can also **show you what is in each menu and switch entries on and off**. Three menus are covered:

| Menu | What it is | This plugin adds |
|------|------------|------------------|
| 图片 | right-click a rendered image in a note | 复制图片 · 快速设置图片大小 · 快速修复聊天记录 · 管理右键菜单 |
| 笔记 | right-click the note text | 复制图片 · 快速设置图片大小 · 快速修复聊天记录 · 管理右键菜单 |
| 文件夹 | right-click a file or folder in the file explorer | 管理右键菜单 (your own 图片功能 / 文本排版 submenus are already there) |

- right-click once in the menu you care about, then use **管理右键菜单…（Note Tidy）** in it (or run **管理右键菜单** from the command palette) → the panel lists what was in that menu — Obsidian's own entries, other plugins' and this plugin's;
- **a switch that is on means the entry shows up**; turn it off to hide that entry. This plugin's own entries have their own switches and can never be hidden by the entry list itself;
- everything is stored in **Settings → Note Tidy → 右键菜单**, where the list can also be edited as plain text (`图片：标题` / `笔记：标题` / `文件夹：标题`).

**Platforms**: Windows (PowerShell writes the file list and, for a single image, the bitmap in one clipboard payload) and macOS (`osascript` + `POSIX file`, Finder pastes the file). Linux is not supported yet — the command reports it instead of failing silently.

## How to use

The right-click menu is grouped into two submenus so it stays short: **图片功能** (image tools) and **文本排版** (text layout). Both carry a `›` chevron at the right edge and open on hover or click — they use Obsidian's own submenu, so the parent menu stays open.

| Method | Action |
|--------|--------|
| Right-click a `.md` file | **图片功能**: convert / rename / organize locations / **整理图片** (convert formats + merge duplicate copies + clear unreferenced attachments) / set size · **文本排版**: fix layout (spaces / indent / chat log / tags / formulas), quick chat-log fix (transfer external images + fix layout) |
| Right-click a folder | The same two submenus, applied to every note in that folder (**整理图片** is vault-wide either way, and always asks first) |
| Right-click an image (in a note, or its link in the editor) | **复制图片（Note Tidy）** is added to the menu — copies the image file itself, so it can be pasted into a folder, or into QQ / Word as a picture. Select a range first to copy several images at once (**复制 3 张图片（Note Tidy）**). The same menu also gets **快速设置图片大小（Note Tidy）** (applies the default size to the note, no dialog), **快速修复聊天记录（Note Tidy）** (transfers the note's external images and fixes its layout in one go), **排版选中内容（Note Tidy）** (select some text first — only that text is formatted, the rest of the note is untouched) and, in the image menu, **管理右键菜单…（Note Tidy）**, which lists the entries of the 图片 / 笔记 / 文件夹 menus and lets you switch them off |
| Command palette (`Ctrl+P`) | Every menu action is also a command: convert images (current note / entire vault), **Convert the whole vault to a chosen format** (default target is webp), **Convert the current note's images**, **整理图片（转换格式 + 合并重复副本 + 清理没人引用的附件）** (converts images that are not in the target format, merges byte-identical copies inside one folder and cleans up unreferenced images afterwards), **清理没人引用的图片** (asks for confirmation first), rename garbled images (current note / entire vault), rename all images vault-wide (normal or forced), organize image locations (current note / entire vault), set image size (current note / entire vault), copy images to the clipboard, fix layout — spaces, indent, chat log, tags and formulas (current note / entire vault), and the quick chat-log fix (transfer external images + fix layout) |

### Settings

The settings tab follows the same split as the spec: **图片导入** / **图片大小** for images, **代码格式** for how source code (LaTeX) is written, **排版格式** for what the reader sees, plus **状态栏** for the optional status-bar counter, **右键菜单** for the context-menu entries and **复制** for what <kbd>Ctrl</kbd>+<kbd>C</kbd> does in the editor.

- **Attachment location** — where transferred images are stored (system default, vault root, current folder, subfolder, or custom path)
- **Image naming preset** — format for renamed images, supports `{YYYY}` `{MM}` `{DD}` `{HH}` `{mm}` `{ss}`
- **Link format after rename** — use full path (`folder/image.png`) or filename only (`image.png`)
- **Convert imported images to the target format** (on by default) — converts each image this plugin imports (`png`/`jpg` → `webp`) and writes the link with the converted name. The encoder ships with the plugin (the browser's canvas), so nothing else has to be installed; formats that cannot be decoded are imported as they are, and a conversion that ends up larger than the original is still used (the point is a vault in one single format)
- **Target format for image format conversion** (default **webp**) — what the two conversion commands convert to, and what **整理图片** converts to while tidying: `webp` / `jpg` / `png` / **`png (pngquant)`**. Animated `gif` files and images already in the target format are always skipped (the pngquant option is the exception: compressing PNGs is exactly what it does)
- **Conversion quality** (default **75**) — what JPEG / WEBP compress with (PNG is lossless and ignores it)
- **pngquant executable path** / **pngquant quality range** (default empty / **65-80**) — used only when the target format is `png (pngquant)`: this plugin calls **the copy you installed yourself** (GPL-licensed external binary; this plugin never bundles or downloads it — grab one from [pngquant.org](https://pngquant.org/)), and if it is already on your `PATH` you can simply put `pngquant` there; an empty path means the whole step does nothing. The quality range uses pngquant's own `min-max` syntax; when it cannot reach `min` it gives up (exit code 99) and the original PNG is kept
- **Take over pasting images** (on by default) — pasting image files stores them through this plugin (one at a time, unique names, converted to the target format) and writes the links; **setting Image Converter's "Never process filenames" to `*`** is recommended so its own paste/drop handling stays out of the way
- **Convert image formats while tidying** (on by default) — the tidy converts every image that is not in the target format, after the duplicate merge and before the orphan cleanup. `gif` files and images already in the target format are left as they are; every other conversion result is used even when it is larger than the original
- **Put a "整理图片" icon in the left sidebar** (on by default) — one click runs the whole tidy: convert formats + merge duplicate copies + clean unreferenced attachments, no confirmation dialog (only byte-identical copies are removed and they go to the trash). The command-palette and right-click entries of the same name still ask first
- **Clean up unreferenced attachments while tidying** (on by default) — as part of the tidy, scans every note and canvas for image filenames and sends images no document mentions to the trash. Implemented here, no *Clear Unused Images* plugin needed; only images are candidates, and the standalone **清理没人引用的图片** command asks for confirmation first

Image size:

- **Default width** — pre-filled width in the size dialog, in pixels
- **Default height** — optional; leave empty to scale proportionally
- **Overwrite existing sizes** — when off, only images without a size are filled in
- **Size pasted images automatically** (on by default) — applies the same preset to whatever you paste (images this plugin stores for you, screenshots another plugin saves, image links inside pasted text), touching only the pasted range. Skipped when the width is empty or invalid, and pasting several images handles each of them. See section 4

> The same three values are what the **快速设置图片大小（Note Tidy）** item (and the matching command) applies — it skips the dialog entirely.

Chat log, indentation and the other layout options are grouped under **排版格式** below.

All defaults reproduce the previous layout, so existing notes are not reformatted until you change a setting. The two defaults that can rearrange a *fresh* paste are **Adjacent messages in time order** (see section 3) — it only acts when a paste arrives with its messages out of order, and notes that are already formatted carry no timestamps for it to compare, so they are never touched — and **Blank line between messages** being off, which drops the empty lines a QQ / WeChat paste often carries *between* messages.

Blank lines inside your own text are always preserved; the only blank lines the layout removes are the ones sitting between two adjacent chat-log messages, and only while **Blank line between messages** is off.

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
- **Space after a chapter / lesson / appendix marker** — on by default; a marker written straight against its content gets one space: `第一章矩阵` → `第一章 矩阵`, `第1课五十音` → `第1课 五十音`, `附录A矩阵` → `附录A 矩阵`. Two marker shapes are recognized — `第` + a number + 章 / 课 / 节 / 讲 / 篇, and `附录` + a number (`附录A` `附录1` `附录一`; the number is required). Nothing happens when a marker is followed by punctuation (`第一章、矩阵`) or by nothing at all (a line holding just `第一章`), and a space that is already there is kept as written

Punctuation and symbols:

- **No space next to full-width punctuation** — on by default; quotes and the inside of `《…》` are exempt
- **Half-width punctuation** `, . ! ? :` — no space before, one space after; on by default
- **Per-symbol spacing rules** — on by default. **A space only ever separates content of different languages**: a symbol stays tight against Chinese and against other symbols (`甲 & 乙` → `甲&乙`, `如, ：` → `如,：`), while `A & B`, `$A$ & $B$` and `word, word` keep their space. `^` and `...` stay tight, `||` and paired pipes stay tight, wrapper symbols are tight inside, and GFM table rows are skipped entirely
- **No space around parentheses** — `( x )` → `(x)`, `中文 (说明)` → `中文(说明)`, `f (x)` → `f(x)`, the `f(x)` function style; in an English sentence the outside keeps its word spacing
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
- **Adjacent messages in time order** — on by default. Compares the timestamps of adjacent messages and emits them in time order, which fixes the QQ / WeChat paste that groups the texts together and appends the images at the end. Only messages separated by blank space are reordered (your own content between messages is never moved), and only when every message in the run has a comparable timestamp of the same shape. See section 3
- **Drop @-mentions** — off by default (it deletes words). Removes `@昵称` from message bodies: `@` must start a word (so `foo@bar.com` is untouched), a line holding nothing but a mention goes away entirely, and the rest of the line is kept. It only acts while a chat log is being formatted, so a region that no longer carries timestamps (because the headers are hidden) is never rewritten. See section 3
- **Blank line between messages** — off by default, and a **master switch** independent of the header toggles: off keeps adjacent messages tight and **drops the empty lines the source text carries between them** (a QQ / WeChat paste usually has one, which is why "no blank lines" used to still show blank lines), on leaves exactly one empty line between adjacent messages. Blank space between a message and content of your own is never touched, and a message with no body is not separated either. See section 3
- **Fix on paste** — on by default; pasting a chat log (two or more message headers) tidies **just the text you pasted**: the images it references by absolute path are copied into the vault, the layout rules run on that range, and the result is written back through the editor (no disk write by the plugin, one <kbd>Ctrl</kbd>+<kbd>Z</kbd> undoes it). The rest of the note is never touched — see section 3

Status bar:

- **Show image count for the selection** — off by default. When on, selecting text in the editor shows how many images the selection contains in the bottom-right status bar (`🖼 选中 3 张图片`). Only embeds count (`![[photo.png]]`, `![alt](photo.png)`, including sizes / aliases / fragments and `avif` / `svg`); a plain link to an image file does not, and neither do links inside fenced code blocks or inline code. The cell stays empty while nothing is selected or the selection has no images.

Context menus:

- **Show "copy image"** — on by default; inserts **复制图片（Note Tidy）** into the image menu and the note menu (nothing is replaced)
- **Show "quick image size"** — on by default; inserts **快速设置图片大小（Note Tidy）** — applies the default size above to the current note without the dialog
- **Show "quick chat-log fix"** — on by default; inserts **快速修复聊天记录（Note Tidy）** — transfers this note's external-path images and fixes its layout in one go
- **Show "typeset selection"** — on by default; inserts **排版选中内容（Note Tidy）** into the note right-click menu (only while something is selected) — formats just the selected text, plus the external-path images it references
- **Show "manage context menus"** — on by default; inserts the entry that opens the management panel (turn it off and use the command palette instead)
- **Hidden menu entries** — one `scope：title` per line, scope being `图片` / `笔记` / `文件夹` (a line without a scope counts as `图片`); those entries are not shown in that menu. This list covers Obsidian's own entries and other plugins' ones — this plugin's own entries are governed by the switches above, so they can never hide themselves. The management panel fills this in for you

Copying:

- **Take over Ctrl+C in the editor** — off by default. `![[图片.png]]` is *text*: a plain <kbd>Ctrl</kbd>+<kbd>C</kbd> copies that string, and pasting it into a folder gives you a file name, not a picture. With this on, pressing <kbd>Ctrl</kbd>+<kbd>C</kbd> (<kbd>⌘</kbd>+<kbd>C</kbd> on macOS) inside the note body copies the image **files** instead — the images in the selection, or the one under the cursor when the selection has none, exactly like the 复制图片 menu item. If the selection also contains words, the words come with them, so QQ / WeChat paste the sentence *and* the pictures (that copy carries no file list — see section 11). It only acts inside the editor (text boxes, settings and other plugins' buttons are left alone), and <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>C</kbd> / <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>C</kbd> still do whatever they did before

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
| `src/rule-registry.ts` | the rule registry: every layout/image rule tied to its spec item, settings switch, implementation and tests (see `docs/规则登记表.md`; regenerated with `node test/run-tests.mjs --update-rules-doc`) |
| `src/text/pipeline.ts` | runs the layout steps in a fixed order: indent → markers → chat log → list numbering → heading levels → plain-text math → formulas → word spacing → tags → block sorting, and **iterates the whole pipeline to a fixed point** (at most 5 rounds): a later step changes text an earlier step looked at — normalizing `$w\approx 0$` to `$w \approx 0$` changes the key block sorting uses. Without the loop, "run it twice" would edit more lines than "run it once", so every save would rewrite the file |
| `src/text/list-numbering.ts` | list numbering: every list starts at 1 (lists that already start at 1 are never touched) |
| `src/text/heading-levels.ts` | heading levels: a sub-heading sits exactly one level below its parent; when several headings change, all new levels are computed from the original ones in one pass |
| `src/text/chat-log.ts` | chat log layout (username / date / time toggles, indent, image order, blank lines), adjacent messages put back in time order, `@mention` stripping, and the cut that keeps your own top-level lines out of the message above them |
| `src/text/context-indent.ts` | context indent and seams for a *range* (fix on paste / typeset selection): align the block to the cursor's indentation, restore the leading/trailing line breaks |
| `src/text/math-wrap.ts` | plain-text math detection — `矩阵 A`, `n维`, `V(F)`, `x = 0`, `λ` → `$…$`, plus the variable table that reads variables out of the note's existing formulas |
| `src/text/inline-scan.ts` | shared inline protection — code spans, links, URLs, tags, comments, existing formulas; **also the single place that recognises and pairs `$…$` / `$$…$$`** (tag layout and block sorting ask `mathOpaqueLines` whether a line may be touched) |
| `src/text/indent.ts` | general layout fixes — leading indentation (4 spaces = 1 tab) |
| `src/text/markers.ts` | block marker spacing — blockquotes, lists, headings |
| `src/text/tags.ts` | tag layout — moving tags to the end of a block, per-cell tables, tag sorting |
| `src/text/block-sort.ts` | content block sorting — sections, anchors, ordered-list renumbering |
| `src/text/latex.ts` | formula layout — spacing rules, `$$` delimiters, `\\` line breaks, continuation indent |
| `src/text/spacing/` | word spacing — `index.ts` (options + `fixSpacing`), `tokenize.ts` (pieces), `gap.ts` (gap between pieces) |
| `src/text/symbols.ts` | the per-symbol spacing table — the left/right requirement of `, . ! ? :`, `\|`, `&`, `→`, `^`, `...` and the wrapper symbols, each entry citing its rule in the note spec |
| `src/text/line-scan.ts` | shared protection rules — frontmatter, fenced code, indented code, GFM table rows |
| `src/text/collate.ts` | "first letter" comparison (Chinese by pinyin, numbers numerically) |
| `src/image/size.ts` | rewriting `\|100` / `\|100x200` sizes, caption-safe |
| `src/image/links.ts` | link resolution, same-name ambiguity detection, link form choice |
| `src/image/organize.ts` | copying images into a note's own attachment folder and repointing links |
| `src/image/attachment-folder.ts` | resolving / creating the attachment folder (shared by several features) |
| `src/image/` (rest) | `transfer.ts` external imports (with rollback of just-imported files when the write-back fails), `convert.ts` **built-in format conversion** (a canvas encoder shared by the import, the paste takeover, the two commands and 整理图片 — no other plugin involved), `unused.ts` **unreferenced-image cleanup** (implemented here, no Clear Unused Images needed), `rename.ts` garbled / bulk renaming, `naming.ts` presets & uniqueness, `external-path.ts` flexible path probing, `constants.ts` extension tables |
| `src/image/scan.ts` · `src/image/copy.ts` · `src/image/clipboard.ts` · `src/image/rich-copy.ts` | one shared scanner for image embeds (used by the status-bar counter and by copy), resolving links to files on disk, putting files on the system clipboard (PowerShell `DataObject` on Windows / `osascript` on macOS — Electron cannot write a file list), and building the CF_HTML flavour used when a copy contains text *and* images |
| `src/ui/image-menu.ts` · `src/ui/menu-injector.ts` · `src/ui/menu-hidden.ts` · `src/ui/menu-manage-modal.ts` · `src/ui/copy-shortcut.ts` | this plugin's context-menu entries (image menu + note menu), the shared "observe the native menu and insert into it" layer (`Menu.prototype` + per-instance observation), the per-menu hidden-entry list, the panel that shows/toggles the entries of the 图片 / 笔记 / 文件夹 menus, and the optional <kbd>Ctrl</kbd>+<kbd>C</kbd> takeover |
| `src/settings/` | `model.ts` fields & defaults, `fields/` the single source of truth for the settings UI, `tab.ts` renders it declaratively (1.13+) or by hand (below) |
| `src/tasks.ts` · `src/batch.ts` · `src/ui/` | task orchestration, the batch shell (mutex + notice suppression + progress), the status-bar selection image counter (a CodeMirror selection listener), menus and modals |

`npm test` runs expected-output checks, idempotency across every settings combination, blank-line and content-loss invariants, and the safety rules that keep captions, non-image links and same-name images untouched.

`test/commands.test.ts` boots the plugin against a stubbed Obsidian API and audits the entry points: every right-click menu action must have a matching command (and the reverse — the file menu and the editor/image menu are two separate audit tables), command IDs are locked in, and both submenu paths — Obsidian's native `setSubmenu` and the fallback — must produce the same actions.

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

### v1.4.1
- New: **PNGs can be handed to pngquant** (**Settings → 图片导入 → 「转换图片格式」的目标格式 → `PNG（pngquant 压缩）`**). pngquant does its own lossy palette quantisation (squeezing a PNG down to as few colours as it can), which is what screenshots need — this is the counterpart of Image Converter's "pngquant executable path", and it behaves the same way: it calls **the copy you installed yourself** (download from [pngquant.org](https://pngquant.org/), then fill in **pngquant 可执行文件路径**), the **pngquant 质量档** defaults to `65-80`, and the command line is `pngquant --quality <min-max> -` (PNG in on stdin, result out on stdout). **This plugin never bundles or downloads it**: pngquant is a GPL / commercial dual-licensed external binary, and shipping one inside a 0-BSD community plugin would both change the licence of the distribution and fail plugin review; an empty path means the whole option does nothing and images stay as they are
- Changed: **the conversion result is always used — "keep the original when the conversion ended up larger" is gone.** The criterion is whether an image is already in the target format (**whether it is a webp**), so a conversion that comes out larger than the original is still used; the old "no space saved, keep the original" rule left a few png files behind in every batch, which is exactly what made "has this one been optimised?" impossible to answer at a glance
- Note: pngquant only eats PNG (feeding it anything else just makes it exit with an error), so this option only accepts `.png` sources; and when it cannot reach the `min` you gave it, it **gives up** (exit code 99) and hands back the original 24-bit PNG — that case keeps the original file. The output is still `.png`, so PNGs already in the vault **keep their names**: the conversion writes the new bytes back into the same file instead of producing a `xxx-1.png` copy. If you pick this option before filling in the path, the command tells you exactly which setting is missing instead of vaguely asking you to "pick a format"
- Internal: new `src/image/pngquant.ts` (`runPngquant` — feed bytes in, collect bytes out, non-zero exit means "this step does nothing"), a `PNGQUANT` entry in `ConvertFormat` (`convertPlanFrom` / `shouldConvertFile` / `plannedExtension` in `src/image/convert.ts`), the `pngquantPath` / `pngquantQuality` settings, a new `selfPath` argument for `convertImageBytes` (overwriting the file in place is not a name collision), the `image.pngquant` rule-registry entry, and `test/pngquant.test.ts` (which really spawns a fake executable to exercise that path)

### v1.4.0
- New: **format conversion is built into the plugin — Image Converter is no longer needed.** Conversions run through the browser's own canvas (`canvas.toBlob`), and the target format and quality live in this plugin's settings (**Settings → 图片导入 → 「转换图片格式」的目标格式**, default webp; **转换质量**, default 75). All four entry points share it: converting while importing external images (**导入的图片转成目标格式**, on by default), pasted images, the commands **Convert the whole vault to a chosen format** / **Convert the current note's images**, and the conversion step of **整理图片**. The three rules are unchanged: **`gif` files are never converted**, images already in the target format are never re-compressed, and **a conversion that ends up larger keeps the original**; anything that cannot be decoded (HEIC / TIFF) is kept as it is — not a single byte is ever lost. The old setting **Hand imported images to Image Converter** is now **导入的图片转成目标格式**, and **转换质量** is new; unrecognised target formats from older `data.json` files (`preset`, `avif`) simply mean "this step does nothing"
- New: **pasted images are handled by this plugin** (**Settings → 图片导入 → 粘贴图片由本插件接管**, on by default). Pasting image files stores them **one at a time** (unique names via this plugin's naming rules, converted to the target format), writes the clipboard text and the `![[links]]` into the note (text first, images after) and then runs the usual layout / sizing pass — pasting several images at once loses none of them. This used to be Image Converter's automatic paste, which runs **concurrently** (`files.map(async …)`): every image computes its own output name, images pasted within the same second collide, and the later write simply fails with `File already exists` (that is how "paste two, get one" happened). **Setting Image Converter's "Never process filenames" to `*`** is recommended so its own paste/drop handling stays out of the way
- New: **cleaning up unreferenced images is implemented here too** (no Clear Unused Images plugin needed). One rule decides it: an image file whose name never appears in any note or canvas. The scan reuses the reference extraction from **整理图片** (`![[img]]`, `[[img]]`, `![](path/img)`, a canvas `"file"` entry — `#fragments` and `|sizes` included, matched by file name, case-insensitive, full paths count as the same image). Only images are touched (pdfs, audio and everything else are never candidates), deletion goes to the trash and **one unreadable document makes the whole step back off**. It backs both the ④ step of **整理图片** and the new **清理没人引用的图片** command (which asks for confirmation first)
- Fixed: **pasting several images at once converted only the first one to webp.** Names used to be generated from the **source** extension, so a png and a jpg pasted in the same second each got a name nobody had taken (`…014850.png` and `…014850.jpg`) while both of them end up as `…014850.webp` — the second one only noticed the collision when writing and stayed in its original format. The name is now generated with the extension the file will **actually** have (asked before naming), and collisions go through the naming helper's "step one second forward" rule — the same rule the batch rename has always used. If the conversion does not happen after all, the name is regenerated with the original extension
- Internal: new `src/image/convert.ts` (built-in encoder + conversion rules + plan), `src/image/unused.ts` (unreferenced-image cleanup) and `src/ui/paste-images.ts` (pure helpers for pasting images); `src/image/image-converter-bridge.ts` is gone; `importImageBytes` in `image/transfer.ts` is shared by the import and the paste path; new tests `test/image-convert.test.ts`, `test/image-unused.test.ts`, `test/paste-images.test.ts` and `test/canvas-stub.ts` (a canvas stand-in so the real encoder path runs under Node); rule registry updated (`image.convert`, `image.paste-images`, `image.unused` added, `image.hand-off-converter` retired)

### v1.3.20
- Fixed: **pasting several images at once converted only the first one to webp.** Images pasted together usually land in the same second, and their names used to be generated from the **source** extension — so a png and a jpg each got a name nobody had taken (`pasted_image_…014850.png` and `…014850.jpg`) while both of them convert to `…014850.webp`: the second one collided, the Image Converter step had to give up, and that image was imported as a plain jpg. The import now follows the same rule as the batch rename: **the name is generated with the extension the file will actually have** (the target format when it is going to be converted), and collisions are handled by the "step one second forward" logic the naming helper already had. If the conversion does not happen after all (not worth it / wrong format came back / converter error), the name is regenerated with the original extension — png bytes are never written into a `.webp` file
- Internal: new `handOffExtension` in `src/image/image-converter-bridge.ts` ("what format will this image end up as", sharing the `planConversion` decision with `convertImageBytes`); the import loop in `src/image/transfer.ts` names by it; five regression cases in section 3 of `test/image-transfer.test.ts` (same-second png + jpg, target name already taken in the vault, no hand-off, gif, failed conversion), registry entries `image.unique-name` / `image.hand-off-converter` / `image.transfer` updated

### v1.3.19
- New: **pasted images get the preset size automatically** (**Settings → 图片大小 → 粘贴图片时自动套用默认尺寸**, on by default). Paste a screenshot, an image Image Converter converted on the way in, or text that carries image links, and the links are rewritten to your **Default width** / **Default height** — the same preset the 快速设置图片大小 item and the size dialog use. Only the range you pasted is touched, nothing is written to disk, and one <kbd>Ctrl</kbd>+<kbd>Z</kbd> takes it back. Images that already have a size follow the **Overwrite existing sizes** switch; the step does nothing when the width is empty (that setting means "remove sizes") or not a number. See section 4
- New: **pasting several images at once works.** Obsidian saves pasted files one at a time and inserts each link as it goes, so the plugin keeps an eye on the pasted range for a few seconds (re-armed by every change, capped at 20 s) instead of handling only the first link. Re-running the step is idempotent, so images that are already sized are never touched twice
- Changed: **a paste another plugin handled is no longer ignored by the sizing step.** Image Converter takes the paste over (`preventDefault`) when the clipboard carries image files — and then stores the image and inserts the link itself, which is exactly the image that should get the size. The chat-log fix still keeps its hands off pastes another plugin handled (what lands in the document is not necessarily what was on the clipboard)
- Changed: **the chat-log fix and the sizing share one edit.** When the pasted text looks like a chat log, the sizes are applied inside the same write-back as the layout fix, so a single undo reverses both; when it does not, the sizing runs on its own
- Internal: new `PasteSizeWatcher` in `src/ui/paste-watch.ts` (idle 5 s / total 20 s per paste) and `ImageTasks.sizePastedRange`; `pastedImageSizeOptions` in `src/image/size.ts` decides when the step must stay out of the way; new rule `image.paste-size` in the registry and cases in `test/image-size.test.ts`, `test/paste-watch.test.ts` and `test/context-indent.test.ts`

### v1.3.18
- New: **format conversion is now part of 整理图片** — the one-click tidy converts, merges and cleans in one run. **Settings → 图片整理 → 整理时转换图片格式** (on by default) hands every image that is not in the target format (**Settings → 图片导入 → 「转换图片格式」的目标格式**, default webp) to Image Converter, using the same converter and preset as the two conversion commands. The order is fixed: **rewrite links → trash duplicate copies → convert formats → run Clear Unused Images**; conversion runs after the merge, so a copy that is about to be trashed is never converted first (that would only burn time and then report a bogus failure). `gif` files, images already in the target format and conversions that do not save enough space are left as they are — exactly the rules the commands already follow
- New: **the tidy is in the right-click menu too** — the **图片功能** submenu of a file or folder now carries **整理图片（转换格式 + 合并重复副本 + 清理没人引用的附件）** next to **整理图片位置**. It does not depend on which file you right-clicked (the merge and the conversion are vault-wide either way), and it always asks for confirmation first, unlike the sidebar icon
- Changed: the command **整理图片** is now called **整理图片（转换格式 + 合并重复副本 + 清理没人引用的附件）**, and the sidebar icon's tooltip matches it — command palette, right-click menu and tooltip read the same label from one constant (`TIDY_IMAGES_LABEL`), so they can no longer drift apart
- Changed: the settings entry **「转换全库图片格式」的目标格式** is now **「转换图片格式」的目标格式**, since the tidy uses it as well
- Fixed: **without Image Converter installed, the tidy used to have no way to say why nothing was converted.** The conversion step is now skipped as a whole and the reason ("没检测到 image converter，跳过格式转换") is appended to the tidy's own result notice — a separate notice would have been swallowed by the notice suppressor that runs during batch operations, so the user would have seen nothing at all
- Internal: `ImageTasks.readConversion()` (quiet) split off from `prepareConversion()` (which still shows the "install Image Converter" notice for the two conversion commands); new `TIDY_IMAGES_LABEL` shared by `commands.ts` / `menus.ts` / `main.ts`; new rule registry entries for the tidy wiring and `test/image-tidy.test.ts`, which runs the real task against a stub vault (merge + conversion + cleanup, the no-converter fallback, and the switch being off)

### v1.3.17
- New: **整理图片（合并重复副本 + 清理没人引用的附件）** — a command **and a left-sidebar icon**. The icon is the one-click version (no dialog); the command asks first. It keeps a single copy of images whose content is byte-identical **and that sit in the same folder** — the "pasted the same picture twice" accidents. The per-note copies that **organize image locations** creates in *different* folders are deliberately never touched, since a note that carries its own copy keeps working even if the original is deleted. Pairs are found by grouping on folder + byte size (no disk reads) and then comparing bytes — no hashing, so there is no collision risk. The copy notes reference most is the one that stays; every link pointing at the others (wikilinks, Markdown links, canvases) is rewritten to it, and the extras go to the trash. If the **Clear Unused Images** plugin (`oz-clear-unused-images`) is installed, the same click also runs its *Clear Unused Images* command once, which collects attachments no note references at all. Both the icon and that hand-off have their own switches under **Settings → 图片整理**
- New: **imported images are handed to Image Converter** (**Settings → 图片导入 → 导入的图片交给 Image Converter 转格式**, on by default). Image Converter only ever converts the images it sees arriving as *clipboard files*; the `file:///D:\…` text paths this plugin imports never reach it — which is how a vault ends up with hundreds of png/jpg while "everything is webp". The import now converts **before writing the file**, with Image Converter's own converter and its current preset, so the link is written straight to the `.webp` and no half-way png ever appears. Its rules are respected (`*.gif` skip patterns, "keep the original when the saving was too small"); with the plugin missing, images are imported exactly as before and one notice per session points at it
- New: **Image converter: convert the whole vault / the current note to a chosen format** (**Settings → 图片导入 → 「转换全库图片格式」的目标格式**, default **webp**) — converts every image that is not already in the target format, with quality and resizing coming from Image Converter's preset. Renaming goes through Obsidian's own rename, so wikilinks, Markdown links and canvases follow automatically. Animated `gif` files and images already in the target format are always skipped, and any failed conversion simply keeps the original file
- Fixed: **a failed import no longer leaves orphan attachments.** Importing is "copy the file, then write the link back"; when the note changed in between (you kept typing, another plugin edited it) the write-back is skipped — and the freshly copied files used to stay behind with nothing pointing at them. They now go to the trash in that case
- Internal: new `src/image/image-converter-bridge.ts` (convert bytes / existing vault images with another plugin's converter, degrading to "import as-is" and to "leave it alone") and `src/image/dedupe.ts` (byte-identical grouping + link rewriting), three new test files (`image-converter-bridge`, `image-transfer`, `image-dedupe`), `ConfirmRenameModal` gained custom texts for non-rename operations, and the registry has the new rules `image.hand-off-converter` and `image.tidy`

### v1.3.16
- Fixed: **pasting a chat log no longer adds an indent of its own.** The layout engine only ever sees the pasted text, so the block started at column 0 while its first line stayed wherever the cursor was — paste inside a list item after pressing Enter (where the editor already indented you by two spaces) and the block landed half in, half out. With the cursor indent and **body indent** both written as tabs it came out one level short or one level deep, depending on which pass looked at it. The whole block now lands on the indentation at the cursor (the leading whitespace and any `>` quotes of that line), every line of it: **whatever indent the cursor sits at is the indent the block gets**, and nothing else is consulted. The block's own level is stripped before formatting and put back afterwards, so the two can never eat each other. The same goes for **typeset just the selection**. See section 3
- Fixed: **a paste no longer leaves a blank line behind it.** The formatter always ends a chat log with a newline, which the editor turned into an extra empty line between the pasted block and the text below. The number of line breaks before and after the pasted range is restored to what it was, so a paste never changes the spacing around it
- Fixed: **"blank line between messages" is a master switch now** (**Settings → 排版格式 → 聊天记录 → 消息之间插入空行**, off by default). It used to appear only while username, date and time were all hidden, and it only ever *added* a blank line — the empty line a QQ / WeChat paste carries *between* messages stayed put, which is the "I turned the blank lines off and still get blank lines" report. Off now means adjacent messages are tight (the blank lines the source carries between them are dropped as well), on means exactly one empty line; blank space next to content of your own, or next to a message with no body, is never touched
- Internal: new `src/text/context-indent.ts` (`resolveRangeIndent` / `commonIndent` / `dedentBy` / `placeBlockAt` / `applyIndentPrefix` / `keepEdgeNewlines`), shared by the paste fix and the selection command; rule `cross.range-indent` added to the registry (with the regenerated `docs/规则登记表.md`) and `test/context-indent.test.ts` covers it, including a real `ImageTasks.fixPastedRange` run through an editor stub. The field-table option `legacyDesc` is gone — the blank-line switch no longer changes its wording per header toggle, so both render paths share one `desc`

### v1.3.15
- New: **typeset just the selection** — command **排版选中的内容**, and the entry **排版选中内容（Note Tidy）** in the note right-click menu (shown only while something is selected; switch **Settings → Note Tidy → 右键菜单 → 「排版选中内容」菜单项**, on by default). It runs the same two steps as the quick chat-log fix, but scoped to the selection: absolute-path images the selection references are copied into the vault and re-linked, then the layout rules run on that text alone, and the result replaces the selection through the editor — one <kbd>Ctrl</kbd>+<kbd>Z</kbd> takes it back, nothing is written to disk. Formatting a whole note has to decide where a message body ends; a selection has no such ambiguity, which is the entire point of having this entry. See section 3
- Changed: **fix on paste now touches only the text you pasted.** The automatic fix used to reformat the *whole note*; it now reads back the range from where the paste started to the cursor, applies the same "does this look like a chat log" gate, and reformats that range in place. Your own text above and below is never touched, and no pass has to guess where a message ends. Everything else is unchanged (it still fires on the editor change rather than on the paste event, still gives up after 5 seconds, still undoes with one <kbd>Ctrl</kbd>+<kbd>Z</kbd> and never writes to disk itself). See section 3
- Reverted: **the "a line at the left margin ends the message" rule added in v1.3.14 is gone.** It had to guess *which* left-margin line was the author's and *when* an unindented line was merely pasted content, and it guessed wrong in both directions; no further rules are being layered on top of it. A message body again runs until a blank line or the next message header — so a line of your own typed directly under a message with no blank line in between counts as part of that body. That is the honest trade-off, now written down in section 3 and in the rule registry. To keep such a line out of a body, select the block and use **排版选中内容**
- Internal: `tasks.typesetSelection` and `tasks.fixPastedRange` share one range-scoped helper that goes through the editor (`getRange` → pipeline → `replaceRange`); `src/ui/paste-watch.ts` no longer touches the vault or `MarkdownView.save()` at all — it registers `editor-paste` + `editor-change` only. New rule `cross.typeset-selection` in the registry, `test/paste-watch.test.ts` rewritten for the range API, and `test/commands.test.ts` covers the new command and menu entry

### v1.3.14
- New: **drop @-mentions** (**Settings → 排版格式 → 聊天记录 → 去掉 @ 提及**, off by default) — group-chat logs are full of `@昵称` reply markers, and the nickname points at nobody once the log is in your vault. With the switch on, `@徐晃何许人也 这才叫邪恶反派` becomes `这才叫邪恶反派`, `你说的对 @张三 就是这样` becomes `你说的对 就是这样`, a full-width `＠` counts, consecutive mentions are all removed, a line holding nothing but a mention disappears entirely, and `foo@bar.com` is left alone (`@` must start a word). Only message bodies are rewritten, and only while a chat log is being formatted — see section 3
- Fixed: **a message body no longer swallows the lines you write underneath it.** A body runs until a blank line or the next message header, so a line of your own typed right under a message (an episode heading such as `06集`, a note) was pulled into that message and re-indented — and everything after it came along. Inside a region whose bodies are indented, a line starting at the left margin now ends the message: that line and everything below it are kept exactly as written. Text pasted straight from QQ is unindented as a whole and is unaffected; with **body indent** set to *none* there is no such signal, so the rule is skipped
- Internal: `test/chat-log.test.ts` grew to 47 real cases (mention stripping, the top-level-line cut, ordering) — all of them checked for strict idempotency across 192 settings combinations

### v1.3.13
- New: **adjacent messages are put back in time order** (**Settings → 排版格式 → 聊天记录 → 相邻消息按时间排序**, on by default). QQ / WeChat do not copy a selection in the order you see it — the texts are grouped together and the images are appended at the end — so a pair like "text at 19:41:37, two screenshots at 19:41:38" arrived with the images first and the layout faithfully reproduced that, putting the images above the text of the *previous* message. The timestamps are right there in the paste, so the formatting now emits adjacent messages in time order. Only messages separated by blank space are reordered (your own content between two messages is never moved), and only when every message in the run has a comparable timestamp of the same shape — a mix of dated and time-only stamps is left as it is. Turn the switch off to keep the paste order exactly. See section 3
- Internal: the chat log formatter now collects its output as blocks (text / message + a time key) and joins them at the end, so "insert an empty line between messages" is applied to the *reordered* neighbours instead of the paste order

### v1.3.12
- Fixed: **no more visible delay after pasting a chat log** — the automatic fix used to wait for the editor's own autosave, and Obsidian saves 2 seconds after you stop typing (`TextFileView.requestSave` debounces by 2000 ms), so the layout visibly changed a second or two after the paste. The note is now flushed to disk as soon as the paste lands in the editor (`editor-change` → `MarkdownView.save()`), and the resulting `modify` event drives the same fix as before; detection, fallback and the "never take the paste over" rule are unchanged
- Fixed: **batch result notices were 5 seconds late** — per-file spam notices are hidden during a batch, and the old code then waited 5 seconds for them to expire before un-hiding *and* showing the summary, so every task notice arrived 5 seconds late. Un-hiding now happens at once and the summary appears immediately; the notices that have not expired yet are hidden individually (`note-tidy-suppressed`) and disappear on their own (with a 6-second safety net so a notice that never auto-hides cannot be hidden forever)
- Internal: `NoticeSuppressor` cleans up on unload (`dispose()`), only tags `.notice` and no longer touches the persistent `.notice-container` (the v1.1.4 bug), and the debug logging on the batch path is gone; new `test/notice-suppressor.test.ts` (17 checks: suppression, release timing, leftovers, container, unload) and `test/paste-watch.test.ts` grew to 42

### v1.3.11
- New: **quick chat-log fix** — transfers the external-path images this note references *and* fixes its layout (spaces / indent / chat log / tags / formulas) in one go. It is a command, an entry in the note / image right-click menus, and an entry in the file explorer's **文本排版** submenu (single notes only). Both steps run inside one batch task (images first, then layout), and the result notice says what was actually changed
- New: **fix on paste** (**Settings → 排版格式 → 聊天记录**, on by default) — pasting something that looks like a chat log runs the quick fix automatically. The detection is deliberately narrow: at least two "username + timestamp" message headers (copying a single message carries no header, and a mention of `会议 14:30:25` in prose is not enough). It does **not** act while the paste event fires — the text is not in the document yet — but waits for the note to be saved, so the fix applies to the note *including* what you pasted (5-second fallback if the editor never saves). Turn it off and nothing is changed automatically; the command and menu entries keep working
- New: `looksLikeChatLog` in `src/text/chat-log.ts` and `src/ui/paste-watch.ts` (with `test/paste-watch.test.ts`); rule `cross.auto-fix-paste` added to the registry
- Fixed: two `as TFile` casts in `test/commands.test.ts` (lint warnings)

### v1.3.10
- New: **chapter / lesson / appendix titles get their space** — a title marker written straight against its content is split so the spacing rules can put one space between the two: `第一章矩阵` → `第一章 矩阵`, `第一节内容` → `第一节 内容`, `附录A矩阵` → `附录A 矩阵`. The marker and the content are recognized from one shared definition (`src/text/chapter-title.ts`, rule 文字格式 / 中文 1), used by both the spacing layout and the plain-text-math scanner — the latter needs it so that the `A` in `附录A矩阵` is not wrapped as a variable (`$A$` would break the marker apart and the spacing rule could never see the title again). A marker followed by punctuation or by a connector (`第一章的用法`, `第一章中的定理`) is prose, not a title, and is left alone; a space that is already there is kept as written

### v1.3.9
- Fixed: **entries switched off in the 管理右键菜单 panel could not be found again** — a hidden entry was skipped when the panel collected the menu's contents, so turning an entry off removed it from the list on the next open and the switch could never be turned back on. Hidden entries are now collected as well (and the panel's own switch column shows them off)
- Fixed: **`versions.json` missed new versions** — `version-bump.mjs` checked whether the *minimum app version* had been recorded instead of the *plugin version*, so a release that kept the same `minAppVersion` (1.7.0 for a long while) was never added to the map. It now checks the version number itself
- Internal: the source repository moved out of the vault (`.obsidian/plugins/note-tidy/` now holds only `main.js`, `manifest.json`, `styles.css` and Obsidian's own `data.json`); `deploy.mjs` copies the build back after `npm run dev` / `npm run build`, and skips silently when the plugin folder is absent (CI)

### v1.3.8
- New: **copy images as files** (section 11) — the plugin puts the actual image file on the clipboard, so pasting into a folder in Explorer produces `图片.png` instead of nothing. Images in a selection are copied together, deduplicated, and same-name ambiguity is skipped rather than guessed. When the selection also contains text, the text comes along as HTML with the pictures inlined, so QQ / WeChat / Word paste "sentence + pictures" in place. Available as a menu item on images and in the editor, as a command, and (off by default) by taking over <kbd>Ctrl</kbd>+<kbd>C</kbd> inside the note body
- New: **selection image count** in the status bar (**Settings → Note Tidy → 状态栏**, off by default) — selecting text shows `🖼 选中 3 张图片`; only embeds count, and a plain link to an image file does not
- New: **manage the context menus** (section "Managing the context menus") — the panel lists what the 图片 / 笔记 / 文件夹 menus contain (Obsidian's own entries, other plugins' and this plugin's) and switches any of them on and off, stored as a plain-text list in the settings. The plugin only ever *inserts* its own entries; nothing is replaced or taken over
- Internal: `src/ui/menu-injector.ts` (observe the native menu, record it, filter it, insert into it), `src/image/clipboard.ts` + `src/image/rich-copy.ts` (PowerShell `DataObject` / Win32 `SetClipboardData`, since Electron cannot write a file list), `src/ui/selection-status.ts`; new tests for the menu layer, clipboard payloads and the status bar

### v1.3.7
- Fixed: **links and addresses are protected as whole segments** — `magnet:?xt=…` (no `//`), `ed2k:`, `data:` / `mailto:` / `tel:`, bare domains (`www.example.com/x?y=1`), `localhost:8080`, e-mail addresses and HTML entities (`&nbsp;`) are now treated as one opaque piece: not a single character inside them is touched. They used to be laid out as prose — a space after the colon, one around every `&`, `10bit` split into `10 bit`, a half-width `;` turned full-width — which is exactly what leaves you with a dead link when you copy it back out
- Fixed: **a "formula" that only looks like one because it spans table cells is not recognized** — table rows are read cell by cell (the same rule the tag layout uses), so a pair of `$` may not cross the `|` separator: a missing `$` used to pair with the `$` in the next cell, and the fake formula that came out of it swallowed the padding spaces that keep the row aligned

### v1.3.6
- Fixed: **same-line messages no longer leak a phantom blank line** — copying several messages out of QQ often puts them on one line separated by a single space, and that space had already been consumed by the previous body's trim while `skipIndentBefore` walked back past it. `substring(start, end)` swaps its arguments when `start > end` (unlike `slice`, which returns an empty string), so an indentation-only line was emitted between every pair of messages and the spacing layout turned it into a real blank line — the symptom being "I turned the blank line off and still get blank lines". The fragment is now clipped at the previous body's end

### v1.3.5
- Fixed: **plain-text math only accepts properly spaced expressions** — a binary operator needs **one space on each side** to count (math symbols 1: operators and relation signs take a space on both sides, unless the context is not mathematical, e.g. the shortcut `ctrl+c`): `x = 0`, `x - 1`, `a + b` are still wrapped, while `x=0`, `a+b+c`, `5/10mm`, `A-7`, `F-22`, `cd /d` and `x -1` are left alone — they may be a deliberate designation, a hyphen, a shell command, or simply missing spaces, and the layout does not guess. Prefix signs are modifiers (math symbols 3: no space around them), so `x = -1` and `f(-1)` are unaffected
- Internal: the pipeline still iterates to a fixed point, kept as a cross-step safety net — the "spacing adds a gap, then plain-text math recognises the expression" chain no longer happens (`5/10mm` is not wrapped any more), and `test/text-pipeline.test.ts` covers convergence and idempotence for every switch combination

### v1.3.4
- New: **list numbering** (typesetting, on by default) — every list starts at 1: a list whose first number is not 1 is renumbered from 1 upwards (`3. 4. 5.` → `1. 2. 3.`). A list that already starts at 1 is never touched, so a deliberate `1. 1. 1.` (letting Markdown count) or `1. 5. 9.` stays as written. Blank lines do not split a list (loose lists are one list), while paragraphs, code blocks and tables do; nested lists each start at 1; numbers get no leading zeros. See section 10
- New: **heading levels** (typesetting, on by default) — a sub-heading sits exactly one level below its parent: `#### child` right under `# parent` becomes `## child`, siblings stay siblings, and coming back up lands on the right parent. **When several headings change at once, every new level is computed from the original levels in one pass** rather than from the previous heading's new level — otherwise `# → ### → ###` would be computed as `# → ## → ###` and turn two sibling sections into nested ones, drifting further with every heading. The first heading keeps its own level (a note starting at `##` usually continues a hierarchy from somewhere else)
- Fixed: **tags on a line containing a formula were never relocated** — `#tag text $$e^{At}$$` is now laid out as `text $$e^{At}$$ #tag`. "Does this line contain `$$`?" used to have two answers (tag layout treated the whole line as protected, spacing layout treated the whole line as typesettable) that disagreed on the same line; both questions now share one implementation: lines inside a multi-line `$$` block and its opening/closing lines are still skipped whole (a tag can never be moved into a formula), while a same-line `$$…$$` pair is laid out normally
- Internal: **large cleanup**. `main.ts` went from 1542 lines to 49 (lifecycle and wiring only), with command/task/batch/UI modules split out; `src/` is now organised into `text/`, `image/`, `ui/` and `settings/`; the settings panel's two rendering paths (declarative on 1.13+, hand-written DOM below) are both generated from **one field table**, so adding an option touches a single place; `spacing.ts` (1161 lines) was split into `spacing/` (options / tokenizer / gap rules)
- Internal: new **rule registry** `src/rule-registry.ts` (59 rules: spec item ↔ setting ↔ implementation ↔ test) with the generated `docs/规则登记表.md`; `test/rules.test.ts` verifies each one — the spec section and item number must exist in the note spec, every switch must be used by a rule, and every implementation symbol and test file must be present. Formula recognition and pairing were also collapsed from six implementations into one (`text/inline-scan.ts`)
- Internal: every layout step is still idempotent and returns the input unchanged when nothing needs doing (the whole pipeline iterates to a fixed point)

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
