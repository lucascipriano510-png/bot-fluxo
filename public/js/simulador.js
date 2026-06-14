(window.FluxoModules = window.FluxoModules || []).push({
    /* chat simulator */
    async simStart() {
      if (!this.simPhone) return;
      this.simMessages = [];
      this.simLoading = true;
      this.simStarted = true;

      try {
        await this.authFetch('/api/sim/reset', {
          method: 'POST',
          body: JSON.stringify({ phone: this.simPhone }),
        });
        // Nota de sistema (não é mensagem do bot)
        this.simMessages.push({ from: 'system', text: 'Sessão iniciada. Digite a primeira mensagem como se fosse o cliente.', time: this.timeNow() });
      } catch (e) {
        this.simMessages.push({ from: 'system', text: 'Erro ao iniciar sessão. Verifique o servidor.', time: this.timeNow() });
      } finally {
        this.simLoading = false;
        this.$nextTick(() => this.scrollChat());
      }
    },

    async simSend() {
      const msg = this.simInput.trim();
      if (!msg || this.simLoading) return;

      this.simMessages.push({ from: 'user', text: msg, time: this.timeNow() });
      this.simInput = '';
      this.simLoading = true;
      this.$nextTick(() => this.scrollChat());

      try {
        const r = await this.authFetch('/api/chat', {
          method: 'POST',
          body: JSON.stringify({ phone: this.simPhone, message: msg }),
        });
        const j = await r.json();
        if (j.ok) {
          const msg = { from: 'bot', text: j.reply, time: this.timeNow(), intent: null, confidence: null };
          if (j.intent && j.intent !== 'unknown') { msg.intent = j.intent; msg.confidence = j.confidence; }
          this.simMessages.push(msg);
        } else {
          this.simMessages.push({ from: 'bot', text: this.apiErr(j.error) || 'Erro ao processar.', time: this.timeNow(), intent: null, confidence: null });
        }
      } catch (e) {
        this.simMessages.push({ from: 'bot', text: 'Erro de conexão.', time: this.timeNow() });
      } finally {
        this.simLoading = false;
        this.$nextTick(() => this.scrollChat());
      }
    },

    simKeydown(e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (this.simStarted) this.simSend();
      }
    },

    scrollChat() {
      this.$nextTick(() => {
        this.$nextTick(() => {
          const el = document.getElementById('atend-messages');
          if (el) {
            el.scrollTop = el.scrollHeight;
            requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
          }
          const el2 = document.getElementById('sim-messages');
          if (el2) {
            el2.scrollTop = el2.scrollHeight;
            requestAnimationFrame(() => { el2.scrollTop = el2.scrollHeight; });
          }
        });
      });
    },

});
