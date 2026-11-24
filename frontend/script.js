// ==========================================================================
// sgStock - Frontend Master Script (MoRENet / MCTD)
// Governação Tecnológica, Asset Health, OCR, QR Code, Offline-First & RBAC
// ==========================================================================

const API_URL = '/api';

// Função de Sanitização Global contra Stored XSS
function escapeHTML(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/[&<>'"]/g, tag => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
    }[tag] || tag));
}

// Diálogo de Confirmação Moderno e Assíncrono
function confirmarAcao(mensagem, titulo = 'Confirmar Ação', tipoBtn = 'btn-danger') {
    return new Promise((resolve) => {
        const modal = document.getElementById('modal-confirmacao');
        const tituloEl = document.getElementById('modal-confirm-titulo');
        const msgEl = document.getElementById('modal-confirm-mensagem');
        const btnConfirm = document.getElementById('btn-confirm-confirmar');
        const btnCancel = document.getElementById('btn-confirm-cancelar');

        if (!modal || !btnConfirm || !btnCancel) {
            resolve(window.confirm(mensagem));
            return;
        }

        tituloEl.textContent = titulo;
        msgEl.textContent = mensagem;
        btnConfirm.className = `btn ${tipoBtn}`;
        modal.style.display = 'flex';

        const cleanup = () => {
            modal.style.display = 'none';
            btnConfirm.onclick = null;
            btnCancel.onclick = null;
        };

        btnConfirm.onclick = () => { cleanup(); resolve(true); };
        btnCancel.onclick = () => { cleanup(); resolve(false); };
    });
}

function setButtonLoading(button, isLoading, loadingText = 'A processar...') {
    if (!button) return;
    if (isLoading) {
        button.disabled = true;
        button.dataset.originalHtml = button.innerHTML;
        button.innerHTML = `<span class="spinner" style="width:14px;height:14px;border-width:2px;margin-right:6px;"></span> ${escapeHTML(loadingText)}`;
    } else {
        button.disabled = false;
        if (button.dataset.originalHtml) {
            button.innerHTML = button.dataset.originalHtml;
        }
    }
}

