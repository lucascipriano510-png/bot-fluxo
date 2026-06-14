/* ═══════════════════════════════════════════════════
   FLUXO COMMAND — App Logic + Mock Data
   ═══════════════════════════════════════════════════ */

/* ─────────────────────────────────────────────────────
   Funil comercial — estágios canônicos do pipeline.
   O estágio é DERIVADO de sinais reais do lead (compra, calor, score,
   engajamento). O arraste manual no Kanban grava um override que prevalece.
───────────────────────────────────────────────────── */
const STAGES = [
  { id: 'novo',        label: 'Novo',        emoji: '🆕', color: '#38BDF8', desc: 'Chegou agora, sem engajamento' },
  { id: 'interessado', label: 'Interessado', emoji: '👀', color: '#A855F7', desc: 'Engajou / demonstrou interesse' },
  { id: 'negociando',  label: 'Negociando',  emoji: '🔥', color: '#F97316', desc: 'Quente, perto de fechar' },
  { id: 'comprou',     label: 'Comprou',     emoji: '✅', color: '#22C55E', desc: 'Cliente — já comprou' },
  { id: 'perdido',     label: 'Perdido',     emoji: '✖️', color: '#6B7280', desc: 'Sem interesse / não respondeu' },
];
// Mapeia estágios antigos (modelo de e-commerce) para o novo funil.
const LEGACY_STAGE = { escolhendo: 'interessado', carrinho: 'negociando', pagamento: 'negociando', finalizado: 'comprou' };

