<?php
/**
 * Institutional product stories and the separate WooCommerce storefront.
 *
 * @package AerionBlocks
 */

declare(strict_types=1);

if (! defined('ABSPATH')) {
    exit;
}

function aerion_blocks_source_asset(string $path): string
{
    return aerion_blocks_theme_asset('source-images/' . ltrim($path, '/'));
}

/** @return array<string,array<string,mixed>> */
function aerion_blocks_product_stories(): array
{
    return [
        'evo-max-v2' => [
            'tagline' => 'Precisão e potência em um só drone',
            'category' => 'Drone profissional',
            'gallery' => ['products/evo_max/4t/1.png', 'products/evo_max/4t/2.jpg', 'products/evo_max/4t/4.jpg', 'products/evo_max/4n/1.png'],
            'hero' => ['Sem pontos cegos', 'Evitação de obstáculos de última geração com cobertura omnidirecional de 720°, visão binocular e radar de ondas milimétricas.', 'destaques/evo-max/obstacle-avoidance.avif'],
            'stories' => [
                ['Anti-interferência superior', 'Módulos avançados de controle e algoritmos identificam interferências nos sinais de controle e posicionamento, mantendo a missão estável perto de linhas de energia e estruturas críticas.', 'destaques/evo-max/vision-enhanced.png'],
                ['Fusion 4T V2 — desafie o calor', 'Câmera térmica 640×512, zoom óptico contínuo 10x, zoom híbrido até 160x e telêmetro a laser para inspeções e operações críticas.', 'destaques/evo-max/camera-evo-max-4t.jpeg'],
                ['Fusion 4N V2 — domine a noite', 'Câmera Starlight de alta sensibilidade, câmera térmica e grande angular 4K para observação clara e discreta mesmo no escuro.', 'destaques/evo-max/camera-evo-max-4n.jpeg'],
                ['Autel SkyLink 3.0', 'Transmissão de imagem a até 15 km, vídeo 1080p em tempo real, redundância multibanda e baixa latência.', 'destaques/evo-max/skylink-bg.jpg'],
                ['Missões automatizadas', 'Crie missões poligonais, por pontos e rotas automáticas a partir de limites ou arquivos KML.', 'destaques/evo-max/mission-auto.webp'],
                ['Funções inteligentes', 'Reconhecimento e rastreamento de alvos por IA, reconstrução de cena e planejamento inteligente de missão.', 'destaques/evo-max/smart-functions.webp'],
                ['Operação remota', 'Integração com o EVO Nest para decolagem, pouso, recarga e missões remotas contínuas.', 'destaques/evo-max/remote-operations.webp'],
                ['Ecossistema aberto', 'Mobile SDK, Payload SDK e integração com plataformas de terceiros para adaptar a aeronave à sua operação.', 'destaques/evo-max/autel-sdk.png'],
            ],
            'stats' => [['15 km', 'Transmissão'], ['42 min', 'Voo máximo'], ['IP43', 'Proteção'], ['720°', 'Detecção de obstáculos']],
            'applications' => [
                ['Segurança pública', 'lifestyle/public-safety-3-max.jpg'],
                ['Inspeção industrial', 'lifestyle/oil-and-gas-1.jpg'],
                ['Construção civil', 'lifestyle/construction-2.jpg'],
                ['Resgate e emergências', 'lifestyle/rescue-2.jpg'],
            ],
        ],
        'evo-lite-enterprise' => [
            'tagline' => 'Compacto, portátil e eficiente',
            'category' => 'Drone enterprise compacto',
            'gallery' => ['products/evo_lite/640t/1.png', 'products/evo_lite/640t/2.png', 'products/evo_lite/6k/1.png', 'products/evo_lite/6k/2.png'],
            'hero' => ['Duas configurações para cada missão', 'Escolha a câmera térmica 640T para inspeções e segurança ou a câmera 6K com sensor de 1 polegada para captura detalhada.', 'destaques/evo-lite/camera-640t.webp'],
            'stories' => [
                ['Câmera 6K de alta definição', 'Sensor CMOS de 1 polegada e 20 MP para imagens detalhadas, fotogrametria e documentação profissional.', 'destaques/evo-lite/camera-6k.webp'],
                ['Reconhecimento de alvos por IA', 'Identificação e rastreamento automáticos de pessoas, veículos e fontes de calor.', 'destaques/evo-lite/ai-target.webp'],
                ['Autel SkyLink', 'Transmissão estável em longa distância para dar consciência situacional à equipe em campo.', 'destaques/evo-lite/skylink.jpg'],
                ['Operação simples em campo', 'Mapas offline, tela dividida e barra de ferramentas configurável aceleram missões recorrentes.', 'destaques/evo-lite/offline-maps.webp'],
                ['Kit pronto para trabalhar', 'Controle remoto, carregamento múltiplo e acessórios organizados para uma operação móvel.', 'destaques/evo-lite/remote-controller.png'],
            ],
            'stats' => [['40 min', 'Voo máximo'], ['12 km', 'Transmissão FCC'], ['24 km', 'Distância de voo'], ['640×512', 'Resolução térmica']],
            'applications' => [['Segurança pública', 'lifestyle/public-safety-1-alpha.jpg'], ['Inspeção industrial', 'lifestyle/oil-and-gas-1.jpg'], ['Construção civil', 'lifestyle/construction-1.jpeg'], ['Resgate', 'lifestyle/rescue-2.jpg']],
        ],
        'autel-alpha' => [
            'tagline' => 'Resistência e alcance para operações críticas',
            'category' => 'Plataforma industrial',
            'gallery' => ['products/alpha/1.png', 'products/alpha/2.png', 'products/alpha/3.png', 'products/alpha/4.png'],
            'hero' => ['Potência industrial sem concessões', 'Plataforma IP55 com sensores omnidirecionais, radar, baterias hot swap e alcance projetado para operações complexas.', 'destaques/alpha/s616338283273788564_p204_i51_w5768.webp'],
            'stories' => [
                ['Gimbal DG-L35T', 'Sistema quíntuplo com câmeras térmicas, grande angular, zoom óptico 35x e telêmetro laser de até 2.000 metros.', 'destaques/alpha/l35t.webp'],
                ['Consciência situacional de 360°', 'O Autonomy Engine combina visão e radar para navegação segura em ambientes industriais e infraestrutura crítica.', 'products/alpha/5.png'],
                ['Operação contínua', 'Baterias hot swap e construção robusta reduzem interrupções durante missões longas.', 'products/alpha/6.png'],
                ['Controle de alta luminosidade', 'Smart Controller V3 com tela de 7,9 polegadas e 2.000 nits para uso profissional sob luz intensa.', 'products/alpha/8.png'],
            ],
            'stats' => [['30 km', 'Alcance de voo'], ['40 min', 'Voo máximo'], ['IP55', 'Proteção'], ['2.000 m', 'Telêmetro laser']],
            'applications' => [['Segurança pública', 'lifestyle/public-safety-1-alpha.jpg'], ['Inspeção industrial', 'lifestyle/oil-and-gas-1.jpg'], ['Resgate', 'lifestyle/rescue-2.jpg'], ['Construção', 'lifestyle/construction-3.jpg']],
        ],
        'evo-nest' => [
            'tagline' => 'Operações autônomas, a qualquer hora',
            'category' => 'Dock autônomo',
            'gallery' => ['products/evo_nest/product-main.webp', 'products/evo_nest/autonomous-system.webp', 'products/evo_nest/all-weather.webp', 'products/evo_nest/remote-operations.webp'],
            'hero' => ['Automatize missões recorrentes', 'Decolagem, pouso, recarga e planejamento de missões em uma estação compacta preparada para operação remota.', 'products/evo_nest/banner.webp'],
            'stories' => [
                ['Sistema autônomo integrado', 'Gerencie aeronaves, rotas e dados a partir do Autel Integrated Command System.', 'products/evo_nest/autonomous-system.webp'],
                ['Pronto para qualquer clima', 'Proteção IP55 e controle térmico para operar em ambientes externos e temperaturas desafiadoras.', 'products/evo_nest/all-weather.webp'],
                ['Recarga rápida', 'Leva a bateria de 10% a 90% em aproximadamente 25 minutos.', 'products/evo_nest/fast-charge.webp'],
                ['Gestão pela nuvem', 'Supervisão remota de ativos, missões e resultados com centralização operacional.', 'products/evo_nest/cloud-management.webp'],
                ['Transportável por duas pessoas', 'Design compacto de 59 kg que facilita reposicionamento e implantação.', 'products/evo_nest/transportable.webp'],
            ],
            'stats' => [['25 min', 'Recarga 10–90%'], ['IP55', 'Proteção'], ['59 kg', 'Peso'], ['-30 a 50°C', 'Operação']],
            'applications' => [['Segurança pública', 'lifestyle/public-safety-1-alpha.jpg'], ['Infraestrutura', 'lifestyle/oil-and-gas-1.jpg']],
        ],
        'autel-mapper' => [
            'tagline' => 'Mapeamento profissional com deep learning',
            'category' => 'Software de processamento',
            'gallery' => ['products/mapper/autel-mapper.png', 'products/mapper/triangulacao.gif'],
            'hero' => ['Do voo ao modelo em um fluxo contínuo', 'Reconstrução 2D e 3D com processamento local ou em nuvem para topografia, inspeção e engenharia.', 'products/mapper/triangulacao.gif'],
            'stories' => [
                ['Reconstrução precisa', 'Algoritmos de deep learning produzem ortofotos, nuvens de pontos e modelos 3D de alta qualidade.', 'products/mapper/autel-mapper.png'],
                ['Processamento flexível', 'Escolha processamento local para controle de dados ou nuvem para escalar equipes e projetos.', 'lifestyle/construction-4.jpg'],
                ['Integração operacional', 'Compatibilidade com dados Autel e formatos amplamente utilizados em GIS, CAD e BIM.', 'lifestyle/construction-1.jpeg'],
            ],
            'stats' => [['2D + 3D', 'Reconstrução'], ['1:500', 'Mapeamento'], ['Local', 'Processamento'], ['Nuvem', 'Escalabilidade']],
            'applications' => [['Topografia', 'lifestyle/construction-1.jpeg'], ['Engenharia', 'lifestyle/construction-3.jpg'], ['Inspeções', 'lifestyle/oil-and-gas-1.jpg']],
        ],
        'hubsan-mini-7' => [
            'tagline' => 'Leve na mochila. Grande na imagem.',
            'category' => 'Drone para criação de conteúdo',
            'highlightsLead' => 'Recursos pensados para ampliar sua linguagem visual, simplificar a produção e dar mais confiança a cada voo.',
            'technicalLead' => 'Dados da aeronave, câmera, gimbal, transmissão, sensores, bateria e controle HT55.',
            'cta' => [
                'Pronto para enxergar o mundo de outro ângulo?',
                'Garanta o seu na Loja Aerion ou converse com nossa equipe para tirar dúvidas sobre o HUBSAN Mini 7.',
            ],
            'compliance' => [
                'status' => 'Homologado no Brasil',
                'title' => 'Homologado pela Anatel.',
                'text' => 'O HUBSAN Mini 7 é homologado pela Anatel e está em conformidade com as normas brasileiras de radiofrequência. Voe com a tranquilidade de um equipamento regularizado, com procedência oficial Aerion.',
                'logo' => 'brands/anatel-logo.svg',
            ],
            'gallery' => [
                'products/hubsan-mini-7/mini-7-front-three-quarter.webp',
                'products/hubsan-mini-7/mini-7-folded.webp',
                'products/hubsan-mini-7/mini-7-controller-unfolded.webp',
                'products/hubsan-mini-7/mini-7-in-flight.webp',
            ],
            'hero' => [
                'O melhor ângulo pode estar logo acima.',
                'De uma viagem simples a uma produção planejada, o Mini 7 abre o enquadramento para transformar lugares, pessoas e movimento em conteúdo com mais presença.',
                'products/hubsan-mini-7/mini-7-lifestyle-horizonte.jpeg',
            ],
            'stories' => [
                [
                    'Mais atmosfera em cada frame.',
                    'A câmera de 1 polegada registra luz, cor e profundidade com presença. Do azul do fim de tarde às luzes da cidade, suas histórias ganham uma imagem feita para prender o olhar.',
                    'products/hubsan-mini-7/hubsan-mini-7-aplus-image-quality-v2.jpeg',
                ],
                [
                    'Conteúdo que já nasce no formato certo.',
                    'Capture na vertical, crie órbitas, panoramas e hyperlapses e transforme uma mesma viagem em diferentes narrativas. Mais possibilidades para reels, campanhas, filmes e tudo o que vier depois.',
                    'products/hubsan-mini-7/hubsan-mini-7-aplus-content-creation-v2.jpeg',
                ],
                [
                    'Mais confiança para criar perto da ação.',
                    'O sensoriamento visual dianteiro, traseiro e inferior amplia a percepção do espaço ao redor. Você se concentra no enquadramento com mais apoio para conduzir movimentos e composições.',
                    'products/hubsan-mini-7/hubsan-mini-7-aplus-spatial-awareness-v2.jpeg',
                ],
                [
                    'Movimentos que parecem cinema.',
                    'O gimbal mecânico de três eixos mantém a câmera estável enquanto o drone acompanha curvas, pessoas e ação. O resultado é uma imagem mais fluida, natural e envolvente.',
                    'products/hubsan-mini-7/hubsan-mini-7-aplus-stabilization-v2.jpeg',
                ],
                [
                    'O vento muda. Seu plano continua.',
                    'A resistência a ventos de nível 5, entre 8,5 e 10,5 m/s, ajuda o Mini 7 a manter estabilidade em praias, mirantes e outros cenários abertos.',
                    'products/hubsan-mini-7/hubsan-mini-7-aplus-wind-resistance-v4.jpeg',
                ],
                [
                    'Vá mais longe com a cena.',
                    'O SyncLeas 5.0 mantém a transmissão de imagem a até 16 km, abrindo espaço para explorar paisagens amplas e construir tomadas com mais profundidade.',
                    'products/hubsan-mini-7/hubsan-mini-7-aplus-transmission-range-v5.jpeg',
                ],
                [
                    'Controle total sem depender do celular.',
                    'O HT55 reúne tela Full HD de 5,5 polegadas, brilho de 2.000 nits e autonomia de até 6 horas. Menos preparação entre encontrar a cena e apertar REC.',
                    'products/hubsan-mini-7/hubsan-mini-7-aplus-controller-v4.jpeg',
                ],
            ],
            'stats' => [],
            'applications' => [],
        ],
    ];
}

