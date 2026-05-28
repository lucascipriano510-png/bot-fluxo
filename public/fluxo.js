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
    selectedConv: null,
    modoTeste: false,

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
    productForm: { name:'', sku:'', price:'', promotional_price:'', category:'', subcategory:'', product_type:'', color:'', stock:0, image_url:'', featured:false, is_active:true, item_type:'produto_fisico', description:'', price_type:'fixo', bot_instructions:'', tags:'', duration_minutes:'', requires_scheduling:false, service_location:'', included_items:'', qualification_questions:'' },
    productSaving: false,
    productFeedback: null,
    productFeedbackMsg: '',

    /* ingestão de catálogo */
    ingestOpen: false,
    ingestSource: 'list',
    ingestText: '',
    ingestItems: [],
    ingestParsed: false,
    ingestSaving: false,

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

    /* integracoes — inteligência da loja */
    knowledge: null,
    knowledgeLoading: false,

    /* integracoes — canais */
    channels: [],
    channelsLoading: false,

    /* integracoes — ia generativa */
    aiConfig: { configured: false, provider: 'gemini', model: 'gemini-1.5-flash', testing: false, feedback: null, feedbackMsg: '' },

    /* integracoes — evolution api */
    evoForm: { evolution_url: '', evolution_instance: '', evolution_token: '' },
    evoLoaded:      false,
    evoConfigured:  false,
    evoSaving:      false,
    evoTesting:     false,
    evoFeedback:    null,   // null | 'ok' | 'erro'
    evoFeedbackMsg: '',
    evoShowToken:   false,
    webhookUrl:     '',
    webhookCopied:  false,
    evoSetupNeeded: false,

    /* respostas rapidas */
    respostas:         [],
    respostasLoading:  false,
    respostaSetupNeeded: false,
    respostaModal:     false,
    respostaEditId:    null,
    respostaForm:      { titulo: '', gatilhos: '', resposta: '', ativo: true, prioridade: 0 },
    respostaSaving:    false,
    respostaFeedback:  null,
    respostaFeedbackMsg: '',

    /* atendimentos */
    atendMessages: [],
    atendPhone: null,
    atendReply: '',
    atendSending: false,
    atendLead: null,
    atendHumano: false,

    /* settings */
    cfg: {
      nome_loja:          '',
      whatsapp:           '',
      saudacao:           '',
      horario_inicio:     '09:00',
      horario_fim:        '18:00',
      bot_ativo:          true,
      ignorar_horario:    false,
      fallback_humano:    true,
      delay_resposta:     true,
      // Perfil da loja (Migration 11)
      business_type:      '',
      city:               '',
      state:              '',
      delivery_info:      '',
      payment_info:       '',
      instagram:          '',
      site_url:           '',
      catalog_url:        '',
      sales_tone:         '',
      sales_instructions: '',
      return_policy:      '',
      discount_rules:     '',
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

    get waConfigured() { return this.evoConfigured; },

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

    async autoSaveSettings() {
      try {
        await this.authFetch('/api/settings', {
          method: 'POST',
          body: JSON.stringify({
            nome_loja:          this.cfg.nome_loja,
            whatsapp:           this.cfg.whatsapp,
            saudacao:           this.cfg.saudacao,
            horario_inicio:     this.cfg.horario_inicio,
            horario_fim:        this.cfg.horario_fim,
            bot_ativo:          this.cfg.bot_ativo,
            ignorar_horario:    this.cfg.ignorar_horario,
            fallback_humano:    this.cfg.fallback_humano,
            delay_resposta:     this.cfg.delay_resposta,
            business_type:      this.cfg.business_type      || null,
            city:               this.cfg.city               || null,
            state:              this.cfg.state              || null,
            delivery_info:      this.cfg.delivery_info      || null,
            payment_info:       this.cfg.payment_info       || null,
            instagram:          this.cfg.instagram          || null,
            site_url:           this.cfg.site_url           || null,
            catalog_url:        this.cfg.catalog_url        || null,
            sales_tone:         this.cfg.sales_tone         || null,
            sales_instructions: this.cfg.sales_instructions || null,
            return_policy:      this.cfg.return_policy      || null,
            discount_rules:     this.cfg.discount_rules     || null,
          }),
        });
      } catch (_) {}
    },

    /* navigation */
    navigate(p) {
      this.page = p;
      this.sidebarOpen = false;
      window.location.hash = p;
      if (p === 'relatorios')  this.$nextTick(() => this.loadReports());
      if (p === 'kanban')      this.loadKanban();
      if (p === 'respostas')   this.loadRespostas();
      if (p === 'integracoes') { this.loadIntegrations(); this.loadAiIntegration(); this.loadChannels(); this.loadKnowledge(); }
    },

    /* ── Helpers ──────────────────────────────────────────────────────────── */
    // Extrai mensagem legível de qualquer tipo de erro retornado pela API
    apiErr(e) {
      if (!e) return 'Erro desconhecido';
      if (typeof e === 'string') return e;
      if (typeof e === 'object') return e.message || e.details || e.hint || JSON.stringify(e);
      return String(e);
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
      if (this.page === 'kanban')      this.loadKanban();
      if (this.page === 'relatorios')  this.loadReports();
      if (this.page === 'respostas')   this.loadRespostas();
      if (this.page === 'integracoes') this.loadIntegrations();
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
          this.cfg.nome_loja          = d.nome_loja          ?? this.cfg.nome_loja;
          this.cfg.whatsapp           = d.whatsapp           ?? this.cfg.whatsapp;
          this.cfg.saudacao           = d.saudacao           ?? this.cfg.saudacao;
          this.cfg.horario_inicio     = d.horario_inicio     ?? this.cfg.horario_inicio;
          this.cfg.horario_fim        = d.horario_fim        ?? this.cfg.horario_fim;
          this.cfg.bot_ativo          = d.bot_ativo          ?? this.cfg.bot_ativo;
          this.cfg.ignorar_horario    = d.ignorar_horario    ?? this.cfg.ignorar_horario;
          this.cfg.fallback_humano    = d.fallback_humano    ?? this.cfg.fallback_humano;
          this.cfg.delay_resposta     = d.delay_resposta     ?? this.cfg.delay_resposta;
          this.cfg.business_type      = d.business_type      ?? this.cfg.business_type;
          this.cfg.city               = d.city               ?? this.cfg.city;
          this.cfg.state              = d.state              ?? this.cfg.state;
          this.cfg.delivery_info      = d.delivery_info      ?? this.cfg.delivery_info;
          this.cfg.payment_info       = d.payment_info       ?? this.cfg.payment_info;
          this.cfg.instagram          = d.instagram          ?? this.cfg.instagram;
          this.cfg.site_url           = d.site_url           ?? this.cfg.site_url;
          this.cfg.catalog_url        = d.catalog_url        ?? this.cfg.catalog_url;
          this.cfg.sales_tone         = d.sales_tone         ?? this.cfg.sales_tone;
          this.cfg.sales_instructions = d.sales_instructions ?? this.cfg.sales_instructions;
          this.cfg.return_policy      = d.return_policy      ?? this.cfg.return_policy;
          this.cfg.discount_rules     = d.discount_rules     ?? this.cfg.discount_rules;
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
            nome_loja:          this.cfg.nome_loja,
            whatsapp:           this.cfg.whatsapp,
            saudacao:           this.cfg.saudacao,
            horario_inicio:     this.cfg.horario_inicio,
            horario_fim:        this.cfg.horario_fim,
            bot_ativo:          this.cfg.bot_ativo,
            ignorar_horario:    this.cfg.ignorar_horario,
            fallback_humano:    this.cfg.fallback_humano,
            delay_resposta:     this.cfg.delay_resposta,
            business_type:      this.cfg.business_type      || null,
            city:               this.cfg.city               || null,
            state:              this.cfg.state              || null,
            delivery_info:      this.cfg.delivery_info      || null,
            payment_info:       this.cfg.payment_info       || null,
            instagram:          this.cfg.instagram          || null,
            site_url:           this.cfg.site_url           || null,
            catalog_url:        this.cfg.catalog_url        || null,
            sales_tone:         this.cfg.sales_tone         || null,
            sales_instructions: this.cfg.sales_instructions || null,
            return_policy:      this.cfg.return_policy      || null,
            discount_rules:     this.cfg.discount_rules     || null,
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
            : this.apiErr(j.error);
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
          name:                   product.name || '',
          sku:                    product.sku || '',
          price:                  product.price || '',
          promotional_price:      product.promotional_price || '',
          category:               product.category || '',
          subcategory:            product.subcategory || '',
          product_type:           product.product_type || '',
          color:                  product.color || '',
          stock:                  product.stock || 0,
          image_url:              product.image_url || product.image || '',
          featured:               product.featured || false,
          is_active:              product.is_active !== false,
          item_type:              product.item_type || 'produto_fisico',
          description:            product.description || '',
          price_type:             product.price_type || 'fixo',
          bot_instructions:       product.bot_instructions || '',
          tags:                   Array.isArray(product.tags) ? product.tags.join(', ') : (product.tags || ''),
          duration_minutes:       product.duration_minutes || '',
          requires_scheduling:    product.requires_scheduling || false,
          service_location:       product.service_location || '',
          included_items:         product.included_items || '',
          qualification_questions: product.qualification_questions ? JSON.stringify(product.qualification_questions, null, 2) : '',
        };
      } else {
        this.productEditId = null;
        this.productForm = { name:'', sku:'', price:'', promotional_price:'', category:'', subcategory:'', product_type:'', color:'', stock:0, image_url:'', featured:false, is_active:true, item_type:'produto_fisico', description:'', price_type:'fixo', bot_instructions:'', tags:'', duration_minutes:'', requires_scheduling:false, service_location:'', included_items:'', qualification_questions:'' };
      }
      this.productModal = true;
    },

    async saveProduct() {
      if (this.productSaving) return;
      this.productSaving = true;
      this.productFeedback = null;
      try {
        const isPhysical = this.productForm.item_type === 'produto_fisico';
        const tagsRaw = this.productForm.tags || '';
        const tagsArr = tagsRaw.trim() ? tagsRaw.split(',').map(t => t.trim()).filter(t => t.length > 0) : null;
        let qualQuestions = null;
        if (this.productForm.qualification_questions?.trim()) {
          try { qualQuestions = JSON.parse(this.productForm.qualification_questions); } catch (_) { qualQuestions = this.productForm.qualification_questions; }
        }
        const body = {
          ...this.productForm,
          price:                   this.productForm.price_type === 'sob_consulta' ? null : (Number(this.productForm.price) || 0),
          promotional_price:       this.productForm.promotional_price ? Number(this.productForm.promotional_price) : null,
          stock:                   isPhysical ? (Number(this.productForm.stock) || 0) : null,
          tags:                    tagsArr,
          qualification_questions: qualQuestions,
          duration_minutes:        this.productForm.duration_minutes ? Number(this.productForm.duration_minutes) : null,
        };
        const url    = this.productEditId ? `/api/products/${this.productEditId}` : '/api/products';
        const method = this.productEditId ? 'PUT' : 'POST';
        const r = await this.authFetch(url, { method, body: JSON.stringify(body) });
        const j = await r.json();
        if (j.ok) {
          await this.loadProducts();
          this.productModal = false;
          this.productFeedback = 'ok';
          this.productFeedbackMsg = this.productEditId ? 'Item atualizado!' : 'Item criado!';
        } else {
          this.productFeedback = 'erro';
          this.productFeedbackMsg = this.apiErr(j.error);
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

    /* ── Motor de Catálogo — Ingestão e Normalização ────────────────── */
    parseIngestText() {
      const raw = this.ingestText;
      // Detectar se parece CSV (primeira linha tem separador)
      const firstLine = raw.split('\n')[0] || '';
      const sep = firstLine.includes(';') ? ';' : firstLine.includes(',') && !firstLine.includes(' - ') ? ',' : null;

      const lines = raw.split('\n').map(l => l.trim()).filter(l => l.length > 0);

      // Pular linha de cabeçalho de CSV
      const startIdx = (sep && /^(nome|name|produto|item|descri)/i.test(lines[0])) ? 1 : 0;

      this.ingestItems = lines.slice(startIdx).map(line => {
        let parsedLine = line;

        // Extrair campos de CSV se houver separador
        if (sep) {
          const cols = line.split(sep).map(c => c.trim());
          parsedLine = cols[0] + (cols[1] ? ` - R$${cols[1]}` : '');
        }

        // Detectar preço
        const priceMatch = parsedLine.match(/R?\$\s*(\d+(?:[.,]\d{1,2})?)/i);
        const price = priceMatch ? parseFloat(priceMatch[1].replace(',', '.')) : null;

        // Extrair nome removendo trecho de preço e palavras-chave de tipo
        let name = parsedLine
          .replace(/\s*[-–]\s*R?\$\s*\d+(?:[.,]\d{1,2})?/gi, '')
          .replace(/R?\$\s*\d+(?:[.,]\d{1,2})?/gi, '')
          .replace(/\s*[-–]\s*(orçamento|orcamento|a combinar|sob consulta).*/gi, '')
          .trim();
        if (!name) name = line;

        // Normalizar para detecção (sem acento, minúsculo)
        const norm     = name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
        const lineNorm = parsedLine.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

        // Detectar tipo por palavras-chave
        let type = 'produto_fisico', typeLabel = 'Produto físico';

        if (/orcamento|sob medida|personalizado|a combinar|sob consulta/.test(lineNorm)) {
          type = 'orcamento'; typeLabel = 'Orçamento';
        } else if (/[+]|pacote|combo|plano|inclui|completo|kit/.test(norm)) {
          type = 'pacote_combo'; typeLabel = 'Oferta composta';
        } else if (/corte|lavagem|consulta|sessao|instalacao|manicure|pedicure|depilacao|massagem|limpeza|reparo|manutencao|avaliacao|atendimento|pintura|entrega|montagem|servico|tratamento|aula|treino|projeto/.test(norm)) {
          type = 'servico'; typeLabel = 'Serviço';
        }

        // Sinal mínimo de contexto: ≥ 5 chars OU contém espaço
        const hasMeaningfulName = name.length >= 5 || name.includes(' ');

        // Status e motivo de revisão
        let status = 'pronto', reviewReason = '';
        if (name.length < 3) {
          status = 'revisar'; reviewReason = 'Nome muito curto';
        } else if (!hasMeaningfulName) {
          status = 'revisar'; reviewReason = 'Nome curto ou item sem contexto';
        } else if (!price && type === 'produto_fisico') {
          status = 'revisar'; reviewReason = 'Produto físico sem preço detectado';
        }

        return {
          raw: line, name, type, typeLabel, price,
          composition: type === 'pacote_combo' ? name : null,
          status, reviewReason,
          selected: status === 'pronto',
          savedOk: false,
          savedError: '',
        };
      });

      this.ingestParsed = true;
    },

    loadIngestFile(event) {
      const file = event.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        this.ingestText = e.target.result || '';
        this.ingestSource = 'list';
        if (this.ingestText.trim()) this.parseIngestText();
      };
      reader.readAsText(file, 'UTF-8');
      event.target.value = '';
    },

    openProductFromIngest(item) {
      this.productEditId = null;
      this.productForm = {
        name:                    item.name,
        sku:                     '',
        price:                   item.price || '',
        promotional_price:       '',
        category:                '',
        subcategory:             '',
        product_type:            '',
        color:                   '',
        stock:                   0,
        image_url:               '',
        featured:                false,
        is_active:               true,
        item_type:               item.type,
        description:             '',
        price_type:              item.price ? 'fixo' : (item.type === 'orcamento' ? 'sob_consulta' : 'fixo'),
        bot_instructions:        '',
        tags:                    '',
        duration_minutes:        '',
        requires_scheduling:     false,
        service_location:        '',
        included_items:          item.composition || '',
        qualification_questions: '',
      };
      this.productModal = true;
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

    /* ── Integrações — IA Generativa ─────────────────────────────────── */
    async loadKnowledge() {
      if (this.knowledgeLoading) return;
      this.knowledgeLoading = true;
      try {
        const r = await this.authFetch('/api/knowledge');
        const j = await r.json();
        if (j.ok) this.knowledge = j.knowledge;
      } catch (_) {}
      finally { this.knowledgeLoading = false; }
    },

    async loadChannels() {
      if (this.channelsLoading) return;
      this.channelsLoading = true;
      try {
        const r = await this.authFetch('/api/channels');
        const j = await r.json();
        if (j.ok && Array.isArray(j.channels)) this.channels = j.channels;
      } catch (_) {}
      finally { this.channelsLoading = false; }
    },

    async loadAiIntegration() {
      try {
        const r = await this.authFetch('/api/integrations/ai');
        const j = await r.json();
        if (j.ok) {
          this.aiConfig.configured = j.configured || false;
          this.aiConfig.provider   = j.provider   || 'gemini';
          this.aiConfig.model      = j.model       || 'gemini-1.5-flash';
        }
      } catch (_) {}
    },

    async testAi() {
      if (this.aiConfig.testing) return;
      this.aiConfig.testing  = true;
      this.aiConfig.feedback = null;
      try {
        const r = await this.authFetch('/api/integrations/ai/test', { method: 'POST' });
        const j = await r.json();
        this.aiConfig.feedback    = j.ok ? 'ok' : 'erro';
        this.aiConfig.feedbackMsg = j.ok
          ? `${j.message || 'IA funcionando!'} Resposta: "${j.reply || ''}"`
          : (j.error || 'Erro ao testar IA.');
      } catch (_) {
        this.aiConfig.feedback    = 'erro';
        this.aiConfig.feedbackMsg = 'Erro de conexão.';
      } finally {
        this.aiConfig.testing = false;
        setTimeout(() => { this.aiConfig.feedback = null; }, 6000);
      }
    },

    /* ── Integrações — Evolution API ─────────────────────────────────── */
    async loadIntegrations() {
      try {
        const [evoRes, urlRes] = await Promise.all([
          this.authFetch('/api/integrations/evolution'),
          this.authFetch('/api/webhook-url'),
        ]);
        const evo = await evoRes.json();
        const wh  = await urlRes.json();
        if (evo.ok && evo.data) {
          this.evoForm.evolution_url      = evo.data.evolution_url      || '';
          this.evoForm.evolution_instance = evo.data.evolution_instance || '';
          this.evoForm.evolution_token    = '';  // nunca pré-preenche — mascarado
          this.evoConfigured = evo.data.configured || false;
          this.evoLoaded     = true;
        }
        if (wh.ok) this.webhookUrl = wh.webhookUrl || '';
      } catch (_) {}
    },

    async saveEvo() {
      if (this.evoSaving) return;
      if (!this.evoForm.evolution_url.trim() || !this.evoForm.evolution_instance.trim() || !this.evoForm.evolution_token.trim()) {
        this.evoFeedback = 'erro';
        this.evoFeedbackMsg = 'Preencha URL, instância e token.';
        setTimeout(() => { this.evoFeedback = null; }, 4000);
        return;
      }
      this.evoSaving = true;
      this.evoFeedback = null;
      try {
        const r = await this.authFetch('/api/integrations/evolution', {
          method: 'POST',
          body: JSON.stringify({
            evolution_url:      this.evoForm.evolution_url.trim(),
            evolution_instance: this.evoForm.evolution_instance.trim(),
            evolution_token:    this.evoForm.evolution_token.trim(),
          }),
        });
        const j = await r.json();
        if (j.ok) {
          this.evoConfigured  = true;
          this.evoFeedback    = 'ok';
          this.evoFeedbackMsg = 'Credenciais salvas com sucesso!';
          this.evoForm.evolution_token = '';  // limpa após salvar
        } else {
          this.evoFeedback    = 'erro';
          this.evoFeedbackMsg = this.apiErr(j.error);
        }
      } catch (_) {
        this.evoFeedback    = 'erro';
        this.evoFeedbackMsg = 'Erro de conexão.';
      } finally {
        this.evoSaving = false;
        setTimeout(() => { this.evoFeedback = null; }, 4000);
      }
    },

    async testEvo() {
      if (this.evoTesting) return;
      this.evoTesting  = true;
      this.evoFeedback = null;
      try {
        const r = await this.authFetch('/api/integrations/evolution/test', { method: 'POST' });
        const j = await r.json();
        this.evoFeedback    = j.ok ? 'ok' : 'erro';
        this.evoFeedbackMsg = j.ok ? (j.message || 'Conexão ok!') : this.apiErr(j.error);
      } catch (_) {
        this.evoFeedback    = 'erro';
        this.evoFeedbackMsg = 'Erro de conexão.';
      } finally {
        this.evoTesting = false;
        setTimeout(() => { this.evoFeedback = null; }, 5000);
      }
    },

    copyWebhook() {
      if (!this.webhookUrl) return;
      navigator.clipboard.writeText(this.webhookUrl).then(() => {
        this.webhookCopied = true;
        setTimeout(() => { this.webhookCopied = false; }, 2000);
      });
    },

    /* ── Respostas Rápidas CRUD ──────────────────────────────────────── */
    async loadRespostas() {
      if (this.respostasLoading) return;
      this.respostasLoading = true;
      try {
        const r = await this.authFetch('/api/respostas');
        const j = await r.json();
        this.respostaSetupNeeded = j.setup_needed === true;
        if (j.ok && Array.isArray(j.data)) this.respostas = j.data;
      } catch (_) {}
      finally { this.respostasLoading = false; }
    },

    openRespostaModal(item) {
      if (item) {
        this.respostaEditId = item.id;
        this.respostaForm = {
          titulo:     item.titulo || '',
          gatilhos:   Array.isArray(item.gatilhos) ? item.gatilhos.join(', ') : (item.gatilhos || ''),
          resposta:   item.resposta || '',
          ativo:      item.ativo !== false,
          prioridade: item.prioridade || 0,
        };
      } else {
        this.respostaEditId = null;
        this.respostaForm   = { titulo: '', gatilhos: '', resposta: '', ativo: true, prioridade: 0 };
      }
      this.respostaModal = true;
    },

    async saveResposta() {
      if (this.respostaSaving) return;
      if (!this.respostaForm.titulo.trim() || !this.respostaForm.resposta.trim()) {
        this.respostaFeedback    = 'erro';
        this.respostaFeedbackMsg = 'Título e resposta são obrigatórios.';
        setTimeout(() => { this.respostaFeedback = null; }, 3000);
        return;
      }
      this.respostaSaving  = true;
      this.respostaFeedback = null;
      try {
        const url    = this.respostaEditId ? `/api/respostas/${this.respostaEditId}` : '/api/respostas';
        const method = this.respostaEditId ? 'PUT' : 'POST';
        const r = await this.authFetch(url, { method, body: JSON.stringify(this.respostaForm) });
        const j = await r.json();
        if (j.setup_needed) {
          this.respostaSetupNeeded = true;
          this.respostaFeedback    = 'erro';
          this.respostaFeedbackMsg = 'Tabela não configurada. Execute BOT_SUPABASE_MIGRATION_10.sql no Supabase.';
        } else if (j.ok) {
          await this.loadRespostas();
          this.respostaModal    = false;
          this.respostaFeedback = 'ok';
          this.respostaFeedbackMsg = this.respostaEditId ? 'Resposta atualizada!' : 'Resposta criada!';
        } else {
          this.respostaFeedback    = 'erro';
          this.respostaFeedbackMsg = this.apiErr(j.error);
        }
      } catch (_) {
        this.respostaFeedback    = 'erro';
        this.respostaFeedbackMsg = 'Erro de conexão.';
      } finally {
        this.respostaSaving = false;
        setTimeout(() => { this.respostaFeedback = null; }, 3500);
      }
    },

    async deleteResposta(id) {
      if (!confirm('Excluir esta resposta?')) return;
      try {
        const r = await this.authFetch(`/api/respostas/${id}`, { method: 'DELETE' });
        const j = await r.json();
        if (j.setup_needed) { this.respostaSetupNeeded = true; return; }
        if (j.ok) await this.loadRespostas();
      } catch (_) {}
    },

    async toggleResposta(item) {
      try {
        const r = await this.authFetch(`/api/respostas/${item.id}`, {
          method: 'PUT',
          body: JSON.stringify({ ativo: !item.ativo }),
        });
        const j = await r.json();
        if (j.ok) {
          const idx = this.respostas.findIndex(r => r.id === item.id);
          if (idx !== -1) this.respostas[idx] = { ...this.respostas[idx], ativo: !item.ativo };
        }
      } catch (_) {}
    },
  };
}
