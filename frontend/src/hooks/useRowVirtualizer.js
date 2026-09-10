import { useRef, useCallback } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

// Shared row-virtualization helper for data tables. Wraps the same inline pattern already
// used in AdminPage/DashboardPage/MeetingsTable so new tables stay consistent: only the
// rows visible in the scroll viewport (+ overscan) are mounted as real DOM, with two
// spacer rows holding the correct total scroll height. Row heights are measured
// dynamically via `virtualizer.measureElement` (attached as the ref of each row's
// <tbody>), so `estimateSize` is only the initial guess.
//
// Usage:
//   const { scrollRef, virtualizer, items, padTop, padBottom } =
//     useRowVirtualizer(rows, { estimateSize: 48, getItemKey: r => r.id });
//   <div ref={scrollRef} className="overflow-auto max-h-[70vh]">
//     <table><thead>...</thead>
//       <VirtualRows items={items} padTop={padTop} padBottom={padBottom}
//         colSpan={N} measureElement={virtualizer.measureElement}
//         rows={rows} rowKey={r => r.id}>
//         {(row) => <MyMemoRow row={row} />}
//       </VirtualRows>
//     </table>
//   </div>
export function useRowVirtualizer(rows, { estimateSize = 48, overscan = 12, getItemKey, scrollRef: externalScrollRef } = {}) {
  const internalScrollRef = useRef(null);
  const scrollRef = externalScrollRef || internalScrollRef;

  const keyFn = useCallback(
    i => {
      if (getItemKey) return getItemKey(rows[i], i);
      return rows[i]?.id ?? i;
    },
    [rows, getItemKey],
  );

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimateSize,
    overscan,
    getItemKey: keyFn,
  });

  const items = virtualizer.getVirtualItems();
  const total = virtualizer.getTotalSize();
  const padTop = items.length ? items[0].start : 0;
  const padBottom = items.length ? total - items[items.length - 1].end : 0;

  return { scrollRef, virtualizer, items, padTop, padBottom };
}
