const request = require('supertest');
const { app, pool } = require('../server');

describe('Suíte de Testes Automatizados - sgStock MoRENet / MCTD', () => {
    let tokenAdmin;
    let tokenTecnico;
    const testTimestamp = Date.now();
    const testAdminEmail = 'admin@sgstock.com';
    const testAdminSenha = process.env.ADMIN_INITIAL_PASSWORD || 'admin123';
    const testTecnicoEmail = `tecnico_${testTimestamp}@morenet.ac.mz`;
    const testEquipamentoId = `test-eq-${testTimestamp}`;
    const testPartNumber = `TEST-PN-${testTimestamp}`;
    const testAcquisitionEquipamentoId = `test-acq-${testTimestamp}`;

    beforeAll(async () => {
        // 1. Obter token de Administrador
        const loginAdminRes = await request(app)
            .post('/api/login')
            .send({ email: testAdminEmail, senha: testAdminSenha });
        
        expect(loginAdminRes.status).toBe(200);
        tokenAdmin = loginAdminRes.body.token;

        // 2. Criar utilizador Técnico com instituição vinculada para testes RBAC
        const regTecnicoRes = await request(app)
            .post('/api/usuarios')
            .set('Authorization', `Bearer ${tokenAdmin}`)
            .send({
                nome: 'Técnico de Teste Nampula',
                email: testTecnicoEmail,
                senha: 'password123',
                perfil: 'tecnico',
                instituicaoNome: 'MoRENet Nampula PoP'
            });

        expect([201, 400]).toContain(regTecnicoRes.status);

        // 3. Login como Técnico
        const loginTecnicoRes = await request(app)
            .post('/api/login')
            .send({ email: testTecnicoEmail, senha: 'password123' });

        expect(loginTecnicoRes.status).toBe(200);
        tokenTecnico = loginTecnicoRes.body.token;
        expect(loginTecnicoRes.body.usuario.perfil).toBe('tecnico');
        expect(loginTecnicoRes.body.usuario.instituicao_nome).toBe('MoRENet Nampula PoP');
    });

    afterAll(async () => {
        // Limpar dados temporários criados nos testes
        try {
            const idsEquipamentosTeste = [testEquipamentoId, testAcquisitionEquipamentoId];
            await pool.query(
                `DELETE FROM public.auditoria
                 WHERE entidade_id = ANY($1::varchar[])
                    OR entidade_id IN (
                        SELECT id FROM public.historico_entradas
                        WHERE equipamento_id = ANY($1::varchar[])
                    )
                    OR entidade_id IN (
                        SELECT id FROM public.aquisicoes_modelo
                        WHERE equipamento_id = ANY($1::varchar[])
                    )`,
                [idsEquipamentosTeste]
            );
            await pool.query(
                `DELETE FROM public.logs_auditoria
                 WHERE entidade_id = ANY($1::varchar[])
                    OR entidade_id IN (
                        SELECT id FROM public.historico_entradas
                        WHERE equipamento_id = ANY($1::varchar[])
                    )
                    OR entidade_id IN (
                        SELECT id FROM public.aquisicoes_modelo
                        WHERE equipamento_id = ANY($1::varchar[])
                    )`,
                [idsEquipamentosTeste]
            );
            await pool.query('DELETE FROM public.historico_transferencias WHERE equipamento_id = $1', [testEquipamentoId]);
            await pool.query('DELETE FROM public.historico_entradas WHERE equipamento_id = $1', [testEquipamentoId]);
            await pool.query('DELETE FROM public.historico_entradas WHERE equipamento_id = $1', [testAcquisitionEquipamentoId]);
            await pool.query('DELETE FROM public.aquisicoes_modelo WHERE equipamento_id = ANY($1::varchar[])', [idsEquipamentosTeste]);
            await pool.query('DELETE FROM public.equipamentos WHERE id = $1', [testEquipamentoId]);
            await pool.query('DELETE FROM public.equipamentos WHERE id = $1', [testAcquisitionEquipamentoId]);
            await pool.query('DELETE FROM public.usuarios WHERE email = $1', [testTecnicoEmail]);
        } catch (e) {
            console.error('Erro na limpeza pós-teste:', e);
        } finally {
            await pool.end();
        }
    });

    describe('1. Segurança, Autenticação e RBAC', () => {
        test('Deve rejeitar requisição em rota protegida sem Token JWT (401)', async () => {
            const res = await request(app).get('/api/stock');
            expect(res.status).toBe(401);
            expect(res.body.error).toBeDefined();
        });

        test('Deve rejeitar Técnico tentando aceder a rota restrita a Administrador (403)', async () => {
            const res = await request(app)
                .delete('/api/equipamentos/qualquer-id')
                .set('Authorization', `Bearer ${tokenTecnico}`);
            
            expect(res.status).toBe(403);
            expect(res.body.error).toMatch(/Apenas Administradores/i);
        });

        test('Deve permitir alteração segura de palavra-passe pelo perfil do utilizador', async () => {
            const res = await request(app)
                .put('/api/perfil/senha')
                .set('Authorization', `Bearer ${tokenTecnico}`)
                .send({
                    senhaAtual: 'password123',
                    novaSenha: 'novaSenhaForte456'
                });

            expect(res.status).toBe(200);
            expect(res.body.message).toMatch(/sucesso/i);

            // Reverte a senha para consistência
            await request(app)
                .put('/api/perfil/senha')
                .set('Authorization', `Bearer ${tokenTecnico}`)
                .send({
                    senhaAtual: 'novaSenhaForte456',
                    novaSenha: 'password123'
                });
        });
    });

    describe('2. Engenharia e Gestão de Equipamentos', () => {
        test('Deve cadastrar modelo de equipamento com atributos avançados de engenharia', async () => {
            const res = await request(app)
                .post('/api/equipamentos')
                .set('Authorization', `Bearer ${tokenAdmin}`)
                .send({
                    id: testEquipamentoId,
                    marca: 'Huawei',
                    modelo: 'CloudEngine S5735-L',
                    partNumber: testPartNumber,
                    categoria: 'Switches',
                    capacidadeBanda: '10 Gbps',
                    portas: 48,
                    fibraEscura: true,
                    vidaUtilAnos: 6,
                    aquisicaoInicial: {
                        faturaNumero: `FT-${testTimestamp}`,
                        fornecedorId: 'forn-huawei-mz',
                        custoUnitario: 85000.00,
                        dataAquisicao: new Date().toISOString().slice(0, 10)
                    }
                });

            expect(res.status).toBe(201);
            expect(res.body.id).toBe(testEquipamentoId);
        });

        test('Deve listar equipamentos incluindo os novos campos de engenharia', async () => {
            const res = await request(app)
                .get('/api/equipamentos')
                .set('Authorization', `Bearer ${tokenAdmin}`);

            expect(res.status).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);

            const criado = res.body.find(e => e.id === testEquipamentoId);
            expect(criado).toBeDefined();
            expect(criado.categoria).toBe('switch');
            expect(String(criado.portas)).toBe('48');
            expect(criado.fibraEscura).toBe(true);
        });

        test('Deve editar um modelo existente preservando o seu identificador', async () => {
            const atualizado = await request(app)
                .put(`/api/equipamentos/${testEquipamentoId}`)
                .set('Authorization', 'Bearer ' + tokenAdmin)
                .send({
                    marca: 'Huawei',
                    modelo: 'CloudEngine S5735-L Atualizado',
                    partNumber: testPartNumber,
                    categoria: 'switch',
                    capacidadeBanda: '10 Gbps',
                    portas: 48,
                    fibraEscura: true,
                    vidaUtilAnos: 6,
                    precoEstimado: 85000
                });
            expect(atualizado.status).toBe(200);

            const listagem = await request(app)
                .get('/api/equipamentos')
                .set('Authorization', 'Bearer ' + tokenAdmin);
            expect(listagem.body.find(e => e.id === testEquipamentoId).modelo)
                .toBe('CloudEngine S5735-L Atualizado');
        });

        test('Deve guardar a aquisição do modelo sem criar unidades de stock', async () => {
            const res = await request(app)
                .post('/api/equipamentos')
                .set('Authorization', 'Bearer ' + tokenAdmin)
                .send({
                    id: testAcquisitionEquipamentoId,
                    marca: 'Teste',
                    modelo: 'Modelo com aquisição inicial',
                    partNumber: `ACQ-PN-${testTimestamp}`,
                    categoria: 'switch',
                    aquisicaoInicial: {
                        faturaNumero: `ACQ-${testTimestamp}`,
                        fornecedorId: 'forn-huawei-mz',
                        dataAquisicao: new Date().toISOString().slice(0, 10),
                        custoUnitario: 1000
                    }
                });

            expect(res.status).toBe(201);
            expect(res.body.aquisicaoId).toBeDefined();

            const aquisicao = await pool.query(
                'SELECT equipamento_id, fatura_numero, fornecedor_id, custo_unitario FROM public.aquisicoes_modelo WHERE id = $1',
                [res.body.aquisicaoId]
            );
            expect(aquisicao.rows[0]).toMatchObject({
                equipamento_id: testAcquisitionEquipamentoId,
                fatura_numero: `ACQ-${testTimestamp}`,
                fornecedor_id: 'forn-huawei-mz',
                custo_unitario: '1000.00'
            });

            const entradas = await request(app)
                .get('/api/entradas')
                .set('Authorization', 'Bearer ' + tokenAdmin);
            expect(entradas.status).toBe(200);
            expect(entradas.body.some(entrada => entrada.equipamentoId === testAcquisitionEquipamentoId)).toBe(false);

            const remocao = await request(app)
                .delete(`/api/equipamentos/${testAcquisitionEquipamentoId}`)
                .set('Authorization', 'Bearer ' + tokenAdmin);
            expect(remocao.status).toBe(409);
        });
    });

    describe('3. Transações ACID, Rastreabilidade e Posse de Stock', () => {
        const serial1 = `TEST-SN1-${testTimestamp}`;
        const serial2 = `TEST-SN2-${testTimestamp}`;

        test('Deve registar entrada com fatura, fornecedor e custo unitário', async () => {
            const res = await request(app)
                .post('/api/entradas')
                .set('Authorization', `Bearer ${tokenAdmin}`)
                .send({
                    equipamentoId: testEquipamentoId,
                    equipamentoNome: `Huawei CloudEngine S5735-L (${testPartNumber})`,
                    quantidade: 2,
                    serials: [serial1, serial2],
                    instituicao: 'MoRENet Nampula PoP',
                    faturaNumero: `FAT-${testTimestamp}`,
                    fornecedorNome: 'Huawei Technologies Moçambique',
                    custoUnitario: 85000.00,
                    moeda: 'MZN',
                    estadoFisico: 'novo'
                });

            expect(res.status).toBe(201);
            expect(res.body.id).toBeDefined();
        });

        test('Deve impedir a eliminação do modelo enquanto existir histórico associado', async () => {
            const res = await request(app)
                .delete(`/api/equipamentos/${testEquipamentoId}`)
                .set('Authorization', 'Bearer ' + tokenAdmin);
            expect(res.status).toBe(409);
            expect(res.body.error).toMatch(/associadas/i);
        });

        test('Técnico de Nampula deve ver apenas o stock da sua instituição', async () => {
            const res = await request(app)
                .get('/api/stock')
                .set('Authorization', `Bearer ${tokenTecnico}`);

            expect(res.status).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);

            // Todos os registos visíveis para o técnico devem pertencer à sua instituição
            res.body.forEach(item => {
                expect(item.instituicao.toLowerCase()).toBe('morenet nampula pop');
            });
        });

        test('Deve impedir transferência atómica se o serial não estiver na origem indicada (409)', async () => {
            const res = await request(app)
                .post('/api/transferencias')
                .set('Authorization', `Bearer ${tokenAdmin}`)
                .send({
                    equipamentoId: testEquipamentoId,
                    origem: 'MCTD Sede', // Origem errada (os seriais estão no Nampula PoP)
                    destino: 'Universidade Lúrio - FENG',
                    serials: [serial1]
                });

            expect(res.status).toBe(409);
            expect(res.body.error).toMatch(/não estão disponíveis na origem/i);
        });

        test('Deve processar transferência válida com ACID e validação de posse', async () => {
            const res = await request(app)
                .post('/api/transferencias')
                .set('Authorization', `Bearer ${tokenAdmin}`)
                .send({
                    equipamentoId: testEquipamentoId,
                    origem: 'MoRENet Nampula PoP',
                    destino: 'Universidade Lúrio - FENG',
                    serials: [serial1],
                    responsavelTransporte: 'Eng. Amisse',
                    matriculaViatura: 'ABM-99-88',
                    signatarioNome: 'Diretor Provincial de TI'
                });

            expect(res.status).toBe(201);
            expect(res.body.id).toBeDefined();
        });
    });

    describe('4. Inteligência Preditiva, KPIs e Exportação CSV', () => {
        test('Deve consultar a Matriz de Saúde de Ativos (Asset Health Matrix)', async () => {
            const res = await request(app)
                .get('/api/analytics/asset-health')
                .set('Authorization', `Bearer ${tokenAdmin}`);

            expect(res.status).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);
            if (res.body.length > 0) {
                const ativo = res.body[0];
                expect(ativo.classificacao_saude).toBeDefined();
                expect(ativo.acao_recomendada).toBeDefined();
            }
        });

        test('Deve compilar KPIs analíticos de decisão', async () => {
            const res = await request(app)
                .get('/api/analytics/kpis')
                .set('Authorization', `Bearer ${tokenAdmin}`);

            expect(res.status).toBe(200);
            expect(res.body.totalModelos).toBeGreaterThanOrEqual(1);
            expect(res.body.totalUnidades).toBeGreaterThanOrEqual(1);
            expect(res.body.capacidadeTecnica).toBeDefined();
        });

        test('Deve exportar inventário para CSV com codificação UTF-8 BOM', async () => {
            const res = await request(app)
                .get('/api/export/inventario')
                .set('Authorization', `Bearer ${tokenAdmin}`);

            expect(res.status).toBe(200);
            expect(res.headers['content-type']).toMatch(/text\/csv/);
            // Verifica a presença do UTF-8 BOM (\uFEFF) no início da resposta
            expect(res.text.startsWith('\uFEFF')).toBe(true);
        });

        test('Deve registar evento de auditoria imutável após operações', async () => {
            const res = await request(app)
                .get('/api/auditoria?limite=10')
                .set('Authorization', `Bearer ${tokenAdmin}`);

            expect(res.status).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);
            expect(res.body.length).toBeGreaterThanOrEqual(1);
            expect(res.body[0].acao).toBeDefined();
            expect(res.body[0].ip).toBeDefined();
        });
    });
});
