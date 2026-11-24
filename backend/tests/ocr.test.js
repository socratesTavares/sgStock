const ocr = require('../../frontend/ocr');

describe('Extração de identificadores das etiquetas', () => {
    test('reconhece rótulos Serial #: e Prod #:', () => {
        const resultado = ocr.extrairIdentificadoresDeTexto(
            'Serial #: ABC123456\nProd #: S5735-L48T4X-A'
        );

        expect(resultado.serials).toEqual(['ABC123456']);
        expect(resultado.partNumbers).toEqual(['S5735-L48T4X-A']);
    });

    test.each([
        ['(S) Serial No:', '(1P) Product No:'],
        ['Serial #:', 'Product Number:'],
        ['S/N:', 'P/N:'],
        ['SN:', 'Prod #:'],
        ['Serial Number:', 'Part No:']
    ])('reconhece variantes de rótulos %s e %s', (rotuloSerial, rotuloModelo) => {
        const resultado = ocr.extrairIdentificadoresDeTexto(
            `${rotuloSerial} FXS2233Q109\n${rotuloModelo} ASR1006-X`
        );

        expect(resultado.serials).toEqual(['FXS2233Q109']);
        expect(resultado.partNumbers).toEqual(['ASR1006-X']);
    });

    test('reconhece múltiplos números de série e rótulos P/N alternativos', () => {
        const resultado = ocr.extrairIdentificadoresDeTexto(
            'Serial #: ABC123456\nSerial #: XYZ987654\nP/N: ISR4331/K9'
        );

        expect(resultado.serials).toEqual(['ABC123456', 'XYZ987654']);
        expect(resultado.partNumbers).toEqual(['ISR4331/K9']);
    });

    test('recompõe serial dividido pelo OCR e corrige S confundido com cifrão', () => {
        const resultado = ocr.extrairIdentificadoresDeTexto(
            '(S) Serial No: FX$2233Q1 09'
        );

        expect(resultado.serials).toEqual(['FXS2233Q109']);
    });

    test('extrai ambos os identificadores do formato da etiqueta fotografada', () => {
        const resultado = ocr.extrairIdentificadoresDeTexto(
            '(1P) Product No: ASR1006-X\n(S) Serial No: FX$2233Q1 09'
        );

        expect(resultado.serials).toEqual(['FXS2233Q109']);
        expect(resultado.partNumbers).toEqual(['ASR1006-X']);
    });

    test('aceita Prod.# e prioriza-o sobre um rótulo secundário Base P/N', () => {
        const resultado = ocr.extrairIdentificadoresDeTexto(
            '): Prod.#: C116\nBase P/N: C1161X-8L'
        );

        expect(resultado.partNumbers).toEqual(['C116']);
    });

    test('recompõe P/N dividido por espaços pelo OCR e mantém o identificador completo', () => {
        const resultado = ocr.extrairIdentificadoresDeTexto(
            '(1P) :Prod.#: C1161 X-8P\nBase P/N: C1161X-8P'
        );

        expect(resultado.partNumbers).toEqual(['C1161X-8P']);
    });

    test('ignora rótulo vazio e não interpreta o próximo rótulo como valor', () => {
        const resultado = ocr.extrairIdentificadoresDeTexto(
            'Serial #: FVT3017L977\nProduct No: \nProduct No: C1161X-8P'
        );

        expect(resultado.serials).toEqual(['FVT3017L977']);
        expect(resultado.partNumbers).toEqual(['C1161X-8P']);
        expect(ocr.extrairIdentificadoresDeTexto('Product No: \n').partNumbers).toEqual([]);
    });

    test('mostra apenas identificadores detectados, descartando texto irrelevante da etiqueta', () => {
        const resultado = ocr.formatarTextoIdentificadores(
            'Cisco Systems\nProduct No: ASR1006-X\nCE 0682\nSerial #: FXS2233Q109\nMade in USA'
        );

        expect(resultado).toBe('Serial #: FXS2233Q109\nProduct No: ASR1006-X');
    });

    test('extrai os identificadores das faixas de etiqueta lidas pelo OCR', () => {
        const resultado = ocr.extrairIdentificadoresDeTexto(
            '(1P) Product No: ASR1006-X\n(S) Serial No: FX$2233Q109'
        );

        expect(resultado.serials).toEqual(['FXS2233Q109']);
        expect(resultado.partNumbers).toEqual(['ASR1006-X']);
    });
});

