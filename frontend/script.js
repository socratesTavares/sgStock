// ==========================================================================
// 1. Arquitectura e Estado Global
// ==========================================================================

const API_URL = 'http://localhost:3000/api';

const state = {
    equipamentos: [],
    historicoEntradas: [],
    historicoTransferencias: []
};

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
                btnUsuarios.style.display = 'inline-block';
            }
        }
    }

    // 2. Configura a navegação e formulários
    configurarNavegacao();
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
            const res = await fetchComAutenticacao('/api/registrar', {
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

    try {
        // 1. Executa as 3 requisições em paralelo
        const [resEq, resEnt, resTransf] = await Promise.all([
            fetchComAutenticacao(`${API_URL}/equipamentos`),
            fetchComAutenticacao(`${API_URL}/entradas`),
            fetchComAutenticacao(`${API_URL}/transferencias`)
        ]);

        // 2. PROTEÇÃO: Se qualquer resposta for null (ex: redirecionado para login), interrompe sem dar erro
        if (!resEq || !resEnt || !resTransf) {
            return;
        }

        // 3. Verifica se todas as requisições tiveram status 200-299 OK
        if (!resEq.ok || !resEnt.ok || !resTransf.ok) {
            throw new Error(`Falha nas rotas: Eq(${resEq.status}), Ent(${resEnt.status}), Transf(${resTransf.status})`);
        }

        // 4. Converte todas as respostas JSON em paralelo
        const [dadosEq, dadosEnt, dadosTransf] = await Promise.all([
            resEq.json(),
            resEnt.json(),
            resTransf.json()
        ]);

        // 5. Atualiza o state com verificações de segurança
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

        // 6. Esconde o alerta de erro caso a ligação tenha tido sucesso
        if (alertBox) alertBox.style.display = 'none';

        // 7. Atualiza a Interface do Utilizador
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
    if (res.status === 401 || res.status === 403) {
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

    // 1. Preenche os equipamentos
    selectEq.innerHTML = '<option value="">Selecione um equipamento...</option>';
    if (Array.isArray(state.equipamentos)) {
        state.equipamentos.forEach(eq => {
            const opt = document.createElement('option');
            opt.value = eq.id;
            opt.textContent = `${eq.marca} ${eq.modelo} (${eq.partNumber || eq.part_number || ''})`;
            selectEq.appendChild(opt);
        });
    }

    // 2. Preenche as origens usando state.historicoEntradas
    selectOrigem.innerHTML = '<option value="">Selecione a origem...</option>';
    const entradas = Array.isArray(state.historicoEntradas) ? state.historicoEntradas : [];
    
    const locaisUnicos = [...new Set(entradas.map(e => e.instituicao).filter(Boolean))];
    
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
    const stockMap = [];

    // Mapeia todas as entradas registadas (histórico imutável)
    (state.historicoEntradas || []).forEach(entrada => {
        const eqId = String(entrada.equipamento_id || entrada.equipamentoId || '');
        const eqNome = String(entrada.equipamento_nome || entrada.equipamentoNome || '').trim().toLowerCase();

        // Converte os serials da entrada para array limpo
        const serialsEntrada = Array.isArray(entrada.serials)
            ? [...entrada.serials]
            : (typeof entrada.serials === 'string' ? entrada.serials.split(',').map(s => s.trim()) : []);

        // 1. Encontrar transferências associadas a este equipamento E que saíram desta instituição de origem
        const transferenciasDestaOrigem = (state.historicoTransferencias || []).filter(transf => {
            const tEqId = String(transf.equipamento_id || transf.equipamentoId || '');
            const tEqNome = String(transf.equipamento_nome || transf.equipamentoNome || '').trim().toLowerCase();
            
            const mesmoEquipamento = (eqId && tEqId && eqId === tEqId) || (eqNome && tEqNome && eqNome === tEqNome);
            const mesmaOrigem = String(transf.origem || '').trim().toLowerCase() === String(entrada.instituicao || '').trim().toLowerCase();

            return mesmoEquipamento && mesmaOrigem;
        });

        // 2. Calcular o total transferido e acumular serials que saíram
        let quantidadeTransferida = 0;
        const serialsTransferidos = [];

        transferenciasDestaOrigem.forEach(transf => {
            quantidadeTransferida += Number(transf.quantidade) || 0;

            const serialsTransf = Array.isArray(transf.serials)
                ? transf.serials
                : (typeof transf.serials === 'string' ? transf.serials.split(',').map(s => s.trim()) : []);

            serialsTransferidos.push(...serialsTransf);
        });

        // 3. Calcular a quantidade líquida disponível para este lote
        const totalEntrada = Number(entrada.quantidade) || serialsEntrada.length || 1;
        const totalDisponivel = Math.max(0, totalEntrada - quantidadeTransferida);

        // 4. Filtrar os números de série disponíveis (excluindo os transferidos)
        const serialsDisponiveis = serialsEntrada.filter(s => !serialsTransferidos.includes(s));

        // 5. A localização mantém-se a instituição original da entrada no inventário
        const instituicaoAtual = entrada.instituicao || 'N/A';

        // Apenas adiciona ao mapa de stock se ainda houver unidades disponíveis (> 0)
        if (totalDisponivel > 0) {
            stockMap.push({
                entradaId: entrada.id,
                equipamentoId: entrada.equipamento_id || entrada.equipamentoId,
                equipamentoNome: entrada.equipamento_nome || entrada.equipamentoNome,
                instituicao: instituicaoAtual,
                serials: serialsDisponiveis,
                total: totalDisponivel
            });
        }
    });

    return stockMap;
}

// ==========================================================================
// 5. Componentes de Renderização e UI
// ==========================================================================

function atualizarKPIs() {
    document.getElementById('kpi-total-modelos').textContent = state.equipamentos.length;

    const stock = obterStockAtual();
    const totalUnidades = stock.reduce((acc, item) => acc + item.total, 0);
    document.getElementById('kpi-total-unidades').textContent = totalUnidades;

    document.getElementById('kpi-total-entradas').textContent = state.historicoEntradas.length;
    document.getElementById('kpi-total-transferencias').textContent = state.historicoTransferencias.length;
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
    corpo.innerHTML = '';

    if (state.equipamentos.length === 0) {
        corpo.innerHTML = '<tr><td colspan="7" style="text-align:center;">Nenhum equipamento cadastrado.</td></tr>';
        return;
    }

    const stockCalculado = obterStockAtual();

    state.equipamentos.forEach(eq => {
        const registos = stockCalculado.filter(s => s.equipamentoId === eq.id && s.total > 0);

        if (registos.length === 0) {
            // Modelo sem unidades em stock
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${eq.marca}</td>
                <td>${eq.modelo}</td>
                <td>${eq.partNumber}</td>
                <td>-</td>
                <td><em>Sem stock disponível</em></td>
                <td><strong>0</strong></td>
                <td class="text-right">
                    <button class="btn btn-sm btn-secondary" onclick="abrirModalEditar('${eq.id}', '', '', [])">Editar Modelo</button>
                    <button class="btn btn-sm btn-danger" onclick="eliminarModeloGlobal('${eq.id}', '${eq.marca} ${eq.modelo}')">Apagar Modelo</button>
                </td>
            `;
            corpo.appendChild(tr);
        } else {
            // Unidades com entrada registada
            registos.forEach(item => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${eq.marca}</td>
                    <td>${eq.modelo}</td>
                    <td>${eq.partNumber}</td>
                    <td><small>${item.serials && item.serials.length > 0 ? item.serials.join(', ') : 'N/A'}</small></td>
                    <td>${item.instituicao}</td>
                    <td><strong>${item.total}</strong></td>
                    <td class="text-right">
                        <button class="btn btn-sm btn-secondary" 
        onclick="abrirModalEditar('${eq.id}', '${item.entradaId}', '${encodeURIComponent(item.instituicao)}', JSON.parse(decodeURIComponent('${encodeURIComponent(JSON.stringify(item.serials))}')))">
    Editar
</button>
                        <button class="btn btn-sm btn-danger" onclick="eliminarRegistoLinha('${item.entradaId}', '${eq.marca} ${eq.modelo}', '${item.instituicao}')">Eliminar</button>
                    </td>
                `;
                corpo.appendChild(tr);
            });
        }
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
    corpo.innerHTML = '';

    if (state.historicoEntradas.length === 0) {
        corpo.innerHTML = '<tr><td colspan="4" style="text-align:center;">Nenhuma entrada registada.</td></tr>';
        return;
    }

    [...state.historicoEntradas].reverse().forEach(e => {
        const serialsTexto = e.serials ? e.serials.join(', ') : 'N/A';
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${e.dataHora}</td>
            <td>${e.equipamentoNome}<br><small style="color:var(--text-muted)">S/N: ${serialsTexto}</small></td>
            <td>+${e.quantidade}</td>
            <td>${e.instituicao}</td>
        `;
        corpo.appendChild(tr);
    });
}

function atualizarTabelaTransferencias() {
    const corpo = document.getElementById('corpo-tabela-transferencias');
    corpo.innerHTML = '';

    if (state.historicoTransferencias.length === 0) {
        corpo.innerHTML = '<tr><td colspan="5" style="text-align:center;">Nenhuma transferência registada.</td></tr>';
        return;
    }

    [...state.historicoTransferencias].reverse().forEach(t => {
        const serialsTexto = t.serials ? t.serials.join(', ') : 'N/A';
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${t.dataHora}</td>
            <td>${t.equipamentoNome}<br><small style="color:var(--text-muted)">S/N: ${serialsTexto}</small></td>
            <td>${t.quantidade}</td>
            <td>${t.origem}</td>
            <td>${t.destino}</td>
        `;
        corpo.appendChild(tr);
    });
}

function atualizarResumoMovimentacoes() {
    const corpo = document.getElementById('corpo-tabela-resumo-movimentacoes');
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
        tr.innerHTML = `
            <td>${m.dataHora}</td>
            <td><span class="btn-sm ${m.tipo === 'Entrada' ? 'btn-success' : 'btn-primary'}">${m.tipo}</span></td>
            <td>${m.equipamentoNome}</td>
            <td>${m.quantidade}</td>
            <td>${m.instituicao || m.destino}</td>
        `;
        corpo.appendChild(tr);
    });
}

// ==========================================================================
// 6. Formulários e Submissões
// ==========================================================================

function configurarFormularios() {
    // Registar Modelo
    document.getElementById('form-equipamento').addEventListener('submit', async (e) => {
        e.preventDefault();
        const marca = document.getElementById('marca').value.trim();
        const modelo = document.getElementById('modelo').value.trim();
        const partNumber = document.getElementById('part-number').value.trim();

        if (state.equipamentos.some(eq => eq.partNumber.toLowerCase() === partNumber.toLowerCase())) {
            mostrarNotificacao('Atenção: Já existe um modelo cadastrado com este Part Number!');
            return;
        }

        const novoEquipamento = { id: Date.now().toString(), marca, modelo, partNumber };

        try {
            const res = await fetchComAutenticacao(`${API_URL}/equipamentos`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(novoEquipamento)
            });

            if (res.ok) {
                fecharModal('modal-modelo');
                await carregarDadosDaBD();
                mostrarNotificacao('Modelo cadastrado com sucesso!');
            }
        } catch (error) {
            mostrarNotificacao('Erro ao comunicar com o servidor.');
        }
    });
    document.getElementById('select-equipamento-transf').addEventListener('change', atualizarSeriaisDisponiveisTransf);
    document.getElementById('origem-transf').addEventListener('change', atualizarSeriaisDisponiveisTransf);

    // Registar Entrada
    document.getElementById('form-entrada').addEventListener('submit', async (e) => {
        e.preventDefault();
        const equipamentoId = document.getElementById('select-equipamento').value;
        const rawSerials = document.getElementById('serial-numbers').value;
        const instituicao = document.getElementById('instituicao').value.trim();

        const listaSerials = rawSerials.split(/[\n,]+/).map(s => s.trim()).filter(s => s.length > 0);
        const equipamento = state.equipamentos.find(eq => eq.id === equipamentoId);

        if (!equipamento || listaSerials.length === 0 || !instituicao) return;

        const novaEntrada = {
            id: Date.now().toString(),
            equipamentoId: equipamento.id,
            equipamentoNome: `${equipamento.marca} ${equipamento.modelo} (${equipamento.partNumber})`,
            quantidade: listaSerials.length,
            serials: listaSerials,
            instituicao,
            dataHora: new Date().toLocaleString('pt-PT')
        };

        try {
            const res = await fetchComAutenticacao(`${API_URL}/entradas`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(novaEntrada)
            });

            if (res.ok) {
                fecharModal('modal-entrada');
                await carregarDadosDaBD();
                mostrarNotificacao('Entrada registada com sucesso!');
            }
        } catch (error) {
            mostrarNotificacao('Erro ao guardar entrada.');
        }
    });

    // Dynamic Select de Origem para Transferência
    document.getElementById('select-equipamento-transf').addEventListener('change', (e) => {
        const eqId = e.target.value;
        const origemSelect = document.getElementById('origem-transf');
        origemSelect.innerHTML = '<option value="">-- Selecione a origem --</option>';

        if (!eqId) return;

        const stock = obterStockAtual().filter(item => item.equipamentoId === eqId && item.total > 0);
        stock.forEach(item => {
            const opt = document.createElement('option');
            opt.value = item.instituicao;
            opt.textContent = `${item.instituicao} (${item.total} disponíveis)`;
            origemSelect.appendChild(opt);
        });
    });

    // Transferência
    document.getElementById('form-transferencia').addEventListener('submit', async (e) => {
    e.preventDefault();

    const equipamentoId = document.getElementById('select-equipamento-transf').value;
    const origem = document.getElementById('origem-transf').value;
    const destino = document.getElementById('destino-transf').value.trim();
    const selectSerials = document.getElementById('serials-transf');

    // Captura apenas os elementos selecionados no dropdown múltiplo
    const listaSerials = Array.from(selectSerials.selectedOptions).map(opt => opt.value);

    if (listaSerials.length === 0) {
        mostrarNotificacao('Por favor, selecione pelo menos um número de série.', 'error');
        return;
    }

    const equipamento = state.equipamentos.find(eq => eq.id.toString() === equipamentoId.toString());

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

    try {
        const res = await fetchComAutenticacao(`${API_URL}/transferencias`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(novaTransferencia)
        });

        if (res.ok) {
            fecharModal('modal-transferencia');
            await carregarDadosDaBD();
            mostrarNotificacao('Transferência efetuada com sucesso!', 'success');
            
        } else {
            mostrarNotificacao('Erro ao registar transferência no servidor.', 'error');
        }
    } catch (error) {
        console.error('Erro na transferência:', error);
        mostrarNotificacao('Erro ao registar transferência.', 'error');
    }
});

    // Editar Equipamento
    document.getElementById('form-editar-equipamento').addEventListener('submit', async (e) => {
        e.preventDefault();

        console.log('Submetendo edição de equipamento...');

        const equipamentoId = document.getElementById('edit-id').value;
        const entradaId = document.getElementById('edit-entrada-id').value;

        const marca = document.getElementById('edit-marca').value.trim();
        const modelo = document.getElementById('edit-modelo').value.trim();
        const partNumber = document.getElementById('edit-part-number').value.trim();

        const instituicao = document.getElementById('edit-instituicao').value.trim();
        const rawSerials = document.getElementById('edit-serials').value;
        const serials = rawSerials.split(/[\n,]+/).map(sn => sn.trim()).filter(sn => sn.length > 0);

        try {
            // 1. Atualiza as informações do Modelo (Marca, Modelo, Part Number)
            const resModelo = await fetchComAutenticacao(`${API_URL}/equipamentos/${equipamentoId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ marca, modelo, partNumber })
            });

            if (!resModelo.ok) throw new Error('Erro ao atualizar modelo de equipamento');

            // 2. Se o item possui um registo de entrada/stock, atualiza o Local e os Seriais
            if (entradaId) {
                console.log(`Enviando requisição PUT para: ${API_URL}/entradas/${entradaId}`);

                const resEntrada = await fetchComAutenticacao(`${API_URL}/entradas/${entradaId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        equipamentoId,
                        equipamentoNome: `${marca} ${modelo} (${partNumber})`,
                        instituicao,
                        serials,
                        quantidade: serials.length
                    })
                });

                if (!resEntrada.ok) {
                    const detalheServidor = await resEntrada.text();
                    console.error('Resposta de erro do servidor:', resEntrada.status, detalheServidor);
                    throw new Error(`Erro ${resEntrada.status} no servidor: ${detalheServidor}`);
                }
            }

            fecharModal('modal-editar');
            await carregarDadosDaBD();
            mostrarNotificacao('Inventário atualizado com sucesso!', 'success');
        } catch (error) {
            console.error('Erro na edição:', error);
            console.log('Detalhes do erro:', error.message);
            mostrarNotificacao('Não foi possível salvar as alterações.', 'error');
        }
    });
}

