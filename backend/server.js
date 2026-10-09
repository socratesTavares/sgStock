const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(express.json());

require('dotenv').config();
// Configuração da conexão PostgreSQL
const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

const path = require('path');

// Servir ficheiros estáticos (HTML, JS, CSS) da pasta atual
app.use(express.static(path.join(__dirname, '../frontend')));

const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET; // Altere para uma chave segura

// Middleware de Autenticação (Protege as rotas da API)
function autenticarToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    console.log(`[DEBUG] Rota: ${req.method} ${req.url} | Header Auth:`, authHeader);
    if (!token) {
        console.log('❌ [DEBUG] Token ausente ou formato inválido no header.');
        return res.status(401).json({ error: 'Acesso negado. Token não fornecido.' });
    }

    jwt.verify(token, JWT_SECRET, (err, usuario) => {
        if (err) {
            console.error('❌ [DEBUG] Falha na validação do JWT:', err.message);
            return res.status(403).json({ error: 'Token inválido ou expirado.' });
        }
        req.usuario = usuario;
        next();
    });
}
// Middleware que restringe o acesso apenas a Administradores
function verificarAdmin(req, res, next) {
    if (req.usuario && req.usuario.perfil === 'administrador') {
        return next();
    }
    return res.status(403).json({ error: 'Acesso negado. Apenas Administradores podem realizar esta ação.' });
}

// Criar o primeiro Administrador se a tabela estiver vazia
async function criarAdminInicial() {
    try {
        const res = await pool.query("SELECT COUNT(*) FROM usuarios");
        if (parseInt(res.rows[0].count, 10) === 0) {
            const senhaHash = await bcrypt.hash('admin123', 10);
            await pool.query(
                `INSERT INTO usuarios (id, nome, email, senha, perfil) 
                 VALUES ($1, $2, $3, $4, $5)`,
                ['admin-inicial', 'Administrador Geral', 'admin@sgstock.com', senhaHash, 'administrador']
            );
            console.log('--------------------------------------------------');
            console.log('✅ Utilizador Administrador criado automaticamente!');
            console.log('   Email: admin@sgstock.com');
            console.log('   Senha: admin123');
            console.log('--------------------------------------------------');
        }
    } catch (err) {
        console.error('Erro ao criar admin inicial:', err);
    }
}
// Executa a verificação ao iniciar
criarAdminInicial();


// Registar Novo Utilizador (PROTEGIDO: Requer Login + Perfil Administrador)
app.post('/api/registrar', autenticarToken, verificarAdmin, async (req, res) => {
    const { nome, email, senha, perfil } = req.body;

    if (!nome || !email || !senha || !perfil) {
        return res.status(400).json({ error: 'Todos os campos são obrigatórios.' });
    }

    if (!['administrador', 'tecnico'].includes(perfil)) {
        return res.status(400).json({ error: 'Perfil inválido. Escolha "administrador" ou "tecnico".' });
    }

    try {
        const senhaHash = await bcrypt.hash(senha, 10);
        const id = Date.now().toString();

        await pool.query(
            'INSERT INTO usuarios (id, nome, email, senha, perfil) VALUES ($1, $2, $3, $4, $5)',
            [id, nome, email.toLowerCase().trim(), senhaHash, perfil]
        );

        res.status(201).json({ message: 'Utilizador registado com sucesso!' });
    } catch (err) {
        console.error('Erro ao registar utilizador:', err);
        res.status(500).json({ error: 'Erro ao registar utilizador. O email pode já estar registado.' });
    }
});

// Rota para registar novo utilizador (Protegida)
app.post('/api/usuarios', autenticarToken, async (req, res) => {
    try {
        // Verifica se quem está a fazer a requisição é Administrador
        if (req.usuario.perfil !== 'administrador') {
            return res.status(403).json({ error: 'Acesso negado. Apenas administradores podem criar utilizadores.' });
        }

        const { nome, email, senha, perfil } = req.body;

        if (!nome || !email || !senha || !perfil) {
            return res.status(400).json({ error: 'Preencha todos os campos obrigatórios.' });
        }

        // Verifica se o email já está registado
        const existe = await pool.query('SELECT id FROM usuarios WHERE LOWER(email) = LOWER($1)', [email.trim()]);
        if (existe.rows.length > 0) {
            return res.status(400).json({ error: 'Este email já está em uso.' });
        }

        // Criptografa a senha antes de guardar
        const senhaHash = await bcrypt.hash(senha, 10);
        const novoId = 'user-' + Date.now();

        await pool.query(
            `INSERT INTO usuarios (id, nome, email, senha, perfil) VALUES ($1, $2, $3, $4, $5)`,
            [novoId, nome.trim(), email.trim(), senhaHash, perfil]
        );

        res.status(201).json({ message: 'Utilizador criado com sucesso!' });

    } catch (err) {
        console.error('Erro ao registar utilizador:', err);
        res.status(500).json({ error: 'Erro interno no servidor.' });
    }
});