function mostrarNotificacao(mensagem, tipo = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${tipo}`;

    const span = document.createElement('span');
    span.textContent = mensagem;

    const btn = document.createElement('button');
    btn.className = 'toast-close';
    btn.innerHTML = '&times;';
    btn.onclick = () => toast.remove();

    toast.appendChild(span);
    toast.appendChild(btn);
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        setTimeout(() => toast.remove(), 300);
    }, 4500);
}

// ==========================================================================
// 1. Estado Global da Aplicação
// ==========================================================================

const state = {
    equipamentos: [],
    historicoEntradas: [],
    historicoTransferencias: [],
    stockConsolidado: [],
    instituicoes: [],
    fornecedores: [],
    assetHealth: [],
    kpis: {},
    auditoria: [],
    usuarios: [],
    usuarioAtual: null,
    filtroSaudeAtivo: 'todos',
    ocrSerialsTemporarios: [],
    ocrPnTemporario: '',
    ocrTarget: 'serial-numbers',
    ocrTargetElement: null,
    editingFornecedorId: null,
    editingInstituicaoId: null,
    editingEquipamentoId: null
};

const EMBLEMA_MOCAMBIQUE_URL = 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTYdSkPUxqArhhHAoPwGlbzbjMxgMa4YPhHniQVCiq-oZ4bLILNCM9iyetq&s=10';

// ==========================================================================
// 2. Offline-First: IndexedDB Queue
// ==========================================================================

const DB_NAME = 'sgStockOfflineDB';
const DB_VERSION = 1;
const STORE_NAME = 'operacoes_pendentes';

function abrirIndexedDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function guardarOperacaoOffline(url, method, payload) {
    try {
        const db = await abrirIndexedDB();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.add({
            url,
            method,
            payload,
            criadoEm: new Date().toISOString()
        });
        await new Promise((res, rej) => {
            tx.oncomplete = res;
            tx.onerror = rej;
        });
        mostrarNotificacao('Modo Offline: Operação guardada localmente no dispositivo.', 'warning');
        const alertEl = document.getElementById('offline-sync-alert');
        if (alertEl) alertEl.style.display = 'block';
    } catch (e) {
        console.error('Erro ao guardar em IndexedDB:', e);
        throw e;
    }
}

async function sincronizarFilaOffline() {
    if (!navigator.onLine) return;
    try {
        const db = await abrirIndexedDB();
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.getAll();

        const operacoes = await new Promise((res, rej) => {
            req.onsuccess = () => res(req.result);
            req.onerror = rej;
        });

        if (!operacoes || operacoes.length === 0) {
            const alertEl = document.getElementById('offline-sync-alert');
            if (alertEl) alertEl.style.display = 'none';
            return;
        }

        mostrarNotificacao(`A sincronizar ${operacoes.length} operação(ões) offline...`, 'info');

        const concluidas = [];
        for (const op of operacoes) {
            try {
                const resposta = await fetchComAutenticacao(op.url, {
                    method: op.method,
                    body: JSON.stringify(op.payload)
                });
                if (resposta?.ok) {
                    concluidas.push(op.id);
                } else if (resposta) {
                    console.error(`Operação offline recusada (${resposta.status}):`, op);
                }
            } catch (err) {
                console.error('Falha ao sincronizar item:', op, err);
            }
        }

        if (concluidas.length) {
            const txLimpa = db.transaction(STORE_NAME, 'readwrite');
            const storeLimpa = txLimpa.objectStore(STORE_NAME);
            concluidas.forEach(id => storeLimpa.delete(id));
            await new Promise((resolve, reject) => {
                txLimpa.oncomplete = resolve;
                txLimpa.onerror = () => reject(txLimpa.error);
            });
        }

        const pendentes = operacoes.length - concluidas.length;
        if (concluidas.length) {
            mostrarNotificacao(`${concluidas.length} operação(ões) offline sincronizada(s).`, 'success');
            await carregarDadosDaBD();
        }
        if (pendentes) {
            mostrarNotificacao(`${pendentes} operação(ões) permanecem pendentes; consulte a ligação e tente novamente.`, 'warning');
        }
        const alertEl = document.getElementById('offline-sync-alert');
        if (alertEl) alertEl.style.display = pendentes ? 'block' : 'none';
    } catch (e) {
        console.error('Erro durante sincronização offline:', e);
    }
}

// ==========================================
// 3. Comunicação com a API Backend
// ==========================================

async function fetchComAutenticacao(url, options = {}) {
    const token = localStorage.getItem('token');

    const headers = {
        ...(options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
        'Authorization': `Bearer ${token}`,
        ...(options.headers || {})
    };

    try {
        const res = await fetch(url, { ...options, headers });

        if (res.status === 401) {
            logout(true);
            return null;
        }

        return res;
    } catch (err) {
        // Se falhou por falta de rede em requisições de modificação (POST, PUT, DELETE)
        if (!navigator.onLine && options.method && options.method !== 'GET' &&
            !(options.body instanceof FormData)) {
            const payload = options.body ? JSON.parse(options.body) : {};
            await guardarOperacaoOffline(url, options.method, payload);
            return {
                ok: false,
                offline: true,
                status: 503,
                json: async () => ({
                    offline: true,
                    error: 'Operação guardada localmente e pendente de sincronização.'
                })
            };
        }
        throw err;
    }
}

function logout(sessaoExpirada = false) {
    if (!sessaoExpirada && !window.confirm('Tem a certeza de que pretende terminar a sessão?')) return;
    localStorage.removeItem('token');
    localStorage.removeItem('usuario');
    window.location.replace(sessaoExpirada ? '/login?expired=1' : '/login');
}

function dataAtividade(item) {
    const value = item.ultimaAtividade || item.atividadeRecente || item.criadoEm ||
        item.createdAt || item.created_at || item.dataHora || item.dataAquisicao;
    const timestamp = value ? Date.parse(value) : 0;
    return Number.isFinite(timestamp) ? timestamp : 0;
}

function ordenarPorAtividadeRecente(items) {
    return [...(items || [])].sort((a, b) => dataAtividade(b) - dataAtividade(a));
}

// ==========================================
// 4. Carregamento Geral de Dados
// ==========================================

async function carregarDadosDaBD() {
    const alertBox = document.getElementById('api-alert');

    try {
        const [resEq, resEnt, resTransf, resStock, resInst, resForn, resHealth, resKpis] = await Promise.all([
            fetchComAutenticacao(`${API_URL}/equipamentos`),
            fetchComAutenticacao(`${API_URL}/entradas`),
            fetchComAutenticacao(`${API_URL}/transferencias`),
            fetchComAutenticacao(`${API_URL}/stock`),
            fetchComAutenticacao(`${API_URL}/instituicoes`),
            fetchComAutenticacao(`${API_URL}/fornecedores`),
            fetchComAutenticacao(`${API_URL}/analytics/asset-health`),
            fetchComAutenticacao(`${API_URL}/analytics/kpis`)
        ]);

        if (resEq && resEq.ok) state.equipamentos = ordenarPorAtividadeRecente(await resEq.json());
        if (resEnt && resEnt.ok) state.historicoEntradas = ordenarPorAtividadeRecente(await resEnt.json());
        if (resTransf && resTransf.ok) state.historicoTransferencias = ordenarPorAtividadeRecente(await resTransf.json());
        if (resStock && resStock.ok) state.stockConsolidado = ordenarPorAtividadeRecente(await resStock.json());
        if (resInst && resInst.ok) state.instituicoes = ordenarPorAtividadeRecente(await resInst.json());
        if (resForn && resForn.ok) state.fornecedores = ordenarPorAtividadeRecente(await resForn.json());
        if (resHealth && resHealth.ok) state.assetHealth = ordenarPorAtividadeRecente(await resHealth.json());
        if (resKpis && resKpis.ok) state.kpis = await resKpis.json();

        if (alertBox) alertBox.style.display = 'none';

        atualizarKPIs();
        atualizarSelects();
        atualizarTabelaStock();
        atualizarTabelaModelos();
        atualizarTabelaHistorico();
        atualizarTabelaTransferencias();
        atualizarTabelaAssetHealth();
        atualizarResumoMovimentacoes();
        atualizarTabelasCadastros();

        // Se for admin, carrega auditoria
        if (state.usuarioAtual && state.usuarioAtual.perfil === 'administrador') {
            carregarAuditoria();
            carregarUsuarios();
        }

    } catch (error) {
        console.error('Erro ao carregar dados da base de dados:', error);
        if (alertBox) {
            alertBox.style.display = 'block';
            alertBox.textContent = 'Erro ao conectar à base de dados. Verifique o servidor backend.';
        }
    }
}

// ==========================================
// 5. Renderização de KPIs e Asset Health
// ==========================================

function atualizarKPIs() {
    const elModelos = document.getElementById('kpi-total-modelos');
    const elUnidades = document.getElementById('kpi-total-unidades');
    const elValor = document.getElementById('kpi-valor-investido');
    const elFibra = document.getElementById('kpi-fibra-ativos');

    const totalModelos = state.kpis.totalModelos !== undefined ? state.kpis.totalModelos : state.equipamentos.length;
    const totalUnidades = state.kpis.totalUnidades !== undefined ? state.kpis.totalUnidades :
        state.stockConsolidado.reduce((acc, cur) => acc + (Number(cur.total) || 0), 0);
    const valorTotal = state.kpis.valorTotalInvestido !== undefined ? state.kpis.valorTotalInvestido : 0;
    const fibraAtivos = state.kpis.capacidadeTecnica ? state.kpis.capacidadeTecnica.ativosFibra : 0;

    if (elModelos) elModelos.textContent = totalModelos;
    if (elUnidades) elUnidades.textContent = totalUnidades;
    if (elValor) elValor.textContent = Number(valorTotal).toLocaleString('pt-MZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' MZN';
    if (elFibra) elFibra.textContent = fibraAtivos;
}

function atualizarTabelaModelos() {
    const corpo = document.getElementById('corpo-tabela-modelos');
    if (!corpo) return;
    const modelos = ordenarPorAtividadeRecente(state.equipamentos);
    if (modelos.length === 0) {
        corpo.innerHTML = '<tr><td colspan="7" class="empty-state">Nenhum modelo cadastrado.</td></tr>';
        return;
    }

    corpo.innerHTML = modelos.map(item => `
        <tr>
            <td>${escapeHTML(item.marca || '-')}</td>
            <td><strong>${escapeHTML(item.modelo || '-')}</strong></td>
            <td>${escapeHTML(item.partNumber || item.part_number || '-')}</td>
            <td>${escapeHTML(item.categoria || 'Geral')}</td>
            <td>${Number(item.vidaUtilAnos || item.vida_util_anos || 5)} anos</td>
            <td><small>${escapeHTML(item.portas || '—')}<br>${escapeHTML(item.capacidadeBanda || item.capacidade_banda || '—')}</small></td>
            <td class="table-actions">
                ${state.usuarioAtual?.perfil === 'administrador' ? `
                    <button class="btn btn-sm btn-outline" data-edit-modelo="${escapeHTML(item.id)}">Editar</button>
                    <button class="btn btn-sm btn-danger" data-delete-modelo="${escapeHTML(item.id)}">Eliminar</button>
                ` : '—'}
            </td>
        </tr>`).join('');
}

function atualizarTabelaAssetHealth() {
    const corpo = document.getElementById('corpo-tabela-asset-health');
    if (!corpo) return;

    const todosDados = ordenarPorAtividadeRecente(state.assetHealth || []);
    let dados = todosDados;

    // Contadores para os botões de filtro
    const total = dados.length;
    const classificar = item => {
        const estado = String(item.estadoFisico || item.estado_fisico || '').toLowerCase();
        const idade = Number(item.idadeAnos ?? item.idade_anos ?? 0);
        const vida = Number(item.vidaUtilAnos ?? item.vida_util_anos ?? 5);
        const origem = item.classificacaoSaude || item.classificacao_saude || '';
        if (['avariado', 'abatido'].includes(estado) || /fim de vida|crítico/i.test(origem) || (vida > 0 && idade >= vida)) {
            return 'Fim de Vida Útil';
        }
        if (/atenção|alerta/i.test(origem) || (vida > 0 && idade >= vida * 0.8)) return 'Atenção/Alerta';
        return 'Saudável';
    };
    const alerta = dados.filter(d => classificar(d) === 'Atenção/Alerta').length;
    const fim = dados.filter(d => classificar(d) === 'Fim de Vida Útil').length;
    const ok = dados.filter(d => classificar(d) === 'Saudável').length;

    const cTodos = document.getElementById('count-saude-todos');
    const cAlerta = document.getElementById('count-saude-alerta');
    const cFim = document.getElementById('count-saude-fim');
    const cOk = document.getElementById('count-saude-ok');

    if (cTodos) cTodos.textContent = total;
    if (cAlerta) cAlerta.textContent = alerta;
    if (cFim) cFim.textContent = fim;
    if (cOk) cOk.textContent = ok;

    // Aplicação do filtro
    if (state.filtroSaudeAtivo !== 'todos') {
        dados = dados.filter(d => classificar(d) === state.filtroSaudeAtivo);
    }

    if (dados.length === 0) {
        corpo.innerHTML = '<tr><td colspan="9" style="text-align:center; padding:1.5rem;">Nenhum ativo encontrado nesta classificação de saúde.</td></tr>';
        return;
    }

    corpo.innerHTML = '';
    dados.forEach(item => {
        const tr = document.createElement('tr');
        const status = classificar(item);
        let badgeClass = 'badge-saude-ok';
        if (status === 'Atenção/Alerta') badgeClass = 'badge-saude-alerta';
        if (status === 'Fim de Vida Útil') badgeClass = 'badge-saude-fim';

        const idade = Number(item.idadeAnos ?? item.idade_anos ?? 0).toFixed(1);
        const vidaUtil = Number(item.vidaUtilAnos ?? item.vida_util_anos ?? 5);
        const percentual = Number(item.percentualSaude ?? item.percentual_saude ?? 100);
        const avarias = Number(item.totalAvarias ?? item.total_avarias_historico ?? 0);
        const estado = String(item.estadoFisico || item.estado_fisico || 'operacional').toLowerCase();
        const justificativa = item.justificativa || item.ultimaJustificativa || '';
        let recomendacao = 'Operação normal; manter inspeções periódicas.';
        if (estado === 'avariado') recomendacao = 'Priorizar diagnóstico e manutenção; acompanhar o incidente registado.';
        if (estado === 'abatido') recomendacao = 'Retirar de operação e formalizar o abate ou encaminhamento para reciclagem.';
        if (estado === 'novo') recomendacao = 'Registar a ativação e manter o plano de manutenção preventiva.';
        if (status === 'Atenção/Alerta') recomendacao = 'Planear manutenção preventiva e preparar a substituição antes do fim da vida útil.';
        if (status === 'Fim de Vida Útil' && !['avariado', 'abatido'].includes(estado)) {
            recomendacao = 'Vida útil esgotada: avaliar substituição e iniciar processo de abate.';
        }
        const justificativaNormalizada = justificativa.toLocaleLowerCase('pt');
        if (estado === 'avariado' && /sobreaquec|temperatura|ventila/.test(justificativaNormalizada)) {
            recomendacao = 'Inspecionar refrigeração e ventilação; manter o ativo isolado até validar a temperatura de operação.';
        } else if (estado === 'avariado' && /energia|aliment|fonte|bateria|corrente/.test(justificativaNormalizada)) {
            recomendacao = 'Verificar fonte de alimentação, cablagem e proteção elétrica antes de devolver o ativo à operação.';
        } else if (estado === 'avariado' && /porta|interface|rede|conect|fibra/.test(justificativaNormalizada)) {
            recomendacao = 'Testar interfaces, cablagem e conectividade; registar os resultados após a reparação.';
        }
        const serial = item.serial || item.serial_number || '';
        tr.className = 'asset-health-row';
        tr.tabIndex = 0;
        tr.setAttribute('role', 'link');
        tr.setAttribute('aria-label', `Localizar ${item.marca || ''} ${item.modelo || ''}, S/N ${serial}, no inventário`);
        tr.dataset.assetNavigation = 'true';
        tr.dataset.assetSerial = serial;
        tr.dataset.assetEquipmentId = item.equipamentoId || item.equipamento_id || '';

        tr.innerHTML = `
            <td><strong>${escapeHTML(item.marca)} ${escapeHTML(item.modelo)}</strong><br><small style="color:var(--text-muted)">P/N: ${escapeHTML(item.partNumber || item.part_number)}</small></td>
            <td><span class="destaque-sn">${escapeHTML(serial)}</span></td>
            <td>${escapeHTML(item.localAtual || item.localizacao_atual)}</td>
            <td>${idade} / ${vidaUtil} anos</td>
            <td>${avarias > 0 ? `<span style="color:#b91c1c; font-weight:bold;">${avarias} avaria(s)</span>` : '0'}</td>
            <td><strong>${percentual}%</strong></td>
            <td><span class="badge-saude ${badgeClass}">${escapeHTML(status)}</span></td>
            <td><small>${escapeHTML(justificativa || 'Sem alteração de estado registada.')}</small></td>
            <td><small>${escapeHTML(recomendacao)}</small></td>
        `;
        corpo.appendChild(tr);
    });
}

// ==========================================
// 6. Atualização de Selects e Dropdowns
// ==========================================

function atualizarSelects() {
    const selEq = document.getElementById('select-equipamento');
    const selEqTransf = document.getElementById('select-equipamento-transf');
    const selInstEntrada = document.getElementById('select-instituicao-entrada');
    const selDestinoTransf = document.getElementById('destino-transf');
    const selRegInst = document.getElementById('reg-instituicao');
    const selForn = document.getElementById('modelo-fornecedor');
    const selLoteForn = document.getElementById('lote-fornecedor');
    const selLoteInst = document.getElementById('lote-instituicao');

    // 1. Equipamentos
    if (selEq) {
        selEq.innerHTML = '<option value="">-- Selecione um modelo --</option>';
        state.equipamentos.forEach(eq => {
            const opt = document.createElement('option');
            opt.value = eq.id;
            opt.textContent = `${eq.marca} ${eq.modelo} | P/N: ${eq.partNumber || eq.part_number}`;
            selEq.appendChild(opt);
        });
    }

    if (selEqTransf && selEq) {
        selEqTransf.innerHTML = selEq.innerHTML;
    }

    // 2. Instituições Predefinidas
    const preencherInst = (selectEl, defaultText = '-- Selecione a Instituição --') => {
        if (!selectEl) return;
        selectEl.innerHTML = `<option value="">${defaultText}</option>`;
        state.instituicoes.forEach(inst => {
            const opt = document.createElement('option');
            opt.value = inst.nome;
            opt.textContent = `${inst.sigla ? inst.sigla + ' - ' : ''}${inst.nome} (${inst.provincia})`;
            selectEl.appendChild(opt);
        });
    };

    preencherInst(selInstEntrada, '-- Selecione o Destino do Stock --');
    preencherInst(selDestinoTransf, '-- Selecione o Destino da Transferência --');
    preencherInst(selRegInst, '-- Selecione a Instituição do Técnico --');
    preencherInstPorId(selLoteInst);

    // Se for técnico, bloqueia a escolha para a sua instituição vinculada
    if (state.usuarioAtual && state.usuarioAtual.perfil === 'tecnico' && state.usuarioAtual.instituicao_nome) {
        if (selInstEntrada) {
            selInstEntrada.value = state.usuarioAtual.instituicao_nome;
            selInstEntrada.disabled = true;
        }
    }

    // 3. Fornecedores
    if (selForn) {
        selForn.innerHTML = '<option value="">-- Selecione o Fornecedor --</option>';
        state.fornecedores.forEach(forn => {
            const opt = document.createElement('option');
            opt.value = forn.id;
            opt.textContent = `${forn.nome_empresa || forn.nome}${forn.nif || forn.nuit ? ` (NIF: ${forn.nif || forn.nuit})` : ''}`;
            selForn.appendChild(opt);
        });
    }

    if (selLoteForn) {
        selLoteForn.innerHTML = '<option value="">-- Selecione o fornecedor --</option>';
        state.fornecedores.forEach(forn => {
            const opt = document.createElement('option');
            opt.value = forn.id;
            opt.textContent = `${forn.nome_empresa || forn.nome}${forn.nif || forn.nuit ? ` (NIF: ${forn.nif || forn.nuit})` : ''}`;
            selLoteForn.appendChild(opt);
        });
    }

    document.querySelectorAll('[data-batch-model]').forEach(preencherModelosLote);
}

function preencherInstPorId(selectEl) {
    if (!selectEl) return;
    selectEl.innerHTML = '<option value="">-- Selecione a instituição --</option>';
    state.instituicoes.forEach(inst => {
        const opt = document.createElement('option');
        opt.value = inst.id;
        opt.textContent = `${inst.sigla ? `${inst.sigla} - ` : ''}${inst.nome} (${inst.provincia})`;
        selectEl.appendChild(opt);
    });
    if (state.usuarioAtual?.perfil === 'tecnico' && state.usuarioAtual.instituicao_id) {
        selectEl.value = state.usuarioAtual.instituicao_id;
        selectEl.disabled = true;
    }
}

function preencherModelosLote(selectEl) {
    if (!selectEl) return;
    const linha = selectEl.closest('.batch-line');
    const categoria = linha?.querySelector('[data-batch-category]')?.value || '';
    const escolhido = selectEl.value;
    selectEl.innerHTML = '<option value="">-- Selecione o modelo --</option>';
    state.equipamentos
        .filter(eq => !categoria || eq.categoria === categoria)
        .forEach(eq => {
            const opt = document.createElement('option');
            opt.value = eq.id;
            opt.textContent = `${eq.marca} ${eq.modelo} | P/N: ${eq.partNumber || eq.part_number}`;
            selectEl.appendChild(opt);
        });
    if (state.equipamentos.some(eq => eq.id === escolhido)) selectEl.value = escolhido;
}

// ==========================================
// 7. Tabelas de Stock, Entradas e Transferências
// ==========================================

function atualizarTabelaStock() {
    const corpo = document.getElementById('corpo-tabela-stock');
    if (!corpo) return;
    corpo.innerHTML = '';

    const dados = state.stockConsolidado || [];

    if (dados.length === 0) {
        corpo.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:1.5rem;">Nenhum equipamento em stock na posição selecionada.</td></tr>';
        return;
    }

    dados.forEach(item => {
        const tr = document.createElement('tr');
        const serialsList = Array.isArray(item.serials) ? item.serials : [];
        tr.dataset.stockEquipmentId = item.equipamentoId || item.equipamento_id || '';
        tr.dataset.stockInstitution = item.instituicao || item.local_atual || '';
        tr.dataset.stockSerials = JSON.stringify(serialsList);
        const serialsHtml = serialsList
            .map(serial => {
                const activo = state.assetHealth.find(item =>
                    String(item.serial || item.serial_number).toLowerCase() === String(serial).toLowerCase()
                );
                return `<span class="stock-serial">${escapeHTML(serial)}${activo ? ` <span class="badge-fisico ${classeBadgeEstado(activo.estadoFisico || activo.estado_fisico)}">${escapeHTML(rotuloEstado(activo.estadoFisico || activo.estado_fisico))}</span>` : ''}</span>`;
            })
            .join(' ');

        tr.innerHTML = `
            <td><strong>${escapeHTML(item.marca)}</strong></td>
            <td>${escapeHTML(item.modelo)}</td>
            <td>${escapeHTML(item.partNumber || item.part_number)}</td>
            <td><span class="badge-subtitle" style="color:var(--text-color);">${escapeHTML(item.categoria || 'Geral')}</span></td>
            <td><div class="stock-serial-list">${serialsHtml || 'N/A'}</div></td>
            <td><span class="badge-instituicao">${escapeHTML(item.instituicao || item.local_atual)}</span></td>
            <td><strong>${Number(item.total) || 0}</strong></td>
            <td class="text-right">
                <button class="btn btn-sm btn-outline btn-gerar-qr" title="Gerar Etiqueta QR Code">🏷️ QR</button>
                <button class="btn btn-sm btn-outline btn-alterar-estado" title="Alterar estado de um número de série">Estado</button>
                ${state.usuarioAtual?.perfil === 'administrador' ? `
                    <button class="btn btn-sm btn-secondary btn-editar-stock">Editar</button>
                    <button class="btn btn-sm btn-danger btn-eliminar-serial">Eliminar</button>
                ` : ''}
            </td>
        `;

        // Eventos dos botões de linha
        tr.querySelector('.btn-gerar-qr')?.addEventListener('click', () => {
            abrirModalEtiquetasQR({
                marca: item.marca,
                modelo: item.modelo,
                partNumber: item.partNumber || item.part_number,
                instituicao: item.instituicao || item.local_atual
            }, serialsList);
        });

        tr.querySelector('.btn-alterar-estado')?.addEventListener('click', () => {
            abrirModalEstadoAtivo(item.equipamentoId || item.equipamento_id, serialsList);
        });

        tr.querySelector('.btn-editar-stock')?.addEventListener('click', () => {
            const modelo = state.equipamentos.find(eq => String(eq.id) === String(item.equipamentoId || item.equipamento_id));
            if (modelo) abrirModalEditarModelo(modelo);
        });

        tr.querySelector('.btn-eliminar-serial')?.addEventListener('click', () => {
            abrirModalEliminarSeriais(item.equipamentoId || item.equipamento_id, `${item.marca} ${item.modelo}`, item.instituicao || item.local_atual, serialsList);
        });

        corpo.appendChild(tr);
    });
}

function rotuloEstado(estado) {
    const labels = { novo: 'Novo', operacional: 'Operacional', avariado: 'Avariado', abatido: 'Abatido' };
    return labels[String(estado || '').toLowerCase()] || 'Desconhecido';
}

function classeBadgeEstado(estado) {
    const classes = {
        novo: 'badge-fisico-novo',
        operacional: 'badge-fisico-operacional',
        avariado: 'badge-fisico-avariado',
        abatido: 'badge-fisico-abatido'
    };
    return classes[String(estado || '').toLowerCase()] || 'badge-fisico-desconhecido';
}

function filtrarInventario() {
    const termo = document.getElementById('search-inventario').value.toLowerCase();
    const corpo = document.getElementById('corpo-tabela-stock');
    const linhas = corpo?.querySelectorAll('tr') || [];

    linhas.forEach(linha => {
        linha.dataset.paginationFilteredOut = String(!linha.textContent.toLowerCase().includes(termo));
    });
    atualizarPaginacaoLista(corpo, true);
}

const PAGINACAO_LIMITE = 5;
const paginasListas = new WeakMap();

function atualizarPaginacaoLista(corpo, reiniciar = false) {
    if (!corpo) return;
    const linhas = [...corpo.rows];
    const linhasFiltradas = linhas.filter(linha => linha.dataset.paginationFilteredOut !== 'true');
    let pagina = paginasListas.get(corpo) || 1;
    const totalPaginas = Math.max(1, Math.ceil(linhasFiltradas.length / PAGINACAO_LIMITE));
    if (reiniciar) pagina = 1;
    pagina = Math.min(pagina, totalPaginas);
    paginasListas.set(corpo, pagina);

    const inicio = (pagina - 1) * PAGINACAO_LIMITE;
    const paginaAtual = new Set(linhasFiltradas.slice(inicio, inicio + PAGINACAO_LIMITE));
    linhas.forEach(linha => { linha.hidden = !paginaAtual.has(linha); });

    const tabela = corpo.closest('table');
    if (!tabela) return;
    const alvo = tabela.closest('.table-responsive') || tabela;
    let controles = alvo.nextElementSibling;
    if (!controles?.classList.contains('pagination-controls')) {
        controles = document.createElement('nav');
        controles.className = 'pagination-controls';
        controles.setAttribute('aria-label', 'Paginação da lista');
        alvo.after(controles);
    }

    const visiveis = linhasFiltradas.length;
    controles.hidden = totalPaginas <= 1;
    if (controles.hidden) {
        controles.replaceChildren();
        return;
    }

    const primeiro = visiveis ? inicio + 1 : 0;
    const ultimo = Math.min(inicio + PAGINACAO_LIMITE, visiveis);
    const resumo = document.createElement('span');
    resumo.className = 'pagination-summary';
    resumo.textContent = `${primeiro}–${ultimo} de ${visiveis}`;

    const anterior = document.createElement('button');
    anterior.type = 'button';
    anterior.className = 'btn btn-sm btn-outline';
    anterior.textContent = 'Anterior';
    anterior.disabled = pagina <= 1;
    anterior.addEventListener('click', () => {
        paginasListas.set(corpo, pagina - 1);
        atualizarPaginacaoLista(corpo);
    });

    const seguinte = document.createElement('button');
    seguinte.type = 'button';
    seguinte.className = 'btn btn-sm btn-outline';
    seguinte.textContent = 'Seguinte';
    seguinte.disabled = pagina >= totalPaginas;
    seguinte.addEventListener('click', () => {
        paginasListas.set(corpo, pagina + 1);
        atualizarPaginacaoLista(corpo);
    });

    controles.replaceChildren(anterior, resumo, seguinte);
}

function destacarLinha(tbody, linha, indice) {
    paginasListas.set(tbody, Math.floor(indice / PAGINACAO_LIMITE) + 1);
    atualizarPaginacaoLista(tbody);
    linha.classList.remove('asset-row-highlight');
    linha.scrollIntoView({ behavior: 'smooth', block: 'center' });
    linha.classList.add('asset-row-highlight');
    window.setTimeout(() => linha.classList.remove('asset-row-highlight'), 4500);
}

function navegarParaAtivo(serial) {
    if (!serial) return;
    const serialNormalizado = serial.trim().toLowerCase();
    const pesquisa = document.getElementById('search-inventario');
    mudarAba('tab-inventario');
    if (pesquisa) {
        pesquisa.value = serial;
        filtrarInventario();
    }

    const corpoStock = document.getElementById('corpo-tabela-stock');
    const linhasStock = [...(corpoStock?.rows || [])];
    const indiceStock = linhasStock.findIndex(linha => {
        try {
            return JSON.parse(linha.dataset.stockSerials || '[]')
                .some(valor => String(valor).trim().toLowerCase() === serialNormalizado);
        } catch (error) {
            console.error('Lista de seriais inválida na linha do inventário:', error);
            return false;
        }
    });
    if (indiceStock >= 0) {
        destacarLinha(corpoStock, linhasStock[indiceStock], indiceStock);
        return;
    }

    if (pesquisa) {
        pesquisa.value = '';
        filtrarInventario();
    }
    mudarAba('tab-movimentacoes');
    for (const id of ['corpo-tabela-transferencias', 'corpo-tabela-historico']) {
        const corpo = document.getElementById(id);
        const linhas = [...(corpo?.rows || [])];
        const indice = linhas.findIndex(linha => {
            try {
                return JSON.parse(linha.dataset.activitySerials || '[]')
                    .some(valor => String(valor).trim().toLowerCase() === serialNormalizado);
            } catch (error) {
                console.error('Lista de seriais inválida no histórico:', error);
                return false;
            }
        });
        if (indice >= 0) {
            destacarLinha(corpo, linhas[indice], indice);
            return;
        }
    }
    mostrarNotificacao(`Não foi encontrada uma linha de inventário ou transferência para o S/N ${serial}.`, 'warning');
}

function configurarPaginacaoListas() {
    document.querySelectorAll('table tbody').forEach(corpo => {
        const observer = new MutationObserver(() => atualizarPaginacaoLista(corpo, true));
        observer.observe(corpo, { childList: true });
        atualizarPaginacaoLista(corpo);
    });
}

function atualizarTabelaHistorico() {
    const corpo = document.getElementById('corpo-tabela-historico');
    if (!corpo) return;
    corpo.innerHTML = '';

    const dados = state.historicoEntradas || [];

    if (dados.length === 0) {
        corpo.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:1.5rem;">Nenhuma entrada de stock registada.</td></tr>';
        return;
    }

    dados.forEach(e => {
        const serialsTexto = e.serials ? (Array.isArray(e.serials) ? e.serials.join(', ') : e.serials) : 'N/A';
        const tr = document.createElement('tr');
        tr.dataset.activitySerials = JSON.stringify(Array.isArray(e.serials) ? e.serials : []);
        tr.dataset.activityEquipmentId = e.equipamentoId || '';
        const custo = e.custoUnitario ? Number(e.custoUnitario).toLocaleString('pt-MZ', { minimumFractionDigits: 2 }) + ' MZN' : '-';

        tr.innerHTML = `
            <td><small>${escapeHTML(e.dataHora)}</small></td>
            <td><strong>${escapeHTML(e.equipamentoNome)}</strong><br><small style="color:var(--text-muted)">S/N: ${escapeHTML(serialsTexto)}</small></td>
            <td><span class="badge-unidades">+${Number(e.quantidade) || 0}</span></td>
            <td><small>${escapeHTML(e.faturaNumero || '-')}<br>${escapeHTML(e.fornecedorNome || '-')}</small></td>
            <td><small>${custo}</small></td>
            <td><span class="badge-instituicao">${escapeHTML(e.instituicao)}</span></td>
            <td><span class="badge-fisico ${classeBadgeEstado(e.estadoFisico || 'novo')}">${escapeHTML(rotuloEstado(e.estadoFisico || 'novo'))}</span></td>
            <td style="text-align: center;">
                ${state.usuarioAtual?.perfil === 'administrador' ? `
                    <button class="btn btn-sm btn-danger btn-apagar-entrada" data-id="${e.id}" title="Eliminar Entrada">✕</button>
                ` : '-'}
            </td>
        `;

        tr.querySelector('.btn-apagar-entrada')?.addEventListener('click', () => apagarEntrada(e.id));
        corpo.appendChild(tr);
    });
}

function atualizarTabelaTransferencias() {
    const corpo = document.getElementById('corpo-tabela-transferencias');
    if (!corpo) return;
    corpo.innerHTML = '';

    const dados = state.historicoTransferencias || [];

    if (dados.length === 0) {
        corpo.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:1.5rem;">Nenhuma transferência registada.</td></tr>';
        return;
    }

    dados.forEach(t => {
        const serialsTexto = t.serials ? (Array.isArray(t.serials) ? t.serials.join(', ') : t.serials) : 'N/A';
        const tr = document.createElement('tr');
        tr.dataset.activitySerials = JSON.stringify(Array.isArray(t.serials) ? t.serials : []);
        tr.dataset.activityEquipmentId = t.equipamentoId || '';

        tr.innerHTML = `
            <td><small>${escapeHTML(t.dataHora)}</small></td>
            <td><strong>${escapeHTML(t.equipamentoNome)}</strong><br><small style="color:var(--text-muted)">S/N: ${escapeHTML(serialsTexto)}</small></td>
            <td><span class="badge-unidades">${Number(t.quantidade) || 0}</span></td>
            <td>${escapeHTML(t.origem)}</td>
            <td><strong>${escapeHTML(t.destino)}</strong></td>
            <td><small>${escapeHTML(t.responsavelTransporte || '-')}<br>${escapeHTML(t.matriculaViatura || '')}</small></td>
            <td style="text-align: center;">
                ${state.usuarioAtual?.perfil === 'administrador' ? `
                    <button class="btn btn-sm btn-danger btn-anular-transf" data-id="${t.id}" title="Anular Transferência">Anular</button>
                ` : '-'}
            </td>
        `;

        tr.querySelector('.btn-anular-transf')?.addEventListener('click', () => apagarTransferencia(t.id));
        corpo.appendChild(tr);
    });
}

function atualizarResumoMovimentacoes() {
    const corpo = document.getElementById('corpo-tabela-resumo-movimentacoes');
    if (!corpo) return;
    corpo.innerHTML = '';

    const entradas = (state.historicoEntradas || []).map(e => ({
        data: e.dataHora,
        tipo: 'Entrada',
        equipamento: e.equipamentoNome,
        qtd: `+${e.quantidade}`,
        local: e.instituicao,
        ts: new Date(e.criadoEm || 0).getTime()
    }));

    const transferencias = (state.historicoTransferencias || []).map(t => ({
        data: t.dataHora,
        tipo: 'Transferência',
        equipamento: t.equipamentoNome,
        qtd: `⇄ ${t.quantidade}`,
        local: `${t.origem} → ${t.destino}`,
        ts: new Date(t.criadoEm || 0).getTime()
    }));

    const todas = [...entradas, ...transferencias].sort((a, b) => b.ts - a.ts).slice(0, 5);

    if (todas.length === 0) {
        corpo.innerHTML = '<tr><td colspan="5" style="text-align:center;">Sem movimentações recentes.</td></tr>';
        return;
    }

    todas.forEach(m => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><small>${escapeHTML(m.data)}</small></td>
            <td><span class="badge-status ${m.tipo === 'Entrada' ? 'badge-online' : 'badge-instituicao'}">${m.tipo}</span></td>
            <td><strong>${escapeHTML(m.equipamento)}</strong></td>
            <td>${escapeHTML(m.qtd)}</td>
            <td><small>${escapeHTML(m.local)}</small></td>
        `;
        corpo.appendChild(tr);
    });
}

