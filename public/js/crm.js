(window.FluxoModules = window.FluxoModules || []).push({
    /* ── CRM ─────────────────────────────────────────────────────────── */
    async selectCrmLead(lead) {
      this.crmLead     = { ...lead };
      this.crmMessages = [];
      this.crmTimeline = [];
      this.crmPurchases = [];
      try {
        const r = await this.authFetch(`/api/leads/${lead.id}`);
        const j = await r.json();
        if (j.ok && j.data) {
          this.crmLead     = { ...j.data };
          this.crmMessages = (j.data.messages || []).map(m => ({
            from: m.direcao === 'saida' ? 'bot' : 'user',
            text: m.conteudo,
            time: this.fmtTime(m.criado_em || m.created_at),
          }));
        }
      } catch (_) {}
      this.loadLeadTimeline(lead.id);
      this.loadLeadPurchases(lead.id);
    },

    async saveCrmLead() {
      if (!this.crmLead || this.crmSaving) return;
      this.crmSaving = true;
      this.crmFeedback = null;
      try {
        const r = await this.authFetch(`/api/leads/${this.crmLead.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            nome:             this.crmLead.nome,
            interesse:        this.crmLead.interesse,
            status_comercial: this.crmLead.status_comercial,
            proxima_acao:     this.crmLead.proxima_acao,
            valor_potencial:  Number(this.crmLead.valor_potencial) || 0,
            cidade:           this.crmLead.cidade,
            tamanho:          this.crmLead.tamanho,
            estilo:           this.crmLead.estilo,
            notes:            this.crmLead.notes,
          }),
        });
        const j = await r.json();
        if (j.ok) {
          const idx = this.leads.findIndex(l => l.id === this.crmLead.id);
          if (idx !== -1) this.leads[idx] = { ...this.leads[idx], ...j.data };
          this.crmFeedback = 'ok';
          this.crmFeedbackMsg = 'Lead salvo!';
        } else {
          this.crmFeedback = 'erro';
          this.crmFeedbackMsg = this.apiErr(j.error);
        }
      } catch (_) {
        this.crmFeedback = 'erro';
        this.crmFeedbackMsg = 'Erro de conexão.';
      } finally {
        this.crmSaving = false;
        setTimeout(() => { this.crmFeedback = null; }, 3000);
      }
    },

    async loadLeadTimeline(leadId) {
      try {
        const r = await this.authFetch(`/api/leads/${leadId}/timeline`);
        const j = await r.json();
        if (j.ok && Array.isArray(j.data)) this.crmTimeline = j.data;
      } catch (_) {}
    },

    async loadLeadPurchases(leadId) {
      try {
        const r = await this.authFetch(`/api/leads/${leadId}/purchases`);
        const j = await r.json();
        if (j.ok && Array.isArray(j.data)) this.crmPurchases = j.data;
      } catch (_) {}
    },

    async addPurchase(leadId) {
      const produto = prompt('Produto comprado:');
      if (!produto?.trim()) return;
      const valorStr = prompt('Valor da compra (R$):');
      const valor = valorStr ? Number(valorStr.replace(',', '.')) : null;
      try {
        const r = await this.authFetch(`/api/leads/${leadId}/purchases`, {
          method: 'POST',
          body: JSON.stringify({ produto, valor }),
        });
        const j = await r.json();
        if (j.ok) {
          await this.loadLeadPurchases(leadId);
          await this.loadLeadTimeline(leadId);
          await this.selectCrmLead({ id: leadId, phone: this.crmLead.phone });
          this.crmFeedback = 'ok';
          this.crmFeedbackMsg = 'Compra registrada!';
        }
      } catch (_) {}
      finally { setTimeout(() => { this.crmFeedback = null; }, 3000); }
    },

    scoreColor(score) {
      if (score >= 75) return '#ef4444';
      if (score >= 50) return '#f59e0b';
      if (score >= 25) return '#38bdf8';
      return '#6b7280';
    },

    scoreLabel(score) {
      if (score >= 75) return 'Muito quente';
      if (score >= 50) return 'Promissor';
      if (score >= 25) return 'Em construção';
      return 'Frio';
    },

    crmWhatsApp(phone) {
      // Usa o número REAL (não o LID) para o link funcionar no WhatsApp.
      let n = (this.realPhone(phone) || '').replace(/\D/g, '');
      if (n && !n.startsWith('55')) n = '55' + n;
      return n ? `https://wa.me/${n}` : '#';
    },

    async convertLead(id) {
      if (!id || !confirm('Marcar como CONVERTIDO (venda fechada)?')) return;
      try {
        const r = await this.authFetch(`/api/leads/${id}/convert`, { method: 'POST' });
        const j = await r.json();
        if (j.ok) {
          await this.loadLeads();
          if (this.page === 'kanban') this.loadKanban();
          if (this.crmLead?.id === id) this.crmLead.status = 'concluido';
          this.crmFeedback = 'ok';
          this.crmFeedbackMsg = '🎉 Lead convertido!';
        } else {
          this.crmFeedback = 'erro';
          this.crmFeedbackMsg = this.apiErr(j.error);
        }
      } catch (_) {
        this.crmFeedback = 'erro';
        this.crmFeedbackMsg = 'Erro de conexão.';
      } finally {
        setTimeout(() => { this.crmFeedback = null; }, 3000);
      }
    },

    async loseLead(id) {
      const motivo = prompt('Motivo da perda (opcional):');
      if (motivo === null) return;
      try {
        const r = await this.authFetch(`/api/leads/${id}/lose`, { method: 'POST', body: JSON.stringify({ motivo }) });
        const j = await r.json();
        if (j.ok) {
          await this.loadLeads();
          if (this.page === 'kanban') this.loadKanban();
          this.crmFeedback = 'ok';
          this.crmFeedbackMsg = 'Lead marcado como perdido.';
        } else {
          this.crmFeedback = 'erro';
          this.crmFeedbackMsg = this.apiErr(j.error);
        }
      } catch (_) {
        this.crmFeedback = 'erro';
        this.crmFeedbackMsg = 'Erro de conexão.';
      } finally {
        setTimeout(() => { this.crmFeedback = null; }, 3000);
      }
    },

    async addNoteLead(id) {
      const text = prompt('Adicionar nota:');
      if (!text?.trim()) return;
      try {
        const r = await this.authFetch(`/api/leads/${id}/note`, { method: 'POST', body: JSON.stringify({ text }) });
        const j = await r.json();
        if (j.ok) {
          if (this.crmLead?.id === id) {
            const ts = new Date().toLocaleString('pt-BR');
            this.crmLead.notes = this.crmLead.notes
              ? `${this.crmLead.notes}\n[${ts}] ${text}`
              : `[${ts}] ${text}`;
          }
          this.crmFeedback = 'ok';
          this.crmFeedbackMsg = 'Nota adicionada.';
        } else {
          this.crmFeedback = 'erro';
          this.crmFeedbackMsg = this.apiErr(j.error);
        }
      } catch (_) {
        this.crmFeedback = 'erro';
        this.crmFeedbackMsg = 'Erro de conexão.';
      } finally {
        setTimeout(() => { this.crmFeedback = null; }, 3000);
      }
    },

    async followupDone(id, dias = 3) {
      try {
        const r = await this.authFetch(`/api/leads/${id}/followup-done`, { method: 'POST', body: JSON.stringify({ dias }) });
        const j = await r.json();
        if (j.ok) {
          this.followupToday = this.followupToday.filter(l => l.id !== id);
          this.crmFeedback = 'ok';
          this.crmFeedbackMsg = `Follow-up reagendado para ${dias} dias.`;
        }
      } catch (_) {}
      finally { setTimeout(() => { this.crmFeedback = null; }, 3000); }
    },

});
