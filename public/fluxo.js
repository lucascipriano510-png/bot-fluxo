/* ═══════════════════════════════════════════════════
   FLUXO COMMAND — App Logic + Mock Data
   ═══════════════════════════════════════════════════ */

const MOCK = {
  metrics: {
    atendimentos: 27,
    atendDelta: '+18%',
    leads: 14,
    leadDelta: '+6 novos',
    pedidos: 9,
    pedidosVal: 'R$1.840',
    botStatus: 'Online',
    botResp: '2.3s',
  },

  conversations: [
    { id: 1, name: 'Carlos M.', phone: '5534991234567', msg: 'Tem camisa Lacoste G preta?', time: '14:22', unread: 2, tag: 'quente', node: 'CATALOGO', avatar: 'C' },
    { id: 2, name: 'Rafael P.', phone: '5511988765432', msg: 'Qual o prazo de entrega?', time: '13:47', unread: 0, tag: 'aguardando', node: 'SUPORTE', avatar: 'R' },
    { id: 3, name: 'Thiago L.', phone: '5534992345678', msg: 'Tem tênis 42 disponível?', time: '13:12', unread: 1, tag: 'novo', node: 'CATALOGO', avatar: 'T' },
    { id: 4, name: 'Bruno S.', phone: '5534993456789', msg: 'Obrigado! Vou pensar.', time: '11:30', unread: 0, tag: 'morno', node: 'INICIO', avatar: 'B' },
    { id: 5, name: 'Luana F.', phone: '5534994567890', msg: 'Vocês fazem entrega?', time: '10:15', unread: 0, tag: 'frio', node: 'SUPORTE', avatar: 'L' },
  ],

  convMessages: {
    1: [
      { from: 'bot', text: 'Olá! Bem-vindo à Fluxo Outlet 👋\n\nSou o assistente virtual. Como posso te ajudar?\n\n1️⃣ Ver catálogo\n2️⃣ Consultar pedido\n3️⃣ Falar com atendente', time: '14:20' },
      { from: 'user', text: 'Tem camisa Lacoste G preta?', time: '14:21' },
      { from: 'bot', text: 'Tenho algumas opções em *camisa* da *lacoste*. Qual tamanho você usa?\n\n• Camisa Polo Lacoste Preta\n• Camisa Lacoste Live Preta\n🔗 fluxooutlet.com.br/?produto=LAC-001', time: '14:22' },
      { from: 'user', text: 'Legal! Quanto custa?', time: '14:22' },
    ],
  },

  leads: [
    { id: 1, phone: '5534991234567', nome: 'Carlos M.', interesse: 'Camisa Lacoste', status_comercial: 'QUENTE', valor_potencial: 340, status: 'encaminhado', atualizado_em: '2024-01-15T14:22:00Z' },
    { id: 2, phone: '5534993456789', nome: 'Thiago L.', interesse: 'Tênis Running', status_comercial: 'MORNO', valor_potencial: 299, status: 'qualificado', atualizado_em: '2024-01-15T13:12:00Z' },
    { id: 3, phone: '5511988765432', nome: 'Rafael P.', interesse: 'Bermuda Jeans', status_comercial: 'FRIO', valor_potencial: 189, status: 'novo', atualizado_em: '2024-01-15T11:30:00Z' },
    { id: 4, phone: '5534994567890', nome: 'Bruno S.', interesse: 'Kit Polo', status_comercial: 'MORNO', valor_potencial: 450, status: 'qualificado', atualizado_em: '2024-01-14T16:45:00Z' },
  ],

  products: [
    { id: 1, name: 'Camisa Polo Lacoste Preta', category: 'CAMISA', subcategory: 'Lacoste', price: 189.90, stock: 12, image: '', featured: true },
    { id: 2, name: 'Tênis Running Pro', category: 'TÊNIS', subcategory: 'Nike', price: 299.90, stock: 4, image: '', featured: true },
    { id: 3, name: 'Bermuda Jeans Skinny', category: 'BERMUDA', subcategory: '', price: 149.90, stock: 18, image: '', featured: false },
    { id: 4, name: 'Boné Snapback Fluxo', category: 'BONÉ', subcategory: 'Fluxo', price: 79.90, stock: 30, image: '', featured: false },
    { id: 5, name: 'Camisa Malha Egípcia Branca', category: 'CAMISA', subcategory: '', price: 119.90, stock: 8, image: '', featured: true },
    { id: 6, name: 'Kit Polo 3 Peças', category: 'KITS', subcategory: '', price: 449.90, stock: 5, image: '', featured: true },
  ],

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

  respostas: [
    { id: 1, titulo: 'Horário de funcionamento', gatilho: 'horário, abre, fecha', resposta: 'A Fluxo Outlet atende de segunda a sábado, das 9h às 18h.', ativo: true },
    { id: 2, titulo: 'Política de envio', gatilho: 'entrega, frete, envio, prazo', resposta: 'Enviamos para todo o Brasil via Correios. Prazo de 3 a 7 dias úteis.', ativo: true },
    { id: 3, titulo: 'Troca e devolução', gatilho: 'trocar, troca, devolução, devolver', resposta: 'Trocas em até 7 dias após o recebimento. Entre em contato conosco.', ativo: true },
    { id: 4, titulo: 'Formas de pagamento', gatilho: 'pagamento, pagar, pix, cartão', resposta: 'Aceitamos Pix, cartão de crédito (até 6x) e boleto.', ativo: false },
  ],
};

