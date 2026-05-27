/* ═══════════════════════════════════════════════════
   FLUXO COMMAND — App Logic + Mock Data
   ═══════════════════════════════════════════════════ */

const MOCK = {
  kanban: [
    { id: 'novo',        label: 'Novo Lead',        color: '#38BDF8', items: [] },
    { id: 'interessado', label: 'Interessado',       color: '#A855F7', items: [] },
    { id: 'escolhendo',  label: 'Escolhendo',        color: '#FACC15', items: [] },
    { id: 'carrinho',    label: 'Carrinho Montado',  color: '#F97316', items: [] },
    { id: 'pagamento',   label: 'Aguardando Pgto.',  color: '#22C55E', items: [] },
    { id: 'finalizado',  label: 'Finalizado',        color: '#6B7280', items: [] },
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
    _sb:           null,   // Supabase client instance
    _authToken:    null,   // JWT do usuário logado
    authUser:      null,   // objeto user do Supabase
    authLoading:   true,   // true enquanto verifica sessão
    loginEmail:    '',
    loginPassword: '',
    loginError:    '',
    loginLoading:  false,

    /* store status */
    storeBlocked: false,   // true se status != active/trial
    storeStatus:  null,    // valor atual de stores.status

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
    simPhone: '',
    simInput: '',
    simMessages: [],
    simLoading: false,
    simStarted: false,

    /* produtos */
    productSearch: '',
    productCategory: '',
    productsLoading: false,
    productModal: false,
    productEditId: null,
    productForm: { name:'', sku:'', price:'', promotional_price:'', category:'', subcategory:'', product_type:'', color:'', stock:0, image_url:'', featured:false, is_active:true },
    productSaving: false,
    productFeedback: null,
    productFeedbackMsg: '',

    /* crm */
    crmSearch: '',
    crmFilter: '',
    crmLead: null,
    crmMessages: [],
    crmSaving: false,
    crmFeedback: null,
    crmFeedbackMsg: '',

    /* kanban */
    kanban: [
      { id: 'novo',        label: 'Novo Lead',        color: '#38BDF8', items: [] },
      { id: 'interessado', label: 'Interessado',       color: '#A855F7', items: [] },
      { id: 'escolhendo',  label: 'Escolhendo',        color: '#FACC15', items: [] },
      { id: 'carrinho',    label: 'Carrinho Montado',  color: '#F97316', items: [] },
      { id: 'pagamento',   label: 'Aguardando Pgto.',  color: '#22C55E', items: [] },
      { id: 'finalizado',  label: 'Finalizado',        color: '#6B7280', items: [] },
    ],
    kanbanDragId: null,
    kanbanDragStage: null,
    kanbanDragOver: null,

    /* reports */
    reports: null,
    reportsLoading: false,

    /* atendimentos */
    atendMessages: [],
    atendPhone: null,
    atendReply: '',
    atendSending: false,
    atendLead: null,
    atendHumano: false,

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
    get currentConvMessages() { return this.atendMessages; },

    get currentConv() {
      return this.conversations.find(c => c.id === this.selectedConv) || this.conversations[0];
    },

    get crmFilteredLeads() {
      let list = this.leads;
      const q = this.crmSearch.trim().toLowerCase();
      if (q) list = list.filter(l => (l.nome||'').toLowerCase().includes(q) || (l.phone||'').includes(q) || (l.interesse||'').toLowerCase().includes(q));
      if (this.crmFilter) list = list.filter(l => l.status_comercial === this.crmFilter);
      return list;
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

    /* navigation */
    navigate(p) {
      this.page = p;
      this.sidebarOpen = false;
      window.location.hash = p;
      if (p === 'relatorios') this.$nextTick(() => this.loadReports());
      if (p === 'kanban')     this.loadKanban();
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
      const blocked = await this._checkStoreStatus();
      if (blocked) return;
      await Promise.allSettled([
        this.loadLeads(),
        this.loadSessions(),
        this.loadProducts(),
        this.loadSettings(),
      ]);
      if (this.page === 'kanban')     this.loadKanban();
      if (this.page === 'relatorios') this.loadReports();
    },

    async _checkStoreStatus() {
      try {
        const r = await this.authFetch('/api/store');
        const j = await r.json();
        if (j.ok && j.data) {
          this.storeStatus = j.data.status;
          this.storeBlocked = j.data.status !== 'active' && j.data.status !== 'trial';
        }
      } catch (_) { /* mantém desbloqueado em caso de erro de rede */ }
      return this.storeBlocked;
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

    /* ── Produtos CRUD ──────────────────────────────────────────────────── */
    openProductModal(product) {
      if (product) {
        this.productEditId = product.id;
        this.productForm = {
          name:              product.name || '',
          sku:               product.sku || '',
          price:             product.price || '',
          promotional_price: product.promotional_price || '',
          category:          product.category || '',
          subcategory:       product.subcategory || '',
          product_type:      product.product_type || '',
          color:             product.color || '',
          stock:             product.stock || 0,
          image_url:         product.image_url || product.image || '',
          featured:          product.featured || false,
          is_active:         product.is_active !== false,
        };
      } else {
        this.productEditId = null;
        this.productForm = { name:'', sku:'', price:'', promotional_price:'', category:'', subcategory:'', product_type:'', color:'', stock:0, image_url:'', featured:false, is_active:true };
      }
      this.productModal = true;
    },

    async saveProduct() {
      if (this.productSaving) return;
      this.productSaving = true;
      this.productFeedback = null;
      try {
        const body = {
          ...this.productForm,
          price:             Number(this.productForm.price) || 0,
          promotional_price: this.productForm.promotional_price ? Number(this.productForm.promotional_price) : null,
          stock:             Number(this.productForm.stock) || 0,
        };
        const url    = this.productEditId ? `/api/products/${this.productEditId}` : '/api/products';
        const method = this.productEditId ? 'PUT' : 'POST';
        const r = await this.authFetch(url, { method, body: JSON.stringify(body) });
        const j = await r.json();
        if (j.ok) {
          await this.loadProducts();
          this.productModal = false;
          this.productFeedback = 'ok';
          this.productFeedbackMsg = this.productEditId ? 'Produto atualizado!' : 'Produto criado!';
        } else {
          this.productFeedback = 'erro';
          this.productFeedbackMsg = j.error || 'Erro ao salvar.';
        }
      } catch (_) {
        this.productFeedback = 'erro';
        this.productFeedbackMsg = 'Erro de conexão.';
      } finally {
        this.productSaving = false;
        setTimeout(() => { this.productFeedback = null; }, 3500);
      }
    },

    async deleteProduct(id) {
      if (!confirm('Excluir este produto?')) return;
      const r = await this.authFetch(`/api/products/${id}`, { method: 'DELETE' });
      const j = await r.json();
      if (j.ok) await this.loadProducts();
    },

    /* ── CRM ─────────────────────────────────────────────────────────── */
    async selectCrmLead(lead) {
      this.crmLead     = { ...lead };
      this.crmMessages = [];
      try {
        const r = await this.authFetch(`/api/leads/${lead.id}`);
        const j = await r.json();
        if (j.ok && j.data) {
          this.crmLead     = { ...j.data };
          this.crmMessages = (j.data.messages || []).map(m => ({
            from: m.direcao === 'saida' ? 'bot' : 'user',
            text: m.conteudo,
            time: this.fmtTime(m.criado_em),
          }));
        }
      } catch (_) {}
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
          this.crmFeedbackMsg = j.error || 'Erro ao salvar.';
        }
      } catch (_) {
        this.crmFeedback = 'erro';
        this.crmFeedbackMsg = 'Erro de conexão.';
      } finally {
        this.crmSaving = false;
        setTimeout(() => { this.crmFeedback = null; }, 3000);
      }
    },

    crmWhatsApp(phone) {
      const n = (phone || '').replace(/\D/g, '');
      return `https://wa.me/${n}`;
    },

    /* ── Kanban ──────────────────────────────────────────────────────── */
    async loadKanban() {
      try {
        const r = await this.authFetch('/api/leads');
        const j = await r.json();
        if (!j.ok) return;
        const cols = [
          { id: 'novo',        label: 'Novo Lead',        color: '#38BDF8', items: [] },
          { id: 'interessado', label: 'Interessado',       color: '#A855F7', items: [] },
          { id: 'escolhendo',  label: 'Escolhendo',        color: '#FACC15', items: [] },
          { id: 'carrinho',    label: 'Carrinho Montado',  color: '#F97316', items: [] },
          { id: 'pagamento',   label: 'Aguardando Pgto.',  color: '#22C55E', items: [] },
          { id: 'finalizado',  label: 'Finalizado',        color: '#6B7280', items: [] },
        ];
        for (const lead of j.data) {
          const stage = lead.kanban_stage || 'novo';
          const col   = cols.find(c => c.id === stage) || cols[0];
          col.items.push({ id: lead.id, name: lead.nome || lead.phone, phone: lead.phone, interesse: lead.interesse || '—', val: this.fmtBRL(lead.valor_potencial), status: lead.status_comercial });
        }
        this.kanban = cols;
      } catch (_) {}
    },

    kanbanDragStart(id, stage) {
      this.kanbanDragId    = id;
      this.kanbanDragStage = stage;
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
      tgt.items.push(item);
      this.kanbanDragId = null;
      this.kanbanDragStage = null;
      await this.authFetch(`/api/leads/${id}/stage`, { method: 'PATCH', body: JSON.stringify({ stage: targetStage }) });
    },

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

    /* ── Atendimentos ────────────────────────────────────────────────── */
    async selectConv(conv) {
      this.selectedConv  = conv.id;
      this.atendPhone    = conv.phone;
      this.atendMessages = [];
      this.atendHumano   = conv.humano_ativo || false;
      this.atendLead     = this.leads.find(l => l.phone === conv.phone) || null;
      try {
        const r = await this.authFetch('/api/messages/' + conv.phone);
        const j = await r.json();
        if (j.ok && Array.isArray(j.data)) {
          this.atendMessages = j.data.map(m => ({
            from: m.direcao === 'saida' ? 'bot' : 'user',
            text: m.conteudo,
            time: this.fmtTime(m.criado_em),
          }));
          this.$nextTick(() => this.scrollChat());
        }
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
      try {
        const r = await this.authFetch(`/api/sessions/${this.atendPhone}/message`, {
          method: 'POST',
          body: JSON.stringify({ text: sent }),
        });
        const j = await r.json();
        if (j.ok) {
          this.atendMessages.push({ from: 'bot', text: sent, time: this.timeNow() });
          this.$nextTick(() => this.scrollChat());
        }
      } catch (_) {}
      finally { this.atendSending = false; }
    },

    atendKeydown(e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.sendAtendReply(); }
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
