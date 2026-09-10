// Renders the body of a virtualized table: a top spacer <tbody>, one measured <tbody>
// per visible virtual item, and a bottom spacer <tbody>. Pairs with `useRowVirtualizer`.
//
// The spacer rows are `aria-hidden` and carry no border/padding so they are invisible.
// Each visible row's <tbody> gets `ref={measureElement}` + `data-index` so the virtualizer
// can measure its real height (covers expandable rows, six-year rowSpan pairs, wrapping
// text, "gap" rows, etc.). `children` is a render function `(row, index) => <tr>...`.
export function VirtualRows({
  items,
  padTop,
  padBottom,
  colSpan,
  measureElement,
  rows,
  rowKey,
  children,
}) {
  return (
    <>
      {padTop > 0 && (
        <tbody aria-hidden="true">
          <tr style={{ height: `${padTop}px` }}>
            <td colSpan={colSpan} style={{ padding: 0, border: 0 }} />
          </tr>
        </tbody>
      )}
      {items.map(vi => {
        const row = rows[vi.index];
        if (row === undefined) return null;
        return (
          <tbody
            key={rowKey ? rowKey(row, vi.index) : vi.key}
            data-index={vi.index}
            ref={measureElement}
          >
            {children(row, vi.index)}
          </tbody>
        );
      })}
      {padBottom > 0 && (
        <tbody aria-hidden="true">
          <tr style={{ height: `${padBottom}px` }}>
            <td colSpan={colSpan} style={{ padding: 0, border: 0 }} />
          </tr>
        </tbody>
      )}
    </>
  );
}
