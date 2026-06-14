(window.FluxoModules = window.FluxoModules || []).push({
    /* ── Kanban ──────────────────────────────────────────────────────── */
    async loadKanban() {
      try {
        const r = await this.authFetch('/api/leads');
        const j = await r.json();
        if (!j.ok) return;
        const cols  = STAGES.map(s => ({ ...s, items: [], total: 0 }));
        const byId  = Object.fromEntries(cols.map(c => [c.id, c]));
        for (const lead of j.data) {
          const stage = this.stageOf(lead);
          const col   = byId[stage] || cols[0];
          const val   = Number(lead.valor_potencial) || 0;
          col.items.push({
            id: lead.id, name: lead.nome || this.dispPhone(lead.phone), phone: lead.phone,
            interesse: lead.interesse || '—', val: this.fmtBRL(val), valNum: val,
            status: lead.status_comercial, score: lead.conversion_score || 0,
            ai_score:           lead.ai_score,
            ai_analisado_em:    lead.ai_analisado_em,
            ai_kanban_sugerida: lead.ai_kanban_sugerida,
            kanban_movido_por:  lead.kanban_movido_por,
            kanban_stage:       stage,
            auto:               !lead.kanban_movido_manualmente_em,
          });
          col.total += val;
        }
        this.kanban = cols;
        this.pipelineCount = cols.reduce((s, c) => s + c.items.length, 0);
        this.pipelineTotal = cols.reduce((s, c) => s + c.total, 0);
        const comprou = byId['comprou']?.items.length || 0;
        const ativos  = this.pipelineCount - (byId['perdido']?.items.length || 0);
        this.pipelineConversion = ativos > 0 ? Math.round((comprou / ativos) * 100) : 0;
      } catch (_) {}
    },

    kanbanDragStart(id, stage) {
      this.kanbanDragId    = id;
      this.kanbanDragStage = stage;
    },

    async kanbanMoveToSuggested(leadId, suggestedStage) {
      await this.authFetch(`/api/leads/${leadId}/stage`, {
        method: 'PATCH',
        body: JSON.stringify({ stage: suggestedStage }),
      }).catch(() => {});
      await this.loadKanban();
    },

    async kanbanDrop(targetStage) {
      const id = this.kanbanDragId;
      this.kanbanDragOver = null;
      if (!id || this.kanbanDragStage === targetStage) { this.kanbanDragId = null; return; }
      const src = this.kanban.find(c => c.id === this.kanbanDragStage);
      const tgt = this.kanban.find(c => c.id === targetStage);
      if (!src || !tgt) return;
      const item = src.items.find(i => i.id === id);
      if (!item) return;
      src.items = src.items.filter(i => i.id !== id);
      item.kanban_stage = targetStage;
      item.kanban_movido_por = 'manual';
      item.auto = false;
      tgt.items.push(item);
      // Recalcula totais das colunas afetadas.
      src.total = src.items.reduce((s, i) => s + (i.valNum || 0), 0);
      tgt.total = tgt.items.reduce((s, i) => s + (i.valNum || 0), 0);
      // Reflete o override no array de leads (CRM list / contadores).
      const lead = this.leads.find(l => l.id === id);
      if (lead) { lead.kanban_stage = targetStage; lead.kanban_movido_por = 'manual'; lead.kanban_movido_manualmente_em = new Date().toISOString(); }
      this.kanbanDragId = null;
      this.kanbanDragStage = null;
      await this.authFetch(`/api/leads/${id}/stage`, { method: 'PATCH', body: JSON.stringify({ stage: targetStage }) });
    },

});
