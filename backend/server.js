const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const { randomUUID } = require('crypto');
const { gerarSvgQRCode } = require('../frontend/qrcode');

// Serviços modulares
const { registrarAuditoria, listarAuditoria } = require('./services/auditService');
const { 
    enviarEmail, 
    enviarAlertaStockCritico, 
    enviarAlertaAtivosFimDeVida, 
    enviarAlertaOperacaoSensivel, 
    enviarBackupLogsAuditoria 
} = require('./services/emailService');
const { 
    gerarCsvInventario, 
    gerarCsvEntradas, 
    gerarCsvTransferencias, 
    gerarCsvAuditoria, 
    gerarCsvAssetHealth, 
    importarStockCsv 
} = require('./services/csvService');

const app = express();
const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 } // Limite de 10MB para uploads
});

// 1. Headers de Segurança HTTP (Helmet + CSP)
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            imgSrc: ["'self'", "data:", "blob:", "https://encrypted-tbn0.gstatic.com"],
            scriptSrc: ["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            connectSrc: ["'self'"],
            upgradeInsecureRequests: null
        }
    },
    crossOriginEmbedderPolicy: false
}));

// 2. Proteção contra Ataques de Força Bruta (Rate Limiting)
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 15,
    message: { error: 'Demasiadas tentativas de login a partir deste IP. Por favor, aguarde 15 minutos antes de tentar novamente.' },
    standardHeaders: true,
    legacyHeaders: false,
});

const apiLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minuto
    max: 600, // Permitir fluxo de trabalho dinâmico
    message: { error: 'Limite de requisições excedido. Tente novamente em alguns segundos.' },
    standardHeaders: true,
    legacyHeaders: false,
});
app.use('/api/', apiLimiter);

// 3. Middlewares essenciais
app.use(cors());
app.use(express.json({ limit: '5mb' }));

// Validação mandatória das variáveis de ambiente críticas
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    console.error('❌ [ERRO CRÍTICO] A variável de ambiente JWT_SECRET não está definida no ficheiro .env');
    process.exit(1);
}

// Configuração da conexão PostgreSQL
const DATABASE_NAME = 'gestao_stock';
if (process.env.DB_NAME !== DATABASE_NAME) {
    console.error(`❌ [ERRO CRÍTICO] DB_NAME deve ser exatamente "${DATABASE_NAME}".`);
    process.exit(1);
}

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: DATABASE_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

// ==========================================
// ROTAS LIMPAS DO SERVIDOR (SEM EXTENSÕES .HTML)
// ==========================================

// 1. Redirecionamento permanente de URLs legadas com .html para URLs limpas
app.get('/login.html', (req, res) => res.redirect(301, '/login'));
app.get('/index.html', (req, res) => res.redirect(301, '/home'));

// 2. Mapeamento de rotas limpas para ficheiros de visualização
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/login.html'));
});

app.get('/home', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// 3. Rota Raiz (redireciona para /home; o cliente valida a sessão via auth.js)
app.get('/', (req, res) => {
    res.redirect('/home');
});

// 4. Servir ficheiros estáticos (JS, CSS, Imagens, Fontes, PWA) sem expor .html diretamente
app.use(express.static(path.join(__dirname, '../frontend'), {
    index: false,
    extensions: false
}));

const tesseractAssetsPath = path.join(__dirname, 'node_modules');
app.get('/ocr-assets/tesseract.min.js', (req, res) => {
    res.sendFile(path.join(tesseractAssetsPath, 'tesseract.js', 'dist', 'tesseract.min.js'));
});
app.get('/ocr-assets/worker.min.js', (req, res) => {
    res.sendFile(path.join(tesseractAssetsPath, 'tesseract.js', 'dist', 'worker.min.js'));
});
app.get('/ocr-assets/core/:asset', (req, res) => {
    const allowedAssets = new Set([
        'tesseract-core-relaxedsimd-lstm.wasm.js',
        'tesseract-core-relaxedsimd-lstm.wasm',
        'tesseract-core-simd-lstm.wasm.js',
        'tesseract-core-simd-lstm.wasm',
        'tesseract-core-lstm.wasm.js',
        'tesseract-core-lstm.wasm'
    ]);
    if (!allowedAssets.has(req.params.asset)) {
        return res.status(404).json({ error: 'Recurso OCR não encontrado.' });
    }
    res.sendFile(path.join(tesseractAssetsPath, 'tesseract.js-core', req.params.asset));
});
app.get('/ocr-assets/lang/eng.traineddata.gz', (req, res) => {
    res.sendFile(path.join(tesseractAssetsPath, '@tesseract.js-data', 'eng', '4.0.0', 'eng.traineddata.gz'));
});

// Desativa a cache HTTP em todas as rotas da API para consistência
app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    next();
});

// ==========================================
// MIDDLEWARES DE SEGURANÇA E RBAC MULTI-INSTITUIÇÃO
// ==========================================

function verificarToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const [scheme, token] = authHeader ? authHeader.split(' ') : [];

    if (scheme !== 'Bearer' || !token) {
        return res.status(401).json({ error: 'Acesso negado. Token não fornecido.' });
    }

    jwt.verify(token, JWT_SECRET, (err, usuario) => {
        if (err) {
            return res.status(401).json({ error: 'Token inválido ou expirado.' });
        }
        if (usuario.perfil !== 'administrador' &&
            (typeof usuario.instituicao_nome !== 'string' || !usuario.instituicao_nome.trim())) {
            return res.status(403).json({ error: 'Utilizador sem instituição associada. Contacte um Administrador.' });
        }
        req.usuario = usuario;
        next();
    });
}

function apenasAdmin(req, res, next) {
    if (req.usuario && req.usuario.perfil === 'administrador') {
        return next();
    }
    return res.status(403).json({ error: 'Acesso negado. Apenas Administradores podem realizar esta ação.' });
}

const autenticarToken = verificarToken;
const verificarAdmin = apenasAdmin;

/**
 * Retorna o nome da instituição restrita se for técnico, ou null se for administrador
 */
function obterEscopoInstitucional(req) {
    if (!req.usuario || req.usuario.perfil === 'administrador') {
        return null;
    }
    return req.usuario.instituicao_nome || null;
}

async function inserirLogAuditoria(client, req, {
    acao,
    entidade,
    entidadeId = null,
    dadosAnteriores = null,
    dadosNovos = null,
    justificativa = null
}) {
    const usuario = req.usuario || {};
    await client.query(
        `INSERT INTO public.logs_auditoria
            (usuario_id, usuario_nome, usuario_email, usuario_perfil,
             instituicao_id, instituicao_nome, acao, entidade, entidade_id,
             dados_anteriores, dados_novos, ip, user_agent, justificativa)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [
            usuario.id || null,
            usuario.nome || null,
            usuario.email || null,
            usuario.perfil || null,
            usuario.instituicao_id || null,
            usuario.instituicao_nome || null,
            acao,
            entidade,
            entidadeId === null ? null : String(entidadeId),
            dadosAnteriores === null ? null : JSON.stringify(dadosAnteriores),
            dadosNovos === null ? null : JSON.stringify(dadosNovos),
            req.ip || req.socket?.remoteAddress || null,
            req.get('user-agent') || null,
            justificativa
        ]
    );
}

function normalizarEmail(email) {
    return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

function criarId(prefixo) {
    return `${prefixo}-${randomUUID()}`;
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
                `INSERT INTO usuarios (id, nome, email, senha, perfil, instituicao_nome) 
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                ['admin-inicial', 'Administrador Geral', 'admin@sgstock.com', senhaHash, 'administrador', 'MCTD Sede']
            );
            console.log('--------------------------------------------------');
            console.log('✅ Utilizador Administrador criado automaticamente!');
            console.log('   Email: admin@sgstock.com');
            console.log('   Instituição: MCTD Sede');
            console.log('--------------------------------------------------');
        }
    } catch (err) {
        console.error('Erro ao criar admin inicial:', err);
    }
}
criarAdminInicial();

// ==========================================
// ENDPOINTS: AUTENTICAÇÃO, UTILIZADORES & PERFIL
// ==========================================

