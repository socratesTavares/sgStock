require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Pool } = require('pg');
const path = require('path');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const app = express();

// 1. Headers de Segurança HTTP (Helmet + CSP)
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            imgSrc: ["'self'", "data:", "https://encrypted-tbn0.gstatic.com"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            upgradeInsecureRequests: null
        }
    },
    crossOriginEmbedderPolicy: false
}));

// 2. Proteção contra Ataques de Força Bruta (Rate Limiting)
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 15, // Máximo de 15 tentativas de login por IP
    message: { error: 'Demasiadas tentativas de login a partir deste IP. Por favor, aguarde 15 minutos antes de tentar novamente.' },
    standardHeaders: true,
    legacyHeaders: false,
});
app.use('/api/login', loginLimiter);

const apiLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minuto
    max: 300, // Máximo de 300 requisições por minuto por IP
    message: { error: 'Limite de requisições excedido. Tente novamente em alguns segundos.' },
    standardHeaders: true,
    legacyHeaders: false,
});
app.use('/api/', apiLimiter);

// 3. Middlewares essenciais
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// Validação mandatória das variáveis de ambiente críticas
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    console.error('❌ [ERRO CRÍTICO] A variável de ambiente JWT_SECRET não está definida no ficheiro .env');
    process.exit(1);
}

// Configuração da conexão PostgreSQL
const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

// Servir ficheiros estáticos (HTML, JS, CSS) da pasta frontend
app.use(express.static(path.join(__dirname, '../frontend')));

// Desativa a cache HTTP em todas as rotas da API para consistência
app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    next();
});

// ==========================================
// MIDDLEWARES DE SEGURANÇA E AUTENTICAÇÃO
// ==========================================

// 1. Middleware de Autenticação JWT (Protege as rotas da API)
function autenticarToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Acesso negado. Token não fornecido.' });
    }

    jwt.verify(token, JWT_SECRET, (err, usuario) => {
        if (err) {
            return res.status(401).json({ error: 'Token inválido ou expirado.' });
        }
        req.usuario = usuario;
        next();
    });
}

// 2. Middleware de Autorização RBAC (Restringe a Administradores)
function verificarAdmin(req, res, next) {
    if (req.usuario && req.usuario.perfil === 'administrador') {
        return next();
    }
    return res.status(403).json({ error: 'Acesso negado. Apenas Administradores podem realizar esta ação.' });
}

// ==========================================
// SEED INICIAL: ADMINISTRADOR
// ==========================================
async function criarAdminInicial() {
    try {
        const res = await pool.query("SELECT COUNT(*) FROM usuarios");
        if (parseInt(res.rows[0].count, 10) === 0) {
            const senhaInicial = process.env.ADMIN_INITIAL_PASSWORD || 'admin123';
            const senhaHash = await bcrypt.hash(senhaInicial, 10);
            await pool.query(
                `INSERT INTO usuarios (id, nome, email, senha, perfil) 
                 VALUES ($1, $2, $3, $4, $5)`,
                ['admin-inicial', 'Administrador Geral', 'admin@sgstock.com', senhaHash, 'administrador']
            );
            console.log('--------------------------------------------------');
            console.log('✅ Utilizador Administrador criado automaticamente!');
            console.log('   Email: admin@sgstock.com');
            console.log('--------------------------------------------------');
        }
    } catch (err) {
        console.error('Erro ao criar admin inicial:', err);
    }
}
criarAdminInicial();

// ==========================================
// ENDPOINTS: AUTENTICAÇÃO & GESTÃO DE UTILIZADORES
// ==========================================

