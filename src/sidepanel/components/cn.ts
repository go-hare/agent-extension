/**
 * 极简 className 合并。
 *
 * 不引 clsx/tailwind-merge：
 *  - clsx 只是这 6 行；
 *  - tailwind-merge 是为"运行时拼出冲突类名"准备的，本项目所有 className
 *    都是静态写死的分支，没有冲突消解的需求，白白多 8KB。
 */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