async function processarRegistoUtilizador(req, res) {
    const { nome, email, senha, perfil, instituicaoId, instituicaoNome, authProvider, externalId } = req.body;

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
            `INSERT INTO usuarios (id, nome, email, senha, perfil, instituicao_id, instituicao_nome, auth_provider, external_id) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
                novoId, 
                nome.trim(), 
                emailFormatado, 
                senhaHash, 
                perfil, 
                instituicaoId || null, 
                instituicaoNome ? instituicaoNome.trim() : 'MCTD Sede',
                authProvider || 'local',
                externalId || null
            ]
        );

        await registrarAuditoria(pool, {
            req,
            acao: 'CRIAR_UTILIZADOR',
            entidade: 'usuarios',
            entidadeId: novoId,
            dadosNovos: { nome, email: emailFormatado, perfil, instituicaoNome }
        });

        res.status(201).json({ message: 'Utilizador registado com sucesso!' });
    } catch (err) {
        console.error('Erro ao registar utilizador:', err);
        res.status(500).json({ error: 'Erro interno ao registar utilizador.' });
    }
}

app.get('/api/usuarios', autenticarToken, verificarAdmin, async (req, res) => {
    try {
        const resultado = await pool.query(
            `SELECT id, nome, email, perfil, instituicao_id, instituicao_nome,
                    ultimo_login AS "ultimaAtividade"
             FROM usuarios
             WHERE COALESCE(ativo, TRUE) = TRUE
             ORDER BY ultimo_login DESC NULLS LAST, nome ASC, email ASC`
        );
        res.json(resultado.rows);
    } catch (err) {
        console.error('Erro ao listar utilizadores:', err);
        res.status(500).json({ error: 'Erro interno ao consultar utilizadores.' });
    }
});

app.post('/api/registrar', autenticarToken, verificarAdmin, processarRegistoUtilizador);
app.post('/api/usuarios', autenticarToken, verificarAdmin, processarRegistoUtilizador);

// Login de Utilizador com enriquecimento de escopo e auditoria
async function processarLogin(req, res) {
    try {
        const { email, senha } = req.body || {};

        if (!email || !senha) {
            return res.status(400).json({ error: 'Por favor, forneça email e palavra-passe.' });
        }

        const result = await pool.query(
            `SELECT id, nome, email, senha, perfil, instituicao_id, instituicao_nome 
             FROM usuarios 
             WHERE LOWER(email) = $1 AND COALESCE(ativo, TRUE) = TRUE`,
            [normalizarEmail(email)]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Credenciais inválidas.' });
        }

        const usuario = result.rows[0];

        const senhaValida = await bcrypt.compare(senha, usuario.senha);
        if (!senhaValida) {
            return res.status(401).json({ error: 'Credenciais inválidas.' });
        }
        if (usuario.perfil !== 'administrador' &&
            (typeof usuario.instituicao_nome !== 'string' || !usuario.instituicao_nome.trim())) {
            return res.status(403).json({ error: 'A conta não tem uma instituição associada. Contacte um Administrador.' });
        }

        // Registo de último login
        await pool.query('UPDATE usuarios SET ultimo_login = CURRENT_TIMESTAMP WHERE id = $1', [usuario.id]);

        const token = jwt.sign(
            { 
                id: usuario.id, 
                nome: usuario.nome, 
                email: usuario.email, 
                perfil: usuario.perfil,
                instituicao_id: usuario.instituicao_id,
                instituicao_nome: usuario.instituicao_nome
            },
            JWT_SECRET,
            { expiresIn: '8h' }
        );

        await registrarAuditoria(pool, {
            req,
            usuarioId: usuario.id,
            usuarioNome: usuario.nome,
            usuarioPerfil: usuario.perfil,
            instituicaoId: usuario.instituicao_id,
            instituicaoNome: usuario.instituicao_nome,
            acao: 'LOGIN',
            entidade: 'usuarios',
            entidadeId: usuario.id
        });

        res.json({
            message: 'Login efetuado com sucesso!',
            token,
            usuario: { 
                id: usuario.id, 
                nome: usuario.nome, 
                email: usuario.email, 
                perfil: usuario.perfil,
                instituicao_id: usuario.instituicao_id,
                instituicao_nome: usuario.instituicao_nome
            }
        });

    } catch (err) {
        console.error('Erro no login:', err);
        res.status(500).json({ error: 'Erro interno no servidor ao processar login.' });
    }
}

app.post('/api/login', loginLimiter, processarLogin);
app.post('/api/auth/login', loginLimiter, processarLogin);

// Alteração de Palavra-Passe do Perfil
async function alterarPasswordPropria(req, res) {
    const { senhaAtual, novaSenha } = req.body || {};
    const usuarioId = req.usuario.id;

    if (typeof senhaAtual !== 'string' || !senhaAtual ||
        typeof novaSenha !== 'string' || !novaSenha) {
        return res.status(400).json({ error: 'A palavra-passe atual e a nova são obrigatórias.' });
    }

    if (novaSenha.length < 8) {
        return res.status(400).json({ error: 'A nova palavra-passe deve conter pelo menos 8 caracteres.' });
    }

    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');
        const userRes = await client.query('SELECT senha FROM usuarios WHERE id = $1 FOR UPDATE', [usuarioId]);
        if (userRes.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Utilizador não encontrado.' });
        }

        const confere = await bcrypt.compare(senhaAtual, userRes.rows[0].senha);
        if (!confere) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'A palavra-passe atual fornecida está incorreta.' });
        }

        const novaHash = await bcrypt.hash(novaSenha, 10);
        await client.query('UPDATE usuarios SET senha = $1 WHERE id = $2', [novaHash, usuarioId]);
        await inserirLogAuditoria(client, req, {
            acao: 'ALTERAR_SENHA',
            entidade: 'usuarios',
            entidadeId: usuarioId
        });
        await client.query('COMMIT');

        await registrarAuditoria(pool, {
            req,
            acao: 'ALTERAR_SENHA',
            entidade: 'usuarios',
            entidadeId: usuarioId
        });

        res.json({ message: 'Palavra-passe alterada com sucesso!' });
    } catch (err) {
        if (client) {
            try { await client.query('ROLLBACK'); } catch (rollbackError) {
                console.error('Erro no rollback da alteração de palavra-passe:', rollbackError);
            }
        }
        console.error('Erro ao alterar senha:', err);
        res.status(500).json({ error: 'Erro interno ao alterar a palavra-passe.' });
    } finally {
        if (client) client.release();
    }
}

app.put('/api/perfil/senha', autenticarToken, alterarPasswordPropria);
app.put('/api/perfil/password', autenticarToken, alterarPasswordPropria);

app.put('/api/usuarios/:id/password', autenticarToken, verificarAdmin, async (req, res) => {
    const body = req.body || {};
    const novaSenha = body.novaSenha || body.password;
    if (typeof novaSenha !== 'string' || novaSenha.length < 8) {
        return res.status(400).json({ error: 'A nova palavra-passe deve conter pelo menos 8 caracteres.' });
    }

    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');
        const utilizador = await client.query(
            'SELECT id, nome, email, perfil FROM public.usuarios WHERE id = $1 FOR UPDATE',
            [req.params.id]
        );
        if (utilizador.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Utilizador não encontrado.' });
        }

        const senhaHash = await bcrypt.hash(novaSenha, 10);
        await client.query('UPDATE public.usuarios SET senha = $1 WHERE id = $2', [senhaHash, req.params.id]);
        await inserirLogAuditoria(client, req, {
            acao: 'REPOR_SENHA',
            entidade: 'usuarios',
            entidadeId: req.params.id,
            dadosNovos: { id: req.params.id, email: utilizador.rows[0].email }
        });
        await client.query('COMMIT');

        await registrarAuditoria(pool, {
            req,
            acao: 'REPOR_SENHA',
            entidade: 'usuarios',
            entidadeId: req.params.id,
            dadosNovos: { email: utilizador.rows[0].email }
        });
        res.json({ message: 'Palavra-passe reposta com sucesso.' });
    } catch (err) {
        if (client) {
            try { await client.query('ROLLBACK'); } catch (rollbackError) {
                console.error('Erro no rollback da reposição de palavra-passe:', rollbackError);
            }
        }
        console.error('Erro ao repor palavra-passe:', err);
        res.status(500).json({ error: 'Erro interno ao repor a palavra-passe.' });
    } finally {
        if (client) client.release();
    }
});

// ==========================================
// ENDPOINTS: INSTITUIÇÕES PREDEFINIDAS & FORNECEDORES
// ==========================================

// Listar Instituições Autorizadas
app.get('/api/instituicoes', autenticarToken, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT i.id, i.sigla, i.sigla AS codigo, i.nome, i.provincia, i.endereco,
                    i.email_contacto AS email, i.telefone, i.ativo,
                    i.created_at AS "createdAt",
                    COALESCE((SELECT MAX(a.criado_em) FROM public.auditoria a
                              WHERE a.entidade = 'instituicoes' AND a.entidade_id = i.id),
                             i.created_at) AS "ultimaAtividade"
             FROM public.instituicoes i
             WHERE COALESCE(i.ativo, TRUE) = TRUE
             ORDER BY "ultimaAtividade" DESC NULLS LAST, i.nome ASC`
        );
        res.json(result.rows);
    } catch (err) {
        console.error('Erro ao listar instituições:', err);
        res.status(500).json({ error: 'Erro interno ao carregar instituições.' });
    }
});

function normalizarCategoria(cat) {
    if (!cat) return 'roteador';
    const c = String(cat).toLowerCase().trim();
    if (c === 'switches' || c === 'switch') return 'switch';
    if (c === 'roteadores' || c === 'roteador' || c === 'router' || c === 'routers') return 'roteador';
    if (c === 'firewalls' || c === 'firewall') return 'firewall';
    if (c === 'olts' || c === 'olt') return 'olt';
    if (c === 'servidores' || c === 'servidor' || c === 'server' || c === 'servers') return 'servidor';
    if (c === 'access_points' || c === 'access_point' || c === 'ap' || c === 'aps' || c === 'wireless') return 'access_point';
    if (c === 'ups' || c === 'nobreak') return 'ups';
    if (c === 'transceivers' || c === 'transceiver' || c === 'sfp') return 'transceiver';
    return 'outro';
}

// Criar Nova Instituição (PROTEGIDO: Administrador)
app.post('/api/instituicoes', autenticarToken, verificarAdmin, async (req, res) => {
    const { codigo, sigla, nome, tipo, provincia, endereco, email, telefone } = req.body;
    const siglaFinal = String(sigla || codigo || '').trim().toUpperCase();
    const nomeFinal = typeof nome === 'string' ? nome.trim() : '';
    if (!siglaFinal || !nomeFinal || typeof provincia !== 'string' || !provincia.trim()) {
        return res.status(400).json({ error: 'Sigla, nome e província da instituição são obrigatórios.' });
    }

    const instId = 'inst-' + siglaFinal.toLowerCase().replace(/[^a-z0-9]/g, '-');

    try {
        const result = await pool.query(
            `INSERT INTO public.instituicoes
                (id, sigla, nome, tipo, provincia, endereco, email_contacto, telefone)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
            [
                instId, siglaFinal, nomeFinal, tipo || 'academica', provincia.trim(),
                endereco ? String(endereco).trim() : null,
                email ? String(email).trim() : null,
                telefone ? String(telefone).trim() : null
            ]
        );

        await registrarAuditoria(pool, {
            req,
            acao: 'CRIAR_INSTITUICAO',
            entidade: 'instituicoes',
            entidadeId: result.rows[0].id,
            dadosNovos: result.rows[0]
        });

        res.status(201).json({ message: 'Instituição criada com sucesso!', instituicao: result.rows[0] });
    } catch (err) {
        console.error('Erro ao criar instituição:', err);
        if (err.code === '23505') {
            return res.status(409).json({ error: 'Já existe uma instituição com essa sigla.' });
        }
        res.status(500).json({ error: 'Erro interno ao criar instituição.' });
    }
});

app.put('/api/instituicoes/:id', autenticarToken, verificarAdmin, async (req, res) => {
    const { sigla, codigo, nome, provincia, tipo, endereco, email, telefone, ativo } = req.body;
    const siglaFinal = sigla !== undefined || codigo !== undefined
        ? String(sigla || codigo || '').trim().toUpperCase()
        : undefined;
    if (siglaFinal === '' || (nome !== undefined && (typeof nome !== 'string' || !nome.trim())) ||
        (provincia !== undefined && (typeof provincia !== 'string' || !provincia.trim())) ||
        (ativo !== undefined && typeof ativo !== 'boolean')) {
        return res.status(400).json({ error: 'Dados inválidos para atualizar a instituição.' });
    }

    const fields = [];
    const values = [];
    const add = (column, value) => {
        values.push(value);
        fields.push(`${column} = $${values.length}`);
    };
    if (siglaFinal !== undefined) add('sigla', siglaFinal);
    if (nome !== undefined) add('nome', nome.trim());
    if (provincia !== undefined) add('provincia', provincia.trim());
    if (tipo !== undefined) add('tipo', tipo);
    if (endereco !== undefined) add('endereco', endereco === null ? null : String(endereco).trim());
    if (email !== undefined) add('email_contacto', email === null ? null : String(email).trim());
    if (telefone !== undefined) add('telefone', telefone === null ? null : String(telefone).trim());
    if (ativo !== undefined) add('ativo', ativo);
    if (fields.length === 0) return res.status(400).json({ error: 'Nenhum campo para atualizar.' });

    try {
        values.push(req.params.id);
        const anterior = await pool.query('SELECT * FROM public.instituicoes WHERE id = $1', [req.params.id]);
        if (anterior.rowCount === 0) return res.status(404).json({ error: 'Instituição não encontrada.' });
        const result = await pool.query(
            `UPDATE public.instituicoes SET ${fields.join(', ')} WHERE id = $${values.length} RETURNING *`,
            values
        );
        await registrarAuditoria(pool, {
            req, acao: 'EDITAR_INSTITUICAO', entidade: 'instituicoes',
            entidadeId: req.params.id, dadosAnteriores: anterior.rows[0], dadosNovos: result.rows[0]
        });
        res.json({ message: 'Instituição atualizada com sucesso.', instituicao: result.rows[0] });
    } catch (err) {
        console.error('Erro ao atualizar instituição:', err);
        if (err.code === '23505') return res.status(409).json({ error: 'Já existe uma instituição com essa sigla.' });
        res.status(500).json({ error: 'Erro interno ao atualizar instituição.' });
    }
});

app.delete('/api/instituicoes/:id', autenticarToken, verificarAdmin, async (req, res) => {
    try {
        const result = await pool.query(
            'UPDATE public.instituicoes SET ativo = FALSE WHERE id = $1 AND COALESCE(ativo, TRUE) = TRUE RETURNING *',
            [req.params.id]
        );
        if (result.rowCount === 0) return res.status(404).json({ error: 'Instituição não encontrada ou já inativa.' });
        await registrarAuditoria(pool, {
            req, acao: 'INATIVAR_INSTITUICAO', entidade: 'instituicoes',
            entidadeId: req.params.id, dadosAnteriores: result.rows[0]
        });
        res.json({ message: 'Instituição inativada com sucesso.' });
    } catch (err) {
        console.error('Erro ao inativar instituição:', err);
        res.status(500).json({ error: 'Erro interno ao inativar instituição.' });
    }
});

// Listar Fornecedores
app.get('/api/fornecedores', autenticarToken, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT f.id, COALESCE(f.nome_empresa, f.nome) AS nome,
                    COALESCE(f.nome_empresa, f.nome) AS nome_empresa,
                    COALESCE(f.nuit, f.nif) AS nuit, COALESCE(f.nif, f.nuit) AS nif,
                    COALESCE(f.pessoa_contacto, f.contacto) AS contacto,
                    COALESCE(f.pessoa_contacto, f.contacto) AS pessoa_contacto,
                    f.email, f.telefone, f.endereco, f.ativo, f.created_at AS "createdAt",
                    COALESCE((SELECT MAX(a.criado_em) FROM public.auditoria a
                              WHERE a.entidade = 'fornecedores' AND a.entidade_id = f.id),
                             f.created_at) AS "ultimaAtividade"
             FROM public.fornecedores f
             WHERE COALESCE(f.ativo, TRUE) = TRUE
             ORDER BY "ultimaAtividade" DESC NULLS LAST, COALESCE(f.nome_empresa, f.nome) ASC`
        );
        res.json(result.rows);
    } catch (err) {
        console.error('Erro ao listar fornecedores:', err);
        res.status(500).json({ error: 'Erro interno ao carregar fornecedores.' });
    }
});

