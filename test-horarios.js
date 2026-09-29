const baseUrl = 'http://localhost:3000/api/v1';
const email = `test.horario.${Date.now()}@test.com`;
const password = 'Password123!';

async function run() {
  console.log('1. Registrando usuario...');
  const regRes = await fetch(`${baseUrl}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombreCompleto: 'Test Horario', correo: email, password, telefono: Date.now().toString().slice(-10) })
  });
  const regData = await regRes.json();
  if (!regRes.ok) throw new Error(JSON.stringify(regData));
  
  const loginRes = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ correo: email, password })
  });
  const loginData = await loginRes.json();
  if (!loginRes.ok) throw new Error(JSON.stringify(loginData));

  const token = loginData.accessToken;
  console.log('Usuario registrado. Token:', token.substring(0, 20) + '...');

  console.log('\n2. Creando Barbería...');
  const barbRes = await fetch(`${baseUrl}/barberias`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ nombre: 'Barbería de Prueba Horario', telefono: '1234567890', ubicacion: 'Test Ubicación' })
  });
  const barbData = await barbRes.json();
  if (!barbRes.ok) throw new Error(JSON.stringify(barbData));
  const barberiaId = barbData.id;
  console.log('Barbería creada:', barberiaId);

  console.log('\n3. Configurando Horario (con error intencional: inicio > fin)...');
  const horErrRes = await fetch(`${baseUrl}/barberias/${barberiaId}/horarios`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify([
      { diaSemana: 1, horaInicio: '18:00', horaFin: '09:00' }
    ])
  });
  console.log('Error esperado HTTP:', horErrRes.status);
  console.log(await horErrRes.json());

  console.log('\n4. Configurando Horarios válidos (Lunes a Viernes 09:00 - 18:00)...');
  const horarios = [1, 2, 3, 4, 5].map(dia => ({ diaSemana: dia, horaInicio: '09:00', horaFin: '18:00' }));
  const horRes = await fetch(`${baseUrl}/barberias/${barberiaId}/horarios`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify(horarios)
  });
  console.log(await horRes.json());

  console.log('\n5. Listando Horarios...');
  const getHorRes = await fetch(`${baseUrl}/barberias/${barberiaId}/horarios`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  console.log(await getHorRes.json());

  console.log('\n6. Agregando Excepción: CERRADA el fin de semana...');
  const excRes = await fetch(`${baseUrl}/barberias/${barberiaId}/horarios/excepciones`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({
      fecha: new Date().toISOString().split('T')[0],
      tipo: 'CERRADA',
      motivo: 'Día festivo nacional'
    })
  });
  console.log(await excRes.json());

  console.log('\n7. Listando Excepciones...');
  const getExcRes = await fetch(`${baseUrl}/barberias/${barberiaId}/horarios/excepciones`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  console.log(await getExcRes.json());
}

run().catch(console.error);
