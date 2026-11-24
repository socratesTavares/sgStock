-- =============================================================================
-- Migração 002: Evolução Enterprise (sgStock MoRENet / MCTD)
-- Compatibilidade total, idempotência e enriquecimento de schema
-- =============================================================================

-- 1. TABELA DE FORNECEDORES (Compatibilidade e Enriquecimento)
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

-- Adiciona colunas compatíveis com a especificação técnica empresarial
ALTER TABLE public.fornecedores
    ADD COLUMN IF NOT EXISTS nome_empresa VARCHAR(255),
    ADD COLUMN IF NOT EXISTS pessoa_contacto VARCHAR(255),
    ADD COLUMN IF NOT EXISTS nif VARCHAR(50),
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;

-- Sincroniza dados existentes para consistência de consultas
UPDATE public.fornecedores
SET nome_empresa = COALESCE(nome_empresa, nome),
    pessoa_contacto = COALESCE(pessoa_contacto, contacto),
    nif = COALESCE(nif, nuit),
    created_at = COALESCE(created_at, criado_em);

CREATE INDEX IF NOT EXISTS idx_fornecedores_nome_empresa ON public.fornecedores(LOWER(COALESCE(nome_empresa, nome)));
CREATE INDEX IF NOT EXISTS idx_fornecedores_nif ON public.fornecedores(COALESCE(nif, nuit));