// ==========================================
// 8. Gestão de Etiquetas QR Code Imprimíveis
// ==========================================

function abrirModalEtiquetasQR(dadosBase, serials) {
    const container = document.getElementById('container-etiqueta-impressao');
    if (!container || !window.sgQRCode) return;
    const lista = [...new Set((serials || []).map(serial => String(serial).trim()).filter(Boolean))];
    if (!lista.length) {
        mostrarNotificacao('Não há números de série para gerar etiquetas.', 'warning');
        return;
    }

    container.innerHTML = lista.map(serial => {
        const entrada = state.historicoEntradas.find(registo =>
            Array.isArray(registo.serials) && registo.serials.some(sn => String(sn).toLowerCase() === serial.toLowerCase())
        );
        return window.sgQRCode.criarEtiquetaHTML({
            ...dadosBase,
            serial,
            dataAquisicao: entrada?.dataAquisicao || '',
            estado: entrada?.estadoFisico ? rotuloEstado(entrada.estadoFisico) : '',
            faturaNumero: entrada?.faturaNumero || '',
            custoUnitario: entrada?.custoUnitario ?? ''
        });
    }).join('');
    abrirModal('modal-etiqueta-qr');
}

// ==========================================
// 9. Leitor OCR de Etiquetas (Câmara & Ficheiro)
// ==========================================

let ocrStream = null;
let ocrBusy = false;
let ocrRequestId = 0;
let ocrCameraRequestId = 0;
let ocrDiagnosticoAtual = null;
let ocrSerialTargetAplicado = null;
let ocrSerialsOriginais = new Set();
let ocrSerialsAplicados = new Set();
let ocrPartNumberTargetAplicado = null;
let ocrPartNumberOriginal = '';
let ocrPartNumberAplicado = null;

window.OCRManager = Object.freeze({
    abrir(target = 'serial-numbers', trigger = null) {
        abrirOCR(target, trigger);
    },
    iniciarCamera(videoElement) {
        return window.sgOCR.iniciarCamera(videoElement);
    },
    capturar(videoElement) {
        return window.sgOCR.capturarQuadroDeVideo(videoElement);
    },
    pararCamera(stream) {
        window.sgOCR.pararCamera(stream);
    },
    reconhecer(imagem, onProgress, onDiagnostic) {
        return window.sgOCR.reconhecerImagem(imagem, onProgress, onDiagnostic);
    },
    extrair(texto) {
        return window.sgOCR.extrairIdentificadoresDeTexto(texto);
    }
});

