/* ═══════════════════════════════════════════════════
   FLUXO COMMAND — App Logic + Mock Data
   ═══════════════════════════════════════════════════ */

const MOCK = {
  kanban: [
    { id: 'novo', label: 'Novo Lead', color: '#38BDF8', items: [
      { name: 'Thiago L.', phone: '5534993456789', interesse: 'Tênis 42', val: 'R$299' },
      { name: 'Luana F.', phone: '5534994567890', interesse: 'Bermuda', val: 'R$149' },
    ]},
    { id: 'interessado', label: 'Interessado', color: '#A855F7', items: [
      { name: 'Bruno S.', phone: '5534993456789', interesse: 'Kit Polo', val: 'R$450' },
    ]},
    { id: 'escolhendo', label: 'Escolhendo', color: '#FACC15', items: [
      { name: 'Rafael P.', phone: '5511988765432', interesse: 'Bermuda Jeans', val: 'R$189' },
    ]},
    { id: 'carrinho', label: 'Carrinho Montado', color: '#F97316', items: [
      { name: 'Carlos M.', phone: '5534991234567', interesse: 'Camisa Lacoste G', val: 'R$340' },
    ]},
    { id: 'pagamento', label: 'Aguardando Pgto.', color: '#22C55E', items: [] },
    { id: 'finalizado', label: 'Finalizado', color: '#6B7280', items: [] },
  ],

  chartData: {
    labels: ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'],
    atendimentos: [18, 22, 31, 27, 35, 41, 27],
    leads: [5, 8, 11, 9, 14, 18, 14],
  },

};