// Criar Novo Fornecedor (PROTEGIDO: Administrador)
app.post('/api/fornecedores', autenticarToken, verificarAdmin, async (req, res) => {
    const nome = req.body.nome_empresa || req.body.nome;
    const contacto = req.body.pessoa_contacto || req.body.contacto;
    const nuit = req.body.nif || req.body.nuit;
    const { email, telefone, endereco } = req.body;
    if (typeof nome !== 'string' || !nome.trim()) {
        return res.status(400).json({ error: 'O nome da empresa fornecedora é obrigatório.' });
    }

    const fornId = criarId('forn');

    try {
        const result = await pool.query(
            `INSERT INTO public.fornecedores
                (id, nome, nome_empresa, nuit, nif, contacto, pessoa_contacto, email, telefone, endereco)
             VALUES ($1, $2, $2, $3, $3, $4, $4, $5, $6, $7) RETURNING *`,
            [fornId, nome.trim(), nuit || null, contacto || null, email || null, telefone || null, endereco || null]
        );

        await registrarAuditoria(pool, {
            req,
            acao: 'CRIAR_FORNECEDOR',
            entidade: 'fornecedores',
            entidadeId: result.rows[0].id,
            dadosNovos: result.rows[0]
        });

        res.status(201).json({ message: 'Fornecedor registado com sucesso!', fornecedor: result.rows[0] });
    } catch (err) {
        console.error('Erro ao criar fornecedor:', err);
        if (err.code === '23505') return res.status(409).json({ error: 'Já existe um fornecedor com esse NIF.' });
        res.status(500).json({ error: 'Erro interno ao criar fornecedor.' });
    }
});

app.put('/api/fornecedores/:id', autenticarToken, verificarAdmin, async (req, res) => {
    const fields = [];
    const values = [];
    const add = (columns, value) => {
        values.push(value);
        const placeholder = `$${values.length}`;
        for (const column of columns) fields.push(`${column} = ${placeholder}`);
    };
    const body = req.body;
    const nome = body.nome_empresa !== undefined ? body.nome_empresa : body.nome;
    const contacto = body.pessoa_contacto !== undefined ? body.pessoa_contacto : body.contacto;
    const nif = body.nif !== undefined ? body.nif : body.nuit;
    if (nome !== undefined) {
        if (typeof nome !== 'string' || !nome.trim()) return res.status(400).json({ error: 'O nome da empresa é inválido.' });
        add(['nome', 'nome_empresa'], nome.trim());
    }
    if (contacto !== undefined) add(['contacto', 'pessoa_contacto'], contacto === null ? null : String(contacto).trim());
    if (nif !== undefined) add(['nuit', 'nif'], nif === null ? null : String(nif).trim());
    for (const column of ['email', 'telefone', 'endereco']) {
        if (body[column] !== undefined) add([column], body[column] === null ? null : String(body[column]).trim());
    }
    if (body.ativo !== undefined) {
        if (typeof body.ativo !== 'boolean') return res.status(400).json({ error: 'O estado ativo deve ser booleano.' });
        add(['ativo'], body.ativo);
    }
    if (fields.length === 0) return res.status(400).json({ error: 'Nenhum campo para atualizar.' });

    try {
        const anterior = await pool.query('SELECT * FROM public.fornecedores WHERE id = $1', [req.params.id]);
        if (anterior.rowCount === 0) return res.status(404).json({ error: 'Fornecedor não encontrado.' });
        values.push(req.params.id);
        const result = await pool.query(
            `UPDATE public.fornecedores SET ${fields.join(', ')} WHERE id = $${values.length} RETURNING *`,
            values
        );
        await registrarAuditoria(pool, {
            req, acao: 'EDITAR_FORNECEDOR', entidade: 'fornecedores',
            entidadeId: req.params.id, dadosAnteriores: anterior.rows[0], dadosNovos: result.rows[0]
        });
        res.json({ message: 'Fornecedor atualizado com sucesso.', fornecedor: result.rows[0] });
    } catch (err) {
        console.error('Erro ao atualizar fornecedor:', err);
        if (err.code === '23505') return res.status(409).json({ error: 'Já existe um fornecedor com esse NIF.' });
        res.status(500).json({ error: 'Erro interno ao atualizar fornecedor.' });
    }
});

app.delete('/api/fornecedores/:id', autenticarToken, verificarAdmin, async (req, res) => {
    try {
        const result = await pool.query(
            'UPDATE public.fornecedores SET ativo = FALSE WHERE id = $1 AND COALESCE(ativo, TRUE) = TRUE RETURNING *',
            [req.params.id]
        );
        if (result.rowCount === 0) return res.status(404).json({ error: 'Fornecedor não encontrado ou já inativo.' });
        await registrarAuditoria(pool, {
            req, acao: 'INATIVAR_FORNECEDOR', entidade: 'fornecedores',
            entidadeId: req.params.id, dadosAnteriores: result.rows[0]
        });
        res.json({ message: 'Fornecedor inativado com sucesso.' });
    } catch (err) {
        console.error('Erro ao inativar fornecedor:', err);
        res.status(500).json({ error: 'Erro interno ao inativar fornecedor.' });
    }
});

// ==========================================
// ENDPOINTS: MODELOS DE EQUIPAMENTOS & ENGENHARIA
// ==========================================