function abrirModalEditar(equipamentoId, entradaId = '', instituicao = '', serials = []) {
    console.log('Abrindo modal de edição para equipamentoId:', equipamentoId, 'entradaId:', entradaId, 'instituicao:', instituicao, 'serials:', serials);
    const eq = state.equipamentos.find(item => item.id === equipamentoId);
    if (!eq) return;

    // Preenche IDs
    document.getElementById('edit-id').value = eq.id;
    document.getElementById('edit-entrada-id').value = entradaId;

    // Preenche dados do modelo
    document.getElementById('edit-marca').value = eq.marca;
    document.getElementById('edit-modelo').value = eq.modelo;
    document.getElementById('edit-part-number').value = eq.partNumber;

    // Preenche dados do registo de stock
    document.getElementById('edit-instituicao').value = instituicao;
    document.getElementById('edit-serials').value = Array.isArray(serials) ? serials.join('\n') : serials;

    abrirModal('modal-editar');
}

async function apagarEntrada(id) {
    if (!confirm('Deseja realmente apagar esta entrada?')) return;

    try {
        const res = await fetchComAutenticacao(`${API_URL}/entradas/${id}`, {
            method: 'DELETE'
        });

        if (!res) return;

        if (res.ok) {
            // 1. Remove o item diretamente do state local
            state.historicoEntradas = state.historicoEntradas.filter(item => item.id !== id);

            // 2. Atualiza a tabela e as estatísticas no ecrã imediatamente
            atualizarTabelaHistorico();
            atualizarKPIs();

            // 3. (Opcional) Recarrega os dados do servidor para sincronização completa
            await carregarDadosDaBD();

            mostrarNotificacao('Registo eliminado com sucesso!', 'sucesso');
        } else {
            const erro = await res.json();
            mostrarNotificacao(erro.error || 'Erro ao apagar registo.', 'erro');
        }
    } catch (err) {
        console.error('Erro ao apagar registo:', err);
    }
}

