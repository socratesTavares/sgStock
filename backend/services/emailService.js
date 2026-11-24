/**
 * Serviço de Notificações e Backup de Logs por E-mail (Nodemailer)
 * sgStock - MoRENet / MCTD
 */

const nodemailer = require('nodemailer');

function criarTransporter() {
    const host = process.env.SMTP_HOST;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const port = Number(process.env.SMTP_PORT) || 587;
    const secure = process.env.SMTP_SECURE === 'true' || port === 465;

    if (!host || !user || !pass) {
        return null; // Modo simulação / fallback
    }

    return nodemailer.createTransport({
        host,
        port,
        secure,
        auth: { user, pass }
    });
}

const transporter = criarTransporter();
const remetentePadrao = process.env.SMTP_FROM || 'sgStock MoRENet <noreply@morenet.ac.mz>';
const emailBackupPadrao = process.env.AUDIT_BACKUP_EMAIL || 'auditoria@morenet.ac.mz';
const emailsAlertaPadrao = (process.env.ALERT_EMAILS || 'noc@morenet.ac.mz,patrimonio@morenet.ac.mz').split(',').map(e => e.trim());

async function enviarEmail({ para, assunto, html, texto, anexos = [] }) {
    if (!transporter) {
        console.log(`[EMAIL SIMULADO] Para: ${para} | Assunto: ${assunto}`);
        return { success: true, simulated: true };
    }

    try {
        const info = await transporter.sendMail({
            from: remetentePadrao,
            to: para,
            subject: assunto,
            text: texto || undefined,
            html,
            attachments: anexos
        });
        console.log(`✉️ [EMAIL ENVIADO] ID: ${info.messageId} para ${para}`);
        return { success: true, messageId: info.messageId };
    } catch (err) {
        console.error('❌ [ERRO SMTP] Falha ao enviar email:', err.message);
        return { success: false, error: err.message };
    }
}

/**
 * Alerta de Stock Crítico
 */
async function enviarAlertaStockCritico({ equipamentoNome, instituicao, quantidadeRestante, destinatarios = null }) {
    const para = destinatarios || emailsAlertaPadrao.join(', ');
    const assunto = `⚠️ [sgStock ALERTA] Stock Crítico: ${equipamentoNome} na ${instituicao}`;
    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
            <div style="background-color: #dc2626; color: #ffffff; padding: 16px 20px;">
                <h2 style="margin: 0; font-size: 20px;">⚠️ Alerta de Stock Crítico</h2>
                <p style="margin: 4px 0 0; opacity: 0.9;">MoRENet / MCTD - sgStock</p>
            </div>
            <div style="padding: 24px; color: #1e293b; line-height: 1.6;">
                <p>Foi detetado um nível crítico de inventário para o seguinte item de infraestrutura:</p>
                <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
                    <tr style="border-bottom: 1px solid #e2e8f0;">
                        <td style="padding: 8px 0; font-weight: bold; color: #64748b;">Equipamento:</td>
                        <td style="padding: 8px 0;">${equipamentoNome}</td>
                    </tr>
                    <tr style="border-bottom: 1px solid #e2e8f0;">
                        <td style="padding: 8px 0; font-weight: bold; color: #64748b;">Localização / Instituição:</td>
                        <td style="padding: 8px 0;">${instituicao}</td>
                    </tr>
                    <tr style="border-bottom: 1px solid #e2e8f0;">
                        <td style="padding: 8px 0; font-weight: bold; color: #64748b;">Unidades Disponíveis:</td>
                        <td style="padding: 8px 0; font-weight: bold; color: #dc2626;">${quantidadeRestante} unidade(s)</td>
                    </tr>
                </table>
                <p style="margin-top: 16px;">Recomenda-se a provisão imediata ou reabastecimento através de processo de aquisição.</p>
            </div>
            <div style="background-color: #f8fafc; padding: 12px 20px; font-size: 12px; color: #64748b; text-align: center;">
                sgStock - Sistema de Governação de Telecomunicações e Redes © MoRENet / MCTD
            </div>
        </div>
    `;
    return enviarEmail({ para, assunto, html });
}

/**
 * Alerta de Ativos em Fim de Vida Útil
 */
async function enviarAlertaAtivosFimDeVida({ equipamentoNome, serial, idadeAnos, vidaUtilAnos, instituicao, destinatarios = null }) {
    const para = destinatarios || emailsAlertaPadrao.join(', ');
    const assunto = `🔔 [sgStock PREDITIVO] Fim de Vida Útil: ${equipamentoNome} (S/N: ${serial})`;
    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
            <div style="background-color: #d97706; color: #ffffff; padding: 16px 20px;">
                <h2 style="margin: 0; font-size: 20px;">🔔 Alerta de Substituição Preventiva</h2>
                <p style="margin: 4px 0 0; opacity: 0.9;">Matriz de Saúde de Ativos - sgStock</p>
            </div>
            <div style="padding: 24px; color: #1e293b; line-height: 1.6;">
                <p>O algoritmo de inteligência preditiva detetou um equipamento que atingiu o limiar de <strong>Fim de Vida Útil</strong>:</p>
                <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
                    <tr style="border-bottom: 1px solid #e2e8f0;">
                        <td style="padding: 8px 0; font-weight: bold; color: #64748b;">Equipamento:</td>
                        <td style="padding: 8px 0;">${equipamentoNome}</td>
                    </tr>
                    <tr style="border-bottom: 1px solid #e2e8f0;">
                        <td style="padding: 8px 0; font-weight: bold; color: #64748b;">Número de Série (S/N):</td>
                        <td style="padding: 8px 0; font-family: monospace;">${serial}</td>
                    </tr>
                    <tr style="border-bottom: 1px solid #e2e8f0;">
                        <td style="padding: 8px 0; font-weight: bold; color: #64748b;">Localização Atual:</td>
                        <td style="padding: 8px 0;">${instituicao}</td>
                    </tr>
                    <tr style="border-bottom: 1px solid #e2e8f0;">
                        <td style="padding: 8px 0; font-weight: bold; color: #64748b;">Idade Operacional:</td>
                        <td style="padding: 8px 0;">${idadeAnos} ano(s) (Expectativa de Ciclo: ${vidaUtilAnos} anos)</td>
                    </tr>
                </table>
                <p>Antecipe a renovação do ativo para evitar interrupções nos serviços de conectividade institucional da MoRENet.</p>
            </div>
            <div style="background-color: #f8fafc; padding: 12px 20px; font-size: 12px; color: #64748b; text-align: center;">
                sgStock - Inteligência de Ativos MoRENet / MCTD
            </div>
        </div>
    `;
    return enviarEmail({ para, assunto, html });
}