// Obter todos os modelos de equipamentos com especificações de engenharia
app.get('/api/equipamentos', autenticarToken, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT 
                e.id, e.marca, e.modelo, e.part_number AS "partNumber",
                e.categoria, e.descricao, e.capacidade_banda AS "capacidadeBanda",
                e.portas, e.fibra_escura AS "fibraEscura",
                e.potencia_consumo AS "potenciaConsumo",
                e.vida_util_anos AS "vidaUtilAnos",
                e.preco_estimado AS "precoEstimado",
                e.criado_em AS "criadoEm",
                COALESCE((SELECT MAX(a.criado_em) FROM public.auditoria a
                          WHERE a.entidade = 'equipamentos' AND a.entidade_id = e.id),
                         e.criado_em) AS "ultimaAtividade"
             FROM public.equipamentos e
             ORDER BY "ultimaAtividade" DESC NULLS LAST, e.id DESC`
        );
        res.json(result.rows);
    } catch (err) {
        console.error('Erro ao obter equipamentos:', err);
        res.status(500).json({ error: 'Erro interno ao carregar equipamentos.' });
    }
});

// Cadastrar novo modelo de equipamento com engenharia (PROTEGIDO: Administrador)
app.post('/api/equipamentos', autenticarToken, verificarAdmin, async (req, res) => {
    const { 
        id, marca, modelo, partNumber, categoria, descricao, 
        capacidadeBanda, portas, fibraEscura, potenciaConsumo, vidaUtilAnos
    } = req.body || {};
    const aquisicao = req.body?.aquisicaoInicial;

    if (!marca || !modelo || !partNumber) {
        return res.status(400).json({ error: 'Marca, modelo e part number são obrigatórios.' });
    }

    if (!aquisicao || typeof aquisicao !== 'object') {
        return res.status(400).json({ error: 'Os dados da aquisição são obrigatórios ao cadastrar um modelo.' });
    }

    const faturaNumero = String(aquisicao.faturaNumero || '').trim();
    const fornecedorId = String(aquisicao.fornecedorId || '').trim();
    const custoTexto = aquisicao.custoUnitario;
    const custoUnitario = Number(custoTexto);
    const dataAquisicao = String(aquisicao.dataAquisicao || '');
    const dataAquisicaoObj = new Date(`${dataAquisicao}T00:00:00.000Z`);
    if (!faturaNumero || faturaNumero.length > 100 || !fornecedorId ||
        custoTexto === undefined || custoTexto === null || String(custoTexto).trim() === '' ||
        !Number.isFinite(custoUnitario) || custoUnitario < 0 || custoUnitario > 9999999999999.99 ||
        !/^\d{4}-\d{2}-\d{2}$/.test(dataAquisicao) ||
        Number.isNaN(dataAquisicaoObj.getTime()) || dataAquisicaoObj.toISOString().slice(0, 10) !== dataAquisicao) {
        return res.status(400).json({ error: 'Fatura, fornecedor, custo unitário e data da aquisição são obrigatórios e devem ser válidos.' });
    }

    const eqId = id || 'eq-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6);
    const catValida = normalizarCategoria(categoria);
    const portasStr = portas !== undefined && portas !== null ? String(portas) : null;
    const aquisicaoId = criarId('aqm');
    let client;

    try {
        client = await pool.connect();
        await client.query('BEGIN');
        await client.query(
            `INSERT INTO public.equipamentos 
             (id, marca, modelo, part_number, categoria, descricao, capacidade_banda, portas, fibra_escura, potencia_consumo, vida_util_anos) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [
                eqId, 
                marca.trim(), 
                modelo.trim(), 
                partNumber.trim(), 
                catValida,
                descricao ? descricao.trim() : null,
                capacidadeBanda ? capacidadeBanda.trim() : null,
                portasStr,
                Boolean(fibraEscura),
                potenciaConsumo ? potenciaConsumo.trim() : null,
                vidaUtilAnos ? Number(vidaUtilAnos) : 5
            ]
        );

        const fornecedorRes = await client.query(
            `SELECT id, COALESCE(nome_empresa, nome) AS nome
             FROM public.fornecedores WHERE id = $1 AND COALESCE(ativo, TRUE) = TRUE FOR SHARE`,
            [fornecedorId]
        );
        if (!fornecedorRes.rowCount) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Fornecedor não encontrado ou inativo.' });
        }

        const fornecedor = fornecedorRes.rows[0];
        await client.query(
            `INSERT INTO public.aquisicoes_modelo
                (id, equipamento_id, fatura_numero, fornecedor_id, fornecedor_nome,
                 custo_unitario, data_aquisicao, registado_por)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
                aquisicaoId, eqId, faturaNumero, fornecedor.id, fornecedor.nome,
                custoUnitario, dataAquisicao, req.usuario?.email || req.usuario?.id || null
            ]
        );
        await inserirLogAuditoria(client, req, {
            acao: 'REGISTAR_AQUISICAO_MODELO',
            entidade: 'aquisicoes_modelo',
            entidadeId: aquisicaoId,
            dadosNovos: {
                equipamentoId: eqId, faturaNumero, fornecedorId: fornecedor.id,
                fornecedorNome: fornecedor.nome, custoUnitario, dataAquisicao
            }
        });
        await inserirLogAuditoria(client, req, {
            acao: 'CRIAR_MODELO',
            entidade: 'equipamentos',
            entidadeId: eqId,
            dadosNovos: { marca, modelo, partNumber, categoria, capacidadeBanda, portas, vidaUtilAnos }
        });
        await client.query('COMMIT');

        await registrarAuditoria(pool, {
            req,
            acao: 'REGISTAR_AQUISICAO_MODELO',
            entidade: 'aquisicoes_modelo',
            entidadeId: aquisicaoId,
            dadosNovos: {
                equipamentoId: eqId, faturaNumero, fornecedorNome: fornecedor.nome,
                custoUnitario, dataAquisicao
            }
        });
        await registrarAuditoria(pool, {
            req,
            acao: 'CRIAR_MODELO',
            entidade: 'equipamentos',
            entidadeId: eqId,
            dadosNovos: { marca, modelo, partNumber, categoria, capacidadeBanda, portas, vidaUtilAnos }
        });

        res.status(201).json({
            message: 'Modelo e dados da aquisição registados com sucesso.',
            id: eqId,
            aquisicaoId
        });
    } catch (err) {
        if (client) {
            try { await client.query('ROLLBACK'); } catch (rollbackError) {
                console.error('Erro no rollback do cadastro de equipamento:', rollbackError);
            }
        }
        console.error('Erro ao cadastrar equipamento:', err);
        if (err.code === '23505') {
            return res.status(400).json({ error: 'Já existe um equipamento com este Part Number.' });
        }
        res.status(500).json({ error: 'Erro interno ao cadastrar equipamento.' });
    } finally {
        if (client) client.release();
    }
});

// Atualizar equipamento com engenharia e sincronização transacional (PROTEGIDO: Administrador)
app.put('/api/equipamentos/:id', autenticarToken, verificarAdmin, async (req, res) => {
    const { id } = req.params;
    const { 
        marca, modelo, partNumber, categoria, descricao, 
        capacidadeBanda, portas, fibraEscura, potenciaConsumo, vidaUtilAnos, precoEstimado,
        novaInstituicao, antigaInstituicao, novosSerials 
    } = req.body;

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const anterior = await client.query('SELECT * FROM public.equipamentos WHERE id = $1 FOR UPDATE', [id]);
        if (anterior.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Modelo de equipamento não encontrado.' });
        }

        const catValida = categoria ? normalizarCategoria(categoria) : null;
        const portasStr = portas !== undefined && portas !== null ? String(portas) : null;

        await client.query(
            `UPDATE public.equipamentos 
             SET marca = $1, 
                 modelo = $2, 
                 part_number = $3,
                 categoria = COALESCE($4, categoria),
                 descricao = COALESCE($5, descricao),
                 capacidade_banda = COALESCE($6, capacidade_banda),
                 portas = COALESCE($7, portas),
                 fibra_escura = COALESCE($8, fibra_escura),
                 potencia_consumo = COALESCE($9, potencia_consumo),
                 vida_util_anos = COALESCE($10, vida_util_anos),
                 preco_estimado = COALESCE($11, preco_estimado)
             WHERE id = $12`,
            [
                marca, modelo, partNumber, 
                catValida, descricao || null, capacidadeBanda || null, 
                portasStr, fibraEscura !== undefined ? Boolean(fibraEscura) : null,
                potenciaConsumo || null, vidaUtilAnos ? Number(vidaUtilAnos) : null, 
                precoEstimado !== undefined ? parseFloat(precoEstimado) : null,
                id
            ]
        );

        const novoNome = `${marca} ${modelo} (${partNumber})`;

        // Sincronizar nome nas tabelas históricas
        await client.query('UPDATE historico_entradas SET equipamento_nome = $1 WHERE equipamento_id = $2', [novoNome, id]);
        await client.query('UPDATE historico_transferencias SET equipamento_nome = $1 WHERE equipamento_id = $2', [novoNome, id]);

        // Sincronizar seriais e instituição se informados
        if (Array.isArray(novosSerials) && novosSerials.length > 0) {
            if (antigaInstituicao) {
                await client.query(
                    `UPDATE historico_entradas 
                     SET instituicao = COALESCE(NULLIF($1, ''), instituicao), serials = $2, quantidade = $3 
                     WHERE equipamento_id = $4 AND LOWER(instituicao) = LOWER($5)`,
                    [novaInstituicao, novosSerials, novosSerials.length, id, antigaInstituicao]
                );
            }
        }

        await client.query('COMMIT');

        await registrarAuditoria(pool, {
            req,
            acao: 'EDITAR_MODELO',
            entidade: 'equipamentos',
            entidadeId: id,
            dadosAnteriores: anterior.rows[0],
            dadosNovos: { marca, modelo, partNumber, categoria, capacidadeBanda, portas }
        });

        res.json({ message: 'Modelo de equipamento e especificações atualizadas com sucesso!' });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Erro na atualização de equipamento:', err);
        res.status(500).json({ error: 'Erro interno ao atualizar equipamento.' });
    } finally {
        client.release();
    }
});

// Eliminar modelo de equipamento (PROTEGIDO: Administrador)
app.delete('/api/equipamentos/:id', autenticarToken, verificarAdmin, async (req, res) => {
    const { id } = req.params;

    try {
        const entradas = await pool.query('SELECT id FROM historico_entradas WHERE equipamento_id = $1 LIMIT 1', [id]);
        const transferencias = await pool.query('SELECT id FROM historico_transferencias WHERE equipamento_id = $1 LIMIT 1', [id]);
        const aquisicoes = await pool.query('SELECT id FROM public.aquisicoes_modelo WHERE equipamento_id = $1 LIMIT 1', [id]);

        if (entradas.rows.length > 0 || transferencias.rows.length > 0 || aquisicoes.rows.length > 0) {
            return res.status(409).json({
                error: 'Não é possível eliminar este modelo pois existem aquisições, entradas ou transferências associadas. A integridade histórica impede esta exclusão.'
            });
        }

        const result = await pool.query('DELETE FROM public.equipamentos WHERE id = $1 RETURNING *', [id]);
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Modelo de equipamento não encontrado.' });
        }

        await registrarAuditoria(pool, {
            req,
            acao: 'ELIMINAR_MODELO',
            entidade: 'equipamentos',
            entidadeId: id,
            dadosAnteriores: result.rows[0]
        });

        await enviarAlertaOperacaoSensivel({
            usuario: req.usuario.nome || req.usuario.email,
            acao: 'ELIMINAÇÃO DE MODELO',
            entidade: `Equipamento ID ${id} (${result.rows[0].marca} ${result.rows[0].modelo})`,
            detalhes: 'Modelo eliminado da base de dados por Administrador.',
            ip: req.ip
        });

        res.json({ message: 'Modelo de equipamento eliminado com sucesso!' });
    } catch (err) {
        console.error('Erro ao eliminar equipamento:', err);
        res.status(500).json({ error: 'Erro interno ao eliminar modelo de equipamento.' });
    }
});

app.put('/api/equipamentos/:id/estado', autenticarToken, async (req, res) => {
    const body = req.body || {};
    const serial = typeof (body.serialNumber || body.serial) === 'string'
        ? (body.serialNumber || body.serial).trim()
        : '';
    const estado = String(body.estado || body.novoEstado || '').trim().toLowerCase();
    const justificativa = typeof body.justificativa === 'string' ? body.justificativa.trim() : '';
    if (!serial || !estado || !justificativa) {
        return res.status(400).json({ error: 'Número de série, novo estado e justificativa são obrigatórios.' });
    }
    if (!['novo', 'operacional', 'avariado', 'abatido'].includes(estado)) {
        return res.status(400).json({ error: 'Estado inválido. Use novo, operacional, avariado ou abatido.' });
    }

    const escopo = obterEscopoInstitucional(req);
    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');
        const entradaRes = await client.query(
            `SELECT he.*
             FROM public.historico_entradas he
             WHERE he.equipamento_id = $1
               AND EXISTS (
                   SELECT 1 FROM UNNEST(he.serials) AS s(serial)
                   WHERE LOWER(TRIM(s.serial)) = LOWER(TRIM($2))
               )
             ORDER BY he.criado_em DESC, he.id DESC
             LIMIT 1
             FOR UPDATE OF he`,
            [req.params.id, serial]
        );
        if (entradaRes.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Equipamento ou número de série não encontrado.' });
        }

        const entrada = entradaRes.rows[0];
        if (escopo && entrada.instituicao.toLowerCase() !== escopo.toLowerCase()) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Equipamento ou número de série não encontrado nesta instituição.' });
        }
        const serialRegistado = entrada.serials.find(
            valor => valor.trim().toLowerCase() === serial.toLowerCase()
        );
        const estadoAnterior = entrada.estado_fisico || 'operacional';
        if (estadoAnterior === estado) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'O equipamento já se encontra nesse estado.' });
        }

        if (entrada.serials.length > 1) {
            const restantes = entrada.serials.filter(
                valor => valor.trim().toLowerCase() !== serial.toLowerCase()
            );
            await client.query(
                'UPDATE public.historico_entradas SET serials = $1, quantidade = $2 WHERE id = $3',
                [restantes, restantes.length, entrada.id]
            );
            await client.query(
                `INSERT INTO public.historico_entradas
                    (id, equipamento_id, equipamento_nome, quantidade, serials, instituicao,
                     data_hora, fatura_numero, fornecedor_id, fornecedor_nome, data_aquisicao,
                     custo_unitario, moeda, estado_fisico, instituicao_id, fatura_id, observacoes)
                 VALUES ($1, $2, $3, 1, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
                [
                    criarId('ent'), entrada.equipamento_id, entrada.equipamento_nome,
                    [serialRegistado], entrada.instituicao, new Date().toISOString(),
                    entrada.fatura_numero, entrada.fornecedor_id, entrada.fornecedor_nome,
                    entrada.data_aquisicao, entrada.custo_unitario, entrada.moeda, estado,
                    entrada.instituicao_id, entrada.fatura_id, entrada.observacoes
                ]
            );
        } else {
            await client.query(
                'UPDATE public.historico_entradas SET estado_fisico = $1 WHERE id = $2',
                [estado, entrada.id]
            );
        }

        const incidente = await client.query(
            `INSERT INTO public.historico_incidentes
                (equipamento_id, serial_number, estado_anterior, novo_estado,
                 justificativa, instituicao, reportado_por)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING id, criado_em`,
            [
                req.params.id, serialRegistado, estadoAnterior, estado, justificativa,
                entrada.instituicao, req.usuario.nome || req.usuario.email
            ]
        );
        await inserirLogAuditoria(client, req, {
            acao: 'ALTERAR_ESTADO_EQUIPAMENTO',
            entidade: 'equipamentos',
            entidadeId: req.params.id,
            dadosAnteriores: { serialNumber: serialRegistado, estado: estadoAnterior },
            dadosNovos: { serialNumber: serialRegistado, estado, incidenteId: incidente.rows[0].id },
            justificativa
        });
        await client.query('COMMIT');

        await registrarAuditoria(pool, {
            req,
            acao: 'ALTERAR_ESTADO_EQUIPAMENTO',
            entidade: 'equipamentos',
            entidadeId: req.params.id,
            instituicaoNome: entrada.instituicao,
            dadosAnteriores: { serialNumber: serialRegistado, estado: estadoAnterior },
            dadosNovos: { serialNumber: serialRegistado, estado, incidenteId: incidente.rows[0].id }
        });
        res.json({
            message: 'Estado do equipamento atualizado com justificativa.',
            incidente: incidente.rows[0]
        });
    } catch (err) {
        if (client) {
            try { await client.query('ROLLBACK'); } catch (rollbackError) {
                console.error('Erro no rollback da alteração de estado:', rollbackError);
            }
        }
        console.error('Erro ao alterar estado do equipamento:', err);
        res.status(500).json({ error: 'Erro interno ao alterar o estado do equipamento.' });
    } finally {
        if (client) client.release();
    }
});

// ==========================================
// ENDPOINTS: ENTRADAS DE STOCK & AQUISIÇÕES
// ==========================================