/* ─────────────────────────────────────────────────────
   FluxoCommand — Alpine.js app factory
───────────────────────────────────────────────────── */
function FluxoCommand() {
  return {
    /* auth */
    _sb:          null,   // Supabase client instance
    _authToken:   null,   // JWT do usuário logado
    authUser:     null,   // objeto user do Supabase
    authLoading:  true,   // true enquanto verifica sessão
    loginEmail:   '',
    loginPassword:'',
    loginError:   '',
    loginLoading: false,

    /* state */
    page: 'dashboard',
    sidebarOpen: false,
    selectedConv: 1,

    /* data — starts empty, populated by real API after login */
    conversations: [],
    convMessages: {},
    leads: [],
    products: [],
    sessions: [],

    /* simulador */
    simPhone: '5534999999999',
    simInput: '',
    simMessages: [],
    simLoading: false,
    simStarted: false,

    /* produtos */
    productSearch: '',
    productCategory: '',
    productsLoading: false,

    /* settings */
    cfg: {
      nome_loja:       '',
      whatsapp:        '',
      saudacao:        '',
      horario_inicio:  '09:00',
      horario_fim:     '18:00',
      bot_ativo:       true,
      ignorar_horario: false,
      fallback_humano: true,
      delay_resposta:  true,
    },
    cfgSaving:      false,
    cfgFeedback:    null,   // null | 'ok' | 'erro'
    cfgFeedbackMsg: '',
    cfgSetupNeeded: false,

    /* computed */
    get currentConvMessages() {
      return this.convMessages[this.selectedConv] || [];
    },

    get currentConv() {
      return this.conversations.find(c => c.id === this.selectedConv) || this.conversations[0];
    },

    // botOn e ignorarHorario são aliases para os campos de cfg (única fonte de verdade)
    get botOn()           { return this.cfg.bot_ativo; },
    set botOn(v)          { this.cfg.bot_ativo = v; },
    get ignorarHorario()  { return this.cfg.ignorar_horario; },
    set ignorarHorario(v) { this.cfg.ignorar_horario = v; },

    get leadsQuentes() { return this.leads.filter(l => l.status_comercial === 'QUENTE').length; },
    get leadsMornos()  { return this.leads.filter(l => l.status_comercial === 'MORNO').length; },
    get leadsFrios()   { return this.leads.filter(l => l.status_comercial === 'FRIO').length; },

    get filteredProducts() {
      let list = this.products;
      const q = this.productSearch.trim().toLowerCase();
      if (q) {
        list = list.filter(p =>
          (p.name        || '').toLowerCase().includes(q) ||
          (p.subcategory || '').toLowerCase().includes(q) ||
          (p.category    || '').toLowerCase().includes(q) ||
          (p.sku         || '').toLowerCase().includes(q)
        );
      }
      if (this.productCategory) {
        list = list.filter(p => p.category === this.productCategory);
      }
      return list;
    },

    get productCategories() {
      return [...new Set(this.products.map(p => p.category).filter(Boolean))].sort();
    },

    get productsInStock()  { return this.products.filter(p => (p.stock || 0) > 0).length; },
    get productsNoStock()  { return this.products.filter(p => (p.stock || 0) <= 0).length; },

    get kanban() { return MOCK.kanban; },

    /* navigation */
    navigate(p) {
      this.page = p;
      this.sidebarOpen = false;
      window.location.hash = p;
      if (p === 'relatorios') this.$nextTick(() => this.initCharts());
    },

    /* ── Auth ─────────────────────────────────────────────────────────────── */
    // Wrapper para fetch que injeta o token Bearer automaticamente
    async authFetch(url, opts = {}) {
      const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
      if (this._authToken) headers['Authorization'] = `Bearer ${this._authToken}`;
      return fetch(url, { ...opts, headers });
    },

    async login() {
      if (this.loginLoading) return;
      if (!this._sb) {
        this.loginError = 'Autenticação não configurada. Verifique SUPABASE_ANON_KEY no Vercel.';
        return;
      }
      if (!this.loginEmail || !this.loginPassword) {
        this.loginError = 'Preencha e-mail e senha.';
        return;
      }
      this.loginLoading = true;
      this.loginError   = '';
      try {
        const { data, error } = await this._sb.auth.signInWithPassword({
          email:    this.loginEmail.trim(),
          password: this.loginPassword,
        });
        if (error) {
          this.loginError = error.message === 'Invalid login credentials'
            ? 'E-mail ou senha incorretos.'
            : error.message;
          return;
        }
        this.authUser   = data.user;
        this._authToken = data.session?.access_token || null;
        await this._loadPanelData();
      } catch {
        this.loginError = 'Erro ao conectar. Tente novamente.';
      } finally {
        this.loginLoading = false;
      }
    },

    async logout() {
      if (this._sb) await this._sb.auth.signOut();
      this.authUser   = null;
      this._authToken = null;
    },

    /* init */
    async init() {
      const hash = window.location.hash.slice(1);
      if (hash) this.page = hash;

      window.addEventListener('hashchange', () => {
        const h = window.location.hash.slice(1);
        if (h) this.page = h;
      });

      // 1. Carrega config pública para inicializar o cliente Supabase
      try {
        const cfgRes = await fetch('/api/config');
        const cfg    = await cfgRes.json();
        if (cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase) {
          this._sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);

          // 2. Verifica sessão existente
          const { data: { session } } = await this._sb.auth.getSession();
          if (session) {
            this.authUser   = session.user;
            this._authToken = session.access_token;
          }

          // 3. Mantém token atualizado automaticamente
          this._sb.auth.onAuthStateChange((_event, s) => {
            this.authUser   = s?.user   || null;
            this._authToken = s?.access_token || null;
          });
        }
      } catch (_) { /* sem auth configurado, modo dev */ }

      this.authLoading = false;
      if (!this.authUser) return; // mostra tela de login

      await this._loadPanelData();
      if (this.page === 'relatorios') {
        await this.$nextTick();
        this.initCharts();
      }
    },

    async _loadPanelData() {
      await Promise.allSettled([
        this.loadLeads(),
        this.loadSessions(),
        this.loadProducts(),
        this.loadSettings(),
      ]);
    },

    /* ── Configurações ─────────────────────────────────────────────────── */
    async loadSettings() {
      try {
        const r = await this.authFetch('/api/settings');
        const j = await r.json();
        this.cfgSetupNeeded = j.setup_needed === true;
        if (j.ok && j.data) {
          const d = j.data;
          this.cfg.nome_loja       = d.nome_loja       ?? this.cfg.nome_loja;
          this.cfg.whatsapp        = d.whatsapp        ?? this.cfg.whatsapp;
          this.cfg.saudacao        = d.saudacao        ?? this.cfg.saudacao;
          this.cfg.horario_inicio  = d.horario_inicio  ?? this.cfg.horario_inicio;
          this.cfg.horario_fim     = d.horario_fim     ?? this.cfg.horario_fim;
          this.cfg.bot_ativo       = d.bot_ativo       ?? this.cfg.bot_ativo;
          this.cfg.ignorar_horario = d.ignorar_horario ?? this.cfg.ignorar_horario;
          this.cfg.fallback_humano = d.fallback_humano ?? this.cfg.fallback_humano;
          this.cfg.delay_resposta  = d.delay_resposta  ?? this.cfg.delay_resposta;
        }
      } catch (_) { /* mantém defaults */ }
    },

    async saveSettings() {
      if (this.cfgSaving) return;
      this.cfgSaving = true;
      this.cfgFeedback = null;
      try {
        const r = await this.authFetch('/api/settings', {
          method: 'POST',
          body: JSON.stringify({
            nome_loja:       this.cfg.nome_loja,
            whatsapp:        this.cfg.whatsapp,
            saudacao:        this.cfg.saudacao,
            horario_inicio:  this.cfg.horario_inicio,
            horario_fim:     this.cfg.horario_fim,
            bot_ativo:       this.cfg.bot_ativo,
            ignorar_horario: this.cfg.ignorar_horario,
            fallback_humano: this.cfg.fallback_humano,
            delay_resposta:  this.cfg.delay_resposta,
          }),
        });
        const j = await r.json();
        if (j.ok) {
          this.cfgFeedback = 'ok';
          this.cfgFeedbackMsg = 'Configurações salvas com sucesso!';
          this.cfgSetupNeeded = false;
        } else {
          this.cfgFeedback = 'erro';
          this.cfgFeedbackMsg = j.error === 'TABLE_MISSING'
            ? 'Tabela bot_settings não existe. Execute o SQL mostrado acima e tente novamente.'
            : (j.error || 'Erro ao salvar.');
          if (j.error === 'TABLE_MISSING') this.cfgSetupNeeded = true;
        }
      } catch (e) {
        this.cfgFeedback = 'erro';
        this.cfgFeedbackMsg = 'Erro de conexão ao salvar.';
      } finally {
        this.cfgSaving = false;
        setTimeout(() => { this.cfgFeedback = null; }, 4000);
      }
    },

    /* real API calls — fallback to mock on error */
    async loadLeads() {
      try {
        const r = await this.authFetch('/api/leads');
        const j = await r.json();
        if (j.ok && Array.isArray(j.data)) this.leads = j.data;
      } catch (_) {}
    },

    async loadProducts() {
      this.productsLoading = true;
      try {
        const r = await this.authFetch('/api/products');
        const j = await r.json();
        if (j.ok && Array.isArray(j.data)) this.products = j.data;
      } catch (_) {}
      finally { this.productsLoading = false; }
    },

    async loadSessions() {
      try {
        const r = await this.authFetch('/api/sessions');
        const j = await r.json();
        if (j.ok && Array.isArray(j.data)) {
          this.sessions = j.data;
          this.conversations = j.data.slice(0, 10).map(s => ({
            id: s.id,
            name: s.nome || s.phone,
            phone: s.phone,
            msg: `Nó atual: ${s.current_node}`,
            time: this.fmtTime(s.atualizado_em),
            unread: 0,
            tag: 'novo',
            node: s.current_node,
            avatar: (s.nome || s.phone).charAt(0).toUpperCase(),
          }));
        }
      } catch (_) {}
    },

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
          this.simMessages.push({ from: 'bot', text: j.error || 'Erro ao processar.', time: this.timeNow(), intent: null, confidence: null });
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
      const el = document.getElementById('sim-messages');
      if (el) el.scrollTop = el.scrollHeight;
      const el2 = document.getElementById('atend-messages');
      if (el2) el2.scrollTop = el2.scrollHeight;
    },

    /* charts */
    initCharts() {
      const d = MOCK.chartData;
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
      if (c1 && !c1._chart) {
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
      if (c2 && !c2._chart) {
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
    },

    /* helpers */
    timeNow() {
      return new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    },

    fmtTime(iso) {
      if (!iso) return '';
      const d = new Date(iso);
      const now = new Date();
      if (d.toDateString() === now.toDateString()) {
        return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      }
      return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    },

    fmtBRL(v) {
      return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v) || 0);
    },

    tagColor(tag) {
      const map = { quente: 'badge-red', morno: 'badge-gold', frio: 'badge-gray', novo: 'badge-blue', aguardando: 'badge-gold', pedido: 'badge-green', finalizado: 'badge-gray' };
      return map[tag] || 'badge-gray';
    },

    statusColor(s) {
      const map = { QUENTE: 'badge-red', MORNO: 'badge-gold', FRIO: 'badge-gray' };
      return map[s] || 'badge-gray';
    },
  };
}
