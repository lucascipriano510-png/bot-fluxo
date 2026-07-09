(window.FluxoModules = window.FluxoModules || []).push({
    /* ── WhatsApp direto (Baileys) ──────────────────────────────────────── */
    async waInit() {
      await this.waLoadStatus();
      if (this.waPollingInterval) { clearInterval(this.waPollingInterval); this.waPollingInterval = null; }
      if (this.waStatus === 'unavailable') return; // Vercel stub — sem polling
      if (this.waStatus === 'qr_pending') {
        this.waPollingInterval = setInterval(async () => {
          await this.waLoadStatus();
          if (this.waStatus === 'connected') {
            clearInterval(this.waPollingInterval); this.waPollingInterval = null;
            await this.waLoadConversations();
          }
        }, 3000);
      } else if (this.waStatus === 'connected') {
        await this.waLoadConversations();
        this.waPollingInterval = setInterval(async () => {
          await this.waLoadConversations();
        }, 5000);
      }
    },

    async waLoadStatus() {
      if (!this.waBaseUrl) return;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      try {
        const r = await this.authFetch(this.waBaseUrl + '/api/wa/status', { signal: controller.signal });
        const j = await r.json();
        if (j.ok) { this.waStatus = j.status; this.waQr = j.qr || null; }
      } catch (err) {
        if (err.name === 'AbortError') this.waStatus = 'disconnected';
        // outros erros de rede mantêm estado atual
      } finally {
        clearTimeout(timer);
      }
    },

    waOpenReconnect() {
      this.waReconnectModal = true;
      this.waLoadStatus();
      if (this.waReconnectPoller) clearInterval(this.waReconnectPoller);
      this.waReconnectPoller = setInterval(async () => {
        await this.waLoadStatus();
        if (this.waStatus === 'connected') {
          this.waCloseReconnect();
          await this.waLoadConversations();
        }
      }, 3000);
    },

    waCloseReconnect() {
      this.waReconnectModal = false;
      if (this.waReconnectPoller) { clearInterval(this.waReconnectPoller); this.waReconnectPoller = null; }
    },

    async waLoadConversations() {
      if (!this.waBaseUrl) return;
      try {
        const r = await this.authFetch(this.waBaseUrl + '/api/wa/conversations');
        const j = await r.json();
        if (j.ok && Array.isArray(j.data)) this.waConversations = j.data;
      } catch (_) {}
    },

    async waLoadMessages(phone) {
      try {
        const normPhone = this.normalizePhone(phone);
        const r = await this.authFetch(this.waBaseUrl + '/api/wa/messages/' + normPhone);
        const j = await r.json();
        if (j.ok && Array.isArray(j.data)) {
          // Guard de race condition: usuário pode ter trocado de conversa durante o fetch
          if (normPhone !== this.normalizePhone(this.waSelectedPhone)) return;
          // Só sobrescreve se houver dados reais ou for a primeira carga
          if (j.data.length > 0 || this.waMessages.length === 0) {
            this.waMessages = j.data;
            this.$nextTick(() => {
              const el = document.getElementById('wa-messages');
              if (el) { el.scrollTop = el.scrollHeight; requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; }); }
            });
          }
        }
      } catch (_) {}
    },

    async waSelectConv(phone) {
      this.waSelectedPhone = phone;
      this.waMessages = [];
      this.waCurrentLoading = true;
      try {
        await this.waLoadMessages(phone);
      } finally {
        this.waCurrentLoading = false;
      }
      // mark read locally
      const conv = this.waConversations.find(c => this.normalizePhone(c.phone) === this.normalizePhone(phone));
      if (conv) conv.unread_count = 0;
    },

    async waSend() {
      const text = this.waInput.trim();
      if (!text || !this.waSelectedPhone || this.waSending) return;
      this.waSending = true;
      this.waInput   = '';
      try {
        const r = await this.authFetch(this.waBaseUrl + '/api/wa/send', {
          method: 'POST',
          body: JSON.stringify({ phone: this.waSelectedPhone, text }),
        });
        const j = await r.json();
        if (j.ok) {
          this.waMessages.push({ direction: 'out', text, timestamp: new Date().toISOString() });
          this.$nextTick(() => {
            const el = document.getElementById('wa-messages');
            if (el) el.scrollTop = el.scrollHeight;
          });
        } else {
          this.waInput = text;
          alert('Erro ao enviar: ' + (j.error || 'tente novamente'));
        }
      } catch (_) { this.waInput = text; }
      finally { this.waSending = false; }
    },

    async waDisconnect() {
      if (!confirm('Desconectar o WhatsApp e limpar a sessão?')) return;
      await this.authFetch(this.waBaseUrl + '/api/wa/disconnect', { method: 'POST' });
      this.waStatus = 'disconnected'; this.waQr = null;
      this.waConversations = []; this.waSelectedPhone = null; this.waMessages = [];
      if (this.waPollingInterval) { clearInterval(this.waPollingInterval); this.waPollingInterval = null; }
    },

    waKeydown(e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.waSend(); }
    },

    async runAnalysis() {
      if (this.analysisRunning) return;
      this.analysisRunning = true;
      this.analysisFeedback = null;
      try {
        const r = await this.authFetch('/api/brain/analyze', { method: 'POST' });
        const j = await r.json();
        if (j.ok) {
          this.analysisFeedback = 'ok';
          this.analysisFeedbackMsg = `✅ ${j.conversationsAnalyzed} conversas analisadas. Brain atualizado!`;
          await this.loadBrain();
        } else {
          this.analysisFeedback = 'erro';
          this.analysisFeedbackMsg = j.error || 'Erro na análise.';
        }
      } catch (_) {
        this.analysisFeedback = 'erro';
        this.analysisFeedbackMsg = 'Erro de conexão.';
      } finally {
        this.analysisRunning = false;
        setTimeout(() => { this.analysisFeedback = null; }, 5000);
      }
    },

    async loadProducts() {
      this.productsLoading = true;
      try {
        const r = await this.authFetch('/api/products');
        const j = await r.json();
        if (j.ok && Array.isArray(j.data)) this.products = j.data;
      } catch (_) { this.loadErrToast(); }
      finally { this.productsLoading = false; }
    },

    async loadSessions() {
      try {
        const r = await this.authFetch('/api/sessions');
        const j = await r.json();
        if (j.ok && Array.isArray(j.data)) {
          this.sessions = j.data;
          const fiveMinAgo = Date.now() - 5 * 60 * 1000;
          this.conversations = j.data.slice(0, 100).map(s => ({
            id:           s.id,
            name:         s.nome || s.phone,
            phone:        s.phone,
            msg:          s.last_msg
                            ? (s.last_msg.length > 55 ? s.last_msg.slice(0, 55) + '…' : s.last_msg)
                            : `Nó: ${s.current_node}`,
            time:         this.fmtTime(s.atualizado_em),
            unread:       (!this.viewedConvs?.has(s.id) && new Date(s.atualizado_em).getTime() > fiveMinAgo) ? 1 : 0,
            tag:          s.status_comercial || 'novo',
            node:         s.current_node,
            avatar:       (s.nome || s.phone).charAt(0).toUpperCase(),
            humano_ativo: s.humano_ativo || false,
            context:      s.context || {},
          }));
        }
      } catch (_) { this.loadErrToast(); }
    },

});
