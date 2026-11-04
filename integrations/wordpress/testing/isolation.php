<?php
/** Only installed in the isolated readiness environment, never in production. */
if (getenv('AERION_READINESS_TEST') !== '1') { return; }
add_filter('pre_wp_mail', static fn() => true, PHP_INT_MAX);
add_filter('pre_http_request', static fn() => new WP_Error('readiness_network_blocked', 'External calls are disabled in this test environment.'), PHP_INT_MAX);
add_filter('woocommerce_webhook_should_deliver', '__return_false', PHP_INT_MAX);
add_filter('wp_robots', static fn($robots) => array_merge($robots, ['noindex' => true, 'nofollow' => true]));
add_action('send_headers', static function() { header('X-Robots-Tag: noindex, nofollow'); header('X-Aerion-Test-Environment: isolated'); });
add_action('plugins_loaded', static function() {
    if (!class_exists('WC_Payment_Gateway')) return;
    class Aerion_Readiness_Gateway extends WC_Payment_Gateway {
        public function __construct() { $this->id='aerion_readiness';$this->method_title='Isolated payment simulator';$this->title='Pagamento de teste';$this->enabled='yes';$this->has_fields=true; }
        public function payment_fields() { echo '<label>Resultado simulado <select name="aerion_readiness_result"><option value="paid">Aprovado</option><option value="pending">Pendente</option><option value="declined">Recusado</option></select></label>'; }
        public function process_payment($order_id) {
            $order=wc_get_order($order_id);$result=sanitize_key($_POST['aerion_readiness_result']??'pending');
            $order->update_meta_data('_aerion_readiness_test',true);$order->save();
            if ($result==='declined') {$order->update_status('failed');wc_add_notice('Pagamento recusado pelo simulador de teste.','error');return ['result'=>'failure'];}
            if ($result==='paid') $order->payment_complete('isolated-'.$order_id);
            else $order->update_status('on-hold');
            WC()->cart->empty_cart();return ['result'=>'success','redirect'=>$this->get_return_url($order)];
        }
    }
    add_filter('woocommerce_payment_gateways', static fn($gateways) => [Aerion_Readiness_Gateway::class]);
    add_filter('woocommerce_available_payment_gateways', static fn($gateways) => ['aerion_readiness'=>new Aerion_Readiness_Gateway()], PHP_INT_MAX);
}, -100);