describe('Recuperação OCR por faixas', () => {
    test('recupera rótulos incompletos na leitura integral usando recortes dedicados', async () => {
        const windowOriginal = Object.getOwnPropertyDescriptor(global, 'window');
        const documentOriginal = Object.getOwnPropertyDescriptor(global, 'document');
        const trabalhador = {
            setParameters: jest.fn().mockResolvedValue(undefined),
            recognize: jest.fn()
                .mockResolvedValueOnce({
                    data: { text: 'roduct No: ASR1006-\nI\nrial NO:\nuri\n', blocks: [] }
                })
                .mockResolvedValueOnce({
                    data: { text: '(1P) Product No: ASR1006-X\n', confidence: 88 }
                })
                .mockResolvedValueOnce({
                    data: { text: '(1P) Product No: ASR1006-X\n', confidence: 44 }
                })
                .mockResolvedValueOnce({
                    data: { text: '', confidence: 50 }
                })
                .mockResolvedValueOnce({
                    data: { text: '', confidence: 50 }
                })
                .mockResolvedValueOnce({
                    data: { text: '', confidence: 50 }
                })
                .mockResolvedValueOnce({
                    data: { text: '', confidence: 50 }
                })
                .mockResolvedValueOnce({
                    data: { text: '(S) Serial No: FX$2233Q109\n', confidence: 44 }
                })
                .mockResolvedValueOnce({
                    data: { text: '(S) Serial No: FX$2233Q109\n', confidence: 50 }
                })
                .mockResolvedValue({ data: { text: '', confidence: 0 } })
        };
        const documentMock = {
            createElement: () => {
                const canvas = { width: 0, height: 0 };
                const contexto = {
                    imageSmoothingEnabled: false,
                    imageSmoothingQuality: '',
                    drawImage: jest.fn(),
                    putImageData: jest.fn(),
                    getImageData: (x, y, width, height) => {
                        const data = new Uint8ClampedArray(width * height * 4);
                        for (let i = 0; i < data.length; i += 4) {
                            data[i] = 255;
                            data[i + 1] = 255;
                            data[i + 2] = 255;
                            data[i + 3] = 255;
                        }
                        return { data };
                    }
                };
                canvas.getContext = () => contexto;
                return canvas;
            }
        };

        try {
            jest.resetModules();
            Object.defineProperty(global, 'window', {
                configurable: true,
                value: {
                    Tesseract: {
                        createWorker: jest.fn().mockResolvedValue(trabalhador)
                    }
                }
            });
            Object.defineProperty(global, 'document', {
                configurable: true,
                value: documentMock
            });

            const ocrComWorker = require('../../frontend/ocr');
            const texto = await ocrComWorker.reconhecerImagem({
                naturalWidth: 1000,
                naturalHeight: 500
            });

            expect(texto).toBe('Serial #: FXS2233Q109\nProduct No: ASR1006-X');
            expect(trabalhador.recognize).toHaveBeenCalledTimes(12);
        } finally {
            jest.resetModules();
            if (windowOriginal) Object.defineProperty(global, 'window', windowOriginal);
            else delete global.window;
            if (documentOriginal) Object.defineProperty(global, 'document', documentOriginal);
            else delete global.document;
        }
    });
});

describe('Acesso à câmara OCR', () => {
    const windowOriginal = Object.getOwnPropertyDescriptor(global, 'window');
    const navigatorOriginal = Object.getOwnPropertyDescriptor(global, 'navigator');

    afterEach(() => {
        if (windowOriginal) Object.defineProperty(global, 'window', windowOriginal);
        else delete global.window;
        if (navigatorOriginal) Object.defineProperty(global, 'navigator', navigatorOriginal);
        else delete global.navigator;
    });

    test('usa a câmara disponível no computador se a preferência ambiental falhar', async () => {
        const erroConstraint = Object.assign(new Error('facing mode indisponível'), {
            name: 'OverconstrainedError'
        });
        const stream = {
            getTracks: () => [{ stop: jest.fn() }]
        };
        const getUserMedia = jest.fn()
            .mockRejectedValueOnce(erroConstraint)
            .mockResolvedValueOnce(stream);
        Object.defineProperty(global, 'window', {
            configurable: true,
            value: { isSecureContext: true, location: { hostname: 'localhost' } }
        });
        Object.defineProperty(global, 'navigator', {
            configurable: true,
            value: { mediaDevices: { getUserMedia } }
        });
        const video = {
            muted: false,
            playsInline: false,
            readyState: 2,
            videoWidth: 640,
            srcObject: null,
            play: jest.fn().mockResolvedValue(undefined)
        };

        await expect(ocr.iniciarCamera(video)).resolves.toBe(stream);

        expect(getUserMedia).toHaveBeenCalledTimes(2);
        expect(getUserMedia.mock.calls[0][0].video.facingMode).toEqual({ ideal: 'environment' });
        expect(getUserMedia.mock.calls[1][0].video.facingMode).toBeUndefined();
        expect(video.muted).toBe(true);
        expect(video.playsInline).toBe(true);
    });

    test('explica a recusa de permissão sem repetir o pedido', async () => {
        const erroPermissao = Object.assign(new Error('permission denied'), {
            name: 'NotAllowedError'
        });
        const getUserMedia = jest.fn().mockRejectedValue(erroPermissao);
        Object.defineProperty(global, 'window', {
            configurable: true,
            value: { isSecureContext: true, location: { hostname: 'localhost' } }
        });
        Object.defineProperty(global, 'navigator', {
            configurable: true,
            value: { mediaDevices: { getUserMedia } }
        });

        await expect(ocr.iniciarCamera({})).rejects.toThrow(/permissão da câmara foi negada/i);
        expect(getUserMedia).toHaveBeenCalledTimes(1);
    });
});
