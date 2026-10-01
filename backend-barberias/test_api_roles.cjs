const testBackend = async (email, password) => {
  const res = await fetch('https://barberias-api-p3br.onrender.com/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ correo: email, password })
  });
  const data = await res.json();
  const token = data.accessToken;
  console.log(`\nLogin data for ${email}:`, { hasToken: !!token });

  if (token) {
    const bRes = await fetch('https://barberias-api-p3br.onrender.com/api/v1/barberias', { headers: { 'Authorization': `Bearer ${token}` } });
    const barberias = await bRes.json();
    const barberiaId = barberias.length > 0 ? barberias[0].id : 'b9ee51dc-ceeb-4beb-9034-2b7e31afd995'; // fallback

    // TEST 1: POST /catalogo/servicios (Should be 403 for client)
    let srvRes = await fetch(`https://barberias-api-p3br.onrender.com/api/v1/catalogo/servicios`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'x-barberia-id': barberiaId, 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre: 'Test', precio: 10, duracionMinutos: 15, categoria: 'Corte' })
    });
    console.log(`POST /catalogo/servicios -> ${srvRes.status}`);

    // TEST 2: GET /agenda
    let agRes = await fetch(`https://barberias-api-p3br.onrender.com/api/v1/reservas/agenda?fecha=2026-09-30`, {
      headers: { 'Authorization': `Bearer ${token}`, 'x-barberia-id': barberiaId }
    });
    console.log(`GET /reservas/agenda -> ${agRes.status}`);

    // TEST 3: GET /pagos (auditoria)
    let pagRes = await fetch(`https://barberias-api-p3br.onrender.com/api/v1/cobros/auditoria`, {
      headers: { 'Authorization': `Bearer ${token}`, 'x-barberia-id': barberiaId }
    });
    console.log(`GET /cobros/auditoria -> ${pagRes.status}`);
  }
};

async function run() {
  await testBackend('cliente@demo.com', 'Password123!');
  await testBackend('admin@demo.com', 'Password123!');
}
run();
