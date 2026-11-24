/**
 * Serviço de Exportação e Importação CSV/Excel
 * Compatibilidade nativa com Microsoft Excel através de UTF-8 com BOM (\uFEFF)
 * sgStock - MoRENet / MCTD
 */

const UTF8_BOM = '\uFEFF';
const DELIMITER = ';';

/**
 * Escapa uma célula individual para conformidade com RFC 4180
 */
function sanitizarCelula(valor) {
    if (valor === null || valor === undefined) return '';
    let str = String(valor).trim();
    if (str.includes(DELIMITER) || str.includes('"') || str.includes('\n') || str.includes('\r')) {
        str = `"${str.replace(/"/g, '""')}"`;
    }
    return str;
}

/**
 * Formata um array de objetos num CSV com UTF-8 BOM
 */
function construirCsv(colunas, dados, formatadorLinha) {
    const cabecalho = colunas.map(sanitizarCelula).join(DELIMITER);
    const linhas = dados.map(item => {
        const valores = formatadorLinha(item);
        return valores.map(sanitizarCelula).join(DELIMITER);
    });

    return UTF8_BOM + [cabecalho, ...linhas].join('\r\n');
}

/**
 * Exportações Oficiais Formatadas
 */
function gerarCsvInventario(dados) {
    const colunas = [
        'Marca',
        'Modelo',
        'Part Number (P/N)',
        'Categoria',
        'Localização / Instituição',
        'Quantidade Disponível',
        'Números de Série (S/N)',
        'Capacidade de Banda',
        'Portas'
    ];

    return construirCsv(colunas, dados, item => [
        item.marca || '',
        item.modelo || '',
        item.partNumber || item.part_number || '',
        item.categoria || 'Geral',
        item.instituicao || item.local_atual || '',
        item.total || 0,
        Array.isArray(item.serials) ? item.serials.join(' | ') : (item.serials || ''),
        item.capacidade_banda || item.capacidadeBanda || '',
        item.portas || ''
    ]);
}

function gerarCsvEntradas(dados) {
    const colunas = [
        'ID Registo',
        'Data / Hora',
        'Equipamento',
        'Quantidade',
        'Números de Série (S/N)',
        'Instituição Destino',
        'Nº da Fatura',
        'Fornecedor',
        'Data de Aquisição',
        'Custo Unitário',
        'Moeda',
        'Estado Físico'
    ];

    return construirCsv(colunas, dados, item => [
        item.id || '',
        item.dataHora || item.data_hora || '',
        item.equipamentoNome || item.equipamento_nome || '',
        item.quantidade || 0,
        Array.isArray(item.serials) ? item.serials.join(' | ') : (item.serials || ''),
        item.instituicao || '',
        item.faturaNumero || item.fatura_numero || '',
        item.fornecedorNome || item.fornecedor_nome || '',
        item.dataAquisicao ? new Date(item.dataAquisicao).toISOString().slice(0, 10) : '',
        item.custoUnitario || item.custo_unitario || '',
        item.moeda || 'MZN',
        item.estadoFisico || item.estado_fisico || 'novo'
    ]);
}

function gerarCsvTransferencias(dados) {
    const colunas = [
        'ID Transferência',
        'Data / Hora',
        'Equipamento',
        'Quantidade',
        'Números de Série (S/N)',
        'Instituição de Origem',
        'Instituição de Destino',
        'Responsável Transporte',
        'Matrícula Viatura',
        'Signatário Legal',
        'Estado / Cancelado'
    ];

    return construirCsv(colunas, dados, item => [
        item.id || '',
        item.dataHora || item.data_hora || '',
        item.equipamentoNome || item.equipamento_nome || '',
        item.quantidade || 0,
        Array.isArray(item.serials) ? item.serials.join(' | ') : (item.serials || ''),
        item.origem || '',
        item.destino || '',
        item.responsavelTransporte || item.responsavel_transporte || '',
        item.matriculaViatura || item.matricula_viatura || '',
        item.signatarioNome || item.signatario_nome || '',
        item.cancelado ? 'Cancelado / Anulado' : 'Ativo / Em Trânsito'
    ]);
}