function abrirOCR(target = 'serial-numbers', trigger = null) {
    ocrRequestId += 1;
    state.ocrTarget = target;
    state.ocrTargetElement = trigger?.closest('.batch-line')?.querySelector('[data-batch-serials]') || null;
    state.ocrSerialsTemporarios = [];
    state.ocrPnTemporario = '';
    ocrSerialTargetAplicado = null;
    ocrSerialsOriginais = new Set();
    ocrSerialsAplicados = new Set();
    ocrPartNumberTargetAplicado = null;
    ocrPartNumberOriginal = '';
    ocrPartNumberAplicado = null;
    ocrDiagnosticoAtual = null;
    document.getElementById('ocr-texto-etiqueta').value = '';
    document.getElementById('ocr-diagnostico').value = '';
    document.getElementById('ocr-diagnostico-container').hidden = true;
    document.getElementById('ocr-resultados').style.display = 'none';
    document.getElementById('ocr-status').textContent = '';
    document.getElementById('ocr-imagem-preview').removeAttribute('src');
    document.getElementById('input-foto-ocr').value = '';
    document.getElementById('btn-aplicar-ocr').disabled = true;
    abrirModal('modal-ocr');
}

function configurarOCR() {
    const btnCamera = document.getElementById('btn-iniciar-camera');
    const btnFoto = document.getElementById('btn-capturar-foto');
    const inputFoto = document.getElementById('input-foto-ocr');
    const video = document.getElementById('ocr-video');
    const imgPreview = document.getElementById('ocr-imagem-preview');
    const btnAplicar = document.getElementById('btn-aplicar-ocr');
    const btnCopiarDiagnostico = document.getElementById('btn-copiar-diagnostico-ocr');

    btnCamera?.addEventListener('click', async () => {
        if (ocrStream) {
            pararCameraOCR();
            return;
        }
        const requestId = ++ocrCameraRequestId;
        const status = document.getElementById('ocr-status');
        btnCamera.disabled = true;
        if (status) status.textContent = 'A pedir acesso à câmara...';
        try {
            const stream = await window.OCRManager.iniciarCamera(video);
            if (requestId !== ocrCameraRequestId) {
                window.OCRManager.pararCamera(stream);
                video.srcObject = null;
                return;
            }
            ocrStream = stream;
            video.style.display = 'block';
            imgPreview.style.display = 'none';
            btnFoto.style.display = 'inline-block';
            btnCamera.textContent = '⏹️ Parar Câmara';
            if (status) {
                const track = stream.getVideoTracks()[0];
                const settings = track?.getSettings();
                const resolucao = settings?.width && settings?.height ? ` (${settings.width}×${settings.height})` : '';
                status.textContent = `Câmara pronta${resolucao}. Enquadre a etiqueta com boa iluminação e foco.`;
            }
        } catch (e) {
            if (requestId !== ocrCameraRequestId) return;
            if (status) status.textContent = e.message || 'Não foi possível aceder à câmara.';
            mostrarNotificacao(e.message || 'Não foi possível aceder à câmara.', 'error');
        } finally {
            if (requestId === ocrCameraRequestId) btnCamera.disabled = false;
        }
    });

    btnFoto?.addEventListener('click', () => {
        if (!video) return;
        try {
            const canvas = window.OCRManager.capturar(video);
            imgPreview.src = canvas.toDataURL('image/jpeg', 0.95);
            imgPreview.style.display = 'block';
            pararCameraOCR();
            video.style.display = 'none';
            btnFoto.style.display = 'none';
            btnCamera.textContent = '📷 Iniciar Câmara';
            processarImagemOCR(canvas);
        } catch (error) {
            const status = document.getElementById('ocr-status');
            if (status) status.textContent = error.message;
            mostrarNotificacao(error.message || 'Não foi possível capturar a imagem.', 'error');
        }
    });

    inputFoto?.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (!file.type.startsWith('image/')) {
            mostrarNotificacao('Selecione um ficheiro de imagem válido.', 'error');
            inputFoto.value = '';
            return;
        }
        if (file.size > 10 * 1024 * 1024) {
            mostrarNotificacao('A imagem deve ter no máximo 10 MB.', 'error');
            inputFoto.value = '';
            return;
        }

        const reader = new FileReader();
        reader.onload = (evt) => {
            const img = new Image();
            img.onload = () => {
                imgPreview.src = evt.target.result;
                imgPreview.style.display = 'block';
                video.style.display = 'none';
                processarImagemOCR(img);
            };
            img.onerror = () => mostrarNotificacao('Não foi possível abrir a imagem selecionada.', 'error');
            img.src = evt.target.result;
        };
        reader.onerror = () => mostrarNotificacao('Não foi possível carregar a imagem selecionada.', 'error');
        reader.readAsDataURL(file);
    });

    document.getElementById('ocr-texto-etiqueta')?.addEventListener('input', () => {
        processarTextoOCR(false);
        aplicarResultadosOCR(false, false);
    });
    document.getElementById('btn-analisar-ocr')?.addEventListener('click', processarTextoOCR);
    btnCopiarDiagnostico?.addEventListener('click', copiarDiagnosticoOCR);

    btnAplicar?.addEventListener('click', () => aplicarResultadosOCR(true));

    document.querySelectorAll('[data-close-modal="modal-ocr"]').forEach(button =>
        button.addEventListener('click', pararCameraOCR)
    );
}

function aplicarResultadosOCR(fechar = false, mostrarAviso = true) {
    const serialTarget = state.ocrTarget === 'batch-serials'
        ? state.ocrTargetElement
        : state.ocrTarget === 'part-number'
            ? null
            : document.getElementById(state.ocrTarget);
    if (serialTarget) {
        if (ocrSerialTargetAplicado !== serialTarget) {
            ocrSerialTargetAplicado = serialTarget;
            ocrSerialsOriginais = new Set(
                serialTarget.value.split(/[\n,;]+/).map(value => value.trim().toLowerCase()).filter(Boolean)
            );
            ocrSerialsAplicados = new Set();
        }

        const atuais = serialTarget.value.split(/[\n,;]+/).map(value => value.trim()).filter(Boolean);
        const preservados = atuais.filter(value => !ocrSerialsAplicados.has(value.toLowerCase()));
        const existentes = new Set(preservados.map(value => value.toLowerCase()));
        const aplicadosAgora = new Set();
        state.ocrSerialsTemporarios.forEach(serial => {
            const chave = serial.toLowerCase();
            if (!existentes.has(chave)) {
                preservados.push(serial);
                existentes.add(chave);
            }
            if (!ocrSerialsOriginais.has(chave)) aplicadosAgora.add(chave);
        });
        serialTarget.value = preservados.join('\n');
        ocrSerialsAplicados = aplicadosAgora;
        serialTarget.dispatchEvent(new Event('input', { bubbles: true }));
    }

    if (state.ocrTarget === 'part-number') {
        const partNumberInput = document.getElementById('part-number');
        if (partNumberInput) {
            if (ocrPartNumberTargetAplicado !== partNumberInput) {
                ocrPartNumberTargetAplicado = partNumberInput;
                ocrPartNumberOriginal = partNumberInput.value;
                ocrPartNumberAplicado = null;
            } else if (
                ocrPartNumberAplicado !== null &&
                partNumberInput.value !== ocrPartNumberAplicado
            ) {
                ocrPartNumberOriginal = partNumberInput.value;
                ocrPartNumberAplicado = null;
            }

            if (state.ocrPnTemporario) {
                partNumberInput.value = state.ocrPnTemporario;
                ocrPartNumberAplicado = state.ocrPnTemporario;
                partNumberInput.dispatchEvent(new Event('input', { bubbles: true }));
            } else if (ocrPartNumberAplicado !== null) {
                partNumberInput.value = ocrPartNumberOriginal;
                ocrPartNumberAplicado = null;
                partNumberInput.dispatchEvent(new Event('input', { bubbles: true }));
            }
        }
    } else if (state.ocrPnTemporario) {
        if (state.ocrTarget === 'batch-serials') {
            const row = serialTarget?.closest('.batch-line');
            const model = state.equipamentos.find(eq =>
                String(eq.partNumber || eq.part_number).toLowerCase() === state.ocrPnTemporario.toLowerCase()
            );
            if (model && row) {
                const category = row.querySelector('[data-batch-category]');
                const modelSelect = row.querySelector('[data-batch-model]');
                if (category) category.value = model.categoria || '';
                if (modelSelect) {
                    preencherModelosLote(modelSelect);
                    modelSelect.value = model.id;
                    modelSelect.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }
        } else {
            const model = state.equipamentos.find(eq =>
                String(eq.partNumber || eq.part_number).toLowerCase() === state.ocrPnTemporario.toLowerCase()
            );
            const modelSelect = document.getElementById('select-equipamento');
            if (model && modelSelect) {
                modelSelect.value = model.id;
                modelSelect.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }
    }

    const encontrou = state.ocrSerialsTemporarios.length > 0 || Boolean(state.ocrPnTemporario);
    if (mostrarAviso) {
        mostrarNotificacao(
            encontrou ? 'Identificadores aplicados. Confirme os valores antes de guardar.' : 'Nenhum S/N ou P/N foi reconhecido.',
            encontrou ? 'success' : 'warning'
        );
    }
    if (fechar) {
        pararCameraOCR();
        fecharModal('modal-ocr');
    }
}

function atualizarDiagnosticoOCR(diagnostico) {
    ocrDiagnosticoAtual = diagnostico;
    const campo = document.getElementById('ocr-diagnostico');
    const container = document.getElementById('ocr-diagnostico-container');
    if (!campo || !container) return;

    campo.value = JSON.stringify({
        ...diagnostico,
        ambiente: {
            navegador: navigator.userAgent,
            idioma: navigator.language,
            contextoSeguro: window.isSecureContext
        }
    }, null, 2);
    container.hidden = false;
}

async function copiarDiagnosticoOCR() {
    const campo = document.getElementById('ocr-diagnostico');
    if (!campo?.value) {
        mostrarNotificacao('Ainda não há diagnóstico OCR para copiar.', 'warning');
        return;
    }

    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(campo.value);
        } else {
            campo.focus();
            campo.select();
            if (!document.execCommand('copy')) throw new Error('O navegador não permitiu copiar o texto.');
        }
        mostrarNotificacao('Diagnóstico copiado. Pode colá-lo aqui na conversa.', 'success');
    } catch (error) {
        console.error('Não foi possível copiar o diagnóstico OCR:', error);
        mostrarNotificacao('Não foi possível copiar automaticamente. Selecione e copie o texto do diagnóstico.', 'warning');
    }
}

async function processarImagemOCR(imagem) {
    if (ocrBusy) return;
    ocrBusy = true;
    const requestId = ocrRequestId;
    const status = document.getElementById('ocr-status');
    const btnFoto = document.getElementById('btn-capturar-foto');
    if (btnFoto) btnFoto.disabled = true;
    if (status) status.textContent = 'A preparar o motor OCR local...';

    try {
        const texto = await window.OCRManager.reconhecer(imagem, progresso => {
            if (!status) return;
            if (progresso.status === 'recognizing text') {
                status.textContent = `A reconhecer texto: ${Math.round(progresso.progress * 100)}%`;
            } else if (progresso.status) {
                status.textContent = progresso.status === 'loading language traineddata'
                    ? 'A descarregar o idioma OCR para utilização local...'
                    : `A preparar OCR: ${progresso.status}`;
            }
        }, diagnostico => {
            if (requestId === ocrRequestId) atualizarDiagnosticoOCR(diagnostico);
        });
        if (requestId !== ocrRequestId) return;
        document.getElementById('ocr-texto-etiqueta').value = texto;
        processarTextoOCR();
        aplicarResultadosOCR(false);
        if (status) status.textContent = 'Leitura concluída. Verifique os campos preenchidos antes de continuar.';
    } catch (error) {
        console.error('Erro ao reconhecer imagem da etiqueta:', error);
        if (requestId === ocrRequestId) {
            atualizarDiagnosticoOCR({
                estado: 'erro',
                motor: 'Tesseract.js',
                erro: { nome: error.name || 'Error', mensagem: error.message || String(error) },
                imagem: {
                    largura: imagem.naturalWidth || imagem.videoWidth || imagem.width || null,
                    altura: imagem.naturalHeight || imagem.videoHeight || imagem.height || null
                }
            });
        }
        if (status) status.textContent = 'Não foi possível reconhecer a imagem. Pode corrigir/colar o texto abaixo e analisar novamente.';
        mostrarNotificacao(error.message || 'Falha ao processar a imagem com OCR.', 'error');
    } finally {
        ocrBusy = false;
        if (btnFoto) btnFoto.disabled = false;
    }
}

function pararCameraOCR() {
    ocrCameraRequestId += 1;
    const video = document.getElementById('ocr-video');
    const stream = ocrStream || video?.srcObject;
    if (stream) window.OCRManager.pararCamera(stream);
    ocrStream = null;
    const button = document.getElementById('btn-iniciar-camera');
    const capture = document.getElementById('btn-capturar-foto');
    if (video) {
        video.pause();
        video.srcObject = null;
        video.style.display = 'none';
    }
    if (capture) capture.style.display = 'none';
    if (button) button.textContent = '📷 Iniciar Câmara';
    if (button) button.disabled = false;
}

function processarTextoOCR(mostrarAviso = true) {
    const texto = document.getElementById('ocr-texto-etiqueta').value;
    const painelResultados = document.getElementById('ocr-resultados');
    const elSerials = document.getElementById('ocr-serials-detectados');
    const elPn = document.getElementById('ocr-pn-detectados');
    const button = document.getElementById('btn-aplicar-ocr');
    const extraidos = window.OCRManager.extrair(texto);
    state.ocrSerialsTemporarios = extraidos.serials;
    state.ocrPnTemporario = extraidos.partNumbers[0] || '';
    if (ocrDiagnosticoAtual) {
        atualizarDiagnosticoOCR({
            ...ocrDiagnosticoAtual,
            textoAnalisadoAtual: texto,
            identificadoresAnalisados: extraidos
        });
    }

    if (painelResultados) painelResultados.style.display = 'block';
    if (elSerials) elSerials.textContent = extraidos.serials.join(', ') || 'Nenhum';
    if (elPn) elPn.textContent = extraidos.partNumbers.join(', ') || 'Nenhum';
    if (button) button.disabled = extraidos.serials.length === 0 && !extraidos.partNumbers.length;
    if (mostrarAviso) {
        mostrarNotificacao(
            extraidos.serials.length || extraidos.partNumbers.length
                ? 'Identificadores reconhecidos. Confirme os valores antes de aplicar.'
                : 'Não foram encontrados S/N ou P/N no texto.',
            extraidos.serials.length || extraidos.partNumbers.length ? 'info' : 'warning'
        );
    }
}