// Obter entradas (com escopo institucional se for técnico)
app.get('/api/entradas', autenticarToken, async (req, res) => {
    const escopo = obterEscopoInstitucional(req);

    try {
        let query = `
            SELECT 
                id, 
                equipamento_id AS "equipamentoId", 
                equipamento_nome AS "equipamentoNome", 
                quantidade, 
                serials, 
                instituicao, 
                data_hora AS "dataHora",
                fatura_numero AS "faturaNumero",
                fornecedor_id AS "fornecedorId",
                fornecedor_nome AS "fornecedorNome",
                data_aquisicao AS "dataAquisicao",
                custo_unitario AS "custoUnitario",
                moeda,
                estado_fisico AS "estadoFisico",
                criado_em AS "criadoEm",
                criado_em AS "ultimaAtividade"
            FROM public.historico_entradas
        `;
        const params = [];

        if (escopo) {
            query += ' WHERE LOWER(instituicao) = LOWER($1)';
            params.push(escopo);
        }

        query += ' ORDER BY criado_em DESC, id DESC';

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) {
        console.error('Erro ao obter entradas:', err);
        res.status(500).json({ error: 'Erro interno ao carregar entradas.' });
    }
});

// Registar nova entrada com aquisição completa e validação de escopo
app.post('/api/entradas', autenticarToken, async (req, res) => {
    const { 
        id, equipamentoId, equipamentoNome, quantidade, serials, instituicao, dataHora,
        faturaNumero, fornecedorId, fornecedorNome, dataAquisicao, custoUnitario, moeda, estadoFisico, instituicaoId
    } = req.body;

    if (!equipamentoId || !equipamentoNome || !instituicao) {
        return res.status(400).json({ error: 'Equipamento e instituição são obrigatórios.' });
    }

    const escopo = obterEscopoInstitucional(req);
    if (escopo && instituicao.trim().toLowerCase() !== escopo.toLowerCase()) {
        return res.status(403).json({ error: `Como Técnico, apenas pode registar stock para a sua instituição (${escopo}).` });
    }

    const entradaId = id || 'ent-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6);
    const listaSerials = Array.isArray(serials) ? serials.map(s => String(s).trim()).filter(Boolean) : [];
    const qtd = Number(quantidade) || listaSerials.length || 1;
    const dataRegisto = dataHora || new Date().toLocaleString('pt-PT');

    try {
        await pool.query(
            `INSERT INTO public.historico_entradas 
             (id, equipamento_id, equipamento_nome, quantidade, serials, instituicao, data_hora, fatura_numero, fornecedor_id, fornecedor_nome, data_aquisicao, custo_unitario, moeda, estado_fisico, instituicao_id) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
            [
                entradaId, 
                equipamentoId, 
                equipamentoNome, 
                qtd, 
                listaSerials, 
                instituicao.trim(), 
                dataRegisto,
                faturaNumero ? faturaNumero.trim() : null,
                fornecedorId || null,
                fornecedorNome ? fornecedorNome.trim() : null,
                dataAquisicao || null,
                custoUnitario ? parseFloat(custoUnitario) : null,
                moeda || 'MZN',
                estadoFisico || 'novo',
                instituicaoId || null
            ]
        );

        await registrarAuditoria(pool, {
            req,
            acao: 'REGISTAR_ENTRADA',
            entidade: 'historico_entradas',
            entidadeId: entradaId,
            instituicaoNome: instituicao.trim(),
            dadosNovos: { equipamentoNome, quantidade: qtd, serials: listaSerials, faturaNumero, fornecedorNome }
        });

        res.status(201).json({ message: 'Entrada registada com sucesso!', id: entradaId });
    } catch (err) {
        console.error('Erro ao registar entrada:', err);
        res.status(500).json({ error: 'Erro interno ao registar entrada.' });
    }
});

app.post('/api/entradas-lote', autenticarToken, async (req, res) => {
    const body = req.body || {};
    const faturaNumero = String(body.faturaNumero || body.numeroFatura || '').trim();
    const dataAquisicao = body.dataAquisicao;
    const instituicaoId = body.instituicaoId || body.instituicaoDestinoId || null;
    const instituicaoNome = body.instituicao || body.instituicaoDestino || body.instituicaoNome || '';
    const fornecedorId = body.fornecedorId || null;
    const fornecedorNome = body.fornecedorNome || '';
    const itens = body.modelos || body.itens;

    if (!faturaNumero || faturaNumero.length > 100 ||
        typeof dataAquisicao !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dataAquisicao) ||
        !instituicaoId && !String(instituicaoNome).trim() ||
        !fornecedorId && !String(fornecedorNome).trim() ||
        !Array.isArray(itens) || itens.length === 0) {
        return res.status(400).json({ error: 'Fatura, fornecedor, data de aquisição, instituição de destino e modelos são obrigatórios.' });
    }

    const parsedDate = new Date(`${dataAquisicao}T00:00:00.000Z`);
    if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== dataAquisicao) {
        return res.status(400).json({ error: 'Data de aquisição inválida.' });
    }

    const seenSerials = new Set();
    let totalSeriais = 0;
    const normalizedItems = [];
    for (const item of itens) {
        const equipamentoId = item && (item.equipamentoId || item.modeloId);
        const serialValues = item && (item.serials || item.serialNumbers || item.numerosSerie);
        const serials = Array.isArray(serialValues)
            ? serialValues.map(serial => typeof serial === 'string' ? serial.trim() : '').filter(Boolean)
            : [];
        const custoInformado = item && (item.custoUnitario ?? item.precoUnitario);
        const custo = Number(custoInformado);
        const estado = String(item && (item.estadoFisico || 'novo')).trim().toLowerCase();
        if (!equipamentoId || serials.length === 0 || custoInformado === undefined ||
            custoInformado === null || !Number.isFinite(custo) || custo < 0 || custo > 9999999999999.99 ||
            serials.some(serial => serial.length > 100) ||
            !['novo', 'operacional', 'avariado', 'abatido'].includes(estado)) {
            return res.status(400).json({ error: 'Cada modelo deve ter equipamento, números de série (até 100 caracteres), custo válido e estado físico permitido.' });
        }
        for (const serial of serials) {
            const chave = serial.toLowerCase();
            if (seenSerials.has(chave)) {
                return res.status(409).json({ error: `Número de série repetido na fatura: ${serial}.` });
            }
            seenSerials.add(chave);
        }
        totalSeriais += serials.length;
        if (totalSeriais > 100) {
            return res.status(400).json({ error: 'O limite por fatura é de 100 números de série.' });
        }
        normalizedItems.push({
            equipamentoId,
            serials,
            custoUnitario: custo,
            estadoFisico: estado,
            moeda: String(item.moeda || body.moeda || 'MZN').trim().toUpperCase()
        });
    }
    const valorTotalPrevisto = normalizedItems.reduce(
        (total, item) => total + item.custoUnitario * item.serials.length,
        0
    );
    if (!Number.isFinite(valorTotalPrevisto) || valorTotalPrevisto > 9999999999999.99 ||
        normalizedItems.some(item => item.moeda.length > 10)) {
        return res.status(400).json({ error: 'Valor total ou moeda da fatura inválidos.' });
    }

    const escopo = obterEscopoInstitucional(req);
    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');

        const instituicaoRes = await client.query(
            `SELECT id, nome, sigla FROM public.instituicoes
             WHERE COALESCE(ativo, TRUE) = TRUE
               AND (($1::varchar IS NOT NULL AND id = $1)
                 OR ($2::varchar <> '' AND (LOWER(nome) = LOWER($2) OR LOWER(sigla) = LOWER($2))))
             ORDER BY CASE WHEN id = $1 THEN 0 ELSE 1 END
             LIMIT 1 FOR SHARE`,
            [instituicaoId, String(instituicaoNome).trim()]
        );
        if (instituicaoRes.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Instituição de destino não encontrada ou inativa.' });
        }
        const instituicao = instituicaoRes.rows[0];
        if (escopo && escopo.toLowerCase() !== instituicao.nome.toLowerCase() &&
            escopo.toLowerCase() !== instituicao.sigla.toLowerCase()) {
            await client.query('ROLLBACK');
            return res.status(403).json({ error: `Como Técnico, apenas pode registar stock para a sua instituição (${escopo}).` });
        }

        let fornecedor;
        const fornecedorRes = await client.query(
            `SELECT id, COALESCE(nome_empresa, nome) AS nome
             FROM public.fornecedores
             WHERE COALESCE(ativo, TRUE) = TRUE
               AND (($1::varchar IS NOT NULL AND id = $1)
                 OR ($2::varchar <> '' AND LOWER(COALESCE(nome_empresa, nome)) = LOWER($2)))
             ORDER BY CASE WHEN id = $1 THEN 0 ELSE 1 END
             LIMIT 1 FOR SHARE`,
            [fornecedorId, String(fornecedorNome).trim()]
        );
        if (fornecedorRes.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Fornecedor não encontrado ou inativo.' });
        }
        fornecedor = fornecedorRes.rows[0];

        const equipamentoIds = [...new Set(normalizedItems.map(item => item.equipamentoId))];
        const equipamentosRes = await client.query(
            `SELECT id, marca, modelo, part_number
             FROM public.equipamentos
             WHERE id = ANY($1::varchar[]) AND COALESCE(ativo, TRUE) = TRUE
             FOR SHARE`,
            [equipamentoIds]
        );
        const equipamentos = new Map(equipamentosRes.rows.map(equipamento => [equipamento.id, equipamento]));
        const desconhecido = equipamentoIds.find(id => !equipamentos.has(id));
        if (desconhecido) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: `Modelo de equipamento não encontrado ou inativo: ${desconhecido}.` });
        }

        const seriaisNormalizados = [...seenSerials];
        await client.query(
            `SELECT pg_advisory_xact_lock(hashtextextended(serial, 0))
             FROM UNNEST($1::text[]) AS s(serial)
             ORDER BY serial`,
            [seriaisNormalizados]
        );
        const duplicadosRes = await client.query(
            `SELECT DISTINCT LOWER(TRIM(s.serial)) AS serial
             FROM public.historico_entradas he
             CROSS JOIN LATERAL UNNEST(he.serials) AS s(serial)
             WHERE LOWER(TRIM(s.serial)) = ANY($1::text[])`,
            [seriaisNormalizados]
        );
        if (duplicadosRes.rowCount > 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                error: `Número(s) de série já registado(s): ${duplicadosRes.rows.map(row => row.serial).join(', ')}.`
            });
        }

        const valorTotal = valorTotalPrevisto;
        const faturaId = criarId('fat');
        await client.query(
            `INSERT INTO public.faturas_aquisicao
                (id, fatura_numero, fornecedor_id, fornecedor_nome, instituicao_id,
                 instituicao_nome, data_aquisicao, valor_total, registado_por, observacoes)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
                faturaId, faturaNumero, fornecedor.id, fornecedor.nome, instituicao.id,
                instituicao.nome, dataAquisicao, valorTotal, req.usuario.id,
                body.observacoes ? String(body.observacoes).trim() : null
            ]
        );

        const entradas = [];
        const qrCodes = [];
        for (const item of normalizedItems) {
            const equipamento = equipamentos.get(item.equipamentoId);
            const entradaId = criarId('ent');
            const equipamentoNome = `${equipamento.marca} ${equipamento.modelo} (${equipamento.part_number})`;
            await client.query(
                `INSERT INTO public.historico_entradas
                    (id, equipamento_id, equipamento_nome, quantidade, serials, instituicao,
                     data_hora, fatura_numero, fornecedor_id, fornecedor_nome, data_aquisicao,
                     custo_unitario, moeda, estado_fisico, instituicao_id, fatura_id, observacoes)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
                [
                    entradaId, equipamento.id, equipamentoNome, item.serials.length, item.serials,
                    instituicao.nome, new Date().toISOString(), faturaNumero, fornecedor.id,
                    fornecedor.nome, dataAquisicao, item.custoUnitario, item.moeda,
                    item.estadoFisico, instituicao.id, faturaId,
                    body.observacoes ? String(body.observacoes).trim() : null
                ]
            );
            entradas.push({ id: entradaId, equipamentoId: equipamento.id, quantidade: item.serials.length });
            for (const serial of item.serials) {
                const qrData = `SGSTOCK|SN:${serial}`;
                qrCodes.push({
                    serial,
                    equipamentoId: equipamento.id,
                    svg: gerarSvgQRCode(qrData, 120)
                });
            }
        }

        await inserirLogAuditoria(client, req, {
            acao: 'REGISTAR_ENTRADA_LOTE',
            entidade: 'faturas_aquisicao',
            entidadeId: faturaId,
            dadosNovos: {
                faturaNumero,
                fornecedorId: fornecedor.id,
                instituicaoId: instituicao.id,
                valorTotal,
                entradas,
                serials: [...seenSerials]
            }
        });
        await client.query('COMMIT');

        res.status(201).json({
            message: 'Fatura e entradas registadas com sucesso.',
            faturaId,
            entradas,
            qrCodes
        });
    } catch (err) {
        if (client) {
            try { await client.query('ROLLBACK'); } catch (rollbackError) {
                console.error('Erro no rollback da entrada em lote:', rollbackError);
            }
        }
        console.error('Erro ao registar entrada em lote:', err);
        if (err.code === '23505') return res.status(409).json({ error: 'A fatura ou um número de série já se encontra registado.' });
        if (err.code === '23503') return res.status(400).json({ error: 'Fornecedor, instituição ou modelo inválido.' });
        res.status(500).json({ error: 'Erro interno ao registar a fatura e as entradas.' });
    } finally {
        if (client) client.release();
    }
});

// Atualizar entrada (PROTEGIDO: Administrador)
app.put('/api/entradas/:id', autenticarToken, verificarAdmin, async (req, res) => {
    const { id } = req.params;
    const { instituicao, serials, quantidade, equipamentoNome, faturaNumero, fornecedorNome, custoUnitario, estadoFisico } = req.body;

    try {
        const listaSerials = Array.isArray(serials) ? serials.map(s => String(s).trim()).filter(Boolean) : [];
        const anterior = await pool.query('SELECT * FROM historico_entradas WHERE id = $1', [id]);

        if (anterior.rowCount === 0) {
            return res.status(404).json({ error: 'Registo de entrada não encontrado.' });
        }

        const result = await pool.query(
            `UPDATE public.historico_entradas 
             SET instituicao = COALESCE($1, instituicao), 
                 serials = COALESCE($2, serials), 
                 quantidade = COALESCE($3, quantidade), 
                 equipamento_nome = COALESCE($4, equipamento_nome),
                 fatura_numero = COALESCE($5, fatura_numero),
                 fornecedor_nome = COALESCE($6, fornecedor_nome),
                 custo_unitario = COALESCE($7, custo_unitario),
                 estado_fisico = COALESCE($8, estado_fisico)
             WHERE id = $9 
             RETURNING *`,
            [
                instituicao, 
                listaSerials.length > 0 ? listaSerials : null, 
                quantidade, 
                equipamentoNome,
                faturaNumero,
                fornecedorNome,
                custoUnitario ? parseFloat(custoUnitario) : null,
                estadoFisico,
                id
            ]
        );

        await registrarAuditoria(pool, {
            req,
            acao: 'EDITAR_ENTRADA',
            entidade: 'historico_entradas',
            entidadeId: id,
            dadosAnteriores: anterior.rows[0],
            dadosNovos: result.rows[0]
        });

        res.json({ message: 'Entrada atualizada com sucesso!', entrada: result.rows[0] });
    } catch (error) {
        console.error('Erro ao atualizar entrada:', error);
        res.status(500).json({ error: 'Erro interno ao atualizar entrada.' });
    }
});

// Eliminar entrada (PROTEGIDO: Administrador)
app.delete('/api/entradas/:id', autenticarToken, verificarAdmin, async (req, res) => {
    const { id } = req.params;

    try {
        const result = await pool.query('DELETE FROM public.historico_entradas WHERE id = $1 RETURNING *', [id]);
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Registo de entrada não encontrado.' });
        }

        await registrarAuditoria(pool, {
            req,
            acao: 'ELIMINAR_ENTRADA',
            entidade: 'historico_entradas',
            entidadeId: id,
            dadosAnteriores: result.rows[0]
        });

        await enviarAlertaOperacaoSensivel({
            usuario: req.usuario.nome || req.usuario.email,
            acao: 'ELIMINAÇÃO DE ENTRADA DE STOCK',
            entidade: `Entrada ID ${id} (${result.rows[0].equipamento_nome})`,
            detalhes: `Eliminada por Administrador. Quantidade: ${result.rows[0].quantidade}, Serials: ${result.rows[0].serials.join(', ')}`,
            ip: req.ip
        });

        res.json({ message: 'Registo de entrada eliminado com sucesso!' });
    } catch (error) {
        console.error('Erro ao eliminar entrada:', error);
        res.status(500).json({ error: 'Erro interno ao eliminar entrada.' });
    }
});

// ==========================================
// ENDPOINTS: STOCK CONSOLIDADO & GESTÃO DE S/N
// ==========================================

// Consultar stock atual consolidado diretamente da view do PostgreSQL com escopo RBAC
app.get('/api/stock', autenticarToken, async (req, res) => {
    const escopo = obterEscopoInstitucional(req);

    try {
        let query = `
            SELECT 
                equipamento_id AS "equipamentoId", 
                marca, 
                modelo, 
                part_number AS "partNumber",
                categoria,
                local_atual AS "instituicao", 
                total, 
                serials,
                capacidade_banda AS "capacidadeBanda",
                portas,
                fibra_escura AS "fibraEscura",
                vida_util_anos AS "vidaUtilAnos",
                valor_total AS "valorTotal",
                GREATEST(
                    COALESCE((
                        SELECT MAX(he.criado_em)
                        FROM public.historico_entradas he
                        WHERE he.equipamento_id = view_stock_atual.equipamento_id
                          AND he.serials && view_stock_atual.serials
                    ), '-infinity'::timestamptz),
                    COALESCE((
                        SELECT MAX(ht.criado_em)
                        FROM public.historico_transferencias ht
                        WHERE ht.equipamento_id = view_stock_atual.equipamento_id
                          AND ht.serials && view_stock_atual.serials
                    ), '-infinity'::timestamptz)
                ) AS "ultimaAtividade"
            FROM public.view_stock_atual
        `;
        const params = [];

        if (escopo) {
            query += ' WHERE LOWER(local_atual) = LOWER($1)';
            params.push(escopo);
        }

        query += ' ORDER BY "ultimaAtividade" DESC NULLS LAST, marca, modelo, local_atual';

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) {
        console.error('Erro ao buscar stock consolidado:', err);
        res.status(500).json({ error: 'Erro interno ao consultar posição de stock.' });
    }
});

// Eliminar S/N (PROTEGIDO: Administrador)
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

        const equipamento = await client.query('SELECT id FROM equipamentos WHERE id = $1 FOR UPDATE', [equipamentoId]);
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

        await registrarAuditoria(pool, {
            req,
            acao: 'ELIMINAR_SERIAL',
            entidade: 'equipamentos',
            entidadeId: equipamentoId,
            instituicaoNome: instituicao,
            dadosAnteriores: { serial, equipamentoId, instituicao }
        });

        res.json({ message: 'Serial removido do stock e do histórico associado.', serial, movimentosAtualizados });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Erro ao eliminar serial do stock:', error);
        res.status(500).json({ error: 'Erro interno ao eliminar o número de série.' });
    } finally {
        client.release();
    }
});

// Atualizar S/N (PROTEGIDO: Administrador)
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

        const equipamento = await client.query('SELECT id FROM equipamentos WHERE id = $1 FOR UPDATE', [equipamentoId]);
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

        for (const tabela of ['public.historico_entradas', 'public.historico_transferencias']) {
            await client.query(
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
        }

        await client.query('COMMIT');

        await registrarAuditoria(pool, {
            req,
            acao: 'EDITAR_SERIAL',
            entidade: 'equipamentos',
            entidadeId: equipamentoId,
            dadosAnteriores: { serialAntigo: serial },
            dadosNovos: { serialNovo: novoSerial }
        });

        res.json({ message: 'Número de série atualizado com sucesso.', serial: novoSerial });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Erro ao atualizar serial do stock:', error);
        res.status(500).json({ error: 'Erro interno ao atualizar o número de série.' });
    } finally {
        client.release();
    }
});

// ==========================================
// ENDPOINTS: TRANSFERÊNCIAS TRANSACIONAIS
// ==========================================

// Listar transferências com escopo
app.get('/api/transferencias', autenticarToken, async (req, res) => {
    const escopo = obterEscopoInstitucional(req);

    try {
        let query = `
            SELECT 
                id, 
                equipamento_id AS "equipamentoId", 
                equipamento_nome AS "equipamentoNome", 
                quantidade, 
                serials, 
                origem, 
                destino, 
                data_hora AS "dataHora", 
                criado_em AS "criadoEm",
                criado_em AS "ultimaAtividade",
                COALESCE(cancelado, FALSE) AS "cancelado",
                responsavel_transporte AS "responsavelTransporte",
                matricula_viatura AS "matriculaViatura",
                signatario_nome AS "signatarioNome",
                signatario_cargo AS "signatarioCargo",
                tipo_guia AS "tipoGuia"
            FROM public.historico_transferencias 
            WHERE (cancelado IS NULL OR cancelado = FALSE)
        `;
        const params = [];

        if (escopo) {
            query += ' AND (LOWER(origem) = LOWER($1) OR LOWER(destino) = LOWER($1))';
            params.push(escopo);
        }

        query += ' ORDER BY criado_em DESC NULLS LAST, id DESC';

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) {
        console.error('Erro ao buscar transferências:', err);
        res.status(500).json({ error: 'Erro interno ao carregar transferências.' });
    }
});

// Processar Nova Transferência com Transação ACID, Validação de Posse e Alerta Preditivo
app.post('/api/transferencias', autenticarToken, async (req, res) => {
    const { 
        id, equipamentoId, equipamentoNome, serials, origem, destino, dataHora,
        responsavelTransporte, matriculaViatura, signatarioNome, signatarioCargo, tipoGuia
    } = req.body;

    if (!equipamentoId || !origem || !destino) {
        return res.status(400).json({ error: 'Equipamento, origem e destino são obrigatórios.' });
    }

    const origemFormatada = origem.trim();
    const destinoFormatado = destino.trim();

    if (origemFormatada.toLowerCase() === destinoFormatado.toLowerCase()) {
        return res.status(400).json({ error: 'A instituição de origem e o destino não podem ser iguais.' });
    }

    const escopo = obterEscopoInstitucional(req);
    if (escopo && origemFormatada.toLowerCase() !== escopo.toLowerCase()) {
        return res.status(403).json({ error: `Como Técnico, apenas pode efetuar saídas de stock a partir da sua instituição (${escopo}).` });
    }

    const listaSerials = Array.isArray(serials) ? serials.map(s => String(s).trim()).filter(Boolean) : [];
    if (listaSerials.length === 0) {
        return res.status(400).json({ error: 'É obrigatório selecionar pelo menos um número de série para transferir.' });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 1. Bloqueia leitura do equipamento
        const eqResult = await client.query(
            'SELECT id, marca, modelo, part_number FROM public.equipamentos WHERE id = $1 FOR SHARE',
            [equipamentoId]
        );

        if (eqResult.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Equipamento não encontrado.' });
        }

        const eq = eqResult.rows[0];
        const nomeOficial = `${eq.marca} ${eq.modelo} (${eq.part_number})`;

        // 2. Validação de Posse Física
        const stockVerificacao = await client.query(
            `SELECT unnest(serials) AS sn 
             FROM public.view_stock_atual 
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
            `INSERT INTO public.historico_transferencias 
             (id, equipamento_id, equipamento_nome, quantidade, serials, origem, destino, data_hora, cancelado, responsavel_transporte, matricula_viatura, signatario_nome, signatario_cargo, tipo_guia) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, FALSE, $9, $10, $11, $12, $13)`,
            [
                transfId, 
                equipamentoId, 
                nomeOficial, 
                listaSerials.length, 
                listaSerials, 
                origemFormatada, 
                destinoFormatado, 
                dataMovimento,
                responsavelTransporte ? responsavelTransporte.trim() : null,
                matriculaViatura ? matriculaViatura.trim() : null,
                signatarioNome ? signatarioNome.trim() : null,
                signatarioCargo ? signatarioCargo.trim() : null,
                tipoGuia || 'saida'
            ]
        );

        await client.query('COMMIT');

        // Auditoria imutável
        await registrarAuditoria(pool, {
            req,
            acao: 'EFETUAR_TRANSFERENCIA',
            entidade: 'historico_transferencias',
            entidadeId: transfId,
            instituicaoNome: origemFormatada,
            dadosNovos: { equipamentoNome: nomeOficial, quantidade: listaSerials.length, serials: listaSerials, origem: origemFormatada, destino: destinoFormatado }
        });

        // Verificação de stock restante na origem para alerta proativo
        const restante = seriaisDisponiveis.size - listaSerials.length;
        if (restante <= 1) {
            enviarAlertaStockCritico({
                equipamentoNome: nomeOficial,
                instituicao: origemFormatada,
                quantidadeRestante: restante
            }).catch(e => console.error('Falha ao enviar alerta de stock crítico:', e.message));
        }

        res.status(201).json({ message: 'Transferência efetuada e registada com sucesso!', id: transfId });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Erro na transação de transferência:', err);
        res.status(500).json({ error: 'Erro interno ao processar transferência transacional.' });
    } finally {
        client.release();
    }
});

