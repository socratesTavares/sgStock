/**
 * Serviço de Auditoria Imutável do sgStock
 * Regista de forma auditável e imutável "quem fez o quê, quando, onde e quais dados foram modificados".
 */

function extrairIp(req) {
    if (!req) return '127.0.0.1';
    return req.headers['x-forwarded-for'] || req.socket?.remoteAddress || req.ip || '127.0.0.1';
}

function extrairUserAgent(req) {
    if (!req) return 'Sistema/Automático';
    return req.headers['user-agent'] || 'Desconhecido';
}

/**
 * Regista um evento de auditoria imutável na base de dados
 */
async function registrarAuditoria(poolOrClient, {
    req = null,
    usuarioId = null,
    usuarioNome = null,
    usuarioEmail = null,
    usuarioPerfil = null,
    instituicaoId = null,
    instituicaoNome = null,
    acao,
    entidade,
    entidadeId = null,
    dadosAnteriores = null,
    dadosNovos = null
}) {
    try {
        const uId = usuarioId || (req?.usuario?.id) || 'sistema';
        const uNome = usuarioNome || (req?.usuario?.nome) || (req?.usuario?.email) || 'Sistema';
        const uEmail = usuarioEmail || (req?.usuario?.email) || null;
        const uPerfil = usuarioPerfil || (req?.usuario?.perfil) || 'sistema';
        const instId = instituicaoId || (req?.usuario?.instituicao_id) || null;
        const instNome = instituicaoNome || (req?.usuario?.instituicao_nome) || null;
        const ip = extrairIp(req);
        const userAgent = extrairUserAgent(req);

        const query = `
            INSERT INTO public.auditoria 
            (usuario_id, usuario_nome, usuario_email, usuario_perfil, instituicao_id, instituicao_nome, acao, entidade, entidade_id, dados_anteriores, dados_novos, ip, user_agent)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            RETURNING id, criado_em
        `;

        const values = [
            uId,
            uNome,
            uEmail,
            uPerfil,
            instId,
            instNome,
            acao,
            entidade,
            entidadeId ? String(entidadeId) : null,
            dadosAnteriores ? JSON.stringify(dadosAnteriores) : null,
            dadosNovos ? JSON.stringify(dadosNovos) : null,
            ip,
            userAgent
        ];

        const res = await poolOrClient.query(query, values);
        return res.rows[0];
    } catch (err) {
        console.error('⚠️ [ERRO AUDITORIA] Falha ao gravar log de auditoria:', err.message);
        return null;
    }
}

/**
 * Consulta registos de auditoria com filtros dinâmicos
 */
async function listarAuditoria(pool, { limite = 100, offset = 0, usuario, acao, entidade, dataInicio, dataFim, instituicao } = {}) {
    const condicoes = [];
    const params = [];
    let idx = 1;

    if (usuario) {
        condicoes.push(`(LOWER(usuario_nome) LIKE LOWER($${idx}) OR LOWER(usuario_id) LIKE LOWER($${idx}) OR LOWER(usuario_email) LIKE LOWER($${idx}))`);
        params.push(`%${usuario}%`);
        idx++;
    }

    if (acao) {
        condicoes.push(`LOWER(acao) = LOWER($${idx})`);
        params.push(acao);
        idx++;
    }

    if (entidade) {
        condicoes.push(`LOWER(entidade) = LOWER($${idx})`);
        params.push(entidade);
        idx++;
    }

    if (instituicao) {
        condicoes.push(`(LOWER(instituicao_nome) LIKE LOWER($${idx}) OR instituicao_id = $${idx})`);
        params.push(`%${instituicao}%`);
        idx++;
    }

    if (dataInicio) {
        condicoes.push(`criado_em >= $${idx}::timestamptz`);
        params.push(dataInicio);
        idx++;
    }

    if (dataFim) {
        condicoes.push(`criado_em <= $${idx}::timestamptz`);
        params.push(dataFim);
        idx++;
    }

    const whereClause = condicoes.length > 0 ? `WHERE ${condicoes.join(' AND ')}` : '';

    const query = `
        SELECT 
            id,
            usuario_id AS "usuarioId",
            usuario_nome AS "usuarioNome",
            usuario_email AS "usuarioEmail",
            usuario_perfil AS "usuarioPerfil",
            instituicao_id AS "instituicaoId",
            instituicao_nome AS "instituicaoNome",
            acao,
            entidade,
            entidade_id AS "entidadeId",
            dados_anteriores AS "dadosAnteriores",
            dados_novos AS "dadosNovos",
            ip,
            user_agent AS "userAgent",
            criado_em AS "criadoEm"
        FROM public.auditoria
        ${whereClause}
        ORDER BY criado_em DESC
        LIMIT $${idx} OFFSET $${idx + 1}
    `;

    params.push(Number(limite) || 100);
    params.push(Number(offset) || 0);

    const result = await pool.query(query, params);
    return result.rows;
}

module.exports = {
    registrarAuditoria,
    listarAuditoria
};
