(window.FluxoModules = window.FluxoModules || []).push({
    /* ── Reports ─────────────────────────────────────────────────────── */
    async loadReports() {
      if (this.reportsLoading) return;
      this.reportsLoading = true;
      try {
        const r = await this.authFetch('/api/reports');
        const j = await r.json();
        if (j.ok && j.data) {
          this.reports = j.data;
          this.$nextTick(() => this.initCharts(j.data));
        }
      } catch (_) {
        this.$nextTick(() => this.initCharts(null));
      } finally {
        this.reportsLoading = false;
      }
    },

    /* charts */
    initCharts(data) {
      const d = data || {
        labels: ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'],
        atendimentos: [0,0,0,0,0,0,0],
        leads: [0,0,0,0,0,0,0],
      };
      const opts = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#6B6B77', font: { size: 11 } } },
          y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#6B6B77', font: { size: 11 } }, beginAtZero: true },
        },
      };

      const c1 = document.getElementById('chart-atend');
      if (c1) {
        if (c1._chart) { c1._chart.destroy(); c1._chart = null; }
        c1._chart = new Chart(c1, {
          type: 'bar',
          data: {
            labels: d.labels,
            datasets: [{
              data: d.atendimentos,
              backgroundColor: 'rgba(34,197,94,0.3)',
              borderColor: '#22C55E',
              borderWidth: 2,
              borderRadius: 6,
            }],
          },
          options: opts,
        });
      }

      const c2 = document.getElementById('chart-leads');
      if (c2) {
        if (c2._chart) { c2._chart.destroy(); c2._chart = null; }
        c2._chart = new Chart(c2, {
          type: 'line',
          data: {
            labels: d.labels,
            datasets: [{
              data: d.leads,
              borderColor: '#FACC15',
              backgroundColor: 'rgba(250,204,21,0.08)',
              borderWidth: 2,
              tension: 0.4,
              fill: true,
              pointBackgroundColor: '#FACC15',
              pointRadius: 4,
            }],
          },
          options: opts,
        });
      }

      const c3 = document.getElementById('chart-receita');
      if (c3) {
        if (c3._chart) { c3._chart.destroy(); c3._chart = null; }
        c3._chart = new Chart(c3, {
          type: 'bar',
          data: {
            labels: d.labels,
            datasets: [{
              data: d.faturamento || [0,0,0,0,0,0,0],
              backgroundColor: 'rgba(56,189,248,0.30)',
              borderColor: '#38BDF8',
              borderWidth: 2,
              borderRadius: 6,
            }],
          },
          options: {
            ...opts,
            plugins: {
              legend: { display: false },
              tooltip: { callbacks: { label: (ctx) => 'R$ ' + Number(ctx.raw || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) } },
            },
          },
        });
      }
    },

});