// ==========================================
// ENDPOINTS: AUTENTICAÇÃO
// ==========================================

// 1. Registo de Utilizador Inicial (Criar Conta de Administrador)
app.post('/api/registrar', async (req, res) => {
    const { nome, email, senha } = req.body;
    try {
        const senhaHash = await bcrypt.hash(senha, 10);
        const id = Date.now().toString();

        await pool.query(
            'INSERT INTO usuarios (id, nome, email, senha) VALUES ($1, $2, $3, $4)',
            [id, nome, email.toLowerCase().trim(), senhaHash]
        );

        res.status(201).json({ message: 'Utilizador criado com sucesso!' });
    } catch (err) {
        console.error('Erro ao registrar:', err);
        res.status(500).json({ error: 'Erro ao criar utilizador. Email pode já existir.' });
    }
});

// 2. Login de Utilizador
// ==========================================
// ROTA DE LOGIN (ÚNICA DECLARAÇÃO)
// ==========================================
app.post('/api/login', async (req, res) => {
    try {
        const { email, senha } = req.body;

        if (!email || !senha) {
            return res.status(400).json({ error: 'Por favor, forneça email e palavra-passe.' });
        }

        // 1. Procura o utilizador ignorando maiúsculas/minúsculas e espaços
        const result = await pool.query(
            'SELECT * FROM usuarios WHERE LOWER(email) = LOWER($1)',
            [email.trim()]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Credenciais inválidas.' });
        }

        const usuario = result.rows[0];

        // 2. Compara a palavra-passe com o hash do bcrypt
        const senhaValida = await bcrypt.compare(senha, usuario.senha);
        if (!senhaValida) {
            return res.status(401).json({ error: 'Credenciais inválidas.' });
        }

        // 3. Gera o token JWT usando SEMPRE a constante JWT_SECRET definida no topo do ficheiro
        const token = jwt.sign(
            { id: usuario.id, nome: usuario.nome, email: usuario.email, perfil: usuario.perfil },
            JWT_SECRET, // Usa a mesma variável do middleware autenticarToken
            { expiresIn: '8h' }
        );

        res.json({
            message: 'Login efetuado com sucesso!',
            token,
            usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email, perfil: usuario.perfil }
        });

    } catch (err) {
        console.error('Erro no login:', err);
        res.status(500).json({ error: 'Erro interno no servidor.' });
    }
});

// NOTA: Adicionei o middleware `autenticarToken` nas rotas que pretendi proteger, ex:
// app.get('/api/equipamentos', autenticarToken, async (req, res) => { ... });
// app.post('/api/transferencias', autenticarToken, async (req, res) => { ... });

// ==========================================
// ENDPOINTS: EQUIPAMENTOS
// ==========================================

