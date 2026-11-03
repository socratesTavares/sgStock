if (localStorage.getItem('token')) {
    window.location.replace('index.html');
}

document.getElementById('form-login').addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = document.getElementById('email').value;
    const senha = document.getElementById('senha').value;
    const msgErro = document.getElementById('mensagem-erro');

    msgErro.style.display = 'none';

    try {
        const res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, senha })
        });

        const data = await res.json();

        if (!res.ok) {
            msgErro.textContent = data.error || 'Erro ao efetuar login.';
            msgErro.style.display = 'block';
            return;
        }

        localStorage.setItem('token', data.token);
        localStorage.setItem('usuario', JSON.stringify(data.usuario));
        window.location.href = 'index.html';
    } catch (error) {
        msgErro.textContent = 'Erro ao conectar com o servidor.';
        msgErro.style.display = 'block';
        console.error(error);
    }
});