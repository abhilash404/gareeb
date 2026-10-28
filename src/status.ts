// A small message box over the game (connecting, errors). Pass null to hide it.
export function showStatus(text: string | null) {
  const el = document.getElementById('status')!;
  el.textContent = text ?? '';
  el.hidden = text === null;
}

// Round-trip time to the server, in the corner. Yellow from 150ms, red from 300ms.
export function showPing(ms: number) {
  const el = document.getElementById('ping')!;
  el.textContent = `${Math.round(ms)} ms`;
  el.style.color = ms < 150 ? '#9be89b' : ms < 300 ? '#f0d36b' : '#ff7b7b';
}
