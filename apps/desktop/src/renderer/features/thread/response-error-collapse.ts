export const RESPONSE_ERROR_COLLAPSED_HEIGHT = 60;

export function shouldCollapseResponseError(scrollHeight: number): boolean {
  return scrollHeight > RESPONSE_ERROR_COLLAPSED_HEIGHT + 1;
}
