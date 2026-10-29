<?php
/** Public consumer projection; no customer identifiers or wholesale metadata. */
declare(strict_types=1);
if (!defined('ABSPATH')) { exit; }

final class Aerion_Marketing_Products
{
    public static function register(): void
    {
        register_rest_route('aerion-reports/v1', '/marketing-seo', [
            'methods' => 'POST', 'callback' => [self::class, 'publish_seo'],
            'permission_callback' => static fn(): bool => current_user_can('aerion_publish_seo'),
        ]);
        register_rest_route('aerion-reports/v1', '/marketing-audience-customers', [
            'methods' => 'GET', 'callback' => [self::class, 'customers'],
            'permission_callback' => static fn(): bool => current_user_can('aerion_sync_audiences'),
            'args' => [
                'page' => ['default' => 1, 'type' => 'integer', 'minimum' => 1, 'maximum' => 100000],
                'per_page' => ['default' => 100, 'type' => 'integer', 'minimum' => 1, 'maximum' => 100],
            ],
        ]);
        register_rest_route('aerion-reports/v1', '/marketing-products', [
            'methods' => 'GET', 'callback' => [self::class, 'products'],
            'permission_callback' => static fn(): bool => current_user_can('aerion_read_reports'),
            'args' => [
                'page' => ['default' => 1, 'type' => 'integer', 'minimum' => 1, 'maximum' => 100000],
                'per_page' => ['default' => 100, 'type' => 'integer', 'minimum' => 1, 'maximum' => 100],
                'product_id' => ['default' => 0, 'type' => 'integer', 'minimum' => 0],
            ],
        ]);
    }
    public static function seo_title(string $title): string
    {
        if (!defined('AERION_APPROVED_SEO_OUTPUT') || AERION_APPROVED_SEO_OUTPUT !== true) { return $title; }
        if (!function_exists('is_product') || !is_product()) { return $title; }
        $approved = get_post_meta(get_queried_object_id(), '_aerion_approved_seo', true);
        $product = wc_get_product(get_queried_object_id());
        if (!$product || !is_array($approved) || ($approved['published_modified_at'] ?? '') !== $product->get_date_modified()?->date(DATE_ATOM)) return $title;
        return is_array($approved) && !empty($approved['title']) ? $approved['title'] : $title;
    }
    public static function seo_description(string $description): string
    {
        if (!defined('AERION_APPROVED_SEO_OUTPUT') || AERION_APPROVED_SEO_OUTPUT !== true) { return $description; }
        if (!function_exists('is_product') || !is_product()) { return $description; }
        $approved = get_post_meta(get_queried_object_id(), '_aerion_approved_seo', true);
        $product = wc_get_product(get_queried_object_id());
        if (!$product || !is_array($approved) || ($approved['published_modified_at'] ?? '') !== $product->get_date_modified()?->date(DATE_ATOM)) return $description;
        return is_array($approved) && !empty($approved['description']) ? $approved['description'] : $description;
    }
    public static function description_tag(): void
    {
        if (defined('WPSEO_VERSION') || defined('RANK_MATH_VERSION')) { return; }
        $description = self::seo_description('');
        if ($description !== '') { echo '<meta name="description" content="' . esc_attr($description) . '">' . "\n"; }
    }
    public static function publish_seo(WP_REST_Request $request): WP_REST_Response|WP_Error
    {
        if (!defined('AERION_APPROVED_SEO_OUTPUT') || AERION_APPROVED_SEO_OUTPUT !== true) return new WP_Error('seo_renderer_review_required', 'Valide o emissor SEO existente antes de habilitar publicação aprovada.', ['status' => 503]);
        $product = wc_get_product((int) ($request['product_id'] ?? 0));
        $title = trim(wp_strip_all_tags((string) ($request['title'] ?? '')));
        $description = trim(wp_strip_all_tags((string) ($request['description'] ?? '')));
        $content_id = (string) ($request['content_id'] ?? '');
        if (!$product || $product->get_parent_id() || $product->is_type('variable') || !preg_match('/^[a-f0-9-]{36}$/i', $content_id)
            || $title === '' || strlen($title) > 800 || $description === '' || strlen($description) > 2000) {
            return new WP_Error('seo_invalid', 'Informe produto simples, título e descrição aprovados.', ['status' => 400]);
        }
        $previous = get_post_meta($product->get_id(), '_aerion_approved_seo', true);
        $modified = $product->get_date_modified()?->date(DATE_ATOM);
        if (is_array($previous) && ($previous['content_id'] ?? '') === $content_id && $previous['title'] === $title && $previous['description'] === $description) {
            if (($previous['published_modified_at'] ?? '') !== $modified) return new WP_Error('seo_conflict', 'Produto alterado depois da publicação. Revise uma nova versão.', ['status' => 409]);
        } else {
            if ($modified !== ($request['expected_modified_at'] ?? null)) return new WP_Error('seo_conflict', 'Produto alterado desde a aprovação.', ['status' => 409]);
            update_post_meta($product->get_id(), '_aerion_approved_seo', ['content_id' => $content_id, 'title' => $title, 'description' => $description, 'approved_at' => gmdate(DATE_ATOM)]);
            // This is a real content change; WordPress updates sitemap lastmod normally.
            $updated = wp_update_post(['ID' => $product->get_id(), 'edit_date' => true], true);
            if (is_wp_error($updated)) {
                if (is_array($previous)) update_post_meta($product->get_id(), '_aerion_approved_seo', $previous);
                else delete_post_meta($product->get_id(), '_aerion_approved_seo');
                return new WP_Error('seo_write_failed', 'Não foi possível atualizar o conteúdo.', ['status' => 503]);
            }
            $product = wc_get_product($product->get_id());
            $approved = get_post_meta($product->get_id(), '_aerion_approved_seo', true);
            $approved['published_modified_at'] = $product->get_date_modified()?->date(DATE_ATOM);
            update_post_meta($product->get_id(), '_aerion_approved_seo', $approved);
        }
        $user = get_current_user_id(); wp_set_current_user(0);
        try { $projection = self::project($product); }
        finally { wp_set_current_user($user); }
        return new WP_REST_Response(['published' => true, 'content_id' => $content_id, 'product' => $projection]);
    }
    public static function customers(WP_REST_Request $request): WP_REST_Response
    {
        $users = get_users(['role__in' => ['customer', 'subscriber'], 'number' => (int) $request['per_page'],
            'paged' => (int) $request['page'], 'orderby' => 'ID', 'order' => 'ASC', 'fields' => ['ID', 'user_email']]);
        $rows = [];
        foreach ($users as $user) {
            $proof = get_user_meta($user->ID, 'aerion_advertising_consent', true);
            $row = ['email' => $user->user_email, 'consent' => is_array($proof) ? array_intersect_key($proof, array_flip(['status', 'ad_user_data', 'ad_personalization', 'source', 'recorded_at', 'withdrawn_at'])) : null];
            foreach (['whatsapp_opt_out', 'opt_out', 'nao_contatar', 'bloqueado'] as $flag) { $row[$flag] = get_user_meta($user->ID, $flag, true); }
            $rows[] = $row;
        }
        $response = new WP_REST_Response(['customers' => $rows, 'source_count' => count($users), 'complete_page' => true]);
        $response->header('Cache-Control', 'private, no-store');
        return $response;
    }
    public static function project($product, $parent = null): array
    {
        $parent = $parent ?: $product;
        $quote = Aerion_Pricing::quote($product, 'consumer', 0);
        $date = (string) $product->get_meta('_aerion_presale_date', true);
        if ($date === '') { $date = (string) $parent->get_meta('_aerion_presale_date', true); }
        $presale = class_exists('Aerion_Presale') && (Aerion_Presale::active($product) || Aerion_Presale::active($parent));
        $availability = $presale ? 'preorder' : ($product->is_on_backorder(1) ? 'backorder' : ($product->is_in_stock() ? 'in_stock' : 'out_of_stock'));
        $parsed = DateTimeImmutable::createFromFormat('!Y-m-d', $date, wp_timezone());
        $terms = wp_get_post_terms($parent->get_id(), 'product_cat', ['fields' => 'names']);
        $brands = wp_get_post_terms($parent->get_id(), 'product_brand', ['fields' => 'names']);
        $brand = trim((string) ($product->get_meta('_aerion_brand', true) ?: $parent->get_meta('_aerion_brand', true)));
        if ($brand === '' && !is_wp_error($brands) && !empty($brands)) { $brand = (string) $brands[0]; }
        if ($brand === '') { $brand = trim((string) ($product->get_attribute('pa_marca') ?: $parent->get_attribute('pa_marca'))); }
        return [
            'id' => $product->get_id(), 'parent_id' => $parent->get_id(), 'sku' => $product->get_sku(),
            'name' => $product->get_name(),
            'description' => wp_strip_all_tags($product->get_short_description() ?: $product->get_description() ?: $parent->get_short_description() ?: $parent->get_description()),
            'url' => $product->get_permalink(),
            'image' => wp_get_attachment_image_url($product->get_image_id() ?: $parent->get_image_id(), 'full') ?: '',
            'brand' => $brand, 'gtin' => (string) $product->get_meta('_aerion_gtin', true),
            'consumer_price' => $quote['card'], 'consumer_regular_price' => $quote['list_card'],
            'price_source' => 'aerion_consumer_card_v1', 'currency' => get_woocommerce_currency(),
            'availability' => $availability,
            'availability_date' => $parsed && $parsed->format('Y-m-d') === $date ? $parsed->format('Y-m-d\T00:00:00P') : null,
            'status' => $parent->get_status() === 'publish' ? $product->get_status() : $parent->get_status(),
            'visible' => $parent->get_catalog_visibility() !== 'hidden',
            'categories' => is_wp_error($terms) ? [] : $terms,
            'modified_at' => $product->get_date_modified()?->date(DATE_ATOM),
        ];
    }
    public static function products(WP_REST_Request $request): WP_REST_Response|WP_Error
    {
        if (!class_exists('Aerion_Pricing')) {
            return new WP_Error('consumer_pricing_unavailable', 'Cotação pública do consumidor indisponível.', ['status' => 503]);
        }
        $user = get_current_user_id();
        // Pricing plugins must see an anonymous consumer, even for an authenticated report request.
        wp_set_current_user(0);
        try {
            $id = (int) $request['product_id'];
            if ($id) {
                $product = wc_get_product($id);
                if (!$product) { return new WP_Error('product_missing', 'Produto removido.', ['status' => 404]); }
                if ($product->get_parent_id()) { $product = wc_get_product($product->get_parent_id()); }
                $products = $product ? [$product] : [];
            } else {
                $products = wc_get_products(['status' => ['publish', 'draft', 'pending', 'private'], 'limit' => (int) $request['per_page'],
                    'page' => (int) $request['page'], 'orderby' => 'id', 'order' => 'ASC']);
            }
            $rows = [];
            foreach ($products as $product) {
                if ($product->is_type('variable')) {
                    foreach ($product->get_children() as $child) {
                        $variation = wc_get_product($child);
                        if ($variation) { $rows[] = self::project($variation, $product); }
                    }
                } else { $rows[] = self::project($product); }
            }
            $response = new WP_REST_Response(['products' => $rows, 'parents_count' => count($products), 'price_source' => 'aerion_consumer_card_v1']);
            $response->header('Cache-Control', 'private, no-store');
            return $response;
        } finally { wp_set_current_user($user); }
    }
}
add_action('rest_api_init', [Aerion_Marketing_Products::class, 'register']);
add_filter('pre_get_document_title', [Aerion_Marketing_Products::class, 'seo_title'], 30);
add_filter('wpseo_title', [Aerion_Marketing_Products::class, 'seo_title'], 30);
add_filter('wpseo_metadesc', [Aerion_Marketing_Products::class, 'seo_description'], 30);
add_filter('rank_math/frontend/title', [Aerion_Marketing_Products::class, 'seo_title'], 30);
add_filter('rank_math/frontend/description', [Aerion_Marketing_Products::class, 'seo_description'], 30);
add_action('wp_head', [Aerion_Marketing_Products::class, 'description_tag'], 2);