function gerarCsvAuditoria(dados) {
    const colunas = [
        'ID Auditoria',
        'Data / Hora (UTC)',
        'Utilizador',
        'Perfil',
        'Instituição',
        'Ação Executada',
        'Entidade Afetada',
        'ID da Entidade',
        'Endereço IP',
        'Agente (Navegador)',
        'Dados Anteriores',
        'Dados Novos'
    ];

    return construirCsv(colunas, dados, item => [
        item.id || '',
        item.criadoEm || item.criado_em || '',
        item.usuarioNome || item.usuario_nome || '',
        item.usuarioPerfil || item.usuario_perfil || '',
        item.instituicaoNome || item.instituicao_nome || '',
        item.acao || '',
        item.entidade || '',
        item.entidadeId || item.entidade_id || '',
        item.ip || '',
        item.userAgent || item.user_agent || '',
        typeof item.dadosAnteriores === 'object' ? JSON.stringify(item.dadosAnteriores) : (item.dadosAnteriores || ''),
        typeof item.dadosNovos === 'object' ? JSON.stringify(item.dadosNovos) : (item.dadosNovos || '')
    ]);
}

function gerarCsvAssetHealth(dados) {
    const colunas = [
        'Marca',
        'Modelo',
        'Part Number (P/N)',
        'Número de Série (S/N)',
        'Localização Atual',
        'Data de Aquisição',
        'Custo Unitário',
        'Moeda',
        'Expectativa Vida Útil (Anos)',
        'Idade Operacional (Anos)',
        'Total de Avarias Registadas',
        'Estado Físico',
        'Classificação de Saúde',
        'Ação Recomendada'
    ];

    return construirCsv(colunas, dados, item => [
        item.marca || '',
        item.modelo || '',
        item.part_number || item.partNumber || '',
        item.serial || '',
        item.local_atual || item.localAtual || '',
        item.data_aquisicao ? new Date(item.data_aquisicao).toISOString().slice(0, 10) : '',
        item.custo_unitario || item.custoUnitario || '',
        item.moeda || 'MZN',
        item.vida_util_anos || item.vidaUtilAnos || '',
        item.idade_anos !== undefined ? Number(item.idade_anos).toFixed(1) : '',
        item.total_avarias || 0,
        item.estado_fisico || item.estadoFisico || '',
        item.classificacao_saude || item.classificacaoSaude || '',
        item.acao_recomendada || item.acaoRecomendada || ''
    ]);
}

/**
 * Parser de CSV simples e robusto com suporte a delimitadores ',' ou ';' e aspas duplas
 */
function parseCsv(textoCsv) {
    if (!textoCsv) return [];
    // Remove BOM se presente
    let limpo = textoCsv.replace(/^\uFEFF/, '');
    
    // Normaliza quebras de linha
    const linhasBrutas = limpo.split(/\r?\n/).filter(l => l.trim().length > 0);
    if (linhasBrutas.length === 0) return [];

    // Detetar delimitador da primeira linha (; ou ,)
    const primeiraLinha = linhasBrutas[0];
    const delimitador = (primeiraLinha.split(';').length >= primeiraLinha.split(',').length) ? ';' : ',';

    function dividirLinha(linha) {
        const resultado = [];
        let atual = '';
        let dentroDeAspas = false;

        for (let i = 0; i < linha.length; i++) {
            const char = linha[i];
            const proximoChar = linha[i + 1];

            if (char === '"') {
                if (dentroDeAspas && proximoChar === '"') {
                    atual += '"';
                    i++; // Pula próxima aspa escapada
                } else {
                    dentroDeAspas = !dentroDeAspas;
                }
            } else if (char === delimitador && !dentroDeAspas) {
                resultado.push(atual.trim());
                atual = '';
            } else {
                atual += char;
            }
        }
        resultado.push(atual.trim());
        return resultado;
    }

    const cabecalho = dividirLinha(linhasBrutas[0]).map(c => c.toLowerCase().replace(/[^a-z0-9_]/g, ''));
    const linhas = [];

    for (let i = 1; i < linhasBrutas.length; i++) {
        const cols = dividirLinha(linhasBrutas[i]);
        if (cols.length === 0 || cols.every(c => !c)) continue;
        
        const obj = {};
        cabecalho.forEach((colNome, idx) => {
            obj[colNome] = cols[idx] !== undefined ? cols[idx] : '';
        });
        obj._rawIndex = i + 1;
        linhas.push(obj);
    }

    return linhas;
}

/**
 * Importação em Lote via Transação ACID no PostgreSQL
 */
