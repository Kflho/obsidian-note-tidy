import { App, normalizePath } from 'obsidian';
import { MANAGED_IMAGE_EXT_RE } from './constants';

/**
 * 图片命名（从 main.ts 抽出）。
 *
 * 三件事：按预设生成文件名、判断文件名是否符合预设、保证同一个仓库里
 * 「文件名 → 路径」不冲突。**文件名在全库唯一**是这个插件的硬约束 ——
 * 裸文件名链接 `![[图.png]]` 一旦撞名，笔记就可能显示成另一张图，
 * 所以这里用四层检查把重名挡在写盘之前。
 */

/** 命名只依赖这一个设置项，避免与 settings/ 循环依赖 */
export interface ImageNamingSettings {
	/** 文件名预设，支持 `{YYYY}` `{MM}` `{DD}` `{HH}` `{mm}` `{ss}` */
	imageNamePreset: string;
}

/**
 * 按预设生成文件名。
 * @param preset 形如 `Pasted image {YYYY}{MM}{DD}{HH}{mm}{ss}`
 * @param ext 扩展名（含点）
 * @param momentObj 时间来源；不传则用当前时间
 */
export function formatImageName(preset: string, ext: string, momentObj?: moment.Moment): string {
	const m = momentObj ?? window.moment();
	const replacements: Record<string, string> = {
		'{YYYY}': m.format('YYYY'),
		'{MM}': m.format('MM'),
		'{DD}': m.format('DD'),
		'{HH}': m.format('HH'),
		'{mm}': m.format('mm'),
		'{ss}': m.format('ss'),
	};
	let name = preset;
	for (const [placeholder, value] of Object.entries(replacements)) {
		name = name.split(placeholder).join(value);
	}
	return name + ext;
}

/**
 * 检查文件名是否已匹配预设命名格式，避免重复重命名。
 * 把预设编译成正则（占位符 → `\d{4}` / `\d{2}`，其余字符转义）。
 */
export function matchesNamePreset(fileName: string, preset: string): boolean {
	if (!preset) return false;

	const parts = preset.split(/(\{YYYY\}|\{MM\}|\{DD\}|\{HH\}|\{mm\}|\{ss\})/);
	let pattern = '^';
	for (const part of parts) {
		switch (part) {
			case '{YYYY}': pattern += '\\d{4}'; break;
			case '{MM}':   pattern += '\\d{2}'; break;
			case '{DD}':   pattern += '\\d{2}'; break;
			case '{HH}':   pattern += '\\d{2}'; break;
			case '{mm}':   pattern += '\\d{2}'; break;
			case '{ss}':   pattern += '\\d{2}'; break;
			default:
				pattern += part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		}
	}
	pattern += '\\.\\w+$';

	try {
		const regex = new RegExp(pattern, 'i');
		return regex.test(fileName);
	} catch {
		return false;
	}
}

/**
 * 扫描仓库中所有受管图片，构建 basename → vaultPath 映射。
 * 这是跨文件夹去重的数据基础 —— 不依赖元数据缓存，直接读文件列表。
 * 同一 basename 对应多个文件时只留最先扫到的那个，后续的会在重命名时被判为冲突。
 */
export function buildVaultBasenameMap(app: App): Map<string, string> {
	const map = new Map<string, string>();
	for (const f of app.vault.getFiles()) {
		if (MANAGED_IMAGE_EXT_RE.test(f.name)) {
			if (!map.has(f.name)) {
				map.set(f.name, f.path);
			}
			// 同名文件：不覆盖，第一个保留，后续的会在重命名时触发冲突重命名
		}
	}
	return map;
}

/**
 * 生成唯一的目标路径。四层检查确保仓库内所有图片 basename 唯一：
 * ①目标路径是否已有文件  ②批次内是否已预留完整路径
 * ③批次内是否已预留 basename  ④pre-scan 得到的仓库 basename 映射（由调用方传入）
 *
 * 撞名时把时间戳往后推一秒重试，直到找到空位。
 */
export async function generateUniqueTargetPath(
	app: App,
	preset: string,
	currentAttachFolder: string,
	ext: string,
	startTime: moment.Moment,
	reservedPaths: Map<string, string>,
	reservedBasenames: Map<string, string>
): Promise<{ newFileName: string; targetVaultPath: string }> {
	const currentTime = startTime.clone();
	const MAX_ATTEMPTS = 100000;
	let attempts = 0;
	while (attempts < MAX_ATTEMPTS) {
		const newFileName = formatImageName(preset, ext, currentTime);
		const targetVaultPath = normalizePath(
			currentAttachFolder === "/" ? `/${newFileName}` : `${currentAttachFolder}/${newFileName}`
		);
		// ①目标路径是否已有文件
		if (app.vault.getAbstractFileByPath(targetVaultPath)) {
			currentTime.add(1, 'seconds'); attempts++; continue;
		}
		// ②批次内是否已预留该完整路径
		if (reservedPaths.has(targetVaultPath)) {
			currentTime.add(1, 'seconds'); attempts++; continue;
		}
		// ③批次内是否已预留该 basename（跨文件夹去重）
		if (reservedBasenames.has(newFileName)) {
			currentTime.add(1, 'seconds'); attempts++; continue;
		}
		reservedPaths.set(targetVaultPath, '');
		reservedBasenames.set(newFileName, '');  // '' = auto-generated name
		return { newFileName, targetVaultPath };
	}
	throw new Error('无法生成唯一文件名：超过最大尝试次数');
}
