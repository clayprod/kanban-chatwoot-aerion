/**
 * One-off RFB search diagnostics. Credentials must come from the environment:
 *   DATABASE_URL=postgres://user:pass@host:5432/db
 * or PGHOST / PGPORT / PGUSER / PGPASSWORD / PGDATABASE.
 */
const { Client } = require('pg');

const client = process.env.DATABASE_URL
  ? new Client({ connectionString: process.env.DATABASE_URL })
  : new Client({
      user: process.env.PGUSER || 'postgres',
      password: process.env.PGPASSWORD || '',
      host: process.env.PGHOST || '127.0.0.1',
      port: Number.parseInt(process.env.PGPORT || '5432', 10) || 5432,
      database: process.env.PGDATABASE || 'tenryu',
    });

if (!process.env.DATABASE_URL && !process.env.PGPASSWORD) {
  console.error('Set DATABASE_URL or PGPASSWORD (and related PG* vars) before running this script.');
  process.exit(1);
}

async function run() {
  try {
    await client.connect();
    
    console.log('\n=== ISSUE 1: SEARCH INTERSECTION MATH ===');
    
    // Get exact numbers
    const nomeEstab = await client.query(`
      SELECT COUNT(*) as cnt FROM rfb_estabelecimentos 
      WHERE cnpj_ordem = '0001'
      AND immutable_unaccent(lower(nome_fantasia)) ILIKE immutable_unaccent(lower('%importação%'))
    `);
    console.log('Estabelecimentos with importacao in nome_fantasia:', nomeEstab.rows[0].cnt);

    const nomeEmpresas = await client.query(`
      SELECT COUNT(*) as cnt FROM rfb_empresas 
      WHERE immutable_unaccent(lower(razao_social)) ILIKE immutable_unaccent(lower('%importação%'))
    `);
    console.log('Empresas with importacao in razao_social:', nomeEmpresas.rows[0].cnt);

    const endereco = await client.query(`
      SELECT COUNT(DISTINCT cnpj_basico) as cnt FROM rfb_estabelecimentos
      WHERE cnpj_ordem = '0001'
      AND (immutable_unaccent(lower(logradouro)) ILIKE immutable_unaccent(lower('%bom retiro%'))
           OR immutable_unaccent(lower(bairro)) ILIKE immutable_unaccent(lower('%bom retiro%')))
    `);
    console.log('Estabelecimentos with bom retiro in address:', endereco.rows[0].cnt);

    // Now test the intersection (should work with CTE)
    const intersection = await client.query(`
      WITH nome_match AS (
        SELECT DISTINCT e.cnpj_basico
        FROM rfb_estabelecimentos e
        LEFT JOIN rfb_empresas emp ON emp.cnpj_basico = e.cnpj_basico
        WHERE e.cnpj_ordem = '0001'
          AND (
            immutable_unaccent(lower(e.nome_fantasia)) ILIKE immutable_unaccent(lower('%importação%'))
            OR immutable_unaccent(lower(emp.razao_social)) ILIKE immutable_unaccent(lower('%importação%'))
          )
      ),
      end_match AS (
        SELECT DISTINCT cnpj_basico
        FROM rfb_estabelecimentos
        WHERE cnpj_ordem = '0001'
          AND (
            immutable_unaccent(lower(logradouro)) ILIKE immutable_unaccent(lower('%bom retiro%'))
            OR immutable_unaccent(lower(bairro)) ILIKE immutable_unaccent(lower('%bom retiro%'))
          )
      )
      SELECT COUNT(*) as cnt
      FROM nome_match n
      INNER JOIN end_match e ON e.cnpj_basico = n.cnpj_basico
    `);
    console.log('Intersection (nome AND endereco):', intersection.rows[0].cnt);

  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await client.end();
  }
}

run();