/* ─────────────────────────────────────────────────────
   FluxoCommand — Alpine.js app factory
───────────────────────────────────────────────────── */
function FluxoCommand() {
  const base = {
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
    crmTimeline: [],
    crmPurchases: [],
    crmHistoryTab: 'timeline',

    /* kanban */
    crmStageFilter: '',
    kanban: STAGES.map(s => ({ ...s, items: [], total: 0 })),
    kanbanDragId: null,
    kanbanDragStage: null,
    kanbanDragOver: null,
    pipelineTotal: 0,
    pipelineCount: 0,
    pipelineConversion: 0,

    /* reports */
    reports: null,
    reportsLoading: false,

    /* integracoes — inteligência da loja */
    knowledge:       null,
    knowledgeLoading: false,
    siteScanLoading:  false,
    siteScanSummary:  '',
    siteScanError:    '',

    /* integracoes — canais */
    channels: [],
    channelsLoading: false,

    /* integracoes — ia generativa */
    aiConfig: { configured: false, provider: 'gemini', model: 'gemini-2.5-flash', testing: false, feedback: null, feedbackMsg: '' },

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

    /* whatsapp direto */
    waBaseUrl:         '',
    waStatus:          'disconnected',
    waQr:              null,
    waConversations:   [],
    waSelectedPhone:   null,
    waMessages:        [],
    waInput:           '',
    waGroupsOpen:        false,
    waSending:           false,
    waPollingInterval:   null,
    waReconnectModal:    false,
    waReconnectPoller:   null,
    waStatusPoller:      null,
    waSearch:          '',
    inboxSearch:       '',
    inboxFilter:       'todos',
    fichaOpen:         true,
    _crmSaveTimers:    {},

    /* novo lead manual */
    newLeadModal:   false,
    newLead:        { phone: '', nome: '', interesse: '', status_comercial: 'FRIO', kanban_stage: 'novo', valor_potencial: '', cidade: '' },
    newLeadSaving:  false,
    newLeadError:   null,
    addingToCrm:      false,
    addToCrmError:    null,
    waCurrentLoading: false,

    /* inteligência AI */
    aiAnalyzing:    false,
    aiAnalyzingAll: false,
    aiStatus:       null,

    /* atendimentos */
    atendMessages: [],
    atendPhone: null,
    atendReply: '',
    atendSending: false,
    atendLead: null,
    atendHumano: false,
    atendLoading: false,
    viewedConvs: new Set(),
    _inboxPoller: null,

    /* follow-up */
    followupToday: [],

    /* brain / análise */
    brain: null,
    analysisRunning: false,
    analysisFeedback: null,
    analysisFeedbackMsg: '',

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

    get waPrivateConvs() {
      const q = this.waSearch.trim().toLowerCase();
      return this.waConversations.filter(c =>
        !c.is_group && (!q || (c.name || '').toLowerCase().includes(q) || (c.phone || '').includes(q))
      );
    },

    get waGroupConvs() {
      const q = this.waSearch.trim().toLowerCase();
      return this.waConversations.filter(c =>
        c.is_group && (!q || (c.name || '').toLowerCase().includes(q) || (c.phone || '').includes(q))
      );
    },

    get waCrmInfo() {
      if (!this.waSelectedPhone) return null;
      const norm = this.normalizePhone(this.waSelectedPhone);
      return this.leads.find(l => this.normalizePhone(l.phone) === norm) || null;
    },

    get inboxConversations() {
      const merged = new Map();
      for (const c of this.conversations) {
        merged.set(c.phone, { ...c, last_time: c.atualizado_em });
      }
      for (const w of this.waConversations) {
        const ex = merged.get(w.phone);
        if (ex) {
          merged.set(w.phone, {
            ...ex,
            name: w.name || ex.name,
            msg: w.last_message || ex.msg,
            last_time: w.last_time || ex.atualizado_em,
            unread: Math.max(w.unread_count || 0, ex.unread || 0),
            is_group: w.is_group || false,
          });
        } else {
          const n = w.name || w.phone;
          merged.set(w.phone, {
            id: w.id, phone: w.phone, name: n,
            avatar: n.charAt(0).toUpperCase(),
            msg: w.last_message || '—',
            last_time: w.last_time,
            unread: w.unread_count || 0,
            is_group: w.is_group || false,
            humano_ativo: false, tag: 'novo', node: 'INICIO', context: {},
          });
        }
      }
      let result = [...merged.values()];
      // Filtrar grupos: is_group, phone com @, JIDs de grupo (16+ dígitos)
      result = result.filter(c =>
        !c.is_group &&
        !(c.phone || '').includes('@') &&
        !/^\d{16,}$/.test(c.phone || '')
      );
      const q = this.inboxSearch.trim().toLowerCase();
      if (q) result = result.filter(c =>
        (c.name || '').toLowerCase().includes(q) || (c.phone || '').includes(q) || (this.realPhone(c.phone) || '').includes(q)
      );
      if (this.inboxFilter === 'nao_lidos') result = result.filter(c => (c.unread || 0) > 0);
      if (this.inboxFilter === 'bot')       result = result.filter(c => !c.humano_ativo);
      if (this.inboxFilter === 'humano')    result = result.filter(c => c.humano_ativo);
      return result.sort((a, b) => {
        const ta = a.last_time ? new Date(a.last_time).getTime() : 0;
        const tb = b.last_time ? new Date(b.last_time).getTime() : 0;
        return tb - ta;
      });
    },

    get leadByPhone() {
      const m = {};
      for (const l of this.leads) if (l.phone) m[l.phone] = l;
      return m;
    },

    get atendMessagesWithDates() {
      const msgs = this.atendMessages;
      if (!msgs.length) return msgs;
      const result = [];
      let lastDate = null;
      for (const m of msgs) {
        const d = m.ts ? new Date(m.ts) : null;
        if (d) {
          const dk = d.toDateString();
          if (dk !== lastDate) {
            lastDate = dk;
            result.push({ _sep: true, label: this.fmtDateSep(d) });
          }
        }
        result.push(m);
      }
      return result;
    },

    get waCurrentConv() {
      if (!this.waSelectedPhone) return null;
      const norm = this.normalizePhone(this.waSelectedPhone);
      return this.waConversations.find(c => this.normalizePhone(c.phone) === norm) || null;
    },

    get currentConv() {
      if (!this.atendPhone) return this.conversations[0] || null;
      const norm = this.normalizePhone(this.atendPhone);
      return this.waConversations.find(c => this.normalizePhone(c.phone) === norm)
        || this.conversations.find(c => this.normalizePhone(c.phone) === norm)
        || this.conversations.find(c => String(c.id) === this.selectedConv)
        || null;
    },

    get crmFilteredLeads() {
      let list = this.leads;
      const q = this.crmSearch.trim().toLowerCase();
      if (q) list = list.filter(l => (l.nome||'').toLowerCase().includes(q) || (l.phone||'').includes(q) || (l.phone_real||'').includes(q) || (l.interesse||'').toLowerCase().includes(q));
      if (this.crmFilter) list = list.filter(l => (l.ai_temperatura?.toUpperCase() ?? l.status_comercial) === this.crmFilter);
      if (this.crmStageFilter) list = list.filter(l => this.stageOf(l) === this.crmStageFilter);
      return list;
    },

    // Estágios do funil expostos aos templates.
    get stages() { return STAGES; },

    // Contagem de leads por estágio (para os chips de filtro rápido).
    get stageCounts() {
      const c = { novo: 0, interessado: 0, negociando: 0, comprou: 0, perdido: 0 };
      for (const l of this.leads) { const s = this.stageOf(l); if (c[s] != null) c[s]++; }
      return c;
    },

    // Estágio efetivo do lead: respeita override manual REAL; senão, deriva dos sinais.
    // O override real é marcado por kanban_movido_manualmente_em (o flag
    // kanban_movido_por='manual' aparece falso/legado em toda a base).
    stageOf(lead) {
      if (lead.kanban_movido_manualmente_em && lead.kanban_stage) {
        return LEGACY_STAGE[lead.kanban_stage] || lead.kanban_stage;
      }
      return this.deriveStage(lead);
    },

    // Classificação determinística por sinais reais (compra > calor > engajamento).
    deriveStage(lead) {
      if (lead.status === 'concluido' || (lead.total_purchases || 0) > 0) return 'comprou';
      if (lead.status === 'perdido' || (lead.status_comercial || '').toUpperCase() === 'PERDIDO' || lead.kanban_stage === 'perdido') return 'perdido';
      const temp  = (lead.ai_temperatura || lead.status_comercial || '').toUpperCase();
      const score = lead.ai_score != null ? lead.ai_score : (lead.conversion_score || 0);
      if (temp === 'QUENTE' || score >= 70) return 'negociando';
      if (temp === 'MORNO'  || score >= 35 || (lead.message_count || 0) > 2) return 'interessado';
      return 'novo';
    },

    stageMeta(id) { return STAGES.find(s => s.id === id) || STAGES[0]; },

    // botOn e ignorarHorario são aliases para os campos de cfg (única fonte de verdade)
    get botOn()           { return this.cfg.bot_ativo; },
    set botOn(v)          { this.cfg.bot_ativo = v; },
    get ignorarHorario()  { return this.cfg.ignorar_horario; },
    set ignorarHorario(v) { this.cfg.ignorar_horario = v; },

    get waConfigured() { return this.waStatus === 'connected'; },

    get leadsQuentes() { return this.leads.filter(l => (l.ai_temperatura?.toUpperCase() ?? l.status_comercial) === 'QUENTE').length; },
    get leadsMornos()  { return this.leads.filter(l => (l.ai_temperatura?.toUpperCase() ?? l.status_comercial) === 'MORNO').length; },
    get leadsFrios()   { return this.leads.filter(l => (l.ai_temperatura?.toUpperCase() ?? l.status_comercial) === 'FRIO').length; },

    /* KPIs comerciais — faturamento e clientes (vindos das compras ligadas) */
    get totalRevenue()  { return this.leads.reduce((s, l) => s + Number(l.lifetime_value || 0), 0); },
    get totalClientes() { return this.leads.filter(l => (l.total_purchases || 0) > 0).length; },
    get ticketMedio()   { const c = this.totalClientes; return c > 0 ? this.totalRevenue / c : 0; },
    get taxaConversao() { return this.leads.length > 0 ? Math.round((this.totalClientes / this.leads.length) * 100) : 0; },
    // Leads "pra agir agora": quentes/negociando que ainda não compraram.
    get leadsParaAgir() {
      return this.leads
        .filter(l => (l.total_purchases || 0) === 0 && this.stageOf(l) === 'negociando')
        .sort((a, b) => (b.ai_score ?? b.conversion_score ?? 0) - (a.ai_score ?? a.conversion_score ?? 0));
    },

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
      if (this.page === 'whatsapp' && p !== 'whatsapp' && this.waPollingInterval) {
        clearInterval(this.waPollingInterval); this.waPollingInterval = null;
      }
      this.page = p;
      this.sidebarOpen = false;
      window.location.hash = p;
      if (p === 'relatorios')  this.$nextTick(() => this.loadReports());
      if (p === 'kanban')      this.loadKanban();
      if (p === 'leads')       this.loadLeads();
      if (p === 'respostas')   this.loadRespostas();
      if (p === 'integracoes') { this.loadIntegrations(); this.loadAiIntegration(); this.loadChannels(); this.loadKnowledge(); }
      if (p === 'atendimentos') { this.loadSessions(); this.waLoadConversations(); this.loadLeads(); }
      if (p === 'whatsapp')    { this.loadLeads(); this.$nextTick(() => this.waInit()); }
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
      return fetch(url, { credentials: 'include', ...opts, headers });
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
      if (this._inboxPoller) { clearInterval(this._inboxPoller); this._inboxPoller = null; }
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
        // Define waBaseUrl antes de qualquer chamada ao backend
        this.waBaseUrl = cfg.renderUrl || window.location.origin;
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
        this.loadReports(),
        this.loadFollowupToday(),
        this.loadBrain(),
        this.loadKanban(),
      ]);
      if (this.page === 'relatorios')  this.loadReports();
      if (this.page === 'respostas')   this.loadRespostas();
      if (this.page === 'integracoes') this.loadIntegrations();
      if (this._inboxPoller) clearInterval(this._inboxPoller);
      this._inboxPoller = setInterval(async () => {
        if (this.page === 'atendimentos') {
          await this.loadSessions();
          await this.waLoadConversations();
          await this.loadLeads();
          if (this.atendPhone) {
            const snapPhone = this.atendPhone;
            try {
              const msgs = await this._loadAtendMessages(snapPhone);
              if (this.atendPhone !== snapPhone) return; // usuário trocou de conversa durante o fetch
              if (msgs.length >= this.atendMessages.length && msgs.length > 0) {
                this.atendMessages = msgs;
                this.scrollChat();
              }
            } catch (_) {}
          }
        } else if (this.page === 'leads') {
          await this.loadLeads();
        } else if (this.page === 'kanban') {
          await this.loadKanban();
        } else if (this.page === 'dashboard') {
          await this.loadLeads();
          await this.loadFollowupToday();
        }
      }, 12000);
      // Polling global do status WA — independente da página
      if (this.waStatusPoller) clearInterval(this.waStatusPoller);
      this.waStatusPoller = setInterval(() => this.waLoadStatus(), 10000);
      this.waLoadStatus(); // checar imediatamente ao carregar
      // Inicializa conexão WA no boot sem precisar navegar para a página
      this.$nextTick(() => this.waInit());
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

    async loadFollowupToday() {
      try {
        const r = await this.authFetch('/api/recovery/today');
        const j = await r.json();
        if (j.ok && Array.isArray(j.data)) this.followupToday = j.data;
      } catch (_) {}
    },

    async loadBrain() {
      try {
        const r = await this.authFetch('/api/brain');
        const j = await r.json();
        if (j.ok && j.data) this.brain = j.data;
      } catch (_) {}
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

    fmtDateSep(d) {
      const today = new Date(); const yest = new Date(+today - 864e5);
      if (d.toDateString() === today.toDateString()) return 'HOJE';
      if (d.toDateString() === yest.toDateString()) return 'ONTEM';
      return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' });
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

    async scanSite() {
      if (this.siteScanLoading) return;
      this.siteScanLoading = true;
      this.siteScanSummary = '';
      this.siteScanError   = '';
      try {
        const r = await this.authFetch('/api/knowledge/site/scan', { method: 'POST' });
        const j = await r.json();
        if (j.ok && j.result) {
          const res = j.result;
          const parts = [];
          if (res.title)           parts.push(`Título: ${res.title}`);
          if (res.metaDescription) parts.push(`Descrição: ${res.metaDescription}`);
          if (res.headings?.length) parts.push(`Seções encontradas: ${res.headings.slice(0,5).join(', ')}`);
          if (res.internalLinks?.length) parts.push(`Links internos: ${res.internalLinks.length}`);
          this.siteScanSummary = parts.join(' · ') || 'Site analisado com sucesso.';
          await this.loadKnowledge();
        } else {
          this.siteScanError = j.error || 'Erro ao analisar site.';
        }
      } catch (_) {
        this.siteScanError = 'Erro de conexão ao analisar site.';
      } finally {
        this.siteScanLoading = false;
      }
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
          this.aiConfig.model      = j.model       || 'gemini-2.5-flash';
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

  // Mescla os módulos de feature (js/*.js) preservando getters/setters.
  (window.FluxoModules || []).forEach(function (m) {
    Object.defineProperties(base, Object.getOwnPropertyDescriptors(m));
  });
  return base;
}
