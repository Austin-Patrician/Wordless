// Virtuoso reports rendered indexes with firstItemIndex applied, while its
// imperative methods address the zero-based data array.
export function dataIndexFromReportedIndex(
  reportedIndex: number,
  firstItemIndex: number,
): number {
  return reportedIndex - firstItemIndex;
}
