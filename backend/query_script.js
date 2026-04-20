const { Client } = require('pg');

const client = new Client({
  user: 'postgres',
  password: '36b27c2d33aa50e9a56d',
  host: '195.35.40.49',
  port: 5432,
  database: 'tenryu'
});

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
      WITH _nome1 AS MATERIALIZED (
        SELECT cnpj_basico FROM rfb_empresas 
        WHERE immutable_unaccent(lower(razao_social)) ILIKE immutable_unaccent(lower('%importação%'))
        UNION
        SELECT cnpj_basico FROM rfb_estabelecimentos 
        WHERE cnpj_ordem = '0001' 
        AND immutable_unaccent(lower(nome_fantasia)) ILIKE immutable_unaccent(lower('%importação%'))
      ),
      _end1 AS MATERIALIZED (
        SELECT DISTINCT cnpj_basico FROM rfb_estabelecimentos
        WHERE cnpj_ordem = '0001'
        AND (immutable_unaccent(lower(logradouro)) ILIKE immutable_unaccent(lower('%bom retiro%'))
             OR immutable_unaccent(lower(bairro)) ILIKE immutable_unaccent(lower('%bom retiro%')))
      ),
      _inter AS MATERIALIZED (
        SELECT cnpj_basico FROM _nome1 INTERSECT SELECT cnpj_basico FROM _end1
      )
      SELECT COUNT(*) as cnt FROM _inter;
    `);
    console.log('Intersection (nome AND endereco):', intersection.rows[0].cnt);

    console.log('\nNote: The query returns ' + intersection.rows[0].cnt + ' NOT 161.');
    console.log('The reported 161 may have been before the full reimport,');
    console.log('or may have involved additional filters (UF, municipio, etc.).');

    await client.end();
  } catch (err) {
    console.error('Error:', err.message);
    await client.end();
    process.exit(1);
  }
}

run();
