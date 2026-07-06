(window.FluxoModules = window.FluxoModules || []).push({
    /* ── Inteligência AI ─────────────────────────────────────────── */
    async analyzeLeadAI(leadId) {
      if (this.aiAnalyzing) return;
      this.aiAnalyzing = true;
      try {
        const r = await this.authFetch(`/api/intelligence/analyze/${leadId}`, { method: 'POST' });
        const j = await r.json();
        if (j.ok && this.crmLead?.id === leadId) {
          this.crmLead = { ...this.crmLead, ...j.data,
            ai_score:            j.data.score,
            ai_resumo:           j.data.resumo,
            ai_proxima_acao:     j.data.proxima_acao,
            ai_intencao:         j.data.intencao_principal,
            ai_temperatura:      j.data.temperatura,
            ai_kanban_sugerida:  j.data.kanban_coluna_sugerida,
            ai_confianca:        j.data.confianca,
            ai_analisado_em:     new Date().toISOString(),
          };
        }
        if (!j.ok) this.toast('Análise de IA falhou' + (j.error ? ` (${j.error})` : '') + '.', 'err');
        await this.loadLeads();
        if (this.page === 'kanban') await this.loadKanban();
      } catch (_) {
        this.toast('Análise de IA falhou — sem conexão.', 'err');
      }
      finally { this.aiAnalyzing = false; }
    },

    async analyzeAllLeadsAI() {
      if (this.aiAnalyzingAll) return;
      this.aiAnalyzingAll = true;
      try {
        const r = await this.authFetch('/api/intelligence/analyze-all', { method: 'POST' });
        const j = await r.json();
        if (j.ok) {
          this.aiStatus = `Analisando ${j.total_leads} leads em background...`;
          setTimeout(() => {
            this.aiStatus = null;
            this.loadLeads();
            if (this.page === 'kanban') this.loadKanban();
          }, 15000);
        } else {
          this.toast('Análise em massa falhou' + (j.error ? ` (${j.error})` : '') + '.', 'err');
        }
      } catch (_) {
        this.toast('Análise em massa falhou — sem conexão.', 'err');
      }
      finally { this.aiAnalyzingAll = false; }
    },

    intencaoLabel(intencao) {
      const map = {
        interesse_produto:    '🛍️ Interesse em produto',
        pergunta_preco:       '💰 Perguntou preço',
        reclamacao:           '😡 Reclamação',
        abandono:             '👋 Abandono',
        pronto_comprar:       '🔥 Pronto p/ comprar',
        primeiro_contato:     '👋 Primeiro contato',
        sem_intencao_clara:   '❔ Sem intenção clara',
      };
      return map[intencao] || intencao || '—';
    },

    openNewLeadModal() {
      this.newLead = { phone: '', nome: '', interesse: '', status_comercial: 'FRIO', kanban_stage: 'novo', valor_potencial: '', cidade: '' };
      this.newLeadError = null;
      this.newLeadModal = true;
    },

    async saveNewLead() {
      if (this.newLeadSaving) return;
      const digits = this.newLead.phone.replace(/\D/g, '');
      if (digits.length < 10) { this.newLeadError = 'Telefone inválido (mínimo 10 dígitos).'; return; }
      if (!this.newLead.nome.trim()) { this.newLeadError = 'Nome obrigatório.'; return; }
      this.newLeadSaving = true;
      this.newLeadError = null;
      try {
        const r = await this.authFetch('/api/leads', {
          method: 'POST',
          body: JSON.stringify(this.newLead),
        });
        const j = await r.json();
        if (!j.ok) throw new Error(j.error || 'Erro ao criar lead.');
        this.newLeadModal = false;
        await this.loadLeads();
        if (this.page === 'kanban') await this.loadKanban();
      } catch (err) {
        this.newLeadError = err.message || 'Erro ao criar lead.';
      } finally {
        this.newLeadSaving = false;
      }
    },

    async saveIngestSelected() {
      if (this.ingestSaving) return;

      const toSave  = this.ingestItems.filter(i => i.selected && !i.savedOk && i.status === 'pronto');
      const blocked = this.ingestItems.filter(i => i.selected && !i.savedOk && i.status === 'revisar');

      // Se só há itens revisar selecionados e nenhum pronto, bloqueia tudo
      if (blocked.length > 0 && toSave.length === 0) {
        this.productFeedback    = 'erro';
        this.productFeedbackMsg = 'Revise os itens pendentes antes de salvar. Clique em ↗ para corrigir cada um.';
        setTimeout(() => { this.productFeedback = null; }, 5000);
        return;
      }

      if (!toSave.length) return;
      this.ingestSaving = true;
      let saved = 0, failed = 0;

      for (const item of toSave) {
        try {
          const body = {
            name:           item.name,
            item_type:      item.type,
            price:          item.price || null,
            price_type:     item.price ? 'fixo' : (item.type === 'orcamento' ? 'sob_consulta' : 'fixo'),
            stock:          item.type === 'produto_fisico' ? 0 : null,
            is_active:      true,
            included_items: item.composition || null,
          };
          const r = await this.authFetch('/api/products', { method: 'POST', body: JSON.stringify(body) });
          const j = await r.json();
          if (j.ok) { item.savedOk = true; saved++; }
          else      { item.savedError = this.apiErr(j.error); failed++; }
        } catch (_) {
          item.savedError = 'Erro de conexão'; failed++;
        }
      }

      this.ingestSaving = false;
      if (saved > 0) await this.loadProducts();

      const parts = [];
      if (saved > 0)      parts.push(`${saved} item(ns) salvo(s) no catálogo!`);
      if (blocked.length) parts.push(`${blocked.length} item(ns) com "revisar" não foram salvos — corrija-os primeiro.`);
      if (failed > 0)     parts.push(`${failed} com erro.`);

      this.productFeedback    = (failed > 0 || blocked.length > 0) ? 'erro' : 'ok';
      this.productFeedbackMsg = parts.join(' ');
      setTimeout(() => { this.productFeedback = null; }, 5000);
    },

});
