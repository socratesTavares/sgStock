// ==========================================================================
// 1. Arquitectura e Estado Global
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

// Diálogo de Confirmação Moderno e Assíncrono (Ação 3)
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

// Controle de Estado de Carregamento em Botões (Prevenção de Duplo Clique)
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


const state = {
    equipamentos: [],
    historicoEntradas: [],
    historicoTransferencias: [],
    stockConsolidado: []
};

let contextoEliminarSeriais = null;

const EMBLEMA_MOCAMBIQUE_URL = 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTYdSkPUxqArhhHAoPwGlbzbjMxgMa4YPhHniQVCiq-oZ4bLILNCM9iyetq&s=10';

// Inicialização Única do Sistema
document.addEventListener('DOMContentLoaded', async () => {
    // 1. Verifica os dados do utilizador logado e ajusta o menu
    const usuarioSalvo = localStorage.getItem('usuario');
    if (usuarioSalvo) {
        const usuario = JSON.parse(usuarioSalvo);

        // Exibe o botão "Registar Utilizador" apenas para Administradores
        if (usuario.perfil === 'administrador') {
            const btnUsuarios = document.getElementById('btn-menu-usuarios');
            if (btnUsuarios) {
                btnUsuarios.style.display = 'block';
            }
        }
    }

    // 2. Configura a navegação e formulários
    configurarNavegacao();
    configurarAcoesInterface();
    configurarFormularios();

    // 3. Carrega os dados da base de dados com o token JWT
    await carregarDadosDaBD();
});

// Submissão do Formulário de Novo Utilizador
const formNovoUsuario = document.getElementById('form-novo-usuario');
if (formNovoUsuario) {
    formNovoUsuario.addEventListener('submit', async (e) => {
        e.preventDefault();

        const nome = document.getElementById('reg-nome').value;
        const email = document.getElementById('reg-email').value;
        const senha = document.getElementById('reg-senha').value;
        const perfil = document.getElementById('reg-perfil').value;
        const alerta = document.getElementById('alerta-usuario');

        try {
            // Utiliza a função fetchComAutenticacao definida anteriormente
            const res = await fetchComAutenticacao(`${API_URL}/usuarios`, {
                method: 'POST',
                body: JSON.stringify({ nome, email, senha, perfil })
            });

            if (!res) return;

            const data = await res.json();

            if (!res.ok) {
                alerta.style.backgroundColor = '#f8d7da';
                alerta.style.color = '#721c24';
                alerta.textContent = data.error || 'Erro ao criar utilizador.';
                alerta.style.display = 'block';
                return;
            }

            alerta.style.backgroundColor = '#d4edda';
            alerta.style.color = '#155724';
            alerta.textContent = 'Utilizador criado com sucesso!';
            alerta.style.display = 'block';

            formNovoUsuario.reset();

        } catch (err) {
            console.error('Erro na requisição:', err);
        }
    });
}
// ==========================================================================
// 2. Comunicação com API / Backend
// ==========================================================================

async function carregarDadosDaBD() {
    const alertBox = document.getElementById('api-alert');

    // Exibe estado visual de carregamento nas tabelas principais
    const corpoStock = document.getElementById('corpo-tabela-stock');
    const corpoHistorico = document.getElementById('corpo-tabela-historico');
    const corpoTransf = document.getElementById('corpo-tabela-transferencias');

    if (corpoStock && (!state.equipamentos || state.equipamentos.length === 0)) {
        corpoStock.innerHTML = '<tr><td colspan="7" class="loading-state"><span class="spinner"></span> A carregar inventário consolidado...</td></tr>';
    }
    if (corpoHistorico && (!state.historicoEntradas || state.historicoEntradas.length === 0)) {
        corpoHistorico.innerHTML = '<tr><td colspan="5" class="loading-state"><span class="spinner"></span> A carregar histórico de entradas...</td></tr>';
    }
    if (corpoTransf && (!state.historicoTransferencias || state.historicoTransferencias.length === 0)) {
        corpoTransf.innerHTML = '<tr><td colspan="6" class="loading-state"><span class="spinner"></span> A carregar transferências...</td></tr>';
    }

    try {
        // 1. Executa requisições em paralelo incluindo a view de stock consolidado
        const [resEq, resEnt, resTransf, resStock] = await Promise.all([
            fetchComAutenticacao(`${API_URL}/equipamentos`),
            fetchComAutenticacao(`${API_URL}/entradas`),
            fetchComAutenticacao(`${API_URL}/transferencias`),
            fetchComAutenticacao(`${API_URL}/stock`)
        ]);

        if (!resEq || !resEnt || !resTransf) {
            return;
        }

        if (!resEq.ok || !resEnt.ok || !resTransf.ok) {
            throw new Error(`Falha nas rotas: Eq(${resEq.status}), Ent(${resEnt.status}), Transf(${resTransf.status})`);
        }

        const [dadosEq, dadosEnt, dadosTransf, dadosStock] = await Promise.all([
            resEq.json(),
            resEnt.json(),
            resTransf.json(),
            resStock && resStock.ok ? resStock.json() : Promise.resolve([])
        ]);

        state.equipamentos = Array.isArray(dadosEq) 
            ? dadosEq.map(eq => ({
                id: eq.id,
                marca: eq.marca || '',
                modelo: eq.modelo || '',
                partNumber: eq.partNumber || eq.part_number || ''
            })) 
            : [];

        state.historicoEntradas = Array.isArray(dadosEnt) ? dadosEnt : [];
        state.historicoTransferencias = Array.isArray(dadosTransf) ? dadosTransf : [];
        state.stockConsolidado = Array.isArray(dadosStock) ? dadosStock : [];

        if (alertBox) alertBox.style.display = 'none';

        atualizarKPIs();
        atualizarSelects();
        atualizarTabelaStock();
        atualizarTabelaHistorico();
        atualizarTabelaTransferencias();
        atualizarResumoMovimentacoes();

    } catch (error) {
        console.error('Erro ao carregar dados da base de dados:', error);
        if (alertBox) {
            alertBox.style.display = 'block';
            alertBox.textContent = 'Erro ao conectar à base de dados. Verifique a sua ligação ou credenciais.';
        }
    }
}

// Função auxiliar para fazer fetch com autenticação
async function fetchComAutenticacao(url, options = {}) {
    const token = localStorage.getItem('token');

    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        ...(options.headers || {})
    };

    const res = await fetch(url, { ...options, headers });

    console.log(`Requisição para ${url} retornou status ${res.status}`);

    // Se o token expirar ou for inválido, força o logout
    if (res.status === 401) {
        logout();
        return null;
    }

    return res;
}

