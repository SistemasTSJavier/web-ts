export function $(id: string): HTMLElement | null {
  return document.getElementById(id);
}

export function escapeHtml(s: string): string {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}