function aerion_blocks_product_by_slug(string $slug): ?WC_Product
{
    if (! function_exists('wc_get_product')) {
        return null;
    }
    $post = get_page_by_path($slug, OBJECT, 'product');
    $product = $post ? wc_get_product((int) $post->ID) : null;
    if (! $product instanceof WC_Product) {
        $institutionalSkus = [
            'evo-lite-enterprise' => '102002996',
            'evo-max-v2' => '102003505',
            'autel-alpha' => '901030260',
            'autel-mapper' => '901030202',
        ];
        $productId = isset($institutionalSkus[$slug]) ? wc_get_product_id_by_sku($institutionalSkus[$slug]) : 0;
        $product = $productId ? wc_get_product($productId) : null;
    }
    return $product instanceof WC_Product ? $product : null;
}

function aerion_blocks_decode_product_meta(int $productId, string $key): array
{
    $value = get_post_meta($productId, $key, true);
    if (is_string($value)) {
        $decoded = json_decode($value, true);
        if (! is_array($decoded)) {
            $decoded = json_decode(wp_unslash($value), true);
        }
        return is_array($decoded) ? $decoded : [];
    }
    return is_array($value) ? $value : [];
}

function aerion_render_institutional_product_block(array $attributes): string
{
    $slug = sanitize_title((string) ($attributes['product'] ?? get_post_field('post_name')));
    $stories = aerion_blocks_product_stories();
    $story = $stories[$slug] ?? null;
    $product = aerion_blocks_product_by_slug($slug);
    if (! $story || ! $product) {
        return '<div class="aerion-container aerion-editor-placeholder"><p>Selecione um produto publicado.</p></div>';
    }

    $features = aerion_blocks_decode_product_meta($product->get_id(), '_aerion_key_features');
    $technical = aerion_blocks_decode_product_meta($product->get_id(), '_aerion_technical_data');
    // Família com várias opções na loja: cai na busca com o nome já preenchido.
    $buyUrl = add_query_arg(['s' => rawurlencode($product->get_name()), 'post_type' => 'product'], home_url('/loja/'));
    ob_start();
    ?>
    <article <?php echo get_block_wrapper_attributes(['class' => 'aerion-institutional-product aerion-institutional-product--' . $slug]); ?>>
        <div class="aerion-container aerion-breadcrumbs aerion-product-breadcrumbs"><a href="<?php echo esc_url(home_url('/')); ?>">Home</a><span>/</span><a href="<?php echo esc_url(home_url('/produtos/')); ?>">Produtos</a><span>/</span><span><?php echo esc_html($product->get_name()); ?></span></div>
        <nav class="aerion-product-sticky-nav" data-aerion-product-nav aria-label="Navegação da página do produto"><div class="aerion-container"><a href="#descricao">Descrição do produto</a><a href="#destaques">Destaques</a><a href="#dados-tecnicos">Dados técnicos</a><a href="#acessorios">Acessórios</a><a href="#aplicacoes">Aplicações</a></div></nav>
        <section class="aerion-product-intro" id="descricao"><div class="aerion-container aerion-product-intro__grid">
            <div class="aerion-product-gallery" data-aerion-gallery>
                <div class="aerion-product-gallery__thumbs"><?php foreach ($story['gallery'] as $index => $image) : ?><button type="button" class="<?php echo $index === 0 ? 'is-active' : ''; ?>" data-aerion-gallery-src="<?php echo esc_url(aerion_blocks_source_asset($image)); ?>" aria-label="Ver imagem <?php echo esc_attr((string) ($index + 1)); ?>"><img src="<?php echo esc_url(aerion_blocks_source_asset($image)); ?>" alt=""></button><?php endforeach; ?></div>
                <div class="aerion-product-gallery__main"><img src="<?php echo esc_url(aerion_blocks_source_asset($story['gallery'][0])); ?>" alt="<?php echo esc_attr($product->get_name()); ?>" data-aerion-gallery-main></div>
            </div>
            <div class="aerion-product-intro__copy"><span class="aerion-segment-badge"><?php echo esc_html($story['category']); ?></span><h1><?php echo esc_html($product->get_name()); ?></h1><p class="aerion-product-intro__tagline"><?php echo esc_html($story['tagline']); ?></p><p><?php echo esc_html(wp_strip_all_tags($product->get_short_description())); ?></p>
                <?php if ($features) : ?><ul><?php foreach (array_slice($features, 0, 6) as $feature) : ?><li><?php echo aerion_blocks_icon('check'); ?><span><?php echo esc_html((string) $feature); ?></span></li><?php endforeach; ?></ul><?php endif; ?>
                <div class="aerion-actions"><a class="aerion-button" href="<?php echo esc_url($buyUrl); ?>">Compre agora</a><a class="aerion-button aerion-button--outline" href="<?php echo esc_url(home_url('/contato/')); ?>">Falar com um especialista</a></div>
            </div>
        </div></section>
        <section class="aerion-product-highlights" id="destaques"><div class="aerion-container">
            <header class="aerion-section-heading"><h2>Destaques</h2><p>Tecnologia projetada para transformar operações complexas em resultados confiáveis.</p></header>
            <article class="aerion-product-feature-hero" style="--aerion-feature-image:url('<?php echo esc_url(aerion_blocks_source_asset($story['hero'][2])); ?>')"><div><h3><?php echo esc_html($story['hero'][0]); ?></h3><p><?php echo esc_html($story['hero'][1]); ?></p></div></article>
            <div class="aerion-product-story-list"><?php foreach ($story['stories'] as $index => [$title, $text, $image]) : ?><article class="aerion-product-story <?php echo $index % 2 ? 'is-reversed' : ''; ?>"><div class="aerion-product-story__media"><img src="<?php echo esc_url(aerion_blocks_source_asset($image)); ?>" alt="<?php echo esc_attr($title); ?>" loading="lazy"></div><div><span>0<?php echo esc_html((string) ($index + 1)); ?></span><h3><?php echo esc_html($title); ?></h3><p><?php echo esc_html($text); ?></p></div></article><?php endforeach; ?></div>
            <?php echo aerion_render_product_extras($slug); ?>
            <div class="aerion-product-stats"><?php foreach ($story['stats'] as [$value, $label]) : ?><div><strong><?php echo esc_html($value); ?></strong><span><?php echo esc_html($label); ?></span></div><?php endforeach; ?></div>
        </div></section>
        <section class="aerion-product-technical" id="dados-tecnicos"><div class="aerion-container"><header class="aerion-section-heading"><h2>Especificações</h2><p>Dados técnicos organizados em menus expansíveis para consulta rápida.</p></header>
            <div class="aerion-product-accordions"><?php foreach ($technical as $group => $values) : ?><?php if (is_array($values) && $values) : ?><details><summary><?php echo esc_html((string) $group); ?><span aria-hidden="true">+</span></summary><dl><?php foreach ($values as $label => $value) : ?><div><dt><?php echo esc_html((string) $label); ?></dt><dd><?php echo esc_html(is_scalar($value) ? (string) $value : wp_json_encode($value, JSON_UNESCAPED_UNICODE)); ?></dd></div><?php endforeach; ?></dl></details><?php endif; ?><?php endforeach; ?></div>
            <div class="aerion-product-accessories" id="acessorios"><h2>Acessórios e suporte</h2><p>Consulte a Aerion para definir a configuração, os acessórios, o treinamento e o suporte adequados à sua operação.</p><a class="aerion-button aerion-button--outline" href="<?php echo esc_url(home_url('/contato/')); ?>">Montar minha configuração</a></div>
        </div></section>
        <section class="aerion-product-applications" id="aplicacoes"><div class="aerion-container"><header class="aerion-section-heading"><h2>Aplicações</h2><p>Uma plataforma preparada para diferentes cenários profissionais.</p></header><div class="aerion-product-applications__grid"><?php foreach ($story['applications'] as [$title, $image]) : ?><a href="<?php echo esc_url(home_url('/solucoes/')); ?>"><img src="<?php echo esc_url(aerion_blocks_source_asset($image)); ?>" alt="<?php echo esc_attr($title); ?>" loading="lazy"><span><?php echo esc_html($title); ?></span></a><?php endforeach; ?></div></div></section>
        <section class="aerion-solution-detail__cta"><div class="aerion-container"><h2>Leve o <?php echo esc_html($product->get_name()); ?> para sua operação</h2><p>Converse com a equipe técnica ou acesse a loja para consultar as condições comerciais.</p><div class="aerion-actions"><a class="aerion-button" href="<?php echo esc_url($buyUrl); ?>">Ir para a loja</a><a class="aerion-button aerion-button--glass" href="<?php echo esc_url(home_url('/contato/')); ?>">Solicitar orçamento</a></div></div></section>
    </article>
    <?php
    return (string) ob_get_clean();
}

