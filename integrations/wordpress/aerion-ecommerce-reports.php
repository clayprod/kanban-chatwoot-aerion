<?php
/**
 * Plugin Name: Aerion Ecommerce Reports
 * Description: API privada de leitura de links UTM e visitas agregadas para o CRM Aerion.
 * Version: 1.1.1
 * Requires PHP: 8.2
 * Requires at least: 6.6
 */

declare(strict_types=1);

if (! defined('ABSPATH')) {
    exit;
}

require_once __DIR__ . '/measurement.php';

final class Aerion_Ecommerce_Reports
{
    public static function activate(): void
    {
        add_role('aerion_report_reader', 'Aerion — Leitor de relatórios', [
            'read' => true,
            'aerion_read_reports' => true,
        ]);
    }

    public static function register(): void
    {
        foreach (['health', 'links', 'visits'] as $path) {
            register_rest_route('aerion-reports/v1', '/' . $path, [
                'methods' => WP_REST_Server::READABLE,
                'callback' => [self::class, $path],
                'permission_callback' => static function (): bool {
                    return current_user_can('aerion_read_reports');
                },
                'args' => [
                    'page' => ['default' => 1, 'type' => 'integer', 'minimum' => 1, 'maximum' => 100000],
                    'per_page' => ['default' => 100, 'type' => 'integer', 'minimum' => 1, 'maximum' => 100],
                ],
            ]);
        }
    }

    public static function health(): WP_REST_Response
    {
        return self::response([
            'version' => '1.1.1',
            'ecommerce_policy' => 'paid_only_product_value_sku_pix_v2',
            'timezone' => wp_timezone_string(),
            'currency' => function_exists('get_woocommerce_currency') ? get_woocommerce_currency() : '',
            'gtm_configured' => defined('AERION_GTM_ID') && AERION_GTM_ID !== '',
            'ga4_configured' => defined('AERION_GA4_ID') && AERION_GA4_ID !== '',
            'meta_pixel_configured' => defined('AERION_META_PIXEL_ID') && AERION_META_PIXEL_ID !== '',
            'consent_api' => function_exists('wp_has_consent'),
            'utm_available' => class_exists('Aerion_UTM_Analytics'),
            'pixel_status' => 'requires_browser_validation',
        ]);
    }

    public static function links(WP_REST_Request $request): WP_REST_Response|WP_Error
    {
        global $wpdb;
        if (! class_exists('Aerion_UTM_Analytics')) {
            return new WP_Error('aerion_utm_unavailable', 'Rastreamento UTM Aerion não está ativo.', ['status' => 503]);
        }
        $table = $wpdb->prefix . 'aerion_utm_links';
        $per_page = (int) $request['per_page'];
        $offset = ((int) $request['page'] - 1) * $per_page;
        // Whitelist columns: never expose users, session identifiers or order/customer details.
        $rows = $wpdb->get_results($wpdb->prepare(
            'SELECT link_id, created_at, destination_url, final_url, utm_source, utm_medium,
                utm_campaign, utm_content, coupon_codes FROM ' . $table . ' ORDER BY link_id LIMIT %d OFFSET %d',
            $per_page,
            $offset
        ), ARRAY_A);
        if ($wpdb->last_error !== '') {
            return new WP_Error('aerion_report_failed', 'Não foi possível ler os links.', ['status' => 503]);
        }
        foreach ($rows as &$row) {
            $row['coupon_codes'] = json_decode((string) $row['coupon_codes'], true) ?: [];
        }
        unset($row);
        return self::response($rows);
    }

    public static function visits(WP_REST_Request $request): WP_REST_Response|WP_Error
    {
        global $wpdb;
        if (! class_exists('Aerion_UTM_Analytics')) {
            return new WP_Error('aerion_utm_unavailable', 'Rastreamento UTM Aerion não está ativo.', ['status' => 503]);
        }
        $from = (string) ($request->get_param('from') ?? '');
        $to = (string) ($request->get_param('to') ?? '');
        foreach ([$from, $to] as $date) {
            $parsed = DateTimeImmutable::createFromFormat('!Y-m-d', $date);
            if (! $parsed || $parsed->format('Y-m-d') !== $date) {
                return new WP_Error('aerion_invalid_date', 'Use datas válidas no formato AAAA-MM-DD.', ['status' => 400]);
            }
        }
        if ($from > $to || (strtotime($to) - strtotime($from)) > 731 * DAY_IN_SECONDS) {
            return new WP_Error('aerion_invalid_period', 'Selecione um período de até 731 dias.', ['status' => 400]);
        }
        $table = $wpdb->prefix . 'aerion_utm_visits';
        $per_page = (int) $request['per_page'];
        $offset = ((int) $request['page'] - 1) * $per_page;
        $rows = $wpdb->get_results($wpdb->prepare(
            'SELECT link_id, visit_date AS date, COUNT(*) AS visitors, SUM(landing_count) AS landings
              FROM ' . $table . ' WHERE visit_date BETWEEN %s AND %s
              GROUP BY link_id, visit_date ORDER BY visit_date, link_id LIMIT %d OFFSET %d',
            $from,
            $to,
            $per_page,
            $offset
        ), ARRAY_A);
        if ($wpdb->last_error !== '') {
            return new WP_Error('aerion_report_failed', 'Não foi possível ler as visitas.', ['status' => 503]);
        }
        return self::response(array_map(static function (array $row): array {
            $row['visitors'] = (int) $row['visitors'];
            $row['landings'] = (int) $row['landings'];
            return $row;
        }, $rows));
    }

    private static function response(array $data): WP_REST_Response
    {
        $response = new WP_REST_Response($data);
        $response->header('Cache-Control', 'private, no-store, max-age=0');
        return $response;
    }
}

register_activation_hook(__FILE__, [Aerion_Ecommerce_Reports::class, 'activate']);
add_action('rest_api_init', [Aerion_Ecommerce_Reports::class, 'register']);
