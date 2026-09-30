const { execSync } = require('child_process');

let attempts = 0;
const maxAttempts = 10;

while (attempts < maxAttempts) {
  console.log(`Attempt ${attempts + 1} to push DB...`);
  try {
    execSync('npx prisma db push', { stdio: 'inherit', cwd: './backend-barberias' });
    console.log('Push successful!');
    execSync('npx prisma generate', { stdio: 'inherit', cwd: './backend-barberias' });
    process.exit(0);
  } catch (error) {
    console.log('Failed, waiting 5 seconds...');
    attempts++;
    execSync('node -e "setTimeout(()=>{}, 5000)"'); // Wait 5 seconds
  }
}

console.log('Failed after 10 attempts');
process.exit(1);