// Anular transferência por ID (PROTEGIDO: Administrador)
app.delete('/api/transferencias/:id', autenticarToken, verificarAdmin, async (req, res) => {
    const { id } = req.params;
    const usuarioEmail = (req.usuario && req.usuario.email) || 'admin';

    try {
        const result = await pool.query(
            `UPDATE public.historico_transferencias 
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

        await registrarAuditoria(pool, {
            req,
            acao: 'ANULAR_TRANSFERENCIA',
            entidade: 'historico_transferencias',
            entidadeId: id,
            dadosAnteriores: result.rows[0]
        });

        res.json({ message: 'Registo de transferência anulado com sucesso!' });
    } catch (error) {
        console.error('Erro ao anular transferência:', error);
        res.status(500).json({ error: 'Erro interno ao anular transferência.' });
    }
});

// ==========================================
// ENDPOINTS: INTELIGÊNCIA PREDITIVA & KPIS ANALÍTICOS
// ==========================================

// Matriz de Saúde de Ativos (Asset Health Matrix)
app.get('/api/analytics/asset-health', autenticarToken, async (req, res) => {
    const escopo = obterEscopoInstitucional(req);

    try {
        let query = `
            SELECT 
                equipamento_id AS "equipamentoId",
                marca,
                modelo,
                part_number AS "partNumber",
                categoria,
                serial_number AS "serial",
                localizacao_atual AS "localAtual",
                localizacao_atual AS "local_atual",
                data_aquisicao AS "dataAquisicao",
                idade_anos AS "idadeAnos",
                vida_util_anos AS "vidaUtilAnos",
                custo_aquisicao AS "custoUnitario",
                estado_fisico AS "estadoFisico",
                avarias_abertas AS "avariasAbertas",
                total_avarias_historico AS "totalAvarias",
                percentual_saude AS "percentualSaude",
                status_saude AS "classificacao_saude",
                status_saude AS "classificacaoSaude",
                incidente.justificativa AS "justificativa",
                GREATEST(
                    COALESCE(incidente.criado_em, '-infinity'::timestamptz),
                    COALESCE(movimento.criado_em, '-infinity'::timestamptz),
                    COALESCE(health.data_aquisicao::timestamptz, '-infinity'::timestamptz)
                ) AS "ultimaAtividade",
                CASE 
                    WHEN estado_fisico = 'avariado' THEN 'Priorizar diagnóstico e manutenção; acompanhar o incidente registado.'
                    WHEN estado_fisico = 'abatido' THEN 'Retirar de operação e formalizar o abate ou encaminhamento para reciclagem.'
                    WHEN idade_anos >= vida_util_anos THEN 'Vida útil esgotada: avaliar substituição e iniciar processo de abate.'
                    WHEN status_saude ILIKE '%atenção%' OR status_saude ILIKE '%alerta%' THEN 'Planear manutenção preventiva e preparar a substituição antes do fim da vida útil.'
                    ELSE 'Operação normal e condições ótimas'
                END AS "acao_recomendada",
                CASE 
                    WHEN estado_fisico = 'avariado' THEN 'Priorizar diagnóstico e manutenção; acompanhar o incidente registado.'
                    WHEN estado_fisico = 'abatido' THEN 'Retirar de operação e formalizar o abate ou encaminhamento para reciclagem.'
                    WHEN idade_anos >= vida_util_anos THEN 'Vida útil esgotada: avaliar substituição e iniciar processo de abate.'
                    WHEN status_saude ILIKE '%atenção%' OR status_saude ILIKE '%alerta%' THEN 'Planear manutenção preventiva e preparar a substituição antes do fim da vida útil.'
                    ELSE 'Operação normal e condições ótimas'
                END AS "acaoRecomendada"
            FROM public.view_asset_health health
            LEFT JOIN LATERAL (
                SELECT justificativa, criado_em
                FROM public.historico_incidentes incidente
                WHERE incidente.equipamento_id = health.equipamento_id
                  AND LOWER(TRIM(incidente.serial_number)) = LOWER(TRIM(health.serial_number))
                ORDER BY incidente.criado_em DESC, incidente.id DESC
                LIMIT 1
            ) incidente ON TRUE
            LEFT JOIN LATERAL (
                SELECT MAX(atividade.criado_em) AS criado_em
                FROM (
                    SELECT he.criado_em
                    FROM public.historico_entradas he
                    WHERE he.equipamento_id = health.equipamento_id
                      AND EXISTS (
                          SELECT 1 FROM UNNEST(he.serials) AS s(serial)
                          WHERE LOWER(TRIM(s.serial)) = LOWER(TRIM(health.serial_number))
                      )
                    UNION ALL
                    SELECT ht.criado_em
                    FROM public.historico_transferencias ht
                    WHERE (ht.cancelado IS NULL OR ht.cancelado = FALSE)
                      AND EXISTS (
                          SELECT 1 FROM UNNEST(ht.serials) AS s(serial)
                          WHERE LOWER(TRIM(s.serial)) = LOWER(TRIM(health.serial_number))
                      )
                ) atividade
            ) movimento ON TRUE
        `;
        const params = [];

        if (escopo) {
            query += ' WHERE LOWER(health.localizacao_atual) = LOWER($1)';
            params.push(escopo);
        }

        query += ' ORDER BY "ultimaAtividade" DESC NULLS LAST, health.marca, health.modelo';

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) {
        console.error('Erro ao obter Asset Health Matrix:', err);
        res.status(500).json({ error: 'Erro interno ao consultar matriz de saúde de ativos.' });
    }
});

// KPIs Acionáveis de Decisão
app.get('/api/analytics/kpis', autenticarToken, async (req, res) => {
    const escopo = obterEscopoInstitucional(req);

    try {
        // 1. Total de Modelos
        const totalModelosRes = await pool.query('SELECT COUNT(*) AS total FROM public.equipamentos');
        const totalModelos = parseInt(totalModelosRes.rows[0].total, 10);

        // 2. Stock e Total de Unidades (com escopo se técnico)
        let stockQuery = 'SELECT COALESCE(SUM(total), 0) AS "totalUnidades", COUNT(DISTINCT equipamento_id) AS "modelosEmStock" FROM public.view_stock_atual';
        const stockParams = [];
        if (escopo) {
            stockQuery += ' WHERE LOWER(local_atual) = LOWER($1)';
            stockParams.push(escopo);
        }
        const stockRes = await pool.query(stockQuery, stockParams);
        const totalUnidades = parseInt(stockRes.rows[0].totalUnidades, 10);

        // 3. Valor Total Investido (MZN)
        let valorQuery = `
            SELECT COALESCE(SUM(custo_unitario * quantidade), 0) AS "valorTotal" 
            FROM public.historico_entradas
        `;
        const valorParams = [];
        if (escopo) {
            valorQuery += ' WHERE LOWER(instituicao) = LOWER($1)';
            valorParams.push(escopo);
        }
        const valorRes = await pool.query(valorQuery, valorParams);
        const valorTotalInvestido = parseFloat(valorRes.rows[0].valorTotal);

        // 4. Distribuição por Categoria
        let catQuery = `
            SELECT COALESCE(e.categoria, 'Geral') AS categoria, COALESCE(SUM(s.total), 0) AS total
            FROM public.equipamentos e
            JOIN public.view_stock_atual s ON e.id = s.equipamento_id
        `;
        const catParams = [];
        if (escopo) {
            catQuery += ' WHERE LOWER(s.local_atual) = LOWER($1)';
            catParams.push(escopo);
        }
        catQuery += ' GROUP BY e.categoria ORDER BY total DESC';
        const catRes = await pool.query(catQuery, catParams);

        // 5. Contagem de Ativos por Classificação de Saúde
        let saudeQuery = 'SELECT status_saude AS classificacao_saude, COUNT(*) AS total FROM public.view_asset_health';
        const saudeParams = [];
        if (escopo) {
            saudeQuery += ' WHERE LOWER(localizacao_atual) = LOWER($1)';
            saudeParams.push(escopo);
        }
        saudeQuery += ' GROUP BY status_saude';
        const saudeRes = await pool.query(saudeQuery, saudeParams);

        // 6. Capacidade Técnica Agregada (Equipamentos e Fibra)
        let tecQuery = `
            SELECT 
                COALESCE(SUM(s.total), 0) AS "totalPortas",
                COALESCE(SUM(CASE WHEN s.fibra_escura = TRUE THEN s.total ELSE 0 END), 0) AS "ativosFibra"
            FROM public.view_stock_atual s
        `;
        const tecParams = [];
        if (escopo) {
            tecQuery += ' WHERE LOWER(s.local_atual) = LOWER($1)';
            tecParams.push(escopo);
        }
        const tecRes = await pool.query(tecQuery, tecParams);

        res.json({
            totalModelos,
            totalUnidades,
            valorTotalInvestido,
            moeda: 'MZN',
            distribuicaoCategorias: catRes.rows,
            distribuicaoSaude: saudeRes.rows,
            capacidadeTecnica: {
                totalPortas: parseInt(tecRes.rows[0].totalPortas, 10),
                ativosFibra: parseInt(tecRes.rows[0].ativosFibra, 10)
            }
        });
    } catch (err) {
        console.error('Erro ao calcular KPIs analíticos:', err);
        res.status(500).json({ error: 'Erro interno ao compilar KPIs analíticos.' });
    }
});

// Registo de Avarias Técnicas
app.post('/api/avarias', autenticarToken, async (req, res) => {
    const { equipamentoId, serialNumber, instituicao, descricaoProblema, gravidade } = req.body;

    if (!equipamentoId || !serialNumber || !descricaoProblema) {
        return res.status(400).json({ error: 'Equipamento, S/N e descrição do problema são obrigatórios.' });
    }

    try {
        const result = await pool.query(
            `INSERT INTO public.historico_avarias 
             (equipamento_id, serial_number, instituicao, descricao_problema, gravidade, reportado_por)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [
                equipamentoId, 
                serialNumber.trim(), 
                instituicao ? instituicao.trim() : 'MCTD Sede', 
                descricaoProblema.trim(), 
                gravidade || 'moderada', 
                req.usuario.nome || req.usuario.email
            ]
        );

        await registrarAuditoria(pool, {
            req,
            acao: 'REGISTAR_AVARIA',
            entidade: 'historico_avarias',
            entidadeId: result.rows[0].id,
            dadosNovos: result.rows[0]
        });

        res.status(201).json({ message: 'Incidente de avaria registado com sucesso!', avaria: result.rows[0] });
    } catch (err) {
        console.error('Erro ao registar avaria:', err);
        res.status(500).json({ error: 'Erro interno ao registar avaria.' });
    }
});

