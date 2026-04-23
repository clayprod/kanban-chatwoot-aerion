#!/usr/bin/env python3
"""
rfb_import.py — Download e importação dos dados abertos da Receita Federal
Executado automaticamente pelo backend Node.js. Progresso via JSON no stdout.

Env vars usadas:
  DATABASE_URL   = postgres://user:pass@host:5432/db
  RFB_DATA_PATH  = /data/rfb   (onde salvar os ZIPs; default: ../data/rfb)
  RFB_DEV_LIMIT  = 1            (0 = todos os arquivos, N = N por categoria)
"""

import os
import sys
import re
import csv
import json
import zipfile
import argparse
import requests
import psycopg2
import psycopg2.extras
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
from dotenv import load_dotenv

# ── Mapeamento UF numérico → sigla (código sequencial alfabético da RFB) ──────
UF_CODE_MAP = {
    '01': 'AC', '02': 'AL', '03': 'AP', '04': 'AM', '05': 'BA',
    '06': 'CE', '07': 'DF', '08': 'ES', '09': 'GO', '10': 'MA',
    '11': 'MT', '12': 'MS', '13': 'MG', '14': 'PA', '15': 'PB',
    '16': 'PR', '17': 'PE', '18': 'PI', '19': 'RJ', '20': 'RN',
    '21': 'RS', '22': 'RO', '23': 'RR', '24': 'SC', '25': 'SP',
    '26': 'SE', '27': 'TO',
}

def normalize_uf(val):
    if not val:
        return val
    v = val.strip()
    if v in UF_CODE_MAP:
        return UF_CODE_MAP[v]
    return v

# ── Config ────────────────────────────────────────────────────────────────────

load_dotenv(Path(__file__).parent.parent / '.env')

BASE_URL   = 'https://arquivos.receitafederal.gov.br/index.php/s/gn672Ad4CF8N6TK?dir=/Dados/Cadastros/CNPJ'
NEXTCLOUD  = 'https://arquivos.receitafederal.gov.br'
DATA_PATH  = Path(os.environ.get('RFB_DATA_PATH', str(Path(__file__).parent.parent / 'data' / 'rfb')))
CHUNK_SIZE = 50_000
WORKERS    = max(2, os.cpu_count() or 2)

# ── Progress output (parsado pelo Node.js) ────────────────────────────────────

def progress(status, message, file='', percent=0, records=0, error=''):
    print(json.dumps({
        'status': status,
        'message': message,
        'file': file,
        'percent': percent,
        'records': records,
        'error': error,
    }), flush=True)

# ── WebDAV helpers ────────────────────────────────────────────────────────────

def parse_token(url):
    m = re.search(r'/s/([^/?]+)', url)
    if not m:
        raise ValueError(f'Token não encontrado na URL: {url}')
    return m.group(1)


def webdav_list(token, path=''):
    url = f'{NEXTCLOUD}/public.php/webdav{path}'
    resp = requests.request('PROPFIND', url, auth=(token, ''),
                            headers={'Depth': '1'}, timeout=30)
    resp.raise_for_status()
    items = []
    for block in resp.text.split('<d:response>')[1:]:
        href  = re.search(r'<d:href>(.*?)</d:href>', block)
        ctype = re.search(r'<d:getcontenttype>(.*?)</d:getcontenttype>', block)
        size  = re.search(r'<d:getcontentlength>(.*?)</d:getcontentlength>', block)
        if href:
            items.append({
                'href':   href.group(1),
                'is_dir': not ctype,
                'size':   int(size.group(1)) if size else 0,
            })
    return items


def discover_files(token):
    progress('running', 'Descobrindo arquivos disponíveis na RF...')
    # The date folders are nested under /Dados/Cadastros/CNPJ/
    cnpj_path = '/Dados/Cadastros/CNPJ'
    try:
        cnpj_items = webdav_list(token, cnpj_path)
    except Exception:
        # Fallback: try root (old URL format)
        cnpj_items = webdav_list(token)
    dated = sorted(
        [i for i in cnpj_items if i['is_dir'] and re.search(r'\d{4}-\d{2}', i['href'])],
        key=lambda x: x['href'], reverse=True
    )
    if not dated:
        raise ValueError(f'Nenhuma pasta com data encontrada em {cnpj_path}')
    folder = '/' + dated[0]['href'].split('/public.php/webdav')[-1].strip('/')
    progress('running', f'Pasta mais recente: {folder.split("/")[-1]}')
    files = webdav_list(token, folder)
    zips = [f for f in files if not f['is_dir'] and f['href'].lower().endswith('.zip')]
    return zips


