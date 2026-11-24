CREATE TABLE IF NOT EXISTS public.aquisicoes_modelo (
    id VARCHAR(50) PRIMARY KEY,
    equipamento_id VARCHAR(50) NOT NULL
        REFERENCES public.equipamentos(id) ON DELETE RESTRICT,
    fatura_numero VARCHAR(100) NOT NULL,
    fornecedor_id VARCHAR(50)
        REFERENCES public.fornecedores(id) ON DELETE SET NULL,
    fornecedor_nome VARCHAR(255) NOT NULL,
    custo_unitario NUMERIC(15, 2) NOT NULL CHECK (custo_unitario >= 0),
    data_aquisicao DATE NOT NULL,
    registado_por VARCHAR(255),
    criado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_aquisicoes_modelo_equipamento_data
    ON public.aquisicoes_modelo(equipamento_id, data_aquisicao DESC);
CREATE INDEX IF NOT EXISTS idx_aquisicoes_modelo_fatura
    ON public.aquisicoes_modelo(LOWER(fatura_numero));