/* ─────────────────────────────────────────────────────
   FluxoCommand — Alpine.js app factory
───────────────────────────────────────────────────── */
function FluxoCommand() {
  return {
    /* state */
    page: 'dashboard',
    sidebarOpen: false,
    botOn: true,
    ignorarHorario: true,
    selectedConv: 1,

    /* data — starts with mocks, replaced by real API when available */
    conversations: MOCK.conversations,
    convMessages: MOCK.convMessages,
    leads: MOCK.leads,
    products: MOCK.products,
    sessions: [],

    /* simulador */
    simPhone: '5534999999999',
    simInput: '',
    simMessages: [],
    simLoading: false,
    simStarted: false,

    /* settings */
    cfg: {
      nome: 'Fluxo Outlet',
      whatsapp: '5534984148067',
      saudacao: 'Olá! Bem-vindo à Fluxo Outlet! 👋',
      horario_inicio: '09:00',
      horario_fim: '18:00',
    },

    /* computed */
    get currentConvMessages() {
      return this.convMessages[this.selectedConv] || [];
    },

    get currentConv() {
      return this.conversations.find(c => c.id === this.selectedConv) || this.conversations[0];
    },

    get leadsQuentes() { return this.leads.filter(l => l.status_comercial === 'QUENTE').length; },
    get leadsMornos()  { return this.leads.filter(l => l.status_comercial === 'MORNO').length; },
    get leadsFrios()   { return this.leads.filter(l => l.status_comercial === 'FRIO').length; },

    get kanban() { return MOCK.kanban; },

    /* navigation */
    navigate(p) {
      this.page = p;
      this.sidebarOpen = false;
      window.location.hash = p;
      if (p === 'relatorios') this.$nextTick(() => this.initCharts());
    },

    /* init */
    async init() {
      const hash = window.location.hash.slice(1);
      if (hash) this.page = hash;

      window.addEventListener('hashchange', () => {
        const h = window.location.hash.slice(1);
        if (h) this.page = h;
      });

      // Try to load real API data
      await Promise.allSettled([
        this.loadLeads(),
        this.loadSessions(),
      ]);

      if (this.page === 'relatorios') {
        await this.$nextTick();
        this.initCharts();
      }
    },

    /* real API calls — fallback to mock on error */
    async loadLeads() {
      try {
        const r = await fetch('/api/leads');
        const j = await r.json();
        if (j.ok && j.data?.length) this.leads = j.data;
      } catch (_) { /* keep mock */ }
    },

    async loadSessions() {
      try {
        const r = await fetch('/api/sessions');
        const j = await r.json();
        if (j.ok && j.data?.length) {
          this.sessions = j.data;
          // Merge sessions into conversations list
          const mapped = j.data.slice(0, 10).map((s, i) => ({
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
          if (mapped.length) this.conversations = mapped;
        }
      } catch (_) { /* keep mock */ }
    },

    /* chat simulator */
    async simStart() {
      if (!this.simPhone) return;
      this.simMessages = [];
      this.simLoading = true;
      this.simStarted = true;

      try {
        const r = await fetch('/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: this.simPhone }),
        });
        const j = await r.json();
        if (j.ok) {
          this.simMessages.push({ from: 'bot', text: j.text, time: this.timeNow() });
        }
      } catch (e) {
        this.simMessages.push({ from: 'bot', text: 'Erro ao iniciar. Verifique o servidor.', time: this.timeNow() });
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
        const r = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: this.simPhone, message: msg }),
        });
        const j = await r.json();
        if (j.ok) {
          this.simMessages.push({ from: 'bot', text: j.reply, time: this.timeNow() });
        } else {
          this.simMessages.push({ from: 'bot', text: j.error || 'Erro ao processar.', time: this.timeNow() });
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