function aerion_render_storefront_block_legacy(array $attributes): string
{
    if (! function_exists('wc_get_products')) {
        return '';
    }
    $productQuery = ['status' => 'publish', 'limit' => 12, 'orderby' => 'menu_order', 'order' => 'ASC'];
    $queriedCategory = null;
    if (function_exists('is_product_category') && is_product_category()) {
        $queriedObject = get_queried_object();
        if ($queriedObject instanceof WP_Term) {
            $queriedCategory = $queriedObject;
            $productQuery['category'] = [$queriedCategory->slug];
        }
    } elseif (is_tax('aerion_family')) {
        $queriedObject = get_queried_object();
        if ($queriedObject instanceof WP_Term) {
            $queriedCategory = $queriedObject;
            $productQuery['include'] = get_objects_in_term($queriedObject->term_id, 'aerion_family');
        }
    }
    $typeFilter=sanitize_title(wp_unslash($_GET['tipo']??''));
    if($typeFilter==='drones'){
        $productQuery['category']=['drones','kits'];
    }elseif(in_array($typeFilter,['acessorios','softwares'],true)){
        $productQuery['category']=[$typeFilter];
    }

    $products = wc_get_products($productQuery);
    $campaigns = class_exists('Aerion_Campaigns') ? Aerion_Campaigns::featured() : [];
    $categories = [
        ['Drones', 'Plataformas e kits Autel prontos, organizados por família e configuração.', 'products/evo_max/4t/1.png', 'drones'],
        ['Acessórios', 'Baterias, câmeras, módulos e carregadores por família.', 'products/evo_max/4n/1.png', 'acessorios'],
        ['Softwares', 'Transforme imagens e telemetria em mapas e decisões.', 'products/mapper/autel-mapper.png', 'softwares'],
    ];
    $evergreenSlides = [
        ['Loja oficial Autel', 'Kits Autel prontos para operar', 'Escolha a plataforma, a câmera e a autonomia ideais com suporte especializado no Brasil.', 'Ver drones e kits', home_url('/loja/?tipo=drones'), 'products/evo_max/4t/1.png'],
        ['Compatibilidade sem erro', 'Acessórios por família de drone', 'Baterias, câmeras, módulos e spare parts avulsos organizados para você comprar com segurança.', 'Explorar acessórios', home_url('/loja/?tipo=acessorios'), 'products/evo_lite/640t/1.png'],
        ['Software profissional', 'Autel Mapper para transformar dados em mapas', 'Licenças oficiais para processamento de imagens, reconstrução 2D e modelagem 3D.', 'Conhecer o Autel Mapper', home_url('/loja/?tipo=softwares'), 'products/mapper/autel-mapper.png'],
    ];
    $heroCount = count($campaigns) + count($evergreenSlides);
    $slideIndex = 0;
    ob_start();
    ?>
    <main <?php echo get_block_wrapper_attributes(['class' => 'aerion-storefront']); ?>>
        <section class="aerion-store-hero" data-aerion-store-hero data-aerion-carousel data-aerion-carousel-autoplay="1" data-aerion-carousel-interval="7">
        <div class="aerion-store-hero__track" data-aerion-carousel-track>
        <?php foreach ($campaigns as $campaign) : ?>
          <article class="aerion-store-hero__slide<?php echo $slideIndex === 0 ? ' is-active' : ''; ?>" data-aerion-carousel-slide="<?php echo esc_attr((string)$slideIndex); ?>"<?php echo $slideIndex === 0 ? '' : ' inert'; ?>><div class="aerion-container aerion-store-hero__grid"><div><span><?php echo esc_html($campaign['meta']['eyebrow'] ?: 'Campanha Aerion'); ?></span><h1><?php echo esc_html($campaign['title']); ?></h1><p><?php echo esc_html($campaign['meta']['subtitle']); ?></p><?php echo Aerion_Campaigns::countdown($campaign); ?><div class="aerion-actions"><a class="aerion-button" href="<?php echo esc_url($campaign['url']); ?>"><?php echo esc_html($campaign['meta']['cta'] ?: 'Ver ofertas'); ?></a></div></div><?php if ($campaign['image']) : ?><img src="<?php echo esc_url($campaign['image']); ?>" alt="" fetchpriority="<?php echo $slideIndex === 0 ? 'high' : 'low'; ?>"><?php endif; ?></div></article>
        <?php $slideIndex++; endforeach; ?>
        <?php foreach ($evergreenSlides as [$eyebrow,$title,$text,$button,$url,$image]) : ?>
          <article class="aerion-store-hero__slide<?php echo $slideIndex === 0 ? ' is-active' : ''; ?>" data-aerion-carousel-slide="<?php echo esc_attr((string)$slideIndex); ?>"<?php echo $slideIndex === 0 ? '' : ' inert'; ?>><div class="aerion-container aerion-store-hero__grid"><div><span><?php echo esc_html($eyebrow); ?></span><h1><?php echo esc_html($title); ?></h1><p><?php echo esc_html($text); ?></p><div class="aerion-actions"><a class="aerion-button" href="<?php echo esc_url($url); ?>"><?php echo esc_html($button); ?></a></div></div><img src="<?php echo esc_url(aerion_blocks_source_asset($image)); ?>" alt="" fetchpriority="<?php echo $slideIndex === 0 ? 'high' : 'low'; ?>"></div></article>
        <?php $slideIndex++; endforeach; ?>
        </div>
        <button class="aerion-store-hero__arrow aerion-store-hero__arrow--prev" type="button" data-aerion-carousel-prev aria-label="Banner anterior">‹</button>
        <button class="aerion-store-hero__arrow aerion-store-hero__arrow--next" type="button" data-aerion-carousel-next aria-label="Próximo banner">›</button>
        <div class="aerion-store-hero__dots" role="tablist" aria-label="Banners da loja"><?php for($dot=0;$dot<$heroCount;$dot++):?><button type="button" data-aerion-carousel-dot role="tab" aria-selected="<?php echo $dot===0?'true':'false'; ?>" aria-label="Mostrar banner <?php echo esc_attr((string)($dot+1)); ?>"></button><?php endfor;?></div>
        </section>
        <section class="aerion-store-section"><div class="aerion-container"><header class="aerion-store-heading"><span>Explore por categoria</span><h2>Encontre a tecnologia certa</h2></header><div class="aerion-store-categories"><?php foreach ($categories as [$title, $text, $image, $slug]) : ?><a href="<?php echo esc_url(home_url('/loja/?tipo=' . $slug)); ?>"><div><span>Categoria</span><h3><?php echo esc_html($title); ?></h3><p><?php echo esc_html($text); ?></p><strong>Explorar <?php echo aerion_blocks_icon('arrow'); ?></strong></div><img src="<?php echo esc_url(aerion_blocks_source_asset($image)); ?>" alt="" loading="lazy"></a><?php endforeach; ?></div></div></section>
        <section class="aerion-store-section aerion-store-section--muted" id="produtos-da-loja"><div class="aerion-container"><header class="aerion-store-heading"><span><?php echo $queriedCategory ? 'Categoria' : 'Catálogo'; ?></span><h2><?php echo esc_html($queriedCategory ? $queriedCategory->name : 'Produtos em destaque'); ?></h2><p>Preço para consumidor final. Distribuidores aprovados visualizam a tabela PV após entrar na conta.</p></header><div class="aerion-store-carousel" data-aerion-carousel><button type="button" data-aerion-carousel-prev aria-label="Produtos anteriores">‹</button><div class="aerion-store-products" data-aerion-carousel-track>
        <?php foreach ($products as $product) :
            $stockLabel=$product->is_in_stock()?'Em estoque':'Indisponível';
        ?>
            <article class="aerion-store-product"><a href="<?php echo esc_url($product->get_permalink()); ?>">
                <div class="aerion-store-product__image"><?php echo $product->get_image('woocommerce_single',['loading'=>'lazy']); ?><?php echo class_exists('Aerion_Presale')?Aerion_Presale::chip($product,true):''; ?></div>
                <div class="aerion-store-product__meta"><em class="<?php echo $product->is_in_stock()?'is-in-stock':'is-out-of-stock'; ?>"><?php echo esc_html($stockLabel); ?></em></div>
                <h3><?php echo esc_html($product->get_name()); ?></h3>
                <div class="aerion-store-product__bottom"><strong><?php echo $product->get_price_html()?wp_kses_post($product->get_price_html()):'Consulte'; ?></strong><span><?php echo aerion_blocks_icon('cart'); ?>Comprar</span></div>
            </a></article>
        <?php endforeach; ?>
        </div><button type="button" data-aerion-carousel-next aria-label="Próximos produtos">›</button></div></div></section>
    </main>
    <?php
    return (string) ob_get_clean();
}