-- 2. TABELA DE INSTITUIÇÕES CENTRALIZADAS
CREATE TABLE IF NOT EXISTS public.instituicoes (
    id VARCHAR(50) PRIMARY KEY,
    nome VARCHAR(255) NOT NULL,
    sigla VARCHAR(50) NOT NULL UNIQUE,
    tipo VARCHAR(50) DEFAULT 'academica',
    provincia VARCHAR(100) NOT NULL,
    endereco TEXT,
    contacto_responsavel VARCHAR(255),
    email_contacto VARCHAR(255),
    telefone VARCHAR(50),
    ativo BOOLEAN DEFAULT TRUE,
    criado_em TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE public.instituicoes
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;

UPDATE public.instituicoes
SET created_at = COALESCE(created_at, criado_em);

CREATE INDEX IF NOT EXISTS idx_instituicoes_sigla ON public.instituicoes(LOWER(sigla));
CREATE INDEX IF NOT EXISTS idx_instituicoes_provincia ON public.instituicoes(provincia);

-- 3. TABELA DE AUDITORIA IMUTÁVEL (AUDIT HUB)
-- Garante a tabela 'logs_auditoria' e 'auditoria' para máxima compatibilidade
CREATE TABLE IF NOT EXISTS public.logs_auditoria (
    id BIGSERIAL PRIMARY KEY,
    usuario_id VARCHAR(255),
    usuario_nome VARCHAR(255),
    usuario_email VARCHAR(255),
    usuario_perfil VARCHAR(50),
    instituicao_id VARCHAR(50),
    instituicao_nome VARCHAR(255),
    acao VARCHAR(50) NOT NULL,
    entidade VARCHAR(50) NOT NULL,
    entidade_id VARCHAR(255),
    dados_anteriores JSONB,
    dados_novos JSONB,
    ip VARCHAR(50),
    user_agent TEXT,
    justificativa TEXT,
    criado_em TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_logs_auditoria_acao ON public.logs_auditoria(acao);
CREATE INDEX IF NOT EXISTS idx_logs_auditoria_usuario ON public.logs_auditoria(usuario_id);
CREATE INDEX IF NOT EXISTS idx_logs_auditoria_criado_em ON public.logs_auditoria(criado_em DESC);

-- Garante que a tabela auditoria existente tem todas as colunas
ALTER TABLE IF EXISTS public.auditoria
    ADD COLUMN IF NOT EXISTS usuario_perfil VARCHAR(50),
    ADD COLUMN IF NOT EXISTS justificativa TEXT;

-- 4. HISTÓRICO DE INCIDENTES / MUDANÇA DE ESTADO DE ATIVOS (COM JUSTIFICATIVA OBRIGATÓRIA)
CREATE TABLE IF NOT EXISTS public.historico_incidentes (
    id BIGSERIAL PRIMARY KEY,
    equipamento_id VARCHAR(50) NOT NULL REFERENCES public.equipamentos(id) ON DELETE RESTRICT,
    serial_number VARCHAR(100) NOT NULL,
    estado_anterior VARCHAR(50) DEFAULT 'operacional',
    novo_estado VARCHAR(50) NOT NULL CHECK (novo_estado IN ('novo', 'operacional', 'avariado', 'em_reparo', 'abatido')),
    justificativa TEXT NOT NULL,
    instituicao VARCHAR(255) NOT NULL,
    reportado_por VARCHAR(255) NOT NULL,
    criado_em TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_incidentes_equipamento ON public.historico_incidentes(equipamento_id);
CREATE INDEX IF NOT EXISTS idx_incidentes_serial ON public.historico_incidentes(serial_number);
CREATE INDEX IF NOT EXISTS idx_incidentes_criado_em ON public.historico_incidentes(criado_em DESC);

-- 5. TABELA MESTRE DE FATURAS DE AQUISIÇÃO (SUPORTE MASTER-DETAILS EM LOTE)
CREATE TABLE IF NOT EXISTS public.faturas_aquisicao (
    id VARCHAR(50) PRIMARY KEY,
    fatura_numero VARCHAR(100) NOT NULL,
    fornecedor_id VARCHAR(50) REFERENCES public.fornecedores(id) ON DELETE SET NULL,
    fornecedor_nome VARCHAR(255) NOT NULL,
    instituicao_id VARCHAR(50) REFERENCES public.instituicoes(id) ON DELETE SET NULL,
    instituicao_nome VARCHAR(255) NOT NULL,
    data_aquisicao DATE NOT NULL,
    valor_total NUMERIC(15, 2) DEFAULT 0.00,
    registado_por VARCHAR(255),
    observacoes TEXT,
    criado_em TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_faturas_numero ON public.faturas_aquisicao(LOWER(fatura_numero));
CREATE INDEX IF NOT EXISTS idx_faturas_fornecedor ON public.faturas_aquisicao(fornecedor_id);

-- Enriquecimento em historico_entradas para vínculo com a fatura mestre
ALTER TABLE public.historico_entradas
    ADD COLUMN IF NOT EXISTS fatura_id VARCHAR(50) REFERENCES public.faturas_aquisicao(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS observacoes TEXT;

-- 6. EXTENSÕES NA TABELA DE UTILIZADORES (SSO & PERFIS)
ALTER TABLE public.usuarios
    ADD COLUMN IF NOT EXISTS instituicao_id VARCHAR(50) REFERENCES public.instituicoes(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS instituicao_nome VARCHAR(255),
    ADD COLUMN IF NOT EXISTS auth_provider VARCHAR(50) DEFAULT 'local',
    ADD COLUMN IF NOT EXISTS external_id VARCHAR(255),
    ADD COLUMN IF NOT EXISTS ativo BOOLEAN DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS ultimo_login TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;

-- 7. EXTENSÕES NA TABELA DE EQUIPAMENTOS (CATEGORIA & ESPECIFICAÇÕES DE REDES)
ALTER TABLE public.equipamentos
    ADD COLUMN IF NOT EXISTS categoria VARCHAR(50) DEFAULT 'roteador',
    ADD COLUMN IF NOT EXISTS descricao TEXT,
    ADD COLUMN IF NOT EXISTS capacidade_banda VARCHAR(100),
    ADD COLUMN IF NOT EXISTS portas VARCHAR(100),
    ADD COLUMN IF NOT EXISTS fibra_escura BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS potencia_consumo VARCHAR(50),
    ADD COLUMN IF NOT EXISTS vida_util_anos INTEGER DEFAULT 5,
    ADD COLUMN IF NOT EXISTS preco_estimado NUMERIC(15, 2) DEFAULT 0.00,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;

-- Garante que o usuário admin padrão esteja sempre ativo e com instituição
UPDATE public.usuarios
SET instituicao_nome = COALESCE(instituicao_nome, 'MCTD Sede'),
    ativo = TRUE
WHERE id = 'admin-inicial';
