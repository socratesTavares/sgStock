-- =============================================================================
-- SISTEMA sgStock - SCHEMA COMPLETO DE PRODUÇÃO (PostgreSQL 14+)
-- Data de Criação/Consolidação: Novembro de 2026
-- Este script inicializa a base de dados do zero com todas as regras de 
-- integridade referencial (RESTRICT), índices de alta performance (GIN e B-Tree),
-- trilha de auditoria e view consolidada de inventário.
-- =============================================================================

-- 1. Tabela de Utilizadores (RBAC e Autenticação)
CREATE TABLE IF NOT EXISTS public.usuarios (
    id VARCHAR(255) PRIMARY KEY,
    nome VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    senha VARCHAR(255) NOT NULL,
    perfil VARCHAR(20) DEFAULT 'tecnico' CHECK (perfil IN ('administrador', 'tecnico')),
    ativo BOOLEAN DEFAULT TRUE,
    criado_em TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 2. Tabela de Equipamentos (Catálogo de Modelos)
CREATE TABLE IF NOT EXISTS public.equipamentos (
    id VARCHAR(50) PRIMARY KEY,
    marca VARCHAR(100) NOT NULL,
    modelo VARCHAR(100) NOT NULL,
    part_number VARCHAR(100) UNIQUE NOT NULL,
    ativo BOOLEAN DEFAULT TRUE,
    criado_em TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 3. Tabela de Histórico de Entradas de Stock (Imutável)
CREATE TABLE IF NOT EXISTS public.historico_entradas (
    id VARCHAR(50) PRIMARY KEY,
    equipamento_id VARCHAR(50) NOT NULL REFERENCES public.equipamentos(id) ON DELETE RESTRICT,
    equipamento_nome VARCHAR(255) NOT NULL,
    quantidade INTEGER NOT NULL CHECK (quantidade >= 0),
    serials TEXT[] NOT NULL DEFAULT '{}',
    instituicao VARCHAR(255) NOT NULL,
    data_hora VARCHAR(100) NOT NULL,
    criado_em TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 4. Tabela de Histórico de Transferências (Guias Oficiais e Auditoria)
CREATE TABLE IF NOT EXISTS public.historico_transferencias (
    id VARCHAR(50) PRIMARY KEY,
    equipamento_id VARCHAR(50) NOT NULL REFERENCES public.equipamentos(id) ON DELETE RESTRICT,
    equipamento_nome VARCHAR(255) NOT NULL,
    quantidade INTEGER NOT NULL CHECK (quantidade >= 0),
    serials TEXT[] NOT NULL DEFAULT '{}',
    origem VARCHAR(255) NOT NULL,
    destino VARCHAR(255) NOT NULL,
    data_hora VARCHAR(100) NOT NULL,
    criado_em TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    cancelado BOOLEAN DEFAULT FALSE,
    cancelado_por VARCHAR(255),
    cancelado_em TIMESTAMPTZ,
    motivo_cancelamento TEXT
);

-- =============================================================================
-- ÍNDICES DE PERFORMANCE E INTEGRIDADE
-- =============================================================================

-- Índices em Utilizadores
CREATE INDEX IF NOT EXISTS idx_usuarios_email ON public.usuarios(LOWER(email));

-- Índices em Equipamentos
CREATE INDEX IF NOT EXISTS idx_equipamentos_part_number ON public.equipamentos(LOWER(part_number));
CREATE INDEX IF NOT EXISTS idx_equipamentos_ativo ON public.equipamentos(ativo);

-- Índices em Histórico de Entradas
CREATE INDEX IF NOT EXISTS idx_entradas_equipamento_id ON public.historico_entradas(equipamento_id);
CREATE INDEX IF NOT EXISTS idx_entradas_instituicao ON public.historico_entradas(LOWER(instituicao));
CREATE INDEX IF NOT EXISTS idx_entradas_criado_em ON public.historico_entradas(criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_entradas_serials_gin ON public.historico_entradas USING GIN(serials);

-- Índices em Histórico de Transferências
CREATE INDEX IF NOT EXISTS idx_transferencias_equipamento_id ON public.historico_transferencias(equipamento_id);
CREATE INDEX IF NOT EXISTS idx_transferencias_origem ON public.historico_transferencias(LOWER(origem));
CREATE INDEX IF NOT EXISTS idx_transferencias_destino ON public.historico_transferencias(LOWER(destino));
CREATE INDEX IF NOT EXISTS idx_transferencias_cancelado ON public.historico_transferencias(cancelado);
CREATE INDEX IF NOT EXISTS idx_transferencias_criado_em ON public.historico_transferencias(criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_transferencias_serials_gin ON public.historico_transferencias USING GIN(serials);

-- =============================================================================
-- VIEW CONSOLIDADA DE STOCK EM TEMPO REAL
-- Rastreia a posição física real de cada número de série e quantitativo.
-- =============================================================================
CREATE OR REPLACE VIEW view_stock_atual AS
WITH 
entradas_seriais AS (
    SELECT 
        e.id AS equipamento_id,
        e.marca,
        e.modelo,
        e.part_number,
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
        local_atual,
        COUNT(serial_num)::integer AS total,
        array_agg(serial_num ORDER BY serial_num) AS serials
    FROM posicao_serial
    GROUP BY equipamento_id, marca, modelo, part_number, local_atual
)
SELECT * FROM stock_por_serial WHERE total > 0;

-- =============================================================================
-- SEED INICIAL DE ADMINISTRADOR (Opcional - Caso a tabela esteja vazia)
-- Palavra-passe padrão de bootstrap: admin123 (Hash Bcrypt cost 10)
-- =============================================================================
INSERT INTO public.usuarios (id, nome, email, senha, perfil)
VALUES (
    'admin-inicial',
    'Administrador Geral',
    'admin@sgstock.com',
    '$2b$10$jeE6N8J1jqNknVf18XW6S.9K.JQyqhTM67iqLSWXpIzcio/NviM3m',
    'administrador'
)
ON CONFLICT (email) DO NOTHING;