function aerion_store_product_facets_legacy(WC_Product $product): array
{
    $name=remove_accents(strtolower($product->get_name()));
    $applications=(array)$product->get_meta('_aerion_filter_applications',true);
    $autonomy=(string)$product->get_meta('_aerion_filter_autonomy',true);
    $technologies=(array)$product->get_meta('_aerion_filter_technologies',true);
    $categories=wp_get_post_terms($product->get_id(),'product_cat',['fields'=>'slugs']);
    $isDrone=in_array('drones',$categories,true);
    if(!$applications&&$isDrone){
        $applications=['Construção e Topografia','Inspeção Industrial e Energia'];
        if(str_contains($name,'640t')||str_contains($name,'4t')||str_contains($name,'4n')||str_contains($name,'alpha')||str_contains($name,'l35t')){
            $applications[]='Segurança Pública e Defesa Civil';
            $applications[]='Resgate e Emergências';
        }
    }
    if(!$applications&&in_array('softwares',$categories,true))$applications=['Construção e Topografia','Inspeção Industrial e Energia'];
    if($autonomy===''&&$isDrone){
        if(str_contains($name,'evo max'))$autonomy='Até 42 min';
        elseif(str_contains($name,'alpha')||str_contains($name,'evo lite')||str_contains($name,'evo ii'))$autonomy='Até 40 min';
    }
    if(!$technologies){
        if(str_contains($name,'rtk')||str_contains($name,'alpha'))$technologies[]='RTK integrado';
        elseif(str_contains($name,'evo max'))$technologies[]='Compatível com RTK';
        if(str_contains($name,'640t')||str_contains($name,'4t')||str_contains($name,'l35t'))$technologies[]='Câmera térmica';
        if(str_contains($name,'4n')||str_contains($name,'alpha')||str_contains($name,'l35t'))$technologies[]='Visão noturna';
        if(str_contains($name,'6k'))$technologies[]='Câmera 6K';
        if(str_contains($name,'mapper'))$technologies[]='Mapeamento 2D e 3D';
    }
    return [
        'brand'=>(string)($product->get_meta('_aerion_brand',true)?:'Autel Robotics'),
        'applications'=>array_values(array_unique(array_filter(array_map('strval',$applications)))),
        'autonomy'=>$autonomy,
        'technologies'=>array_values(array_unique(array_filter(array_map('strval',$technologies)))),
    ];
}

function aerion_store_product_facets(WC_Product $product): array
{
    $name=remove_accents(strtolower($product->get_name()));
    $applications=(array)$product->get_meta('_aerion_filter_applications',true);
    $autonomy=(string)$product->get_meta('_aerion_filter_autonomy',true);
    $camera=(array)$product->get_meta('_aerion_filter_camera',true);
    $rtk=(string)$product->get_meta('_aerion_filter_rtk',true);
    $productType=(string)$product->get_meta('_aerion_filter_product_type',true);
    $batteryCount=(string)$product->get_meta('_aerion_filter_battery_count',true);
    $license=(string)$product->get_meta('_aerion_filter_license',true);
    $categories=wp_get_post_terms($product->get_id(),'product_cat',['fields'=>'slugs']);
    $isAircraft=(bool)array_intersect(['drones','kits'],$categories);
    if(!$applications&&$isAircraft){
        $applications=['Construção e Topografia','Inspeção Industrial e Energia'];
        if(str_contains($name,'640t')||str_contains($name,'4t')||str_contains($name,'4n')||str_contains($name,'alpha')||str_contains($name,'l35t')){
            $applications[]='Segurança Pública e Defesa Civil';
            $applications[]='Resgate e Emergências';
        }
    }
    if($autonomy===''&&$isAircraft)$autonomy=str_contains($name,'evo max')?'Até 42 min':'Até 40 min';
    if(!$camera){
        if(str_contains($name,'640t')||str_contains($name,'4t')||str_contains($name,'l35t'))$camera[]='Térmica';
        if(str_contains($name,'4n')||str_contains($name,'alpha')||str_contains($name,'l35t'))$camera[]='Noturna / Starlight';
        if(str_contains($name,'6k'))$camera[]='RGB 6K';
        if(str_contains($name,'4t')||str_contains($name,'alpha')||str_contains($name,'l35t'))$camera[]='RGB com zoom';
    }
    if($rtk===''&&$isAircraft){
        if(str_contains($name,'rtk')||str_contains($name,'alpha'))$rtk='Sim — integrado';
        elseif(str_contains($name,'evo max'))$rtk='Sim — módulo avulso';
        else $rtk='Não';
    }
    return [
        'brand'=>(string)($product->get_meta('_aerion_brand',true)?:'Autel Robotics'),
        'applications'=>array_values(array_unique(array_filter(array_map('strval',$applications)))),
        'autonomy'=>$autonomy,
        'camera'=>array_values(array_unique(array_filter(array_map('strval',$camera)))),
        'rtk'=>$rtk,
        'product_type'=>$productType,
        'battery_count'=>$batteryCount,
        'license'=>$license,
    ];
}

function aerion_store_product_card_legacy(WC_Product $product,string $modifier=''): string
{
    $isInquiry=$product->get_meta('_aerion_catalog_inquiry',true)==='yes';
    $available=!$isInquiry&&$product->is_in_stock()&&(class_exists('Aerion_Inventory')?Aerion_Inventory::immediately_available($product):true);
    $inCart=false;
    if(function_exists('WC')&&WC()->cart)foreach(WC()->cart->get_cart()as$item)if((int)($item['product_id']??0)===$product->get_id()){$inCart=true;break;}
    $classes='aerion-store-product'.(!$available?' is-unavailable':'').($modifier!==''?' '.$modifier:'');
    $rating=(float)$product->get_average_rating();
    $ratingCount=(int)$product->get_review_count();
    $primaryLabel=$available?'COMPRAR':'INDISPONÍVEL';
    $campaign=class_exists('Aerion_Campaigns')?Aerion_Campaigns::active_for_product($product->get_id()):null;
    $offerPercent=$campaign?max(1,(int)round((float)($campaign['meta']['percentage']?:15))):0;
    ob_start();
    ?>
    <article class="<?php echo esc_attr($classes); ?>">
        <a class="aerion-store-product__main" href="<?php echo esc_url($product->get_permalink()); ?>">
            <div class="aerion-store-product__image"><?php echo $product->get_image('woocommerce_single',['loading'=>'lazy']); ?><?php echo class_exists('Aerion_Presale')?Aerion_Presale::chip($product,true):''; ?></div>
            <div class="aerion-store-product__meta"><?php if(!$available): ?><em class="is-out-of-stock">Indisponível</em><?php endif; ?></div>
            <h3><?php echo esc_html($product->get_name()); ?></h3>
            <div class="aerion-card-rating" aria-label="<?php echo esc_attr(number_format_i18n($rating,1).' de 5 estrelas; '.$ratingCount.' avaliações'); ?>"><span class="aerion-rating-stars" style="--aerion-rating:<?php echo esc_attr((string)($rating/5*100)); ?>%"><span>★★★★★</span></span><small>(<?php echo esc_html((string)$ratingCount); ?>)</small></div>
        </a>
        <div class="aerion-store-product__bottom">
            <strong><?php echo $product->get_price_html()?wp_kses_post($product->get_price_html()):'Consulte'; ?></strong>
            <div class="aerion-store-product__actions">
                <a class="aerion-store-product__buy<?php echo !$available?' is-disabled':''; ?>" href="<?php echo esc_url($product->get_permalink()); ?>"<?php echo !$available?' aria-disabled="true"':''; ?>><?php echo esc_html($primaryLabel); ?></a>
                <?php if(!$isInquiry&&$product->is_purchasable()): ?>
                    <a class="aerion-store-product__cart add_to_cart_button ajax_add_to_cart<?php echo $inCart?' is-in-cart':''; ?>" href="<?php echo esc_url($product->add_to_cart_url()); ?>" data-quantity="1" data-product_id="<?php echo esc_attr((string)$product->get_id()); ?>" data-product_sku="<?php echo esc_attr($product->get_sku()); ?>" aria-label="<?php echo esc_attr(($inCart?'Produto já está no carrinho: ':'Adicionar ao carrinho: ').$product->get_name()); ?>" rel="nofollow"><?php echo aerion_blocks_icon('cart'); ?><span class="screen-reader-text">Adicionar ao carrinho</span></a>
                <?php else: ?>
                    <span class="aerion-store-product__cart is-disabled" role="img" aria-label="Produto indisponível"><?php echo aerion_blocks_icon('cart'); ?></span>
                <?php endif; ?>
            </div>
        </div>
    </article>
    <?php
    return (string)ob_get_clean();
}

function aerion_store_selected_values(string $key): array
{
    $raw=wp_unslash($_GET[$key]??[]);
    if(!is_array($raw))$raw=[$raw];
    return array_values(array_filter(array_map('sanitize_text_field',$raw),static fn(string $value):bool=>$value!==''));
}

function aerion_store_availability_rank(WC_Product $product): int
{
    if ($product->get_meta('_aerion_catalog_inquiry', true) === 'yes' || ! $product->is_in_stock()) return 1;
    $available = class_exists('Aerion_Inventory') ? Aerion_Inventory::immediately_available($product) : true;
    return $available ? 0 : 1;
}

/**
 * Normaliza texto para busca: sem acento, minusculo, pontuacao virando espaco.
 */
function aerion_store_search_normalize(string $text): string
{
    $text=remove_accents(wp_strip_all_tags($text,true));
    $text=strtolower($text);
    $text=preg_replace('/[^a-z0-9]+/',' ',$text)??'';
    return trim(preg_replace('/\s+/',' ',$text)??'');
}

/**
 * Campos pesquisaveis de um produto, ja normalizados.
 * O post_content entra SEM HTML: classes Tailwind (max-w-7xl) e caminhos de imagem
 * (source-images/destaques/evo-max/...) faziam a busca nativa do WP casar qualquer coisa.
 *
 * @return array{title:string,sku:string,excerpt:string,content:string}
 */
function aerion_store_search_fields(WC_Product $product): array
{
    $post=get_post($product->get_id());
    return [
        'title'=>aerion_store_search_normalize((string)$product->get_name()),
        'sku'=>aerion_store_search_normalize((string)$product->get_sku()),
        'excerpt'=>aerion_store_search_normalize((string)($post->post_excerpt??'')),
        'content'=>aerion_store_search_normalize((string)($post->post_content??'')),
    ];
}

/**
 * Um termo casa quando alguma palavra do campo comeca com ele ("bateria" acha "baterias").
 */
function aerion_store_search_field_has_term(string $haystack, string $term): bool
{
    if($haystack===''||$term==='')return false;
    return (bool)preg_match('/(?:^| )'.preg_quote($term,'/').'/',$haystack);
}

function aerion_store_search_field_has_all(string $haystack, array $terms): bool
{
    foreach($terms as $term)if(!aerion_store_search_field_has_term($haystack,$term))return false;
    return $terms!==[];
}

/**
 * Peso por tipo de produto: um drone vale mais que um acessorio homonimo.
 * Buscar "evo max" tem de trazer o drone e os kits antes da bateria e do carregador.
 */
function aerion_store_search_type_weight(WC_Product $product): float
{
    $pesos=array_merge([
        'drones'=>60.0,
        'kits'=>50.0,
        'docas'=>30.0,
        'payloads'=>25.0,
        'softwares'=>25.0,
        'baterias-e-carregadores'=>15.0,
        'acessorios'=>10.0,
    ],(array)apply_filters('aerion_store_search_type_weights',[]));
    $peso=0.0;
    foreach(wc_get_product_term_ids($product->get_id(),'product_cat') as $termId){
        $term=get_term($termId,'product_cat');
        if($term instanceof WP_Term)$peso=max($peso,(float)($pesos[$term->slug]??0.0));
    }
    return $peso;
}