async function eliminarRegistoLinha(entradaId, nomeModelo, instituicao) {
    if (!confirm(`Deseja remover as unidades de "${nomeModelo}" em "${instituicao}"?`)) return;

    try {
        const res = await fetchComAutenticacao(`${API_URL}/entradas/${entradaId}`, { method: 'DELETE' });
        if (res.ok) {
            await carregarDadosDaBD();
            mostrarNotificacao('Registo eliminado com sucesso!');
        }
    } catch (error) {
        mostrarNotificacao('Erro ao eliminar registo.');
    }
}

async function eliminarModeloGlobal(equipamentoId, nomeModelo) {
    if (!confirm(`Deseja apagar definitivamente o modelo "${nomeModelo}"?`)) return;

    try {
        const res = await fetchComAutenticacao(`${API_URL}/equipamentos/${equipamentoId}`, { method: 'DELETE' });
        if (res.ok) {
            await carregarDadosDaBD();
            mostrarNotificacao('Modelo eliminado com sucesso!');
        }
    } catch (error) {
        mostrarNotificacao('Erro ao eliminar modelo.');
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
        const stockCalculado = obterStockAtual().filter(s => s.total > 0);
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

        html = `
            <div class="guia-container">
                <div class="guia-header">
                    <img src="${EMBLEMA_MOCAMBIQUE_URL}" class="emblema" alt="Emblema">
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
                    Em resposta à solicitação de alocação e transporte do equipamento abaixo descrito, pertencente à MoRENet, declara-se que o mesmo se encontra devidamente autorizado a ser levantado e a sair das instalações do <strong>${transf.origem}</strong>, com destino às instalações da <strong>${transf.destino}</strong>.
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
                            <td>${eq ? `${eq.marca}${eq.modelo}` : transf.equipamentoNome}</td>
                            <td>${eq ? eq.partNumber : 'N/A'}</td>
                            <td>${transf.serials.join('<br>')}</td>
                        </tr>
                    </tbody>
                </table>

                <div class="guia-texto">
                    Pelo que, o referido equipamento e os seus respetivos acessórios encontram-se acondicionados na embalagem de fábrica, completos, em conformidade e prontos para o seu transporte e posterior instalação na <strong>${transf.destino}</strong>.
                </div>

                <div style="margin-top: 1.5rem; text-align: center;">
                    Maputo, ${dataHoje.getDate()} de ${dataHoje.toLocaleString('pt-PT', { month: 'long' })} de ${dataHoje.getFullYear()}
                </div>

                <div class="guia-assinaturas">
                    <div class="guia-assinatura-box">
                        <div>Repart. de Património:</div>
                        <div class="guia-espaco-assinatura"></div>
                        <div class="guia-linha-nome">_______________________</div>
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
            <p>Emitido em: ${new Date().toLocaleString('pt-PT')}</p><br>
            <table class="guia-tabela">
                <thead>
                    <tr><th>Equipamento</th><th>Part Number</th><th>Localização</th><th>Serial Numbers</th><th>Total</th></tr>
                </thead>
                <tbody>
        `;
        obterStockAtual().filter(s => s.total > 0).forEach(item => {
            const eq = state.equipamentos.find(e => e.id === item.equipamentoId);
            if (eq) {
                html += `<tr><td>${eq.marca} ${eq.modelo}</td><td>${eq.partNumber}</td><td>${item.instituicao}</td><td><small>${item.serials.join(', ')}</small></td><td><strong>${item.total}</strong></td></tr>`;
            }
        });
        html += `</tbody></table>`;
    } else if (tipo === 'entradas') {
        html = `<h2>Histórico de Entradas</h2><br><table class="guia-tabela"><thead><tr><th>Data</th><th>Equipamento</th><th>Qtd</th><th>Destino</th></tr></thead><tbody>`;
        state.historicoEntradas.forEach(e => {
            html += `<tr><td>${e.dataHora}</td><td>${e.equipamentoNome}</td><td>+${e.quantidade}</td><td>${e.instituicao}</td></tr>`;
        });
        html += `</tbody></table>`;
    } else if (tipo === 'transferencias') {
        html = `<h2>Histórico de Transferências</h2><br><table class="guia-tabela"><thead><tr><th>Data</th><th>Equipamento</th><th>Qtd</th><th>Origem</th><th>Destino</th></tr></thead><tbody>`;
        state.historicoTransferencias.forEach(t => {
            html += `<tr><td>${t.dataHora}</td><td>${t.equipamentoNome}</td><td>${t.quantidade}</td><td>${t.origem}</td><td>${t.destino}</td></tr>`;
        });
        html += `</tbody></table>`;
    }

    areaPreview.innerHTML = html;
}

