import dotenv from 'dotenv';
dotenv.config();
import postgres from 'postgres';

async function resetDatabase() {
	const DATABASE_URL = process.env.DATABASE_URL;

	if (!DATABASE_URL) {
		console.error('DATABASE_URL is not set');
		process.exit(1);
	}

	const sql = postgres(DATABASE_URL);

	try {
		console.log('Dropping all tables in public schema...');

		// Drop all tables in the public schema
		await sql`DROP SCHEMA public CASCADE`;
		await sql`CREATE SCHEMA public`;

		// Restore default permissions
		await sql`GRANT ALL ON SCHEMA public TO public`;

		console.log('\n✅ All tables dropped! Run migrations to recreate the schema.');
	} catch (err) {
		console.error('Error resetting database:', err);
		process.exit(1);
	} finally {
		await sql.end();
	}
}

resetDatabase();