// ==========================================
// 10. Centro de Auditoria & Logs Forenses
// ==========================================

async function carregarAuditoria() {
    const corpo = document.getElementById('corpo-tabela-auditoria');
    if (!corpo) return;

    try {
        const acaoFiltro = document.getElementById('audit-filtro-acao')?.value || '';
        const buscaFiltro = document.getElementById('audit-filtro-busca')?.value || '';

        let url = `${API_URL}/audit-logs?limite=100`;
        if (acaoFiltro) url += `&acao=${encodeURIComponent(acaoFiltro)}`;
        if (buscaFiltro) url += `&operador=${encodeURIComponent(buscaFiltro)}`;
        const dataInicio = document.getElementById('audit-data-inicio')?.value || '';
        const dataFim = document.getElementById('audit-data-fim')?.value || '';
        if (dataInicio) url += `&dataInicio=${encodeURIComponent(`${dataInicio}T00:00:00`)}`;
        if (dataFim) url += `&dataFim=${encodeURIComponent(`${dataFim}T23:59:59`)}`;

        const res = await fetchComAutenticacao(url);
        if (!res || !res.ok) return;

        const logs = await res.json();
        state.auditoria = logs;

        corpo.innerHTML = '';
        if (logs.length === 0) {
            corpo.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:1.5rem;">Nenhum registo de auditoria encontrado.</td></tr>';
            return;
        }

        logs.forEach(l => {
            const tr = document.createElement('tr');
            const dataStr = l.criadoEm ? new Date(l.criadoEm).toLocaleString('pt-PT') : '-';
            const novosResumo = l.dadosNovos ? (typeof l.dadosNovos === 'object' ? JSON.stringify(l.dadosNovos) : l.dadosNovos) : '-';

            tr.innerHTML = `
                <td><small>${escapeHTML(dataStr)}</small></td>
                <td><strong>${escapeHTML(l.usuarioNome || l.usuarioEmail)}</strong></td>
                <td><small>${escapeHTML(l.usuarioPerfil || '-')}</small></td>
                <td><small>${escapeHTML(l.instituicaoNome || '-')}</small></td>
                <td><span class="badge-audit-acao">${escapeHTML(l.acao)}</span></td>
                <td><small>${escapeHTML(l.entidade)}</small></td>
                <td><code>${escapeHTML(l.ip || '127.0.0.1')}</code></td>
                <td><div class="audit-change" title="${escapeHTML(novosResumo)}"><small>${escapeHTML(novosResumo)}</small></div>${l.justificativa ? `<small class="audit-justification">Justificativa: ${escapeHTML(l.justificativa)}</small>` : ''}</td>
            `;
            corpo.appendChild(tr);
        });
    } catch (e) {
        console.error('Erro ao carregar auditoria:', e);
    }
}

// ==========================================
// 11. Exportações CSV com UTF-8 BOM para Excel
// ==========================================