/**
 * Relevancia de um produto para a busca. 0 = nao deve aparecer.
 *
 * Qualificacao (recall): todos os termos no titulo, SKU ou resumo, OU a frase inteira
 * no corpo. O corpo sozinho exige a frase, senao "max" volta a casar com "maxima".
 *
 * Ranqueamento: a faixa e o MELHOR campo que casou, nunca a soma - somar fazia o
 * acessorio com a frase no resumo passar na frente do proprio drone. O peso de tipo
 * desempata dentro da faixa e e sempre menor que a distancia entre faixas.
 */
/**
 * Onde o termo aparece no NOME do produto.
 *
 * "bateria" casa tanto com "Bateria EVO Lite" quanto com "EVO Max 4T V2 sem
 * baterias" — nos dois o titulo contem o termo, e os dois recebiam a mesma
 * pontuacao de texto. O desempate caia entao no peso de categoria, que da 60 ao
 * drone e 15 a bateria: quem procurava bateria recebia a aeronave primeiro, e a
 * bateria ficava enterrada sob os drones que apenas a mencionam.
 *
 * A posicao resolve porque ela carrega o que o peso de categoria nao sabe: um
 * produto que ABRE o nome com o termo E aquilo; um que o cita no fim apenas se
 * relaciona com aquilo. "Bateria EVO Lite" comeca por bateria, "Multi-Carregador
 * EVO Max" tem carregador na segunda palavra, e "EVO Max 4T V2 sem baterias" so
 * na sexta.
 *
 * O bonus decai por palavra e vale ate 150 — acima dos 60 do maior peso de
 * categoria, o que garante que a identidade do produto ganhe da familia dele. E
 * nao atrapalha a busca por aeronave: quem procura "evo max" continua recebendo
 * o drone primeiro, porque e o drone que abre o nome com esse termo.
 *
 * @param string[] $terms
 */
function aerion_store_search_title_position_bonus(string $title, array $terms, string $phrase): float
{
    if($title==='')return 0.0;
    $peso=(float)apply_filters('aerion_store_search_position_weight',150.0);
    $palavras=explode(' ',$title);
    $melhor=null;
    // A frase inteira, quando casa, vale mais que o termo solto: e o sinal mais
    // forte de que o nome fala daquilo.
    $alvos=$phrase!==''&&!in_array($phrase,$terms,true)?array_merge([$phrase],$terms):$terms;
    foreach($alvos as $alvo){
        if($alvo==='')continue;
        $primeira=explode(' ',$alvo)[0];
        foreach($palavras as $i=>$palavra){
            if(strpos($palavra,$primeira)!==0)continue;
            if($melhor===null||$i<$melhor)$melhor=$i;
            break;
        }
    }
    return $melhor===null?0.0:$peso/(1+$melhor);
}

function aerion_store_search_relevance(WC_Product $product, array $terms, string $phrase): float
{
    if(!$terms)return 0.0;
    $f=aerion_store_search_fields($product);
    $w=array_merge([
        'title_phrase'=>1000.0,
        'title_all'=>800.0,
        'sku'=>600.0,
        'excerpt_all'=>400.0,
        'content_phrase'=>200.0,
        'title_partial'=>20.0,
    ],(array)apply_filters('aerion_store_search_weights',[]));

    $faixa=0.0;
    if($phrase!==''&&aerion_store_search_field_has_term($f['title'],$phrase))$faixa=max($faixa,(float)$w['title_phrase']);
    if(aerion_store_search_field_has_all($f['title'],$terms))$faixa=max($faixa,(float)$w['title_all']);
    if(aerion_store_search_field_has_all($f['sku'],$terms))$faixa=max($faixa,(float)$w['sku']);
    if(aerion_store_search_field_has_all($f['excerpt'],$terms))$faixa=max($faixa,(float)$w['excerpt_all']);
    if($phrase!==''&&aerion_store_search_field_has_term($f['content'],$phrase))$faixa=max($faixa,(float)$w['content_phrase']);
    if($faixa<=0.0)return 0.0;

    $hits=0;
    foreach($terms as $term)if(aerion_store_search_field_has_term($f['title'],$term))$hits++;
    $parcial=count($terms)>0?(float)$w['title_partial']*($hits/count($terms)):0.0;

    return $faixa+aerion_store_search_type_weight($product)+$parcial
        +aerion_store_search_title_position_bonus($f['title'],$terms,$phrase);
}

/**
 * IDs dos produtos que atendem a busca, com a relevancia de cada um.
 *
 * @return array<int,float>
 */
function aerion_store_search_matches(string $searchTerm): array
{
    $phrase=aerion_store_search_normalize($searchTerm);
    $terms=array_values(array_filter(explode(' ',$phrase),static fn(string $t):bool=>$t!==''));
    if(!$terms)return [];
    $matches=[];
    foreach(wc_get_products(['status'=>'publish','limit'=>-1]) as $product){
        $relevance=aerion_store_search_relevance($product,$terms,$phrase);
        if($relevance>0.0)$matches[$product->get_id()]=$relevance;
    }
    arsort($matches);
    return $matches;
}

/**
 * Vendas por produto numa janela recente, a partir da tabela de lookup do WooCommerce Analytics.
 * Retorna [] quando a tabela nao existe ou ainda nao foi populada; o chamador decide o fallback.
 */
function aerion_store_recent_sales_map(): array
{
    $days=max(1,(int)apply_filters('aerion_store_sales_window_days',90));
    $cacheKey='aerion_store_sales_'.$days;
    $cached=get_transient($cacheKey);
    if(is_array($cached))return $cached;

    global $wpdb;
    $table=$wpdb->prefix.'wc_order_product_lookup';
    $map=[];
    if($wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s',$table))===$table){
        $rows=$wpdb->get_results($wpdb->prepare(
            "SELECT product_id, SUM(product_qty) AS qty FROM {$table} WHERE date_created >= %s GROUP BY product_id",
            gmdate('Y-m-d H:i:s',time()-$days*DAY_IN_SECONDS)
        ),ARRAY_A);
        foreach((array)$rows as $row)$map[(int)$row['product_id']]=(float)$row['qty'];
    }
    set_transient($cacheKey,$map,max(MINUTE_IN_SECONDS,(int)apply_filters('aerion_store_sales_cache_ttl',6*HOUR_IN_SECONDS)));
    return $map;
}

/**
 * A faixa do produto: aeronave ou o resto.
 *
 * Numa loja de drones, uma bateria com boa pontuacao nao deve abrir a vitrine na
 * frente da aeronave que ela alimenta. O score de destaque nao resolve isso
 * sozinho: ele soma disponibilidade, vendas, campanha e recencia, e um acessorio
 * barato que vende bem acumula pontos que qualquer drone caro e de giro lento
 * perde. O resultado era uma vitrine liderada por carregador.
 *
 * Por isso a faixa e chave PRIMARIA de ordenacao, e nao mais um peso somado: um
 * peso pode ser vencido pela soma dos outros, e a regra aqui e "sempre". Dentro
 * de cada faixa o score de destaque continua mandando, com todos os sinais que
 * ele ja pondera.
 *
 * Vale para a ordenacao "Em destaque" — que e a mesma que a vitrine da campanha
 * usa, ja que campanha e esse ordenamento com um filtro por cima.
 *
 * @return int 0 para drones e kits, 1 para o restante do catalogo
 */
function aerion_store_category_tier(WC_Product $product): int
{
    $principais=(array)apply_filters('aerion_store_categorias_principais',['drones','kits']);
    $slugs=wp_get_post_terms($product->get_id(),'product_cat',['fields'=>'slugs']);
    if(is_wp_error($slugs))return 1;
    return array_intersect($slugs,$principais)?0:1;
}

/**
 * Pesos do score de destaque, ajustaveis via filtro sem tocar no codigo.
 */
function aerion_store_featured_weights(): array
{
    return array_merge([
        'pinned'=>100.0,   // flag "Produto em destaque" nativo do WooCommerce: curadoria ganha do algoritmo
        'available'=>40.0, // pronta-entrega pesa muito, mas nao exclui o resto da vitrine
        'sales'=>25.0,     // procura real na janela recente
        'campaign'=>15.0,  // campanha ativa
        'recency'=>10.0,   // lancamentos
        'curation'=>5.0,   // menu_order como ajuste fino
    ],(array)apply_filters('aerion_store_featured_weights',[]));
}

function aerion_store_featured_score(WC_Product $product,array $salesMap,float $maxSales,int $maxMenuOrder): float
{
    $w=aerion_store_featured_weights();
    $score=0.0;
    if($product->is_featured())$score+=(float)$w['pinned'];
    if(aerion_store_availability_rank($product)===0)$score+=(float)$w['available'];
    if($maxSales>0.0)$score+=(float)$w['sales']*min(1.0,((float)($salesMap[$product->get_id()]??0.0))/$maxSales);
    if(class_exists('Aerion_Campaigns')&&Aerion_Campaigns::active_for_product($product->get_id())!==null)$score+=(float)$w['campaign'];
    $created=$product->get_date_created()?->getTimestamp()??0;
    if($created>0){
        $window=max(1.0,(float)apply_filters('aerion_store_recency_days',120));
        $ageDays=max(0.0,(time()-$created)/DAY_IN_SECONDS);
        $score+=(float)$w['recency']*max(0.0,1.0-min(1.0,$ageDays/$window));
    }
    if($maxMenuOrder>0)$score+=(float)$w['curation']*(1.0-min(1.0,max(0,$product->get_menu_order())/$maxMenuOrder));
    return $score;
}

/**
 * @param WC_Product[] $products
 * @return array<int,float> score de destaque por ID de produto
 */
function aerion_store_featured_scores(array $products): array
{
    $salesMap=aerion_store_recent_sales_map();
    if(!$salesMap)foreach($products as $product)$salesMap[$product->get_id()]=(float)$product->get_total_sales();
    $maxSales=$salesMap?(float)max($salesMap):0.0;
    $maxMenuOrder=0;
    foreach($products as $product)$maxMenuOrder=max($maxMenuOrder,(int)$product->get_menu_order());
    $scores=[];
    foreach($products as $product)$scores[$product->get_id()]=aerion_store_featured_score($product,$salesMap,$maxSales,$maxMenuOrder);
    return $scores;
}