// Função centralizada para registo de novos utilizadores
async function processarRegistoUtilizador(req, res) {
    const { nome, email, senha, perfil } = req.body;

    if (!nome || !email || !senha || !perfil) {
        return res.status(400).json({ error: 'Todos os campos são obrigatórios (nome, email, senha, perfil).' });
    }

    const emailFormatado = email.toLowerCase().trim();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(emailFormatado)) {
        return res.status(400).json({ error: 'Formato de email inválido.' });
    }

    if (senha.length < 6) {
        return res.status(400).json({ error: 'A palavra-passe deve conter pelo menos 6 caracteres.' });
    }

    if (!['administrador', 'tecnico'].includes(perfil)) {
        return res.status(400).json({ error: 'Perfil inválido. Escolha "administrador" ou "tecnico".' });
    }

    try {
        const existe = await pool.query('SELECT id FROM usuarios WHERE LOWER(email) = $1', [emailFormatado]);
        if (existe.rows.length > 0) {
            return res.status(400).json({ error: 'Este email já se encontra registado.' });
        }

        const senhaHash = await bcrypt.hash(senha, 10);
        const novoId = 'user-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6);

        await pool.query(
            'INSERT INTO usuarios (id, nome, email, senha, perfil) VALUES ($1, $2, $3, $4, $5)',
            [novoId, nome.trim(), emailFormatado, senhaHash, perfil]
        );

        res.status(201).json({ message: 'Utilizador registado com sucesso!' });
    } catch (err) {
        console.error('Erro ao registar utilizador:', err);
        res.status(500).json({ error: 'Erro interno ao registar utilizador.' });
    }
}

// Rotas protegidas de registo de utilizadores (acessíveis apenas a Administradores)
app.post('/api/registrar', autenticarToken, verificarAdmin, processarRegistoUtilizador);
app.post('/api/usuarios', autenticarToken, verificarAdmin, processarRegistoUtilizador);

// Login de Utilizador
app.post('/api/login', async (req, res) => {
    try {
        const { email, senha } = req.body;

        if (!email || !senha) {
            return res.status(400).json({ error: 'Por favor, forneça email e palavra-passe.' });
        }

        const result = await pool.query(
            'SELECT * FROM usuarios WHERE LOWER(email) = LOWER($1)',
            [email.trim()]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Credenciais inválidas.' });
        }

        const usuario = result.rows[0];

        const senhaValida = await bcrypt.compare(senha, usuario.senha);
        if (!senhaValida) {
            return res.status(401).json({ error: 'Credenciais inválidas.' });
        }

        const token = jwt.sign(
            { id: usuario.id, nome: usuario.nome, email: usuario.email, perfil: usuario.perfil },
            JWT_SECRET,
            { expiresIn: '8h' }
        );

        res.json({
            message: 'Login efetuado com sucesso!',
            token,
            usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email, perfil: usuario.perfil }
        });

    } catch (err) {
        console.error('Erro no login:', err);
        res.status(500).json({ error: 'Erro interno no servidor ao processar login.' });
    }
});

// ==========================================
// ENDPOINTS: EQUIPAMENTOS
// ==========================================

// Obter todos os equipamentos
app.get('/api/equipamentos', autenticarToken, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, marca, modelo, part_number AS "partNumber" FROM equipamentos ORDER BY marca, modelo'
        );
        res.json(result.rows);
    } catch (err) {
        console.error('Erro ao obter equipamentos:', err);
        res.status(500).json({ error: 'Erro interno ao carregar equipamentos.' });
    }
});

// Cadastrar equipamento
app.post('/api/equipamentos', autenticarToken, async (req, res) => {
    const { id, marca, modelo, partNumber } = req.body;
    if (!marca || !modelo || !partNumber) {
        return res.status(400).json({ error: 'Marca, modelo e part number são obrigatórios.' });
    }

    const eqId = id || Date.now().toString();

    try {
        await pool.query(
            'INSERT INTO equipamentos (id, marca, modelo, part_number) VALUES ($1, $2, $3, $4)',
            [eqId, marca.trim(), modelo.trim(), partNumber.trim()]
        );
        res.status(201).json({ message: 'Equipamento inserido com sucesso', id: eqId });
    } catch (err) {
        console.error('Erro ao cadastrar equipamento:', err);
        if (err.code === '23505') { // Unique violation
            return res.status(400).json({ error: 'Já existe um equipamento com este Part Number.' });
        }
        res.status(500).json({ error: 'Erro interno ao cadastrar equipamento.' });
    }
});

