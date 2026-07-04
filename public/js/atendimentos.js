(window.FluxoModules = window.FluxoModules || []).push({
    /* ── Atendimentos ────────────────────────────────────────────────── */
    async _loadAtendMessages(phone) {
      const toTs = s => { try { return new Date(s).getTime(); } catch { return 0; } };
      const normPhone = this.normalizePhone(phone);
      const [botRes, waRes] = await Promise.allSettled([
        this.authFetch('/api/messages/' + normPhone).then(r => r.json()),
        this.authFetch(this.waBaseUrl + '/api/wa/messages/' + normPhone).then(r => r.json()).catch(() => ({ ok: false })),
      ]);
      const botMsgs = (botRes.status === 'fulfilled' && botRes.value?.ok && Array.isArray(botRes.value.data))
        ? botRes.value.data.map(m => ({
            from:      m.direcao === 'saida' ? 'bot' : 'user',
            text:      m.conteudo,
            time:      this.fmtTime(m.criado_em || m.created_at),
            ts:        toTs(m.criado_em || m.created_at),
            direction: m.direcao === 'saida' ? 'out' : 'in',
            _src:      'bot',
          }))
        : [];
      const waMsgs = (waRes.status === 'fulfilled' && waRes.value?.ok && Array.isArray(waRes.value.data))
        ? waRes.value.data.map(m => ({
            from:      m.direction === 'out' ? 'bot' : 'user',
            text:      m.text,
            time:      this.fmtTime(m.timestamp),
            ts:        toTs(m.timestamp),
            direction: m.direction,
            _src:      'wa',
          }))
        : [];
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
        const msgs = await this._loadAtendMessages(targetPhone);
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
          await this.authFetch(`/api/leads/${this.atendLead.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ [field]: value }),
          });
        } catch (_) {}
      }, 800);
    },

    async toggleBot() {
      const newVal = !this.cfg.bot_ativo;
      this.cfg.bot_ativo = newVal;
      try {
        await this.authFetch('/api/settings', {
          method: 'POST',
          body: JSON.stringify({ bot_ativo: newVal }),
        });
      } catch (_) {
        this.cfg.bot_ativo = !newVal; // reverte se falhar
      }
    },

    async updateLeadStage(stage) {
      if (!this.atendLead?.id) return;
      try {
        await this.authFetch(`/api/leads/${this.atendLead.id}/stage`, {
          method: 'PATCH',
          body: JSON.stringify({ stage }),
        });
        const nowIso = new Date().toISOString();
        this.atendLead = { ...this.atendLead, kanban_stage: stage, kanban_movido_por: 'manual', kanban_movido_manualmente_em: nowIso };
        const lead = this.leads.find(l => l.id === this.atendLead.id);
        if (lead) { lead.kanban_stage = stage; lead.kanban_movido_por = 'manual'; lead.kanban_movido_manualmente_em = nowIso; }
        this.loadKanban();
      } catch (_) {}
    },

    async assumeConv() {
      if (!this.atendPhone) return;
      await this.authFetch(`/api/sessions/${this.atendPhone}/assume`, { method: 'POST' });
      this.atendHumano = true;
    },

    async releaseConv() {
      if (!this.atendPhone) return;
      await this.authFetch(`/api/sessions/${this.atendPhone}/release`, { method: 'POST' });
      this.atendHumano = false;
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
