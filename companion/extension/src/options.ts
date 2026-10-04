// The extension's options: the Companion's port and the token it prints when it starts (tools/companion/server.ts).
const port = document.getElementById('port') as HTMLInputElement;
const token = document.getElementById('token') as HTMLInputElement;
const said = document.getElementById('said') as HTMLElement;

void chrome.storage.local.get(['port', 'token']).then((stored) => {
  if (typeof stored.port === 'number') port.value = String(stored.port);
  if (typeof stored.token === 'string') token.value = stored.token;
});
document.getElementById('save')?.addEventListener('click', () => {
  void chrome.storage.local.set({ port: Number(port.value) || 5410, token: token.value.trim() }).then(() => {
    said.textContent = 'Saved.';
  });
});
