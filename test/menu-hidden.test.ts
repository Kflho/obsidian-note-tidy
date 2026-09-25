/**
 * 右键菜单"隐藏名单"的解析与生成（`src/ui/menu-hidden.ts`）
 *
 * 运行：npm test
 *
 * 这段文本用户在设置里手改，所以格式的两条线要守住：
 *   1. `作用域：标题`（图片 / 笔记 / 文件夹，中英文冒号都认，也认英文 key）
 *   2. **不写作用域按"图片"算** —— 最早的版本只支持图片菜单、写的就是裸标题，老数据不能失效
 */
import {
	MENU_SCOPES,
	MENU_SCOPE_LABELS,
	emptyHiddenItems,
	isHiddenItem,
	menuItemsForPanel,
	parseHiddenItems,
	serializeHiddenItems,
	withHiddenItem,
} from "../src/ui/menu-hidden";

// -------------------------------------------------------------------- 断言
let checks = 0;
const failures: string[] = [];

function checkEqual(name: string, actual: unknown, expected: unknown): void {
	checks++;
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		failures.push(`[期望不符] ${name}\n  期望 ${JSON.stringify(expected)}\n  实际 ${JSON.stringify(actual)}`);
	}
}

// -------------------------------------------------------------------- 用例
checkEqual("三个作用域的顺序", MENU_SCOPES, ["image", "note", "folder"]);
checkEqual("界面写法", [MENU_SCOPE_LABELS.image, MENU_SCOPE_LABELS.note, MENU_SCOPE_LABELS.folder], ["图片", "笔记", "文件夹"]);
checkEqual("空名单", emptyHiddenItems(), { image: [], note: [], folder: [] });

// 1. 解析
checkEqual("按作用域分", parseHiddenItems("图片：另存为图片…\n笔记：复制\n文件夹：在系统中显示"), {
	image: ["另存为图片…"],
	note: ["复制"],
	folder: ["在系统中显示"],
});
checkEqual("不写作用域按图片算（老写法）", parseHiddenItems("另存为图片…\n复制图片"), {
	image: ["另存为图片…", "复制图片"],
	note: [],
	folder: [],
});
checkEqual("英文 key 也认", parseHiddenItems("note: 复制\nfolder: 在系统中显示"), {
	image: [],
	note: ["复制"],
	folder: ["在系统中显示"],
});
checkEqual("半角冒号与多余空格", parseHiddenItems("  图片 :  另存为图片…  "), {
	image: ["另存为图片…"],
	note: [],
	folder: [],
});
checkEqual("空行与空标题丢掉", parseHiddenItems("\n\n图片：\n\n笔记：复制\n"), {
	image: [],
	note: ["复制"],
	folder: [],
});
checkEqual("重复的不重复记", parseHiddenItems("图片：复制\n图片：复制"), {
	image: ["复制"],
	note: [],
	folder: [],
});
checkEqual("标题里带冒号不算作用域", parseHiddenItems("图片：a:b"), {
	image: ["a:b"],
	note: [],
	folder: [],
});
checkEqual("空文本 → 空名单", parseHiddenItems(""), emptyHiddenItems());

// 2. 生成（面板写回设置）
checkEqual("按作用域写回", serializeHiddenItems({ image: ["另存为图片…"], note: ["复制"], folder: ["在系统中显示"] }),
	"图片：另存为图片…\n笔记：复制\n文件夹：在系统中显示");
checkEqual("没有内容就写空串", serializeHiddenItems(emptyHiddenItems()), "");

// 3. 往返：写回再解析要一模一样
const roundTrip = { image: ["复制图片", "另存为图片…"], note: ["复制"], folder: ["在系统中显示"] };
checkEqual("写回再解析不变", parseHiddenItems(serializeHiddenItems(roundTrip)), roundTrip);

// 4. 判定与增删
const hidden = parseHiddenItems("图片：另存为图片…\n笔记：复制");
checkEqual("图片菜单里命中", isHiddenItem("image", "另存为图片…", hidden), true);
checkEqual("其它菜单不受影响", isHiddenItem("note", "另存为图片…", hidden), false);
checkEqual("笔记菜单里命中", isHiddenItem("note", "复制", hidden), true);
checkEqual("两边空白不算差别", isHiddenItem("image", "  另存为图片… ", hidden), true);
checkEqual("不在名单里", isHiddenItem("image", "复制图片", hidden), false);

const added = withHiddenItem(hidden, "folder", "在系统中显示", true);
checkEqual("加一条", added.folder, ["在系统中显示"]);
checkEqual("加一条不动别的", added.image, hidden.image);
checkEqual("原对象没被改", hidden.folder, []);

const removed = withHiddenItem(added, "image", "另存为图片…", false);
checkEqual("去掉一条", removed.image, []);
checkEqual("去掉后别的还在", removed.folder, ["在系统中显示"]);
checkEqual("带空白也算同一条（判重去空白）", withHiddenItem(parseHiddenItems("图片：复制"), "image", "  复制 ", false).image, []);
checkEqual("写进名单的是去掉空白的标题", withHiddenItem(emptyHiddenItems(), "note", "  粘贴  ", true).note, ["粘贴"]);

// 5. 面板要列出的项：检测到的 + 名单里那些这次没检测到的
//    （2026-09 的 bug：隐藏项在菜单里被摘掉 → 下次检测不到 → 面板列不出来 → 永远打不开）
checkEqual("隐藏项也列出来", menuItemsForPanel(["打开", "重命名", "删除"], ["删除", "在系统中显示"]),
	["打开", "重命名", "删除", "在系统中显示"]);
checkEqual("检测到的在前，只剩名单的按名单顺序接上", menuItemsForPanel(["复制", "粘贴"], ["新建笔记", "收藏"]),
	["复制", "粘贴", "新建笔记", "收藏"]);
checkEqual("两边都有不重复列", menuItemsForPanel(["删除"], ["删除"]), ["删除"]);
checkEqual("都没检测到时就只列名单里的", menuItemsForPanel([], ["删除"]), ["删除"]);
checkEqual("两样都没有 → 空", menuItemsForPanel([], []), []);
checkEqual("空白标题两边都丢掉", menuItemsForPanel([" 复制 ", ""], [" ", "  删除 "]), ["复制", "删除"]);

console.log(`\n共 ${checks} 次检查，失败 ${failures.length} 项`);
for (const message of failures.slice(0, 10)) {
	console.log("\n❌ " + message);
}
if (failures.length > 10) {
	console.log(`\n…… 其余 ${failures.length - 10} 项失败已省略`);
}
if (failures.length > 0) {
	process.exitCode = 1;
}
