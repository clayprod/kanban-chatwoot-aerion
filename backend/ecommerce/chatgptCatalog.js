const crypto = require('node:crypto');
const { eligibleProducts } = require('./marketingDomain');
function chatgptCatalog(products) {
  const columns = ['item_id','title','description','url','brand','image_url','price','availability','seller_name','seller_url','return_policy','target_countries','store_country','is_eligible_search','is_eligible_checkout','is_ads_eligible','ads_metadata'];
  const assessed = eligibleProducts(products), valid = assessed.filter(p => p.eligible && p.brand);
  const cell = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const csv = [columns, ...valid.map(p => [p.sku,p.name.slice(0,150),p.description,p.url,p.brand,p.image,`${p.price.toFixed(2)} BRL`,p.availability === 'preorder' ? 'pre_order' : p.availability,'Aerion Technologies','https://loja.aerion.com.br','https://loja.aerion.com.br/trocas-devolucoes/','BR','BR','true','false','true',JSON.stringify({custom_label_0:p.group})])].map(row => row.map(cell).join(',')).join('\n') + '\n';
  return { csv, hash: crypto.createHash('sha256').update(csv).digest('hex'), count: valid.length, excluded: assessed.filter(p => !p.eligible || !p.brand).map(p => ({ sku:p.sku, issues:[...p.issues,...(!p.brand?['missing_brand']:[])] })) };
}
async function uploadCatalog({ credentials, content, previousHostHash, persistHostHash, Client = require('ssh2-sftp-client') }) {
  let uri;try { uri = new URL(credentials.connection_uri); } catch { throw new Error('sftp_connection_invalid'); }
  if (uri.protocol !== 'sftp:' || !/^sftp-[a-zA-Z0-9-]+\.commerce\.openai\.com$/.test(uri.hostname) || !uri.username || uri.password || !credentials.password || !['','22','443'].includes(uri.port)) throw new Error('sftp_connection_invalid');
  const client = new Client();let observed;
  try {
    await client.connect({ host:uri.hostname,port:Number(uri.port||22),username:decodeURIComponent(uri.username),password:credentials.password,readyTimeout:30000,hostHash:'sha256',hostVerifier:hash=>{observed=hash;return !previousHostHash || previousHostHash===hash;} });
    // Trust on first use is anchored to the URI returned over authenticated HTTPS.
    // Persist the host key before sending any product data and reject later changes.
    if (!previousHostHash) await persistHostHash(observed);
    await client.put(Buffer.from(content,'utf8'),'catalog.csv');
    return { uploaded:true,hostKeyVerified:true };
  } catch { throw new Error('sftp_upload_failed'); } finally { await client.end().catch(()=>{}); }
}
module.exports = { chatgptCatalog, uploadCatalog };
