/**
 * Módulo de Leitura OCR e Reconhecimento de Etiquetas de Equipamentos
 * Permite capturar imagem da câmara ou carregar ficheiro e extrair S/N e P/N automaticamente.
 * sgStock - MoRENet / MCTD
 */

const sgOCR = (function () {

    // Regex de extração de S/N e P/N comuns em equipamentos Cisco, Huawei, MikroTik, Ubiquiti, etc.
    const REGEX_SERIAL = /(?:\bSERIAL(?:[ \t]*(?:NUMBER|NO\.?))?|\bS[ \t]*\/[ \t]*N|\bS\.?[ \t]*N\.?|\bSERIE)\b[ \t]*(?:#[ \t]*)?[:;=#\-]?[ \t]*([^\r\n]*)/gi;
    const REGEX_PRIMARY_PARTNUMBER = /(?:\bPRODUCT(?:[ \t]*(?:NO\.?|NUMBER))?|\bPROD(?:UCT)?(?:[ \t]*(?:NO\.?|NUMBER))?|\bPART(?:[ \t]*(?:NUMBER|NO\.?))?|\bPID|\bMODEL)\b[ \t]*\.?[ \t]*(?:#[ \t]*)?[:;=\-]?[ \t]*([^\r\n]*)/gi;
    const REGEX_PARTNUMBER = /(?:\bPRODUCT(?:[ \t]*(?:NO\.?|NUMBER))?|\bPROD(?:UCT)?(?:[ \t]*(?:NO\.?|NUMBER))?|\bPART(?:[ \t]*(?:NUMBER|NO\.?))?|\bP[ \t]*\/[ \t]*N|\bP\.?[ \t]*N\.?|\bPID|\bMODEL)\b[ \t]*\.?[ \t]*(?:#[ \t]*)?[:;=\-]?[ \t]*([^\r\n]*)/gi;
    const REGEX_STANDALONE_SERIAL = /\b([A-Z0-9]{2,4}[0-9]{6,12}[A-Z0-9]?)\b/g;
    const REGEX_SERIAL_LABEL = /\b(?:SERIAL|SERIE|S[ \t]*\/[ \t]*N|S\.?[ \t]*N\.?)\b/i;
    const REGEX_PART_LABEL = /\b(?:PRODUCT|PROD|PART|P[ \t]*\/[ \t]*N|P\.?[ \t]*N\.?|PID|MODEL)\b/i;
    let workerPromise = null;

    /**
     * Pré-processamento de imagem em Canvas (Contraste, Escala de Cinza e Binarização)
     */
    function preProcessarImagem(imgElement) {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { willReadFrequently: true });

        const sourceWidth = imgElement.naturalWidth || imgElement.videoWidth || imgElement.width;
        const sourceHeight = imgElement.naturalHeight || imgElement.videoHeight || imgElement.height;
        if (!sourceWidth || !sourceHeight || !ctx) {
            throw new Error('A imagem não contém dimensões válidas para OCR.');
        }

        const scale = Math.min(1, 2200 / sourceWidth);
        canvas.width = Math.round(sourceWidth * scale);
        canvas.height = Math.round(sourceHeight * scale);
        ctx.drawImage(imgElement, 0, 0, canvas.width, canvas.height);

        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const d = imgData.data;

        // Escala de cinza e realce de contraste
        for (let i = 0; i < d.length; i += 4) {
            const gray = (d[i] * 0.299) + (d[i + 1] * 0.587) + (d[i + 2] * 0.114);
            // Threshold / binarização adaptativa
            const val = gray > 128 ? Math.min(255, gray * 1.2) : Math.max(0, gray * 0.8);
            d[i] = val;
            d[i + 1] = val;
            d[i + 2] = val;
        }

        ctx.putImageData(imgData, 0, 0);
        return canvas;
    }

    async function reconhecerImagem(imagem, onProgress, onDiagnostic) {
        if (!window.Tesseract || typeof window.Tesseract.createWorker !== 'function') {
            throw new Error('O motor OCR não foi carregado. Atualize a página e tente novamente.');
        }

        if (!workerPromise) {
            workerPromise = window.Tesseract.createWorker('eng', 1, {
                workerPath: '/ocr-assets/worker.min.js',
                corePath: '/ocr-assets/core',
                langPath: '/ocr-assets/lang',
                gzip: true,
                workerBlobURL: false,
                logger: message => {
                    if (typeof onProgress === 'function') onProgress(message);
                }
            }).catch(error => {
                workerPromise = null;
                throw error;
            });
        }

        const worker = await workerPromise;
        const larguraOriginal = imagem.naturalWidth || imagem.videoWidth || imagem.width;
        const alturaOriginal = imagem.naturalHeight || imagem.videoHeight || imagem.height;
        const imagemTratada = preProcessarImagem(imagem);
        const leiturasRotuladas = [];
        await worker.setParameters({
            tessedit_pageseg_mode: '11',
            preserve_interword_spaces: '1'
        });
        const resultado = await worker.recognize(imagemTratada, {}, { blocks: true });
        const textoCompleto = resultado.data.text || '';
        const linhasRotuladas = (resultado.data.blocks || []).flatMap(bloco =>
            (bloco.paragraphs || []).flatMap(paragrafo => paragrafo.lines || [])
        ).filter(linha => {
            const textoLinha = (linha.words || []).map(palavra => palavra.text).join(' ') || linha.text || '';
            return REGEX_SERIAL_LABEL.test(textoLinha) || REGEX_PART_LABEL.test(textoLinha);
        });

        const textosPorLinha = [];
        for (const linha of linhasRotuladas) {
            const textoLinha = (linha.words || []).map(palavra => palavra.text).join(' ') || linha.text || '';
            const ehSerial = REGEX_SERIAL_LABEL.test(textoLinha);
            const recorte = ehSerial
                ? criarRecorteSerial(imagemTratada, linha)
                : criarRecorteDeLinha(imagemTratada, linha);
            const leituraRotulada = {
                tipo: ehSerial ? 'serial' : 'product',
                rotuloReconhecido: textoLinha,
                caixa: linha.bbox || null,
                modoSegmentacao: ehSerial ? '4' : '7',
                recorteCriado: Boolean(recorte),
                textoOCR: ''
            };
            leiturasRotuladas.push(leituraRotulada);
            if (!recorte) continue;

            await worker.setParameters({
                tessedit_pageseg_mode: ehSerial ? '4' : '7',
                preserve_interword_spaces: '1'
            });
            const leitura = await worker.recognize(recorte);
            leituraRotulada.textoOCR = leitura.data.text || '';
            if (leituraRotulada.textoOCR) textosPorLinha.push(leituraRotulada.textoOCR.trim());
        }

        await worker.setParameters({ tessedit_pageseg_mode: '11' });
        const textoLinhas = textosPorLinha.join('\n');
        const identificadoresLinhas = extrairIdentificadoresDeTexto(textoLinhas);
        const identificadoresCompletos = extrairIdentificadoresDeTexto(textoCompleto);
        const linhasFinais = [...textosPorLinha];

        if (!identificadoresLinhas.serials.length && identificadoresCompletos.serials.length) {
            linhasFinais.push(...textoCompleto.split(/\r?\n/).filter(linha => REGEX_SERIAL_LABEL.test(linha)));
        }
        if (!identificadoresLinhas.partNumbers.length && identificadoresCompletos.partNumbers.length) {
            linhasFinais.push(...textoCompleto.split(/\r?\n/).filter(linha => REGEX_PART_LABEL.test(linha)));
        }
        const textoFinal = linhasFinais.join('\n') || textoCompleto;
        const identificadoresDoTextoFinal = extrairIdentificadoresDeTexto(textoFinal);
        const partNumbersPrimarios = [
            ...extrairPartNumbersPrimarios(textoLinhas),
            ...extrairPartNumbersPrimarios(textoCompleto)
        ];
        const identificadoresTexto = {
            ...identificadoresDoTextoFinal,
            partNumbers: partNumbersPrimarios.length
                ? Array.from(new Set(partNumbersPrimarios))
                : identificadoresDoTextoFinal.partNumbers
        };
        const leiturasPorFaixa = [];
        let seriaisAlternativos = [];
        let partNumbersAlternativos = [];
        const partNumberTextoMaisLongo = identificadoresTexto.partNumbers.reduce(
            (maior, valor) => Math.max(maior, valor.length),
            0
        );
        const precisaRelerPartNumber = partNumberTextoMaisLongo < 9;
        const precisaRelerSerial = identificadoresTexto.serials.length === 0;

        if (precisaRelerPartNumber) {
            const leitura = await reconhecerFaixaRotulada(worker, imagemTratada, 0.015, 0.255, '7', true);
            leiturasPorFaixa.push({ tipo: 'product', ...leitura });
            partNumbersAlternativos = extrairPartNumbersPrimarios(leitura.texto);
        }

        if ((precisaRelerPartNumber && partNumbersAlternativos.every(valor => valor.length < 9)) || precisaRelerSerial) {
            const leiturasScan = await reconhecerFaixasSobrepostas(worker, imagemTratada);
            leiturasPorFaixa.push(...leiturasScan.map(leitura => ({ tipo: 'scan', ...leitura })));

            if (precisaRelerPartNumber) {
                const candidatos = leiturasScan.flatMap(leitura => extrairPartNumbersPrimarios(leitura.texto));
                const melhorCandidato = escolherCandidatoPorFaixas(
                    leiturasScan,
                    extrairPartNumbersPrimarios,
                    true
                );
                if (melhorCandidato) partNumbersAlternativos = [melhorCandidato];
                else if (candidatos.length) partNumbersAlternativos = candidatos;
            }
            if (precisaRelerSerial) {
                let melhorSerial = escolherCandidatoPorFaixas(
                    leiturasScan,
                    texto => extrairValoresRotulados(texto, REGEX_SERIAL, 'serial')
                );
                if (!melhorSerial) {
                    const leiturasEsparsas = await reconhecerFaixasSobrepostas(worker, imagemTratada, '11');
                    leiturasPorFaixa.push(...leiturasEsparsas.map(leitura => ({
                        tipo: 'scan-sparse',
                        ...leitura
                    })));
                    melhorSerial = escolherCandidatoPorFaixas(
                        leiturasEsparsas,
                        texto => extrairValoresRotulados(texto, REGEX_SERIAL, 'serial')
                    );
                    if (!melhorSerial) {
                        melhorSerial = escolherCandidatoPorFaixas(
                            leiturasEsparsas,
                            texto => extrairIdentificadoresDeTexto(texto).serials
                        );
                    }
                }
                seriaisAlternativos = melhorSerial ? [melhorSerial] : [];
            }
        }

        await worker.setParameters({ tessedit_pageseg_mode: '11' });
        const identificadoresFinais = {
            serials: seriaisAlternativos.length ? seriaisAlternativos : identificadoresTexto.serials,
            partNumbers: partNumbersAlternativos.length &&
                partNumbersAlternativos.some(valor => valor.length >= partNumberTextoMaisLongo)
                ? partNumbersAlternativos
                : identificadoresTexto.partNumbers
        };
        const textoFormatado = formatarIdentificadores(identificadoresFinais) || textoFinal;
        if (typeof onDiagnostic === 'function') {
            onDiagnostic({
                estado: 'concluido',
                motor: 'Tesseract.js',
                idioma: 'eng',
                imagem: {
                    larguraOriginal,
                    alturaOriginal,
                    larguraProcessada: imagemTratada.width,
                    alturaProcessada: imagemTratada.height
                },
                textoOCRCompleto: textoCompleto,
                leiturasRotuladas,
                leiturasPorFaixa,
                textoOCRDasLinhas: textoLinhas,
                textoUsadoParaExtracao: textoFinal,
                textoApresentado: textoFormatado,
                identificadores: identificadoresFinais
            });
        }
        return textoFormatado;
    }

    function criarRecorteSerial(canvasOrigem, linha) {
        const caixa = linha.bbox;
        if (!caixa || !Number.isFinite(caixa.x0) || !Number.isFinite(caixa.y0) ||
            !Number.isFinite(caixa.x1) || !Number.isFinite(caixa.y1)) {
            return null;
        }
        const larguraTexto = caixa.x1 - caixa.x0;
        const alturaTexto = caixa.y1 - caixa.y0;
        const margemX = Math.max(8, Math.round(alturaTexto * 0.25));
        const inicioX = Math.max(0, Math.floor(caixa.x0 - margemX));
        const fimX = canvasOrigem.width;
        const inicioY = Math.max(0, Math.floor(caixa.y0 + alturaTexto * 0.12));
        const alturaRecorte = canvasOrigem.height - inicioY;
        if (larguraTexto < 20 || alturaTexto < 10 || fimX - inicioX < 100 || alturaRecorte < 10) {
            return null;
        }

        const escala = 2;
        const recorte = document.createElement('canvas');
        recorte.width = (fimX - inicioX) * escala;
        recorte.height = alturaRecorte * escala;
        const contextoRecorte = recorte.getContext('2d');
        if (!contextoRecorte) return null;
        contextoRecorte.imageSmoothingEnabled = true;
        contextoRecorte.imageSmoothingQuality = 'high';
        contextoRecorte.drawImage(
            canvasOrigem,
            inicioX, inicioY, fimX - inicioX, alturaRecorte,
            0, 0, recorte.width, recorte.height
        );
        return recorte;
    }

    function criarRecorteDeLinha(canvasOrigem, linha) {
        const caixa = linha.bbox;
        if (!caixa || !Number.isFinite(caixa.x0) || !Number.isFinite(caixa.y0) ||
            !Number.isFinite(caixa.x1) || !Number.isFinite(caixa.y1)) {
            return null;
        }

        const larguraTexto = caixa.x1 - caixa.x0;
        const alturaTexto = caixa.y1 - caixa.y0;
        if (larguraTexto < 20 || alturaTexto < 10) return null;

        const margemX = Math.max(8, Math.round(alturaTexto * 0.25));
        const inicioX = Math.max(0, Math.floor(caixa.x0 - margemX));
        const fimXOriginal = Math.min(canvasOrigem.width, Math.ceil(caixa.x1 + margemX));
        const inicioY = Math.max(0, Math.floor(caixa.y0 - alturaTexto * 0.15));
        const fimY = Math.min(canvasOrigem.height, Math.ceil(caixa.y1 + alturaTexto * 0.15));
        const alturaRecorte = fimY - inicioY;
        if (fimXOriginal - inicioX < 100 || alturaRecorte < 10) return null;

        const contextoOrigem = canvasOrigem.getContext('2d', { willReadFrequently: true });
        const banda = contextoOrigem.getImageData(inicioX, inicioY, fimXOriginal - inicioX, alturaRecorte);
        const pixelsPorColuna = banda.width;
        const minimoEscuro = Math.floor(alturaRecorte * 0.45);
        const inicioBusca = Math.floor(larguraTexto * 0.35);
        const larguraMinimaMascara = Math.max(18, Math.floor(alturaTexto * 0.12));
        let inicioTrechoEscuro = -1;
        let limiteDireito = fimXOriginal;

        // Não tenta adivinhar caracteres que estejam cobertos por uma máscara opaca.
        for (let x = inicioBusca; x < pixelsPorColuna; x++) {
            let pixelsEscuros = 0;
            for (let y = 0; y < alturaRecorte; y++) {
                const indice = (y * pixelsPorColuna + x) * 4;
                const luminancia =
                    banda.data[indice] * 0.299 +
                    banda.data[indice + 1] * 0.587 +
                    banda.data[indice + 2] * 0.114;
                if (luminancia < 65) pixelsEscuros++;
            }

            if (pixelsEscuros >= minimoEscuro) {
                if (inicioTrechoEscuro < 0) inicioTrechoEscuro = x;
            } else if (inicioTrechoEscuro >= 0) {
                if (x - inicioTrechoEscuro >= larguraMinimaMascara) {
                    limiteDireito = inicioX + inicioTrechoEscuro - 5;
                    break;
                }
                inicioTrechoEscuro = -1;
            }
        }
        if (inicioTrechoEscuro >= 0 &&
            pixelsPorColuna - inicioTrechoEscuro >= larguraMinimaMascara) {
            limiteDireito = Math.min(limiteDireito, inicioX + inicioTrechoEscuro - 5);
        }

        const larguraRecorte = limiteDireito - inicioX;
        if (larguraRecorte < 100) return null;

        const escala = 2;
        const recorte = document.createElement('canvas');
        recorte.width = larguraRecorte * escala;
        recorte.height = alturaRecorte * escala;
        const contextoRecorte = recorte.getContext('2d');
        if (!contextoRecorte) return null;
        contextoRecorte.imageSmoothingEnabled = true;
        contextoRecorte.imageSmoothingQuality = 'high';
        contextoRecorte.drawImage(
            canvasOrigem,
            inicioX, inicioY, larguraRecorte, alturaRecorte,
            0, 0, recorte.width, recorte.height
        );
        return recorte;
    }

    async function reconhecerFaixaRotulada(worker, canvasOrigem, proporcaoInicio, proporcaoFim, modoSegmentacao, removerMascara) {
        const inicioY = Math.round(canvasOrigem.height * proporcaoInicio);
        const altura = Math.max(1, Math.round(canvasOrigem.height * (proporcaoFim - proporcaoInicio)));
        const largura = removerMascara
            ? localizarInicioMascara(canvasOrigem, inicioY, inicioY + altura)
            : canvasOrigem.width;
        const escala = 2;
        const recorte = document.createElement('canvas');
        recorte.width = largura * escala;
        recorte.height = altura * escala;
        const contexto = recorte.getContext('2d');
        if (!contexto) throw new Error('Não foi possível preparar o recorte da etiqueta para OCR.');
        contexto.imageSmoothingEnabled = true;
        contexto.imageSmoothingQuality = 'high';
        contexto.drawImage(canvasOrigem, 0, inicioY, largura, altura, 0, 0, recorte.width, recorte.height);
        await worker.setParameters({
            tessedit_pageseg_mode: modoSegmentacao,
            preserve_interword_spaces: '1'
        });
        const resultado = await worker.recognize(recorte);
        return {
            faixaVertical: [proporcaoInicio, proporcaoFim],
            modoSegmentacao,
            limiteMascara: largura < canvasOrigem.width ? largura : null,
            texto: resultado.data.text || '',
            confianca: resultado.data.confidence ?? null
        };
    }

    async function reconhecerFaixasSobrepostas(worker, canvasOrigem, modoSegmentacao = '6') {
        const alturaFaixa = Math.min(canvasOrigem.height, Math.max(80, Math.round(canvasOrigem.height * 0.3)));
        const passo = Math.max(40, Math.round(canvasOrigem.height * 0.2));
        const inicios = [0];
        for (let inicio = passo; inicio + alturaFaixa < canvasOrigem.height; inicio += passo) {
            inicios.push(inicio);
        }
        const ultimoInicio = Math.max(0, canvasOrigem.height - alturaFaixa);
        if (inicios[inicios.length - 1] !== ultimoInicio) inicios.push(ultimoInicio);

        const faixas = [];
        for (const inicio of inicios) {
            const fim = inicio + alturaFaixa;
            faixas.push(await reconhecerFaixaRotulada(
                worker,
                canvasOrigem,
                inicio / canvasOrigem.height,
                fim / canvasOrigem.height,
                modoSegmentacao,
                true
            ));
        }
        return faixas;
    }

    function escolherCandidatoPorFaixas(leituras, extrairCandidatos, priorizarMaior = false) {
        const votos = new Map();
        for (const leitura of leituras) {
            const candidatos = new Set(extrairCandidatos(leitura.texto));
            for (const candidato of candidatos) {
                const voto = votos.get(candidato) || { ocorrencias: 0, confianca: 0 };
                voto.ocorrencias++;
                voto.confianca = Math.max(voto.confianca, Number(leitura.confianca) || 0);
                votos.set(candidato, voto);
            }
        }

        return Array.from(votos.entries())
            .sort((a, b) =>
                (priorizarMaior ? b[0].length - a[0].length : b[1].ocorrencias - a[1].ocorrencias) ||
                b[1].confianca - a[1].confianca ||
                (priorizarMaior ? b[1].ocorrencias - a[1].ocorrencias : b[0].length - a[0].length)
            )[0]?.[0] || null;
    }

    function localizarInicioMascara(canvasOrigem, inicioY, fimY) {
        const contexto = canvasOrigem.getContext('2d', { willReadFrequently: true });
        if (!contexto) return canvasOrigem.width;
        const alturaFaixa = fimY - inicioY;
        const janela = Math.min(alturaFaixa, Math.max(24, Math.round(canvasOrigem.height * 0.1)));
        if (janela < 10) return canvasOrigem.width;

        const pixels = contexto.getImageData(0, inicioY, canvasOrigem.width, alturaFaixa).data;
        const largura = canvasOrigem.width;
        const minimoX = Math.floor(largura * 0.2);
        const larguraMinima = Math.max(20, Math.round(canvasOrigem.height * 0.08));
        const passo = Math.max(8, Math.round(canvasOrigem.height * 0.03));

        for (let yJanela = 0; yJanela + janela <= alturaFaixa; yJanela += passo) {
            const colunasEscuras = new Uint16Array(largura);
            for (let y = yJanela; y < yJanela + janela; y++) {
                for (let x = minimoX; x < largura; x++) {
                    const indice = (y * largura + x) * 4;
                    if (pixels[indice] < 55) colunasEscuras[x]++;
                }
            }

            let inicioMascara = -1;
            for (let x = minimoX; x < largura; x++) {
                if (colunasEscuras[x] / janela >= 0.65) {
                    if (inicioMascara < 0) inicioMascara = x;
                } else if (inicioMascara >= 0) {
                    if (x - inicioMascara >= larguraMinima) return Math.max(minimoX, inicioMascara - 6);
                    inicioMascara = -1;
                }
            }
            if (inicioMascara >= 0 && largura - inicioMascara >= larguraMinima) {
                return Math.max(minimoX, inicioMascara - 6);
            }
        }
        return largura;
    }

    /**
     * Analisa texto puro extraído para identificar S/N e P/N
     */
    function extrairIdentificadoresDeTexto(textoBruto) {
        if (!textoBruto) return { serials: [], partNumbers: [] };

        const serials = new Set(extrairValoresRotulados(textoBruto, REGEX_SERIAL, 'serial'));
        const partNumbersPrimarios = extrairPartNumbersPrimarios(textoBruto);
        const partNumbers = new Set(
            partNumbersPrimarios.length
                ? partNumbersPrimarios
                : extrairValoresRotulados(textoBruto, REGEX_PARTNUMBER, 'partNumber')
        );

        // 3. Heurística complementar: se nenhum S/N foi encontrado com etiqueta explícita, procura formato de serial comum
        if (serials.size === 0) {
            const regexSerialSolto = new RegExp(REGEX_STANDALONE_SERIAL.source, 'g');
            let match;
            while ((match = regexSerialSolto.exec(textoBruto)) !== null) {
                const sn = match[1].trim().toUpperCase();
                // Ignora palavras comuns ou números muito curtos
                if (sn.length >= 8 && /[A-Z]/.test(sn) && /[0-9]/.test(sn)) {
                    serials.add(sn);
                }
            }
        }

        return {
            serials: Array.from(serials),
            partNumbers: Array.from(partNumbers)
        };
    }

    function extrairPartNumbersPrimarios(textoBruto) {
        return extrairValoresRotulados(textoBruto, REGEX_PRIMARY_PARTNUMBER, 'partNumber');
    }

    function extrairValoresRotulados(textoBruto, regexRotulo, tipo) {
        if (!textoBruto) return [];

        const regex = new RegExp(regexRotulo.source, regexRotulo.flags);
        const valores = new Set();
        let match;
        while ((match = regex.exec(textoBruto)) !== null) {
            const padraoValor = tipo === 'serial'
                ? /[A-Z0-9$][A-Z0-9$_-]*(?:[ \t]+\d{1,4})?/i
                : /[A-Z0-9][A-Z0-9_/-]*(?:[ \t]+[A-Z0-9]*[-/][A-Z0-9][A-Z0-9_/-]*)?/i;
            const valorEncontrado = match[1].match(padraoValor);
            if (!valorEncontrado) continue;

            let valor = valorEncontrado[0].replace(/\s+/g, '').toUpperCase();
            if (tipo === 'serial') valor = valor.replace(/\$/g, 'S');
            if (tipo === 'serial' && valor.length >= 5 && /[A-Z]/.test(valor) && /\d/.test(valor)) {
                valores.add(valor);
            } else if (tipo === 'partNumber' && valor.length >= 4) {
                valores.add(valor);
            }
        }
        return Array.from(valores);
    }

    function formatarTextoIdentificadores(textoBruto) {
        return formatarIdentificadores(extrairIdentificadoresDeTexto(textoBruto));
    }

    function formatarIdentificadores(identificadores) {
        const linhas = [
            ...identificadores.serials.map(serial => `Serial #: ${serial}`),
            ...identificadores.partNumbers.map(partNumber => `Product No: ${partNumber}`)
        ];
        return linhas.join('\n');
    }

    /**
     * Inicia o fluxo de câmara / captura para OCR
     */
    async function iniciarCamera(videoElement) {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error('Este navegador não disponibiliza acesso à câmara. Atualize-o ou carregue uma foto da etiqueta.');
        }

        if (window.isSecureContext === false &&
            !['localhost', '127.0.0.1', '::1'].includes(window.location.hostname)) {
            throw new Error('O acesso à câmara requer HTTPS. Abra o endereço seguro HTTPS do túnel ngrok.');
        }

        const tentativas = [
            {
                video: {
                    facingMode: { ideal: 'environment' },
                    width: { ideal: 1920 },
                    height: { ideal: 1080 }
                },
                audio: false
            },
            { video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
            { video: true, audio: false }
        ];
        let erro;
        let stream;
        for (const constraints of tentativas) {
            try {
                stream = await navigator.mediaDevices.getUserMedia(constraints);
                break;
            } catch (error) {
                erro = error;
                if (['NotAllowedError', 'SecurityError'].includes(error.name)) break;
            }
        }

        if (!stream) throw new Error(mensagemErroCamera(erro));

        try {
            videoElement.muted = true;
            videoElement.playsInline = true;
            videoElement.srcObject = stream;
            await videoElement.play();
            await aguardarVideoPronto(videoElement);
            return stream;
        } catch (error) {
            pararCamera(stream);
            videoElement.srcObject = null;
            throw new Error(`A câmara foi ligada, mas não iniciou o vídeo: ${error.message || 'verifique as permissões do navegador.'}`);
        }
    }

    function aguardarVideoPronto(videoElement) {
        if (videoElement.readyState >= 2 && videoElement.videoWidth > 0) return Promise.resolve();

        return new Promise((resolve, reject) => {
            const limpar = () => {
                clearTimeout(timeout);
                videoElement.removeEventListener('loadeddata', verificar);
                videoElement.removeEventListener('canplay', verificar);
                videoElement.removeEventListener('error', falhar);
                videoElement.srcObject?.getVideoTracks?.()[0]?.removeEventListener('ended', falhar);
            };
            const verificar = () => {
                if (videoElement.readyState >= 2 && videoElement.videoWidth > 0) {
                    limpar();
                    resolve();
                }
            };
            const falhar = () => {
                limpar();
                reject(new Error('O navegador não conseguiu iniciar a transmissão de vídeo.'));
            };
            const timeout = setTimeout(() => {
                limpar();
                reject(new Error('A câmara não enviou vídeo. Verifique se está a ser usada por outra aplicação.'));
            }, 10000);

            videoElement.addEventListener('loadeddata', verificar);
            videoElement.addEventListener('canplay', verificar);
            videoElement.addEventListener('error', falhar);
            videoElement.srcObject?.getVideoTracks?.()[0]?.addEventListener('ended', falhar);
            verificar();
        });
    }

    function mensagemErroCamera(error) {
        if (!error) return 'Não foi possível iniciar a câmara.';
        if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
            return 'A permissão da câmara foi negada. Autorize a câmara nas definições do navegador e tente novamente.';
        }
        if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
            return 'Não foi encontrada uma câmara ligada a este dispositivo.';
        }
        if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
            return 'A câmara está ocupada por outra aplicação. Feche outras aplicações que a estejam a utilizar.';
        }
        return `Não foi possível aceder à câmara: ${error.message || error.name || 'erro desconhecido'}.`;
    }

    function pararCamera(stream) {
        if (stream && stream.getTracks) {
            stream.getTracks().forEach(track => track.stop());
        }
    }

    function capturarQuadroDeVideo(videoElement) {
        if (!videoElement.videoWidth || !videoElement.videoHeight || videoElement.readyState < 2) {
            throw new Error('Aguarde a imagem da câmara aparecer antes de capturar.');
        }
        const canvas = document.createElement('canvas');
        canvas.width = videoElement.videoWidth;
        canvas.height = videoElement.videoHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Não foi possível preparar a imagem da câmara.');
        ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
        return canvas;
    }

    return {
        preProcessarImagem,
        reconhecerImagem,
        extrairIdentificadoresDeTexto,
        formatarTextoIdentificadores,
        iniciarCamera,
        pararCamera,
        capturarQuadroDeVideo
    };
})();

if (typeof window !== 'undefined') {
    window.sgOCR = sgOCR;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = sgOCR;
}