// Listar Avarias
app.get('/api/avarias', autenticarToken, async (req, res) => {
    const escopo = obterEscopoInstitucional(req);

    try {
        let query = `
            SELECT 
                a.id, a.equipamento_id AS "equipamentoId", e.marca, e.modelo, 
                a.serial_number AS "serialNumber", a.instituicao, a.descricao_problema AS "descricaoProblema",
                a.gravidade, a.resolvido, a.reportado_por AS "reportadoPor", a.criado_em AS "criadoEm"
            FROM public.historico_avarias a
            LEFT JOIN public.equipamentos e ON a.equipamento_id = e.id
        `;
        const params = [];

        if (escopo) {
            query += ' WHERE LOWER(a.instituicao) = LOWER($1)';
            params.push(escopo);
        }

        query += ' ORDER BY a.criado_em DESC';

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) {
        console.error('Erro ao obter avarias:', err);
        res.status(500).json({ error: 'Erro interno ao listar avarias.' });
    }
});

// ==========================================
// ENDPOINTS: CENTRO DE AUDITORIA (AUDIT HUB)
// ==========================================

// Consulta de Logs de Auditoria Imutáveis (PROTEGIDO: Administrador)
app.get('/api/auditoria', autenticarToken, verificarAdmin, async (req, res) => {
    try {
        const { limite, offset, usuario, acao, entidade, dataInicio, dataFim, instituicao } = req.query;
        const logs = await listarAuditoria(pool, { limite, offset, usuario, acao, entidade, dataInicio, dataFim, instituicao });
        res.json(logs);
    } catch (err) {
        console.error('Erro ao consultar logs de auditoria:', err);
        res.status(500).json({ error: 'Erro interno ao consultar auditoria.' });
    }
});

