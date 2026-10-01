const testBackend = async (email, password) => {
  const res = await fetch('https://barberias-api-p3br.onrender.com/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ correo: email, password })
  });
  const data = await res.json();
  const token = data.accessToken;
  console.log(`\nLogin data for ${email}:`, { hasToken: !!token, roles: data.usuario?.roles });

  if (token) {
    const audRes = await fetch('https://barberias-api-p3br.onrender.com/api/v1/auditoria?limite=5', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    console.log(`GET /api/v1/auditoria -> ${audRes.status}`);
    
    // Also try to hit GET /api/v1/barberias to get a barberia ID
    const bRes = await fetch('https://barberias-api-p3br.onrender.com/api/v1/barberias', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const barberias = await bRes.json();
    if (barberias.length > 0) {
      const barberiaId = barberias[0].id;
      // GET /api/v1/barberias/:id/agenda
      const agRes = await fetch(`https://barberias-api-p3br.onrender.com/api/v1/barberias/${barberiaId}/agenda`, {
        headers: { 'Authorization': `Bearer ${token}`, 'x-barberia-id': barberiaId }
      });
      console.log(`GET /api/v1/barberias/${barberiaId}/agenda -> ${agRes.status}`);
      
      // POST /api/v1/catalogo/servicios
      const srvRes = await fetch(`https://barberias-api-p3br.onrender.com/api/v1/catalogo/servicios`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'x-barberia-id': barberiaId, 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre: 'Test', precio: 10, duracionMinutos: 15, categoria: 'Corte' })
      });
      console.log(`POST /api/v1/catalogo/servicios -> ${srvRes.status}`);
    }
  }
};

async function run() {
  await testBackend('admin@demo.com', 'Password123!');
  await testBackend('barbero@demo.com', 'Password123!');
  await testBackend('cliente@demo.com', 'Password123!');
}
run();