// Obter todos os equipamentos
app.get('/api/equipamentos', autenticarToken, async (req, res) => {
    try {
        // O alias AS "partNumber" garante que a propriedade chegue como partNumber ao JS
        const result = await pool.query(
            'SELECT id, marca, modelo, part_number AS "partNumber" FROM equipamentos ORDER BY marca, modelo'
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Cadastrar equipamento
app.post('/api/equipamentos', autenticarToken, async (req, res) => {
    const { id, marca, modelo, partNumber } = req.body;
    try {
        await pool.query(
            'INSERT INTO equipamentos (id, marca, modelo, part_number) VALUES ($1, $2, $3, $4)',
            [id, marca, modelo, partNumber]
        );
        res.status(201).json({ message: 'Equipamento inserido com sucesso' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


// Endpoint PUT para atualizar equipamento, localização e serial numbers
/*app.put('/api/equipamentos/:id', async (req, res) => {
    const { id } = req.params;
    const { marca, modelo, partNumber, novaInstituicao, antigaInstituicao, novosSerials } = req.body;

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 1. Atualizar Ficha Principal do Equipamento
        await client.query(
            'UPDATE equipamentos SET marca = $1, modelo = $2, part_number = $3 WHERE id = $4',
            [marca, modelo, partNumber, id]
        );

        const novoNome = `${marca} ${modelo} (${partNumber})`;

        // 2. Atualizar Nome do Equipamento em todos os registos do Histórico de Entradas
        await client.query(
            'UPDATE historico_entradas SET equipamento_nome = $1 WHERE equipamento_id = $2',
            [novoNome, id]
        );

        console.log('Atualização:', {
            marca,
            modelo,
            partNumber,
            novaInstituicao,
            antigaInstituicao,
            novosSerials,
        });

        // 3. Atualizar Localização e Serials nas Entradas
        if (antigaInstituicao || novaInstituicao || novosSerials) {
            if (Array.isArray(novosSerials) && novosSerials.length > 0) {
                await client.query(
                    `UPDATE historico_entradas 
                     SET instituicao = $1, serials = $2, quantidade = $3 
                     WHERE equipamento_id = $4 AND LOWER(instituicao) = LOWER($5)`,
                    [novaInstituicao, novosSerials, novosSerials.length, id, antigaInstituicao]
                );
            } else {
                await client.query(
                    `UPDATE historico_entradas 
                     SET instituicao = $1 
                     WHERE equipamento_id = $2 AND LOWER(instituicao) = LOWER($3)`,
                    [novaInstituicao, id, antigaInstituicao]
                );
            }
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
        res.json({ message: 'Atualizado com sucesso' });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Erro na atualização:', err);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});*/

app.put('/api/equipamentos/:id', autenticarToken, async (req, res) => {
    const { id } = req.params;
    const { marca, modelo, partNumber, novaInstituicao, antigaInstituicao, novosSerials, antigosSerials } = req.body;

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 1. Atualizar Ficha Principal do Equipamento
        await client.query(
            'UPDATE equipamentos SET marca = $1, modelo = $2, part_number = $3 WHERE id = $4',
            [marca, modelo, partNumber, id]
        );

        const novoNome = `${marca} ${modelo} (${partNumber})`;

        // 2. Atualizar Nome do Equipamento em todo o Histórico de Entradas
        await client.query(
            'UPDATE historico_entradas SET equipamento_nome = $1 WHERE equipamento_id = $2',
            [novoNome, id]
        );

        // 3. Atualizar Localização e Serials em historico_entradas
        // Tenta atualizar onde a instituição corresponde OU onde a entrada original do equipamento foi registada
        if (Array.isArray(novosSerials) && novosSerials.length > 0) {
            let resUpdate;

            // Tentativa 1: Atualiza filtrando por antigaInstituicao se existir
            if (antigaInstituicao) {
                resUpdate = await client.query(
                    `UPDATE historico_entradas 
                     SET instituicao = COALESCE(NULLIF($1, ''), instituicao), serials = $2, quantidade = $3 
                     WHERE equipamento_id = $4 AND LOWER(instituicao) = LOWER($5)`,
                    [novaInstituicao, novosSerials, novosSerials.length, id, antigaInstituicao]
                );
            }

            // Tentativa 2: Se não encontrou pela instituição (pois veio de uma transferência), atualiza a entrada principal deste equipamento
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
        console.error('Erro na atualização:', err);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

// Eliminar equipamento
// Endpoint para apagar um registo de lote/entrada específico por ID da entrada
app.put('/api/entradas/:id', autenticarToken, async (req, res) => {
    const { id } = req.params;
    const { instituicao, serials, quantidade, equipamentoNome } = req.body;

    try {
        // Garante que serials seja um Array do JS para a biblioteca 'pg' converter automaticamente
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
            return res.status(404).json({ error: 'Registo de entrada não encontrado' });
        }

        res.json({ message: 'Entrada atualizada com sucesso', entrada: result.rows[0] });
    } catch (error) {
        console.error('Erro ao atualizar entrada:', error);
        res.status(500).json({ error: 'Erro interno ao atualizar entrada' });
    }
});

// ==========================================
// ENDPOINTS: ENTRADAS
// ==========================================

app.get('/api/entradas', autenticarToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT id, equipamento_id AS "equipamentoId", equipamento_nome AS "equipamentoNome", quantidade, serials, instituicao, data_hora AS "dataHora" FROM historico_entradas');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/entradas', autenticarToken, async (req, res) => {
    const { id, equipamentoId, equipamentoNome, quantidade, serials, instituicao, dataHora } = req.body;
    try {
        await pool.query(
            'INSERT INTO historico_entradas (id, equipamento_id, equipamento_nome, quantidade, serials, instituicao, data_hora) VALUES ($1, $2, $3, $4, $5, $6, $7)',
            [id, equipamentoId, equipamentoNome, quantidade, serials, instituicao, dataHora]
        );
        res.status(201).json({ message: 'Entrada registada com sucesso' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// ENDPOINTS: TRANSFERÊNCIAS
// ==========================================

// 1. Listar Histórico de Transferências
app.get('/api/transferencias', autenticarToken, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, equipamento_id AS "equipamentoId", equipamento_nome AS "equipamentoNome", quantidade, serials, origem, destino, data_hora AS "dataHora" FROM historico_transferencias ORDER BY data_hora DESC'
        );
        res.json(result.rows);
    } catch (err) {
        console.error('Erro ao buscar transferências:', err);
        res.status(500).json({ error: err.message });
    }
});

// 2. Processar Nova Transferência (Guarda Histórico + Atualiza Stock na tabela historico_entradas)
app.post('/api/transferencias', autenticarToken, async (req, res) => {
    const { id, equipamentoId, equipamentoNome, quantidade, serials, origem, destino, dataHora } = req.body;

    const client = await pool.connect();

    try {
        await client.query('BEGIN'); // Inicia a transação SQL

        const serialsParaBD = Array.isArray(serials) ? serials : [];
        const dataMovimento = dataHora || new Date().toISOString(); // Define a data/hora atual caso não venha no body

        // 1. Guardar no Histórico de Transferências
        await client.query(
            `INSERT INTO historico_transferencias (id, equipamento_id, equipamento_nome, quantidade, serials, origem, destino, data_hora) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [id, equipamentoId, equipamentoNome, quantidade, serialsParaBD, origem, destino, dataMovimento]
        );

        // 2. Remover os números de série transferidos do local de ORIGEM
        const resOrigem = await client.query(
            `SELECT * FROM historico_entradas 
             WHERE (equipamento_id = $1 OR equipamento_id::text = $1::text) 
               AND LOWER(TRIM(instituicao)) = LOWER(TRIM($2))`,
            [equipamentoId, origem]
        );

        if (resOrigem.rows.length > 0) {
            const entradaOrigem = resOrigem.rows[0];
            let serialsOrigem = entradaOrigem.serials || [];

            if (typeof serialsOrigem === 'string') {
                try { serialsOrigem = JSON.parse(serialsOrigem); } catch (e) { serialsOrigem = []; }
            }

            // Mantém apenas os serials que NÃO foram transferidos
            const novosSerialsOrigem = serialsOrigem.filter(sn => !serialsParaBD.includes(sn));

            await client.query(
                `UPDATE historico_entradas SET serials = $1, quantidade = $2 WHERE id = $3`,
                [novosSerialsOrigem, novosSerialsOrigem.length, entradaOrigem.id]
            );
        }

        // 3. Adicionar os números de série ao local de DESTINO
        const resDestino = await client.query(
            `SELECT * FROM historico_entradas 
             WHERE (equipamento_id = $1 OR equipamento_id::text = $1::text) 
               AND LOWER(TRIM(instituicao)) = LOWER(TRIM($2))`,
            [equipamentoId, destino]
        );

        if (resDestino.rows.length > 0) {
            // Se já existe registo deste equipamento no destino, acrescenta os novos serials
            const entradaDestino = resDestino.rows[0];
            let serialsDestino = entradaDestino.serials || [];

            if (typeof serialsDestino === 'string') {
                try { serialsDestino = JSON.parse(serialsDestino); } catch (e) { serialsDestino = []; }
            }

            const novosSerialsDestino = [...new Set([...serialsDestino, ...serialsParaBD])];

            await client.query(
                `UPDATE historico_entradas SET serials = $1, quantidade = $2 WHERE id = $3`,
                [novosSerialsDestino, novosSerialsDestino.length, entradaDestino.id]
            );
        } else {
            // Se ainda não existe registo no destino, insere com a coluna data_hora preenchida
            const novaEntradaId = Date.now().toString();
            await client.query(
                `INSERT INTO historico_entradas (id, equipamento_id, equipamento_nome, quantidade, serials, instituicao, data_hora)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [novaEntradaId, equipamentoId, equipamentoNome, serialsParaBD.length, serialsParaBD, destino, dataMovimento]
            );
        }

        await client.query('COMMIT'); // Confirma todas as alterações
        res.status(201).json({ message: 'Transferência efetuada com sucesso' });

    } catch (err) {
        await client.query('ROLLBACK'); // Desfaz as alterações se houver erro
        console.error('Erro na transação de transferência:', err);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

const PORT = 3000;

app.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
    console.log(`👉 Aceda em: http://localhost:${PORT}/login.html`);
});