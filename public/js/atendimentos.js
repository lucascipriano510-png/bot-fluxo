(window.FluxoModules = window.FluxoModules || []).push({
    /* ── Atendimentos ────────────────────────────────────────────────── */
    async _loadAtendMessages(phone, altPhones = []) {
      const toTs = s => { try { return new Date(s).getTime(); } catch { return 0; } };
      // O mesmo cliente pode ter mensagens sob DUAS identidades (LID e número
      // real). Busca em todas — senão a conversa aparece pela metade.
      const phones = [...new Set([phone, ...altPhones].filter(Boolean).map(p => this.normalizePhone(p)))];
      const fetches = [];
      for (const np of phones) {
        fetches.push(this.authFetch('/api/messages/' + np).then(r => r.json()).then(j => ({ src: 'bot', j })).catch(() => ({ src: 'bot', j: { ok: false } })));
        fetches.push(this.authFetch(this.waBaseUrl + '/api/wa/messages/' + np).then(r => r.json()).then(j => ({ src: 'wa', j })).catch(() => ({ src: 'wa', j: { ok: false } })));
      }
      const settled = await Promise.all(fetches);
      const botMsgs = [];
      const waMsgs  = [];
      for (const { src, j } of settled) {
        if (!j?.ok || !Array.isArray(j.data)) continue;
        if (src === 'bot') {
          for (const m of j.data) botMsgs.push({
            from:      m.direcao === 'saida' ? 'bot' : 'user',
            text:      m.conteudo,
            time:      this.fmtTime(m.criado_em || m.created_at),
            ts:        toTs(m.criado_em || m.created_at),
            direction: m.direcao === 'saida' ? 'out' : 'in',
            _src:      'bot',
          });
        } else {
          for (const m of j.data) waMsgs.push({
            from:      m.direction === 'out' ? 'bot' : 'user',
            text:      m.text,
            time:      this.fmtTime(m.timestamp),
            ts:        toTs(m.timestamp),
            direction: m.direction,
            _src:      'wa',
          });
        }
      }
      // Merge, ordena e deduplica por texto+ts próximos (janela 3s)
      const all = [...botMsgs, ...waMsgs].sort((a, b) => a.ts - b.ts);
      const deduped = [];
      for (const m of all) {
        const last = deduped[deduped.length - 1];
        if (last && last.text === m.text && Math.abs(last.ts - m.ts) < 3000) continue;
        deduped.push(m);
      }
      return deduped;
    },

    async selectConv(conv) {
      if (!this.viewedConvs) this.viewedConvs = new Set();
      this.viewedConvs.add(conv.id);
      this.selectedConv  = String(conv.id);
      const targetPhone  = conv.phone;
      this.atendPhone    = targetPhone;
      this.atendAltPhones = conv._altPhones || [];
      this.atendMessages = [];
      this.atendLoading  = true;
      this.atendHumano   = conv.humano_ativo || false;
      const normConvPhone = this.normalizePhone(targetPhone);
      this.atendLead     = this.leads.find(l => this.normalizePhone(l.phone) === normConvPhone) || null;
      if (!this.atendLead) {
        const ctx = (typeof conv.context === 'string')
          ? (() => { try { return JSON.parse(conv.context); } catch { return {}; } })()
          : (conv.context || {});
        const nome      = ctx.nome      || ctx._nome      || null;
        const interesse = ctx.interesse || ctx._interesse || null;
        const cidade    = ctx.cidade    || ctx._cidade    || null;
        const preco     = ctx.ultimo_preco_visto ? Number(ctx.ultimo_preco_visto) : null;
        if (nome || interesse || cidade) {
          this.atendLead = { phone: targetPhone, nome, interesse, cidade, status_comercial: null, valor_potencial: preco, _fromSession: true };
        }
      }
      try {
        const msgs = await this._loadAtendMessages(targetPhone, this.atendAltPhones);
        if (this.atendPhone !== targetPhone) return; // usuário trocou durante o fetch
        this.atendMessages = msgs;
        this.scrollChat();
      } catch (_) {}
      finally {
        if (this.atendPhone === targetPhone) this.atendLoading = false;
      }
    },

    saveCrmField(field, value) {
      if (!this.atendLead?.id) return;
      clearTimeout((this._crmSaveTimers || {})[field]);
      if (!this._crmSaveTimers) this._crmSaveTimers = {};
      this._crmSaveTimers[field] = setTimeout(async () => {
        try {
          const r = await this.authFetch(`/api/leads/${this.atendLead.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ [field]: value }),
          });
          const j = await r.json().catch(() => ({ ok: false }));
          if (!j.ok) this.toast('Alteração no lead NÃO foi salva' + (j.error ? ` (${j.error})` : '') + '.', 'err');
        } catch (_) {
          this.toast('Alteração no lead NÃO foi salva — sem conexão com o servidor.', 'err');
        }
      }, 800);
    },

    async toggleBot() {
      const newVal = !this.cfg.bot_ativo;
      this.cfg.bot_ativo = newVal;
      try {
        const r = await this.authFetch('/api/settings', {
          method: 'POST',
          body: JSON.stringify({ bot_ativo: newVal }),
        });
        const j = await r.json().catch(() => ({ ok: false }));
        if (!j.ok) {
          this.cfg.bot_ativo = !newVal; // reverte — o servidor não confirmou
          this.toast('Não consegui ' + (newVal ? 'ligar' : 'desligar') + ' o bot. Tente de novo.', 'err');
        }
      } catch (_) {
        this.cfg.bot_ativo = !newVal; // reverte se falhar
        this.toast('Não consegui ' + (newVal ? 'ligar' : 'desligar') + ' o bot — sem conexão.', 'err');
      }
    },

    async updateLeadStage(stage) {
      if (!this.atendLead?.id) return;
      try {
        const r = await this.authFetch(`/api/leads/${this.atendLead.id}/stage`, {
          method: 'PATCH',
          body: JSON.stringify({ stage }),
        });
        const j = await r.json().catch(() => ({ ok: false }));
        if (!j.ok) {
          this.toast('Mudança de estágio NÃO foi salva' + (j.error ? ` (${j.error})` : '') + '.', 'err');
          return; // não atualiza a UI com um estado que o servidor recusou
        }
        const nowIso = new Date().toISOString();
        this.atendLead = { ...this.atendLead, kanban_stage: stage, kanban_movido_por: 'manual', kanban_movido_manualmente_em: nowIso };
        const lead = this.leads.find(l => l.id === this.atendLead.id);
        if (lead) { lead.kanban_stage = stage; lead.kanban_movido_por = 'manual'; lead.kanban_movido_manualmente_em = nowIso; }
        this.loadKanban();
      } catch (_) {
        this.toast('Mudança de estágio NÃO foi salva — sem conexão.', 'err');
      }
    },

    async assumeConv() {
      if (!this.atendPhone) return;
      try {
        const r = await this.authFetch(`/api/sessions/${this.atendPhone}/assume`, { method: 'POST' });
        const j = await r.json().catch(() => ({ ok: false }));
        if (!j.ok) return this.toast('Não consegui assumir a conversa. Tente de novo.', 'err');
        this.atendHumano = true;
        this.toast('Você assumiu a conversa — o bot ficou mudo aqui.');
      } catch (_) {
        this.toast('Não consegui assumir a conversa — sem conexão.', 'err');
      }
    },

    async releaseConv() {
      if (!this.atendPhone) return;
      try {
        const r = await this.authFetch(`/api/sessions/${this.atendPhone}/release`, { method: 'POST' });
        const j = await r.json().catch(() => ({ ok: false }));
        if (!j.ok) return this.toast('Não consegui devolver a conversa pro bot.', 'err');
        this.atendHumano = false;
        this.toast('Conversa devolvida pro bot.');
      } catch (_) {
        this.toast('Não consegui devolver a conversa — sem conexão.', 'err');
      }
    },

    async sendAtendReply() {
      const text = this.atendReply.trim();
      if (!text || !this.atendPhone || this.atendSending) return;
      this.atendSending = true;
      const sent = text;
      this.atendReply = '';
      this.$nextTick(() => {
        const ta = document.getElementById('inbox-textarea');
        if (ta) { ta.style.height = 'auto'; }
      });
      try {
        // Canal principal: WhatsApp real via Baileys (Render). Sempre tenta
        // primeiro quando há servidor configurado — a checagem antiga comparava
        // telefone SEM normalizar e nunca batia, então o envio real era pulado.
        let ok = false;
        let waErr = '';
        if (this.waBaseUrl) {
          try {
            const headers = { 'Content-Type': 'application/json' };
            if (this._authToken) headers['Authorization'] = 'Bearer ' + this._authToken;
            const r = await fetch(this.waBaseUrl + '/api/wa/send', {
              method: 'POST', headers, body: JSON.stringify({ phone: this.atendPhone, text: sent }),
            });
            const j = await r.json();
            if (j.ok) ok = true; else waErr = j.error || '';
          } catch (_) {}
        }
        if (!ok) {
          // Fallback: registra no histórico e tenta Evolution (se configurado).
          const r = await this.authFetch(`/api/sessions/${this.atendPhone}/message`, {
            method: 'POST', body: JSON.stringify({ text: sent }),
          });
          const j = await r.json();
          if (!j.ok) throw new Error(j.error || 'Erro ao enviar');
          // NUNCA fingir entrega: se nenhum canal entregou, avisa na hora.
          if (j.whatsappSent === false) {
            alert('⚠️ A mensagem foi salva no histórico, mas NÃO chegou no WhatsApp do cliente' + (waErr ? ' (' + waErr + ')' : '') + '. Confira a conexão na aba WhatsApp.');
          }
        }
        this.atendMessages.push({ from: 'bot', text: sent, time: this.timeNow(), ts: Date.now(), direction: 'out' });
        this.scrollChat();
      } catch (_) {
        alert('Erro ao enviar mensagem. Tente novamente.');
        this.atendReply = sent;
      }
      finally { this.atendSending = false; }
    },

    atendKeydown(e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.sendAtendReply(); }
    },

});