/**
 * Notificação de Operações Sensíveis (Exclusão ou Modificação Crítica)
 */
async function enviarAlertaOperacaoSensivel({ usuario, acao, entidade, detalhes, ip }) {
    const para = emailsAlertaPadrao.join(', ');
    const assunto = `🛡️ [sgStock AUDITORIA] Operação Sensível Executada: ${acao} em ${entidade}`;
    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
            <div style="background-color: #0f172a; color: #ffffff; padding: 16px 20px;">
                <h2 style="margin: 0; font-size: 20px;">🛡️ Registo de Auditoria Operacional</h2>
                <p style="margin: 4px 0 0; opacity: 0.8;">sgStock Security & Compliance</p>
            </div>
            <div style="padding: 24px; color: #1e293b; line-height: 1.6;">
                <p>Uma ação sensível com impacto no inventário ou histórico foi registada:</p>
                <ul style="padding-left: 20px; color: #334155;">
                    <li><strong>Utilizador:</strong> ${usuario}</li>
                    <li><strong>Ação:</strong> ${acao}</li>
                    <li><strong>Entidade Afetada:</strong> ${entidade}</li>
                    <li><strong>IP de Origem:</strong> ${ip}</li>
                    <li><strong>Data/Hora:</strong> ${new Date().toLocaleString('pt-PT')}</li>
                    <li><strong>Detalhes:</strong> ${detalhes || 'Sem detalhes adicionais'}</li>
                </ul>
            </div>
            <div style="background-color: #f8fafc; padding: 12px 20px; font-size: 12px; color: #64748b; text-align: center;">
                Centro de Auditoria Imutável - MoRENet / MCTD
            </div>
        </div>
    `;
    return enviarEmail({ para, assunto, html });
}

/**
 * Backup Automático de Logs de Auditoria para o E-mail Governamental
 */
async function enviarBackupLogsAuditoria(csvStringOuBuffer, nomeFicheiro = 'audit_logs.csv', totalRegistos = 0) {
    const para = emailBackupPadrao;
    const dataHoje = new Date().toISOString().slice(0, 10);
    const assunto = `📦 [sgStock BACKUP] Relatório & Logs de Auditoria Imutável (${dataHoje})`;
    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #cbd5e1; border-radius: 8px; overflow: hidden;">
            <div style="background-color: #1e3a8a; color: #ffffff; padding: 16px 20px;">
                <h2 style="margin: 0; font-size: 20px;">📦 Backup de Logs de Auditoria Imutável</h2>
                <p style="margin: 4px 0 0; opacity: 0.9;">Fiscalização & Auditoria MoRENet / MCTD</p>
            </div>
            <div style="padding: 24px; color: #1e293b; line-height: 1.6;">
                <p>Segue em anexo a exportação oficial dos registos de auditoria do sistema sgStock.</p>
                <p><strong>Total de Registos Exportados:</strong> ${totalRegistos}</p>
                <p><strong>Data de Geração:</strong> ${new Date().toLocaleString('pt-PT')}</p>
                <p>Este ficheiro foi gerado com codificação UTF-8 com BOM, assegurando compatibilidade nativa com Microsoft Excel e ferramentas de análise forense de dados.</p>
            </div>
            <div style="background-color: #f8fafc; padding: 12px 20px; font-size: 12px; color: #64748b; text-align: center;">
                Arquivo Seguro de Auditoria MoRENet / MCTD
            </div>
        </div>
    `;

    return enviarEmail({
        para,
        assunto,
        html,
        anexos: [
            {
                filename: nomeFicheiro,
                content: csvStringOuBuffer,
                contentType: 'text/csv; charset=utf-8'
            }
        ]
    });
}

module.exports = {
    enviarEmail,
    enviarAlertaStockCritico,
    enviarAlertaAtivosFimDeVida,
    enviarAlertaOperacaoSensivel,
    enviarBackupLogsAuditoria
};