def remote_size(token, href):
    url = f'{NEXTCLOUD}/public.php/webdav{href.split("/public.php/webdav")[-1]}'
    try:
        r = requests.head(url, auth=(token, ''), timeout=15, allow_redirects=True)
        return int(r.headers.get('Content-Length', 0))
    except Exception:
        return 0


def download_file(token, href, dest):
    dav_path = href.split('/public.php/webdav')[-1]
    url      = f'{NEXTCLOUD}/public.php/webdav{dav_path}'
    filename = Path(dav_path).name
    local    = dest / filename

    remote_sz = remote_size(token, href)
    if local.exists() and local.stat().st_size == remote_sz and remote_sz > 0:
        progress('running', f'Já existe: {filename}', file=filename, percent=100)
        return local

    progress('running', f'Baixando {filename}...', file=filename, percent=0)
    downloaded = 0
    with requests.get(url, auth=(token, ''), stream=True, timeout=300) as r:
        r.raise_for_status()
        with open(local, 'wb') as f:
            for chunk in r.iter_content(chunk_size=1 << 20):
                f.write(chunk)
                downloaded += len(chunk)
                if remote_sz > 0:
                    pct = int(downloaded * 100 / remote_sz)
                    progress('running', f'Baixando {filename}', file=filename, percent=pct)
    progress('running', f'Download concluído: {filename}', file=filename, percent=100)
    return local

# ── File classification ───────────────────────────────────────────────────────

MULTI_CATS  = ['Empresas', 'Estabelecimentos', 'Socios']
SINGLE_CATS = ['Simples', 'Municipios', 'Cnaes', 'Naturezas', 'Qualificacoes', 'Paises', 'Motivos']

def classify(filename):
    name = Path(filename).stem
    for cat in MULTI_CATS + SINGLE_CATS:
        if name.lower().startswith(cat.lower()):
            return cat
    return 'outros'


def select_files(all_zips, dev_limit):
    from collections import defaultdict
    by_cat = defaultdict(list)
    for z in all_zips:
        by_cat[classify(Path(z['href']).name)].append(z)
    selected = []
    for cat, files in by_cat.items():
        files_sorted = sorted(files, key=lambda x: x['href'])
        if dev_limit > 0 and cat in MULTI_CATS:
            files_sorted = files_sorted[:dev_limit]
        selected.extend(files_sorted)
    return selected

# ── Table schema ──────────────────────────────────────────────────────────────

TABLE_COLUMNS = {
    'rfb_empresas': [
        'cnpj_basico', 'razao_social', 'natureza_juridica',
        'qualificacao_do_responsavel', 'capital_social',
        'porte_da_empresa', 'ente_federativo_responsavel',
    ],
    'rfb_estabelecimentos': [
        'cnpj_basico', 'cnpj_ordem', 'cnpj_dv',
        'identificador_matriz_filial', 'nome_fantasia',
        'situacao_cadastral', 'data_situacao_cadastral',
        'motivo_situacao_cadastral', 'nome_da_cidade_no_exterior',
        'pais', 'data_de_inicio_da_atividade',
        'cnae_fiscal_principal', 'cnae_fiscal_secundaria',
        'tipo_de_logradouro', 'logradouro', 'numero', 'complemento',
        'bairro', 'cep', 'uf', 'municipio',
        'ddd1', 'telefone1', 'ddd2', 'telefone2',
        'ddd_do_fax', 'fax', 'correio_eletronico',
        'situacao_especial', 'data_da_situacao_especial',
    ],
    'rfb_socios': [
        'cnpj_basico', 'identificador_de_socio', 'nome_do_socio',
        'cnpj_ou_cpf_do_socio', 'qualificacao_do_socio',
        'data_de_entrada_sociedade', 'pais', 'representante_legal',
        'nome_do_representante', 'qualificacao_do_representante_legal',
        'faixa_etaria',
    ],
    'rfb_simples': [
        'cnpj_basico', 'opcao_pelo_simples', 'data_opcao_simples',
        'data_exclusao_simples', 'opcao_pelo_mei',
        'data_opcao_mei', 'data_exclusao_mei',
    ],
    'rfb_municipios': ['codigo', 'descricao'],
    'rfb_cnaes':      ['codigo', 'descricao'],
    'rfb_natureza':   ['codigo', 'descricao'],
    'rfb_qualificacoes': ['codigo', 'descricao'],
    'rfb_paises':     ['codigo', 'descricao'],
    'rfb_motivos':    ['codigo', 'descricao'],
}