// Preenche as informações do utilizador ao carregar o Dashboard
document.addEventListener('DOMContentLoaded', () => {
    const usuarioSalvo = localStorage.getItem('usuario');
    
    if (usuarioSalvo) {
        const usuario = JSON.parse(usuarioSalvo);

        // Preenche o nome e perfil na barra superior
        const elNome = document.getElementById('user-nome');
        const elPerfil = document.getElementById('user-perfil');
        const elAvatar = document.getElementById('avatar-inicial');

        if (elNome) elNome.textContent = usuario.nome || usuario.email;
        if (elPerfil) elPerfil.textContent = usuario.perfil || 'Técnico';
        if (elAvatar && usuario.nome) {
            elAvatar.textContent = usuario.nome.charAt(0).toUpperCase();
        }
    }
});

// Função de Terminar Sessão (Logout)
function logout() {
    // 1. Apaga os dados guardados no localStorage
    localStorage.removeItem('token');
    localStorage.removeItem('usuario');

    // 2. Redireciona para a página de login
    window.location.href = 'login.html';
}
// ==========================================================================
// 3. Navegação por Abas, Sidebar e Modais
// ==========================================================================

function configurarNavegacao() {
    const navButtons = document.querySelectorAll('.nav-btn');
    navButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetTab = btn.getAttribute('data-tab');
            mudarAba(targetTab);
            fecharSidebarMobile();
        });
    });
}

function configurarAcoesInterface() {
    document.addEventListener('click', (event) => {
        const target = event.target.closest('[data-action], [data-open-modal], [data-close-modal]');
        if (!target) return;

        if (target.dataset.openModal) {
            abrirModal(target.dataset.openModal);
        } else if (target.dataset.closeModal) {
            fecharModal(target.dataset.closeModal);
        } else if (target.dataset.action === 'toggle-sidebar') {
            toggleSidebar();
        } else if (target.dataset.action === 'logout') {
            logout();
        } else if (target.dataset.action === 'open-reports') {
            mudarAba('tab-relatorios');
        } else if (target.dataset.action === 'print-report') {
            executarImpressao();
        }
    });

    document.getElementById('search-inventario')?.addEventListener('input', filtrarInventario);
    document.getElementById('select-tipo-relatorio')?.addEventListener('change', gerarPreviewRelatorio);
    document.getElementById('select-item-relatorio')?.addEventListener('change', gerarPreviewRelatorio);
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
    }
}

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.querySelector('.sidebar-overlay');
    if (sidebar) sidebar.classList.toggle('active');
    if (overlay) overlay.classList.toggle('active');
}

function fecharSidebarMobile() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.querySelector('.sidebar-overlay');
    if (sidebar) sidebar.classList.remove('active');
    if (overlay) overlay.classList.remove('active');
}

function abrirModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;

    modal.style.display = 'flex';

    // Se o modal aberto for o de transferência, executa o carregamento dos seriais
    if (modalId === 'modal-transferencia') {
        // Popula as opções do dropdown de equipamentos do modal se necessário
        if (typeof preencherSelectsTransferencia === 'function') {
            preencherSelectsTransferencia();
        }
        
        // Atualiza a lista de números de série com base nas seleções atuais
        atualizarSeriaisDisponiveisTransf();
    }
}
function preencherSelectsTransferencia() {
    const selectEq = document.getElementById('select-equipamento-transf');
    const selectOrigem = document.getElementById('origem-transf');

    if (!selectEq || !selectOrigem) return;

    selectEq.innerHTML = '<option value="">Selecione um equipamento...</option>';
    if (Array.isArray(state.equipamentos)) {
        state.equipamentos.forEach(eq => {
            const opt = document.createElement('option');
            opt.value = eq.id;
            opt.textContent = `${eq.marca} ${eq.modelo} (${eq.partNumber || eq.part_number || ''})`;
            selectEq.appendChild(opt);
        });
    }

    selectOrigem.innerHTML = '<option value="">Selecione a origem...</option>';
    const stock = obterStockAtual();
    const locaisUnicos = [...new Set(stock.filter(s => s.total > 0).map(s => s.instituicao).filter(Boolean))];
    
    locaisUnicos.forEach(local => {
        const opt = document.createElement('option');
        opt.value = local;
        opt.textContent = local;
        selectOrigem.appendChild(opt);
    });
}

function fecharModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.style.display = 'none';
        const form = modal.querySelector('form');
        if (form) form.reset();
    }
}

window.onclick = function (e) {
    if (e.target.classList.contains('modal')) {
        e.target.style.display = 'none';
    }
};

// ==========================================================================
// 4. Lógica de Stock e Cálculo Dinâmico
// ==========================================================================

function obterStockAtual() {
    // 1. Prioriza dados consolidados diretamente do PostgreSQL
    if (Array.isArray(state.stockConsolidado) && state.stockConsolidado.length > 0) {
        return state.stockConsolidado.map(item => ({
            entradaId: '',
            equipamentoId: item.equipamentoId,
            equipamentoNome: `${item.marca} ${item.modelo} (${item.partNumber})`,
            instituicao: item.instituicao,
            serials: Array.isArray(item.serials) ? item.serials : [],
            total: Number(item.total) || 0
        }));
    }

    // 2. Algoritmo de Fallback robusto no cliente: Rastreia a última localização de cada número de série
    const serialMap = new Map();

    (state.historicoEntradas || []).forEach(ent => {
        const eqId = String(ent.equipamentoId || ent.equipamento_id || '');
        const eqNome = String(ent.equipamentoNome || ent.equipamento_nome || '');
        const inst = String(ent.instituicao || '').trim();
        const serials = Array.isArray(ent.serials) ? ent.serials : [];
        const ordem = Number(ent.id) || 0;

        serials.forEach(sn => {
            const cleanSn = String(sn).trim();
            if (!cleanSn) return;
            const key = cleanSn.toLowerCase();
            if (!serialMap.has(key) || serialMap.get(key).ordem < ordem) {
                serialMap.set(key, { equipamentoId: eqId, equipamentoNome: eqNome, instituicao: inst, serial: cleanSn, ordem });
            }
        });
    });

    (state.historicoTransferencias || []).forEach(trf => {
        if (trf.cancelado) return;
        const eqId = String(trf.equipamentoId || trf.equipamento_id || '');
        const eqNome = String(trf.equipamentoNome || trf.equipamento_nome || '');
        const dest = String(trf.destino || '').trim();
        const serials = Array.isArray(trf.serials) ? trf.serials : [];
        const ordem = Number(trf.id) || 0;

        serials.forEach(sn => {
            const cleanSn = String(sn).trim();
            if (!cleanSn) return;
            const key = cleanSn.toLowerCase();
            if (!serialMap.has(key) || serialMap.get(key).ordem < ordem) {
                serialMap.set(key, { equipamentoId: eqId, equipamentoNome: eqNome, instituicao: dest, serial: cleanSn, ordem });
            }
        });
    });

    // Agrupa por equipamento e localização
    const agrupado = new Map();
    for (const item of serialMap.values()) {
        const groupKey = `${item.equipamentoId}|${item.instituicao.toLowerCase()}`;
        if (!agrupado.has(groupKey)) {
            agrupado.set(groupKey, {
                entradaId: '',
                equipamentoId: item.equipamentoId,
                equipamentoNome: item.equipamentoNome,
                instituicao: item.instituicao,
                serials: [],
                total: 0
            });
        }
        const g = agrupado.get(groupKey);
        g.serials.push(item.serial);
        g.total++;
    }

    return Array.from(agrupado.values());
}

