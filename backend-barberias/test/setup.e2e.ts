export function assertSafeTestDatabase() {
  if (process.env.APP_ENV !== 'dev') {
    console.error(`TEST ABORTED: APP_ENV is set to '${process.env.APP_ENV}'. E2E/Integration tests must only run in 'dev' environment to prevent data loss in staging/production.`);
    process.exit(1);
  }
}

assertSafeTestDatabase();
