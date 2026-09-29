/**
 * 列表加载时的空壳卡。
 *
 * 为什么不留一行「正在读取…」:内容到货时那一行会被整片格子**换掉**,页面跳一次版 —— 而这一页
 * 打开时正好是"我在找那份设计",跳版最碍事。骨架卡把位置先占住,内容填进来时什么都不动。
 *
 * 比例与真卡片一致(封面区 4:3 + 两行信息),所以它看起来是"内容还没来",而不是"另一块东西"。
 */
export function DesignCardSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="flex animate-pulse flex-col overflow-hidden rounded-xl border border-[#e2e4e6] bg-white motion-reduce:animate-none dark:border-[#3b3e41] dark:bg-[#202225]"
      data-design-card-skeleton=""
    >
      <div className="aspect-[4/3] w-full bg-[#eceee9] dark:bg-[#2a2c2f]" />
      <div className="flex flex-col gap-1.5 px-3 py-2.5">
        <span className="h-3 w-2/3 rounded-full bg-[#eceee9] dark:bg-[#2a2c2f]" />
        <span className="h-2.5 w-1/2 rounded-full bg-[#f2f3f0] dark:bg-[#26282b]" />
      </div>
    </div>
  );
}