// ==========================================================================
// 5. Componentes de Renderização e UI
// ==========================================================================

function atualizarKPIs() {
    document.getElementById('kpi-total-modelos').textContent = state.equipamentos.length;

    document.getElementById('kpi-total-unidades').textContent = calcularTotalUnidadesEmStock();

    document.getElementById('kpi-total-entradas').textContent = state.historicoEntradas.length;
    document.getElementById('kpi-total-transferencias').textContent = state.historicoTransferencias.length;
}

function obterSeriaisTransferidos() {
    const serialsTransferidos = new Set();

    (state.historicoTransferencias || []).forEach(transferencia => {
        if (transferencia.cancelado) return;
        (Array.isArray(transferencia.serials) ? transferencia.serials : []).forEach(serial => {
            const serialNormalizado = String(serial).trim().toLowerCase();
            if (serialNormalizado) serialsTransferidos.add(serialNormalizado);
        });
    });

    return serialsTransferidos;
}

function calcularTotalUnidadesEmStock() {
    const serialsEntradas = new Set();

    (state.historicoEntradas || []).forEach(entrada => {
        (Array.isArray(entrada.serials) ? entrada.serials : []).forEach(serial => {
            const serialNormalizado = String(serial).trim().toLowerCase();
            if (serialNormalizado) serialsEntradas.add(serialNormalizado);
        });
    });

    const serialsTransferidos = obterSeriaisTransferidos();
    return [...serialsEntradas].filter(serial => !serialsTransferidos.has(serial)).length;
}

function obterStockNaoTransferido() {
    const serialsTransferidos = obterSeriaisTransferidos();

    return obterStockAtual().map(item => {
        const serials = (Array.isArray(item.serials) ? item.serials : [])
            .filter(serial => !serialsTransferidos.has(String(serial).trim().toLowerCase()));

        return { ...item, serials, total: serials.length };
    }).filter(item => item.total > 0);
}

function atualizarSelects() {
    const selectEq = document.getElementById('select-equipamento');
    const selectTransf = document.getElementById('select-equipamento-transf');

    selectEq.innerHTML = '<option value="">-- Selecione um modelo --</option>';
    selectTransf.innerHTML = '<option value="">-- Selecione um modelo --</option>';

    state.equipamentos.forEach(eq => {
        const opt = document.createElement('option');
        opt.value = eq.id;
        opt.textContent = `${eq.marca} ${eq.modelo} | P/N: ${eq.partNumber}`;

        selectEq.appendChild(opt);
        selectTransf.appendChild(opt.cloneNode(true));
    });
}

function atualizarTabelaStock() {
    const corpo = document.getElementById('corpo-tabela-stock');
    if (!corpo) return;
    corpo.innerHTML = '';

    if (state.equipamentos.length === 0) {
        corpo.innerHTML = '<tr><td colspan="7" style="text-align:center;">Nenhum equipamento cadastrado.</td></tr>';
        return;
    }

    const stockCalculado = obterStockNaoTransferido();
    if (stockCalculado.length === 0) {
        corpo.innerHTML = '<tr><td colspan="7" style="text-align:center;">Nenhum equipamento disponível no stock atual.</td></tr>';
        return;
    }

    state.equipamentos.forEach(eq => {
        const registos = stockCalculado.filter(s => String(s.equipamentoId) === String(eq.id));
        registos.forEach(item => {
            const tr = document.createElement('tr');
            const serialsHtml = item.serials
                .map(serial => `<div class="stock-serial">${escapeHTML(serial)}</div>`)
                .join('');
            tr.innerHTML = `
                <td>${escapeHTML(eq.marca)}</td>
                <td>${escapeHTML(eq.modelo)}</td>
                <td>${escapeHTML(eq.partNumber)}</td>
                <td><div class="stock-serial-list">${serialsHtml}</div></td>
                <td>${escapeHTML(item.instituicao)}</td>
                <td><strong>${Number(item.total) || 0}</strong></td>
                <td class="text-right">
                    <button class="btn btn-sm btn-secondary btn-editar-linha">Editar</button>
                    <button class="btn btn-sm btn-danger btn-eliminar-linha">Eliminar</button>
                </td>
            `;
            tr.querySelector('.btn-editar-linha').addEventListener('click', () => {
                abrirModalEditar(eq.id, item.instituicao, item.serials || []);
            });
            tr.querySelector('.btn-eliminar-linha').addEventListener('click', () => {
                abrirModalEliminarSeriais(eq.id, `${eq.marca} ${eq.modelo}`, item.instituicao, item.serials || []);
            });
            corpo.appendChild(tr);
        });
    });
}

function filtrarInventario() {
    const termo = document.getElementById('search-inventario').value.toLowerCase();
    const linhas = document.querySelectorAll('#corpo-tabela-stock tr');

    linhas.forEach(linha => {
        const texto = linha.textContent.toLowerCase();
        linha.style.display = texto.includes(termo) ? '' : 'none';
    });
}