// Atualizar equipamento (PROTEGIDO: Administrador)
app.put('/api/equipamentos/:id', autenticarToken, verificarAdmin, async (req, res) => {
    const { id } = req.params;
    const { marca, modelo, partNumber, novaInstituicao, antigaInstituicao, novosSerials } = req.body;

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 1. Atualizar Ficha Principal do Equipamento
        const equipamentoAtualizado = await client.query(
            'UPDATE equipamentos SET marca = $1, modelo = $2, part_number = $3 WHERE id = $4 RETURNING id',
            [marca, modelo, partNumber, id]
        );

        if (equipamentoAtualizado.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Modelo de equipamento não encontrado.' });
        }

        const novoNome = `${marca} ${modelo} (${partNumber})`;

        // 2. Atualizar Nome do Equipamento em todo o Histórico de Entradas
        await client.query(
            'UPDATE historico_entradas SET equipamento_nome = $1 WHERE equipamento_id = $2',
            [novoNome, id]
        );

        // 3. Atualizar Localização e Serials em historico_entradas
        if (Array.isArray(novosSerials) && novosSerials.length > 0) {
            let resUpdate;

            if (antigaInstituicao) {
                resUpdate = await client.query(
                    `UPDATE historico_entradas 
                     SET instituicao = COALESCE(NULLIF($1, ''), instituicao), serials = $2, quantidade = $3 
                     WHERE equipamento_id = $4 AND LOWER(instituicao) = LOWER($5)`,
                    [novaInstituicao, novosSerials, novosSerials.length, id, antigaInstituicao]
                );
            }

            if (!resUpdate || resUpdate.rowCount === 0) {
                await client.query(
                    `UPDATE historico_entradas 
                     SET instituicao = COALESCE(NULLIF($1, ''), instituicao), serials = $2, quantidade = $3 
                     WHERE id = (
                         SELECT id FROM historico_entradas 
                         WHERE equipamento_id = $4 
                         ORDER BY id ASC LIMIT 1
                     )`,
                    [novaInstituicao, novosSerials, novosSerials.length, id]
                );
            }
        } else if (novaInstituicao && antigaInstituicao) {
            await client.query(
                `UPDATE historico_entradas 
                 SET instituicao = $1 
                 WHERE equipamento_id = $2 AND LOWER(instituicao) = LOWER($3)`,
                [novaInstituicao, id, antigaInstituicao]
            );
        }

        // 4. Atualizar Histórico de Transferências
        await client.query(
            'UPDATE historico_transferencias SET equipamento_nome = $1 WHERE equipamento_id = $2',
            [novoNome, id]
        );

        if (antigaInstituicao && novaInstituicao) {
            await client.query(
                `UPDATE historico_transferencias SET origem = $1 WHERE equipamento_id = $2 AND LOWER(origem) = LOWER($3)`,
                [novaInstituicao, id, antigaInstituicao]
            );
            await client.query(
                `UPDATE historico_transferencias SET destino = $1 WHERE equipamento_id = $2 AND LOWER(destino) = LOWER($3)`,
                [novaInstituicao, id, antigaInstituicao]
            );
        }

        await client.query('COMMIT');
        res.json({ message: 'Equipamento e serial numbers atualizados com sucesso' });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Erro na atualização de equipamento:', err);
        res.status(500).json({ error: 'Erro interno ao atualizar equipamento.' });
    } finally {
        client.release();
    }
});

// Eliminar equipamento por ID (PROTEGIDO: Administrador)
app.delete('/api/equipamentos/:id', autenticarToken, verificarAdmin, async (req, res) => {
    const { id } = req.params;

    try {
        // Validação de Integridade: Não permitir exclusão se houver histórico associado
        const entradas = await pool.query('SELECT id FROM historico_entradas WHERE equipamento_id = $1 LIMIT 1', [id]);
        const transferencias = await pool.query('SELECT id FROM historico_transferencias WHERE equipamento_id = $1 LIMIT 1', [id]);

        if (entradas.rows.length > 0 || transferencias.rows.length > 0) {
            return res.status(409).json({
                error: 'Não é possível eliminar este modelo pois existem entradas ou transferências associadas. A integridade histórica impede esta exclusão.'
            });
        }

        const result = await pool.query('DELETE FROM equipamentos WHERE id = $1 RETURNING *', [id]);

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Modelo de equipamento não encontrado.' });
        }

        res.json({ message: 'Modelo de equipamento eliminado com sucesso!' });
    } catch (err) {
        console.error('Erro ao eliminar equipamento:', err);
        res.status(500).json({ error: 'Erro interno ao eliminar modelo de equipamento.' });
    }
});