async function descarregarCsvOficial(tipo) {
    try {
        mostrarNotificacao(`A gerar exportação CSV oficial (${tipo})...`, 'info');
        const token = localStorage.getItem('token');
        const res = await fetchComAutenticacao(`${API_URL}/export/${tipo}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res) return;
        if (!res.ok) {
            const erro = await res.json().catch(() => ({}));
            mostrarNotificacao(erro.error || 'Erro ao gerar ficheiro CSV.', 'error');
            return;
        }

        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `sgStock_${tipo}_${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);

        mostrarNotificacao('Exportação CSV gerada e descarregada com sucesso!', 'success');
    } catch (err) {
        console.error('Erro na exportação CSV:', err);
        mostrarNotificacao('Falha ao descarregar ficheiro CSV.', 'error');
    }
}

// ==========================================
// 12. Relatórios e Guias Dinâmicas Oficiais
// ==========================================

function preencherSelectItensRelatorio() {
    const tipo = document.getElementById('select-tipo-relatorio').value;
    const selectItem = document.getElementById('select-item-relatorio');
    const containerSelect = document.getElementById('container-select-item');
    const labelSelect = document.getElementById('label-select-item');

    selectItem.innerHTML = '';

    if (tipo === 'guia-saida') {
        containerSelect.style.display = 'flex';
        labelSelect.textContent = 'Selecione a Transferência de Saída:';
        state.historicoTransferencias.forEach(t => {
            const opt = document.createElement('option');
            opt.value = t.id;
            opt.textContent = `${t.dataHora} - ${t.equipamentoNome} (${t.origem} → ${t.destino})`;
            selectItem.appendChild(opt);
        });
    } else if (tipo === 'guia-recepcao') {
        containerSelect.style.display = 'flex';
        labelSelect.textContent = 'Selecione o Registo de Entrada / Recepção:';
        state.historicoEntradas.forEach(e => {
            const opt = document.createElement('option');
            opt.value = e.id;
            opt.textContent = `${e.dataHora} - ${e.equipamentoNome} (${e.instituicao})`;
            selectItem.appendChild(opt);
        });
    } else {
        containerSelect.style.display = 'none';
    }
}

function gerarPreviewRelatorio() {
    const tipo = document.getElementById('select-tipo-relatorio').value;
    const areaPreview = document.getElementById('area-preview-impressao');
    const signatarioNome = document.getElementById('input-signatario-nome')?.value || 'Victor Guambe';
    const signatarioCargo = document.getElementById('input-signatario-cargo')?.value.trim() || '';

    const dataHoje = new Date();
    const dataExtenso = `Maputo, ${dataHoje.getDate()} de ${dataHoje.toLocaleString('pt-PT', { month: 'long' })} de ${dataHoje.getFullYear()}`;

    let html = '';

    const cabecalhoOficial = `
        <div class="guia-header">
            <img src="${escapeHTML(EMBLEMA_MOCAMBIQUE_URL)}" class="emblema" alt="Emblema de Moçambique">
            <h4>República de Moçambique</h4>
            <h4>Ministério das Comunicações e Transformação Digital</h4>
            <h4>Direcção de Administração e Recursos Humanos</h4>
            <h4>Rede de Instituições de Ensino Superior e de Investigação de Moçambique (MoRENet)</h4>
        </div>
    `;

    if (tipo === 'guia-saida') {
        const transfId = document.getElementById('select-item-relatorio').value;
        const transf = state.historicoTransferencias.find(t => t.id === transfId) || state.historicoTransferencias[0];

        if (!transf) {
            areaPreview.innerHTML = '<p style="text-align:center; padding:2rem;">Nenhuma transferência selecionada.</p>';
            return;
        }

        const serialsList = Array.isArray(transf.serials) ? transf.serials : [];
        const serialsFormatted = serialsList.map(s => escapeHTML(s)).join('<br>');

        html = `
            <div class="guia-container">
                ${cabecalhoOficial}
                <div class="guia-titulo">Guia de Saída Oficial</div>
                <div class="guia-assunto"><strong>Assunto:</strong> Autorização de Saída e Transporte de Equipamento de Telecomunicações</div>
                <div class="guia-texto">
                    Declara-se para os devidos efeitos legais e patrimoniais que o equipamento abaixo discriminado, pertencente à infraestrutura tecnológica da MoRENet, encontra-se devidamente autorizado a ser retirado das instalações do <strong>${escapeHTML(transf.origem)}</strong> com destino às instalações da <strong>${escapeHTML(transf.destino)}</strong>.
                </div>
                <h4 style="margin-top:1rem; font-weight:bold;">1. Especificações do Equipamento</h4>
                <table class="guia-tabela">
                    <thead><tr><th>Designação</th><th>Quantidade</th><th>Números de Série (S/N)</th></tr></thead>
                    <tbody>
                        <tr>
                            <td><strong>${escapeHTML(transf.equipamentoNome)}</strong></td>
                            <td>${Number(transf.quantidade) || serialsList.length} unidade(s)</td>
                            <td><div class="destaque-sn" style="display:inline-block;">${serialsFormatted || 'N/A'}</div></td>
                        </tr>
                    </tbody>
                </table>
                <div class="guia-texto">
                    O referido equipamento segue acondicionado em embalagem própria, acompanhado dos seus acessórios essenciais para montagem no bastidor e testes de ativação de tráfego.
                </div>
                <div style="margin-top: 1.5rem; text-align: center;">${dataExtenso}</div>
                <div class="guia-assinaturas">
                    <div class="guia-assinatura-box">
                        <div>Entregue por (Património):</div>
                        <div class="guia-espaco-assinatura"></div>
                        <div class="guia-linha-nome"></div>
                    </div>
                    <div class="guia-assinatura-box">
                        <div>Autorizado por ${signatarioCargo ? `(${escapeHTML(signatarioCargo)})` : ''}</div>
                        <div class="guia-espaco-assinatura"></div>
                        <div class="guia-linha-nome"><strong>${escapeHTML(signatarioNome)}</strong></div>
                    </div>
                </div>
            </div>
        `;
    } else if (tipo === 'guia-recepcao') {
        const entId = document.getElementById('select-item-relatorio').value;
        const ent = state.historicoEntradas.find(e => e.id === entId) || state.historicoEntradas[0];

        if (!ent) {
            areaPreview.innerHTML = '<p style="text-align:center; padding:2rem;">Nenhum registo de entrada selecionado.</p>';
            return;
        }

        const serialsList = Array.isArray(ent.serials) ? ent.serials : [];
        const serialsFormatted = serialsList.map(s => escapeHTML(s)).join('<br>');

        html = `
            <div class="guia-container">
                ${cabecalhoOficial}
                <div class="guia-titulo">Guia de Recepção e Entrada de Ativos</div>
                <div class="guia-assunto"><strong>Assunto:</strong> Confirmação de Recepção Técnica de Equipamentos de Rede</div>
                <div class="guia-texto">
                    Certifica-se a entrada e incorporação no património tecnológico da <strong>${escapeHTML(ent.instituicao)}</strong> dos ativos abaixo descritos, provenientes do fornecedor <strong>${escapeHTML(ent.fornecedorNome || 'Aquisição MoRENet')}</strong>, sob a fatura/documento nº <strong>${escapeHTML(ent.faturaNumero || 'S/N')}</strong>.
                </div>
                <table class="guia-tabela" style="margin-top:1rem;">
                    <thead><tr><th>Equipamento</th><th>Qtd</th><th>Estado Físico</th><th>Números de Série (S/N)</th></tr></thead>
                    <tbody>
                        <tr>
                            <td><strong>${escapeHTML(ent.equipamentoNome)}</strong></td>
                            <td>${Number(ent.quantidade) || serialsList.length}</td>
                            <td>${escapeHTML(ent.estadoFisico || 'Novo')}</td>
                            <td><div class="destaque-sn" style="display:inline-block;">${serialsFormatted || 'N/A'}</div></td>
                        </tr>
                    </tbody>
                </table>
                <div class="guia-texto">
                    Os equipamentos foram conferidos, inspecionados visualmente e encontram-se em perfeitas condições operacionais para homologação e registo no SGStock.
                </div>
                <div style="margin-top: 1.5rem; text-align: center;">${dataExtenso}</div>
                <div class="guia-assinaturas">
                    <div class="guia-assinatura-box">
                        <div>Recebido e Conferido por:</div>
                        <div class="guia-espaco-assinatura"></div>
                        <div class="guia-linha-nome"><strong>${escapeHTML(signatarioNome)}</strong></div>
                    </div>
                </div>
            </div>
        `;
    } else if (tipo === 'inventario') {
        html = `
            <h2>Relatório de Inventário Completo (Stock Atual)</h2>
            <p>Emitido em: ${escapeHTML(new Date().toLocaleString('pt-PT'))}</p><br>
            <table class="guia-tabela">
                <thead><tr><th>Marca / Modelo</th><th>Part Number</th><th>Categoria</th><th>Instituição</th><th>S/N</th><th>Total</th></tr></thead>
                <tbody>
        `;
        (state.stockConsolidado || []).forEach(item => {
            const serials = Array.isArray(item.serials) ? item.serials.join(' | ') : item.serials;
            html += `<tr><td>${escapeHTML(item.marca)} ${escapeHTML(item.modelo)}</td><td>${escapeHTML(item.partNumber || item.part_number)}</td><td>${escapeHTML(item.categoria || '-')}</td><td>${escapeHTML(item.instituicao || item.local_atual)}</td><td><small>${escapeHTML(serials)}</small></td><td><strong>${Number(item.total) || 0}</strong></td></tr>`;
        });
        html += `</tbody></table>`;
    }

    areaPreview.innerHTML = html;
}

function executarImpressao() {
    const preview = document.getElementById('area-preview-impressao');
    if (!preview || !preview.innerHTML.trim()) {
        mostrarNotificacao('Não há documento para imprimir.', 'error');
        return;
    }

    document.body.classList.add('imprimir-apenas-documento');
    window.addEventListener('afterprint', () => {
        document.body.classList.remove('imprimir-apenas-documento');
    }, { once: true });
    window.print();
}

// ==========================================
// 13. Modais, Formulários & Eventos
// ==========================================

function abrirModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    modal.style.display = 'flex';

    if (modalId === 'modal-transferencia') {
        atualizarSeriaisDisponiveisTransf();
    } else if (modalId === 'modal-entrada-lote' && !document.querySelector('.batch-line')) {
        adicionarLinhaLote();
    } else if (modalId === 'modal-fornecedor' && !state.editingFornecedorId) {
        document.getElementById('form-fornecedor')?.reset();
        document.getElementById('titulo-modal-fornecedor').textContent = 'Novo fornecedor';
    } else if (modalId === 'modal-instituicao' && !state.editingInstituicaoId) {
        document.getElementById('form-instituicao')?.reset();
        document.getElementById('titulo-modal-instituicao').textContent = 'Nova instituição';
    } else if (modalId === 'modal-modelo' && !state.editingEquipamentoId) {
        document.getElementById('form-equipamento')?.reset();
        document.getElementById('titulo-modal-modelo').textContent = 'Cadastrar Modelo de Equipamento de Rede';
        document.getElementById('btn-submeter-modelo').textContent = 'Cadastrar Modelo de Engenharia';
        document.getElementById('secao-aquisicao-inicial').hidden = false;
        ['modelo-fatura', 'modelo-fornecedor', 'modelo-custo', 'modelo-data-aquisicao']
            .forEach(id => { document.getElementById(id).required = true; });
        const today = new Date();
        document.getElementById('modelo-data-aquisicao').value =
            `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    }
}

function fecharModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.style.display = 'none';

    if (modalId === 'modal-ocr') {
        ocrRequestId += 1;
        pararCameraOCR();
    }
    if (modalId === 'modal-fornecedor') state.editingFornecedorId = null;
    if (modalId === 'modal-instituicao') state.editingInstituicaoId = null;
    if (modalId === 'modal-modelo') state.editingEquipamentoId = null;
}

function abrirModalEditarModelo(modelo) {
    const form = document.getElementById('form-equipamento');
    if (!form) return;
    form.reset();
    state.editingEquipamentoId = modelo.id;
    document.getElementById('marca').value = modelo.marca || '';
    document.getElementById('modelo').value = modelo.modelo || '';
    document.getElementById('part-number').value = modelo.partNumber || modelo.part_number || '';
    document.getElementById('modelo-categoria').value = modelo.categoria || 'outro';
    document.getElementById('modelo-portas').value = modelo.portas || '';
    document.getElementById('modelo-banda').value = modelo.capacidadeBanda || modelo.capacidade_banda || '';
    document.getElementById('modelo-vida-util').value = modelo.vidaUtilAnos || modelo.vida_util_anos || 5;
    document.getElementById('modelo-fibra').checked = Boolean(modelo.fibraEscura || modelo.fibra_escura);
    ['modelo-fatura', 'modelo-fornecedor', 'modelo-custo', 'modelo-data-aquisicao']
        .forEach(id => { document.getElementById(id).required = false; });
    document.getElementById('secao-aquisicao-inicial').hidden = true;
    document.getElementById('titulo-modal-modelo').textContent = 'Editar Modelo de Equipamento';
    document.getElementById('btn-submeter-modelo').textContent = 'Guardar Alterações';
    abrirModal('modal-modelo');
}

function abrirModalEliminarSeriais(equipamentoId, nomeEquipamento, instituicao, serials) {
    const select = document.getElementById('eliminar-serial-valor');
    if (!select) return;
    select.replaceChildren(...serials.map(serial => {
        const option = document.createElement('option');
        option.value = serial;
        option.textContent = serial;
        return option;
    }));
    document.getElementById('eliminar-serial-equipamento-id').value = equipamentoId;
    document.getElementById('eliminar-serial-instituicao').value = instituicao;
    document.getElementById('eliminar-serial-descricao').textContent =
        `${nomeEquipamento} — ${instituicao}. Selecione o serial a remover.`;
    abrirModal('modal-eliminar-serial');
}

function mudarAba(tabId) {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

    const btnAtivo = document.querySelector(`[data-tab="${tabId}"]`);
    const abaAtiva = document.getElementById(tabId);

    if (btnAtivo) btnAtivo.classList.add('active');
    if (abaAtiva) abaAtiva.classList.add('active');

    if (tabId === 'tab-relatorios') {
        preencherSelectItensRelatorio();
        gerarPreviewRelatorio();
    } else if (tabId === 'tab-auditoria') {
        carregarAuditoria();
    } else if (tabId === 'tab-usuarios') {
        carregarUsuarios();
    } else if (tabId === 'tab-cadastros') {
        atualizarTabelasCadastros();
    }
}

function adicionarLinhaLote() {
    const template = document.getElementById('template-linha-lote');
    const container = document.getElementById('linhas-entrada-lote');
    if (!template || !container) return;
    const linha = template.content.firstElementChild.cloneNode(true);
    container.appendChild(linha);
    preencherModelosLote(linha.querySelector('[data-batch-model]'));
}

function abrirModalEstadoAtivo(equipamentoId, serials) {
    const select = document.getElementById('estado-serial');
    document.getElementById('estado-equipamento-id').value = equipamentoId;
    select.innerHTML = '';
    serials.forEach(serial => {
        const option = document.createElement('option');
        option.value = serial;
        option.textContent = serial;
        select.appendChild(option);
    });
    document.getElementById('estado-justificativa').value = '';
    abrirModal('modal-estado-ativo');
}

function atualizarTabelasCadastros() {
    const fornecedores = document.getElementById('corpo-tabela-fornecedores');
    if (fornecedores) {
        fornecedores.innerHTML = state.fornecedores.length
            ? state.fornecedores.map(item => `
                <tr>
                    <td>${escapeHTML(item.nome_empresa || item.nome)}</td>
                    <td>${escapeHTML(item.pessoa_contacto || item.contacto || '-')}</td>
                    <td>${escapeHTML(item.email || '-')}</td>
                    <td>${escapeHTML(item.telefone || '-')}</td>
                    <td>${escapeHTML(item.nif || item.nuit || '-')}</td>
                    <td class="table-actions">
                        <button class="btn btn-sm btn-outline" data-edit-fornecedor="${escapeHTML(item.id)}">Editar</button>
                        <button class="btn btn-sm btn-danger" data-delete-fornecedor="${escapeHTML(item.id)}">Inativar</button>
                    </td>
                </tr>`).join('')
            : '<tr><td colspan="6" class="empty-state">Nenhum fornecedor ativo.</td></tr>';
    }

    const instituicoes = document.getElementById('corpo-tabela-instituicoes');
    if (instituicoes) {
        instituicoes.innerHTML = state.instituicoes.length
            ? state.instituicoes.map(item => `
                <tr>
                    <td>${escapeHTML(item.nome)}</td>
                    <td>${escapeHTML(item.sigla || item.codigo || '-')}</td>
                    <td>${escapeHTML(item.provincia || '-')}</td>
                    <td>${escapeHTML(item.email || '-')}</td>
                    <td>${escapeHTML(item.telefone || '-')}</td>
                    <td class="table-actions">
                        <button class="btn btn-sm btn-outline" data-edit-instituicao="${escapeHTML(item.id)}">Editar</button>
                        <button class="btn btn-sm btn-danger" data-delete-instituicao="${escapeHTML(item.id)}">Inativar</button>
                    </td>
                </tr>`).join('')
            : '<tr><td colspan="6" class="empty-state">Nenhuma instituição ativa.</td></tr>';
    }
}

async function carregarUsuarios() {
    const corpo = document.getElementById('corpo-tabela-usuarios');
    const aviso = document.getElementById('aviso-lista-usuarios');
    if (!corpo || state.usuarioAtual?.perfil !== 'administrador') return;
    try {
        const res = await fetchComAutenticacao(`${API_URL}/usuarios`);
        if (!res) return;
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            corpo.innerHTML = '<tr><td colspan="5" class="empty-state">A lista de utilizadores não está disponível.</td></tr>';
            if (aviso) aviso.textContent = res.status === 404
                ? 'O backend ainda não disponibiliza GET /api/usuarios; a reposição de senha continua disponível pela rota administrativa.'
                : (data.error || 'Não foi possível carregar os utilizadores.');
            return;
        }
        state.usuarios = await res.json();
        if (aviso) aviso.textContent = '';
        corpo.innerHTML = state.usuarios.length
            ? state.usuarios.map(usuario => `
                <tr>
                    <td>${escapeHTML(usuario.nome || '-')}</td>
                    <td>${escapeHTML(usuario.email || '-')}</td>
                    <td>${escapeHTML(usuario.perfil || '-')}</td>
                    <td>${escapeHTML(usuario.instituicao_nome || usuario.instituicaoNome || '-')}</td>
                    <td><button class="btn btn-sm btn-outline" data-reset-password="${escapeHTML(usuario.id)}" data-user-label="${escapeHTML(usuario.nome || usuario.email)}">Repor senha</button></td>
                </tr>`).join('')
            : '<tr><td colspan="5" class="empty-state">Nenhum utilizador encontrado.</td></tr>';
    } catch (error) {
        console.error('Erro ao carregar utilizadores:', error);
        if (aviso) aviso.textContent = 'Erro de ligação ao carregar os utilizadores.';
    }
}

async function inativarRegisto(tipo, id) {
    const nome = tipo === 'fornecedores' ? 'fornecedor' : 'instituição';
    const confirmado = await confirmarAcao(`Inativar este ${nome}? O histórico associado será preservado.`, `Inativar ${nome}`);
    if (!confirmado) return;
    try {
        const res = await fetchComAutenticacao(`${API_URL}/${tipo}/${encodeURIComponent(id)}`, { method: 'DELETE' });
        if (!res) return;
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            mostrarNotificacao(data.error || `Não foi possível inativar ${nome}.`, 'error');
            return;
        }
        mostrarNotificacao(`${nome[0].toUpperCase()}${nome.slice(1)} inativado.`, 'success');
        await carregarDadosDaBD();
    } catch (error) {
        console.error(`Erro ao inativar ${nome}:`, error);
        mostrarNotificacao(`Erro de rede ao inativar ${nome}.`, 'error');
    }
}

function atualizarSeriaisDisponiveisTransf() {
    const eqId = document.getElementById('select-equipamento-transf')?.value;
    const origem = document.getElementById('origem-transf')?.value;
    const selectSerials = document.getElementById('serials-transf');

    if (!selectSerials) return;
    selectSerials.innerHTML = '';

    if (!eqId || !origem) {
        selectSerials.innerHTML = '<option disabled selected>Selecione o equipamento e a origem...</option>';
        return;
    }

    const item = state.stockConsolidado.find(s =>
        String(s.equipamentoId || s.equipamento_id) === String(eqId) &&
        String(s.instituicao || s.local_atual).trim().toLowerCase() === String(origem).trim().toLowerCase()
    );

    const disponiveis = (item && Array.isArray(item.serials)) ? item.serials : [];

    if (disponiveis.length === 0) {
        selectSerials.innerHTML = '<option disabled>Nenhum Serial Number disponível neste local</option>';
        return;
    }

    disponiveis.forEach(sn => {
        const opt = document.createElement('option');
        opt.value = sn;
        opt.textContent = sn;
        selectSerials.appendChild(opt);
    });
}

function configurarNavegacao() {
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tabId = btn.getAttribute('data-tab');
            mudarAba(tabId);
            document.getElementById('sidebar')?.classList.remove('active');
            document.querySelector('.sidebar-overlay')?.classList.remove('active');
        });
    });
}

function configurarAcoesInterface() {
    document.addEventListener('click', (e) => {
        const target = e.target.closest('[data-action], [data-open-modal], [data-close-modal], [data-saude-filter], [data-ocr-target], [data-remove-batch-line], [data-edit-fornecedor], [data-delete-fornecedor], [data-edit-instituicao], [data-delete-instituicao], [data-edit-modelo], [data-delete-modelo], [data-reset-password], [data-asset-navigation]');
        if (!target) return;

        if (target.dataset.assetNavigation) {
            navegarParaAtivo(target.dataset.assetSerial);
        } else if (target.dataset.ocrTarget) {
            window.OCRManager.abrir(target.dataset.ocrTarget, target);
        } else if (target.hasAttribute('data-remove-batch-line')) {
            const linhas = document.querySelectorAll('.batch-line');
            if (linhas.length <= 1) {
                mostrarNotificacao('A fatura deve conter pelo menos um modelo.', 'warning');
                return;
            }
            target.closest('.batch-line')?.remove();
        } else if (target.dataset.editFornecedor) {
            const fornecedor = state.fornecedores.find(item => item.id === target.dataset.editFornecedor);
            if (!fornecedor) return;
            state.editingFornecedorId = fornecedor.id;
            document.getElementById('fornecedor-id').value = fornecedor.id;
            document.getElementById('fornecedor-nome').value = fornecedor.nome_empresa || fornecedor.nome || '';
            document.getElementById('fornecedor-contacto').value = fornecedor.pessoa_contacto || fornecedor.contacto || '';
            document.getElementById('fornecedor-telefone').value = fornecedor.telefone || '';
            document.getElementById('fornecedor-email').value = fornecedor.email || '';
            document.getElementById('fornecedor-nif').value = fornecedor.nif || fornecedor.nuit || '';
            document.getElementById('fornecedor-endereco').value = fornecedor.endereco || '';
            document.getElementById('titulo-modal-fornecedor').textContent = 'Editar fornecedor';
            abrirModal('modal-fornecedor');
        } else if (target.dataset.deleteFornecedor) {
            inativarRegisto('fornecedores', target.dataset.deleteFornecedor);
        } else if (target.dataset.editInstituicao) {
            const instituicao = state.instituicoes.find(item => item.id === target.dataset.editInstituicao);
            if (!instituicao) return;
            state.editingInstituicaoId = instituicao.id;
            document.getElementById('instituicao-id').value = instituicao.id;
            document.getElementById('instituicao-nome').value = instituicao.nome || '';
            document.getElementById('instituicao-sigla').value = instituicao.sigla || instituicao.codigo || '';
            document.getElementById('instituicao-provincia').value = instituicao.provincia || '';
            document.getElementById('instituicao-email').value = instituicao.email || '';
            document.getElementById('instituicao-telefone').value = instituicao.telefone || '';
            document.getElementById('instituicao-endereco').value = instituicao.endereco || '';
            document.getElementById('titulo-modal-instituicao').textContent = 'Editar instituição';
            abrirModal('modal-instituicao');
        } else if (target.dataset.deleteInstituicao) {
            inativarRegisto('instituicoes', target.dataset.deleteInstituicao);
        } else if (target.dataset.editModelo) {
            const modelo = state.equipamentos.find(item => String(item.id) === target.dataset.editModelo);
            if (modelo) abrirModalEditarModelo(modelo);
        } else if (target.dataset.deleteModelo) {
            eliminarModelo(target.dataset.deleteModelo);
        } else if (target.dataset.resetPassword) {
            document.getElementById('repor-senha-usuario-id').value = target.dataset.resetPassword;
            document.getElementById('repor-senha-utilizador').textContent = `Nova senha para ${target.dataset.userLabel || 'utilizador'}`;
            document.getElementById('form-repor-senha').reset();
            document.getElementById('repor-senha-usuario-id').value = target.dataset.resetPassword;
            abrirModal('modal-repor-senha');
        } else if (target.dataset.openModal) {
            if (target.dataset.openModal === 'modal-ocr') window.OCRManager.abrir();
            else abrirModal(target.dataset.openModal);
        } else if (target.dataset.closeModal) {
            fecharModal(target.dataset.closeModal);
        } else if (target.dataset.action === 'toggle-sidebar') {
            document.getElementById('sidebar')?.classList.toggle('active');
            document.querySelector('.sidebar-overlay')?.classList.toggle('active');
        } else if (target.dataset.action === 'logout') {
            logout();
        } else if (target.dataset.action === 'open-reports') {
            mudarAba('tab-relatorios');
        } else if (target.dataset.action === 'print-report') {
            executarImpressao();
        } else if (target.dataset.saudeFilter) {
            document.querySelectorAll('.btn-filter-health').forEach(b => b.classList.remove('active'));
            target.classList.add('active');
            state.filtroSaudeAtivo = target.dataset.saudeFilter;
            atualizarTabelaAssetHealth();
        }
    });

    document.addEventListener('keydown', event => {
        if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('[data-asset-navigation]')) {
            event.preventDefault();
            navegarParaAtivo(event.target.dataset.assetSerial);
        }
    });

    document.getElementById('search-inventario')?.addEventListener('input', filtrarInventario);
    document.getElementById('btn-adicionar-linha-lote')?.addEventListener('click', adicionarLinhaLote);
    document.getElementById('linhas-entrada-lote')?.addEventListener('change', event => {
        if (event.target.matches('[data-batch-category]')) {
            preencherModelosLote(event.target.closest('.batch-line')?.querySelector('[data-batch-model]'));
        }
    });
    document.getElementById('select-tipo-relatorio')?.addEventListener('change', () => {
        preencherSelectItensRelatorio();
        gerarPreviewRelatorio();
    });
    document.getElementById('select-item-relatorio')?.addEventListener('change', gerarPreviewRelatorio);
    document.getElementById('input-signatario-nome')?.addEventListener('input', gerarPreviewRelatorio);
    document.getElementById('input-signatario-cargo')?.addEventListener('input', gerarPreviewRelatorio);

    // Exportações CSV
    document.getElementById('btn-exportar-inventario-csv')?.addEventListener('click', () => descarregarCsvOficial('inventario'));
    document.getElementById('btn-exportar-entradas-csv')?.addEventListener('click', () => descarregarCsvOficial('entradas'));
    document.getElementById('btn-exportar-transf-csv')?.addEventListener('click', () => descarregarCsvOficial('transferencias'));
    document.getElementById('btn-exportar-auditoria-csv')?.addEventListener('click', () => descarregarCsvOficial('auditoria'));

    // Botão de Backup de Auditoria por E-mail
    document.getElementById('btn-backup-auditoria-email')?.addEventListener('click', async () => {
        const conf = await confirmarAcao('Deseja enviar um backup completo de todos os logs de auditoria para o e-mail oficial configurado?', 'Disparar Backup');
        if (!conf) return;

        try {
            mostrarNotificacao('A gerar e enviar backup por e-mail...', 'info');
            const res = await fetchComAutenticacao(`${API_URL}/auditoria/backup-email`, { method: 'POST' });
            if (res && res.ok) {
                mostrarNotificacao('Backup de auditoria enviado com sucesso para o e-mail!', 'success');
            } else {
                mostrarNotificacao('Falha ao enviar backup por e-mail.', 'error');
            }
        } catch (e) {
            mostrarNotificacao('Erro ao conectar com o serviço de e-mail.', 'error');
        }
    });

    // Impressão da Etiqueta QR
    document.getElementById('btn-imprimir-etiqueta')?.addEventListener('click', () => {
        document.body.classList.add('imprimir-apenas-etiqueta');
        window.addEventListener('afterprint', () => {
            document.body.classList.remove('imprimir-apenas-etiqueta');
        }, { once: true });
        window.print();
    });

    // Recarregar Auditoria
    document.getElementById('btn-recarregar-auditoria')?.addEventListener('click', carregarAuditoria);
    document.getElementById('audit-filtro-acao')?.addEventListener('change', carregarAuditoria);
    document.getElementById('audit-filtro-busca')?.addEventListener('input', carregarAuditoria);
    document.getElementById('audit-data-inicio')?.addEventListener('change', carregarAuditoria);
    document.getElementById('audit-data-fim')?.addEventListener('change', carregarAuditoria);
    document.getElementById('btn-recarregar-usuarios')?.addEventListener('click', carregarUsuarios);

    // Seleção dinâmica no modal de transferência
    document.getElementById('select-equipamento-transf')?.addEventListener('change', () => {
        const eqId = document.getElementById('select-equipamento-transf').value;
        const selOrigem = document.getElementById('origem-transf');
        if (!selOrigem) return;

        selOrigem.innerHTML = '<option value="">-- Selecione a origem --</option>';
        const locaisComStock = state.stockConsolidado.filter(s => String(s.equipamentoId || s.equipamento_id) === String(eqId) && (Number(s.total) || 0) > 0);

        locaisComStock.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s.instituicao || s.local_atual;
            opt.textContent = `${s.instituicao || s.local_atual} (${s.total} un.)`;
            selOrigem.appendChild(opt);
        });

        atualizarSeriaisDisponiveisTransf();
    });

    document.getElementById('origem-transf')?.addEventListener('change', atualizarSeriaisDisponiveisTransf);
}

function configurarFormularios() {
    document.getElementById('form-eliminar-serial')?.addEventListener('submit', async event => {
        event.preventDefault();
        const equipamentoId = document.getElementById('eliminar-serial-equipamento-id').value;
        const instituicao = document.getElementById('eliminar-serial-instituicao').value;
        const serial = document.getElementById('eliminar-serial-valor').value;
        const confirmado = await confirmarAcao(
            `Remover o S/N ${serial} do inventário de ${instituicao}? O histórico associado a este serial será afetado.`,
            'Remover equipamento'
        );
        if (!confirmado) return;
        try {
            const res = await fetchComAutenticacao(`${API_URL}/stock/${encodeURIComponent(equipamentoId)}/serial`, {
                method: 'DELETE',
                body: JSON.stringify({ serial, instituicao })
            });
            if (!res) return;
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                mostrarNotificacao(data.error || 'Não foi possível remover o equipamento.', 'error');
                return;
            }
            fecharModal('modal-eliminar-serial');
            mostrarNotificacao(data.message || 'Equipamento removido do inventário.', 'success');
            await carregarDadosDaBD();
        } catch (error) {
            console.error('Erro ao remover serial do inventário:', error);
            mostrarNotificacao('Erro de rede ao remover o equipamento.', 'error');
        }
    });

    document.getElementById('form-entrada-lote')?.addEventListener('submit', async event => {
        event.preventDefault();
        const linhas = [...document.querySelectorAll('.batch-line')];
        const modelos = linhas.map(linha => ({
            equipamentoId: linha.querySelector('[data-batch-model]').value,
            custoUnitario: linha.querySelector('[data-batch-cost]').value,
            estadoFisico: linha.querySelector('[data-batch-state]').value,
            serials: linha.querySelector('[data-batch-serials]').value.split(/[\n,;]+/).map(value => value.trim()).filter(Boolean)
        }));
        const payload = {
            faturaNumero: document.getElementById('lote-fatura').value.trim(),
            fornecedorId: document.getElementById('lote-fornecedor').value,
            dataAquisicao: document.getElementById('lote-data').value,
            instituicaoId: document.getElementById('lote-instituicao').value,
            observacoes: document.getElementById('lote-observacoes').value.trim(),
            modelos
        };
        const submitButton = document.getElementById('btn-submeter-entrada-lote');
        setButtonLoading(submitButton, true, 'A registar fatura...');
        try {
            const res = await fetchComAutenticacao(`${API_URL}/entradas-lote`, {
                method: 'POST',
                body: JSON.stringify(payload)
            });
            if (!res) return;
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                mostrarNotificacao(data.error || 'Não foi possível registar a fatura.', 'error');
                return;
            }
            mostrarNotificacao(`Fatura registada. ${data.qrCodes?.length || 0} etiquetas QR geradas.`, 'success');
            document.getElementById('form-entrada-lote').reset();
            document.getElementById('linhas-entrada-lote').replaceChildren();
            fecharModal('modal-entrada-lote');
            await carregarDadosDaBD();
        } catch (error) {
            console.error('Erro ao registar entrada em lote:', error);
            mostrarNotificacao('Erro de rede ao registar a fatura.', 'error');
        } finally {
            setButtonLoading(submitButton, false);
        }
    });

    document.getElementById('form-estado-ativo')?.addEventListener('submit', async event => {
        event.preventDefault();
        const equipamentoId = document.getElementById('estado-equipamento-id').value;
        const serialNumber = document.getElementById('estado-serial').value;
        const estado = document.getElementById('estado-novo').value;
        const justificativa = document.getElementById('estado-justificativa').value.trim();
        if (!justificativa) {
            mostrarNotificacao('A justificativa é obrigatória.', 'error');
            return;
        }
        try {
            const res = await fetchComAutenticacao(`${API_URL}/equipamentos/${encodeURIComponent(equipamentoId)}/estado`, {
                method: 'PUT',
                body: JSON.stringify({ serialNumber, estado, justificativa })
            });
            if (!res) return;
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                mostrarNotificacao(data.error || 'Não foi possível alterar o estado.', 'error');
                return;
            }
            mostrarNotificacao(data.message || 'Estado alterado e auditado.', 'success');
            fecharModal('modal-estado-ativo');
            await carregarDadosDaBD();
        } catch (error) {
            console.error('Erro ao alterar estado físico:', error);
            mostrarNotificacao('Erro de rede ao alterar o estado.', 'error');
        }
    });

    document.getElementById('form-fornecedor')?.addEventListener('submit', async event => {
        event.preventDefault();
        const id = state.editingFornecedorId;
        const payload = {
            nome_empresa: document.getElementById('fornecedor-nome').value.trim(),
            pessoa_contacto: document.getElementById('fornecedor-contacto').value.trim(),
            telefone: document.getElementById('fornecedor-telefone').value.trim(),
            email: document.getElementById('fornecedor-email').value.trim(),
            nif: document.getElementById('fornecedor-nif').value.trim(),
            endereco: document.getElementById('fornecedor-endereco').value.trim()
        };
        try {
            const res = await fetchComAutenticacao(`${API_URL}/fornecedores${id ? `/${encodeURIComponent(id)}` : ''}`, {
                method: id ? 'PUT' : 'POST',
                body: JSON.stringify(payload)
            });
            if (!res) return;
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                mostrarNotificacao(data.error || 'Não foi possível guardar o fornecedor.', 'error');
                return;
            }
            state.editingFornecedorId = null;
            fecharModal('modal-fornecedor');
            mostrarNotificacao('Fornecedor guardado com sucesso.', 'success');
            await carregarDadosDaBD();
        } catch (error) {
            console.error('Erro ao guardar fornecedor:', error);
            mostrarNotificacao('Erro de rede ao guardar fornecedor.', 'error');
        }
    });

    document.getElementById('form-instituicao')?.addEventListener('submit', async event => {
        event.preventDefault();
        const id = state.editingInstituicaoId;
        const payload = {
            nome: document.getElementById('instituicao-nome').value.trim(),
            sigla: document.getElementById('instituicao-sigla').value.trim(),
            provincia: document.getElementById('instituicao-provincia').value.trim(),
            email: document.getElementById('instituicao-email').value.trim(),
            telefone: document.getElementById('instituicao-telefone').value.trim(),
            endereco: document.getElementById('instituicao-endereco').value.trim()
        };
        try {
            const res = await fetchComAutenticacao(`${API_URL}/instituicoes${id ? `/${encodeURIComponent(id)}` : ''}`, {
                method: id ? 'PUT' : 'POST',
                body: JSON.stringify(payload)
            });
            if (!res) return;
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                mostrarNotificacao(data.error || 'Não foi possível guardar a instituição.', 'error');
                return;
            }
            state.editingInstituicaoId = null;
            fecharModal('modal-instituicao');
            mostrarNotificacao('Instituição guardada com sucesso.', 'success');
            await carregarDadosDaBD();
        } catch (error) {
            console.error('Erro ao guardar instituição:', error);
            mostrarNotificacao('Erro de rede ao guardar instituição.', 'error');
        }
    });

    document.getElementById('form-repor-senha')?.addEventListener('submit', async event => {
        event.preventDefault();
        const id = document.getElementById('repor-senha-usuario-id').value;
        const novaSenha = document.getElementById('repor-senha-nova').value;
        if (novaSenha.length < 8) {
            mostrarNotificacao('A senha temporária deve ter pelo menos 8 caracteres.', 'error');
            return;
        }
        try {
            const res = await fetchComAutenticacao(`${API_URL}/usuarios/${encodeURIComponent(id)}/password`, {
                method: 'PUT',
                body: JSON.stringify({ novaSenha })
            });
            if (!res) return;
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                mostrarNotificacao(data.error || 'Não foi possível repor a senha.', 'error');
                return;
            }
            fecharModal('modal-repor-senha');
            mostrarNotificacao('Palavra-passe reposta com sucesso.', 'success');
        } catch (error) {
            console.error('Erro ao repor palavra-passe:', error);
            mostrarNotificacao('Erro de rede ao repor palavra-passe.', 'error');
        }
    });

    // O cadastro associa a compra ao modelo; os equipamentos físicos entram pelo formulário de stock.
    document.getElementById('form-equipamento')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = state.editingEquipamentoId;
        const equipamento = {
            marca: document.getElementById('marca').value.trim(),
            modelo: document.getElementById('modelo').value.trim(),
            partNumber: document.getElementById('part-number').value.trim(),
            categoria: document.getElementById('modelo-categoria').value,
            portas: document.getElementById('modelo-portas').value.trim(),
            capacidadeBanda: document.getElementById('modelo-banda').value.trim(),
            vidaUtilAnos: document.getElementById('modelo-vida-util').value,
            fibraEscura: document.getElementById('modelo-fibra').checked
        };
        if (!id) {
            equipamento.aquisicaoInicial = {
                faturaNumero: document.getElementById('modelo-fatura').value.trim(),
                fornecedorId: document.getElementById('modelo-fornecedor').value,
                custoUnitario: document.getElementById('modelo-custo').value,
                dataAquisicao: document.getElementById('modelo-data-aquisicao').value
            };
            if (!equipamento.aquisicaoInicial.faturaNumero || !equipamento.aquisicaoInicial.fornecedorId ||
                equipamento.aquisicaoInicial.custoUnitario === '' || !equipamento.aquisicaoInicial.dataAquisicao) {
                mostrarNotificacao('Preencha fatura, fornecedor, custo unitário e data da aquisição.', 'error');
                return;
            }
        }
        try {
            const res = await fetchComAutenticacao(`${API_URL}/equipamentos${id ? `/${encodeURIComponent(id)}` : ''}`, {
                method: id ? 'PUT' : 'POST',
                body: JSON.stringify(equipamento)
            });
            if (!res) return;
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                mostrarNotificacao(data.error || 'Não foi possível guardar o modelo.', 'error');
                return;
            }
            mostrarNotificacao(id ? 'Modelo atualizado com sucesso.' : 'Modelo e aquisição registados. Registe as unidades em Entrada de Stock.', 'success');
            fecharModal('modal-modelo');
            await carregarDadosDaBD();
        } catch (err) {
            console.error('Erro ao guardar modelo:', err);
            mostrarNotificacao('Erro de rede ao guardar o modelo.', 'error');
        }
    });

    // Registar unidades de um modelo já existente
    document.getElementById('form-entrada')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const eqId = document.getElementById('select-equipamento').value;
        const instituicao = document.getElementById('select-instituicao-entrada').value;
        const rawSerials = document.getElementById('serial-numbers').value;
        const estadoFisico = document.getElementById('entrada-estado-fisico').value;

        const serials = rawSerials.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean);
        const eq = state.equipamentos.find(item => item.id === eqId);
        const equipamentoNome = eq ? `${eq.marca} ${eq.modelo} (${eq.partNumber || eq.part_number})` : 'Equipamento';

        try {
            const res = await fetchComAutenticacao(`${API_URL}/entradas`, {
                method: 'POST',
                body: JSON.stringify({
                    equipamentoId: eqId,
                    equipamentoNome,
                    quantidade: serials.length || 1,
                    serials,
                    instituicao,
                    instituicaoId: state.instituicoes.find(item => item.nome === instituicao)?.id,
                    estadoFisico
                })
            });

            if (!res) return;
            const data = await res.json();

            if (!res.ok) {
                mostrarNotificacao(data.error || 'Erro ao registar entrada.', 'error');
                return;
            }

            mostrarNotificacao('Entrada de stock registada com sucesso!', 'success');
            document.getElementById('form-entrada').reset();
            fecharModal('modal-entrada');
            await carregarDadosDaBD();
        } catch (err) {
            mostrarNotificacao('Erro ao processar entrada.', 'error');
        }
    });

    // 3. Formulário de Transferência
    document.getElementById('form-transferencia')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const eqId = document.getElementById('select-equipamento-transf').value;
        const origem = document.getElementById('origem-transf').value;
        const destino = document.getElementById('destino-transf').value;
        const tipoGuia = document.getElementById('transf-tipo-guia').value;
        const responsavelTransporte = document.getElementById('transf-responsavel').value;
        const matriculaViatura = document.getElementById('transf-matricula').value;

        const selectSerials = document.getElementById('serials-transf');
        const serials = Array.from(selectSerials.selectedOptions).map(opt => opt.value);

        if (serials.length === 0) {
            mostrarNotificacao('Selecione pelo menos um número de série.', 'error');
            return;
        }

        try {
            const res = await fetchComAutenticacao(`${API_URL}/transferencias`, {
                method: 'POST',
                body: JSON.stringify({
                    equipamentoId: eqId,
                    origem,
                    destino,
                    serials,
                    tipoGuia,
                    responsavelTransporte,
                    matriculaViatura
                })
            });

            if (!res) return;
            const data = await res.json();

            if (!res.ok) {
                mostrarNotificacao(data.error || 'Erro na transferência.', 'error');
                return;
            }

            mostrarNotificacao('Transferência realizada com sucesso!', 'success');
            document.getElementById('form-transferencia').reset();
            fecharModal('modal-transferencia');
            await carregarDadosDaBD();
        } catch (err) {
            mostrarNotificacao('Erro ao processar transferência transacional.', 'error');
        }
    });

    // 4. Formulário de Alterar Palavra-passe
    document.getElementById('form-alterar-senha')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const senhaAtual = document.getElementById('senha-atual').value;
        const novaSenha = document.getElementById('senha-nova').value;
        const confirma = document.getElementById('senha-confirma').value;

        if (novaSenha !== confirma) {
            mostrarNotificacao('A nova palavra-passe e a confirmação não coincidem.', 'error');
            return;
        }
        if (novaSenha.length < 8) {
            mostrarNotificacao('A nova palavra-passe deve conter pelo menos 8 caracteres.', 'error');
            return;
        }

        try {
            const res = await fetchComAutenticacao(`${API_URL}/perfil/password`, {
                method: 'PUT',
                body: JSON.stringify({ senhaAtual, novaSenha })
            });

            if (!res) return;
            if (!res) return;
            const data = await res.json();

            if (!res.ok) {
                mostrarNotificacao(data.error || 'Erro ao alterar palavra-passe.', 'error');
                return;
            }

            mostrarNotificacao('Palavra-passe alterada com sucesso!', 'success');
            document.getElementById('form-alterar-senha').reset();
            fecharModal('modal-senha');
        } catch (err) {
            mostrarNotificacao('Erro ao alterar senha.', 'error');
        }
    });

    // 5. Formulário de Importação em Lote CSV
    document.getElementById('form-importar-csv')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const inputFile = document.getElementById('input-ficheiro-csv');
        const progresso = document.getElementById('progresso-importacao');
        const btnSubmeter = document.getElementById('btn-submeter-csv');

        if (!inputFile || !inputFile.files || inputFile.files.length === 0) {
            mostrarNotificacao('Selecione um ficheiro CSV.', 'error');
            return;
        }

        const formData = new FormData();
        formData.append('file', inputFile.files[0]);

        setButtonLoading(btnSubmeter, true, 'A importar...');
        if (progresso) progresso.style.display = 'block';

        try {
            const token = localStorage.getItem('token');
            const res = await fetchComAutenticacao(`${API_URL}/import/stock`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                body: formData
            });

            const data = await res.json();

            if (!res) return;
            if (!res.ok) {
                mostrarNotificacao(data.error || 'Falha na importação CSV.', 'error');
                return;
            }

            const info = data.resultado;
            mostrarNotificacao(`Importação concluída: ${info.entradasCriadas} entradas e ${info.totalSerials} seriais adicionados!`, 'success');
            fecharModal('modal-importar-csv');
            document.getElementById('form-importar-csv').reset();
            await carregarDadosDaBD();
        } catch (err) {
            mostrarNotificacao('Erro ao processar ficheiro CSV.', 'error');
        } finally {
            setButtonLoading(btnSubmeter, false);
            if (progresso) progresso.style.display = 'none';
        }
    });

    // 6. Formulário de Registo de Utilizador
    document.getElementById('form-novo-usuario')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const nome = document.getElementById('reg-nome').value;
        const email = document.getElementById('reg-email').value;
        const senha = document.getElementById('reg-senha').value;
        const perfil = document.getElementById('reg-perfil').value;
        const instituicaoNome = document.getElementById('reg-instituicao').value;
        const instituicao = state.instituicoes.find(item => item.nome === instituicaoNome);
        const alerta = document.getElementById('alerta-usuario');

        try {
            const res = await fetchComAutenticacao(`${API_URL}/usuarios`, {
                method: 'POST',
                body: JSON.stringify({ nome, email, senha, perfil, instituicaoNome, instituicaoId: instituicao?.id })
            });

            if (!res) return;
            const data = await res.json();

            if (!res.ok) {
                alerta.style.backgroundColor = '#fee2e2';
                alerta.style.color = '#991b1b';
                alerta.textContent = data.error || 'Erro ao criar utilizador.';
                alerta.style.display = 'block';
                return;
            }

            alerta.style.backgroundColor = '#dcfce7';
            alerta.style.color = '#166534';
            alerta.textContent = 'Utilizador criado com sucesso!';
            alerta.style.display = 'block';

            document.getElementById('form-novo-usuario').reset();
            await carregarUsuarios();
        } catch (err) {
            console.error('Erro ao registar utilizador:', err);
        }
    });
}

async function apagarEntrada(id) {
    const conf = await confirmarAcao('Tem a certeza que deseja eliminar este registo de entrada?', 'Eliminar Entrada');
    if (!conf) return;

    try {
        const res = await fetchComAutenticacao(`${API_URL}/entradas/${id}`, { method: 'DELETE' });
        if (res && res.ok) {
            mostrarNotificacao('Entrada eliminada com sucesso!', 'success');
            await carregarDadosDaBD();
        } else {
            const d = await res.json().catch(() => ({}));
            mostrarNotificacao(d.error || 'Erro ao eliminar entrada.', 'error');
        }
    } catch (e) {
        mostrarNotificacao('Erro de rede.', 'error');
    }
}

async function eliminarModelo(id) {
    const modelo = state.equipamentos.find(item => String(item.id) === String(id));
    const confirmado = await confirmarAcao(
        `Eliminar o modelo ${modelo ? `${modelo.marca} ${modelo.modelo}` : id}? Modelos com movimentos associados não podem ser eliminados.`,
        'Eliminar modelo'
    );
    if (!confirmado) return;
    try {
        const res = await fetchComAutenticacao(`${API_URL}/equipamentos/${encodeURIComponent(id)}`, { method: 'DELETE' });
        if (!res) return;
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            mostrarNotificacao(data.error || 'Não foi possível eliminar o modelo.', 'error');
            return;
        }
        mostrarNotificacao(data.message || 'Modelo eliminado com sucesso.', 'success');
        await carregarDadosDaBD();
    } catch (error) {
        console.error('Erro ao eliminar modelo:', error);
        mostrarNotificacao('Erro de rede ao eliminar o modelo.', 'error');
    }
}

async function apagarTransferencia(id) {
    const conf = await confirmarAcao('Deseja anular esta transferência? Os números de série regressarão à instituição de origem.', 'Anular Transferência');
    if (!conf) return;

    try {
        const res = await fetchComAutenticacao(`${API_URL}/transferencias/${id}`, { method: 'DELETE' });
        if (res && res.ok) {
            mostrarNotificacao('Transferência anulada com sucesso!', 'success');
            await carregarDadosDaBD();
        } else {
            const d = await res.json().catch(() => ({}));
            mostrarNotificacao(d.error || 'Erro ao anular transferência.', 'error');
        }
    } catch (e) {
        mostrarNotificacao('Erro de rede ao anular transferência.', 'error');
    }
}

// ==========================================
// 14. Inicialização & Listeners Globais
// ==========================================

document.addEventListener('DOMContentLoaded', async () => {
    configurarPaginacaoListas();

    // 1. Carrega o perfil do utilizador
    const usuarioSalvo = localStorage.getItem('usuario');
    if (usuarioSalvo) {
        const usuario = JSON.parse(usuarioSalvo);
        state.usuarioAtual = usuario;

        const elNome = document.getElementById('user-nome');
        const elPerfil = document.getElementById('user-perfil');
        const elAvatar = document.getElementById('avatar-inicial');
        const elInstBadge = document.getElementById('badge-instituicao-user');

        if (elNome) elNome.textContent = usuario.nome || usuario.email;
        if (elPerfil) elPerfil.textContent = usuario.perfil === 'administrador' ? 'Administrador Geral' : 'Técnico';
        if (elAvatar && usuario.nome) elAvatar.textContent = usuario.nome.charAt(0).toUpperCase();
        if (elInstBadge) elInstBadge.textContent = usuario.instituicao_nome || 'MoRENet / MCTD';

        // Exibe menus exclusivos de administrador
        if (usuario.perfil === 'administrador') {
            const btnUsuarios = document.getElementById('btn-menu-usuarios');
            const btnAuditoria = document.getElementById('btn-menu-auditoria');
            const btnCadastros = document.getElementById('btn-menu-cadastros');
            if (btnUsuarios) btnUsuarios.style.display = 'block';
            if (btnAuditoria) btnAuditoria.style.display = 'block';
            if (btnCadastros) btnCadastros.style.display = 'block';
        }
    }

    configurarNavegacao();
    configurarAcoesInterface();
    configurarFormularios();
    configurarOCR();

    await carregarDadosDaBD();

    // Sincroniza qualquer fila offline se estiver online
    sincronizarFilaOffline();
});

// Eventos de Conectividade
window.addEventListener('online', () => {
    const badge = document.getElementById('badge-status-rede');
    if (badge) {
        badge.className = 'badge-status badge-online';
        badge.textContent = '● Online';
    }
    mostrarNotificacao('Ligação à rede restabelecida!', 'success');
    sincronizarFilaOffline();
});

window.addEventListener('offline', () => {
    const badge = document.getElementById('badge-status-rede');
    if (badge) {
        badge.className = 'badge-status badge-offline';
        badge.textContent = '● Offline';
    }
    mostrarNotificacao('Modo Offline: Sem ligação à rede. A visualizar cache local.', 'error');
    const alertEl = document.getElementById('offline-sync-alert');
    if (alertEl) alertEl.style.display = 'block';
});