function atualizarTabelaHistorico() {
    const corpo = document.getElementById('corpo-tabela-historico');
    if (!corpo) return;
    corpo.innerHTML = '';

    if (!state.historicoEntradas || state.historicoEntradas.length === 0) {
        corpo.innerHTML = '<tr><td colspan="5" style="text-align:center;">Nenhuma entrada registada.</td></tr>';
        return;
    }

    state.historicoEntradas.forEach(e => {
        const serialsTexto = e.serials ? (Array.isArray(e.serials) ? e.serials.join(', ') : e.serials) : 'N/A';
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${escapeHTML(e.dataHora)}</td>
            <td><span class="historico-equipamento">${escapeHTML(e.equipamentoNome)}</span><small class="historico-serials" style="color:var(--text-muted)">S/N: ${escapeHTML(serialsTexto)}</small></td>
            <td>+${Number(e.quantidade) || 0}</td>
            <td>${escapeHTML(e.instituicao)}</td>
            <td style="text-align: center;">
                <button class="btn-danger btn-sm btn-apagar-entrada" title="Eliminar entrada">
                    Eliminar
                </button>
            </td>
        `;
        tr.querySelector('.btn-apagar-entrada').addEventListener('click', () => {
            apagarEntrada(e.id);
        });
        corpo.appendChild(tr);
    });
}

function atualizarTabelaTransferencias() {
    const corpo = document.getElementById('corpo-tabela-transferencias');
    if (!corpo) return;
    corpo.innerHTML = '';

    if (!state.historicoTransferencias || state.historicoTransferencias.length === 0) {
        corpo.innerHTML = '<tr><td colspan="6" style="text-align:center;">Nenhuma transferência registada.</td></tr>';
        return;
    }

    [...state.historicoTransferencias].reverse().forEach(t => {
        const serialsTexto = t.serials ? (Array.isArray(t.serials) ? t.serials.join(', ') : t.serials) : 'N/A';
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${escapeHTML(t.dataHora)}</td>
            <td>${escapeHTML(t.equipamentoNome)}<br><small style="color:var(--text-muted)">S/N: ${escapeHTML(serialsTexto)}</small></td>
            <td>${Number(t.quantidade) || 0}</td>
            <td>${escapeHTML(t.origem)}</td>
            <td>${escapeHTML(t.destino)}</td>
            <td style="text-align: center;">
                <button class="btn-danger btn-sm btn-apagar-transf" title="Eliminar transferência">
                    Eliminar
                </button>
            </td>
        `;
        tr.querySelector('.btn-apagar-transf').addEventListener('click', () => {
            apagarTransferencia(t.id);
        });
        corpo.appendChild(tr);
    });
}

function atualizarResumoMovimentacoes() {
    const corpo = document.getElementById('corpo-tabela-resumo-movimentacoes');
    if (!corpo) return;
    corpo.innerHTML = '';

    const ultimasEntradas = state.historicoEntradas.map(e => ({ ...e, tipo: 'Entrada' }));
    const ultimasTransf = state.historicoTransferencias.map(t => ({ ...t, tipo: 'Transferência' }));

    const todas = [...ultimasEntradas, ...ultimasTransf].slice(-5).reverse();

    if (todas.length === 0) {
        corpo.innerHTML = '<tr><td colspan="5" style="text-align:center;">Sem movimentações recentes.</td></tr>';
        return;
    }

    todas.forEach(m => {
        const tr = document.createElement('tr');
        const tipoBadgeClass = m.tipo === 'Entrada' ? 'btn-success' : 'btn-primary';
        const local = m.instituicao || m.destino || 'N/A';
        tr.innerHTML = `
            <td>${escapeHTML(m.dataHora)}</td>
            <td><span class="btn-sm ${tipoBadgeClass}">${escapeHTML(m.tipo)}</span></td>
            <td>${escapeHTML(m.equipamentoNome)}</td>
            <td>${Number(m.quantidade) || 0}</td>
            <td>${escapeHTML(local)}</td>
        `;
        corpo.appendChild(tr);
    });
}

// ==========================================================================
// 6. Formulários e Submissões
// ==========================================================================