app.get('/api/audit-logs', autenticarToken, verificarAdmin, async (req, res) => {
    const conditions = [];
    const values = [];
    const add = (condition, value) => {
        values.push(value);
        conditions.push(condition(`$${values.length}`));
    };
    const operador = typeof req.query.operador === 'string' ? req.query.operador.trim() : '';
    const acao = typeof req.query.acao === 'string' ? req.query.acao.trim() : '';
    const entidade = typeof req.query.entidade === 'string' ? req.query.entidade.trim() : '';
    const dataInicio = typeof req.query.dataInicio === 'string' ? req.query.dataInicio : '';
    const dataFim = typeof req.query.dataFim === 'string' ? req.query.dataFim : '';
    if (dataInicio && Number.isNaN(Date.parse(dataInicio))) {
        return res.status(400).json({ error: 'Filtro dataInicio inválido.' });
    }
    if (dataFim && Number.isNaN(Date.parse(dataFim))) {
        return res.status(400).json({ error: 'Filtro dataFim inválido.' });
    }
    if (operador) {
        values.push(`%${operador}%`);
        const parameter = `$${values.length}`;
        conditions.push(`(LOWER(usuario_nome) LIKE LOWER(${parameter}) OR LOWER(usuario_email) LIKE LOWER(${parameter}) OR LOWER(usuario_id) LIKE LOWER(${parameter}))`);
    }
    if (acao) add(parameter => `LOWER(acao) = LOWER(${parameter})`, acao);
    if (entidade) add(parameter => `LOWER(entidade) = LOWER(${parameter})`, entidade);
    if (dataInicio) add(parameter => `criado_em >= ${parameter}::timestamptz`, dataInicio);
    if (dataFim) add(parameter => `criado_em <= ${parameter}::timestamptz`, dataFim);

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limite = Math.min(Math.max(Number.parseInt(req.query.limite, 10) || 100, 1), 500);
    const offset = Math.max(Number.parseInt(req.query.offset, 10) || 0, 0);
    values.push(limite, offset);

    try {
        const logs = await pool.query(
            `SELECT id, usuario_id AS "usuarioId", usuario_nome AS "usuarioNome",
                    usuario_email AS "usuarioEmail", usuario_perfil AS "usuarioPerfil",
                    instituicao_id AS "instituicaoId", instituicao_nome AS "instituicaoNome",
                    acao, entidade, entidade_id AS "entidadeId",
                    dados_anteriores AS "dadosAnteriores", dados_novos AS "dadosNovos",
                    ip, user_agent AS "userAgent", justificativa, criado_em AS "criadoEm"
             FROM public.logs_auditoria
             ${where}
             ORDER BY criado_em DESC, id DESC
             LIMIT $${values.length - 1} OFFSET $${values.length}`,
            values
        );
        res.json(logs.rows);
    } catch (err) {
        console.error('Erro ao consultar Audit Hub:', err);
        res.status(500).json({ error: 'Erro interno ao consultar o centro de auditoria.' });
    }
});

// Trigger de Backup de Logs por E-mail (PROTEGIDO: Administrador)
app.post('/api/auditoria/backup-email', autenticarToken, verificarAdmin, async (req, res) => {
    try {
        const logs = await listarAuditoria(pool, { limite: 2000 });
        const csvString = gerarCsvAuditoria(logs);
        const nomeArquivo = `sgStock_Auditoria_${new Date().toISOString().slice(0, 10)}.csv`;

        const resultadoEnvio = await enviarBackupLogsAuditoria(csvString, nomeArquivo, logs.length);

        await registrarAuditoria(pool, {
            req,
            acao: 'BACKUP_LOGS_EMAIL',
            entidade: 'auditoria',
            dadosNovos: { totalRegistos: logs.length, resultado: resultadoEnvio }
        });

        res.json({ 
            message: 'Backup de auditoria enviado por e-mail com sucesso!', 
            totalRegistos: logs.length,
            detalhes: resultadoEnvio 
        });
    } catch (err) {
        console.error('Erro ao disparar backup de auditoria por e-mail:', err);
        res.status(500).json({ error: 'Erro interno ao processar backup por e-mail.' });
    }
});

// ==========================================
// ENDPOINTS: EXPORTAÇÃO CSV/EXCEL & IMPORTAÇÃO EM LOTE
// ==========================================

// Exportação CSV UTF-8 BOM para Excel
app.get('/api/export/:tipo', autenticarToken, async (req, res) => {
    const { tipo } = req.params;
    const escopo = obterEscopoInstitucional(req);

    try {
        let csvData = '';
        let fileName = `sgstock_${tipo}_${new Date().toISOString().slice(0, 10)}.csv`;

        if (tipo === 'inventario') {
            let q = 'SELECT * FROM public.view_stock_atual';
            const p = [];
            if (escopo) {
                q += ' WHERE LOWER(local_atual) = LOWER($1)';
                p.push(escopo);
            }
            const data = await pool.query(q, p);
            csvData = gerarCsvInventario(data.rows);

        } else if (tipo === 'entradas') {
            let q = 'SELECT * FROM public.historico_entradas';
            const p = [];
            if (escopo) {
                q += ' WHERE LOWER(instituicao) = LOWER($1)';
                p.push(escopo);
            }
            q += ' ORDER BY criado_em DESC';
            const data = await pool.query(q, p);
            csvData = gerarCsvEntradas(data.rows);

        } else if (tipo === 'transferencias') {
            let q = 'SELECT * FROM public.historico_transferencias WHERE (cancelado IS NULL OR cancelado = FALSE)';
            const p = [];
            if (escopo) {
                q += ' AND (LOWER(origem) = LOWER($1) OR LOWER(destino) = LOWER($1))';
                p.push(escopo);
            }
            q += ' ORDER BY id DESC';
            const data = await pool.query(q, p);
            csvData = gerarCsvTransferencias(data.rows);

        } else if (tipo === 'asset-health') {
            let q = 'SELECT * FROM public.view_asset_health';
            const p = [];
            if (escopo) {
                q += ' WHERE LOWER(local_atual) = LOWER($1)';
                p.push(escopo);
            }
            const data = await pool.query(q, p);
            csvData = gerarCsvAssetHealth(data.rows);

        } else if (tipo === 'auditoria') {
            if (req.usuario.perfil !== 'administrador') {
                return res.status(403).json({ error: 'Apenas Administradores podem exportar o histórico de auditoria.' });
            }
            const logs = await listarAuditoria(pool, { limite: 5000 });
            csvData = gerarCsvAuditoria(logs);

        } else {
            return res.status(400).json({ error: 'Tipo de exportação desconhecido.' });
        }

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        res.send(csvData);

    } catch (err) {
        console.error(`Erro ao exportar CSV (${tipo}):`, err);
        res.status(500).json({ error: 'Erro interno ao gerar exportação CSV.' });
    }
});

// Importação em Lote via CSV (PROTEGIDO: Administrador)
app.post('/api/import/stock', autenticarToken, verificarAdmin, upload.single('file'), async (req, res) => {
    try {
        if (!req.file || !req.file.buffer) {
            return res.status(400).json({ error: 'Ficheiro CSV não fornecido.' });
        }

        const textoCsv = req.file.buffer.toString('utf-8');
        const resultado = await importarStockCsv({
            pool,
            textoCsv,
            usuario: req.usuario,
            instituicaoPadrao: req.usuario.instituicao_nome || 'MCTD Sede'
        });

        await registrarAuditoria(pool, {
            req,
            acao: 'IMPORTAR_STOCK_CSV',
            entidade: 'historico_entradas',
            dadosNovos: resultado
        });

        res.json({
            message: 'Importação em lote concluída com sucesso!',
            resultado
        });
    } catch (err) {
        console.error('Erro na importação em lote CSV:', err);
        res.status(400).json({ error: err.message || 'Erro ao processar ficheiro CSV.' });
    }
});

app.use('/api', (req, res) => {
    res.status(404).json({ error: `Rota API não encontrada: ${req.method} ${req.originalUrl}` });
});

// ==========================================
// INICIALIZAÇÃO DO SERVIDOR & GRACEFUL SHUTDOWN
// ==========================================
const PORT = process.env.PORT || 3000;

let server;
if (process.env.NODE_ENV !== 'test') {
    server = app.listen(PORT, () => {
        console.log(`🚀 Servidor sgStock ativo em: http://localhost:${PORT}`);
        console.log(`👉 Acesso: http://localhost:${PORT}/login`);
    });
}

function encerrarGraciosamente(sinal) {
    console.log(`\n🛑 Sinal ${sinal} recebido. A iniciar encerramento gracioso...`);
    if (server) {
        server.close(() => {
            console.log('✅ Servidor HTTP fechado. A encerrar pool PostgreSQL...');
            pool.end(() => {
                console.log('✅ Conexões PostgreSQL encerradas. Processo concluído.');
                process.exit(0);
            });
        });

        setTimeout(() => {
            console.error('⚠️ Timeout excedido (10s). Encerramento forçado.');
            process.exit(1);
        }, 10000);
    } else {
        pool.end().then(() => process.exit(0));
    }
}

process.on('SIGTERM', () => encerrarGraciosamente('SIGTERM'));
process.on('SIGINT', () => encerrarGraciosamente('SIGINT'));

module.exports = { app, pool };
