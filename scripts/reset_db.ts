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
		console.log('Truncating all tables...');

		// Truncate tables in correct order (child tables first)
		await sql`TRUNCATE TABLE bill_votes_result_member CASCADE`;
		console.log('✓ Truncated bill_votes_result_member');

		await sql`TRUNCATE TABLE bill_votes CASCADE`;
		console.log('✓ Truncated bill_votes');

		await sql`TRUNCATE TABLE bill_sponsors CASCADE`;
		console.log('✓ Truncated bill_sponsors');

		await sql`TRUNCATE TABLE committee_bill CASCADE`;
		console.log('✓ Truncated committee_bill');

		await sql`TRUNCATE TABLE bill_detail CASCADE`;
		console.log('✓ Truncated bill_detail');

		await sql`TRUNCATE TABLE bill CASCADE`;
		console.log('✓ Truncated bill');

		await sql`TRUNCATE TABLE committee CASCADE`;
		console.log('✓ Truncated committee');

		await sql`TRUNCATE TABLE member CASCADE`;
		console.log('✓ Truncated member');

		await sql`TRUNCATE TABLE cabinet CASCADE`;
		console.log('✓ Truncated cabinet');

		console.log('\n✅ Database reset complete!');
	} catch (err) {
		console.error('Error resetting database:', err);
		process.exit(1);
	} finally {
		await sql.end();
	}
}

resetDatabase();