async function importarStockCsv({ pool, textoCsv, usuario, instituicaoPadrao }) {
    const linhas = parseCsv(textoCsv);
    if (linhas.length === 0) {
        throw new Error('O ficheiro CSV está vazio ou contém um formato de cabeçalho inválido.');
    }

    const client = await pool.connect();
    const resultado = {
        totalLinhas: linhas.length,
        modelosCriados: 0,
        entradasCriadas: 0,
        totalSerials: 0,
        erros: []
    };

    try {
        await client.query('BEGIN');

        for (const linha of linhas) {
            // Mapeamento flexível de colunas
            const marca = linha.marca || linha.brand || '';
            const modelo = linha.modelo || linha.model || '';
            const partNumber = linha.partnumber || linha.part_number || linha.pn || '';
            const categoria = linha.categoria || linha.category || 'Geral';
            const instituicao = linha.instituicao || linha.instituio || linha.localizacao || linha.local || instituicaoPadrao || 'MCTD Sede';
            const fatura = linha.fatura || linha.nfatura || linha.numerofatura || linha.invoice || '';
            const fornecedor = linha.fornecedor || linha.supplier || 'Fornecedor Padrão';
            const custo = parseFloat(linha.custounitario || linha.custo || linha.preco || '0') || 0;
            const dataAquisicao = linha.dataaquisicao || linha.data || new Date().toISOString().slice(0, 10);
            const estadoFisico = (linha.estadofisico || linha.estado || 'novo').toLowerCase();

            // Seriais podem vir separados por vírgula, barra ou ponto e vírgula
            const rawSerials = linha.serials || linha.numerosdeserie || linha.sn || linha.serial || '';
            const listaSerials = rawSerials
                .split(/[,|;]+/)
                .map(s => s.trim())
                .filter(Boolean);

            if (!marca || !modelo || !partNumber) {
                resultado.erros.push(`Linha ${linha._rawIndex}: Marca, Modelo e Part Number são obrigatórios.`);
                continue;
            }

            if (listaSerials.length === 0) {
                resultado.erros.push(`Linha ${linha._rawIndex}: Pelo menos um Número de Série (S/N) deve ser informado.`);
                continue;
            }

            // 1. Procurar ou Criar Equipamento
            let eqId;
            const eqExistente = await client.query(
                'SELECT id FROM equipamentos WHERE LOWER(part_number) = LOWER($1)',
                [partNumber.trim()]
            );

            if (eqExistente.rows.length > 0) {
                eqId = eqExistente.rows[0].id;
            } else {
                eqId = 'eq-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6);
                await client.query(
                    `INSERT INTO equipamentos (id, marca, modelo, part_number, categoria) 
                     VALUES ($1, $2, $3, $4, $5)`,
                    [eqId, marca.trim(), modelo.trim(), partNumber.trim(), categoria.trim()]
                );
                resultado.modelosCriados++;
            }

            // 2. Registar Entrada de Stock
            const entradaId = 'ent-import-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6);
            const nomeOficial = `${marca.trim()} ${modelo.trim()} (${partNumber.trim()})`;

            await client.query(
                `INSERT INTO historico_entradas 
                 (id, equipamento_id, equipamento_nome, quantidade, serials, instituicao, data_hora, fatura_numero, fornecedor_nome, data_aquisicao, custo_unitario, estado_fisico)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
                [
                    entradaId,
                    eqId,
                    nomeOficial,
                    listaSerials.length,
                    listaSerials,
                    instituicao.trim(),
                    new Date().toLocaleString('pt-PT'),
                    fatura.trim() || null,
                    fornecedor.trim() || null,
                    dataAquisicao,
                    custo,
                    ['novo', 'operacional', 'avariado', 'abatido'].includes(estadoFisico) ? estadoFisico : 'novo'
                ]
            );

            resultado.entradasCriadas++;
            resultado.totalSerials += listaSerials.length;
        }

        if (resultado.entradasCriadas === 0 && resultado.erros.length > 0) {
            await client.query('ROLLBACK');
            throw new Error(`Falha na importação. Nenhum registo válido encontrado. Erros: ${resultado.erros.slice(0, 3).join('; ')}`);
        }

        await client.query('COMMIT');
        return resultado;

    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

module.exports = {
    gerarCsvInventario,
    gerarCsvEntradas,
    gerarCsvTransferencias,
    gerarCsvAuditoria,
    gerarCsvAssetHealth,
    parseCsv,
    importarStockCsv
};
