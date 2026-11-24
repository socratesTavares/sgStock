/**
 * Gerador de QR Code e Etiquetas Imprimíveis em JavaScript Puro (100% Offline)
 * sgStock - MoRENet / MCTD
 */

(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof exports === 'object') {
        module.exports = factory();
    } else {
        root.sgQRCode = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {

    // Gerador compacto de QR Code Tipo 1 a 4 (Versão simplificada para etiquetas de ativos S/N)
    function QRCodeModel(typeNumber, errorCorrectLevel) {
        this.typeNumber = typeNumber;
        this.errorCorrectLevel = errorCorrectLevel;
        this.modules = null;
        this.moduleCount = 0;
        this.dataCache = null;
        this.dataList = [];
    }

    QRCodeModel.prototype = {
        addData: function(data) {
            this.dataList.push(data);
            this.dataCache = null;
        },
        isDark: function(row, col) {
            if (row < 0 || this.moduleCount <= row || col < 0 || this.moduleCount <= col) {
                throw new Error(row + "," + col);
            }
            return this.modules[row][col];
        },
        getModuleCount: function() {
            return this.moduleCount;
        },
        make: function() {
            this.makeImpl(false, this.getBestMaskPattern());
        },
        makeImpl: function(test, maskPattern) {
            this.moduleCount = this.typeNumber * 4 + 17;
            this.modules = new Array(this.moduleCount);
            for (var row = 0; row < this.moduleCount; row++) {
                this.modules[row] = new Array(this.moduleCount);
                for (var col = 0; col < this.moduleCount; col++) {
                    this.modules[row][col] = null;
                }
            }
            this.setupPositionProbePattern(0, 0);
            this.setupPositionProbePattern(this.moduleCount - 7, 0);
            this.setupPositionProbePattern(0, this.moduleCount - 7);
            this.setupPositionAdjustPattern();
            this.setupTimingPattern();
            this.setupTypeInfo(test, maskPattern);
            if (this.typeNumber >= 7) {
                this.setupTypeNumber(test);
            }
            if (this.dataCache == null) {
                this.dataCache = QRCodeModel.createData(this.typeNumber, this.errorCorrectLevel, this.dataList);
            }
            this.mapData(this.dataCache, maskPattern);
        },
        setupPositionProbePattern: function(row, col) {
            for (var r = -1; r <= 7; r++) {
                if (row + r <= -1 || this.moduleCount <= row + r) continue;
                for (var c = -1; c <= 7; c++) {
                    if (col + c <= -1 || this.moduleCount <= col + c) continue;
                    if ((0 <= r && r <= 6 && (c == 0 || c == 6))
                            || (0 <= c && c <= 6 && (r == 0 || r == 6))
                            || (2 <= r && r <= 4 && 2 <= c && c <= 4)) {
                        this.modules[row + r][col + c] = true;
                    } else {
                        this.modules[row + r][col + c] = false;
                    }
                }
            }
        },
        getBestMaskPattern: function() {
            return 0;
        },
        setupTimingPattern: function() {
            for (var r = 8; r < this.moduleCount - 8; r++) {
                if (this.modules[r][6] != null) continue;
                this.modules[r][6] = (r % 2 == 0);
            }
            for (var c = 8; c < this.moduleCount - 8; c++) {
                if (this.modules[6][c] != null) continue;
                this.modules[6][c] = (c % 2 == 0);
            }
        },
        setupPositionAdjustPattern: function() {
            var pos = [6, 18];
            if (this.typeNumber > 1) {
                for (var i = 0; i < pos.length; i++) {
                    for (var j = 0; j < pos.length; j++) {
                        var row = pos[i];
                        var col = pos[j];
                        if (this.modules[row][col] != null) continue;
                        for (var r = -2; r <= 2; r++) {
                            for (var c = -2; c <= 2; c++) {
                                if (r == -2 || r == 2 || c == -2 || c == 2 || (r == 0 && c == 0)) {
                                    this.modules[row + r][col + c] = true;
                                } else {
                                    this.modules[row + r][col + c] = false;
                                }
                            }
                        }
                    }
                }
            }
        },
        setupTypeInfo: function(test, maskPattern) {
            var data = (1 << 3) | maskPattern;
            var bits = QRUtil.getBCHTypeInfo(data);
            for (var i = 0; i < 15; i++) {
                var mod = (!test && ((bits >> i) & 1) == 1);
                if (i < 6) {
                    this.modules[i][8] = mod;
                } else if (i < 8) {
                    this.modules[i + 1][8] = mod;
                } else {
                    this.modules[this.moduleCount - 15 + i][8] = mod;
                }
            }
            for (var i = 0; i < 15; i++) {
                var mod = (!test && ((bits >> i) & 1) == 1);
                if (i < 8) {
                    this.modules[8][this.moduleCount - i - 1] = mod;
                } else if (i < 9) {
                    this.modules[8][15 - i - 1 + 1] = mod;
                } else {
                    this.modules[8][15 - i - 1] = mod;
                }
            }
            this.modules[this.moduleCount - 8][8] = (!test);
        },
        mapData: function(data, maskPattern) {
            var inc = -1;
            var row = this.moduleCount - 1;
            var bitIndex = 7;
            var byteIndex = 0;

            for (var col = this.moduleCount - 1; col > 0; col -= 2) {
                if (col == 6) col--;
                while (true) {
                    for (var c = 0; c < 2; c++) {
                        if (this.modules[row][col - c] == null) {
                            var dark = false;
                            if (byteIndex < data.length) {
                                dark = (((data[byteIndex] >>> bitIndex) & 1) == 1);
                            }
                            var mask = ((row + col - c) % 2 == 0);
                            if (mask) dark = !dark;
                            this.modules[row][col - c] = dark;
                            bitIndex--;
                            if (bitIndex == -1) {
                                byteIndex++;
                                bitIndex = 7;
                            }
                        }
                    }
                    row += inc;
                    if (row < 0 || this.moduleCount <= row) {
                        row -= inc;
                        inc = -inc;
                        break;
                    }
                }
            }
        }
    };

    var QRUtil = {
        getBCHTypeInfo: function(data) {
            var d = data << 10;
            while (QRUtil.getBCHDigit(d) - QRUtil.getBCHDigit(1335) >= 0) {
                d ^= (1335 << (QRUtil.getBCHDigit(d) - QRUtil.getBCHDigit(1335)));
            }
            return ((data << 10) | d) ^ 21522;
        },
        getBCHDigit: function(data) {
            var digit = 0;
            while (data != 0) {
                digit++;
                data >>>= 1;
            }
            return digit;
        }
    };

    QRCodeModel.createData = function(typeNumber, errorCorrectLevel, dataList) {
        var buffer = [];
        var text = dataList.join('');
        // 8-bit byte mode indicator (0100)
        buffer.push(4); 
        // Length of string
        buffer.push(text.length);
        for (var i = 0; i < text.length; i++) {
            buffer.push(text.charCodeAt(i));
        }
        // Pad bits to 128 bytes
        while (buffer.length < 34) {
            buffer.push(0xEC);
            if (buffer.length < 34) buffer.push(0x11);
        }
        return buffer;
    };

    /**
     * Gera uma tag SVG com o QR Code pronto a ser renderizado ou impresso
     */
    function gerarSvgQRCode(texto, tamanho = 120) {
        try {
            var typeNum = texto.length > 25 ? 4 : (texto.length > 14 ? 3 : 2);
            var qr = new QRCodeModel(typeNum, 1);
            qr.addData(texto);
            qr.make();

            var count = qr.getModuleCount();
            var cellSize = Math.floor(tamanho / count);
            var realSize = cellSize * count;
            var margin = 8;
            var totalDim = realSize + (margin * 2);

            var svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${totalDim}" height="${totalDim}" viewBox="0 0 ${totalDim} ${totalDim}">`;
            svg += `<rect width="${totalDim}" height="${totalDim}" fill="#ffffff"/>`;

            for (var r = 0; r < count; r++) {
                for (var c = 0; c < count; c++) {
                    if (qr.isDark(r, c)) {
                        var x = margin + (c * cellSize);
                        var y = margin + (r * cellSize);
                        svg += `<rect x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" fill="#0f172a"/>`;
                    }
                }
            }
            svg += `</svg>`;
            return svg;
        } catch (e) {
            console.error('Erro ao gerar SVG do QR Code:', e);
            return `<div style="padding:10px; border:1px dashed #ccc; font-size:12px;">QR Code: ${texto}</div>`;
        }
    }

    /**
     * Gera o HTML completo de uma etiqueta imprimível de equipamento
     */
    function escaparHTML(valor) {
        return String(valor ?? '').replace(/[&<>'"]/g, caractere => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[caractere]));
    }

    function criarEtiquetaHTML({ marca, modelo, partNumber, serial, instituicao, dataAquisicao, estado, faturaNumero, custoUnitario }) {
        var camposQR = {
            SN: serial,
            PN: partNumber,
            EQ: `${marca} ${modelo}`,
            LOC: instituicao,
            DATE: dataAquisicao,
            STATE: estado,
            INVOICE: faturaNumero,
            COST: custoUnitario
        };
        var qrData = Object.entries(camposQR)
            .filter(([, valor]) => valor !== undefined && valor !== null && String(valor).length)
            .map(([chave, valor]) => `${chave}:${encodeURIComponent(String(valor))}`)
            .join('|');
        var qrSvg = gerarSvgQRCode(qrData, 100);
        var marcaSafe = escaparHTML(marca);
        var modeloSafe = escaparHTML(modelo);
        var partNumberSafe = escaparHTML(partNumber);
        var serialSafe = escaparHTML(serial);
        var instituicaoSafe = escaparHTML(instituicao);

        return `
            <div class="etiqueta-ativo-box">
                <div class="etiqueta-topo">
                    <span class="etiqueta-org">REPÚBLICA DE MOÇAMBIQUE - MoRENet / MCTD</span>
                    <span class="etiqueta-patrimonio">PATRIMÓNIO DE REDE</span>
                </div>
                <div class="etiqueta-corpo">
                    <div class="etiqueta-qr">${qrSvg}</div>
                    <div class="etiqueta-detalhes">
                        <div class="etiqueta-item"><strong>EQUIPAMENTO:</strong> ${marcaSafe} ${modeloSafe}</div>
                        <div class="etiqueta-item"><strong>PART NUMBER:</strong> ${partNumberSafe}</div>
                        <div class="etiqueta-item"><strong>SERIAL NUMBER (S/N):</strong> <span class="destaque-sn">${serialSafe}</span></div>
                        <div class="etiqueta-item"><strong>LOCALIZAÇÃO:</strong> ${instituicaoSafe}</div>
                        ${dataAquisicao ? `<div class="etiqueta-item"><strong>AQUISIÇÃO:</strong> ${escaparHTML(dataAquisicao)}</div>` : ''}
                        ${estado ? `<div class="etiqueta-item"><strong>ESTADO:</strong> ${escaparHTML(estado)}</div>` : ''}
                        ${faturaNumero ? `<div class="etiqueta-item"><strong>FATURA:</strong> ${escaparHTML(faturaNumero)}</div>` : ''}
                        ${custoUnitario !== undefined && custoUnitario !== null && String(custoUnitario).length ? `<div class="etiqueta-item"><strong>CUSTO:</strong> ${escaparHTML(custoUnitario)} MZN</div>` : ''}
                    </div>
                </div>
                <div class="etiqueta-rodape">
                    VERIFICAÇÃO DE ATIVOS & FISCALIZAÇÃO - sgStock
                </div>
            </div>
        `;
    }

    return {
        gerarSvgQRCode: gerarSvgQRCode,
        criarEtiquetaHTML: criarEtiquetaHTML
    };
}));
