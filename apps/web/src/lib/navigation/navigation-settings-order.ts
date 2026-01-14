import type { NavGroupId } from "./nav-items";

type ReorderDirection = "up" | "down";
type GroupKey = NavGroupId | "dashboard" | "standalone";

type ReorderItem = {
  href: string;
  group?: NavGroupId;
};

export function getSettingsGroupKey(item: ReorderItem): GroupKey {
  if (item.href === "") return "dashboard";
  return item.group ?? "standalone";
}

export function reorderItemWithinGroup<T extends ReorderItem>(
  items: T[],
  href: string,
  direction: ReorderDirection,
): T[] {
  const currentIndex = items.findIndex((item) => item.href === href);
  if (currentIndex === -1) return items;

  const currentItem = items[currentIndex];
  const currentGroup = getSettingsGroupKey(currentItem);

  const groupIndices: number[] = [];
  items.forEach((item, index) => {
    if (getSettingsGroupKey(item) === currentGroup) {
      groupIndices.push(index);
    }
  });

  const groupPosition = groupIndices.indexOf(currentIndex);
  if (groupPosition === -1) return items;

  const targetGroupPosition = direction === "up" ? groupPosition - 1 : groupPosition + 1;
  if (targetGroupPosition < 0 || targetGroupPosition >= groupIndices.length) {
    return items;
  }

  const targetIndex = groupIndices[targetGroupPosition];
  const next = [...items];
  [next[currentIndex], next[targetIndex]] = [next[targetIndex], next[currentIndex]];
  return next;
}
