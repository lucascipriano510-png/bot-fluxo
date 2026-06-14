(window.FluxoModules = window.FluxoModules || []).push({
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

    normalizePhone(raw) {
      if (!raw) return '';
      const digits = String(raw).replace(/\D/g, '');
      if (!digits) return raw;
      if ((digits.length === 10 || digits.length === 11) && !digits.startsWith('55')) {
        return '55' + digits;
      }
      return digits;
    },

    // O WhatsApp endereça por LID: a coluna `phone` guarda o LID, e o número real
    // fica em `phone_real`. Estes helpers resolvem/formatam o número REAL para exibição
    // (o `phone`/LID continua sendo a chave técnica de seleção das conversas).
    realPhone(p) {
      if (!p) return '';
      const lead = (this.leadByPhone && this.leadByPhone[p]) || this.leads.find(l => l.phone === p);
      let real = (lead && lead.phone_real) ? lead.phone_real : '';
      if (!real) {
        const digits = String(p).replace(/\D/g, '');
        if (digits.length >= 14) return digits; // LID puro sem mapeamento conhecido
        real = this.normalizePhone(p);
      }
      // Canonicaliza celular BR: reinsere o 9º dígito se vier sem (12 → 13 díg).
      const d = String(real).replace(/\D/g, '');
      if (d.startsWith('55') && d.length === 12) return '55' + d.slice(2, 4) + '9' + d.slice(4);
      return d;
    },
    fmtPhone(raw) {
      const d = String(raw || '').replace(/\D/g, '');
      if (d.startsWith('55') && d.length >= 12) {
        const ddd = d.slice(2, 4);
        const num = d.slice(4);
        const f = num.length === 9 ? `${num.slice(0, 5)}-${num.slice(5)}` : `${num.slice(0, 4)}-${num.slice(4)}`;
        return `+55 ${ddd} ${f}`;
      }
      return raw || '';
    },
    dispPhone(p) { return this.fmtPhone(this.realPhone(p)); },

    async addConvToCrm() {
      if (!this.atendPhone || this.addingToCrm) return;
      this.addingToCrm   = true;
      this.addToCrmError = null;
      const conv = this.waConversations.find(c => c.phone === this.atendPhone)
                || this.conversations.find(c => c.phone === this.atendPhone);
      const nome = conv?.name || this.atendPhone;
      try {
        const r = await this.authFetch('/api/leads', {
          method: 'POST',
          body: JSON.stringify({
            phone:            this.atendPhone,
            nome,
            origem:           'whatsapp_inbox',
            status_comercial: 'FRIO',
            kanban_stage:     'novo',
          }),
        });
        const j = await r.json();
        if (j.ok) {
          await this.loadLeads();
          const normAtend = this.normalizePhone(this.atendPhone);
          this.atendLead = this.leads.find(l => this.normalizePhone(l.phone) === normAtend) || j.data;
        } else {
          this.addToCrmError = j.error || 'Erro ao criar lead.';
        }
      } catch (err) {
        this.addToCrmError = err.message || 'Erro de conexão.';
      } finally {
        this.addingToCrm = false;
      }
    },

});
