const testLogin = async (email, password) => {
  const res = await fetch('https://barberias-platform-2415e622g-developerstem.vercel.app/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ correo: email, password })
  });
  const data = await res.json();
  console.log(`Login ${email}:`);
  console.log(' - user roles:', data.usuario?.roles);
};

async function run() {
  await testLogin('admin@demo.com', 'Password123!');
  await testLogin('barbero@demo.com', 'Password123!');
  await testLogin('cliente@demo.com', 'Password123!');
}
run();
