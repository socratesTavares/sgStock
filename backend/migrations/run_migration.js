const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { Pool } = require('pg');

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

async function run() {
    const sqlPath = path.join(__dirname, '001_acao2_integridade_transacoes.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    console.log('🔄 Executando Migração 001 no PostgreSQL...');
    try {
        await pool.query(sql);
        console.log('✅ Migração 001 executada com sucesso!');

        // Testa consulta na view criada
        const res = await pool.query('SELECT COUNT(*) FROM view_stock_atual');
        console.log(`✅ View view_stock_atual operacional com ${res.rows[0].count} registros de stock agrupados.`);

        const constraints = await pool.query(`
            SELECT tc.table_name, rc.delete_rule
            FROM information_schema.table_constraints AS tc
            JOIN information_schema.referential_constraints AS rc
                ON tc.constraint_name = rc.constraint_name
            WHERE tc.table_name IN ('historico_entradas', 'historico_transferencias')
              AND tc.constraint_type = 'FOREIGN KEY';
        `);
        console.table(constraints.rows);

    } catch (err) {
        console.error('❌ Falha ao executar migração:', err);
    } finally {
        await pool.end();
    }
}

run();