// ==========================================
// ENDPOINTS: ENTRADAS DE STOCK
// ==========================================

// Obter histórico de entradas
app.get('/api/entradas', autenticarToken, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, equipamento_id AS "equipamentoId", equipamento_nome AS "equipamentoNome", quantidade, serials, instituicao, data_hora AS "dataHora" FROM historico_entradas ORDER BY criado_em DESC, id DESC'
        );
        res.json(result.rows);
    } catch (err) {
        console.error('Erro ao obter entradas:', err);
        res.status(500).json({ error: 'Erro interno ao carregar entradas.' });
    }
});

// Registar nova entrada
app.post('/api/entradas', autenticarToken, async (req, res) => {
    const { id, equipamentoId, equipamentoNome, quantidade, serials, instituicao, dataHora } = req.body;

    if (!equipamentoId || !equipamentoNome || !instituicao) {
        return res.status(400).json({ error: 'Equipamento e instituição são obrigatórios.' });
    }

    const entradaId = id || Date.now().toString();
    const listaSerials = Array.isArray(serials) ? serials : [];
    const qtd = Number(quantidade) || listaSerials.length || 1;
    const dataRegisto = dataHora || new Date().toLocaleString('pt-PT');

    try {
        await pool.query(
            'INSERT INTO historico_entradas (id, equipamento_id, equipamento_nome, quantidade, serials, instituicao, data_hora) VALUES ($1, $2, $3, $4, $5, $6, $7)',
            [entradaId, equipamentoId, equipamentoNome, qtd, listaSerials, instituicao.trim(), dataRegisto]
        );
        res.status(201).json({ message: 'Entrada registada com sucesso', id: entradaId });
    } catch (err) {
        console.error('Erro ao registar entrada:', err);
        res.status(500).json({ error: 'Erro interno ao registar entrada.' });
    }
});

// Atualizar entrada (PROTEGIDO: Administrador)
app.put('/api/entradas/:id', autenticarToken, verificarAdmin, async (req, res) => {
    const { id } = req.params;
    const { instituicao, serials, quantidade, equipamentoNome } = req.body;

    try {
        const listaSerials = Array.isArray(serials) ? serials : [];

        const result = await pool.query(
            `UPDATE historico_entradas 
             SET instituicao = $1, 
                 serials = $2, 
                 quantidade = $3, 
                 equipamento_nome = $4 
             WHERE id = $5 
             RETURNING *`,
            [instituicao, listaSerials, quantidade, equipamentoNome, id]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Registo de entrada não encontrado.' });
        }

        res.json({ message: 'Entrada atualizada com sucesso', entrada: result.rows[0] });
    } catch (error) {
        console.error('Erro ao atualizar entrada:', error);
        res.status(500).json({ error: 'Erro interno ao atualizar entrada.' });
    }
});

// Eliminar entrada por ID (PROTEGIDO: Administrador)
app.delete('/api/entradas/:id', autenticarToken, verificarAdmin, async (req, res) => {
    const { id } = req.params;

    try {
        const result = await pool.query(
            'DELETE FROM historico_entradas WHERE id = $1 RETURNING *',
            [id]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Registo de entrada não encontrado.' });
        }

        res.json({ message: 'Registo de entrada eliminado com sucesso!' });
    } catch (error) {
        console.error('Erro ao eliminar entrada:', error);
        res.status(500).json({ error: 'Erro interno ao eliminar entrada.' });
    }
});

// ==========================================
// ENDPOINTS: STOCK CONSOLIDADO
// ==========================================

// Consultar stock atual consolidado diretamente da view do PostgreSQL
app.get('/api/stock', autenticarToken, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT equipamento_id AS "equipamentoId", marca, modelo, part_number AS "partNumber", local_atual AS "instituicao", total, serials FROM view_stock_atual ORDER BY marca, modelo, local_atual'
        );
        res.json(result.rows);
    } catch (err) {
        console.error('Erro ao buscar stock consolidado:', err);
        res.status(500).json({ error: 'Erro interno ao consultar posição de stock.' });
    }
});

