<?php
/** Canonical WooCommerce data layer policy. Loaded by Aerion Ecommerce Reports. */
declare(strict_types=1);
if (! defined('ABSPATH')) { exit; }

final class Aerion_Ecommerce_Measurement
{
    public static function boot(): void
    {
        add_filter('option_gtm4wp-options', [self::class, 'options']);
        add_filter('option_moove_gdpr_plugin_settings', [self::class, 'consent_options']);
        // Moove reads its own settings table through pre_option at priority 99.
        add_filter('pre_option_moove_gdpr_plugin_settings', [self::class, 'consent_pre_options'], 100);
        add_action('wp', [self::class, 'guard_unpaid_page'], 1);
        add_filter('gtm4wp_purchase_datalayer', [self::class, 'purchase'], 20, 2);
        add_action('wp_footer', [self::class, 'consent_event'], 101);
    }

    public static function options(mixed $options): array
    {
        return array_replace(is_array($options) ? $options : [], [
            'integrate-woocommerce-track-enhanced-ecommerce' => true,
            'integrate-woocommerce-remarketing-usesku' => true,
            'integrate-woocommerce-remarketing-productidprefix' => '',
            'integrate-woocommerce-exclude-tax' => true,
            'integrate-woocommerce-exclude-shipping' => true,
            'integrate-woocommerce-clear-ecommerce-datalayer' => true,
            // Never expose customer names, email, telephone or postal addresses to the data layer.
            'integrate-woocommerce-customer-data' => false,
            'integrate-woocommerce-order-data' => false,
        ]);
    }

    public static function paid(mixed $order): bool
    {
        return $order instanceof WC_Order && $order->is_paid() && (bool) $order->get_date_paid();
    }

    public static function consent_options(mixed $options): array
    {
        $options = is_array($options) ? $options : [];
        $options = array_replace([
            'moove_gdpr_performance_cookies_tab_title' => 'Medição e estatísticas',
            'moove_gdpr_performance_cookies_tab_content' => '<p>Com sua autorização, o Google Analytics mede navegação, carrinhos e compras para melhorar a loja. Você pode desativar esta categoria quando quiser.</p>',
            'moove_gdpr_advanced_cookies_tab_title' => 'Publicidade e remarketing',
            'moove_gdpr_advanced_cookies_tab_content' => '<p>Com sua autorização, Google Ads e Meta medem o resultado de anúncios e criam públicos com base na navegação e nas compras. Você pode desativar esta categoria quando quiser.</p>',
        ], $options);
        return array_replace($options, [
            'moove_gdpr_third_party_cookies_enable' => 1,
            'moove_gdpr_third_party_cookies_enable_first_visit' => 0,
            'moove_gdpr_advanced_cookies_enable' => 1,
            'moove_gdpr_advanced_cookies_enable_first_visit' => 0,
        ]);
    }

    public static function consent_pre_options(mixed $options): mixed
    {
        return is_array($options) ? self::consent_options($options) : $options;
    }

    public static function guard_unpaid_page(): void
    {
        if (! function_exists('is_order_received_page') || ! is_order_received_page()) { return; }
        $order = wc_get_order(absint(get_query_var('order-received')));
        if (! self::paid($order)) {
            // GTM4WP otherwise marks pending Pix/boleto orders as purchases and as already tracked.
            // Disable its ecommerce output only for this unpaid receipt request, before wp_head.
            global $gtm4wp_options;
            if (is_array($gtm4wp_options)) {
                $gtm4wp_options['integrate-woocommerce-track-enhanced-ecommerce'] = false;
            }
        }
    }

    public static function purchase(array $data, mixed $order): array
    {
        if (! self::paid($order)) { return ['event' => 'aerion_order_unpaid', 'ecommerce' => null]; }
        $value = 0.0;
        foreach ($order->get_items('line_item') as $item) { $value += (float) $item->get_total(); }
        $payment_discount = 0.0;
        foreach ($order->get_fees() as $fee) {
            if (in_array(strtolower(trim($fee->get_name())), ['desconto no pix', 'mercado pago discount'], true) && (float) $fee->get_total() < 0) {
                $payment_discount -= (float) $fee->get_total();
            }
        }
        $value = max(0.0, round($value - $payment_discount, 2));
        if ($payment_discount > 0 && !empty($data['ecommerce']['items'])) {
            $item_total = 0.0;
            foreach ($data['ecommerce']['items'] as $item) { $item_total += (float) ($item['price'] ?? 0) * max(1, (int) ($item['quantity'] ?? 1)); }
            if ($item_total > 0) {
                foreach ($data['ecommerce']['items'] as &$item) { $item['price'] = round((float) ($item['price'] ?? 0) * $value / $item_total, 6); }
                unset($item);
            }
        }
        $data['event'] = 'purchase';
        $data['event_id'] = 'aerion_purchase_' . $order->get_id();
        $data['ecommerce']['transaction_id'] = (string) $order->get_id();
        $data['ecommerce']['currency'] = $order->get_currency();
        $data['ecommerce']['value'] = round($value, 2);
        return $data;
    }

    public static function consent_event(): void
    {
        ?>
        <script id="aerion-measurement-consent">
        (() => {
          let previous = '';
          const update = () => {
            const consent = category => typeof window.wp_has_consent === 'function' && window.wp_has_consent(category) === true;
            const statistics = consent('statistics'), marketing = consent('marketing');
            const state = String(statistics) + ':' + String(marketing);
            if (state === previous) return;
            previous = state;
            window.dataLayer = window.dataLayer || [];
            window.dataLayer.push({event:'aerion_consent_updated', aerion_statistics_consent:statistics, aerion_marketing_consent:marketing});
          };
          update();
          document.addEventListener('wp_listen_for_consent_change', update);
          document.addEventListener('wp_consent_api_status_change_service', update);
        })();
        </script>
        <?php
    }
}
Aerion_Ecommerce_Measurement::boot();
