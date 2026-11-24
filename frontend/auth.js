(() => {
    const token = localStorage.getItem('token');
    let expirado = !token;

    if (token) {
        try {
            const payload = token.split('.')[1];
            const dados = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
            expirado = !Number.isFinite(dados.exp) || dados.exp * 1000 <= Date.now();
        } catch {
            expirado = true;
        }
    }

    if (expirado) {
        localStorage.removeItem('token');
        localStorage.removeItem('usuario');
        window.location.replace(token ? '/login?expired=1' : '/login');
    }
})();