FILE_TABLE_MAP = {
    'empresas':         'rfb_empresas',
    'estabelecimentos': 'rfb_estabelecimentos',
    'socios':           'rfb_socios',
    'simples':          'rfb_simples',
    'municipios':       'rfb_municipios',
    'cnaes':            'rfb_cnaes',
    'naturezas':        'rfb_natureza',
    'qualificacoes':    'rfb_qualificacoes',
    'paises':           'rfb_paises',
    'motivos':          'rfb_motivos',
}

# ── Staging helpers ───────────────────────────────────────────────────────────

ALL_RFB_TABLES = list(FILE_TABLE_MAP.values())  # todas as tabelas gerenciadas

def create_staging_tables(conn):
    """Cria rfb_*_new copiando o schema das tabelas de produção."""
    progress('running', 'Criando tabelas staging (_new)...')
    with conn.cursor() as cur:
        for t in ALL_RFB_TABLES:
            cur.execute(f'DROP TABLE IF EXISTS {t}_new CASCADE')
            cur.execute(f'CREATE TABLE {t}_new (LIKE {t} INCLUDING DEFAULTS)')
    conn.commit()


def swap_staging_tables(conn, staged_tables):
    """Swap atômico: prod → _old, _new → prod, drop _old.
    staged_tables: conjunto de nomes de tabelas que foram importadas em _new.
    Tabelas não staged (não houve mudança de arquivo) ficam intocadas.
    """
    progress('running', 'Aplicando swap atômico das tabelas staging...')
    with conn.cursor() as cur:
        # Renomeia em uma única transação: prod→_old, new→prod
        for t in staged_tables:
            cur.execute(f'ALTER TABLE {t} RENAME TO {t}_old')
            cur.execute(f'ALTER TABLE {t}_new RENAME TO {t}')
        # Drop das tabelas _old (fora do bloco crítico mas ainda no mesmo commit)
        for t in staged_tables:
            cur.execute(f'DROP TABLE {t}_old CASCADE')
        # Limpa staging de tabelas que não foram usadas
        for t in ALL_RFB_TABLES:
            if t not in staged_tables:
                cur.execute(f'DROP TABLE IF EXISTS {t}_new CASCADE')
    conn.commit()
    progress('running', f'Swap concluído: {", ".join(staged_tables)}')


# ── Import ────────────────────────────────────────────────────────────────────

def import_csv(conn, csv_path, table):
    base_table = table.removesuffix('_new')  # rfb_empresas_new → rfb_empresas
    cols = TABLE_COLUMNS[base_table]
    n    = len(cols)
    sql  = f'INSERT INTO {table} ({",".join(cols)}) VALUES %s ON CONFLICT DO NOTHING'
    total = 0
    batch = []

    with open(csv_path, encoding='latin1', errors='replace', newline='') as f:
        reader = csv.reader(f, delimiter=';', quotechar='"')
        for row in reader:
            # Normaliza número de colunas
            while len(row) < n:
                row.append('')
            row = [v.strip() if v and v.strip() else None for v in row[:n]]
            # Normaliza UF numérico → sigla (ex: '08' → 'ES')
            if base_table == 'rfb_estabelecimentos':
                uf_idx = cols.index('uf') if 'uf' in cols else -1
                if uf_idx >= 0 and row[uf_idx]:
                    row[uf_idx] = normalize_uf(row[uf_idx])
            batch.append(row)
            if len(batch) >= CHUNK_SIZE:
                with conn.cursor() as cur:
                    psycopg2.extras.execute_values(cur, sql, batch)
                conn.commit()
                total += len(batch)
                batch = []
                progress('running', f'Importando {table}...', file=csv_path.name,
                         percent=0, records=total)

    if batch:
        with conn.cursor() as cur:
            psycopg2.extras.execute_values(cur, sql, batch)
        conn.commit()
        total += len(batch)

    return total


