/* Staging-only diagnostics. Reuses the panel socket; no credentials are persisted. */
(() => {
  'use strict';
  if (window.__sofiaAccessCheckInstalled) return;
  window.__sofiaAccessCheckInstalled = true;
  const NativeSocket = window.WebSocket;
  const pending = new Map();
  const state = { socket: null, ready: false, scopes: [] };
  const prefix = 'sofia-access-' + Math.random().toString(36).slice(2) + '-';
  let sequence = 0;
  class ObservedSocket extends NativeSocket {
    constructor(...args) {
      super(...args);
      const url = new URL(String(args[0]), location.href);
      if (url.host !== location.host || url.pathname !== '/api/gateway/ws') return;
      state.socket = this;
      state.ready = false;
      state.scopes = [];
      this.addEventListener('message', ({ data }) => {
        if (state.socket !== this || typeof data !== 'string') return;
        let frame;
        try { frame = JSON.parse(data); } catch { return; }
        if (frame?.type !== 'res') return;
        if (frame.ok && frame.payload?.type === 'hello-ok') {
          state.ready = true;
          state.scopes = Array.isArray(frame.payload.auth?.scopes)
            ? frame.payload.auth.scopes.filter(scope => typeof scope === 'string') : [];
        }
        const request = pending.get(frame.id);
        if (!request || request.socket !== this) return;
        pending.delete(frame.id);
        clearTimeout(request.timer);
        request.resolve(frame.ok ? 'ok' : classify(frame.error));
      });
      this.addEventListener('close', () => {
        for (const [id, request] of pending) {
          if (request.socket !== this) continue;
          pending.delete(id);
          clearTimeout(request.timer);
          request.resolve('closed');
        }
        if (state.socket === this) state.ready = false;
      });
    }
  }
  window.WebSocket = ObservedSocket;
  function classify(error) {
    const text = String(error?.code || '') + ' ' + String(error?.message || '');
    if (/missing scope|forbidden|unauthorized|permission|access denied/i.test(text)) return 'permission';
    if (/unknown method|method not found|unsupported method/i.test(text)) return 'unsupported';
    return 'error';
  }
  function query(method) {
    const socket = state.socket;
    if (!state.ready || socket?.readyState !== NativeSocket.OPEN) return Promise.resolve('closed');
    return new Promise(resolve => {
      const id = prefix + (++sequence);
      const timer = setTimeout(() => { pending.delete(id); resolve('timeout'); }, 7000);
      pending.set(id, { socket, timer, resolve });
      try { socket.send(JSON.stringify({ type: 'req', id, method, params: {} })); }
      catch { pending.delete(id); clearTimeout(timer); resolve('closed'); }
    });
  }
  const messages = {
    ok: '✅ Funcionou', permission: '❌ Sem permissão', unsupported: '⚠️ Consulta indisponível',
    timeout: '⚠️ Sem resposta', closed: '⚠️ Conexão interrompida', error: '⚠️ Falha na consulta'
  };
  function mount() {
    const root = document.createElement('aside');
    root.id = 'sofia-access-check';
    root.style.cssText = 'position:fixed;right:12px;bottom:72px;z-index:10000;font:14px system-ui,sans-serif;color:#f5f7fb;';
    const toggle = document.createElement('button');
    toggle.textContent = 'Testar acesso';
    toggle.type = 'button';
    toggle.style.cssText = 'padding:10px 14px;border:1px solid #7395ad;border-radius:10px;background:#122636;color:#fff;font:inherit;cursor:pointer;';
    const panel = document.createElement('section');
    panel.hidden = true;
    panel.style.cssText = 'margin-bottom:8px;padding:16px;border:1px solid #7395ad;border-radius:12px;background:#101c29;width:min(300px,calc(100vw - 56px));max-height:55vh;overflow:auto;box-shadow:0 4px 20px #0008;';
    const title = document.createElement('strong');
    title.textContent = 'Acesso do seu celular';
    const explanation = document.createElement('p');
    explanation.textContent = 'Teste de leitura. Não altera dados.';
    panel.append(title, explanation);
    const rows = [];
    for (const label of ['Conexão', 'Dados', 'Sessões', 'Agendamentos', 'Permissão administrativa']) {
      const row = document.createElement('p');
      row.textContent = label + ': aguardando teste';
      row.style.margin = '10px 0';
      panel.append(row);
      rows.push([label, row]);
    }
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Fechar';
    close.style.cssText = toggle.style.cssText;
    close.addEventListener('click', () => { panel.hidden = true; });
    panel.append(close);
    const previewToggle = document.createElement('button');
    previewToggle.type = 'button';
    previewToggle.textContent = 'Testar 3º andar';
    previewToggle.style.cssText = toggle.style.cssText + 'margin-left:6px;';
    const previewPanel = document.createElement('section');
    previewPanel.hidden = true;
    previewPanel.style.cssText = panel.style.cssText;
    const previewTitle = document.createElement('strong');
    previewTitle.textContent = 'Simulação visual — 3º andar';
    const previewText = document.createElement('p');
    previewText.textContent = 'O avatar main vai à estação do 3º andar. Aguarde a chegada. Sem acionar n8n ou IA.';
    const previewResult = document.createElement('p');
    previewResult.setAttribute('aria-live', 'polite');
    previewPanel.append(previewTitle, previewText, previewResult);
    window.addEventListener('sofia-third-floor-preview-result', event => {
      previewResult.textContent = event.detail === 'busy'
        ? 'Um evento real está usando o avatar main e tem prioridade.'
        : event.detail === 'ended' ? 'Teste encerrado. Avatar liberado.'
        : 'Simulação ativa. Procure main no 3º andar.';
    });
    function preview(status) {
      previewResult.textContent = 'Aguardando a cena carregar…';
      window.dispatchEvent(new CustomEvent('sofia-third-floor-preview', { detail: status }));
    }
    for (const [label, status] of [['Azul: executando', 'workflow.running'], ['Verde: concluído', 'workflow.completed'], ['Vermelho: falhou', 'workflow.failed'], ['Encerrar teste', null]]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.style.cssText = toggle.style.cssText + 'display:block;margin:6px 0;width:100%;';
      button.addEventListener('click', () => {
        preview(status);
        if (status === null) previewPanel.hidden = true;
      });
      previewPanel.append(button);
    }
    previewToggle.addEventListener('click', () => {
      panel.hidden = true;
      previewPanel.hidden = false;
      preview('workflow.running');
    });
    root.append(panel, previewPanel, toggle, previewToggle);
    document.body.append(root);
    toggle.addEventListener('click', async () => {
      if (toggle.disabled) return;
      panel.hidden = false;
      toggle.disabled = true;
      toggle.textContent = 'Testando…';
      try {
        const connected = state.ready && state.socket?.readyState === NativeSocket.OPEN;
        rows[0][1].textContent = 'Conexão: ' + (connected ? '✅ Autenticada' : '⚠️ Aguarde conectar e tente novamente');
        rows[4][1].textContent = 'Permissão administrativa: ' + (connected
          ? (state.scopes.includes('operator.admin') ? '✅ Informada pelo Gateway' : '⚠️ Não informada pelo Gateway')
          : 'aguardando conexão');
        const methods = ['status', 'sessions.list', 'cron.list'];
        rows.slice(1, 4).forEach(([label, row]) => { row.textContent = label + ': consultando…'; });
        const results = connected ? await Promise.all(methods.map(query)) : methods.map(() => 'closed');
        results.forEach((result, index) => {
          const [label, row] = rows[index + 1];
          row.textContent = label + ': ' + messages[result];
        });
      } finally { toggle.disabled = false; toggle.textContent = 'Testar acesso'; }
    });
  }
  if (document.readyState === 'complete') mount();
  else window.addEventListener('load', mount, { once: true });
})();