// Eliminar um número de série do stock e de todo o histórico associado
app.delete('/api/stock/:equipamentoId/serial', autenticarToken, verificarAdmin, async (req, res) => {
    const { equipamentoId } = req.params;
    const serial = String(req.body.serial || '').trim();
    const instituicao = String(req.body.instituicao || '').trim();

    if (!serial || !instituicao) {
        return res.status(400).json({ error: 'O número de série e a instituição são obrigatórios.' });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const equipamento = await client.query(
            'SELECT id FROM equipamentos WHERE id = $1 FOR UPDATE',
            [equipamentoId]
        );

        if (equipamento.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Equipamento não encontrado.' });
        }

        const stockAtual = await client.query(
            `SELECT EXISTS (
                SELECT 1
                FROM view_stock_atual stock
                WHERE stock.equipamento_id = $1
                  AND LOWER(TRIM(stock.local_atual)) = LOWER(TRIM($2))
                  AND EXISTS (
                      SELECT 1
                      FROM unnest(stock.serials) AS serial_atual(valor)
                      WHERE LOWER(TRIM(serial_atual.valor)) = LOWER(TRIM($3))
                  )
            ) AS existe`,
            [equipamentoId, instituicao, serial]
        );

        if (!stockAtual.rows[0].existe) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Este serial não está disponível nesta instituição.' });
        }

        let movimentosAtualizados = 0;
        for (const tabela of ['public.historico_entradas', 'public.historico_transferencias']) {
            const atualizados = await client.query(
                `UPDATE ${tabela} AS movimento
                 SET serials = ARRAY(
                         SELECT serial_atual.valor
                         FROM unnest(movimento.serials) AS serial_atual(valor)
                         WHERE LOWER(TRIM(serial_atual.valor)) <> LOWER(TRIM($1))
                     ),
                     quantidade = (
                         SELECT COUNT(*)::INTEGER
                         FROM unnest(movimento.serials) AS serial_atual(valor)
                         WHERE LOWER(TRIM(serial_atual.valor)) <> LOWER(TRIM($1))
                     )
                 WHERE movimento.equipamento_id = $2
                   AND EXISTS (
                       SELECT 1
                       FROM unnest(movimento.serials) AS serial_atual(valor)
                       WHERE LOWER(TRIM(serial_atual.valor)) = LOWER(TRIM($1))
                   )
                 RETURNING movimento.id, movimento.quantidade`,
                [serial, equipamentoId]
            );

            movimentosAtualizados += atualizados.rowCount;
            const idsVazios = atualizados.rows
                .filter(movimento => Number(movimento.quantidade) === 0)
                .map(movimento => movimento.id);

            if (idsVazios.length > 0) {
                await client.query(`DELETE FROM ${tabela} WHERE id = ANY($1::varchar[])`, [idsVazios]);
            }
        }

        await client.query('COMMIT');
        res.json({
            message: 'Serial removido do stock e do histórico associado.',
            serial,
            movimentosAtualizados
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Erro ao eliminar serial do stock:', error);
        res.status(500).json({ error: 'Erro interno ao eliminar o número de série.' });
    } finally {
        client.release();
    }
});

app.patch('/api/stock/:equipamentoId/serial', autenticarToken, verificarAdmin, async (req, res) => {
    const { equipamentoId } = req.params;
    const serial = String(req.body.serial || '').trim();
    const novoSerial = String(req.body.novoSerial || '').trim();
    const instituicao = String(req.body.instituicao || '').trim();

    if (!serial || !novoSerial || !instituicao) {
        return res.status(400).json({ error: 'O serial atual, o novo serial e a instituição são obrigatórios.' });
    }
    if (serial === novoSerial) {
        return res.status(400).json({ error: 'O novo serial deve ser diferente do serial atual.' });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const equipamento = await client.query(
            'SELECT id FROM equipamentos WHERE id = $1 FOR UPDATE',
            [equipamentoId]
        );
        if (equipamento.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Equipamento não encontrado.' });
        }

        const stockAtual = await client.query(
            `SELECT EXISTS (
                SELECT 1
                FROM view_stock_atual stock
                WHERE stock.equipamento_id = $1
                  AND LOWER(TRIM(stock.local_atual)) = LOWER(TRIM($2))
                  AND EXISTS (
                      SELECT 1
                      FROM unnest(stock.serials) AS serial_atual(valor)
                      WHERE LOWER(TRIM(serial_atual.valor)) = LOWER(TRIM($3))
                  )
            ) AS existe`,
            [equipamentoId, instituicao, serial]
        );
        if (!stockAtual.rows[0].existe) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Este serial não está disponível nesta instituição.' });
        }

        const serialDuplicado = await client.query(
            `SELECT EXISTS (
                SELECT 1 FROM (
                    SELECT equipamento_id, unnest(serials) AS valor FROM public.historico_entradas
                    UNION ALL
                    SELECT equipamento_id, unnest(serials) AS valor FROM public.historico_transferencias
                ) historico
                WHERE LOWER(TRIM(historico.valor)) = LOWER(TRIM($1))
                  AND NOT (
                      historico.equipamento_id = $2
                      AND LOWER(TRIM(historico.valor)) = LOWER(TRIM($3))
                  )
            ) AS existe`,
            [novoSerial, equipamentoId, serial]
        );
        if (serialDuplicado.rows[0].existe) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'Já existe outro equipamento com esse número de série.' });
        }

        let movimentosAtualizados = 0;
        for (const tabela of ['public.historico_entradas', 'public.historico_transferencias']) {
            const resultado = await client.query(
                `UPDATE ${tabela} AS movimento
                 SET serials = ARRAY(
                     SELECT CASE
                         WHEN LOWER(TRIM(serial_atual.valor)) = LOWER(TRIM($1)) THEN $2
                         ELSE serial_atual.valor
                     END
                     FROM unnest(movimento.serials) AS serial_atual(valor)
                 )
                 WHERE movimento.equipamento_id = $3
                   AND EXISTS (
                       SELECT 1
                       FROM unnest(movimento.serials) AS serial_atual(valor)
                       WHERE LOWER(TRIM(serial_atual.valor)) = LOWER(TRIM($1))
                   )`,
                [serial, novoSerial, equipamentoId]
            );
            movimentosAtualizados += resultado.rowCount;
        }

        if (movimentosAtualizados === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'O serial não foi encontrado nos históricos do equipamento.' });
        }

        await client.query('COMMIT');
        res.json({ message: 'Número de série atualizado no stock e nos históricos associados.', serial: novoSerial });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Erro ao atualizar serial do stock:', error);
        res.status(500).json({ error: 'Erro interno ao atualizar o número de série.' });
    } finally {
        client.release();
    }
});

