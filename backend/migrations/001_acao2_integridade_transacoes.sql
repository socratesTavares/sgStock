-- =============================================================================
-- Migração 001: Integridade Relacional, Índices e Consistência Transacional (Ação 2)
-- =============================================================================

-- 1. Remoção do ON DELETE CASCADE destrutivo (Proteção do histórico imutável)
ALTER TABLE public.historico_entradas 
    DROP CONSTRAINT IF EXISTS historico_entradas_equipamento_id_fkey;

ALTER TABLE public.historico_entradas 
    ADD CONSTRAINT historico_entradas_equipamento_id_fkey 
    FOREIGN KEY (equipamento_id) REFERENCES public.equipamentos(id) ON DELETE RESTRICT;

ALTER TABLE public.historico_transferencias 
    DROP CONSTRAINT IF EXISTS historico_transferencias_equipamento_id_fkey;

ALTER TABLE public.historico_transferencias 
    ADD CONSTRAINT historico_transferencias_equipamento_id_fkey 
    FOREIGN KEY (equipamento_id) REFERENCES public.equipamentos(id) ON DELETE RESTRICT;

-- 2. Adicionar coluna ativo em equipamentos
ALTER TABLE public.equipamentos 
    ADD COLUMN IF NOT EXISTS ativo BOOLEAN DEFAULT TRUE;

-- 3. Adicionar campos de auditoria e cancelamento (soft-delete) em transferências
ALTER TABLE public.historico_transferencias 
    ADD COLUMN IF NOT EXISTS cancelado BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS cancelado_por VARCHAR(255),
    ADD COLUMN IF NOT EXISTS cancelado_em TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS motivo_cancelamento TEXT;

-- 4. Adicionar colunas timestamp tipadas
ALTER TABLE public.historico_entradas 
    ADD COLUMN IF NOT EXISTS criado_em TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE public.historico_transferencias 
    ADD COLUMN IF NOT EXISTS criado_em TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;

-- 5. Atualizar criado_em a partir de data_hora existente
DO $$
BEGIN
    UPDATE public.historico_entradas 
    SET criado_em = TO_TIMESTAMP(data_hora, 'DD/MM/YYYY, HH24:MI:SS') 
    WHERE data_hora ~ '^\d{2}/\d{2}/\d{4}' AND (criado_em IS NULL OR criado_em >= NOW() - INTERVAL '1 hour');

    UPDATE public.historico_transferencias 
    SET criado_em = TO_TIMESTAMP(data_hora, 'DD/MM/YYYY, HH24:MI:SS') 
    WHERE data_hora ~ '^\d{2}/\d{2}/\d{4}' AND (criado_em IS NULL OR criado_em >= NOW() - INTERVAL '1 hour');
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Aviso na conversão de timestamps legados: %', SQLERRM;
END $$;

-- 6. Índices de Alta Performance (B-Tree e GIN)
CREATE INDEX IF NOT EXISTS idx_entradas_equipamento_id ON public.historico_entradas(equipamento_id);
CREATE INDEX IF NOT EXISTS idx_transferencias_equipamento_id ON public.historico_transferencias(equipamento_id);
CREATE INDEX IF NOT EXISTS idx_entradas_serials_gin ON public.historico_entradas USING GIN(serials);
CREATE INDEX IF NOT EXISTS idx_transferencias_serials_gin ON public.historico_transferencias USING GIN(serials);
CREATE INDEX IF NOT EXISTS idx_transferencias_cancelado ON public.historico_transferencias(cancelado);
CREATE INDEX IF NOT EXISTS idx_transferencias_origem ON public.historico_transferencias(LOWER(origem));
CREATE INDEX IF NOT EXISTS idx_transferencias_destino ON public.historico_transferencias(LOWER(destino));
CREATE INDEX IF NOT EXISTS idx_entradas_instituicao ON public.historico_entradas(LOWER(instituicao));

-- 7. View Consolidada de Posição Real de Stock
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