function executarImpressao() {
    window.print();
}
// Função para substituir o alert() nativo
function mostrarNotificacao(mensagem, tipo = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${tipo}`;
    toast.innerHTML = `
        <span>${mensagem}</span>
        <button class="toast-close" onclick="this.parentElement.remove()">&times;</button>
    `;

    container.appendChild(toast);

    // Remove automaticamente após 4 segundos
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

    // Usa a propriedade correta: state.historicoEntradas
    const entradas = (state && Array.isArray(state.historicoEntradas)) ? state.historicoEntradas : [];

    // Filtra as entradas correspondentes
    const entradasCorrespondentes = entradas.filter(ent => {
        const idEntrada = (ent.equipamentoId || ent.equipamento_id || '').toString();
        const instEntrada = (ent.instituicao || '').toString().trim().toLowerCase();
        
        return idEntrada === equipamentoId.toString() && instEntrada === origem.trim().toLowerCase();
    });

    let serialsDisponiveis = [];

    entradasCorrespondentes.forEach(ent => {
        let lista = ent.serials;

        if (typeof lista === 'string') {
            try {
                lista = JSON.parse(lista);
            } catch (e) {
                lista = lista.split(/[\n,]+/).map(s => s.trim());
            }
        }

        if (Array.isArray(lista)) {
            serialsDisponiveis.push(...lista);
        }
    });

    serialsDisponiveis = [...new Set(serialsDisponiveis.map(s => s.toString().trim()))].filter(s => s.length > 0);

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

// Função para alternar entre as abas/secções do Dashboard (Fora de qualquer outra função)
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