// ==========================================
// ENDPOINTS: TRANSFERÊNCIAS
// ==========================================

// Listar histórico de transferências ativas
app.get('/api/transferencias', autenticarToken, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, equipamento_id AS "equipamentoId", equipamento_nome AS "equipamentoNome", quantidade, serials, origem, destino, data_hora AS "dataHora", COALESCE(cancelado, FALSE) AS "cancelado" FROM historico_transferencias WHERE (cancelado IS NULL OR cancelado = FALSE) ORDER BY id DESC'
        );
        res.json(result.rows);
    } catch (err) {
        console.error('Erro ao buscar transferências:', err);
        res.status(500).json({ error: 'Erro interno ao carregar transferências.' });
    }
});

// Processar Nova Transferência com Transação ACID e Validação de Posse
app.post('/api/transferencias', autenticarToken, async (req, res) => {
    const { id, equipamentoId, equipamentoNome, serials, origem, destino, dataHora } = req.body;

    if (!equipamentoId || !origem || !destino) {
        return res.status(400).json({ error: 'Equipamento, origem e destino são obrigatórios.' });
    }

    const origemFormatada = origem.trim();
    const destinoFormatado = destino.trim();

    if (origemFormatada.toLowerCase() === destinoFormatado.toLowerCase()) {
        return res.status(400).json({ error: 'A instituição de origem e o destino não podem ser iguais.' });
    }

    const listaSerials = Array.isArray(serials) ? serials.map(s => String(s).trim()).filter(Boolean) : [];
    if (listaSerials.length === 0) {
        return res.status(400).json({ error: 'É obrigatório selecionar pelo menos um número de série para transferir.' });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 1. Bloqueia leitura consistente do equipamento
        const eqResult = await client.query(
            'SELECT id, marca, modelo, part_number FROM equipamentos WHERE id = $1 FOR SHARE',
            [equipamentoId]
        );

        if (eqResult.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Equipamento não encontrado.' });
        }

        const eq = eqResult.rows[0];
        const nomeOficial = `${eq.marca} ${eq.modelo} (${eq.part_number})`;

        // 2. Validação de Posse Física: Confirma que todos os seriais estão na instituição de origem
        const stockVerificacao = await client.query(
            `SELECT unnest(serials) AS sn 
             FROM view_stock_atual 
             WHERE equipamento_id = $1 AND LOWER(local_atual) = LOWER($2)`,
            [equipamentoId, origemFormatada]
        );

        const seriaisDisponiveis = new Set(stockVerificacao.rows.map(r => r.sn.toLowerCase()));

        const seriaisInvalidos = listaSerials.filter(sn => !seriaisDisponiveis.has(sn.toLowerCase()));
        if (seriaisInvalidos.length > 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                error: `Os seguintes números de série não estão disponíveis na origem "${origemFormatada}": ${seriaisInvalidos.join(', ')}`
            });
        }

        // 3. Inserção atómica da transferência
        const transfId = id || 'trf-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6);
        const dataMovimento = dataHora || new Date().toLocaleString('pt-PT');

        await client.query(
            `INSERT INTO historico_transferencias 
             (id, equipamento_id, equipamento_nome, quantidade, serials, origem, destino, data_hora, cancelado) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, FALSE)`,
            [transfId, equipamentoId, nomeOficial, listaSerials.length, listaSerials, origemFormatada, destinoFormatado, dataMovimento]
        );

        await client.query('COMMIT');
        res.status(201).json({ message: 'Transferência efetuada e registada com sucesso!', id: transfId });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Erro na transação de transferência:', err);
        res.status(500).json({ error: 'Erro interno ao processar transferência transacional.' });
    } finally {
        client.release();
    }
});

