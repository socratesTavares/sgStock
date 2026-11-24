function tokenValido(token) {
    try {
        const payload = token.split('.')[1];
        const dados = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
        return Number.isFinite(dados.exp) && dados.exp * 1000 > Date.now();
    } catch {
        return false;
    }
}

const tokenGuardado = localStorage.getItem('token');
if (tokenGuardado && tokenValido(tokenGuardado)) {
    window.location.replace('/home');
} else if (tokenGuardado) {
    localStorage.removeItem('token');
    localStorage.removeItem('usuario');
}

if (new URLSearchParams(window.location.search).get('expired') === '1') {
    const msgErro = document.getElementById('mensagem-erro');
    msgErro.textContent = 'A sua sessão expirou. Inicie sessão novamente.';
    msgErro.style.display = 'block';
    msgErro.setAttribute('role', 'alert');
}

document.getElementById('form-login').addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = document.getElementById('email').value;
    const senha = document.getElementById('senha').value;
    const msgErro = document.getElementById('mensagem-erro');

    msgErro.style.display = 'none';

    try {
        const options = {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, senha })
        };
        let res = await fetch('/api/auth/login', options);
        if (res.status === 404) {
            res = await fetch('/api/login', options);
        }

        const contentType = res.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
            throw new Error('O servidor não disponibiliza a rota de autenticação. Reinicie o backend sgStock atualizado.');
        }
        const data = await res.json();

        if (!res.ok) {
            msgErro.textContent = data.error || 'Erro ao efetuar login.';
            msgErro.style.display = 'block';
            return;
        }

        if (!data.token || !data.usuario) {
            throw new Error('Resposta de autenticação inválida. Verifique a versão do backend.');
        }

        localStorage.setItem('token', data.token);
        localStorage.setItem('usuario', JSON.stringify(data.usuario));
        window.location.href = '/home';
    } catch (error) {
        msgErro.textContent = error.message || 'Erro ao conectar com o servidor.';
        msgErro.style.display = 'block';
        console.error(error);
    }
});