def create_indexes(conn, suffix=''):
    """Cria índices. suffix='' para produção, suffix='_new' para staging."""
    s = suffix  # alias curto
    progress('running', f'Criando índices{" (staging)" if s else ""}...')
    idxs = [
        f'CREATE UNIQUE INDEX IF NOT EXISTS idx_rfb_est_unique{s} ON rfb_estabelecimentos{s}(cnpj_basico, cnpj_ordem, cnpj_dv)',
        f'CREATE INDEX IF NOT EXISTS idx_rfb_est_basico{s}    ON rfb_estabelecimentos{s}(cnpj_basico)',
        f'CREATE INDEX IF NOT EXISTS idx_rfb_est_ordem{s}     ON rfb_estabelecimentos{s}(cnpj_ordem)',
        f'CREATE INDEX IF NOT EXISTS idx_rfb_est_uf{s}        ON rfb_estabelecimentos{s}(uf)',
        f'CREATE INDEX IF NOT EXISTS idx_rfb_est_municipio{s} ON rfb_estabelecimentos{s}(municipio)',
        f'CREATE INDEX IF NOT EXISTS idx_rfb_est_cnae{s}      ON rfb_estabelecimentos{s}(cnae_fiscal_principal)',
        f'CREATE INDEX IF NOT EXISTS idx_rfb_est_situacao{s}  ON rfb_estabelecimentos{s}(situacao_cadastral)',
        f'CREATE INDEX IF NOT EXISTS idx_rfb_est_porte{s}     ON rfb_empresas{s}(porte_da_empresa)',
        f'CREATE INDEX IF NOT EXISTS idx_rfb_socios_basico{s} ON rfb_socios{s}(cnpj_basico)',
        f'CREATE INDEX IF NOT EXISTS idx_rfb_emp_razao{s}     ON rfb_empresas{s}(razao_social text_pattern_ops)',
        f'CREATE INDEX IF NOT EXISTS idx_rfb_socios_nome{s}   ON rfb_socios{s}(nome_do_socio text_pattern_ops)',
    ]
    with conn.cursor() as cur:
        try:
            cur.execute('CREATE EXTENSION IF NOT EXISTS pg_trgm')
            cur.execute('CREATE EXTENSION IF NOT EXISTS unaccent')
            cur.execute("""
                CREATE OR REPLACE FUNCTION immutable_unaccent(text)
                RETURNS text LANGUAGE sql IMMUTABLE STRICT AS $$
                  SELECT public.unaccent($1);
                $$
            """)
            cur.execute(f'CREATE INDEX IF NOT EXISTS idx_rfb_emp_razao_trgm{s}      ON rfb_empresas{s} USING gin(immutable_unaccent(lower(razao_social)) gin_trgm_ops)')
            cur.execute(f'CREATE INDEX IF NOT EXISTS idx_rfb_socios_trgm{s}         ON rfb_socios{s} USING gin(immutable_unaccent(lower(nome_do_socio)) gin_trgm_ops)')
            cur.execute(f'CREATE INDEX IF NOT EXISTS idx_rfb_est_fantasia_trgm{s}   ON rfb_estabelecimentos{s} USING gin(immutable_unaccent(lower(nome_fantasia)) gin_trgm_ops)')
            cur.execute(f'CREATE INDEX IF NOT EXISTS idx_rfb_est_logradouro_trgm{s} ON rfb_estabelecimentos{s} USING gin(immutable_unaccent(lower(logradouro)) gin_trgm_ops)')
            cur.execute(f'CREATE INDEX IF NOT EXISTS idx_rfb_est_bairro_trgm{s}     ON rfb_estabelecimentos{s} USING gin(immutable_unaccent(lower(bairro)) gin_trgm_ops)')
        except Exception as ex:
            print(f'[warn] índices trigrama: {ex}')
            conn.rollback()
        for idx in idxs:
            try:
                cur.execute(idx)
            except Exception:
                conn.rollback()
    conn.commit()

# ── Main ──────────────────────────────────────────────────────────────────────

def load_imported_files(conn):
    """Retorna dict filename -> remote_size para arquivos já importados com sucesso."""
    try:
        with conn.cursor() as cur:
            cur.execute('SELECT filename, remote_size FROM rfb_arquivos')
            return {row[0]: row[1] for row in cur.fetchall()}
    except Exception:
        return {}


