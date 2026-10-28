// A small message box over the game (connecting, errors). Pass null to hide it.
export function showStatus(text: string | null) {
  const el = document.getElementById('status')!;
  el.textContent = text ?? '';
  el.hidden = text === null;
}
