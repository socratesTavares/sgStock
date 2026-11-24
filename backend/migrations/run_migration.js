const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { Pool } = require('pg');

const DATABASE_NAME = 'gestao_stock';
if (process.env.DB_NAME !== DATABASE_NAME) {
    console.error(`DB_NAME deve ser exatamente "${DATABASE_NAME}".`);
    process.exit(1);
}

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: DATABASE_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

async function runMigrations() {
    // 1. Criar tabela de controlo de migrações (se não existir)
    await pool.query(`
        CREATE TABLE IF NOT EXISTS public.schema_migrations (
            version VARCHAR(255) PRIMARY KEY,
            executed_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );
    `);

    // Pré-marcar migrações legadas já executadas se ainda não estiverem registadas
    const colunasCheck = await pool.query(`
        SELECT column_name FROM information_schema.columns 
        WHERE table_name = 'historico_transferencias' AND column_name = 'cancelado'
    `);
    if (colunasCheck.rows.length > 0) {
        await pool.query(`
            INSERT INTO public.schema_migrations (version) 
            VALUES ('001_acao2_integridade_transacoes.sql') 
            ON CONFLICT (version) DO NOTHING;
        `);
    }

    const colunasAuditCheck = await pool.query(`
        SELECT table_name FROM information_schema.tables 
        WHERE table_name = 'auditoria'
    `);
    if (colunasAuditCheck.rows.length > 0) {
        await pool.query(`
            INSERT INTO public.schema_migrations (version) 
            VALUES ('002_empresa_governanca_auditoria.sql') 
            ON CONFLICT (version) DO NOTHING;
        `);
    }

    // 2. Descobrir e executar apenas migrações pendentes
    const jaExecutadasRes = await pool.query('SELECT version FROM public.schema_migrations');
    const jaExecutadas = new Set(jaExecutadasRes.rows.map(r => r.version));

    const migrationsDir = __dirname;
    const files = fs.readdirSync(migrationsDir)
        .filter(f => f.endsWith('.sql'))
        .sort();

    console.log(`📦 Encontradas ${files.length} migrações no diretório. (${jaExecutadas.size} já executadas)`);

    for (const file of files) {
        if (jaExecutadas.has(file)) {
            console.log(`⏩ [IGNORADA] Migração já aplicada anteriormente: ${file}`);
            continue;
        }

        const fullPath = path.join(migrationsDir, file);
        const sql = fs.readFileSync(fullPath, 'utf8');

        console.log(`🔄 Executando migração: ${file}...`);
        try {
            await pool.query(sql);
            await pool.query('INSERT INTO public.schema_migrations (version) VALUES ($1)', [file]);
            console.log(`✅ ${file} executada e registada com sucesso!`);
        } catch (err) {
            console.error(`❌ Erro na migração ${file}:`, err.message);
            throw err;
        }
    }

    // Validações pós-migração
    try {
        const resStock = await pool.query('SELECT COUNT(*) FROM view_stock_atual');
        const resHealth = await pool.query('SELECT COUNT(*) FROM view_asset_health');
        const resInst = await pool.query('SELECT COUNT(*) FROM instituicoes');
        const resAudit = await pool.query('SELECT COUNT(*) FROM auditoria');

        console.log('\n--- DIAGNÓSTICO DO BANCO DE DADOS ---');
        console.log(`🏛️ Instituições cadastradas: ${resInst.rows[0].count}`);
        console.log(`📊 Grupos de stock ativo: ${resStock.rows[0].count}`);
        console.log(`🩺 Ativos na Matriz de Saúde: ${resHealth.rows[0].count}`);
        console.log(`🛡️ Registos no Audit Hub: ${resAudit.rows[0].count}`);
        console.log('-------------------------------------\n');
    } catch (e) {
        console.warn('⚠️ Alerta na validação pós-migração:', e.message);
    } finally {
        await pool.end();
    }
}

runMigrations().catch(() => process.exit(1));