function aerion_render_storefront_block(array $attributes): string
{
    if(!function_exists('wc_get_products'))return'';

    $queriedCategory=null;
    $baseQuery=['status'=>'publish','limit'=>-1,'orderby'=>'menu_order','order'=>'ASC'];
    if(function_exists('is_product_category')&&is_product_category()){
        $object=get_queried_object();
        if($object instanceof WP_Term){
            $queriedCategory=$object;
            $baseQuery['category']=[$object->slug];
        }
    }
    $typeFilter=sanitize_title(wp_unslash($_GET['tipo']??''));
    if($typeFilter==='acessorios-e-baterias')$baseQuery['category']=['acessorios','baterias-e-carregadores'];
    elseif(in_array($typeFilter,['drones','kits','baterias-e-carregadores','payloads','softwares','docas','acessorios'],true))$baseQuery['category']=[$typeFilter];
    $viewFilter=sanitize_title(wp_unslash($_GET['vitrine']??''));
    $campaignSlug=sanitize_title(wp_unslash($_GET['campanha']??''));
    $selectedCampaign=null;
    if($campaignSlug!==''&&class_exists('Aerion_Campaigns')){
        $campaignPost=get_page_by_path($campaignSlug,OBJECT,'aerion_campaign');
        if($campaignPost&&$campaignPost->post_status==='publish'){
            $campaignMeta=Aerion_Campaigns::meta($campaignPost->ID);
            $selectedCampaign=['id'=>$campaignPost->ID,'title'=>$campaignPost->post_title,'url'=>home_url('/loja/?campanha='.$campaignPost->post_name),'image'=>'','meta'=>$campaignMeta];
            $baseQuery['include']=$campaignMeta['products']?:[0];
        }
    }
    $searchTerm=is_search()?sanitize_text_field(get_search_query(false)):sanitize_text_field(wp_unslash($_GET['s']??''));
    $searchRelevance=[];
    if($searchTerm!==''){
        $searchRelevance=aerion_store_search_matches($searchTerm);
        $searchIds=array_keys($searchRelevance);
        if(!$searchIds)$baseQuery['include']=[0];
        else{
            $searchIds=array_map('absint',$searchIds);
            $baseQuery['include']=isset($baseQuery['include'])?array_values(array_intersect($baseQuery['include'],$searchIds)):$searchIds;
            if(!$baseQuery['include'])$baseQuery['include']=[0];
        }
    }

    $baseProducts=wc_get_products($baseQuery);
    $facetMap=[];
    foreach($baseProducts as $candidate)$facetMap[$candidate->get_id()]=aerion_store_product_facets($candidate);
    $allPrices=array_values(array_filter(array_map(static fn(WC_Product $product):float=>(float)$product->get_price(),$baseProducts),static fn(float $price):bool=>$price>0));
    $catalogMin=$allPrices?(float)floor(min($allPrices)):0.0;
    $catalogMax=$allPrices?(float)ceil(max($allPrices)):0.0;
    $requestedMin=isset($_GET['min_price'])?(float)wc_format_decimal(wp_unslash($_GET['min_price'])):$catalogMin;
    $requestedMax=isset($_GET['max_price'])?(float)wc_format_decimal(wp_unslash($_GET['max_price'])):$catalogMax;
    $selected=[
        'brand'=>aerion_store_selected_values('marca'),
        'applications'=>aerion_store_selected_values('aplicacao'),
        'autonomy'=>aerion_store_selected_values('autonomia'),
        'camera'=>aerion_store_selected_values('camera'),
        'rtk'=>aerion_store_selected_values('rtk'),
        'product_type'=>aerion_store_selected_values('tipo_produto'),
        'battery_count'=>aerion_store_selected_values('baterias'),
        'license'=>aerion_store_selected_values('licenca'),
        'stock'=>aerion_store_selected_values('estoque'),
    ];
    $hasFacetFilter=(bool)array_filter($selected)||isset($_GET['min_price'])||isset($_GET['max_price']);

    $products=array_values(array_filter($baseProducts,static function(WC_Product $product)use($facetMap,$selected,$requestedMin,$requestedMax,$selectedCampaign):bool{
        if($selectedCampaign!==null&&aerion_store_availability_rank($product)!==0)return false;
        $price=(float)$product->get_price();
        if($price<$requestedMin||$price>$requestedMax)return false;
        $facets=$facetMap[$product->get_id()];
        if($selected['brand']&&!in_array($facets['brand'],$selected['brand'],true))return false;
        if($selected['applications']&&!array_intersect($selected['applications'],$facets['applications']))return false;
        if($selected['autonomy']&&!in_array($facets['autonomy'],$selected['autonomy'],true))return false;
        if($selected['camera']&&!array_intersect($selected['camera'],$facets['camera']))return false;
        foreach(['rtk','product_type','battery_count','license']as$key)if($selected[$key]&&!in_array($facets[$key],$selected[$key],true))return false;
        if($selected['stock']){
            $available=class_exists('Aerion_Inventory')?Aerion_Inventory::immediately_available($product):$product->is_in_stock();
            $stock=$available?'Em estoque':'Indisponível';
            if(!in_array($stock,$selected['stock'],true))return false;
        }
        return true;
    }));

    $sort=sanitize_key(wp_unslash($_GET['orderby']??'featured'));
    $sortOptions=['featured'=>'Em destaque','popularity'=>'Mais vendidos','price'=>'Menor preço','price-desc'=>'Maior preço','date'=>'Mais recentes','date-asc'=>'Mais antigos'];
    if(!isset($sortOptions[$sort]))$sort='featured';
    $scores=aerion_store_featured_scores($products);
    if($viewFilter==='destaques'){
        $featuredLimit=max(1,(int)apply_filters('aerion_store_featured_limit',12));
        // O recorte de destaques corta os 12 primeiros: se ordenasse so pelo score,
        // escolheria doze acessorios e a faixa nao teria mais o que ordenar.
        usort($products,static function(WC_Product $a,WC_Product $b)use($scores):int{
            $value=aerion_store_category_tier($a)<=>aerion_store_category_tier($b);
            if($value===0)$value=($scores[$b->get_id()]??0.0)<=>($scores[$a->get_id()]??0.0);
            return $value!==0?$value:$a->get_id()<=>$b->get_id();
        });
        $products=array_slice($products,0,$featuredLimit);
    }
    usort($products,static function(WC_Product $a,WC_Product $b)use($sort,$scores,$searchRelevance):int{
        if($searchRelevance&&$sort==='featured'){
            // Numa BUSCA a relevancia do termo vem primeiro: quem digitou
            // "bateria" quer a bateria, e enterra-la sob os drones seria ignorar
            // o que a pessoa pediu. A faixa desempata dentro da mesma relevancia.
            $value=($searchRelevance[$b->get_id()]??0.0)<=>($searchRelevance[$a->get_id()]??0.0);
            // Disponibilidade antes da faixa: entre dois resultados igualmente
            // relevantes, um drone esgotado nao deve passar na frente de um item
            // que o cliente pode comprar agora. Na vitrine "Em destaque" isso ja
            // esta dentro do score; aqui a chave e explicita.
            if($value===0)$value=aerion_store_availability_rank($a)<=>aerion_store_availability_rank($b);
            if($value===0)$value=aerion_store_category_tier($a)<=>aerion_store_category_tier($b);
            if($value===0)$value=($scores[$b->get_id()]??0.0)<=>($scores[$a->get_id()]??0.0);
            return $value!==0?$value:$a->get_id()<=>$b->get_id();
        }
        if($sort==='featured'){
            $value=aerion_store_category_tier($a)<=>aerion_store_category_tier($b);
            if($value===0)$value=($scores[$b->get_id()]??0.0)<=>($scores[$a->get_id()]??0.0);
            if($value===0)$value=$a->get_menu_order()<=>$b->get_menu_order();
            return $value!==0?$value:$a->get_id()<=>$b->get_id();
        }
        $availability=aerion_store_availability_rank($a)<=>aerion_store_availability_rank($b);
        if($availability!==0)return $availability;
        if($sort==='popularity')$value=(int)$b->get_total_sales()<=>(int)$a->get_total_sales();
        elseif($sort==='price')$value=(float)$a->get_price()<=>(float)$b->get_price();
        elseif($sort==='price-desc')$value=(float)$b->get_price()<=>(float)$a->get_price();
        elseif($sort==='date')$value=($b->get_date_created()?->getTimestamp()??0)<=>($a->get_date_created()?->getTimestamp()??0);
        elseif($sort==='date-asc')$value=($a->get_date_created()?->getTimestamp()??0)<=>($b->get_date_created()?->getTimestamp()??0);
        else $value=$a->get_menu_order()<=>$b->get_menu_order();
        return $value!==0?$value:$a->get_id()<=>$b->get_id();
    });

    $currentPage=max(1,absint($_GET['pagina']??1));
    $perPage=12;
    $total=count($products);
    $maxPages=max(1,(int)ceil($total/$perPage));
    if($currentPage>$maxPages)$currentPage=$maxPages;
    $pageProducts=array_slice($products,($currentPage-1)*$perPage,$perPage);
    $isResults=$searchTerm!==''||$queriedCategory!==null||$typeFilter!==''||$viewFilter!==''||$selectedCampaign!==null||$hasFacetFilter||$sort!=='featured'||$currentPage>1;

    $campaigns=class_exists('Aerion_Campaigns')?Aerion_Campaigns::featured():[];
    $allStoreProducts=wc_get_products(['status'=>'publish','limit'=>-1,'orderby'=>'menu_order','order'=>'ASC']);
    $offerProducts=array_values(array_filter($allStoreProducts,static fn(WC_Product $product):bool=>aerion_store_availability_rank($product)===0&&class_exists('Aerion_Campaigns')&&Aerion_Campaigns::active_for_product($product->get_id())!==null));
    // A vitrine de ofertas ordenava so por `menu_order`, que e a ordem de
    // cadastro: a campanha abria por qualquer item que tivesse sido incluido
    // primeiro — na pratica, um multi-carregador de R$ 2,9 mil na frente de todos
    // os drones em oferta. Aqui vale o mesmo criterio da vitrine "Em destaque":
    // faixa primeiro (aeronave antes de acessorio) e o score de destaque depois,
    // que ja pondera disponibilidade, vendas, campanha e recencia.
    $offerScores=aerion_store_featured_scores($offerProducts);
    usort($offerProducts,static function(WC_Product $a,WC_Product $b)use($offerScores):int{
        $value=aerion_store_category_tier($a)<=>aerion_store_category_tier($b);
        if($value===0)$value=($offerScores[$b->get_id()]??0.0)<=>($offerScores[$a->get_id()]??0.0);
        if($value===0)$value=$a->get_menu_order()<=>$b->get_menu_order();
        return $value!==0?$value:$a->get_id()<=>$b->get_id();
    });
    $activeOfferIds=array_map(static fn(WC_Product $product):int=>$product->get_id(),$offerProducts);
    if(!$isResults&&$activeOfferIds){
        $products=array_values(array_filter($products,static fn(WC_Product $product):bool=>!in_array($product->get_id(),$activeOfferIds,true)));
        $total=count($products);
        $maxPages=max(1,(int)ceil($total/$perPage));
        $pageProducts=array_slice($products,0,$perPage);
    }
    if(!$offerProducts){
        // Sem campanha ativa a faixa vira uma vitrine de oito itens quaisquer;
        // ela merece o mesmo criterio, senao a loja abre por acessorio.
        $fallbackScores=aerion_store_featured_scores($allStoreProducts);
        usort($allStoreProducts,static function(WC_Product $a,WC_Product $b)use($fallbackScores):int{
            $value=aerion_store_availability_rank($a)<=>aerion_store_availability_rank($b);
            if($value===0)$value=aerion_store_category_tier($a)<=>aerion_store_category_tier($b);
            if($value===0)$value=($fallbackScores[$b->get_id()]??0.0)<=>($fallbackScores[$a->get_id()]??0.0);
            return $value!==0?$value:$a->get_id()<=>$b->get_id();
        });
        $availableStoreProducts=array_values(array_filter($allStoreProducts,static fn(WC_Product $product):bool=>aerion_store_availability_rank($product)===0));
        $offerProducts=array_slice($availableStoreProducts,0,8);
    }
    $offerCampaign=null;
    $offerCampaigns=[];
    foreach($offerProducts as$offerCandidate){$active=class_exists('Aerion_Campaigns')?Aerion_Campaigns::active_for_product($offerCandidate->get_id()):null;if($active)$offerCampaigns[$active['id']]=$active;}
    // Follow the featured campaign that actually supplies this shelf. A higher
    // priority exception for one SKU must not rename the whole seasonal campaign.
    foreach($campaigns as$featuredCampaign){if(isset($offerCampaigns[$featuredCampaign['id']])){$offerCampaign=$offerCampaigns[$featuredCampaign['id']];break;}}
    if(!$offerCampaign&&$offerCampaigns)$offerCampaign=reset($offerCampaigns);
    $offerTitle=$offerCampaign ? $offerCampaign['title'] : 'Produtos em destaque';
    /**
     * As variantes de largura do banner, para o browser nao reduzir a arte.
     *
     * O card do banner tem no maximo 620px de largura em CSS, e a arte e
     * entregue a 1600px: o browser reduzia 2,58x com o filtro rapido dele, e o
     * resultado era serrilha nas bordas das letras — bem visivel numa manchete
     * de alto contraste como "OFERTAS DE LANCAMENTO".
     *
     * As variantes sao reduzidas offline com Lanczos e servidas por `srcset`.
     * Assim uma tela comum recebe 620px ja no tamanho certo (nenhuma reducao) e
     * uma tela de alta densidade recebe 1240px, que e exatamente 2x. O arquivo
     * de 1600px fica como ultimo recurso para telas ainda maiores.
     *
     * A existencia e checada NO DISCO, e nao pela URL: `aerion_blocks_theme_asset`
     * monta o endereco a partir do caminho e devolve string valida mesmo para um
     * arquivo que nao existe. Sem essa checagem, uma arte sem variantes entraria
     * no `srcset` apontando para 404 — e o browser mostraria um banner quebrado
     * justamente na largura em que ele escolhesse a variante ausente.
     */
    $heroSrcset=static function(string $url):string{
        if($url==='')return '';
        // A checagem e feita NO DISCO, e nao pela URL: as funcoes de asset montam
        // o endereco a partir do caminho e devolvem string valida ate para um
        // arquivo inexistente. Sem isso, uma arte sem variantes entraria no
        // `srcset` apontando para 404 — e o banner quebraria justamente na
        // largura em que o browser escolhesse a variante ausente.
        $base=content_url();
        if(strpos($url,$base)!==0)return '';           // arte de fora: nao da para localizar em disco
        $caminho=WP_CONTENT_DIR.substr($url,strlen($base));
        $partes=[];
        foreach([620,1240] as $largura){
            $variante=preg_replace('/\.(png|jpe?g|webp)$/i','-'.$largura.'.$1',$caminho);
            if($variante===null||!file_exists($variante))continue;
            $partes[]=esc_url($base.substr($variante,strlen(WP_CONTENT_DIR))).' '.$largura.'w';
        }
        if(!$partes)return '';
        $partes[]=esc_url($url).' 1600w';
        return implode(', ',$partes);
    };
    // Espelha os pontos de quebra do CSS: 88vw no celular, 74vw ate 1100px e o
    // teto de 620px acima disso.
    // Versao WebP ao lado do PNG (`nome.webp`, `nome-620.webp`, `nome-1240.webp`).
    // Mesma regra do srcset: so entra o que existe em disco; sem WebP devolve ''
    // e o <source> nem e emitido, mantendo o PNG como unica opcao.
    $heroWebp=static function(string $url,bool $variantes=false):string{
        $base=content_url();
        if($url===''||strpos($url,$base)!==0)return '';
        $caminho=preg_replace('/\.(png|jpe?g)$/i','',WP_CONTENT_DIR.substr($url,strlen($base)));
        if($caminho===null)return '';
        $partes=[];
        if($variantes){
            foreach([620,1240] as $largura){
                if(file_exists($caminho.'-'.$largura.'.webp'))$partes[]=esc_url($base.substr($caminho,strlen(WP_CONTENT_DIR)).'-'.$largura.'.webp').' '.$largura.'w';
            }
        }
        if(!file_exists($caminho.'.webp'))return $variantes&&$partes?implode(', ',$partes):'';
        $principal=esc_url($base.substr($caminho,strlen(WP_CONTENT_DIR)).'.webp');
        return $variantes?implode(', ',array_merge($partes,[$principal.' 1600w'])):$principal;
    };
    $heroSizes='(max-width: 760px) 88vw, (max-width: 1100px) 74vw, 620px';

    $evergreenSlides=[
        ['desktop'=>'campaigns/loja-oficial-autel/hero.png','mobile'=>'campaigns/loja-oficial-autel/hero-mobile.png','alt'=>'Loja Oficial Autel com suporte especializado no Brasil','url'=>home_url('/loja/?tipo=drones')],
        ['desktop'=>'campaigns/autel-mapper/hero.png','mobile'=>'campaigns/autel-mapper/hero-mobile.png','alt'=>'Autel Mapper para reconstrução 2D e 3D','url'=>home_url('/loja/?tipo=softwares')],
    ];
    $title='Produtos em destaque';
    if($searchTerm!=='')$title='Resultados para “'.$searchTerm.'”';
    elseif($queriedCategory)$title=$queriedCategory->name;
    elseif($selectedCampaign)$title=$selectedCampaign['title'];
    elseif($typeFilter!=='')$title=['drones'=>'Drones','kits'=>'Kits','baterias-e-carregadores'=>'Baterias e Carregadores','payloads'=>'Payloads','softwares'=>'Softwares','docas'=>'Docas','acessorios'=>'Acessórios','acessorios-e-baterias'=>'Acessórios, Baterias e Carregadores'][$typeFilter];

    $facetOptions=['brand'=>[],'applications'=>[],'autonomy'=>[],'camera'=>[],'rtk'=>[],'product_type'=>[],'battery_count'=>[],'license'=>[]];
    foreach($facetMap as $facets){
        $facetOptions['brand'][$facets['brand']]=($facetOptions['brand'][$facets['brand']]??0)+1;
        foreach(['applications','camera']as$key)foreach($facets[$key]as$value)$facetOptions[$key][$value]=($facetOptions[$key][$value]??0)+1;
        if($facets['autonomy']!=='')$facetOptions['autonomy'][$facets['autonomy']]=($facetOptions['autonomy'][$facets['autonomy']]??0)+1;
        foreach(['rtk','product_type','battery_count','license']as$key)if($facets[$key]!=='')$facetOptions[$key][$facets[$key]]=($facetOptions[$key][$facets[$key]]??0)+1;
    }
    foreach($facetOptions as &$options)ksort($options,SORT_NATURAL|SORT_FLAG_CASE);
    unset($options);

    $filterAction=$queriedCategory?get_term_link($queriedCategory):home_url('/loja/');
    if(is_wp_error($filterAction))$filterAction=home_url('/loja/');
    $clearArgs=[];
    if($typeFilter!=='')$clearArgs['tipo']=$typeFilter;
    if($viewFilter!=='')$clearArgs['vitrine']=$viewFilter;
    if($campaignSlug!=='')$clearArgs['campanha']=$campaignSlug;
    if($searchTerm!==''){$clearArgs['s']=$searchTerm;$clearArgs['post_type']='product';}
    $clearUrl=$clearArgs?add_query_arg($clearArgs,$filterAction):$filterAction;
    $slideIndex=0;
    ob_start();
    ?>
    <main <?php echo get_block_wrapper_attributes(['class'=>'aerion-storefront'.($isResults?' aerion-storefront--results':'')]); ?>>
        <?php if(!$isResults): ?>
        <section class="aerion-store-hero aerion-store-hero--cards" data-aerion-store-hero data-aerion-product-strip aria-label="Destaques da loja">
            <div class="aerion-store-hero__track" data-aerion-strip-track tabindex="0">
            <?php foreach($campaigns as $campaign): ?>
                <?php $campaignImage=$campaign['image']?:aerion_blocks_source_asset('campaigns/ofertas-de-lancamento/hero.png');$campaignMobile=$campaign['mobile_image']?:aerion_blocks_source_asset('campaigns/ofertas-de-lancamento/hero-mobile.png'); ?>
                <article class="aerion-store-hero__slide aerion-store-hero__slide--campaign"><a class="aerion-store-hero__campaign-link" href="<?php echo esc_url($campaign['url']); ?>" aria-label="<?php echo esc_attr('Ver produtos da campanha '.$campaign['title']); ?>"><picture><?php $wm=$heroWebp($campaignMobile); if($wm): ?><source media="(max-width: 760px)" type="image/webp" srcset="<?php echo $wm; ?>"><?php endif; ?><source media="(max-width: 760px)" srcset="<?php echo esc_url($campaignMobile); ?>"><?php $wd=$heroWebp($campaignImage,true); if($wd): ?><source type="image/webp" srcset="<?php echo $wd; ?>" sizes="<?php echo esc_attr($heroSizes); ?>"><?php endif; ?><img class="aerion-store-hero__campaign-image" src="<?php echo esc_url($campaignImage); ?>"<?php $ss=$heroSrcset($campaignImage); if($ss): ?> srcset="<?php echo $ss; ?>" sizes="<?php echo esc_attr($heroSizes); ?>"<?php endif; ?> alt="<?php echo esc_attr($campaign['alt']); ?>" fetchpriority="<?php echo $slideIndex===0?'high':'low'; ?>"></picture></a></article>
            <?php $slideIndex++;endforeach; ?>
            <?php foreach($evergreenSlides as $slide): ?>
                <article class="aerion-store-hero__slide aerion-store-hero__slide--evergreen"><a class="aerion-store-hero__campaign-link" href="<?php echo esc_url($slide['url']); ?>"><picture><source media="(max-width: 760px)" srcset="<?php echo esc_url(aerion_blocks_source_asset($slide['mobile'])); ?>"><img class="aerion-store-hero__campaign-image" src="<?php echo esc_url(aerion_blocks_source_asset($slide['desktop'])); ?>"<?php $ss=$heroSrcset(aerion_blocks_source_asset($slide['desktop'])); if($ss): ?> srcset="<?php echo $ss; ?>" sizes="<?php echo esc_attr($heroSizes); ?>"<?php endif; ?> alt="<?php echo esc_attr($slide['alt']); ?>" fetchpriority="<?php echo $slideIndex===0?'high':'low'; ?>"></picture></a></article>
            <?php $slideIndex++;endforeach; ?>
            </div>
            <button class="aerion-store-hero__arrow aerion-store-hero__arrow--prev" type="button" data-aerion-strip-prev aria-label="Banner anterior">‹</button>
            <button class="aerion-store-hero__arrow aerion-store-hero__arrow--next" type="button" data-aerion-strip-next aria-label="Próximo banner">›</button>
        </section>
        <?php if($offerProducts): ?>
        <section class="aerion-store-section aerion-store-offers"><div class="aerion-container">
            <header class="aerion-store-heading aerion-store-heading--offers"><h2><?php echo esc_html($offerTitle); ?><?php if($offerCampaign): ?> <span aria-hidden="true">🔥</span><?php endif; ?></h2><?php if($offerCampaign)echo Aerion_Campaigns::countdown($offerCampaign,'large'); ?></header>
            <div class="aerion-store-offers__carousel" data-aerion-product-strip>
                <button type="button" data-aerion-strip-prev aria-label="Ofertas anteriores">‹</button>
                <div class="aerion-store-offers__track" data-aerion-strip-track><?php foreach($offerProducts as $offer)echo aerion_store_product_card($offer,'aerion-store-product--offer'); ?></div>
                <button type="button" data-aerion-strip-next aria-label="Próximas ofertas">›</button>
            </div>
        </div></section>
        <?php endif; ?>
        <?php /* Faixa de acessórios entre as ofertas e o catálogo: um anúncio, não um herói — por isso é centralizada, estreita e com respiro dos dois lados. */ ?>
        <section class="aerion-store-section aerion-store-adstrip"><div class="aerion-container">
            <a class="aerion-store-adstrip__link" href="<?php echo esc_url(home_url('/loja/?tipo=acessorios-e-baterias')); ?>">
                <img class="aerion-store-adstrip__image" src="<?php echo esc_url(aerion_blocks_source_asset('campaigns/acessorios/banner.png')); ?>" alt="Acessórios originais Autel: baterias, carregadores e módulos" loading="lazy" decoding="async" width="1400" height="360">
            </a>
        </div></section>
        <style>
            .aerion-store-adstrip{padding-block:clamp(.4rem,1.1vw,.8rem)}
            .aerion-store-adstrip__link{display:block;max-width:980px;margin-inline:auto;border-radius:10px;overflow:hidden;line-height:0}
            .aerion-store-adstrip__image{width:100%;height:auto;display:block}
            .aerion-store-adstrip__link:hover .aerion-store-adstrip__image{filter:brightness(1.06);transition:filter .3s ease}
        </style>
        <?php endif; ?>

        <section class="aerion-store-section aerion-store-section--muted" id="produtos-da-loja"><div class="aerion-container">
            <header class="aerion-store-heading aerion-store-heading--catalog<?php echo $selectedCampaign?' aerion-store-heading--campaign':''; ?>">
                <div><h2><?php if(!$isResults): ?><a href="<?php echo esc_url(home_url('/loja/?vitrine=destaques')); ?>"><?php echo esc_html($title); ?></a><?php else: ?><?php echo esc_html($title); ?><?php endif; ?></h2><?php if($selectedCampaign)echo Aerion_Campaigns::countdown($selectedCampaign,'large'); ?><?php if($isResults): ?><small><?php echo esc_html(sprintf(_n('%d produto','%d produtos',$total,'aerion'),$total)); ?></small><?php endif; ?></div>
                <form class="aerion-store-sort" method="get" action="<?php echo esc_url($filterAction); ?>">
                    <?php if($searchTerm!==''): ?><input type="hidden" name="s" value="<?php echo esc_attr($searchTerm); ?>"><input type="hidden" name="post_type" value="product"><?php endif; ?>
                    <?php if($typeFilter!==''): ?><input type="hidden" name="tipo" value="<?php echo esc_attr($typeFilter); ?>"><?php endif; ?>
                    <?php if($viewFilter!==''): ?><input type="hidden" name="vitrine" value="<?php echo esc_attr($viewFilter); ?>"><?php endif; ?>
                    <?php if($campaignSlug!==''): ?><input type="hidden" name="campanha" value="<?php echo esc_attr($campaignSlug); ?>"><?php endif; ?>
                    <?php foreach(['marca','aplicacao','autonomia','camera','rtk','tipo_produto','baterias','licenca','estoque']as$key)foreach(aerion_store_selected_values($key)as$value): ?><input type="hidden" name="<?php echo esc_attr($key); ?>[]" value="<?php echo esc_attr($value); ?>"><?php endforeach; ?>
                    <?php if(isset($_GET['min_price'])): ?><input type="hidden" name="min_price" value="<?php echo esc_attr((string)$requestedMin); ?>"><?php endif; ?>
                    <?php if(isset($_GET['max_price'])): ?><input type="hidden" name="max_price" value="<?php echo esc_attr((string)$requestedMax); ?>"><?php endif; ?>
                    <label for="aerion-store-order">Classificar por</label>
                    <select id="aerion-store-order" name="orderby" onchange="this.form.submit()"><?php foreach($sortOptions as $value=>$label): ?><option value="<?php echo esc_attr($value); ?>"<?php selected($sort,$value); ?>><?php echo esc_html($label); ?></option><?php endforeach; ?></select>
                </form>
            </header>

            <div class="aerion-store-catalog<?php echo $isResults?' has-filters':''; ?>">
            <?php if($isResults): ?>
                <aside class="aerion-store-filters" aria-label="Filtros de produtos">
                    <form method="get" action="<?php echo esc_url($filterAction); ?>" data-aerion-product-filters>
                        <?php if($searchTerm!==''): ?><input type="hidden" name="s" value="<?php echo esc_attr($searchTerm); ?>"><input type="hidden" name="post_type" value="product"><?php endif; ?>
                        <?php if($typeFilter!==''): ?><input type="hidden" name="tipo" value="<?php echo esc_attr($typeFilter); ?>"><?php endif; ?>
                        <?php if($viewFilter!==''): ?><input type="hidden" name="vitrine" value="<?php echo esc_attr($viewFilter); ?>"><?php endif; ?>
                        <?php if($campaignSlug!==''): ?><input type="hidden" name="campanha" value="<?php echo esc_attr($campaignSlug); ?>"><?php endif; ?>
                        <input type="hidden" name="orderby" value="<?php echo esc_attr($sort); ?>">
                        <div class="aerion-filter-title"><strong>Filtrar produtos</strong><a href="<?php echo esc_url($clearUrl); ?>">Limpar</a></div>
                        <?php if($catalogMax>$catalogMin): ?>
                        <details open class="aerion-filter-group"><summary>Faixa de preço</summary>
                            <div class="aerion-price-filter" data-aerion-price-filter data-min="<?php echo esc_attr((string)$catalogMin); ?>" data-max="<?php echo esc_attr((string)$catalogMax); ?>">
                                <div class="aerion-price-filter__rail" data-aerion-price-rail>
                                    <span data-aerion-price-selection></span>
                                    <button type="button" data-aerion-price-thumb="min" role="slider" aria-label="Preço mínimo"></button>
                                    <button type="button" data-aerion-price-thumb="max" role="slider" aria-label="Preço máximo"></button>
                                </div>
                                <div class="aerion-price-filter__values">
                                    <label><span>Mínimo</span><span><b>R$</b><input inputmode="numeric" type="number" name="min_price" min="<?php echo esc_attr((string)$catalogMin); ?>" max="<?php echo esc_attr((string)$catalogMax); ?>" step="1" value="<?php echo esc_attr((string)$requestedMin); ?>"></span></label>
                                    <label><span>Máximo</span><span><b>R$</b><input inputmode="numeric" type="number" name="max_price" min="<?php echo esc_attr((string)$catalogMin); ?>" max="<?php echo esc_attr((string)$catalogMax); ?>" step="1" value="<?php echo esc_attr((string)$requestedMax); ?>"></span></label>
                                </div>
                            </div>
                        </details>
                        <?php endif; ?>
                        <?php
                        $groups=[
                            ['brand','marca','Marca'],
                            ['applications','aplicacao','Aplicação'],
                            ['autonomy','autonomia','Autonomia'],
                            ['camera','camera','Tipos de câmera'],
                            ['rtk','rtk','Compatibilidade com RTK'],
                            ['product_type','tipo_produto','Tipo de produto'],
                            ['battery_count','baterias','Quantidade de baterias'],
                            ['license','licenca','Tipo de licença'],
                        ];
                        foreach($groups as [$facetKey,$queryKey,$label]):
                            if(!$facetOptions[$facetKey])continue;
                        ?>
                        <details open class="aerion-filter-group"><summary><?php echo esc_html($label); ?></summary><div class="aerion-filter-options">
                            <?php foreach($facetOptions[$facetKey]as$value=>$count): ?><label><input type="checkbox" name="<?php echo esc_attr($queryKey); ?>[]" value="<?php echo esc_attr($value); ?>"<?php checked(in_array($value,$selected[$facetKey],true)); ?>><span><?php echo esc_html($value); ?></span><small><?php echo esc_html((string)$count); ?></small></label><?php endforeach; ?>
                        </div></details>
                        <?php endforeach; ?>
                        <details open class="aerion-filter-group"><summary>Disponibilidade</summary><div class="aerion-filter-options">
                            <?php foreach(['Em estoque','Indisponível']as$value): ?><label><input type="checkbox" name="estoque[]" value="<?php echo esc_attr($value); ?>"<?php checked(in_array($value,$selected['stock'],true)); ?>><span><?php echo esc_html($value); ?></span></label><?php endforeach; ?>
                        </div></details>
                    </form>
                </aside>
            <?php endif; ?>
                <div class="aerion-store-results">
                    <?php if($pageProducts): ?><div class="aerion-store-products"><?php foreach($pageProducts as $product)echo aerion_store_product_card($product); ?></div>
                    <?php else: ?><div class="aerion-store-empty"><h3>Nenhum produto encontrado</h3><p>Tente remover alguns filtros ou buscar outro termo.</p><a href="<?php echo esc_url(home_url('/loja/')); ?>">Ver todos os produtos</a></div><?php endif; ?>
                    <?php if($maxPages>1):
                        $pageBase=str_replace('999999999','%#%',esc_url_raw(add_query_arg('pagina','999999999')));
                        $links=paginate_links(['base'=>$pageBase,'format'=>'','current'=>$currentPage,'total'=>$maxPages,'prev_text'=>'‹ Anterior','next_text'=>'Próxima ›','type'=>'list']);
                    ?>
                        <nav class="aerion-store-pagination" aria-label="Paginação de produtos"><?php echo wp_kses_post($links); ?></nav>
                    <?php endif; ?>
                </div>
            </div>
        </div></section>
    </main>
    <?php
    return(string)ob_get_clean();
}