// Anular transferência por ID (PROTEGIDO: Administrador - Soft-Delete com auditoria)
app.delete('/api/transferencias/:id', autenticarToken, verificarAdmin, async (req, res) => {
    const { id } = req.params;
    const usuarioEmail = (req.usuario && req.usuario.email) || 'admin';

    try {
        const result = await pool.query(
            `UPDATE historico_transferencias 
             SET cancelado = TRUE, 
                 cancelado_por = $1, 
                 cancelado_em = CURRENT_TIMESTAMP, 
                 motivo_cancelamento = 'Anulado por Administrador' 
             WHERE id = $2 AND (cancelado IS NULL OR cancelado = FALSE) 
             RETURNING *`,
            [usuarioEmail, id]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Registo de transferência não encontrado ou já se encontra cancelado.' });
        }

        res.json({ message: 'Registo de transferência anulado com sucesso!' });
    } catch (error) {
        console.error('Erro ao anular transferência:', error);
        res.status(500).json({ error: 'Erro interno ao anular transferência.' });
    }
});

// ==========================================
// INICIALIZAÇÃO DO SERVIDOR & GRACEFUL SHUTDOWN
// ==========================================
const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, () => {
    console.log(`🚀 Servidor sgStock ativo em: http://localhost:${PORT}`);
    console.log(`👉 Acesso: http://localhost:${PORT}/login.html`);
});

// Encerramento Gracioso (Graceful Shutdown para PM2 / Ubuntu Server)
function encerrarGraciosamente(sinal) {
    console.log(`\n🛑 Sinal ${sinal} recebido. A iniciar encerramento gracioso...`);
    server.close(() => {
        console.log('✅ Servidor HTTP fechado. A encerrar pool PostgreSQL...');
        pool.end(() => {
            console.log('✅ Conexões PostgreSQL encerradas. Processo concluído.');
            process.exit(0);
        });
    });

    // Timeout forçado de segurança após 10s
    setTimeout(() => {
        console.error('⚠️ Timeout excedido (10s). Encerramento forçado.');
        process.exit(1);
    }, 10000);
}

process.on('SIGTERM', () => encerrarGraciosamente('SIGTERM'));
process.on('SIGINT', () => encerrarGraciosamente('SIGINT'));