def record_imported_file(conn, filename, table, remote_size, records):
    """Registra ou atualiza um arquivo importado na tabela de controle."""
    with conn.cursor() as cur:
        cur.execute(
            '''INSERT INTO rfb_arquivos (filename, table_name, remote_size, records, imported_at)
               VALUES (%s, %s, %s, %s, NOW())
               ON CONFLICT (filename) DO UPDATE
               SET remote_size = EXCLUDED.remote_size,
                   records = EXCLUDED.records,
                   imported_at = NOW()''',
            (filename, table, remote_size, records)
        )
    conn.commit()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--skip-download', action='store_true')
    parser.add_argument('--limit', type=int, default=None)
    parser.add_argument('--force', action='store_true', help='Reimportar mesmo arquivos já importados')
    parser.add_argument('--staging', action='store_true',
                        help='Zero-downtime: importa em tabelas _new, cria índices, swap atômico. '
                             'App continua servindo as tabelas originais durante todo o processo.')
    parser.add_argument('--append', action='store_true',
                        help='Importa apenas arquivos faltantes (não em rfb_arquivos) direto nas '
                             'tabelas de produção sem truncar. Ideal para preencher gaps sem '
                             'reimportar tudo.')
    args = parser.parse_args()

    dev_limit = args.limit if args.limit is not None else int(os.environ.get('RFB_DEV_LIMIT', '0'))
    DATA_PATH.mkdir(parents=True, exist_ok=True)

    progress('running', f'Iniciando import (DEV_LIMIT={dev_limit})...')

    # ── Conectar ao banco cedo para verificar arquivos já importados ──────────
    db_url = os.environ.get('DATABASE_URL', '')
    if not db_url:
        progress('error', 'DATABASE_URL não encontrada', error='no_db_url')
        sys.exit(1)
    try:
        conn = psycopg2.connect(db_url)
    except Exception as e:
        progress('error', f'Falha ao conectar ao banco: {e}', error=str(e))
        sys.exit(1)

    already_imported = {} if args.force else load_imported_files(conn)
    if args.append and not args.force:
        progress('running', 'Modo append: importará apenas arquivos não presentes em rfb_arquivos')
    if already_imported:
        progress('running', f'{len(already_imported)} arquivo(s) já importados anteriormente — serão pulados se não mudaram')

    # ── Download ──────────────────────────────────────────────────────────────
    # Lista de (zip_path, remote_size) a importar
    to_import = []  # [(Path, int)]

    if not args.skip_download:
        try:
            token     = parse_token(BASE_URL)
            all_zips  = discover_files(token)
            selected  = select_files(all_zips, dev_limit)

            if not selected:
                progress('error', 'Nenhum arquivo encontrado no servidor da RF', error='no_files_found')
                sys.exit(1)

            # Separar em novos/alterados vs já importados (mesmo tamanho)
            to_download = []
            already_ok  = []  # [(filename, rsize)] já importados e inalterados
            for z in selected:
                filename = Path(z['href']).name
                rsize    = z.get('size', 0)
                if filename in already_imported and already_imported[filename] == rsize and rsize > 0:
                    already_ok.append(z)
                else:
                    to_download.append(z)

            # Se algum arquivo de uma categoria vai ser truncado+reimportado,
            # os demais arquivos dessa mesma categoria também precisam ser
            # baixados de novo — senão o TRUNCATE apaga os dados deles sem
            # repor.  Detectamos quais categorias têm arquivos novos e
            # adicionamos os "já ok" dessas categorias à fila de download.
            # Em modo --append não há truncate, então arquivos já importados
            # de uma mesma categoria ficam intocados.
            cats_with_new = {classify(Path(z['href']).name) for z in to_download}
            rescued = []
            if not args.append:
                for z in already_ok:
                    if classify(Path(z['href']).name) in cats_with_new:
                        to_download.append(z)
                        rescued.append(Path(z['href']).name)
                    # else: categoria intacta, pode ficar como está

            skipped = len(already_ok) - len(rescued)
            if skipped:
                progress('running', f'{skipped} arquivo(s) inalterados — pulando download e import')
            if rescued:
                progress('running', f'{len(rescued)} arquivo(s) adicionados de volta por truncate de categoria')
            progress('running', f'{len(to_download)} arquivo(s) para baixar')

            if not to_download:
                progress('done', 'Nenhuma atualização disponível — base já está atual!',
                         records=0, percent=100)
                conn.close()
                return

            def _dl(z):
                return download_file(token, z['href'], DATA_PATH), z.get('size', 0)

            with ThreadPoolExecutor(max_workers=max(1, min(WORKERS, len(to_download)))) as ex:
                futures = {ex.submit(_dl, z): z for z in to_download}
                for fut in as_completed(futures):
                    try:
                        local_path, rsize = fut.result()
                        to_import.append((local_path, rsize))
                    except Exception as e:
                        progress('running', f'Erro no download: {e}', error=str(e))
        except Exception as e:
            progress('error', f'Erro ao descobrir arquivos: {e}', error=str(e))
            sys.exit(1)
    else:
        # --skip-download: usar ZIPs já presentes em DATA_PATH
        for p in DATA_PATH.glob('*.zip'):
            to_import.append((p, p.stat().st_size))
        progress('running', f'{len(to_import)} arquivo(s) encontrados localmente')

    if not to_import:
        progress('error', 'Nenhum arquivo disponível para importar', error='no_files')
        sys.exit(1)

    # ── Staging ou Truncate ───────────────────────────────────────────────────
    cats_present  = set(classify(p.name).lower() for p, _ in to_import)
    tbls_affected = [FILE_TABLE_MAP[c] for c in cats_present if c in FILE_TABLE_MAP]

    if args.staging:
        # Zero-downtime: importa em _new, índices em _new, swap atômico no final.
        # O app continua servindo as tabelas originais durante todo o processo.
        progress('running', 'Modo staging ativado — app continua no ar durante import')
        create_staging_tables(conn)
        idx_suffix = '_new'
        # Resolve nome da tabela alvo: rfb_empresas → rfb_empresas_new
        def target_table(base): return base + '_new'
    elif args.append:
        # Gap-fill: insere apenas arquivos faltantes direto nas tabelas de produção.
        # ON CONFLICT DO NOTHING garante idempotência. Sem truncate.
        progress('running', 'Modo append — inserindo arquivos faltantes sem truncar tabelas')
        idx_suffix = ''
        def target_table(base): return base
    else:
        # Modo padrão: truncate + import direto nas tabelas de produção.
        if tbls_affected:
            progress('running', f'Limpando tabelas: {", ".join(tbls_affected)}')
            with conn.cursor() as cur:
                for t in tbls_affected:
                    cur.execute(f'TRUNCATE TABLE {t} CASCADE')
            conn.commit()
        idx_suffix = ''
        def target_table(base): return base

    totals = {}
    total_zips = len(to_import)
    for zip_idx, (zip_path, remote_size) in enumerate(to_import):
        cat   = classify(zip_path.name).lower()
        table = FILE_TABLE_MAP.get(cat)
        if not table:
            continue

        tgt = target_table(table)
        progress('running', f'Processando {zip_path.name}... ({zip_idx+1}/{total_zips})',
                 file=zip_path.name, percent=int((zip_idx / total_zips) * 100))
        zip_records = 0
        try:
            with zipfile.ZipFile(zip_path, 'r') as zf:
                for member in zf.namelist():
                    if member.endswith('/'):
                        continue
                    extracted_path = Path(zf.extract(member, DATA_PATH))
                    n = import_csv(conn, extracted_path, tgt)
                    zip_records += n
                    totals[table] = totals.get(table, 0) + n
                    progress('running', f'{tgt}: {n:,} linhas importadas de {member}',
                             file=member, records=totals[table])
                    try:
                        extracted_path.unlink()
                    except Exception:
                        pass

            record_imported_file(conn, zip_path.name, table, remote_size, zip_records)
            try:
                zip_path.unlink()
                progress('running', f'ZIP removido: {zip_path.name}')
            except Exception:
                pass

        except Exception as e:
            progress('error', f'Erro ao processar {zip_path.name}: {e}', error=str(e))
            try:
                conn.rollback()
            except Exception:
                pass

    create_indexes(conn, suffix=idx_suffix)

    if args.staging:
        swap_staging_tables(conn, set(tbls_affected))
    elif args.append:
        progress('running', 'Append concluído — índices atualizados nas tabelas de produção')

    conn.close()

    total_records = sum(totals.values())
    progress('done', 'Import concluído com sucesso!',
             records=total_records, percent=100)


if __name__ == '__main__':
    main()