function configurarFormularios() {
    // 1. Registar Modelo
    document.getElementById('form-equipamento')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const submitBtn = e.target.querySelector('button[type="submit"]');
        const marca = document.getElementById('marca').value.trim();
        const modelo = document.getElementById('modelo').value.trim();
        const partNumber = document.getElementById('part-number').value.trim();

        if (!marca || !modelo || !partNumber) {
            mostrarNotificacao('Por favor, preencha todos os campos do modelo.', 'error');
            return;
        }

        if (state.equipamentos.some(eq => eq.partNumber.toLowerCase() === partNumber.toLowerCase())) {
            mostrarNotificacao('Atenção: Já existe um modelo cadastrado com este Part Number!', 'error');
            return;
        }

        const novoEquipamento = { id: Date.now().toString(), marca, modelo, partNumber };

        setButtonLoading(submitBtn, true, 'A registar modelo...');
        try {
            const res = await fetchComAutenticacao(`${API_URL}/equipamentos`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(novoEquipamento)
            });

            const data = await res.json().catch(() => ({}));
            if (res.ok) {
                fecharModal('modal-modelo');
                await carregarDadosDaBD();
                mostrarNotificacao('Modelo cadastrado com sucesso!', 'success');
            } else {
                mostrarNotificacao(data.error || 'Erro ao cadastrar modelo.', 'error');
            }
        } catch (error) {
            console.error('Erro na submissão do modelo:', error);
            mostrarNotificacao('Erro de rede ao comunicar com o servidor.', 'error');
        } finally {
            setButtonLoading(submitBtn, false);
        }
    });

    document.getElementById('select-equipamento-transf')?.addEventListener('change', atualizarSeriaisDisponiveisTransf);
    document.getElementById('origem-transf')?.addEventListener('change', atualizarSeriaisDisponiveisTransf);

    // 2. Registar Entrada
    document.getElementById('form-entrada')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const submitBtn = e.target.querySelector('button[type="submit"]');
        const equipamentoId = document.getElementById('select-equipamento').value;
        const rawSerials = document.getElementById('serial-numbers').value;
        const instituicao = document.getElementById('instituicao').value.trim();

        const listaSerialsBruta = rawSerials.split(/[\n,]+/).map(s => s.trim()).filter(s => s.length > 0);
        // Remove duplicados acidentais no mesmo textarea
        const listaSerials = [...new Set(listaSerialsBruta)];

        const equipamento = state.equipamentos.find(eq => String(eq.id) === String(equipamentoId));

        if (!equipamento) {
            mostrarNotificacao('Por favor, selecione um modelo de equipamento.', 'error');
            return;
        }

        if (listaSerials.length === 0) {
            mostrarNotificacao('Por favor, informe pelo menos um número de série válido.', 'error');
            return;
        }

        if (!instituicao) {
            mostrarNotificacao('Por favor, informe a instituição ou armazém de destino da entrada.', 'error');
            return;
        }

        const novaEntrada = {
            id: Date.now().toString(),
            equipamentoId: equipamento.id,
            equipamentoNome: `${equipamento.marca} ${equipamento.modelo} (${equipamento.partNumber})`,
            quantidade: listaSerials.length,
            serials: listaSerials,
            instituicao,
            dataHora: new Date().toLocaleString('pt-PT')
        };

        setButtonLoading(submitBtn, true, 'A registar entrada...');
        try {
            const res = await fetchComAutenticacao(`${API_URL}/entradas`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(novaEntrada)
            });

            const data = await res.json().catch(() => ({}));
            if (res.ok) {
                fecharModal('modal-entrada');
                await carregarDadosDaBD();
                mostrarNotificacao('Entrada de stock registada com sucesso!', 'success');
            } else {
                mostrarNotificacao(data.error || 'Erro ao guardar entrada.', 'error');
            }
        } catch (error) {
            console.error('Erro ao registar entrada:', error);
            mostrarNotificacao('Erro de comunicação ao registar entrada.', 'error');
        } finally {
            setButtonLoading(submitBtn, false);
        }
    });

    // 3. Dynamic Select de Origem para Transferência
    document.getElementById('select-equipamento-transf')?.addEventListener('change', (e) => {
        const eqId = e.target.value;
        const origemSelect = document.getElementById('origem-transf');
        origemSelect.innerHTML = '<option value="">-- Selecione a origem --</option>';

        if (!eqId) return;

        const stock = obterStockAtual().filter(item => String(item.equipamentoId) === String(eqId) && item.total > 0);
        stock.forEach(item => {
            const opt = document.createElement('option');
            opt.value = item.instituicao;
            opt.textContent = `${item.instituicao} (${item.total} disponíveis)`;
            origemSelect.appendChild(opt);
        });
        atualizarSeriaisDisponiveisTransf();
    });

    // 4. Efetuar Transferência com Validação Client-Side e Anti-Double Submit
    document.getElementById('form-transferencia')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const submitBtn = e.target.querySelector('button[type="submit"]');

        const equipamentoId = document.getElementById('select-equipamento-transf').value;
        const origem = document.getElementById('origem-transf').value;
        const destino = document.getElementById('destino-transf').value.trim();
        const selectSerials = document.getElementById('serials-transf');

        const listaSerials = Array.from(selectSerials.selectedOptions).map(opt => opt.value);

        if (!equipamentoId) {
            mostrarNotificacao('Selecione um modelo de equipamento.', 'error');
            return;
        }

        if (!origem) {
            mostrarNotificacao('Selecione a origem do equipamento.', 'error');
            return;
        }

        if (!destino) {
            mostrarNotificacao('Indique o destino da transferência.', 'error');
            return;
        }

        if (origem.toLowerCase() === destino.toLowerCase()) {
            mostrarNotificacao('A origem e o destino não podem ser a mesma instituição.', 'error');
            return;
        }

        if (listaSerials.length === 0) {
            mostrarNotificacao('Selecione pelo menos um número de série para transferir.', 'error');
            return;
        }

        const equipamento = state.equipamentos.find(eq => String(eq.id) === String(equipamentoId));
        if (!equipamento) {
            mostrarNotificacao('Equipamento não encontrado.', 'error');
            return;
        }

        const novaTransferencia = {
            id: Date.now().toString(),
            equipamentoId: equipamento.id,
            equipamentoNome: `${equipamento.marca} ${equipamento.modelo} (${equipamento.partNumber})`,
            quantidade: listaSerials.length,
            serials: listaSerials,
            origem,
            destino,
            dataHora: new Date().toLocaleString('pt-PT')
        };

        setButtonLoading(submitBtn, true, 'A transferir...');
        try {
            const res = await fetchComAutenticacao(`${API_URL}/transferencias`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(novaTransferencia)
            });

            const data = await res.json().catch(() => ({}));
            if (res.ok) {
                fecharModal('modal-transferencia');
                await carregarDadosDaBD();
                mostrarNotificacao('Transferência efetuada com sucesso!', 'success');
            } else {
                mostrarNotificacao(data.error || 'Erro ao registar transferência.', 'error');
            }
        } catch (error) {
            console.error('Erro na transferência:', error);
            mostrarNotificacao('Erro de comunicação ao registar transferência.', 'error');
        } finally {
            setButtonLoading(submitBtn, false);
        }
    });

    // 5. Editar Equipamento
    document.getElementById('form-editar-equipamento')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const submitBtn = e.target.querySelector('button[type="submit"]');

        const equipamentoId = document.getElementById('edit-id').value;
        const marca = document.getElementById('edit-marca').value.trim();
        const modelo = document.getElementById('edit-modelo').value.trim();
        const partNumber = document.getElementById('edit-part-number').value.trim();
        const novaInstituicao = document.getElementById('edit-instituicao').value.trim();
        const antigaInstituicao = document.getElementById('edit-instituicao-original').value.trim();

        setButtonLoading(submitBtn, true, 'A guardar alterações...');
        try {
            const resModelo = await fetchComAutenticacao(`${API_URL}/equipamentos/${equipamentoId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ marca, modelo, partNumber, novaInstituicao, antigaInstituicao })
            });

            if (!resModelo.ok) {
                const erroData = await resModelo.json().catch(() => ({}));
                throw new Error(erroData.error || 'Erro ao atualizar modelo de equipamento');
            }

            fecharModal('modal-editar');
            await carregarDadosDaBD();
            mostrarNotificacao('Inventário atualizado com sucesso!', 'success');
        } catch (error) {
            console.error('Erro na edição:', error);
            mostrarNotificacao(error.message || 'Não foi possível salvar as alterações.', 'error');
        } finally {
            setButtonLoading(submitBtn, false);
        }
    });
}

function abrirModalEditar(equipamentoId, instituicao, serials = []) {
    const eq = state.equipamentos.find(item => item.id === equipamentoId);
    if (!eq) return;

    document.getElementById('edit-id').value = eq.id;
    document.getElementById('edit-marca').value = eq.marca;
    document.getElementById('edit-modelo').value = eq.modelo;
    document.getElementById('edit-part-number').value = eq.partNumber;
    document.getElementById('edit-instituicao').value = instituicao;
    document.getElementById('edit-instituicao-original').value = instituicao;
    document.getElementById('edit-local-contexto').textContent = `Seriais atualmente em ${instituicao}`;
    renderizarSeriaisEditaveis(equipamentoId, instituicao, serials);

    abrirModal('modal-editar');
}

async function apagarEntrada(id) {
    const confirmado = await confirmarAcao(
        'Tem a certeza de que deseja eliminar este registo de entrada? Esta ação é irreversível.',
        'Eliminar Registo de Entrada'
    );
    if (!confirmado) return;

    try {
        const res = await fetchComAutenticacao(`${API_URL}/entradas/${id}`, {
            method: 'DELETE'
        });

        if (!res) return;

        if (res.ok) {
            state.historicoEntradas = state.historicoEntradas.filter(item => item.id !== id);
            atualizarTabelaHistorico();
            atualizarKPIs();
            await carregarDadosDaBD();
            mostrarNotificacao('Registo de entrada eliminado com sucesso!', 'success');
        } else {
            const erro = await res.json().catch(() => ({}));
            mostrarNotificacao(erro.error || 'Erro ao eliminar registo.', 'error');
        }
    } catch (err) {
        console.error('Erro ao apagar registo:', err);
        mostrarNotificacao('Erro de comunicação ao tentar apagar registo.', 'error');
    }
}

function abrirModalEliminarSeriais(equipamentoId, nomeModelo, instituicao, serials) {
    contextoEliminarSeriais = { equipamentoId, nomeModelo, instituicao };
    document.getElementById('eliminar-seriais-contexto').textContent = `${nomeModelo} | ${instituicao}`;
    renderizarListaSeriaisParaEliminar(serials);
    document.getElementById('modal-eliminar-seriais').style.display = 'flex';
}

function renderizarListaSeriaisParaEliminar(serials) {
    const lista = document.getElementById('lista-seriais-eliminar');
    lista.innerHTML = '';

    if (serials.length === 0) {
        lista.textContent = 'Não existem seriais disponíveis para eliminar nesta instituição.';
        return;
    }

    serials.forEach(serial => {
        const linha = document.createElement('div');
        linha.className = 'serial-manager-row';

        const valor = document.createElement('span');
        valor.textContent = serial;

        const botao = document.createElement('button');
        botao.type = 'button';
        botao.className = 'btn btn-sm btn-danger';
        botao.textContent = 'Eliminar';
        botao.addEventListener('click', async () => {
            const contexto = contextoEliminarSeriais;
            document.getElementById('modal-eliminar-seriais').style.display = 'none';
            await eliminarSerialStock(contexto.equipamentoId, contexto.instituicao, serial, contexto.nomeModelo);
            document.getElementById('modal-eliminar-seriais').style.display = 'flex';
        });

        linha.append(valor, botao);
        lista.appendChild(linha);
    });
}

async function atualizarModalEliminarSeriais() {
    if (!contextoEliminarSeriais) return;
    const { equipamentoId, instituicao } = contextoEliminarSeriais;
    const registo = obterStockNaoTransferido().find(item =>
        String(item.equipamentoId) === String(equipamentoId) &&
        String(item.instituicao).trim().toLowerCase() === instituicao.trim().toLowerCase()
    );
    renderizarListaSeriaisParaEliminar(registo?.serials || []);
}

function renderizarSeriaisEditaveis(equipamentoId, instituicao, serials) {
    const lista = document.getElementById('edit-seriais-lista');
    lista.innerHTML = '';

    if (serials.length === 0) {
        lista.textContent = 'Não existem seriais disponíveis nesta instituição.';
        return;
    }

    serials.forEach(serial => {
        const linha = document.createElement('div');
        linha.className = 'serial-manager-row';

        const input = document.createElement('input');
        input.type = 'text';
        input.value = serial;
        input.setAttribute('aria-label', `Número de série ${serial}`);

        const botao = document.createElement('button');
        botao.type = 'button';
        botao.className = 'btn btn-sm btn-primary';
        botao.textContent = 'Guardar serial';
        botao.addEventListener('click', () => {
            atualizarSerialStock(equipamentoId, instituicao, serial, input.value, botao);
        });

        linha.append(input, botao);
        lista.appendChild(linha);
    });
}

async function atualizarSerialStock(equipamentoId, instituicao, serial, novoSerial, botao) {
    const serialFormatado = novoSerial.trim();
    if (!serialFormatado) {
        mostrarNotificacao('O número de série não pode ficar vazio.', 'error');
        return;
    }
    if (serialFormatado === serial) return;

    setButtonLoading(botao, true, 'A guardar...');
    try {
        const res = await fetchComAutenticacao(`${API_URL}/stock/${encodeURIComponent(equipamentoId)}/serial`, {
            method: 'PATCH',
            body: JSON.stringify({ serial, novoSerial: serialFormatado, instituicao })
        });
        if (!res) return;

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            mostrarNotificacao(data.error || 'Erro ao atualizar o serial.', 'error');
            return;
        }

        await carregarDadosDaBD();
        const registoAtualizado = obterStockNaoTransferido().find(item =>
            String(item.equipamentoId) === String(equipamentoId) &&
            String(item.instituicao).trim().toLowerCase() === instituicao.trim().toLowerCase()
        );
        abrirModalEditar(equipamentoId, instituicao, registoAtualizado?.serials || []);
        mostrarNotificacao(`Serial atualizado para "${serialFormatado}".`, 'success');
    } catch (error) {
        console.error('Erro ao editar serial:', error);
        mostrarNotificacao('Erro ao atualizar o serial.', 'error');
    } finally {
        setButtonLoading(botao, false);
    }
}

async function eliminarSerialStock(equipamentoId, instituicao, serial, nomeModelo) {
    const confirmado = await confirmarAcao(
        `Eliminar o serial "${serial}" de "${nomeModelo}" em "${instituicao}"? Esta ação também remove o serial do histórico de entradas e transferências.`,
        'Eliminar Serial'
    );
    if (!confirmado) return;

    try {
        const res = await fetchComAutenticacao(`${API_URL}/stock/${encodeURIComponent(equipamentoId)}/serial`, {
            method: 'DELETE',
            body: JSON.stringify({ serial, instituicao })
        });
        if (!res) return;

        if (res.ok) {
            await carregarDadosDaBD();
            await atualizarModalEliminarSeriais();
            mostrarNotificacao(`Serial "${serial}" eliminado com sucesso!`, 'success');
        } else {
            const erro = await res.json().catch(() => ({}));
            mostrarNotificacao(erro.error || 'Erro ao eliminar serial.', 'error');
        }
    } catch (error) {
        console.error('Erro ao eliminar serial:', error);
        mostrarNotificacao('Erro ao eliminar serial.', 'error');
    }
}

async function eliminarModeloGlobal(equipamentoId, nomeModelo) {
    const confirmado = await confirmarAcao(
        `Deseja apagar definitivamente o modelo "${nomeModelo}"? A exclusão só é permitida caso não existam movimentações vinculadas.`,
        'Eliminar Modelo'
    );
    if (!confirmado) return;

    try {
        const res = await fetchComAutenticacao(`${API_URL}/equipamentos/${equipamentoId}`, { method: 'DELETE' });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
            await carregarDadosDaBD();
            mostrarNotificacao('Modelo eliminado com sucesso!', 'success');
        } else {
            mostrarNotificacao(data.error || 'Erro ao eliminar modelo.', 'error');
        }
    } catch (error) {
        console.error('Erro ao eliminar modelo:', error);
        mostrarNotificacao('Erro de rede ao eliminar modelo.', 'error');
    }
}

// ==========================================================================
// 7. Geração de Relatórios e Guia de Saída (MoRENet)
// ==========================================================================

function preencherSelectItensRelatorio() {
    const selectItem = document.getElementById('select-item-relatorio');
    const tipo = document.getElementById('select-tipo-relatorio').value;
    const labelItem = document.getElementById('label-select-item');
    selectItem.innerHTML = '';

    if (tipo === 'guia-saida') {
        labelItem.textContent = 'Selecione a Transferência / Saída:';
        if (state.historicoTransferencias.length === 0) {
            selectItem.innerHTML = '<option value="">-- Nenhuma transferência registada --</option>';
            return;
        }
        [...state.historicoTransferencias].reverse().forEach(transf => {
            const opt = document.createElement('option');
            opt.value = transf.id;
            opt.textContent = `[${transf.dataHora}] ${transf.equipamentoNome} -> ${transf.destino}`;
            selectItem.appendChild(opt);
        });
    } else {
        labelItem.textContent = 'Escolha o Item do Stock:';
        const stockCalculado = obterStockNaoTransferido();
        stockCalculado.forEach(item => {
            const eq = state.equipamentos.find(e => e.id === item.equipamentoId);
            if (eq) {
                const opt = document.createElement('option');
                opt.value = `${item.equipamentoId}|${item.instituicao}`;
                opt.textContent = `${eq.marca} ${eq.modelo} - ${item.instituicao} (Qtd: ${item.total})`;
                selectItem.appendChild(opt);
            }
        });
    }
}

function gerarPreviewRelatorio() {
    const tipo = document.getElementById('select-tipo-relatorio').value;
    const containerSelect = document.getElementById('container-select-item');
    const areaPreview = document.getElementById('area-preview-impressao');

    containerSelect.style.display = (tipo === 'item' || tipo === 'guia-saida') ? 'flex' : 'none';

    let html = '';

    if (tipo === 'guia-saida') {
        const transfId = document.getElementById('select-item-relatorio').value;
        const transf = state.historicoTransferencias.find(t => t.id === transfId);

        if (!transf) {
            areaPreview.innerHTML = '<p style="text-align:center; padding:2rem;">Nenhuma transferência selecionada.</p>';
            return;
        }

        const eq = state.equipamentos.find(e => e.id === transf.equipamentoId);
        const dataHoje = new Date();
        const serialsList = Array.isArray(transf.serials) ? transf.serials : [];
        const serialsFormatted = serialsList.map(s => escapeHTML(s)).join('<br>');
        const nomeEquipamento = eq ? `${escapeHTML(eq.marca)} ${escapeHTML(eq.modelo)}` : escapeHTML(transf.equipamentoNome);
        const partNumber = eq ? escapeHTML(eq.partNumber) : 'N/A';

        html = `
            <div class="guia-container">
                <div class="guia-header">
                    <img src="${escapeHTML(EMBLEMA_MOCAMBIQUE_URL)}" class="emblema" alt="Emblema">
                    <h4>República de Moçambique</h4>
                    <h4>Ministério das Comunicações e Transformação Digital</h4>
                    <h4>Direcção de Administração e Recursos Humanos</h4>
                    <h4>Rede de Instituições de Ensino Superior e de Investigação de Moçambique (MoRENet)</h4>
                </div>

                <div class="guia-titulo">Guia de Saída</div>

                <div class="guia-assunto">
                    <strong>Assunto:</strong> Autorização de Saída e Transporte de Equipamento Técnico
                </div>

                <div class="guia-texto">
                    Em resposta à solicitação de alocação e transporte do equipamento abaixo descrito, pertencente à MoRENet, declara-se que o mesmo se encontra devidamente autorizado a ser levantado e a sair das instalações do <strong>${escapeHTML(transf.origem)}</strong>, com destino às instalações da <strong>${escapeHTML(transf.destino)}</strong>.
                </div>

                <h4 style="margin-top:1rem; font-weight:bold;">1. Especificações do Equipamento Principal</h4>
                <table class="guia-tabela">
                    <thead>
                        <tr>
                            <th>Componente</th>
                            <th>Marca / Modelo</th>
                            <th>Part Number</th>
                            <th>Número de Série</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td>Equipamento de Rede</td>
                            <td>${nomeEquipamento}</td>
                            <td>${partNumber}</td>
                            <td>${serialsFormatted || 'N/A'}</td>
                        </tr>
                    </tbody>
                </table>

                <div class="guia-texto">
                    Pelo que, o referido equipamento e os seus respetivos acessórios encontram-se acondicionados na embalagem de fábrica, completos, em conformidade e prontos para o seu transporte e posterior instalação na <strong>${escapeHTML(transf.destino)}</strong>.
                </div>

                <div style="margin-top: 1.5rem; text-align: center;">
                    Maputo, ${dataHoje.getDate()} de ${dataHoje.toLocaleString('pt-PT', { month: 'long' })} de ${dataHoje.getFullYear()}
                </div>

                <div class="guia-assinaturas">
                    <div class="guia-assinatura-box">
                        <div>Repart. de Património:</div>
                        <div class="guia-espaco-assinatura"></div>
                        <div class="guia-linha-nome"></div>
                    </div>
                    <div class="guia-assinatura-box">
                        <div>Verificado por:</div>
                        <div class="guia-espaco-assinatura"></div>
                        <div class="guia-linha-nome"><strong>Victor Guambe</strong></div>
                    </div>
                </div>
            </div>
        `;
    } else if (tipo === 'inventario') {
        html = `
            <h2>Relatório de Inventário Completo</h2>
            <p>Emitido em: ${escapeHTML(new Date().toLocaleString('pt-PT'))}</p><br>
            <table class="guia-tabela">
                <thead>
                    <tr><th>Equipamento</th><th>Part Number</th><th>Localização</th><th>Serial Numbers</th><th>Total</th></tr>
                </thead>
                <tbody>
        `;
        obterStockNaoTransferido().forEach(item => {
            const eq = state.equipamentos.find(e => e.id === item.equipamentoId);
            if (eq) {
                const serialsSafe = Array.isArray(item.serials) ? item.serials.map(s => escapeHTML(s)).join(', ') : escapeHTML(item.serials);
                html += `<tr><td>${escapeHTML(eq.marca)} ${escapeHTML(eq.modelo)}</td><td>${escapeHTML(eq.partNumber)}</td><td>${escapeHTML(item.instituicao)}</td><td><small>${serialsSafe}</small></td><td><strong>${Number(item.total) || 0}</strong></td></tr>`;
            }
        });
        html += `</tbody></table>`;
    } else if (tipo === 'entradas') {
        html = `<h2>Histórico de Entradas</h2><br><table class="guia-tabela"><thead><tr><th>Data</th><th>Equipamento</th><th>Qtd</th><th>Destino</th></tr></thead><tbody>`;
        state.historicoEntradas.forEach(e => {
            html += `<tr><td>${escapeHTML(e.dataHora)}</td><td>${escapeHTML(e.equipamentoNome)}</td><td>+${Number(e.quantidade) || 0}</td><td>${escapeHTML(e.instituicao)}</td></tr>`;
        });
        html += `</tbody></table>`;
    } else if (tipo === 'transferencias') {
        html = `<h2>Histórico de Transferências</h2><br><table class="guia-tabela"><thead><tr><th>Data</th><th>Equipamento</th><th>Qtd</th><th>Origem</th><th>Destino</th></tr></thead><tbody>`;
        state.historicoTransferencias.forEach(t => {
            html += `<tr><td>${escapeHTML(t.dataHora)}</td><td>${escapeHTML(t.equipamentoNome)}</td><td>${Number(t.quantidade) || 0}</td><td>${escapeHTML(t.origem)}</td><td>${escapeHTML(t.destino)}</td></tr>`;
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
// Função para substituir o alert() nativo
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
    }, 4000);
}

function atualizarSeriaisDisponiveisTransf() {
    const equipamentoId = document.getElementById('select-equipamento-transf')?.value;
    const origem = document.getElementById('origem-transf')?.value;
    const selectSerials = document.getElementById('serials-transf');

    if (!selectSerials) return;

    selectSerials.innerHTML = '';

    if (!equipamentoId || !origem) {
        selectSerials.innerHTML = '<option disabled selected>Selecione o equipamento e a origem...</option>';
        return;
    }

    const stock = obterStockAtual();
    const itemStock = stock.find(item => 
        String(item.equipamentoId) === String(equipamentoId) && 
        String(item.instituicao).trim().toLowerCase() === String(origem).trim().toLowerCase()
    );

    const serialsDisponiveis = (itemStock && Array.isArray(itemStock.serials)) ? itemStock.serials : [];

    if (serialsDisponiveis.length === 0) {
        const opt = document.createElement('option');
        opt.disabled = true;
        opt.textContent = 'Nenhum Serial Number disponível neste local';
        selectSerials.appendChild(opt);
        return;
    }

    serialsDisponiveis.forEach(sn => {
        const opt = document.createElement('option');
        opt.value = sn;
        opt.textContent = sn;
        selectSerials.appendChild(opt);
    });
}

async function apagarTransferencia(id) {
    const confirmado = await confirmarAcao(
        'Tem a certeza de que deseja anular esta transferência? O equipamento regressará automaticamente à instituição de origem.',
        'Anular Transferência'
    );
    if (!confirmado) return;

    try {
        const res = await fetchComAutenticacao(`${API_URL}/transferencias/${id}`, {
            method: 'DELETE'
        });

        if (!res) return;

        if (res.ok) {
            state.historicoTransferencias = state.historicoTransferencias.filter(item => item.id !== id);
            atualizarTabelaTransferencias();
            atualizarKPIs();
            await carregarDadosDaBD();
            mostrarNotificacao('Transferência anulada com sucesso!', 'success');
        } else {
            const erro = await res.json().catch(() => ({}));
            mostrarNotificacao(erro.error || 'Erro ao anular transferência.', 'error');
        }
    } catch (err) {
        console.error('Erro ao anular transferência:', err);
        mostrarNotificacao('Erro de rede ao tentar anular transferência.', 'error');
    }
}

function mostrarSecao(idSecao) {
    const secoes = document.querySelectorAll('.data-tab');
    secoes.forEach(secao => {
        secao.style.display = 'none';
    });

    const botoes = document.querySelectorAll('.nav-btn');
    botoes.forEach(btn => {
        btn.classList.remove('active');
    });

    const secaoAlvo = document.getElementById(idSecao);
    if (secaoAlvo) {
        secaoAlvo.style.display = 'flex';
    } else {
        console.error(`A secção com o ID "${idSecao}" não foi encontrada.`);
    }

    const botaoAtivo = document.querySelector(`[data-tab="${idSecao}"]`);
    if (botaoAtivo) {
        botaoAtivo.classList.add('active');
    }

}
// ==========================================================================
// 8. Resiliência de Rede (Online / Offline)
// ==========================================================================
window.addEventListener('online', () => {
    mostrarNotificacao('Ligação à rede restabelecida!', 'success');
    carregarDadosDaBD();
});

window.addEventListener('offline', () => {
    mostrarNotificacao('Atenção: Perda de ligação à rede. O sistema está offline.', 'error');
});
