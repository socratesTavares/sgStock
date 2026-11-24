-- =============================================================================
-- Migração 002: Governação Tecnológica, Auditoria Imutável, Saúde de Ativos e RBAC Multi-Instituição
-- MoRENet / MCTD - sgStock
-- =============================================================================

-- 1. TABELA DE INSTITUIÇÕES CENTRALIZADAS
CREATE TABLE IF NOT EXISTS public.instituicoes (
    id VARCHAR(50) PRIMARY KEY,
    nome VARCHAR(255) NOT NULL,
    sigla VARCHAR(50) NOT NULL UNIQUE,
    tipo VARCHAR(50) DEFAULT 'academica' CHECK (tipo IN ('academica', 'governo', 'ponto_presenca', 'datacenter', 'hospital', 'outro')),
    provincia VARCHAR(100) NOT NULL,
    endereco TEXT,
    contacto_responsavel VARCHAR(255),
    email_contacto VARCHAR(255),
    telefone VARCHAR(50),
    ativo BOOLEAN DEFAULT TRUE,
    criado_em TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_instituicoes_sigla ON public.instituicoes(LOWER(sigla));
CREATE INDEX IF NOT EXISTS idx_instituicoes_provincia ON public.instituicoes(provincia);

-- Seed de Instituições Autorizadas da Rede MoRENet / MCTD
INSERT INTO public.instituicoes (id, nome, sigla, tipo, provincia, contacto_responsavel, email_contacto, telefone)
VALUES
    ('inst-mctd-sede', 'Ministério das Comunicações e Transformação Digital - Sede', 'MCTD', 'governo', 'Maputo Cidade', 'Direcção de Administração e Recursos Humanos', 'patrimonio@mctd.gov.mz', '+258 21 000 000'),
    ('inst-morenet-noc', 'Rede de Instituições de Ensino Superior e de Investigação (MoRENet) - NOC Central', 'MoRENet NOC', 'datacenter', 'Maputo Cidade', 'Victor Guambe', 'noc@morenet.ac.mz', '+258 84 000 0001'),
    ('inst-uem', 'Universidade Eduardo Mondlane', 'UEM', 'academica', 'Maputo Cidade', 'Direcção de Informática CIUEM', 'info@uem.mz', '+258 21 490 000'),
    ('inst-up', 'Universidade Pedagógica de Maputo', 'UP-Maputo', 'academica', 'Maputo Cidade', 'Centro de Informática', 'ti@up.ac.mz', '+258 21 420 000'),
    ('inst-ulicungo', 'Universidade Licungo', 'UniLicungo', 'academica', 'Sofala', 'Núcleo de Tecnologias Beira', 'tic@unilicungo.ac.mz', '+258 23 320 000'),
    ('inst-unizambeze', 'Universidade Zambeze', 'UniZambeze', 'academica', 'Sofala', 'Gabinete de TIC', 'tic@unizambeze.ac.mz', '+258 23 310 000'),
    ('inst-unilurio', 'Universidade Lúrio', 'UniLúrio', 'academica', 'Nampula', 'Gabinete de Sistemas de Informação', 'gsi@unilurio.ac.mz', '+258 26 210 000'),
    ('inst-unirovuma', 'Universidade Rovuma', 'UniRovuma', 'academica', 'Nampula', 'Centro de Tecnologias', 'tic@unirovuma.ac.mz', '+258 26 220 000'),
    ('inst-unipungue', 'Universidade Púnguè', 'UniPúnguè', 'academica', 'Manica', 'Gabinete de Redes e Infraestruturas', 'ti@unipungue.ac.mz', '+258 25 120 000'),
    ('inst-unisave', 'Universidade Save', 'UniSave', 'academica', 'Gaza', 'Departamento de TIC', 'tic@unisave.ac.mz', '+258 28 220 000'),
    ('inst-isutc', 'Instituto Superior de Transportes e Comunicações', 'ISUTC', 'academica', 'Maputo Cidade', 'Centro de Informática ISUTC', 'informatica@isutc.ac.mz', '+258 21 410 000'),
    ('inst-isctem', 'Instituto Superior de Ciências e Tecnologia de Moçambique', 'ISCTEM', 'academica', 'Maputo Cidade', 'Gabinete de TI', 'ti@isctem.ac.mz', '+258 21 310 000')
ON CONFLICT (sigla) DO NOTHING;

-- 2. TABELA DE FORNECEDORES
CREATE TABLE IF NOT EXISTS public.fornecedores (
    id VARCHAR(50) PRIMARY KEY,
    nome VARCHAR(255) NOT NULL,
    nuit VARCHAR(50) UNIQUE,
    contacto VARCHAR(255),
    email VARCHAR(255),
    telefone VARCHAR(50),
    endereco TEXT,
    ativo BOOLEAN DEFAULT TRUE,
    criado_em TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_fornecedores_nome ON public.fornecedores(LOWER(nome));

INSERT INTO public.fornecedores (id, nome, nuit, contacto, email, telefone, endereco)
VALUES
    ('forn-cisco-mz', 'Cisco Systems Moçambique / Parceiro Oficial', '400123456', 'Gestor de Contas Corporativas', 'vendas@cisco-parceiro.co.mz', '+258 21 300 111', 'Av. 24 de Julho, Maputo'),
    ('forn-huawei-mz', 'Huawei Technologies Mozambique Lda', '400987654', 'Enterprise Division', 'enterprise.mz@huawei.com', '+258 21 400 222', 'Rua Pereira do Lago, Maputo'),
    ('forn-mikrotik-mz', 'Distribuidor Oficial MikroTik / Ubiquiti Moçambique', '400555666', 'Suporte Técnico & Vendas', 'comercial@networkdist.co.mz', '+258 84 999 8888', 'Av. Vladimir Lenine, Maputo')
ON CONFLICT (nuit) DO NOTHING;

-- 3. CENTRO DE AUDITORIA IMUTÁVEL (AUDIT HUB)
CREATE TABLE IF NOT EXISTS public.auditoria (
    id BIGSERIAL PRIMARY KEY,
    usuario_id VARCHAR(255),
    usuario_nome VARCHAR(255),
    usuario_email VARCHAR(255),
    instituicao_id VARCHAR(50),
    instituicao_nome VARCHAR(255),
    acao VARCHAR(50) NOT NULL,
    entidade VARCHAR(50) NOT NULL,
    entidade_id VARCHAR(255),
    dados_anteriores JSONB,
    dados_novos JSONB,
    ip VARCHAR(50),
    user_agent TEXT,
    criado_em TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_auditoria_usuario_id ON public.auditoria(usuario_id);
CREATE INDEX IF NOT EXISTS idx_auditoria_acao ON public.auditoria(acao);
CREATE INDEX IF NOT EXISTS idx_auditoria_entidade ON public.auditoria(entidade, entidade_id);
CREATE INDEX IF NOT EXISTS idx_auditoria_criado_em ON public.auditoria(criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_auditoria_instituicao ON public.auditoria(instituicao_id);

-- 4. EXTENSÕES NA TABELA DE UTILIZADORES (RBAC Multi-Instituição & Preparação SSO)
ALTER TABLE public.usuarios 
    ADD COLUMN IF NOT EXISTS instituicao_id VARCHAR(50) REFERENCES public.instituicoes(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS instituicao_nome VARCHAR(255),
    ADD COLUMN IF NOT EXISTS auth_provider VARCHAR(50) DEFAULT 'local',
    ADD COLUMN IF NOT EXISTS external_id VARCHAR(255),
    ADD COLUMN IF NOT EXISTS ultimo_login TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_usuarios_instituicao ON public.usuarios(instituicao_id);

-- Atualiza utilizador admin padrão com instituição MCTD
UPDATE public.usuarios 
SET instituicao_id = 'inst-mctd-sede', instituicao_nome = 'Ministério das Comunicações e Transformação Digital - Sede'
WHERE id = 'admin-inicial' AND instituicao_id IS NULL;

-- 5. EXTENSÕES NA TABELA DE EQUIPAMENTOS (Engenharia de Redes & Vida Útil)
ALTER TABLE public.equipamentos
    ADD COLUMN IF NOT EXISTS categoria VARCHAR(50) DEFAULT 'roteador' CHECK (categoria IN ('roteador', 'switch', 'firewall', 'olt', 'servidor', 'access_point', 'ups', 'transceiver', 'outro')),
    ADD COLUMN IF NOT EXISTS descricao TEXT,
    ADD COLUMN IF NOT EXISTS capacidade_banda VARCHAR(100),
    ADD COLUMN IF NOT EXISTS portas VARCHAR(100),
    ADD COLUMN IF NOT EXISTS fibra_escura BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS potencia_consumo VARCHAR(50),
    ADD COLUMN IF NOT EXISTS vida_util_anos INTEGER DEFAULT 5,
    ADD COLUMN IF NOT EXISTS preco_estimado NUMERIC(15, 2) DEFAULT 0.00,
    ADD COLUMN IF NOT EXISTS criado_em TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_equipamentos_categoria ON public.equipamentos(categoria);

-- Atualiza dados de engenharia nos modelos existentes
UPDATE public.equipamentos
SET categoria = 'roteador',
    capacidade_banda = '1 Gbps a 10 Gbps',
    portas = '8x GE PoE + 2x SFP+',
    potencia_consumo = '65W',
    vida_util_anos = 6,
    preco_estimado = 150000.00
WHERE modelo ILIKE '%ISR%' OR modelo ILIKE '%Cisco%';

-- 6. EXTENSÕES NA TABELA DE HISTÓRICO DE ENTRADAS (Faturas, Fornecedores e Custos)
ALTER TABLE public.historico_entradas
    ADD COLUMN IF NOT EXISTS fatura_numero VARCHAR(100),
    ADD COLUMN IF NOT EXISTS fornecedor_id VARCHAR(50) REFERENCES public.fornecedores(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS fornecedor_nome VARCHAR(255),
    ADD COLUMN IF NOT EXISTS data_aquisicao DATE DEFAULT CURRENT_DATE,
    ADD COLUMN IF NOT EXISTS custo_unitario NUMERIC(15, 2) DEFAULT 0.00,
    ADD COLUMN IF NOT EXISTS moeda VARCHAR(10) DEFAULT 'MZN',
    ADD COLUMN IF NOT EXISTS estado_fisico VARCHAR(50) DEFAULT 'novo' CHECK (estado_fisico IN ('novo', 'operacional', 'avariado', 'abatido')),
    ADD COLUMN IF NOT EXISTS instituicao_id VARCHAR(50) REFERENCES public.instituicoes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_entradas_fatura ON public.historico_entradas(fatura_numero);
CREATE INDEX IF NOT EXISTS idx_entradas_fornecedor ON public.historico_entradas(fornecedor_id);
CREATE INDEX IF NOT EXISTS idx_entradas_data_aquisicao ON public.historico_entradas(data_aquisicao);
CREATE INDEX IF NOT EXISTS idx_entradas_estado_fisico ON public.historico_entradas(estado_fisico);

-- 7. EXTENSÕES NA TABELA DE TRANSFERÊNCIAS (Guias de Saída e Recepção Oficiais)
ALTER TABLE public.historico_transferencias
    ADD COLUMN IF NOT EXISTS tipo_guia VARCHAR(50) DEFAULT 'saida' CHECK (tipo_guia IN ('saida', 'recepcao')),
    ADD COLUMN IF NOT EXISTS origem_id VARCHAR(50) REFERENCES public.instituicoes(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS destino_id VARCHAR(50) REFERENCES public.instituicoes(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS responsavel_transporte VARCHAR(255),
    ADD COLUMN IF NOT EXISTS matricula_viatura VARCHAR(50),
    ADD COLUMN IF NOT EXISTS signatario_nome VARCHAR(255) DEFAULT 'Victor Guambe',
    ADD COLUMN IF NOT EXISTS signatario_cargo VARCHAR(255) DEFAULT 'Responsável de Património';

CREATE INDEX IF NOT EXISTS idx_transferencias_tipo_guia ON public.historico_transferencias(tipo_guia);

-- 8. TABELA DE HISTÓRICO DE AVARIAS E MANUTENÇÕES (Suporte à Matriz de Saúde)
CREATE TABLE IF NOT EXISTS public.historico_avarias (
    id VARCHAR(50) PRIMARY KEY,
    equipamento_id VARCHAR(50) NOT NULL REFERENCES public.equipamentos(id) ON DELETE RESTRICT,
    serial_number VARCHAR(100) NOT NULL,
    instituicao VARCHAR(255) NOT NULL,
    tipo_avaria VARCHAR(100) NOT NULL,
    gravidade VARCHAR(20) DEFAULT 'media' CHECK (gravidade IN ('baixa', 'media', 'alta', 'critica')),
    descricao TEXT,
    data_avaria TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    resolvido BOOLEAN DEFAULT FALSE,
    data_resolucao TIMESTAMPTZ,
    solucao_aplicada TEXT,
    registado_por VARCHAR(255)
);

CREATE INDEX IF NOT EXISTS idx_avarias_serial ON public.historico_avarias(serial_number);
CREATE INDEX IF NOT EXISTS idx_avarias_equipamento ON public.historico_avarias(equipamento_id);
CREATE INDEX IF NOT EXISTS idx_avarias_resolvido ON public.historico_avarias(resolvido);

-- 9. ATUALIZAÇÃO DA VIEW DE STOCK CONSOLIDADO
DROP VIEW IF EXISTS public.view_asset_health CASCADE;
DROP VIEW IF EXISTS public.view_stock_atual CASCADE;
CREATE OR REPLACE VIEW view_stock_atual AS
WITH 
entradas_seriais AS (
    SELECT 
        e.id AS equipamento_id,
        e.marca,
        e.modelo,
        e.part_number,
        e.categoria,
        e.capacidade_banda,
        e.portas,
        e.fibra_escura,
        e.vida_util_anos,
        COALESCE(he.custo_unitario, e.preco_estimado, 0.00) AS custo_unitario,
        COALESCE(he.estado_fisico, 'operacional') AS estado_fisico,
        he.fatura_numero,
        he.fornecedor_nome,
        COALESCE(he.data_aquisicao, he.criado_em::date, CURRENT_DATE) AS data_aquisicao,
        TRIM(he.instituicao) AS local_atual,
        TRIM(s.serial_num) AS serial_num,
        COALESCE(he.criado_em, CURRENT_TIMESTAMP) AS ordem_tempo
    FROM public.historico_entradas he
    JOIN public.equipamentos e ON e.id = he.equipamento_id
    CROSS JOIN LATERAL unnest(he.serials) AS s(serial_num)
    WHERE s.serial_num IS NOT NULL AND TRIM(s.serial_num) != ''
),
transferencias_seriais AS (
    SELECT 
        ht.equipamento_id,
        e.marca,
        e.modelo,
        e.part_number,
        e.categoria,
        e.capacidade_banda,
        e.portas,
        e.fibra_escura,
        e.vida_util_anos,
        e.preco_estimado AS custo_unitario,
        'operacional'::varchar AS estado_fisico,
        NULL::varchar AS fatura_numero,
        NULL::varchar AS fornecedor_nome,
        COALESCE(e.criado_em::date, CURRENT_DATE) AS data_aquisicao,
        TRIM(ht.destino) AS local_atual,
        TRIM(s.serial_num) AS serial_num,
        COALESCE(ht.criado_em, CURRENT_TIMESTAMP) AS ordem_tempo
    FROM public.historico_transferencias ht
    JOIN public.equipamentos e ON e.id = ht.equipamento_id
    CROSS JOIN LATERAL unnest(ht.serials) AS s(serial_num)
    WHERE (ht.cancelado IS NULL OR ht.cancelado = FALSE)
      AND s.serial_num IS NOT NULL AND TRIM(s.serial_num) != ''
),
todos_movimentos_seriais AS (
    SELECT * FROM entradas_seriais
    UNION ALL
    SELECT * FROM transferencias_seriais
),
posicao_serial AS (
    SELECT DISTINCT ON (LOWER(serial_num))
        equipamento_id,
        marca,
        modelo,
        part_number,
        categoria,
        capacidade_banda,
        portas,
        fibra_escura,
        vida_util_anos,
        custo_unitario,
        estado_fisico,
        fatura_numero,
        fornecedor_nome,
        data_aquisicao,
        local_atual,
        serial_num,
        ordem_tempo
    FROM todos_movimentos_seriais
    ORDER BY LOWER(serial_num), ordem_tempo DESC
),
stock_por_serial AS (
    SELECT 
        equipamento_id,
        marca,
        modelo,
        part_number,
        categoria,
        capacidade_banda,
        portas,
        fibra_escura,
        vida_util_anos,
        local_atual,
        COUNT(serial_num)::integer AS total,
        SUM(custo_unitario)::numeric(15,2) AS valor_total,
        array_agg(serial_num ORDER BY serial_num) AS serials
    FROM posicao_serial
    GROUP BY equipamento_id, marca, modelo, part_number, categoria, capacidade_banda, portas, fibra_escura, vida_util_anos, local_atual
)
SELECT * FROM stock_por_serial WHERE total > 0;

-- 10. VIEW ANALÍTICA DE SAÚDE DE ATIVOS (ASSET HEALTH MATRIX)
CREATE OR REPLACE VIEW view_asset_health AS
WITH 
ultimos_movimentos AS (
    SELECT DISTINCT ON (LOWER(s.serial_num))
        e.id AS equipamento_id,
        e.marca,
        e.modelo,
        e.part_number,
        e.categoria,
        e.vida_util_anos,
        COALESCE(e.preco_estimado, 0.00) AS valor_estimado,
        COALESCE(he.custo_unitario, e.preco_estimado, 0.00) AS custo_aquisicao,
        COALESCE(he.data_aquisicao, he.criado_em::date, CURRENT_DATE) AS data_aquisicao,
        COALESCE(he.estado_fisico, 'operacional') AS estado_fisico,
        TRIM(s.serial_num) AS serial_number,
        TRIM(COALESCE(ht.destino, he.instituicao)) AS localizacao_atual,
        GREATEST(COALESCE(ht.criado_em, he.criado_em), he.criado_em) AS ultimo_movimento
    FROM public.historico_entradas he
    JOIN public.equipamentos e ON e.id = he.equipamento_id
    CROSS JOIN LATERAL unnest(he.serials) AS s(serial_num)
    LEFT JOIN LATERAL (
        SELECT destino, criado_em 
        FROM public.historico_transferencias 
        WHERE (cancelado IS NULL OR cancelado = FALSE) AND serials @> ARRAY[s.serial_num]
        ORDER BY criado_em DESC LIMIT 1
    ) ht ON TRUE
    WHERE s.serial_num IS NOT NULL AND TRIM(s.serial_num) != ''
    ORDER BY LOWER(s.serial_num), ultimo_movimento DESC
),
metricas_saude AS (
    SELECT 
        um.*,
        (CURRENT_DATE - um.data_aquisicao) AS idade_dias,
        ROUND((CURRENT_DATE - um.data_aquisicao) / 365.25, 2) AS idade_anos,
        COALESCE((
            SELECT COUNT(*) 
            FROM public.historico_avarias ha 
            WHERE LOWER(ha.serial_number) = LOWER(um.serial_number) AND ha.resolvido = FALSE
        ), 0) AS avarias_abertas,
        COALESCE((
            SELECT COUNT(*) 
            FROM public.historico_avarias ha 
            WHERE LOWER(ha.serial_number) = LOWER(um.serial_number)
        ), 0) AS total_avarias_historico
    FROM ultimos_movimentos um
)
SELECT 
    ms.equipamento_id,
    ms.marca,
    ms.modelo,
    ms.part_number,
    ms.categoria,
    ms.serial_number,
    ms.localizacao_atual,
    ms.data_aquisicao,
    ms.idade_anos,
    ms.vida_util_anos,
    ms.custo_aquisicao,
    ms.estado_fisico,
    ms.avarias_abertas,
    ms.total_avarias_historico,
    ROUND(LEAST(100.0, GREATEST(0.0, (1.0 - (ms.idade_anos / NULLIF(ms.vida_util_anos, 0))) * 100)), 1) AS percentual_saude,
    CASE 
        WHEN ms.estado_fisico IN ('avariado', 'abatido') OR ms.avarias_abertas > 0 OR ms.idade_anos >= ms.vida_util_anos THEN 'Fim de Vida / Crítico'
        WHEN ms.idade_anos >= (ms.vida_util_anos * 0.70) OR ms.total_avarias_historico >= 2 THEN 'Atenção / Manutenção'
        ELSE 'Saudável'
    END AS status_saude
FROM metricas_saude ms;
